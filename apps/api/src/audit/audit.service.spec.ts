import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

type MockPrisma = {
  $queryRaw: jest.Mock;
  ticketEvent: {
    findMany: jest.Mock;
  };
};

function ownerUser(): AuthUser {
  return {
    id: 'owner-1',
    email: 'owner@example.com',
    displayName: 'Owner',
    role: UserRole.OWNER,
    primaryTeamId: null,
    teamId: null,
  };
}

function extractSqlCall(prisma: MockPrisma, index: number) {
  const calls = prisma.$queryRaw.mock.calls as Array<
    [TemplateStringsArray, ...unknown[]]
  >;
  const call = calls[index];
  if (!call) {
    throw new Error(`Expected prisma.$queryRaw call ${index}`);
  }

  const [strings, ...values] = call;
  return flattenSql(Array.from(strings), values);
}

function flattenSql(strings: readonly string[], values: readonly unknown[]) {
  let sql = '';
  const flattenedValues: unknown[] = [];

  for (let index = 0; index < strings.length; index += 1) {
    sql += strings[index];
    if (index >= values.length) {
      continue;
    }

    const value = values[index];
    if (isSqlFragment(value)) {
      const nested = flattenSql(Array.from(value.strings), value.values);
      sql += nested.sql;
      flattenedValues.push(...nested.values);
      continue;
    }

    sql += '?';
    flattenedValues.push(value);
  }

  return { sql, values: flattenedValues };
}

function isSqlFragment(
  value: unknown,
): value is { strings: readonly string[]; values: readonly unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'strings' in value &&
    'values' in value
  );
}

function buildCombinedRow(id: string, createdAt: Date) {
  return {
    entryId: id,
    ticketId: 'ticket-1',
    ticketNumber: 123,
    ticketDisplayId: 'TKT-123',
    type: 'TICKET_STATUS_CHANGED',
    payload: { from: 'OPEN', to: 'CLOSED' },
    createdAt,
    createdById: 'user-1',
    createdByUserId: 'user-1',
    createdByDisplayName: 'Alice Agent',
    createdByEmail: 'alice@example.com',
  };
}

describe('AuditService', () => {
  let service: AuditService;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      ticketEvent: {
        findMany: jest.fn(),
      },
    };

    service = new AuditService(prisma as unknown as PrismaService);
  });

  it('exports CSV from the combined SQL query instead of loading and merging in memory', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([
        buildCombinedRow('event-1', new Date('2026-03-10T12:00:00.000Z')),
      ]);

    const chunks: string[] = [];
    for await (const chunk of service.exportCsv(
      { search: 'closed' },
      ownerUser(),
    )) {
      chunks.push(chunk);
    }

    const csv = chunks.join('');
    expect(csv).toContain('Date,User,Ticket,Action,Details');
    expect(csv).toContain('2026-03-10T12:00:00.000Z,"Alice Agent",TKT-123');
    expect(csv).toContain('Changed status');
    expect(csv).toContain('"from OPEN to CLOSED"');
    expect(prisma.ticketEvent.findMany).not.toHaveBeenCalled();

    const exportCall = extractSqlCall(prisma, 1);
    expect(exportCall.sql).toContain('UNION ALL');
    expect(exportCall.sql).toContain(
      'ORDER BY "createdAt" DESC, "entryId" DESC',
    );
    expect(exportCall.sql).toContain('ILIKE');
    expect(exportCall.values).toContain('%closed%');
  });

  it('paginates export batches with a stable cursor instead of OFFSET', async () => {
    const createdAt = new Date('2026-03-10T12:00:00.000Z');
    const firstBatch = Array.from({ length: 1000 }, (_, index) =>
      buildCombinedRow(`event-${1000 - index}`, createdAt),
    );

    prisma.$queryRaw
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce([]);

    let chunkCount = 0;
    for await (const chunk of service.exportCsv({}, ownerUser())) {
      chunkCount += chunk.length > 0 ? 1 : 0;
    }

    expect(chunkCount).toBeGreaterThan(1);
    const secondBatchCall = extractSqlCall(prisma, 2);
    expect(secondBatchCall.sql).not.toContain('OFFSET');
    expect(secondBatchCall.sql).toContain('"createdAt" <');
    expect(secondBatchCall.sql).toContain('"entryId" <');
    expect(secondBatchCall.values).toContain(createdAt);
    expect(secondBatchCall.values).toContain('event-1');
  });
});
