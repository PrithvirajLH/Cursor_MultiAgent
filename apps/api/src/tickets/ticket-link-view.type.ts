import type {
  TicketLinkType,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';

/**
 * One ticket link, as a particular reader is allowed to see it (card 1.6).
 *
 * The link itself is never hidden — an agent needs to know a ticket was linked
 * to something. What is hidden is the linked ticket's CONTENT. Reading ticket
 * A's link list must not become a way to learn the subject of ticket B, because
 * HR and payroll subjects carry people's names. So an unreadable target
 * degrades to a bare reference: the ticket's `number`, and nothing else.
 *
 * `displayId` is deliberately withheld along with the subject. It encodes the
 * owning department (`HR_20260903_014`), which is itself information about a
 * ticket the reader may not open; `number` identifies it well enough to ask
 * someone who can.
 */
export type TicketLinkView = {
  id: string;
  type: TicketLinkType;
  /**
   * `outgoing` when the ticket being read is the `from` side of the stored row,
   * `incoming` when it is the `to` side. Only one row exists per relationship,
   * so this is what lets the reader render the inverse: "duplicate of" one way
   * round is "duplicated by" the other.
   */
  direction: 'outgoing' | 'incoming';
  createdAt: Date;
  createdBy: { id: string; displayName: string } | null;
  otherTicket: {
    id: string;
    number: number;
    /** False when the reader may not open it; every field below is then null. */
    visible: boolean;
    /**
     * True only when the target is soft-deleted AND the reader could have seen
     * it while it was live. A soft-deleted ticket is invisible to everyone but
     * OWNER, so without this an agent's own link would read as "no access".
     */
    deleted: boolean;
    displayId: string | null;
    subject: string | null;
    status: TicketStatus | null;
    priority: TicketPriority | null;
  };
};
