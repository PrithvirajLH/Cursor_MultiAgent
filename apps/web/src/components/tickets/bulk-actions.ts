import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  bulkAssignTickets,
  bulkPriorityTickets,
  bulkStatusTickets,
  bulkTransferTickets,
} from '../../api/client';
import type { TicketPriority, TicketStatus } from '../../api/client';

/**
 * Invalidate every tickets-revamp query after a bulk action so the list re-fetches.
 * Also invalidates ticket counts (sidebar badges depend on these).
 */
function invalidateTicketsQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['tickets-revamp'] });
  qc.invalidateQueries({ queryKey: ['ticket-counts'] });
}

export function useBulkAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketIds, assigneeId }: { ticketIds: string[]; assigneeId?: string }) =>
      bulkAssignTickets(ticketIds, assigneeId),
    onSuccess: () => invalidateTicketsQueries(qc),
  });
}

export function useBulkStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketIds, status }: { ticketIds: string[]; status: TicketStatus }) =>
      bulkStatusTickets(ticketIds, status),
    onSuccess: () => invalidateTicketsQueries(qc),
  });
}

export function useBulkPriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketIds, priority }: { ticketIds: string[]; priority: TicketPriority }) =>
      bulkPriorityTickets(ticketIds, priority),
    onSuccess: () => invalidateTicketsQueries(qc),
  });
}

export function useBulkTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      ticketIds,
      newTeamId,
      assigneeId,
    }: {
      ticketIds: string[];
      newTeamId: string;
      assigneeId?: string;
    }) => bulkTransferTickets(ticketIds, newTeamId, assigneeId),
    onSuccess: () => invalidateTicketsQueries(qc),
  });
}
