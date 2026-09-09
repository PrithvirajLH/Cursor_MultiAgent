import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AutomationSchedulerService } from '../automation/automation-scheduler.service';
import { EmailOutboxSweeperService } from '../notifications/email-outbox-sweeper.service';
import { LeadDigestService } from '../notifications/lead-digest.service';
import { OutboxService } from '../notifications/outbox.service';
import { HealthService } from '../health/health.service';
import { RetentionService } from '../retention/retention.service';
import { SlaBreachService } from '../slas/sla-breach.service';
import { JOB_KEYS, type JobKey } from './job-key.const';
import type {
  OperationsDataIn,
  OperationsJobRow,
  OperationsSnapshot,
  OperationsSwitch,
} from './operations-snapshot.type';

/** Outcome of a manual run; `skipped: 'locked'` is information, not a failure. */
export type JobRunResult = {
  key: JobKey;
  ran: boolean;
  skipped: 'locked' | null;
  summary: Record<string, unknown> | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

const SLA_DEFAULT_INTERVAL_MS = 60_000;

/**
 * Read model and trigger for the three background workers (card 1.21). Reports
 * states, never configuration values, and never lets one broken part take the
 * whole console down.
 */
@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);

  constructor(
    private readonly health: HealthService,
    private readonly slaBreach: SlaBreachService,
    private readonly retention: RetentionService,
    private readonly scheduler: AutomationSchedulerService,
    private readonly outboxSweeper: EmailOutboxSweeperService,
    private readonly outbox: OutboxService,
    private readonly leadDigest: LeadDigestService,
    private readonly config: ConfigService,
  ) {}

  /** Everything the Operations page renders, assembled defensively. */
  async snapshot(): Promise<OperationsSnapshot> {
    const readiness = await this.readReadiness();
    return {
      generatedAt: new Date().toISOString(),
      switches: this.buildSwitches(readiness),
      dataIn: this.buildDataIn(),
      jobs: this.buildJobs(),
      outbox: await this.readOutboxCounts(),
    };
  }

  /** Same defensive shape as the rest of the snapshot: a failure is null, not a 500. */
  private async readOutboxCounts() {
    try {
      return await this.outbox.counts();
    } catch (error) {
      this.logger.error(
        'Outbox counts unavailable for the operations snapshot',
        (error as Error).stack,
      );
      return null;
    }
  }

  /** Run one job now. Throws only when the job itself throws. */
  async runJob(key: string): Promise<JobRunResult> {
    if (!JOB_KEYS.includes(key as JobKey)) {
      throw new BadRequestException(
        `Unknown job "${key}". Valid: ${JOB_KEYS.join(', ')}`,
      );
    }
    const jobKey = key as JobKey;
    const startedAt = new Date();
    const summary = await this.dispatch(jobKey);
    const finishedAt = new Date();
    return {
      key: jobKey,
      ran: summary !== null,
      skipped: summary === null ? 'locked' : null,
      summary,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  }

  private async dispatch(key: JobKey): Promise<Record<string, unknown> | null> {
    if (key === 'sla-breach') {
      return this.toRecord(await this.slaBreach.runOnce());
    }
    if (key === 'retention') {
      return this.toRecord(await this.retention.runOnce());
    }
    if (key === 'email-outbox') {
      return this.toRecord(await this.outboxSweeper.runOnce());
    }
    if (key === 'lead-digest') {
      // ⚠️ Safe while the switch is off: `runOnce` reports `enabled: false` and
      // queues nothing, so Run now cannot send mail behind the switch's back.
      return this.toRecord(await this.leadDigest.runOnce());
    }
    return this.toRecord(await this.scheduler.runOnce());
  }

  private toRecord(summary: unknown): Record<string, unknown> | null {
    return summary ? (summary as Record<string, unknown>) : null;
  }

  private async readReadiness() {
    try {
      return await this.health.readiness();
    } catch (error) {
      this.logger.error(
        'Readiness unavailable for the operations snapshot',
        (error as Error).stack,
      );
      return null;
    }
  }

  private buildSwitches(
    readiness: Awaited<ReturnType<HealthService['readiness']>> | null,
  ): OperationsSwitch[] | null {
    try {
      const retention = this.retention.getPolicy();
      const scheduler = this.scheduler.getPolicy();
      const sla = this.slaBreach.getWorkerState();
      const digestEnabled = this.leadDigest.isEnabled();
      const rows: OperationsSwitch[] = [
        {
          key: 'retention',
          label: 'Retention job',
          description:
            'Purges soft-deleted tickets and old records on a schedule. Deletes nothing while dry run is on.',
          on: retention.enabled && !retention.dryRun,
          state: !retention.enabled
            ? 'Off'
            : retention.dryRun
              ? 'Dry run'
              : 'On',
          setting: 'RETENTION_ENABLED / RETENTION_DRY_RUN',
        },
        {
          key: 'automation-scheduler',
          label: 'Automation scheduler',
          description:
            'Fires time-based automation rules. Individual rules stay off until an admin enables them.',
          on: scheduler.enabled,
          state: scheduler.enabled ? 'On' : 'Off',
          setting: 'AUTOMATION_SCHEDULER_ENABLED',
        },
        {
          key: 'sla-worker',
          label: 'SLA worker',
          description:
            'Checks SLA timers, raises breach and at-risk notifications.',
          on: sla.enabled,
          state: sla.enabled ? 'On' : 'Off',
          setting: 'SLA_BREACH_WORKER_ENABLED',
        },
        {
          key: 'lead-digest',
          label: 'Lead daily digest',
          description:
            'One email per lead per morning: what breached, what is at risk, what is unassigned on their team. Sends nothing to a lead with nothing to report. Off by default - card 1.42 removed staff email, and this is the one exception, so somebody has to choose it.',
          on: digestEnabled,
          state: digestEnabled ? 'On' : 'Off',
          setting: 'LEAD_DIGEST_ENABLED',
        },
      ];
      if (readiness) {
        rows.push(
          {
            key: 'ai-pipeline',
            label: 'AI pipeline',
            description:
              'Classifies and routes incoming tickets when Azure AI Foundry is configured.',
            on: readiness.aiPipeline === 'configured',
            state: readiness.aiPipeline === 'configured' ? 'On' : 'Off',
            setting: 'AZURE_AI_FOUNDRY_ENDPOINT / _API_KEY',
          },
          {
            key: 'realtime',
            label: 'Realtime updates',
            description:
              'Pushes live ticket and notification updates over Web PubSub; polling is the fallback.',
            on: readiness.webPubSub === 'configured',
            state: readiness.webPubSub === 'configured' ? 'On' : 'Polling',
            setting: 'AZURE_WEB_PUBSUB_CONNECTION_STRING',
          },
          {
            key: 'attachment-scanning',
            label: 'Attachment scanning',
            description:
              'Holds uploaded files until an antivirus verdict arrives.',
            on: readiness.attachmentScanner === 'configured',
            state: this.scannerLabel(readiness.attachmentScanner),
            setting: 'ATTACHMENT_SCAN_ENABLED / _WEBHOOK_SECRET',
          },
        );
      }
      return rows;
    } catch (error) {
      this.logger.error('Switch group unavailable', (error as Error).stack);
      return null;
    }
  }

  private scannerLabel(state: string): string {
    if (state === 'configured') return 'On';
    if (state === 'bypass') return 'Bypassed';
    if (state === 'gate-off') return 'Gate off';
    return 'Blocked';
  }

  private buildDataIn(): OperationsDataIn[] | null {
    try {
      const inboundSecret = Boolean(
        this.config.get<string>('INBOUND_EMAIL_WEBHOOK_SECRET') ??
        this.config.get<string>('M365_INBOUND_WEBHOOK_SECRET'),
      );
      const intakeSecret = Boolean(
        this.config.get<string>('INTAKE_API_SECRET'),
      );
      return [
        {
          key: 'inbound-email',
          label: 'Inbound email',
          path: 'POST /api/tickets/inbound-email',
          configured: inboundSecret,
          state: inboundSecret ? 'Configured' : 'Not configured',
        },
        {
          key: 'intake',
          label: 'Integration intake',
          path: 'POST /api/tickets/intake',
          configured: intakeSecret,
          state: intakeSecret ? 'Configured' : 'Not configured',
        },
      ];
    } catch (error) {
      this.logger.error('Data-in group unavailable', (error as Error).stack);
      return null;
    }
  }

  private buildJobs(): OperationsJobRow[] {
    return [
      this.jobRow(
        'sla-breach',
        'SLA breach checker',
        'Raises SLA breach and at-risk notifications.',
        () => {
          const state = this.slaBreach.getWorkerState();
          return {
            enabled: state.enabled,
            intervalMs: this.slaIntervalMs(),
            lastRunAt: state.lastRunAt,
            lastRunOk: state.lastRunOk,
            lastSummary: state.lastSummary as Record<string, unknown> | null,
          };
        },
      ),
      this.jobRow(
        'retention',
        'Retention',
        'Purges soft-deleted and expired records.',
        () => {
          const policy = this.retention.getPolicy();
          const state = this.retention.getRunState();
          return {
            enabled: policy.enabled,
            intervalMs: policy.intervalMs,
            lastRunAt: state.lastRunAt,
            lastRunOk: state.lastRunOk,
            lastSummary: state.lastSummary as Record<string, unknown> | null,
          };
        },
      ),
      this.jobRow(
        'lead-digest',
        'Lead daily digest',
        'One morning email per lead: breached, at risk and unassigned on their team. Silent when a lead has nothing to report.',
        () => {
          const state = this.leadDigest.getLastRun();
          return {
            enabled: this.leadDigest.isEnabled(),
            intervalMs: this.leadDigest.getIntervalMs(),
            lastRunAt: state.at,
            // A run that queued nothing is still a run that worked - the
            // digest is silent by design when there is nothing to say.
            lastRunOk: state.summary ? true : null,
            lastSummary: state.summary as Record<string, unknown> | null,
          };
        },
      ),
      this.jobRow(
        'email-outbox',
        'Email outbox sweeper',
        'Retries queued email that failed, and reclaims rows abandoned mid-send.',
        () => {
          const policy = this.outboxSweeper.getPolicy();
          const state = this.outboxSweeper.getRunState();
          return {
            enabled: policy.enabled,
            intervalMs: policy.intervalMs,
            lastRunAt: state.lastRunAt,
            lastRunOk: state.lastRunOk,
            lastSummary: state.lastSummary as Record<string, unknown> | null,
          };
        },
      ),
      this.jobRow(
        'automation-scheduler',
        'Automation scheduler',
        'Enqueues tickets that match a time-based automation rule.',
        () => {
          const policy = this.scheduler.getPolicy();
          const state = this.scheduler.getRunState();
          return {
            enabled: policy.enabled,
            intervalMs: policy.intervalMs,
            lastRunAt: state.lastRunAt,
            lastRunOk: state.lastRunOk,
            lastSummary: state.lastSummary as Record<string, unknown> | null,
          };
        },
      ),
    ];
  }

  private jobRow(
    key: JobKey,
    label: string,
    description: string,
    read: () => Omit<
      OperationsJobRow,
      'key' | 'label' | 'description' | 'nextRunAt'
    >,
  ): OperationsJobRow {
    try {
      const state = read();
      return {
        key,
        label,
        description,
        ...state,
        nextRunAt: this.nextRunAt(state.lastRunAt, state.intervalMs),
      };
    } catch (error) {
      this.logger.error(`Job row ${key} unavailable`, (error as Error).stack);
      return {
        key,
        label,
        description,
        enabled: false,
        intervalMs: null,
        lastRunAt: null,
        lastRunOk: null,
        lastSummary: null,
        nextRunAt: null,
      };
    }
  }

  private slaIntervalMs(): number {
    const raw = Number(
      this.config.get<string>('SLA_BREACH_INTERVAL_MS') ??
        String(SLA_DEFAULT_INTERVAL_MS),
    );
    return Number.isFinite(raw) && raw > 0 ? raw : SLA_DEFAULT_INTERVAL_MS;
  }

  private nextRunAt(lastRunAt: string | null, intervalMs: number | null) {
    if (!lastRunAt || !intervalMs) {
      return null;
    }
    const last = new Date(lastRunAt).getTime();
    return Number.isFinite(last)
      ? new Date(last + intervalMs).toISOString()
      : null;
  }
}
