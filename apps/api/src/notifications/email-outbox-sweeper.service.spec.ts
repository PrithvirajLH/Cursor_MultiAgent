import { ConfigService } from '@nestjs/config';
import { OutboxStatus } from '@prisma/client';
import type { EmailProcessorService } from './email-processor.service';
import { EmailOutboxSweeperService } from './email-outbox-sweeper.service';
import { MAX_EMAIL_OUTBOX_ATTEMPTS, OutboxService } from './outbox.service';
import type { PrismaService } from '../prisma/prisma.service';

const MINUTE_MS = 60_000;

type Row = {
  id: string;
  status: OutboxStatus;
  attempts: number;
  updatedAt: Date;
  createdAt: Date;
  channel: 'EMAIL';
};

function row(overrides: Partial<Row> & { id: string }): Row {
  return {
    status: OutboxStatus.PENDING,
    attempts: 1,
    updatedAt: new Date(),
    createdAt: new Date(),
    channel: 'EMAIL',
    ...overrides,
  };
}

/**
 * A real OutboxService over an in-memory table, so the sweeper's filtering is
 * exercised through the queries it actually uses rather than through mocks that
 * would agree with whatever the code did.
 */
function buildHarness(rows: Row[], options: { locked?: boolean } = {}) {
  const table = new Map(rows.map((r) => [r.id, { ...r }]));
  const matches = (r: Row, where: Record<string, unknown>): boolean => {
    if (where.status !== undefined && r.status !== where.status) return false;
    if (where.channel !== undefined && r.channel !== where.channel) return false;
    const attempts = where.attempts as { lt?: number; gte?: number } | undefined;
    if (attempts?.lt !== undefined && !(r.attempts < attempts.lt)) return false;
    if (attempts?.gte !== undefined && !(r.attempts >= attempts.gte)) return false;
    const updatedAt = where.updatedAt as { lt?: Date } | undefined;
    if (updatedAt?.lt !== undefined && !(r.updatedAt < updatedAt.lt)) return false;
    return true;
  };
  const notificationOutbox = {
    findMany: jest.fn(
      async ({
        where,
        take,
      }: {
        where: Record<string, unknown>;
        take?: number;
      }) => {
        const found = [...table.values()]
          .filter((r) => matches(r, where))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return (take ? found.slice(0, take) : found).map((r) => ({ id: r.id }));
      },
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Row>;
      }) => {
        let count = 0;
        for (const r of table.values()) {
          if (matches(r, where)) {
            Object.assign(r, data);
            count += 1;
          }
        }
        return { count };
      },
    ),
    groupBy: jest.fn(
      async ({ where }: { where: { id?: { in: string[] } } }) => {
        const ids = where.id?.in ?? [...table.keys()];
        const tally = new Map<OutboxStatus, number>();
        for (const id of ids) {
          const r = table.get(id);
          if (!r) continue;
          tally.set(r.status, (tally.get(r.status) ?? 0) + 1);
        }
        return [...tally.entries()].map(([status, count]) => ({
          status,
          _count: { _all: count },
        }));
      },
    ),
  };
  const prisma = {
    notificationOutbox,
    $transaction: jest.fn(
      async (fn: (client: unknown) => Promise<unknown>) => fn(txClient),
    ),
  } as unknown as PrismaService;
  const txClient = {
    notificationOutbox,
    $queryRaw: jest.fn(async () => [{ locked: options.locked !== true }]),
  };
  const outbox = new OutboxService(prisma);
  const process = jest.fn(async (id: string) => {
    const r = table.get(id);
    if (r) r.status = OutboxStatus.SENT;
  });
  const processor = { process } as unknown as EmailProcessorService;
  const service = new EmailOutboxSweeperService(
    prisma,
    new ConfigService({}),
    outbox,
    processor,
  );
  return { service, process, table };
}

