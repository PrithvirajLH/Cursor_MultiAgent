/**
 * Short forms people will actually type in a plus-address (card 1.24).
 *
 * Production slugs are `ai`, `hr`, `it-service-desk`, `medicaid-pending`,
 * `payroll` and `white-gloves`. Nobody is going to type
 * `helpdesk+it-service-desk@csnhc.com`, so a handful of aliases stand in front
 * of the slug lookup.
 *
 * ⚠️ `hr-operations` is INACTIVE and must never be a target. It is not listed
 * here, and `resolveActiveTeamIdBySlug` filters on `isActive` anyway - two
 * independent reasons, because this is the kind of thing that gets re-enabled
 * by accident during a merge (see `scripts/merge-hr-teams.sql`, which
 * deactivates it rather than deleting it, so the row survives).
 *
 * An alias that maps to a slug which does not exist, or to an inactive team,
 * resolves to nothing and is handled as an unknown suffix. Adding an alias here
 * is safe; it can only ever widen what is understood.
 */
export const DEPARTMENT_ALIASES: Readonly<Record<string, string>> = {
  it: 'it-service-desk',
  itsd: 'it-service-desk',
  helpdesk: 'it-service-desk',
  servicedesk: 'it-service-desk',
  pay: 'payroll',
  payroll: 'payroll',
  hr: 'hr',
  medicaid: 'medicaid-pending',
  'medicaid-pending': 'medicaid-pending',
  wg: 'white-gloves',
  whitegloves: 'white-gloves',
  ai: 'ai',
};
