import { ConfigService } from '@nestjs/config';
import { TicketStatus } from '@prisma/client';
import { AutomationSchedulerService } from './automation-scheduler.service';

// Pure-logic tests: policy parsing, threshold extraction and the candidate
// query builders. The tick itself is covered by test/integration/automation.timed.spec.ts.
describe('AutomationSchedulerService.readPolicy', () => {
  it('defaults to enabled, 5 minutes, batch 200', () => {
    const policy = AutomationSchedulerService.readPolicy(new ConfigService({}));
    expect(policy).toEqual({
      enabled: true,
      intervalMs: 300_000,
      batchSize: 200,
    });
  });

  it('disables only for the literal string "false" and reads the numbers', () => {
    expect(
      AutomationSchedulerService.readPolicy(
        new ConfigService({ AUTOMATION_SCHEDULER_ENABLED: 'false' }),
      ).enabled,
    ).toBe(false);
    expect(
      AutomationSchedulerService.readPolicy(
        new ConfigService({ AUTOMATION_SCHEDULER_ENABLED: '0' }),
      ).enabled,
    ).toBe(true);
    const policy = AutomationSchedulerService.readPolicy(
      new ConfigService({
        AUTOMATION_SCHEDULER_INTERVAL_MS: '15000',
        AUTOMATION_SCHEDULER_BATCH: '50',
      }),
    );
    expect(policy.intervalMs).toBe(15_000);
    expect(policy.batchSize).toBe(50);
  });
});

describe('AutomationSchedulerService.extractThreshold', () => {
  it('reads the auto-close seed rule (status equals + hoursSinceActivity gte)', () => {
    const threshold = AutomationSchedulerService.extractThreshold({
      conditions: [
        { field: 'status', operator: 'equals', value: 'RESOLVED' },
        { field: 'hoursSinceActivity', operator: 'gte', value: 168 },
      ],
    });
    expect(threshold).toEqual({
      hours: 168,
      statuses: [TicketStatus.RESOLVED],
    });
  });

  it('reads the reminder seed rule with a string threshold and an `in` status list inside an and-group', () => {
    const threshold = AutomationSchedulerService.extractThreshold({
      conditions: [
        {
          and: [
            {
              field: 'status',
              operator: 'in',
              value: ['WAITING_ON_REQUESTER', 'BOGUS'],
            },
            { field: 'hoursSinceActivity', operator: 'gte', value: '72' },
          ],
        },
      ],
    });
    expect(threshold).toEqual({
      hours: 72,
      statuses: [TicketStatus.WAITING_ON_REQUESTER],
    });
  });

  it('reads the unassigned seed rule and ignores or-groups', () => {
    const threshold = AutomationSchedulerService.extractThreshold({
      conditions: [
        { field: 'hoursUnassigned', operator: 'gte', value: 4 },
        { or: [{ field: 'status', operator: 'equals', value: 'NEW' }] },
      ],
    });
    expect(threshold).toEqual({ hours: 4, statuses: [] });
  });

  it('returns no threshold for a rule without an hours condition or with garbage', () => {
    expect(
      AutomationSchedulerService.extractThreshold({
        conditions: [
          { field: 'status', operator: 'equals', value: 'RESOLVED' },
        ],
      }).hours,
    ).toBeNull();
    expect(
      AutomationSchedulerService.extractThreshold({
        conditions: [
          { field: 'hoursSinceActivity', operator: 'gte', value: 'soon' },
        ],
      }).hours,
    ).toBeNull();
    expect(
      AutomationSchedulerService.extractThreshold({ conditions: null }).hours,
    ).toBeNull();
  });
});

describe('AutomationSchedulerService.candidateWhere', () => {
  const now = new Date('2026-08-27T12:00:00.000Z');

  it('builds the TIME_IN_STATUS query (statuses, updatedAt cutoff, team scope, no deleted)', () => {
    const where = AutomationSchedulerService.candidateWhere(
      'TIME_IN_STATUS',
      { hours: 168, statuses: [TicketStatus.RESOLVED] },
      'team-1',
      now,
    );
    expect(where).toEqual({
      deletedAt: null,
      status: { in: [TicketStatus.RESOLVED] },
      updatedAt: { lte: new Date('2026-08-20T12:00:00.000Z') },
      assignedTeamId: 'team-1',
    });
  });

  it('builds the UNASSIGNED_FOR query (no assignee, open statuses, createdAt cutoff)', () => {
    const where = AutomationSchedulerService.candidateWhere(
      'UNASSIGNED_FOR',
      { hours: 4, statuses: [] },
      null,
      now,
    );
    expect(where).toEqual({
      deletedAt: null,
      assigneeId: null,
      status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
      createdAt: { lte: new Date('2026-08-27T08:00:00.000Z') },
    });
  });

  it('returns null without a threshold, without a status for TIME_IN_STATUS, or for an event trigger', () => {
    expect(
      AutomationSchedulerService.candidateWhere(
        'UNASSIGNED_FOR',
        { hours: null, statuses: [] },
        null,
        now,
      ),
    ).toBeNull();
    expect(
      AutomationSchedulerService.candidateWhere(
        'TIME_IN_STATUS',
        { hours: 1, statuses: [] },
        null,
        now,
      ),
    ).toBeNull();
    expect(
      AutomationSchedulerService.candidateWhere(
        'STATUS_CHANGED',
        { hours: 1, statuses: [TicketStatus.NEW] },
        null,
        now,
      ),
    ).toBeNull();
  });
});