describe('EmailOutboxSweeperService', () => {
  it('retries a PENDING row that has attempts left', async () => {
    const { service, process } = buildHarness([
      row({ id: 'pending-1', status: OutboxStatus.PENDING, attempts: 1 }),
    ]);
    const summary = await service.runOnce();
    expect(process).toHaveBeenCalledWith('pending-1');
    expect(summary?.retried).toBe(1);
    expect(summary?.sent).toBe(1);
  });

  it('never touches a FAILED row', async () => {
    // FAILED is terminal on purpose: 'SMTP not configured' and a suppressed
    // address both land there, and retrying them would send mail somebody
    // decided should not be sent.
    const { service, process } = buildHarness([
      row({ id: 'failed-1', status: OutboxStatus.FAILED, attempts: 1 }),
    ]);
    const summary = await service.runOnce();
    expect(process).not.toHaveBeenCalled();
    expect(summary?.retried).toBe(0);
  });

  it('does not retry a row that has used all its attempts', async () => {
    const { service, process } = buildHarness([
      row({
        id: 'spent',
        status: OutboxStatus.PENDING,
        attempts: MAX_EMAIL_OUTBOX_ATTEMPTS,
      }),
    ]);
    const summary = await service.runOnce();
    expect(process).not.toHaveBeenCalled();
    expect(summary?.retried).toBe(0);
  });

  it('leaves a PROCESSING row alone while it is still fresh', async () => {
    const { service, process, table } = buildHarness([
      row({
        id: 'in-flight',
        status: OutboxStatus.PROCESSING,
        attempts: 1,
        updatedAt: new Date(Date.now() - MINUTE_MS),
      }),
    ]);
    const summary = await service.runOnce();
    expect(table.get('in-flight')?.status).toBe(OutboxStatus.PROCESSING);
    expect(summary?.reclaimed).toBe(0);
    expect(process).not.toHaveBeenCalled();
  });

  it('reclaims a PROCESSING row abandoned long enough ago', async () => {
    const { service, table } = buildHarness([
      row({
        id: 'abandoned',
        status: OutboxStatus.PROCESSING,
        attempts: 1,
        updatedAt: new Date(Date.now() - 30 * MINUTE_MS),
      }),
    ]);
    const summary = await service.runOnce();
    expect(summary?.reclaimed).toBe(1);
    // Reclaimed and then picked up in the same tick, which is the point.
    expect(table.get('abandoned')?.status).not.toBe(OutboxStatus.PROCESSING);
  });

  it('fails an abandoned row that had no attempts left rather than looping it', async () => {
    const { service, table, process } = buildHarness([
      row({
        id: 'abandoned-spent',
        status: OutboxStatus.PROCESSING,
        attempts: MAX_EMAIL_OUTBOX_ATTEMPTS,
        updatedAt: new Date(Date.now() - 30 * MINUTE_MS),
      }),
    ]);
    const summary = await service.runOnce();
    expect(summary?.exhausted).toBe(1);
    expect(summary?.reclaimed).toBe(0);
    expect(table.get('abandoned-spent')?.status).toBe(OutboxStatus.FAILED);
    expect(process).not.toHaveBeenCalled();
  });

  it('keeps sweeping when one row throws', async () => {
    const { service, process, table } = buildHarness([
      row({ id: 'a', createdAt: new Date(Date.now() - 3 * MINUTE_MS) }),
      row({ id: 'b', createdAt: new Date(Date.now() - 2 * MINUTE_MS) }),
      row({ id: 'c', createdAt: new Date(Date.now() - MINUTE_MS) }),
    ]);
    process.mockImplementation(async (id: string) => {
      const r = table.get(id);
      if (id === 'b') {
        // What the real processor does on a terminal failure: record it, throw.
        if (r) r.status = OutboxStatus.FAILED;
        throw new Error('550 no such mailbox');
      }
      if (r) r.status = OutboxStatus.SENT;
    });
    const summary = await service.runOnce();
    expect(process).toHaveBeenCalledTimes(3);
    expect(summary?.ok).toBe(true);
    expect(summary?.sent).toBe(2);
    expect(summary?.failed).toBe(1);
  });

  it('does not call it a send when the processor returned but nothing was sent', async () => {
    // 'SMTP not configured' is recorded as terminal and process() returns
    // normally. Counting its return value would report a send that never
    // happened, so the summary reads the row instead.
    const { service, process, table } = buildHarness([
      row({ id: 'unsendable' }),
    ]);
    process.mockImplementation(async (id: string) => {
      const r = table.get(id);
      if (r) r.status = OutboxStatus.FAILED;
    });
    const summary = await service.runOnce();
    expect(summary?.retried).toBe(1);
    expect(summary?.sent).toBe(0);
    expect(summary?.failed).toBe(1);
  });

  it('returns null when another instance holds the lock', async () => {
    const { service, process } = buildHarness(
      [row({ id: 'pending-1' })],
      { locked: true },
    );
    expect(await service.runOnce()).toBeNull();
    expect(process).not.toHaveBeenCalled();
  });

  it('reports its policy and last run for the operations console', async () => {
    const { service } = buildHarness([row({ id: 'pending-1' })]);
    expect(service.getPolicy()).toEqual({
      enabled: true,
      intervalMs: 60_000,
      batchSize: 20,
    });
    await service.runOnce();
    const state = service.getRunState();
    expect(state.lastRunAt).not.toBeNull();
    expect(state.lastRunOk).toBe(true);
    expect(state.lastSummary?.retried).toBe(1);
  });
});
