import { UserRole } from '@prisma/client';

/**
 * Is this person staff — somebody who works inside the app, rather than
 * somebody the app writes to?
 *
 * Card 1.42's whole rule is "email leaves this system only for the requester and
 * the people CC'd with them; staff use the app", so this is the test that
 * enforces it.
 *
 * ROLE, NOT DOMAIN, and that matters. Card 1.42 §1b said to reuse the
 * "domain/staff test" in `resolveOutboundRecipients`. There is no staff test in
 * there — only an allowed *domain* list, and that list is the organisation's own
 * domain (`csnhc.com`). Everybody is on it, requesters included, because this is
 * an internal helpdesk. A domain test therefore cannot tell a lead from a
 * requester, and using it as one would have refused every email this card
 * deliberately keeps.
 *
 * This never decides who the *requester* is. The requester of a ticket is
 * whoever raised it, whatever their rank, and they are kept in the email
 * audience by relationship rather than by role — a payroll lead raising a ticket
 * about her own pay is a requester on it and must still hear back.
 */
export function isStaffRole(role: UserRole): boolean {
  return role !== UserRole.EMPLOYEE;
}
