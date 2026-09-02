/**
 * What a ticket message is about to reach, as the compose screen shows it
 * (card 1.28).
 *
 * Names, not addresses, for the audience: this renders above the compose box on
 * a screen a requester may be reading over a shoulder. `refused` keeps the
 * address because a refusal is an operator problem an agent may need to report.
 */
export type MessageRecipientsPreview = {
  /** The `To:` recipient - the requester on a public reply. Null for an internal note. */
  to: { id: string; name: string } | null;
  /** Everyone copied. `removable` is true only for someone who is here because they follow the ticket. */
  cc: { id: string; name: string; removable: boolean }[];
  /** Addresses the outbound guard will not send to, with the reason. */
  refused: { address: string; reason: string }[];
  /** False for an internal note, which sends no email to anybody. */
  emails: boolean;
};
