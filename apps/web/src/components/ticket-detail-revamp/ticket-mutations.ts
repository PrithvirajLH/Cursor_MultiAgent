import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  assignTicket,
  transferTicket,
  transitionTicket,
  type TicketDetail,
  type TicketPriority,
  type TicketStatus,
  type UserRef,
} from '../../api/client';

/**
 * Single-ticket mutation hooks used by the detail page (PropertiesPane).
 *
 * Each hook updates the cached `ticket-detail-revamp` entry optimistically
 * so the UI reflects the change instantly. On error we restore the snapshot.
 * Lists and counts are invalidated on settle.
 */

function invalidateAfterChange(qc: QueryClient, ticketId: string) {
  qc.invalidateQueries({ queryKey: ['ticket-detail-revamp', ticketId] });
  qc.invalidateQueries({ queryKey: ['ticket-events-revamp', ticketId] });
  qc.invalidateQueries({ queryKey: ['ticket-messages-revamp', ticketId] });
  qc.invalidateQueries({ queryKey: ['tickets-revamp'] });
  qc.invalidateQueries({ queryKey: ['ticket-counts'] });
  qc.invalidateQueries({ queryKey: ['view-count'] });
}

/**
 * Optimistically update the cached ticket detail and return a rollback fn.
 */
function patchDetail(
  qc: QueryClient,
  ticketId: string,
  patch: (t: TicketDetail) => TicketDetail,
): () => void {
  const key = ['ticket-detail-revamp', ticketId];
  const prev = qc.getQueryData<TicketDetail>(key);
  if (prev) {
    qc.setQueryData<TicketDetail>(key, patch(prev));
  }
  return () => {
    if (prev) qc.setQueryData(key, prev);
  };
}

/* ─── Status change (transition) ────────────────────────────────── */

export function useTransitionTicket(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: TicketStatus) => transitionTicket(ticketId, { status }),
    onMutate: async status => {
      await qc.cancelQueries({ queryKey: ['ticket-detail-revamp', ticketId] });
      const rollback = patchDetail(qc, ticketId, t => ({ ...t, status }));
      return { rollback };
    },
    onError: (_err, _vars, ctx) => ctx?.rollback?.(),
    onSettled: () => invalidateAfterChange(qc, ticketId),
  });
}

/* ─── Assign / Unassign (single ticket) ─────────────────────────── */

export function useAssignTicket(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignee }: { assignee: UserRef | null }) =>
      assignTicket(ticketId, { assigneeId: assignee?.id }),
    onMutate: async ({ assignee }) => {
      await qc.cancelQueries({ queryKey: ['ticket-detail-revamp', ticketId] });
      const rollback = patchDetail(qc, ticketId, t => ({ ...t, assignee }));
      return { rollback };
    },
    onError: (_err, _vars, ctx) => ctx?.rollback?.(),
    onSettled: () => invalidateAfterChange(qc, ticketId),
  });
}

/* ─── Transfer to team ─────────────────────────────────────────── */

interface TransferVars {
  newTeam: { id: string; name: string };
  assignee?: UserRef | null;
}

export function useTransferTicket(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ newTeam, assignee }: TransferVars) =>
      transferTicket(ticketId, {
        newTeamId: newTeam.id,
        assigneeId: assignee?.id,
      }),
    onMutate: async ({ newTeam, assignee }) => {
      await qc.cancelQueries({ queryKey: ['ticket-detail-revamp', ticketId] });
      const rollback = patchDetail(qc, ticketId, t => ({
        ...t,
        assignedTeam: { id: newTeam.id, name: newTeam.name },
        assignee: assignee !== undefined ? assignee : t.assignee,
      }));
      return { rollback };
    },
    onError: (_err, _vars, ctx) => ctx?.rollback?.(),
    onSettled: () => invalidateAfterChange(qc, ticketId),
  });
}

/* ─── Priority change ──────────────────────────────────────────── */
/**
 * Backend exposes priority change only as a bulk endpoint.
 * We pass the single ticket id as a 1-element array.
 */
import { bulkPriorityTickets } from '../../api/client';

export function useChangePriority(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (priority: TicketPriority) =>
      bulkPriorityTickets([ticketId], priority),
    onMutate: async priority => {
      await qc.cancelQueries({ queryKey: ['ticket-detail-revamp', ticketId] });
      const rollback = patchDetail(qc, ticketId, t => ({ ...t, priority }));
      return { rollback };
    },
    onError: (_err, _vars, ctx) => ctx?.rollback?.(),
    onSettled: () => invalidateAfterChange(qc, ticketId),
  });
}
