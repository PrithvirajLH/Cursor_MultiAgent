import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AutomationQueueService } from '../common/automation-queue.service';
import { EmailQueueService } from '../notifications/email-queue.service';
import { EmailService } from '../notifications/email.service';
import { OutboxService } from '../notifications/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SlaBreachService } from '../slas/sla-breach.service';
import { TicketAttachmentService } from '../tickets/ticket-attachment.service';
import type { ReadinessReport } from './readiness-report.type';

const DB_CHECK_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly emailQueue: EmailQueueService,
    private readonly automationQueue: AutomationQueueService,
    private readonly realtime: RealtimeService,
    private readonly attachments: TicketAttachmentService,
    private readonly slaBreach: SlaBreachService,
    private readonly outbox: OutboxService,
  ) {}

  /** Live state of every optional integration. States only, never values. */
  async readiness(): Promise<ReadinessReport> {
    const db = await this.checkDatabase();
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      checkedAt: new Date().toISOString(),
      db,
      redis: {
        emailQueue: this.emailQueue.getStatus(),
        automationQueue: this.automationQueue.getStatus(),
      },
      smtp: this.email.isConfigured() ? 'configured' : 'missing',
      webPubSub: this.realtime.isEnabled() ? 'configured' : 'disabled',
      blobStorage: this.attachments.isAzureBlobStorageEnabled()
        ? 'azure'
        : 'local-disk',
      attachmentScanner: this.scannerState(),
      aiPipeline: this.aiState(),
      slaWorker: this.slaBreach.getWorkerState(),
      outbox: await this.outboxCounts(),
    };
  }

  /** Numbers only, and never at the cost of the whole readiness report. */
  private async outboxCounts() {
    try {
      return await this.outbox.counts();
    } catch {
      return null;
    }
  }

  private async checkDatabase(): Promise<'ok' | 'error'> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('db check timed out')),
        DB_CHECK_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
      return 'ok';
    } catch {
      return 'error';
    } finally {
      clearTimeout(timer);
    }
  }

  private scannerState(): ReadinessReport['attachmentScanner'] {
    const gateEnabled =
      (this.config.get<string>('ATTACHMENT_SCAN_ENABLED') ?? 'true') === 'true';
    if (!gateEnabled) {
      return 'gate-off';
    }
    if (this.config.get<string>('ATTACHMENT_SCAN_BYPASS') === 'true') {
      return 'bypass';
    }
    return this.hasValue('ATTACHMENT_SCAN_WEBHOOK_SECRET')
      ? 'configured'
      : 'blocked';
  }

  /**
   * ⚠️ CARD 1.106: THE KILL SWITCH AND THE HEALTH SIGNAL ARE NO LONGER ONE
   * LEVER. Turning the AI off used to mean blanking its credentials, which made
   * this report say `disabled` - indistinguishable from a misconfigured
   * environment. An operator could not switch the AI off without the readiness
   * endpoint claiming something was wrong.
   *
   * `disabled` still means exactly what it meant - no credentials - so every
   * configuration that exists today reports the same word it did before.
   */
  private aiState(): ReadinessReport['aiPipeline'] {
    const configured =
      this.hasValue('AZURE_AI_FOUNDRY_ENDPOINT') &&
      this.hasValue('AZURE_AI_FOUNDRY_API_KEY');
    if (!configured) {
      return 'disabled';
    }
    const switchedOff =
      (this.config.get<string>('AI_PIPELINE_ENABLED') ?? 'true')
        .trim()
        .toLowerCase() === 'false';
    return switchedOff ? 'switched-off' : 'configured';
  }

  private hasValue(key: string): boolean {
    return Boolean(this.config.get<string>(key)?.trim());
  }
}
