export const REALTIME_TICKET_CHANGED_EVENT = 'ticketing:ticket-changed';
export const REALTIME_TICKET_TYPING_EVENT = 'ticketing:ticket-typing';
export const REALTIME_ADMIN_CHANGED_EVENT = 'ticketing:admin-changed';

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
};

export type RealtimeTicketChangedEventPayload = {
  occurredAt?: string;
  ticketId?: string;
  reason?: string;
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

export type RealtimeAdminChangedEventPayload = {
  occurredAt?: string;
  scope?: string;
  action?: string;
  entityId?: string | null;
  teamId?: string | null;
  actorId?: string | null;
};
