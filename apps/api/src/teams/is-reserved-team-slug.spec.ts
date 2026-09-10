import { isReservedTeamSlug } from './is-reserved-team-slug.util';

/**
 * Card 1.24 — one mailbox carries department slugs and reply tokens, told
 * apart by the `ticket-` prefix. A team slug in that space breaks the rule.
 */
describe('isReservedTeamSlug (card 1.24)', () => {
  it('⚠️ refuses a slug beginning "ticket-"', () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. A team slugged
    // `ticket-escalations` makes `helpdesk+ticket-escalations@` ambiguous -
    // and the reply token wins that contest, so mail for that department
    // would be looked up as a ticket that does not exist and quietly go
    // nowhere. Refusing the slug means the ambiguity cannot be created.
    expect(isReservedTeamSlug('ticket-escalations')).toBe(true);
    expect(isReservedTeamSlug('ticket-')).toBe(true);
  });

  it('is not fooled by case or surrounding space', () => {
    expect(isReservedTeamSlug('TICKET-urgent')).toBe(true);
    expect(isReservedTeamSlug('  ticket-urgent  ')).toBe(true);
  });

  it('allows every real production slug', () => {
    for (const slug of [
      'ai',
      'hr',
      'it-service-desk',
      'medicaid-pending',
      'payroll',
      'white-gloves',
    ]) {
      expect(isReservedTeamSlug(slug)).toBe(false);
    }
  });

  it('allows a slug that merely contains the word ticket', () => {
    // Only the PREFIX is reserved; `ticketing` is a perfectly good department.
    expect(isReservedTeamSlug('ticketing')).toBe(false);
    expect(isReservedTeamSlug('lost-tickets')).toBe(false);
    expect(isReservedTeamSlug('ticket')).toBe(false);
  });
});
