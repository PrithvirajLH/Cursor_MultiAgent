export const REALTIME_TICKET_CHANGED_EVENT = "ticketing:ticket-changed";
export const REALTIME_TICKET_TYPING_EVENT = "ticketing:ticket-typing";
export const REALTIME_TICKET_VIEWING_EVENT = "ticketing:ticket-viewing";
export const REALTIME_ADMIN_CHANGED_EVENT = "ticketing:admin-changed";

export type RealtimeTicketMessagePayload = {
  id: string;
  body: string;
  type: string;
  createdAt: string;
  author: {
    id: string;
    email: string;
    displayName: string;
  };
  /**
   * The files on this message (card 1.137).
   *
   * ⚠️ OPTIONAL HERE AND REQUIRED ON THE API SIDE, DELIBERATELY. These types
   * are hand-written copies of the API's, so during a deploy the browser can be
   * holding the new code while the server still sends the old payload - and a
   * missing field must read as "no files", not crash the conversation.
   */
  attachments?: {
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }[];
};

/**
 * Mirrors TicketRealtimeReason in the API
 * (apps/api/src/tickets/ticket-realtime.service.ts). Kept as a union rather
 * than `string` so a reason the web never handles cannot be compared against
 * silently.
 */
export type RealtimeTicketReason =
  | "ticket_created"
  | "message_added"
  | "assigned"
  | "transferred"
  | "status_changed"
  | "priority_changed"
  | "category_changed"
  | "followers_changed"
  | "attachment_added"
  | "attachment_scan_status_changed"
  | "automation_rule_executed"
  | "deleted"
  | "restored"
  | "edited"
  | "sla_changed";

export type RealtimeTicketChangedEventPayload = {
  occurredAt?: string;
  ticketId?: string;
  reason?: RealtimeTicketReason;
  actorId?: string | null;
  status?: string;
  priority?: string;
  updatedAt?: string;
  assignedTeamId?: string | null;
  assignedTeam?: {
    id: string;
    name: string;
  } | null;
  assigneeId?: string | null;
  assignee?: {
    id: string;
    email: string;
    displayName: string;
  } | null;
  followerCount?: number;
  actor?: {
    id: string;
    email: string;
    displayName: string;
  } | null;
  message?: RealtimeTicketMessagePayload | null;
};

export type RealtimeTicketTypingEventPayload = {
  occurredAt?: string;
  ticketId?: string;
  actorId?: string | null;
  actorDisplayName?: string;
  actorEmail?: string;
  isTyping?: boolean;
};

/** Cloned from the typing payload (card 1.9): same shape, same audience. */
export type RealtimeTicketViewingEventPayload = {
  occurredAt?: string;
  ticketId?: string;
  actorId?: string | null;
  actorDisplayName?: string;
  actorEmail?: string;
  isViewing?: boolean;
};

export type RealtimeAdminChangedEventPayload = {
  occurredAt?: string;
  scope?: string;
  action?: string;
  entityId?: string | null;
  teamId?: string | null;
  actorId?: string | null;
};
