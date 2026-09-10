import { ConfigService } from '@nestjs/config';
import { OperationsService } from './operations.service';

/**
 * Unit tests for the operations read model (card 1.21): the snapshot survives a
 * broken dependency, a locked job reports itself as skipped rather than failed,
 * and an unknown key is refused.
 */

const READINESS = {
  status: 'ok',
  checkedAt: '2026-08-31T10:00:00.000Z',
  db: 'ok',
  redis: { emailQueue: 'disabled', automationQueue: 'disabled' },
  smtp: 'missing',
  webPubSub: 'configured',
  blobStorage: 'local-disk',
  attachmentScanner: 'gate-off',
  aiPipeline: 'configured',
  slaWorker: {
    enabled: true,
    lastRunAt: null,
    lastRunOk: null,
    lastSummary: null,
  },
};

type Overrides = {
  readiness?: () => Promise<unknown>;
  slaState?: () => unknown;
  retentionRunOnce?: jest.Mock;
  schedulerRunOnce?: jest.Mock;
  slaRunOnce?: jest.Mock;
  sweeperRunOnce?: jest.Mock;
  outboxCounts?: jest.Mock;
  leadDigestEnabled?: () => boolean;
  leadDigestRun?: jest.Mock;
  inboundMailboxEnabled?: () => boolean;
  inboundMailboxRun?: jest.Mock;
};

function makeService(overrides: Overrides = {}) {
  const slaBreach = {
    getWorkerState:
      overrides.slaState ??
      (() => ({
        enabled: true,
        lastRunAt: '2026-08-31T09:59:00.000Z',
        lastRunOk: true,
        lastSummary: { ranAt: '2026-08-31T09:59:00.000Z', ok: true },
      })),
    runOnce: overrides.slaRunOnce ?? jest.fn().mockResolvedValue({ ok: true }),
  };
  const retention = {
    getPolicy: () => ({
      enabled: true,
      dryRun: true,
      intervalMs: 21_600_000,
      batchSize: 100,
    }),
    getRunState: () => ({
      lastRunAt: null,
      lastRunOk: null,
      lastSummary: null,
    }),
    runOnce: overrides.retentionRunOnce ?? jest.fn().mockResolvedValue(null),
  };
  const scheduler = {
    getPolicy: () => ({ enabled: true, intervalMs: 300_000, batchSize: 200 }),
    getRunState: () => ({
      lastRunAt: null,
      lastRunOk: null,
      lastSummary: null,
    }),
    runOnce:
      overrides.schedulerRunOnce ??
      jest.fn().mockResolvedValue({ ticketsEnqueued: 0 }),
  };
  const outboxSweeper = {
    getPolicy: () => ({ enabled: true, intervalMs: 60_000, batchSize: 20 }),
    getRunState: () => ({
      lastRunAt: null,
      lastRunOk: null,
      lastSummary: null,
    }),
    runOnce:
      overrides.sweeperRunOnce ??
      jest.fn().mockResolvedValue({
        ranAt: '2026-09-02T10:00:00.000Z',
        ok: true,
        reclaimed: 0,
        exhausted: 0,
        retried: 0,
        sent: 0,
        failed: 0,
      }),
  };
  const outbox = {
    counts:
      overrides.outboxCounts ??
      jest
        .fn()
        .mockResolvedValue({ pending: 2, processing: 0, sent: 7, failed: 1 }),
  };
  const health = {
    readiness: overrides.readiness ?? (() => Promise.resolve(READINESS)),
  };
  // Card 1.16: off unless a test says otherwise, matching the shipped default.
  const leadDigest = {
    isEnabled: overrides.leadDigestEnabled ?? (() => false),
    runOnce:
      overrides.leadDigestRun ??
      jest.fn().mockResolvedValue({
        ranAt: '2026-09-09T07:00:00.000Z',
        leadsConsidered: 0,
        digestsQueued: 0,
        leadsWithNothingToSay: 0,
        enabled: false,
      }),
  };
  // Card 1.24: off unless a test says otherwise, matching the shipped default.
  const inboundMailbox = {
    isEnabled: overrides.inboundMailboxEnabled ?? (() => false),
    getMailbox: () => 'helpdesk@company.com',
    getIntervalMs: () => 30_000,
    describeGraph: () => 'missing AZURE_TENANT_ID',
    getLastRun: () => ({ at: null, summary: null }),
    runOnce:
      overrides.inboundMailboxRun ??
      jest.fn().mockResolvedValue({
        ranAt: '2026-09-10T07:00:00.000Z',
        enabled: false,
        fetched: null,
        ingested: 0,
        movedToProcessed: 0,
        skippedNotAddressedToUs: 0,
        failed: 0,
        error: 'Switch is off (INBOUND_MAILBOX_ENABLED is not true)',
      }),
  };
  const service = new OperationsService(
    health as never,
    slaBreach as never,
    retention as never,
    scheduler as never,
    outboxSweeper as never,
    outbox as never,
    leadDigest as never,
    inboundMailbox as never,
    new ConfigService({
      INTAKE_API_SECRET: 'set',
      SLA_BREACH_INTERVAL_MS: '60000',
    }),
  );
  return { service, slaBreach, retention, scheduler, outboxSweeper, outbox };
}

