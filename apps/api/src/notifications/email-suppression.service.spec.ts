import { PrismaService } from '../prisma/prisma.service';
import { EmailSuppressionService } from './email-suppression.service';

type Row = {
  address: string;
  kind: string;
  failureCount: number;
  lastReason: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

/** An in-memory stand-in for the one table this service owns. */
function buildHarness() {
  const rows = new Map<string, Row>();
  const prisma = {
    emailSuppression: {
      findUnique: jest.fn(async ({ where }: { where: { address: string } }) => {
        return rows.get(where.address) ?? null;
      }),
      findMany: jest.fn(async () => [...rows.values()]),
      create: jest.fn(async ({ data }: { data: Row }) => {
        rows.set(data.address, { ...data });
        return data;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { address: string };
          data: Partial<Row>;
        }) => {
          const existing = rows.get(where.address);
          if (!existing) throw new Error('not found');
          const next = { ...existing, ...data };
          rows.set(where.address, next);
          return next;
        },
      ),
      deleteMany: jest.fn(async ({ where }: { where: { address: string } }) => {
        const existed = rows.delete(where.address);
        return { count: existed ? 1 : 0 };
      }),
    },
  } as unknown as PrismaService;
  return { service: new EmailSuppressionService(prisma), rows };
}

describe('EmailSuppressionService', () => {
  it('suppresses a hard failure immediately', async () => {
    const { service } = buildHarness();
    expect(await service.isSuppressed('gone@csnhc.com')).toBe(false);
    await service.recordFailure('gone@csnhc.com', 'HARD', '550 no such mailbox');
    expect(await service.isSuppressed('gone@csnhc.com')).toBe(true);
  });

  it('does not suppress a soft failure until the fifth', async () => {
    const { service } = buildHarness();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await service.recordFailure('full@csnhc.com', 'SOFT', '452 mailbox full');
      expect(await service.isSuppressed('full@csnhc.com')).toBe(false);
    }
    await service.recordFailure('full@csnhc.com', 'SOFT', '452 mailbox full');
    expect(await service.isSuppressed('full@csnhc.com')).toBe(true);
  });

  it('clearing lets an address receive mail again', async () => {
    const { service } = buildHarness();
    await service.recordFailure('gone@csnhc.com', 'HARD', '550');
    expect(await service.isSuppressed('gone@csnhc.com')).toBe(true);
    expect(await service.clear('gone@csnhc.com')).toBe(true);
    expect(await service.isSuppressed('gone@csnhc.com')).toBe(false);
  });

  it('reports nothing cleared when the address was not suppressed', async () => {
    const { service } = buildHarness();
    expect(await service.clear('never-failed@csnhc.com')).toBe(false);
  });

  it('a later soft failure cannot downgrade a hard one', async () => {
    const { service, rows } = buildHarness();
    await service.recordFailure('gone@csnhc.com', 'HARD', '550');
    await service.recordFailure('gone@csnhc.com', 'SOFT', '452');
    expect(rows.get('gone@csnhc.com')?.kind).toBe('HARD');
    expect(await service.isSuppressed('gone@csnhc.com')).toBe(true);
  });

  it('a hard failure promotes an address that had only failed softly', async () => {
    const { service, rows } = buildHarness();
    await service.recordFailure('mixed@csnhc.com', 'SOFT', '452');
    expect(await service.isSuppressed('mixed@csnhc.com')).toBe(false);
    await service.recordFailure('mixed@csnhc.com', 'HARD', '550');
    expect(rows.get('mixed@csnhc.com')?.kind).toBe('HARD');
    expect(await service.isSuppressed('mixed@csnhc.com')).toBe(true);
  });

  it('treats addresses case-insensitively throughout', async () => {
    const { service, rows } = buildHarness();
    await service.recordFailure('  Gone@CSNHC.com ', 'HARD', '550');
    expect(rows.has('gone@csnhc.com')).toBe(true);
    expect(await service.isSuppressed('GONE@csnhc.com')).toBe(true);
    expect(await service.clear('gone@CSNHC.COM')).toBe(true);
  });

  it('counts every failure, so the reason and count stay current', async () => {
    const { service, rows } = buildHarness();
    await service.recordFailure('full@csnhc.com', 'SOFT', 'first');
    await service.recordFailure('full@csnhc.com', 'SOFT', 'second');
    const row = rows.get('full@csnhc.com');
    expect(row?.failureCount).toBe(2);
    expect(row?.lastReason).toBe('second');
  });

  it('never lets a bookkeeping failure escape into the send path', async () => {
    const { service } = buildHarness();
    const prisma = (
      service as unknown as {
        prisma: { emailSuppression: { findUnique: jest.Mock } };
      }
    ).prisma;
    prisma.emailSuppression.findUnique.mockRejectedValueOnce(
      new Error('database is down'),
    );
    await expect(
      service.recordFailure('x@csnhc.com', 'HARD', '550'),
    ).resolves.toBeUndefined();
  });
});
