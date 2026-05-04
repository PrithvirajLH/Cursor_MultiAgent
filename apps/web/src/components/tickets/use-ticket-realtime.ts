import { useQueryClient } from '@tanstack/react-query';
import { useRealtimeEvents } from '../../hooks/useRealtimeEvents';

interface UseTicketRealtimeOptions {
  /** User identifier for the realtime subscription. Hook is no-op without it. */
  userKey?: string;
  /** Set false to pause subscription (e.g. tab is hidden, user signed out). */
  enabled?: boolean;
}

/**
 * Subscribes to backend `ticket.changed` events and invalidates the
 * tickets-revamp + ticket-counts query caches so the list re-fetches.
 *
 * Independent of App.tsx's own realtime subscription — calling both is
 * safe (two WebSocket connections is cheap relative to the UX win).
 */
export function useTicketRealtime({ userKey, enabled = true }: UseTicketRealtimeOptions) {
  const qc = useQueryClient();

  useRealtimeEvents({
    enabled: enabled && Boolean(userKey),
    userKey,
    onTicketChanged: () => {
      qc.invalidateQueries({ queryKey: ['tickets-revamp'] });
      qc.invalidateQueries({ queryKey: ['ticket-counts'] });
    },
  });
}
