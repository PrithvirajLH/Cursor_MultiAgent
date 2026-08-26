import { ConfigService } from '@nestjs/config';
import { RetentionService } from './retention.service';

// Pure-logic tests: policy parsing and cutoff arithmetic. The purge itself is
// covered by test/integration/retention.spec.ts against a real database.
describe('RetentionService.readPolicy', () => {
  it('defaults to disabled, dry-run, and undecided class windows', () => {
    const policy = RetentionService.readPolicy(new ConfigService({}));
    expect(policy.enabled).toBe(false);
    expect(policy.dryRun).toBe(true);
    expect(policy.intervalMs).toBe(21_600_000);
    expect(policy.batchSize).toBe(100);
    expect(policy.softDeletedDays).toBe(30);
    expect(policy.closedTicketDays).toBeNull();
    expect(policy.adminAuditDays).toBeNull();
    expect(policy.outboxSentDays).toBe(180);
  });

  it('turns dry run off only for the literal string "false"', () => {
    expect(
      RetentionService.readPolicy(new ConfigService({ RETENTION_DRY_RUN: 'false' }))
        .dryRun,
    ).toBe(false);
    expect(
      RetentionService.readPolicy(new ConfigService({ RETENTION_DRY_RUN: '0' }))
        .dryRun,
    ).toBe(true);
    expect(
      RetentionService.readPolicy(new ConfigService({ RETENTION_DRY_RUN: 'no' }))
        .dryRun,
    ).toBe(true);
  });

  it('enables only for the literal string "true"', () => {
    expect(
      RetentionService.readPolicy(new ConfigService({ RETENTION_ENABLED: 'true' }))
        .enabled,
    ).toBe(true);
    expect(
      RetentionService.readPolicy(new ConfigService({ RETENTION_ENABLED: '1' }))
        .enabled,
    ).toBe(false);
  });

  it('reads the owner-decided windows when set, and ignores garbage', () => {
    const policy = RetentionService.readPolicy(
      new ConfigService({
        RETENTION_CLOSED_TICKET_DAYS: '2555',
        RETENTION_ADMIN_AUDIT_DAYS: 'soon',
        RETENTION_SOFT_DELETED_DAYS: '14',
      }),
    );
    expect(policy.closedTicketDays).toBe(2555);
    expect(policy.adminAuditDays).toBeNull();
    expect(policy.softDeletedDays).toBe(14);
  });
});

describe('RetentionService.cutoff', () => {
  it('subtracts whole days from the given instant', () => {
    const now = new Date('2026-08-26T12:00:00.000Z');
    expect(RetentionService.cutoff(30, now).toISOString()).toBe(
      '2026-07-27T12:00:00.000Z',
    );
    expect(RetentionService.cutoff(1, now).toISOString()).toBe(
      '2026-08-25T12:00:00.000Z',
    );
  });
});
