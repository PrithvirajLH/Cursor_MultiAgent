export const REALTIME_TICKET_CHANGED_EVENT = 'ticketing:ticket-changed';
export const REALTIME_TICKET_TYPING_EVENT = 'ticketing:ticket-typing';

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
  ticketId?: string;
  reason?: string;
  actorId?: string | null;
  status?: string;
  assignedTeamId?: string | null;
  message?: RealtimeTicketMessagePayload | null;
};

export type RealtimeTicketTypingEventPayload = {
  ticketId?: string;
  actorId?: string | null;
  actorDisplayName?: string;
  actorEmail?: string;
  isTyping?: boolean;
};