describe('OperationsService.snapshot', () => {
  it('reports the four jobs, the switches and where tickets arrive from', async () => {
    const { service } = makeService();
    const snapshot = await service.snapshot();
    expect(snapshot.jobs.map((job) => job.key)).toEqual([
      'sla-breach',
      'retention',
      // Card 1.32 added the sweeper between retention and the scheduler;
      // card 1.16 added the lead digest just before it.
      'inbound-mailbox',
      'lead-digest',
      'email-outbox',
      'automation-scheduler',
    ]);
    expect(snapshot.switches?.map((row) => row.key)).toEqual(
      expect.arrayContaining([
        'retention',
        'automation-scheduler',
        'sla-worker',
        'inbound-mailbox',
        'lead-digest',
        'ai-pipeline',
        'realtime',
        'attachment-scanning',
      ]),
    );
    expect(snapshot.dataIn?.map((row) => row.key)).toEqual([
      'inbound-email',
      'intake',
    ]);
    expect(snapshot.dataIn?.[1]).toMatchObject({
      configured: true,
      state: 'Configured',
    });
  });

  it('says "Dry run" for retention rather than pretending it is on', async () => {
    const { service } = makeService();
    const snapshot = await service.snapshot();
    const retention = snapshot.switches?.find((row) => row.key === 'retention');
    expect(retention).toMatchObject({ on: false, state: 'Dry run' });
  });

  it('projects the next run from the last one and the interval', async () => {
    const { service } = makeService();
    const snapshot = await service.snapshot();
    const sla = snapshot.jobs.find((job) => job.key === 'sla-breach');
    expect(sla?.nextRunAt).toBe('2026-08-31T10:00:00.000Z');
    const retention = snapshot.jobs.find((job) => job.key === 'retention');
    expect(retention?.nextRunAt).toBeNull();
  });

  it('still returns a snapshot when readiness throws', async () => {
    const { service } = makeService({
      readiness: () => Promise.reject(new Error('redis down')),
    });
    const snapshot = await service.snapshot();
    expect(snapshot.jobs).toHaveLength(6);
    // The switch group keeps the worker rows readiness does not own.
    // Card 1.16 added the lead digest to that set.
    expect(snapshot.switches?.map((row) => row.key)).toEqual([
      'retention',
      'automation-scheduler',
      'sla-worker',
      'inbound-mailbox',
      'lead-digest',
    ]);
  });

  it('degrades one job row to unknown rather than failing the snapshot', async () => {
    const { service } = makeService({
      slaState: () => {
        throw new Error('worker exploded');
      },
    });
    const snapshot = await service.snapshot();
    const sla = snapshot.jobs.find((job) => job.key === 'sla-breach');
    expect(sla).toMatchObject({
      enabled: false,
      lastRunAt: null,
      nextRunAt: null,
    });
    expect(snapshot.jobs).toHaveLength(6);
  });
});

describe('OperationsService.runJob', () => {
  it('reports a locked job as skipped, not as a failure', async () => {
    const { service } = makeService({
      retentionRunOnce: jest.fn().mockResolvedValue(null),
    });
    const result = await service.runJob('retention');
    expect(result).toMatchObject({
      key: 'retention',
      ran: false,
      skipped: 'locked',
      summary: null,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns the summary when the job ran', async () => {
    const { service, scheduler } = makeService();
    const result = await service.runJob('automation-scheduler');
    expect(scheduler.runOnce).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ran: true,
      skipped: null,
      summary: { ticketsEnqueued: 0 },
    });
  });

  it('refuses an unknown job key', async () => {
    const { service } = makeService();
    await expect(service.runJob('nope')).rejects.toThrow(
      'Unknown job "nope". Valid: sla-breach, retention, automation-scheduler',
    );
  });
});
