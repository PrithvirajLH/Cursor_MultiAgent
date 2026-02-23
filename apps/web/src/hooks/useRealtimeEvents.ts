import { useEffect, useRef } from 'react';
import { negotiateRealtimeConnection } from '../api/client';
import type {
  RealtimeAdminChangedEventPayload,
  RealtimeTicketChangedEventPayload,
  RealtimeTicketTypingEventPayload,
} from '../realtime/events';
import { REALTIME_ADMIN_CHANGED_EVENT } from '../realtime/events';

type RealtimeTicketPayload = RealtimeTicketChangedEventPayload;

type RealtimeNotificationPayload = {
  reason?: string;
  unreadCount?: number;
};

type RealtimeTicketTypingPayload = RealtimeTicketTypingEventPayload;
type RealtimeAdminPayload = RealtimeAdminChangedEventPayload;

type RealtimeEnvelope = {
  event: string;
  occurredAt?: string;
  payload?: unknown;
};

type UseRealtimeEventsOptions = {
  enabled?: boolean;
  userKey?: string;
  onTicketChanged?: (payload: RealtimeTicketPayload) => void;
  onTicketTyping?: (payload: RealtimeTicketTypingPayload) => void;
  onAdminChanged?: (payload: RealtimeAdminPayload) => void;
  onNotificationsUpdated?: (payload: RealtimeNotificationPayload) => void;
};

function parseRealtimeEnvelope(raw: string): RealtimeEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const candidate = parsed as Partial<RealtimeEnvelope>;
  if (typeof candidate.event !== 'string') {
    return null;
  }

  return {
    event: candidate.event,
    occurredAt:
      typeof candidate.occurredAt === 'string' ? candidate.occurredAt : undefined,
    payload: candidate.payload,
  };
}

function toTicketPayload(payload: unknown): RealtimeTicketPayload {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  return payload as RealtimeTicketPayload;
}

function toNotificationPayload(payload: unknown): RealtimeNotificationPayload {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  return payload as RealtimeNotificationPayload;
}

function toTicketTypingPayload(payload: unknown): RealtimeTicketTypingPayload {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  return payload as RealtimeTicketTypingPayload;
}

function toAdminPayload(payload: unknown): RealtimeAdminPayload {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  return payload as RealtimeAdminPayload;
}

export function useRealtimeEvents(options: UseRealtimeEventsOptions) {
  const { enabled = true, userKey } = options;
  const ticketCallbackRef = useRef(options.onTicketChanged);
  const ticketTypingCallbackRef = useRef(options.onTicketTyping);
  const adminCallbackRef = useRef(options.onAdminChanged);
  const notificationCallbackRef = useRef(options.onNotificationsUpdated);

  useEffect(() => {
    ticketCallbackRef.current = options.onTicketChanged;
  }, [options.onTicketChanged]);

  useEffect(() => {
    notificationCallbackRef.current = options.onNotificationsUpdated;
  }, [options.onNotificationsUpdated]);

  useEffect(() => {
    ticketTypingCallbackRef.current = options.onTicketTyping;
  }, [options.onTicketTyping]);

  useEffect(() => {
    adminCallbackRef.current = options.onAdminChanged;
  }, [options.onAdminChanged]);

  useEffect(() => {
    if (!enabled || !userKey) {
      return;
    }

    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (stopped) {
        return;
      }
      reconnectAttempt += 1;
      const delayMs = Math.min(10000, 500 * 2 ** Math.min(reconnectAttempt, 4));
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, delayMs);
    };

    const handleEnvelope = (envelope: RealtimeEnvelope) => {
      if (envelope.event === 'ticket.changed') {
        ticketCallbackRef.current?.({
          ...toTicketPayload(envelope.payload),
          occurredAt: envelope.occurredAt,
        });
        return;
      }

      if (envelope.event === 'ticket.typing') {
        ticketTypingCallbackRef.current?.({
          ...toTicketTypingPayload(envelope.payload),
          occurredAt: envelope.occurredAt,
        });
        return;
      }

      if (envelope.event === 'admin.changed') {
        const payload = {
          ...toAdminPayload(envelope.payload),
          occurredAt: envelope.occurredAt,
        };
        adminCallbackRef.current?.(payload);
        window.dispatchEvent(
          new CustomEvent<RealtimeAdminPayload>(REALTIME_ADMIN_CHANGED_EVENT, {
            detail: payload,
          }),
        );
        return;
      }

      if (envelope.event === 'notifications.updated') {
        notificationCallbackRef.current?.(toNotificationPayload(envelope.payload));
      }
    };

    const connect = async () => {
      clearReconnectTimer();

      let negotiation: Awaited<ReturnType<typeof negotiateRealtimeConnection>>;
      try {
        negotiation = await negotiateRealtimeConnection();
      } catch {
        scheduleReconnect();
        return;
      }

      if (stopped) {
        return;
      }

      if (!negotiation.enabled || !negotiation.url) {
        return;
      }

      socket = new WebSocket(negotiation.url);

      socket.onopen = () => {
        reconnectAttempt = 0;
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') {
          return;
        }
        const envelope = parseRealtimeEnvelope(event.data);
        if (!envelope) {
          return;
        }
        handleEnvelope(envelope);
      };

      socket.onerror = () => {
        // onclose handles retry scheduling
      };

      socket.onclose = () => {
        socket = null;
        scheduleReconnect();
      };
    };

    void connect();

    return () => {
      stopped = true;
      clearReconnectTimer();
      if (socket) {
        socket.close();
        socket = null;
      }
    };
  }, [enabled, userKey]);
}
