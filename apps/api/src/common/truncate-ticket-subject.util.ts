/**
 * Fit a subject into the `Ticket.subject` column.
 *
 * ⚠️ ONE TRUNCATOR, TWO CALLERS, AND IT LIVES HERE SO IT CAN STAY THAT WAY.
 * Card 1.105 wrote it for inbound email; card 1.108 needs the identical rule for
 * subjects the MODEL invents. Importing it from `inbound-email.service.ts` would
 * drag that whole service into `ai/tools/` and close an import cycle - card 1.103
 * spent a batch on exactly that - so it sits in `common/` as a leaf and the
 * inbound service re-exports it. Nothing that imported it has to change.
 *
 * ⚠️ An ellipsis rather than a hard cut, so a reader can see the subject was
 * shortened rather than wondering whether the sender wrote it that way.
 */
const TICKET_SUBJECT_MAX = 200;

export function truncateTicketSubject(subject: string): string {
  const trimmed = (subject ?? '').trim();
  if (trimmed.length <= TICKET_SUBJECT_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, TICKET_SUBJECT_MAX - 1)}…`;
}
