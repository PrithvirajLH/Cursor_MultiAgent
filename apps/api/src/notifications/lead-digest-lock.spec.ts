import type { ConfigService } from '@nestjs/config';
import type { AccessControlService } from '../common/access-control.service';
import type { EmailQueueService } from './email-queue.service';
import { LeadDigestService } from './lead-digest.service';
import type { OutboxService } from './outbox.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Card 1.115 — the lead digest could send twice.
 *
 * ⚠️ `operations.service.ts:119` EXPOSES `runOnce()` TO THE OPERATIONS
 * CONSOLE, so two clicks sent every lead two digests. The scheduled path can
 * overlap with itself the same way when a run outlasts its interval. There was
 * no lock, no running flag and no advisory lock anywhere in the service.
 *
 * ⚠️ MEASURED: `LEAD_DIGEST_ENABLED` IS NOT SET IN PRODUCTION, so the digest
 * is off and this is latent. It arms the day the owner turns it on — the same
 * shape as card 1.83 arming with the scan flag.
 */
describe('the lead digest refuses a second concurrent run (card 1.115)', () => {
  const build = (collect: () => Promise<unknown[]>) => {
    const service = Object.create(LeadDigestService.prototype) as LeadDigestService;
    const enqueue = jest.fn().mockResolvedValue(undefined);
    Object.assign(service, {
      prisma: {} as unknown as PrismaService,
      config: {
        get: (key: string) => (key === 'LEAD_DIGEST_ENABLED' ? 'true' : undefined),
      } as unknown as ConfigService,
      outbox: {
        createEmail: jest.fn().mockResolvedValue({ id: 'row-1' }),
      } as unknown as OutboxService,
      emailQueue: { enqueue } as unknown as EmailQueueService,
      accessControl: {} as unknown as AccessControlService,
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      collectDigests: collect,
    });
    return { service, enqueue };
  };

  /** One lead with something to say, whose collection we can hold open. */
  const oneDigest = () => [
    {
      leadId: 'lead-1',
      leadEmail: 'lead@example.com',
      leadName: 'Lead',
      breached: [
        {
          id: 't1',
          displayId: 'IT_1',
          subject: 'a breached ticket',
          dueAt: new Date('2026-09-15T00:00:00.000Z'),
        },
      ],
      atRisk: [],
      unassigned: [],
    },
  ];

  it('⚠️ two overlapping runs queue ONE digest, not two', async () => {
    // THE REGRESSION ASSERTION. Before the card both clicks collected and both
    // queued, so every lead received two emails.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, enqueue } = build(async () => {
      await gate;
      return oneDigest();
    });

    const first = service.runOnce();
    const second = await service.runOnce();
    release();
    const firstSummary = await first;

    expect(second.alreadyRunning).toBe(true);
    expect(second.digestsQueued).toBe(0);
    expect(firstSummary.digestsQueued).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('⚠️ the second run says so, rather than failing silently', async () => {
    // The Operations console is a person clicking a button; "already running"
    // is a useful answer and silence is not.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service } = build(async () => {
      await gate;
      return [];
    });
    const first = service.runOnce();
    const second = await service.runOnce();
    release();
    await first;
    expect(second.alreadyRunning).toBe(true);
  });

  it('⚠️ a throwing run releases the guard', async () => {
    // Otherwise one failure would end the digest for the life of the process -
    // card 1.104's shape - and the scheduled caller swallows the error, so it
    // would have been silent.
    let shouldThrow = true;
    const { service, enqueue } = build(async () => {
      if (shouldThrow) {
        throw new Error('collection failed');
      }
      return oneDigest();
    });

    await expect(service.runOnce()).rejects.toThrow('collection failed');

    shouldThrow = false;
    const after = await service.runOnce();
    expect(after.alreadyRunning).toBeUndefined();
    expect(after.digestsQueued).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('⚠️ a normal single run is completely unaffected', async () => {
    // NON-VACUITY. A guard that refuses the FIRST run passes every assertion
    // above and switches the feature off.
    const { service, enqueue } = build(async () => oneDigest());
    const summary = await service.runOnce();
    expect(summary.alreadyRunning).toBeUndefined();
    expect(summary.digestsQueued).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('two SEQUENTIAL runs both work', async () => {
    const { service, enqueue } = build(async () => oneDigest());
    await service.runOnce();
    await service.runOnce();
    expect(enqueue).toHaveBeenCalledTimes(2);
  });
});
