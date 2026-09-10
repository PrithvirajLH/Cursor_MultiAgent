/**
 * Slugs a team may not take, because the inbound mailbox needs them (card 1.24).
 *
 * ⚠️ ONE MAILBOX CARRIES TWO KINDS OF PLUS-SUFFIX, told apart by a single rule:
 * a suffix beginning `ticket-` is a reply token, anything else is a department
 * slug. A team slugged `ticket-escalations` would make
 * `helpdesk+ticket-escalations@` ambiguous - and the reply token wins that
 * contest, so mail for that department would silently look for a ticket that
 * does not exist.
 *
 * Enforced HERE, at creation, rather than only in the mail parser. A parser
 * that has to cope with a slug it should never have been given is a rule
 * living in two places, which is the drift behind cards 1.36, 1.38, 1.47, 1.50
 * and 1.55. Refusing the slug means the ambiguity cannot be created.
 *
 * @param slug The candidate slug, already lower-cased by `slugify`.
 * @returns True when the slug must be refused.
 */
export function isReservedTeamSlug(slug: string): boolean {
  return slug.trim().toLowerCase().startsWith('ticket-');
}
