import type {
  TicketChannel,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';

/**
 * What `POST /api/tickets/intake` answers with — enough for the calling flow to
 * tell the requester "your ticket is IS_2026xxxx" without a second call.
 */
export type IntakeTicketResponse = {
  id: string;
  number: number;
  displayId: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  channel: TicketChannel;
  assignedTeam: { id: string; name: string; slug: string } | null;
  category: { id: string; name: string; slug: string } | null;
  requester: { id: string; email: string; displayName: string };
};
