import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  bulkAssignTickets,
  bulkPriorityTickets,
  bulkStatusTickets,
  bulkTransferTickets,
} from '../../api/client';
import type {
  TicketListResponse,
  TicketPriority,
  TicketRecord,
  TicketStatus,
  UserRef,
} from '../../api/client';

/**
 * Apply a per-ticket patch to every cached `tickets-revamp` query.
 * Returns a snapshot the caller can pass to `restoreSnapshot()` for rollback.
 */
function patchAndSnapshot(
  qc: QueryClient,
  ticketIds: Set<string>,
  patch: (t: TicketRecord) => TicketRecord,
): Array<[readonly unknown[], TicketListResponse]> {
  const snapshot: Array<[readonly unknown[], TicketListResponse]> = [];
  qc.getQueriesData<TicketListResponse>({ queryKey: ['tickets-revamp'] }).forEach(
    ([key, value]) => {
      if (!value) return;
      snapshot.push([key, value]);
      qc.setQueryData<TicketListResponse>(key, {
        ...value,
        data: value.data.map(t => (ticketIds.has(t.id) ? patch(t) : t)),
      });
    },
  );
  return snapshot;
}

function restoreSnapshot(
  qc: QueryClient,
  snapshot: Array<[readonly unknown[], TicketListResponse]>,
) {
  snapshot.forEach(([key, value]) => qc.setQueryData(key, value));
}

function invalidateAll(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['tickets-revamp'] });
  qc.invalidateQueries({ queryKey: ['ticket-counts'] });
}

/* ─── Assign / Unassign ───────────────────────────────────────────── */

interface BulkAssignVars {
  ticketIds: string[];
  /** Pass the full UserRef when assigning to a specific user (so optimistic UI matches). Pass undefined to unassign. */
  assignee: UserRef | undefined;
}

export function useBulkAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketIds, assignee }: BulkAssignVars) =>
      bulkAssignTickets(ticketIds, assignee?.id),
    onMutate: async ({ ticketIds, assignee }) => {
      await qc.cancelQueries({ queryKey: ['tickets-revamp'] });
      const ids = new Set(ticketIds);
      const snapshot = patchAndSnapshot(qc, ids, t => ({ ...t, assignee: assignee ?? null }));
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) restoreSnapshot(qc, context.snapshot);
    },
    onSettled: () => invalidateAll(qc),
  });
}

/* ─── Set status ───────────────────────────────────────────────────── */

interface BulkStatusVars {
  ticketIds: string[];
  status: TicketStatus;
}

export function useBulkStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketIds, status }: BulkStatusVars) =>
      bulkStatusTickets(ticketIds, status),
    onMutate: async ({ ticketIds, status }) => {
      await qc.cancelQueries({ queryKey: ['tickets-revamp'] });
      const ids = new Set(ticketIds);
      const snapshot = patchAndSnapshot(qc, ids, t => ({ ...t, status }));
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) restoreSnapshot(qc, context.snapshot);
    },
    onSettled: () => invalidateAll(qc),
  });
}

/* ─── Set priority ─────────────────────────────────────────────────── */

interface BulkPriorityVars {
  ticketIds: string[];
  priority: TicketPriority;
}

export function useBulkPriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketIds, priority }: BulkPriorityVars) =>
      bulkPriorityTickets(ticketIds, priority),
    onMutate: async ({ ticketIds, priority }) => {
      await qc.cancelQueries({ queryKey: ['tickets-revamp'] });
      const ids = new Set(ticketIds);
      const snapshot = patchAndSnapshot(qc, ids, t => ({ ...t, priority }));
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) restoreSnapshot(qc, context.snapshot);
    },
    onSettled: () => invalidateAll(qc),
  });
}

/* ─── Transfer to team ─────────────────────────────────────────────── */

interface BulkTransferVars {
  ticketIds: string[];
  newTeamId: string;
  assigneeId?: string;
}

export function useBulkTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketIds, newTeamId, assigneeId }: BulkTransferVars) =>
      bulkTransferTickets(ticketIds, newTeamId, assigneeId),
    // No optimistic patch — needs the new TeamRef which we'd have to look up.
    onSettled: () => invalidateAll(qc),
  });
}
