import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

const PROBED = [
  ['the audit reader', 'audit/audit.service.ts'],
  ['automation', 'automation/automation.service.ts'],
  ['custom fields', 'custom-fields/custom-fields.service.ts'],
] as const;

/**
 * Card 1.104 — an audit log that went blank quietly.
 *
 * `hasAdminAuditEventTable()` asked `information_schema` whether the table
 * existed and memoised the answer in a field checked with `!== null` — computed
 * exactly ONCE per process — with a `catch` that stored `false`.
 *
 * ⚠️ SO ONE TRANSIENT DATABASE ERROR ON THE FIRST PROBE TURNED THE ADMIN AUDIT
 * LOG OFF FOR THE LIFE OF THE PROCESS, SILENTLY. The readers returned `[]` and
 * `0`; the page rendered empty; nothing said why. An empty audit log and a
 * broken audit log looked identical, which is the entire defect.
 *
 * ⚠️ Card 1.95 made it worse by succeeding — five more services now write audit
 * rows, so a reader silently reporting none became a much bigger lie.
 *
 * ⚠️ THERE WERE THREE COPIES, NOT ONE. The card names the reader in
 * `audit.service.ts`; the same memoised probe also guarded WRITE paths in
 * `automation.service.ts` and `custom-fields.service.ts`, where a cached
 * `false` meant those services silently stopped recording audit rows at all.
 * All three are deleted.
 */
describe('the AdminAuditEvent existence probe is gone (card 1.104)', () => {
  for (const [label, file] of PROBED) {
    it(`⚠️ ${label} no longer caches a failed probe`, () => {
      // THE REGRESSION ASSERTION. The defect is not the query, it is the
      // memo field: `boolean | null` checked with `!== null`, set to `false`
      // by a catch, never retried.
      const source = readFileSync(join(SRC, file), 'utf8');
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toContain('adminAuditEventTableExists');
      expect(code).not.toContain('hasAdminAuditEventTable');
    });
  }

  it('⚠️ nothing probes information_schema for AdminAuditEvent any more', () => {
    // Deleting the memo but keeping the query would re-introduce the same
    // failure the moment somebody cached it again.
    for (const [, file] of PROBED) {
      const source = readFileSync(join(SRC, file), 'utf8');
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(/information_schema[\s\S]{0,200}AdminAuditEvent/);
    }
  });

  it('the readers still query AdminAuditEvent — the table is not optional', () => {
    // The non-vacuity half. Deleting the probe AND the reads would pass every
    // assertion above and produce exactly the blank page the card is about.
    const audit = readFileSync(join(SRC, 'audit/audit.service.ts'), 'utf8');
    expect(audit).toContain('"AdminAuditEvent"');
    // And the combined query no longer has a branch that drops the admin half.
    expect(audit).not.toContain('return Prisma.sql`(${ticketQuery})`');
  });

  it('⚠️ the write side that card 1.95 built is untouched', () => {
    // The card is explicit: `record()` rethrows inside a caller's transaction
    // and logs outside one, and that is correct. This card must not have
    // quietly changed it while tidying the readers.
    const record = readFileSync(join(SRC, 'audit/admin-audit.service.ts'), 'utf8');
    expect(record).toContain('if (tx) {');
    expect(record).toContain('throw error;');
  });
});
