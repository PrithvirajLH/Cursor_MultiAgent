import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/current-user.decorator';
import { ReportsService } from './reports.service';
import { AiAccuracyService } from './ai-accuracy.service';

type MockPrisma = {
  $queryRaw: jest.Mock;
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

function extractSqlCall(prisma: MockPrisma) {
  const calls = prisma.$queryRaw.mock.calls as Array<
    [TemplateStringsArray, ...unknown[]]
  >;
  const call = calls[0];
  if (!call) {
    throw new Error('Expected prisma.$queryRaw to be called');
  }

  const [strings, ...values] = call;
  return { strings: Array.from(strings), values };
}

function countDateMatches(values: unknown[], expected: Date) {
  return values.filter(
    (value): value is Date =>
      value instanceof Date && value.getTime() === expected.getTime(),
  ).length;
}

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: MockPrisma;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-10T12:00:00.000Z'));

    prisma = {
      $queryRaw: jest.fn(),
    };

    service = new ReportsService(
      prisma as unknown as PrismaService,
      {} as Cache,
      {} as ConfigService,
      {} as AiAccuracyService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // `ReportsController` gates on `LeadOrAdminGuard`, but the service must not
  // rely on that guard staying in place. Before this, an unhandled role fell
  // through to an unscoped query, so a single decorator change would have
  // exposed every team's ticket data across all 21 report endpoints.
  describe('role scoping fails closed', () => {
    let scopedService: ReportsService;

    beforeEach(() => {
      // getSummary reads cache TTL config before scoping, so this suite needs a
      // ConfigService that responds to `get`. Returning undefined makes
      // parsePositiveInt fall back to its default.
      scopedService = new ReportsService(
        prisma as unknown as PrismaService,
        { get: jest.fn(), set: jest.fn() } as unknown as Cache,
        { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
        { getReport: jest.fn() } as unknown as AiAccuracyService,
      );
    });

    function userWithRole(role: UserRole): AuthUser {
      return {
        id: 'probe-1',
        email: 'probe@example.com',
        displayName: 'Probe',
        role,
        primaryTeamId: null,
        teamId: null,
        memberTeamIds: [],
      };
    }

    it.each([UserRole.AGENT, UserRole.EMPLOYEE])(
      'denies %s instead of returning an unscoped report',
      async (role) => {
        await expect(
          scopedService.getSummary({}, userWithRole(role)),
        ).rejects.toThrow(/restricted to owners, team administrators, and leads/);
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
      },
    );

    it('denies a TEAM_ADMIN that has no primary team', async () => {
      await expect(
        scopedService.getSummary({}, userWithRole(UserRole.TEAM_ADMIN)),
      ).rejects.toThrow(/must have a primary team/);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('denies a LEAD that belongs to no team', async () => {
      await expect(
        scopedService.getSummary({}, userWithRole(UserRole.LEAD)),
      ).rejects.toThrow(/must belong to a team/);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  it('evaluates historical SLA compliance against the report end instead of wall clock now', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        met: 0n,
        breached: 0n,
        first_response_met: 0n,
        first_response_breached: 0n,
        resolution_met: 0n,
        resolution_breached: 0n,
      },
    ]);

    await service.getSlaCompliance(
      {
        from: '2026-01-01',
        to: '2026-01-31',
      },
      ownerUser(),
    );

    const sql = extractSqlCall(prisma);
    expect(sql.strings.join('')).not.toContain('now()');
    expect(
      countDateMatches(sql.values, new Date('2026-02-01T00:00:00.000Z')),
    ).toBe(2);
  });

  it('evaluates future SLA compliance-by-priority queries at the current time', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await service.getSlaComplianceByPriority(
      {
        from: '2026-03-01',
        to: '2026-12-31',
      },
      ownerUser(),
    );

    const sql = extractSqlCall(prisma);
    expect(sql.strings.join('')).not.toContain('now()');
    expect(
      countDateMatches(sql.values, new Date('2026-03-10T12:00:00.000Z')),
    ).toBe(2);
  });

  it('evaluates SLA breaches against the fixed report timestamp', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await service.getSlaBreaches(
      {
        from: '2026-01-01',
        to: '2026-01-31',
      },
      ownerUser(),
    );

    const sql = extractSqlCall(prisma);
    expect(sql.strings.join('')).not.toContain('now()');
    expect(
      countDateMatches(sql.values, new Date('2026-02-01T00:00:00.000Z')),
    ).toBe(2);
  });
});
