import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Clock3, Copy } from 'lucide-react';
import {
  addTicketMessage,
  ApiError,
  assignTicket,
  downloadAttachment,
  followTicket,
  fetchTeamMembers,
  fetchTicketById,
  fetchTicketEvents,
  fetchTicketMessages,
  sendTicketTypingSignal,
  transitionTicket,
  transferTicket,
  unfollowTicket,
  uploadTicketAttachment,
  type TeamMember,
  type TeamRef,
  type TicketDetail,
  type TicketEvent,
  type TicketMessage,
} from '../api/client';
import { TicketConversation } from '../components/ticket-detail/TicketConversation';
import { TicketTimeline } from '../components/ticket-detail/TicketTimeline';
import { TicketSidebar, type ExpandedSections } from '../components/ticket-detail/TicketSidebar';
import {
  formatChannel,
  formatPriority,
  priorityBadgeClass,
  statusBadgeClass,
} from '../components/ticket-detail/utils';
import { TopBar } from '../components/TopBar';
import { TicketDetailSkeleton } from '../components/skeletons';
import { useHeaderContext } from '../contexts/HeaderContext';
import { useTicketDataInvalidation } from '../contexts/TicketDataInvalidationContext';
import { handleApiError } from '../utils/handleApiError';
import type { Role } from '../types';
import { copyToClipboard } from '../utils/clipboard';
import { formatStatus, formatTicketId } from '../utils/format';
import { RelativeTime } from '../components/RelativeTime';
import {
  REALTIME_TICKET_CHANGED_EVENT,
  REALTIME_TICKET_TYPING_EVENT,
  type RealtimeTicketChangedEventPayload,
  type RealtimeTicketTypingEventPayload,
  type RealtimeTicketMessagePayload,
} from '../realtime/events';

type TypingUserEntry = {
  id: string;
  displayName: string;
  email: string;
  expiresAt: number;
};

export function TicketDetailPage({
  currentEmail,
  role,
  teamsList,
}: {
  currentEmail: string;
  role: Role;
  teamsList: TeamRef[];
}) {
  const headerCtx = useHeaderContext();
  const { ticketId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  /* ——— State ——— */

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [eventCursor, setEventCursor] = useState<string | null>(null);
  const [eventsHasMore, setEventsHasMore] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const [activeTab, setActiveTab] = useState<'conversation' | 'timeline'>('conversation');
  const [messageType, setMessageType] = useState<'PUBLIC' | 'INTERNAL'>('PUBLIC');
  const [messageBody, setMessageBody] = useState('');
  const [messageSending, setMessageSending] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [followLoading, setFollowLoading] = useState(false);

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [assignToId, setAssignToId] = useState('');
  const [nextStatus, setNextStatus] = useState('');
  const [transferTeamId, setTransferTeamId] = useState('');
  const [transferAssigneeId, setTransferAssigneeId] = useState('');
  const [transferMembers, setTransferMembers] = useState<TeamMember[]>([]);

  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);

  const [copyToast, setCopyToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>({
    edit: true,
    followers: false,
    additional: false,
    history: false,
  });
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [typingUsersById, setTypingUsersById] = useState<Record<string, TypingUserEntry>>({});

  /* ——— Refs ——— */

  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const conversationListRef = useRef<HTMLDivElement | null>(null);
  const statusSelectRef = useRef<HTMLSelectElement | null>(null);
  const activeTicketIdRef = useRef<string | null>(null);
  const detailRequestSeqRef = useRef(0);
  const messageRequestSeqRef = useRef(0);
  const eventRequestSeqRef = useRef(0);
  const typingIdleTimerRef = useRef<number | null>(null);
  const localTypingActiveRef = useRef(false);
  const lastTypingEmitAtRef = useRef(0);
  const ticketSnapshotRef = useRef<TicketDetail | null>(null);
  const lastTicketUpdateAtMsRef = useRef(0);
  const seenRealtimeMessageIdsRef = useRef<Set<string>>(new Set());
  const seenRealtimeEventIdsRef = useRef<Set<string>>(new Set());
  const lastTypingOccurredAtByActorRef = useRef<Record<string, number>>({});

  const { notifyTicketAggregatesChanged, notifyTicketReportsChanged } = useTicketDataInvalidation();

  /* ——— Derived / memoized values (6.3) ——— */

  const followers = ticket?.followers ?? [];
  const statusEvents = useMemo(
    () =>
      events
        .filter((event) => event.type === 'TICKET_STATUS_CHANGED')
        .slice()
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
        )
        .slice(0, 5),
    [events],
  );
  const isFollowing = followers.some((f) => f.user.email === currentEmail);
  const isCurrentUserOnAssignedTeam = useMemo(
    () => teamMembers.some((m) => m.user.email === currentEmail),
    [teamMembers, currentEmail],
  );

  const canManage = useMemo(() => {
    if (!ticket) return false;
    if (role === 'OWNER') return true;
    if (role === 'EMPLOYEE') return false;
    if (role === 'LEAD' || role === 'TEAM_ADMIN') return isCurrentUserOnAssignedTeam;
    const isAssignee = ticket.assignee?.email === currentEmail;
    return isCurrentUserOnAssignedTeam && (isAssignee || !ticket.assignee);
  }, [currentEmail, isCurrentUserOnAssignedTeam, role, ticket]);

  const canUpload = ticket ? role !== 'EMPLOYEE' || ticket.requester?.email === currentEmail : false;

  const availableTransitions = useMemo(
    () => ticket?.allowedTransitions ?? [],
    [ticket?.allowedTransitions],
  );

  const quickEscalationTarget = useMemo(() => {
    if (availableTransitions.includes('WAITING_ON_VENDOR')) return 'WAITING_ON_VENDOR';
    if (availableTransitions.includes('TRIAGED')) return 'TRIAGED';
    return null;
  }, [availableTransitions]);
  const typingUsers = useMemo(
    () =>
      Object.values(typingUsersById)
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
        .map(({ id, displayName, email }) => ({ id, displayName, email })),
    [typingUsersById],
  );

  const headerTitle = headerCtx?.title ?? 'Ticket details';
  const currentUserId = headerCtx?.currentUser?.id ?? null;

  useEffect(() => {
    ticketSnapshotRef.current = ticket;
    if (!ticket?.updatedAt) {
      return;
    }
    const updatedAtMs = Date.parse(ticket.updatedAt);
    if (Number.isFinite(updatedAtMs) && updatedAtMs > lastTicketUpdateAtMsRef.current) {
      lastTicketUpdateAtMsRef.current = updatedAtMs;
    }
  }, [ticket]);

  /* ——— Navigation (memoized, 6.3) ——— */

  const navigateBack = useCallback(() => {
    const fromTicketsPath = (location.state as { fromTicketsPath?: string } | null)?.fromTicketsPath;
    if (fromTicketsPath) { navigate(fromTicketsPath); return; }
    const historyState = window.history.state as { idx?: number } | null;
    if (typeof historyState?.idx === 'number' && historyState.idx > 0) { navigate(-1); return; }
    navigate('/tickets');
  }, [location.state, navigate]);

  const toTicketMessage = useCallback(
    (payload: RealtimeTicketMessagePayload): TicketMessage => ({
      id: payload.id,
      body: payload.body,
      type: payload.type,
      createdAt: payload.createdAt,
      author: {
        id: payload.author.id,
        email: payload.author.email,
        displayName: payload.author.displayName,
      },
    }),
    [],
  );

  const appendRealtimeMessage = useCallback(
    (payload: RealtimeTicketMessagePayload) => {
      const incoming = toTicketMessage(payload);
      if (seenRealtimeMessageIdsRef.current.has(incoming.id)) {
        return false;
      }
      let appended = false;
      setMessages((prev) => {
        if (prev.some((message) => message.id === incoming.id)) {
          return prev;
        }
        appended = true;
        return [...prev, incoming].sort(
          (left, right) =>
            new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
        );
      });
      if (appended) {
        seenRealtimeMessageIdsRef.current.add(incoming.id);
      }
      return appended;
    },
    [toTicketMessage],
  );

  const appendRealtimeEvent = useCallback(
    (event: TicketEvent) => {
      if (seenRealtimeEventIdsRef.current.has(event.id)) {
        return false;
      }
      let appended = false;
      setEvents((prev) => {
        if (prev.some((existing) => existing.id === event.id)) {
          return prev;
        }
        appended = true;
        return [...prev, event].sort(
          (left, right) =>
            new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
        );
      });
      if (appended) {
        seenRealtimeEventIdsRef.current.add(event.id);
      }
      return appended;
    },
    [],
  );

  const applyTicketRealtimePatch = useCallback(
    (payload: RealtimeTicketChangedEventPayload) => {
      let patched = false;
      setTicket((prev) => {
        if (!prev || !payload.ticketId || prev.id !== payload.ticketId) {
          return prev;
        }

        const next = { ...prev };
        if (payload.status && payload.status !== next.status) {
          next.status = payload.status as TicketDetail['status'];
          patched = true;
        }
        if (payload.priority && payload.priority !== next.priority) {
          next.priority = payload.priority as TicketDetail['priority'];
          patched = true;
        }
        if (payload.updatedAt && payload.updatedAt !== next.updatedAt) {
          next.updatedAt = payload.updatedAt;
          patched = true;
        }
        if (payload.assignee && payload.assignee.id !== next.assignee?.id) {
          next.assignee = payload.assignee;
          patched = true;
        } else if (
          payload.assigneeId === null &&
          next.assignee !== null
        ) {
          next.assignee = null;
          patched = true;
        }
        if (
          payload.assignedTeam &&
          payload.assignedTeam.id !== next.assignedTeam?.id
        ) {
          next.assignedTeam = payload.assignedTeam;
          patched = true;
        } else if (
          payload.assignedTeamId === null &&
          next.assignedTeam !== null
        ) {
          next.assignedTeam = null;
          patched = true;
        }
        if (
          typeof payload.followerCount === 'number' &&
          next.followers.length > payload.followerCount
        ) {
          next.followers = next.followers.slice(0, payload.followerCount);
          patched = true;
        }

        return patched ? next : prev;
      });
      return patched;
    },
    [],
  );

  const clearTypingIdleTimer = useCallback(() => {
    if (!typingIdleTimerRef.current) {
      return;
    }
    window.clearTimeout(typingIdleTimerRef.current);
    typingIdleTimerRef.current = null;
  }, []);

  const publishTypingSignal = useCallback((id: string, isTyping: boolean) => {
    void sendTicketTypingSignal(id, { isTyping }).catch(() => {
      // Typing indicator failures should not block message composition.
    });
  }, []);

  const setLocalTypingState = useCallback(
    (
      isTyping: boolean,
      targetTicketId?: string | null,
      forceEmit = false,
    ) => {
      const id = targetTicketId ?? ticketId;
      if (!id) {
        return;
      }
      if (!forceEmit && localTypingActiveRef.current === isTyping) {
        return;
      }
      localTypingActiveRef.current = isTyping;
      publishTypingSignal(id, isTyping);
      if (isTyping) {
        lastTypingEmitAtRef.current = Date.now();
      } else {
        lastTypingEmitAtRef.current = 0;
      }
    },
    [ticketId, publishTypingSignal],
  );

  const stopTyping = useCallback(
    (targetTicketId?: string | null) => {
      clearTypingIdleTimer();
      setLocalTypingState(false, targetTicketId ?? ticketId);
    },
    [clearTypingIdleTimer, setLocalTypingState, ticketId],
  );

  const markTypingActivity = useCallback(() => {
    if (!ticketId) {
      return;
    }
    const now = Date.now();
    const shouldEmitHeartbeat =
      !localTypingActiveRef.current || now - lastTypingEmitAtRef.current >= 1500;
    setLocalTypingState(true, ticketId, shouldEmitHeartbeat);
    clearTypingIdleTimer();
    typingIdleTimerRef.current = window.setTimeout(() => {
      setLocalTypingState(false, ticketId);
    }, 3500);
  }, [ticketId, clearTypingIdleTimer, setLocalTypingState]);

  /* ——— Data loaders ——— */

  const loadMessagesPage = useCallback(async (id: string, reset = false, clearOnReset = true) => {
    const requestSeq = ++messageRequestSeqRef.current;
    if (reset) {
      if (clearOnReset) {
        setMessages([]);
        seenRealtimeMessageIdsRef.current.clear();
      }
      setMessageCursor(null);
      setMessagesHasMore(false);
    }
    setMessagesLoading(true);
    try {
      const response = await fetchTicketMessages(id, {
        cursor: reset ? undefined : messageCursor ?? undefined, take: 50,
      });
      if (messageRequestSeqRef.current !== requestSeq) return;
      setMessages((prev) => (reset ? response.data : [...response.data, ...prev]));
      for (const message of response.data) {
        seenRealtimeMessageIdsRef.current.add(message.id);
      }
      setMessageCursor(response.nextCursor ?? null);
      setMessagesHasMore(Boolean(response.nextCursor));
    } catch {
      if (messageRequestSeqRef.current === requestSeq && reset && clearOnReset) {
        setMessages([]);
        setMessagesHasMore(false);
        seenRealtimeMessageIdsRef.current.clear();
      }
    } finally {
      if (messageRequestSeqRef.current === requestSeq) setMessagesLoading(false);
    }
  }, [messageCursor]);

  const loadEventsPage = useCallback(
    async (id: string, reset = false, clearOnReset = true) => {
      const requestSeq = ++eventRequestSeqRef.current;
      if (reset) {
        if (clearOnReset) {
          setEvents([]);
          seenRealtimeEventIdsRef.current.clear();
        }
        setEventCursor(null);
        setEventsHasMore(false);
      }
      setEventsLoading(true);
      try {
        const response = await fetchTicketEvents(id, {
          cursor: reset ? undefined : eventCursor ?? undefined, take: 50,
        });
        if (eventRequestSeqRef.current !== requestSeq) return;
        setEvents((prev) => {
          const merged = reset ? response.data : [...response.data, ...prev];
          return merged;
        });
        for (const event of response.data) {
          seenRealtimeEventIdsRef.current.add(event.id);
        }
        setEventCursor(response.nextCursor ?? null);
        setEventsHasMore(Boolean(response.nextCursor));
      } catch {
        if (eventRequestSeqRef.current === requestSeq && reset && clearOnReset) {
          setEvents([]);
          setEventsHasMore(false);
          seenRealtimeEventIdsRef.current.clear();
        }
      } finally {
        if (eventRequestSeqRef.current === requestSeq) setEventsLoading(false);
      }
    },
    [eventCursor],
  );

  const loadTicketDetail = useCallback(async (id: string) => {
    const requestSeq = ++detailRequestSeqRef.current;
    const isNewTicket = activeTicketIdRef.current !== null && activeTicketIdRef.current !== id;
    activeTicketIdRef.current = id;

    setLoadingDetail(true);
    setTicketError(null);
    setAccessDenied(false);
    if (isNewTicket) {
      setTicket(null); setMessages([]); setEvents([]);
      setMessageCursor(null); setEventCursor(null);
      setMessagesHasMore(false); setEventsHasMore(false);
      seenRealtimeMessageIdsRef.current.clear();
      seenRealtimeEventIdsRef.current.clear();
      lastTicketUpdateAtMsRef.current = 0;
    }
    try {
      const detail = await fetchTicketById(id);
      if (detailRequestSeqRef.current !== requestSeq) return;
      setTicket(detail);
      await Promise.all([loadMessagesPage(id, true), loadEventsPage(id, true)]);
    } catch (error) {
      if (detailRequestSeqRef.current !== requestSeq) return;
      if (error instanceof ApiError && error.status === 403) {
        setAccessDenied(true);
        setTicketError('You do not have access to this ticket.');
      } else {
        setTicketError(handleApiError(error));
      }
      if (isNewTicket) setTicket(null);
    } finally {
      if (detailRequestSeqRef.current === requestSeq) setLoadingDetail(false);
    }
  }, [loadMessagesPage, loadEventsPage]);

  const refreshAfterMutation = useCallback(async (id: string, options?: { reloadEvents?: boolean }) => {
    const shouldReloadEvents = options?.reloadEvents ?? false;
    try {
      const [detail] = await Promise.all([
        fetchTicketById(id),
        shouldReloadEvents ? loadEventsPage(id, true) : Promise.resolve(),
      ]);
      setTicket(detail);
    } catch { /* optimistic update is already applied */ }
  }, [loadEventsPage]);

  /* ——— Effects ——— */

  useEffect(() => {
    if (ticketId) void loadTicketDetail(ticketId);
  }, [ticketId]);

  useEffect(() => {
    if (!ticketId) {
      return;
    }

    const handleRealtimeTicketChanged = (event: Event) => {
      const customEvent = event as CustomEvent<RealtimeTicketChangedEventPayload>;
      const payload = customEvent.detail;
      if (!payload || payload.ticketId !== ticketId) {
        return;
      }

      const incomingUpdatedAtMs = Number.isFinite(Date.parse(payload.updatedAt ?? ''))
        ? Date.parse(payload.updatedAt ?? '')
        : null;
      if (
        incomingUpdatedAtMs !== null &&
        incomingUpdatedAtMs < lastTicketUpdateAtMsRef.current
      ) {
        return;
      }
      if (incomingUpdatedAtMs !== null) {
        lastTicketUpdateAtMsRef.current = Math.max(
          lastTicketUpdateAtMsRef.current,
          incomingUpdatedAtMs,
        );
      }

      const occurredAtIso = payload.occurredAt ?? new Date().toISOString();
      const ticketSnapshot = ticketSnapshotRef.current;
      const actorForEvent = payload.actor
        ? {
          id: payload.actor.id,
          email: payload.actor.email,
          displayName: payload.actor.displayName,
        }
        : null;

      // Keep conversation stream and timeline in sync for this specific ticket.
      if (payload.reason === 'message_added') {
        // Skip self-authored message events: the local optimistic/send flow already updated UI.
        if (payload.actorId && currentUserId && payload.actorId === currentUserId) {
          return;
        }

        if (payload.message) {
          const appended = appendRealtimeMessage(payload.message);
          if (appended) {
            appendRealtimeEvent({
              id: `rt:msg:${payload.message.id}`,
              type: 'MESSAGE_ADDED',
              createdAt: payload.message.createdAt || occurredAtIso,
              payload: {
                type: payload.message.type,
                messageId: payload.message.id,
              },
              createdBy: {
                id: payload.message.author.id,
                email: payload.message.author.email,
                displayName: payload.message.author.displayName,
              },
            });
          }
          return;
        }

        // Fallback for message events without inlined payload data.
        void loadMessagesPage(ticketId, true, false);
        if (activeTab === 'timeline') {
          void loadEventsPage(ticketId, true, false);
        }
        return;
      }

      const shouldPatchInPlace =
        payload.reason === 'attachment_added' ||
        payload.reason === 'attachment_scan_status_changed' ||
        payload.reason === 'followers_changed' ||
        payload.reason === 'status_changed' ||
        payload.reason === 'assigned' ||
        payload.reason === 'transferred' ||
        payload.reason === 'priority_changed' ||
        payload.reason === 'ticket_created' ||
        payload.reason === 'automation_rule_executed';

      if (!shouldPatchInPlace) {
        return;
      }

      const patched = applyTicketRealtimePatch(payload);

      if (payload.reason === 'ticket_created') {
        appendRealtimeEvent({
          id: `rt:create:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
          type: 'TICKET_CREATED',
          createdAt: occurredAtIso,
          payload: null,
          createdBy: actorForEvent,
        });
      }

      if (
        payload.reason === 'status_changed' &&
        ticketSnapshot?.status &&
        payload.status &&
        ticketSnapshot.status !== payload.status
      ) {
        appendRealtimeEvent({
          id: `rt:status:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
          type: 'TICKET_STATUS_CHANGED',
          createdAt: occurredAtIso,
          payload: {
            from: ticketSnapshot.status,
            to: payload.status,
          },
          createdBy: actorForEvent,
        });
      }

      if (payload.reason === 'assigned') {
        appendRealtimeEvent({
          id: `rt:assign:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
          type: 'TICKET_ASSIGNED',
          createdAt: occurredAtIso,
          payload: {
            assigneeId: payload.assigneeId ?? null,
            assigneeName: payload.assignee?.displayName ?? null,
            assigneeEmail: payload.assignee?.email ?? null,
          },
          createdBy: actorForEvent,
        });
        if (
          ticketSnapshot?.status &&
          payload.status &&
          ticketSnapshot.status !== payload.status
        ) {
          appendRealtimeEvent({
            id: `rt:assign-status:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
            type: 'TICKET_STATUS_CHANGED',
            createdAt: occurredAtIso,
            payload: {
              from: ticketSnapshot.status,
              to: payload.status,
            },
            createdBy: actorForEvent,
          });
        }
      }

      if (payload.reason === 'transferred') {
        appendRealtimeEvent({
          id: `rt:transfer:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
          type: 'TICKET_TRANSFERRED',
          createdAt: occurredAtIso,
          payload: {
            fromTeamId: ticketSnapshot?.assignedTeam?.id ?? null,
            toTeamId: payload.assignedTeamId ?? null,
            toTeamName: payload.assignedTeam?.name ?? null,
            assigneeId: payload.assigneeId ?? null,
          },
          createdBy: actorForEvent,
        });
        if (
          ticketSnapshot?.status &&
          payload.status &&
          ticketSnapshot.status !== payload.status
        ) {
          appendRealtimeEvent({
            id: `rt:transfer-status:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
            type: 'TICKET_STATUS_CHANGED',
            createdAt: occurredAtIso,
            payload: {
              from: ticketSnapshot.status,
              to: payload.status,
            },
            createdBy: actorForEvent,
          });
        }
      }

      if (
        payload.reason === 'priority_changed' &&
        ticketSnapshot?.priority &&
        payload.priority &&
        ticketSnapshot.priority !== payload.priority
      ) {
        appendRealtimeEvent({
          id: `rt:priority:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
          type: 'TICKET_PRIORITY_CHANGED',
          createdAt: occurredAtIso,
          payload: {
            from: ticketSnapshot.priority,
            to: payload.priority,
          },
          createdBy: actorForEvent,
        });
      }

      if (payload.reason === 'attachment_added') {
        appendRealtimeEvent({
          id: `rt:attachment:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
          type: 'ATTACHMENT_ADDED',
          createdAt: occurredAtIso,
          payload: {},
          createdBy: actorForEvent,
        });
      }

      if (payload.reason === 'attachment_scan_status_changed') {
        appendRealtimeEvent({
          id: `rt:attachment-scan:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
          type: 'ATTACHMENT_SCAN_STATUS_CHANGED',
          createdAt: occurredAtIso,
          payload: {},
          createdBy: actorForEvent,
        });
      }

      const requiresDetailHydration =
        payload.reason === 'attachment_added' ||
        payload.reason === 'attachment_scan_status_changed' ||
        payload.reason === 'followers_changed';
      const hasPatchData =
        typeof payload.status === 'string' ||
        typeof payload.priority === 'string' ||
        typeof payload.updatedAt === 'string' ||
        payload.assigneeId !== undefined ||
        payload.assignedTeamId !== undefined ||
        payload.assignee !== undefined ||
        payload.assignedTeam !== undefined;

      if (requiresDetailHydration || (!patched && !hasPatchData)) {
        void refreshAfterMutation(ticketId, {
          reloadEvents: false,
        });
      }
    };

    window.addEventListener(
      REALTIME_TICKET_CHANGED_EVENT,
      handleRealtimeTicketChanged as EventListener,
    );

    return () => {
      window.removeEventListener(
        REALTIME_TICKET_CHANGED_EVENT,
        handleRealtimeTicketChanged as EventListener,
      );
    };
  }, [
    ticketId,
    appendRealtimeMessage,
    appendRealtimeEvent,
    applyTicketRealtimePatch,
    activeTab,
    loadEventsPage,
    loadMessagesPage,
    refreshAfterMutation,
    currentUserId,
  ]);

  useEffect(() => {
    if (!ticketId) {
      return;
    }

    const handleRealtimeTicketTyping = (event: Event) => {
      const customEvent = event as CustomEvent<RealtimeTicketTypingEventPayload>;
      const payload = customEvent.detail;
      if (!payload || payload.ticketId !== ticketId) {
        return;
      }

      const actorId = payload.actorId?.trim();
      if (!actorId) {
        return;
      }
      if (currentUserId && actorId === currentUserId) {
        return;
      }

      const occurredAtMs = Number.isFinite(Date.parse(payload.occurredAt ?? ''))
        ? Date.parse(payload.occurredAt ?? '')
        : Date.now();
      const lastOccurredAtMs =
        lastTypingOccurredAtByActorRef.current[actorId] ?? 0;
      if (occurredAtMs < lastOccurredAtMs) {
        return;
      }
      lastTypingOccurredAtByActorRef.current[actorId] = occurredAtMs;

      setTypingUsersById((prev) => {
        const existing = prev[actorId];
        if (!payload.isTyping) {
          if (!existing) {
            return prev;
          }
          const next = { ...prev };
          delete next[actorId];
          return next;
        }

        const nextDisplayName =
          payload.actorDisplayName || payload.actorEmail || existing?.displayName || 'Someone';
        const nextEmail = payload.actorEmail || existing?.email || '';
        return {
          ...prev,
          [actorId]: {
            id: actorId,
            displayName: nextDisplayName,
            email: nextEmail,
            expiresAt: Date.now() + 7000,
          },
        };
      });
    };

    window.addEventListener(
      REALTIME_TICKET_TYPING_EVENT,
      handleRealtimeTicketTyping as EventListener,
    );

    return () => {
      window.removeEventListener(
        REALTIME_TICKET_TYPING_EVENT,
        handleRealtimeTicketTyping as EventListener,
      );
    };
  }, [ticketId, currentUserId]);

  useEffect(() => {
    if (!ticket?.assignedTeam?.id) { setTeamMembers([]); return; }
    setTeamMembers([]);
    setMembersLoading(true);
    fetchTeamMembers(ticket.assignedTeam.id)
      .then((r) => setTeamMembers(r.data))
      .catch(() => setTeamMembers([]))
      .finally(() => setMembersLoading(false));
  }, [ticket?.assignedTeam?.id]);

  useEffect(() => {
    if (!transferTeamId) { setTransferMembers([]); setTransferAssigneeId(''); return; }
    setTransferAssigneeId('');
    fetchTeamMembers(transferTeamId)
      .then((r) => setTransferMembers(r.data))
      .catch(() => setTransferMembers([]));
  }, [transferTeamId]);

  useEffect(() => {
    if (!ticket) return;
    setNextStatus(availableTransitions[0] ?? '');
    setAssignToId('');
    setTransferTeamId('');
    setTransferAssigneeId('');
  }, [ticket?.id, ticket?.status, availableTransitions]);

  // Scroll management for conversation
  useEffect(() => {
    if (activeTab !== 'conversation') return;
    const el = conversationListRef.current;
    if (!el) return;
    const onScroll = () => setShowJumpToLatest(el.scrollHeight - el.scrollTop - el.clientHeight > 250);
    el.addEventListener('scroll', onScroll);
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [activeTab, ticket?.id]);

  useEffect(() => {
    if (activeTab !== 'conversation') return;
    const el = conversationListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ticket?.id, activeTab]);

  useEffect(() => {
    if (activeTab !== 'conversation') return;
    const el = conversationListRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 180) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeTab]);

  useEffect(() => {
    if (activeTab !== 'conversation') return;
    const el = conversationListRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 180) el.scrollTop = el.scrollHeight;
  }, [typingUsers.length, activeTab]);

  useEffect(() => {
    setTypingUsersById({});
    seenRealtimeMessageIdsRef.current.clear();
    seenRealtimeEventIdsRef.current.clear();
    lastTicketUpdateAtMsRef.current = 0;
    lastTypingOccurredAtByActorRef.current = {};
  }, [ticketId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTypingUsersById((prev) => {
        let changed = false;
        const next: Record<string, TypingUserEntry> = {};
        for (const [id, entry] of Object.entries(prev)) {
          if (entry.expiresAt > now) {
            next[id] = entry;
            continue;
          }
          changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      clearTypingIdleTimer();
      if (!ticketId || !localTypingActiveRef.current) {
        return;
      }
      localTypingActiveRef.current = false;
      publishTypingSignal(ticketId, false);
    };
  }, [ticketId, clearTypingIdleTimer, publishTypingSignal]);

  useEffect(() => {
    if (activeTab === 'conversation') {
      return;
    }
    stopTyping();
  }, [activeTab, stopTyping]);

  useEffect(() => { if (role === 'EMPLOYEE') setMessageType('PUBLIC'); }, [role]);

  useEffect(() => {
    if (!copyToast) return;
    const t = window.setTimeout(() => setCopyToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [copyToast]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (event.key) {
        case 'r': case 'R':
          if (!event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); messageInputRef.current?.focus(); } break;
        case 'a': case 'A':
          if (!event.ctrlKey && !event.metaKey && !event.altKey && canManage && !ticket?.assignee) { event.preventDefault(); void handleAssignSelf(); } break;
        case 's': case 'S':
          if (!event.ctrlKey && !event.metaKey && !event.altKey && canManage) { event.preventDefault(); statusSelectRef.current?.focus(); } break;
        case 'Escape': event.preventDefault(); navigateBack(); break;
      }
    }
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [canManage, navigateBack, ticket?.assignee]);

  /* ——— Event handlers (memoized, 6.3) ——— */

  const handleCopyLink = useCallback(async () => {
    if (!ticketId) return;
    const url = `${window.location.origin}/tickets/${ticketId}`;
    const copied = await copyToClipboard(url);
    setCopyToast({ message: copied ? 'Link copied to clipboard' : 'Could not copy link', type: copied ? 'success' : 'error' });
  }, [ticketId]);

  const handleMessageBodyChange = useCallback(
    (nextBody: string) => {
      setMessageBody(nextBody);
      if (!ticketId) {
        return;
      }
      if (!nextBody.trim()) {
        stopTyping();
        return;
      }
      markTypingActivity();
    },
    [ticketId, stopTyping, markTypingActivity],
  );

  const handleMessageInputBlur = useCallback(() => {
    stopTyping();
  }, [stopTyping]);

  const handleReply = useCallback(async () => {
    const body = messageBody.trim();
    if (!ticketId || !ticket || !body || messageSending) return;
    setTicketError(null);
    stopTyping();
    setMessageSending(true);

    const optimisticId = `opt-${Date.now()}`;
    const optimisticMessage: TicketMessage = {
      id: optimisticId, body, type: messageType, createdAt: new Date().toISOString(),
      author: { id: 'pending', email: currentEmail, displayName: currentEmail.split('@')[0] || 'You' },
    };
    setMessages((prev) => [...prev, optimisticMessage]);
    setMessageBody('');

    try {
      const serverMessage = await addTicketMessage(ticketId, { body, type: messageType });
      setMessages((prev) => prev.map((m) => (m.id === optimisticId ? serverMessage : m)));
      appendRealtimeEvent({
        id: `rt:msg:${serverMessage.id}`,
        type: 'MESSAGE_ADDED',
        createdAt: serverMessage.createdAt,
        payload: {
          type: serverMessage.type,
          messageId: serverMessage.id,
        },
        createdBy: serverMessage.author,
      });
      setCopyToast({ message: messageType === 'INTERNAL' ? 'Internal note added' : 'Reply sent', type: 'success' });
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setTicketError('Unable to send message.');
      setCopyToast({ message: 'Unable to send message.', type: 'error' });
    } finally {
      setMessageSending(false);
    }
  }, [messageBody, ticketId, ticket, messageSending, messageType, currentEmail, appendRealtimeEvent, stopTyping]);

  const handleAssignSelf = useCallback(async () => {
    if (!ticket) return;
    setActionError(null); setActionLoading(true);
    try {
      const updated = await assignTicket(ticket.id, {});
      setTicket((prev) => (prev ? { ...prev, ...updated } : prev));
      void refreshAfterMutation(ticket.id);
      setCopyToast({ message: 'Assigned to you.', type: 'success' });
      notifyTicketAggregatesChanged(); notifyTicketReportsChanged();
    } catch { setActionError('Unable to assign ticket.'); setCopyToast({ message: 'Unable to assign ticket.', type: 'error' }); }
    finally { setActionLoading(false); }
  }, [ticket, refreshAfterMutation, notifyTicketAggregatesChanged, notifyTicketReportsChanged]);

  const handleAssignMember = useCallback(async () => {
    if (!ticket || !assignToId) return;
    setActionError(null); setActionLoading(true);
    try {
      const updated = await assignTicket(ticket.id, { assigneeId: assignToId });
      setTicket((prev) => (prev ? { ...prev, ...updated } : prev));
      void refreshAfterMutation(ticket.id);
      setCopyToast({ message: 'Assignee updated.', type: 'success' });
      notifyTicketAggregatesChanged(); notifyTicketReportsChanged();
    } catch { setActionError('Unable to assign ticket.'); setCopyToast({ message: 'Unable to assign ticket.', type: 'error' }); }
    finally { setActionLoading(false); }
  }, [ticket, assignToId, refreshAfterMutation, notifyTicketAggregatesChanged, notifyTicketReportsChanged]);

  const transitionTo = useCallback(async (targetStatus: string) => {
    if (!ticket || !targetStatus || targetStatus === ticket.status) return;
    const previousStatus = ticket.status;
    setActionError(null); setActionLoading(true);

    // Optimistic update (7.6 fix): update UI immediately, rollback on error
    setTicket((prev) => (prev ? { ...prev, status: targetStatus as TicketDetail['status'] } : prev));
    setCopyToast({ message: `Status updated to ${formatStatus(targetStatus)}.`, type: 'success' });

    try {
      const updated = await transitionTicket(ticket.id, { status: targetStatus });
      setTicket((prev) => (prev ? { ...prev, ...updated } : prev));
      void refreshAfterMutation(ticket.id);
      notifyTicketAggregatesChanged();
      if (targetStatus === 'RESOLVED' || targetStatus === 'CLOSED') notifyTicketReportsChanged();
    } catch {
      // Rollback optimistic update
      setTicket((prev) => (prev ? { ...prev, status: previousStatus } : prev));
      setActionError('Unable to change status.');
      setCopyToast({ message: 'Unable to change status.', type: 'error' });
    } finally { setActionLoading(false); }
  }, [ticket, refreshAfterMutation, notifyTicketAggregatesChanged, notifyTicketReportsChanged]);

  const handleTransition = useCallback(() => transitionTo(nextStatus), [transitionTo, nextStatus]);

  const handleTransfer = useCallback(async () => {
    if (!ticket || !transferTeamId) return;
    setActionError(null); setActionLoading(true);
    try {
      const updated = await transferTicket(ticket.id, { newTeamId: transferTeamId, assigneeId: transferAssigneeId || undefined });
      setTicket((prev) => (prev ? { ...prev, ...updated } : prev));
      void refreshAfterMutation(ticket.id);
      setCopyToast({ message: 'Ticket transferred.', type: 'success' });
      notifyTicketAggregatesChanged(); notifyTicketReportsChanged();
    } catch { setActionError('Unable to transfer ticket.'); setCopyToast({ message: 'Unable to transfer ticket.', type: 'error' }); }
    finally { setActionLoading(false); }
  }, [ticket, transferTeamId, transferAssigneeId, refreshAfterMutation, notifyTicketAggregatesChanged, notifyTicketReportsChanged]);

  const handleFollowToggle = useCallback(async () => {
    if (!ticket) return;
    setFollowError(null); setFollowLoading(true);
    try {
      if (isFollowing) await unfollowTicket(ticket.id); else await followTicket(ticket.id);
      void refreshAfterMutation(ticket.id);
      setCopyToast({ message: isFollowing ? 'Unfollowed ticket.' : 'Following ticket.', type: 'success' });
    } catch { setFollowError('Unable to update followers.'); setCopyToast({ message: 'Unable to update followers.', type: 'error' }); }
    finally { setFollowLoading(false); }
  }, [ticket, isFollowing, refreshAfterMutation]);

  const handleAttachmentUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    if (!ticketId) return;
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setAttachmentError(null); setAttachmentUploading(true);
    try {
      for (const file of Array.from(files)) await uploadTicketAttachment(ticketId, file);
      void refreshAfterMutation(ticketId);
      setCopyToast({ message: 'Attachment uploaded.', type: 'success' });
    } catch { setAttachmentError('Unable to upload attachment.'); setCopyToast({ message: 'Unable to upload attachment.', type: 'error' }); }
    finally { setAttachmentUploading(false); event.target.value = ''; }
  }, [ticketId, refreshAfterMutation]);

  const handleAttachmentDownload = useCallback(async (attachmentId: string, fileName: string) => {
    setAttachmentError(null);
    try {
      const blob = await downloadAttachment(attachmentId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = fileName;
      document.body.appendChild(link); link.click(); link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to download attachment.';
      setAttachmentError(message || 'Unable to download attachment.');
    }
  }, []);

  const handleAttachmentView = useCallback(async (attachmentId: string) => {
    setAttachmentError(null);
    try {
      const blob = await downloadAttachment(attachmentId);
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open attachment.';
      setAttachmentError(message || 'Unable to open attachment.');
    }
  }, []);

  const toggleSection = useCallback((section: keyof ExpandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const scrollToLatest = useCallback(() => {
    conversationListRef.current?.scrollTo({ top: conversationListRef.current.scrollHeight, behavior: 'smooth' });
  }, []);

  const conversationCount = messages.length;
  const timelineCount = events.length;

  /* ——— Render ——— */

  return (
    <section className="flex h-screen flex-col bg-white animate-fade-in" title={headerTitle}>
      {/* Toast notification */}
      {copyToast && (
        <div className="fixed right-4 top-4 z-50">
          <div
            className={`flex items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-lg ${copyToast.type === 'success' ? 'border-emerald-200 text-slate-900' : 'border-rose-200 text-rose-700'
              }`}
          >
            {copyToast.type === 'success' ? <Check className="h-5 w-5 text-emerald-600" /> : <Clock3 className="h-5 w-5" />}
            <span className="text-sm font-medium">{copyToast.message}</span>
          </div>
        </div>
      )}

      {/* Sticky header */}
      <div className="shrink-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1600px] px-6 py-3">
          <TopBar
            title={headerTitle}
            subtitle={headerCtx?.subtitle ?? 'Review context, collaborate, and update workflow in one workspace.'}
            currentEmail={headerCtx?.currentEmail ?? currentEmail}
            personas={headerCtx?.personas ?? [{ label: currentEmail, email: currentEmail }]}
            onEmailChange={headerCtx?.onEmailChange ?? (() => { })}
            onOpenSearch={headerCtx?.onOpenSearch}
            notificationProps={headerCtx?.notificationProps}
            leftAction={
              <button type="button" onClick={navigateBack} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900">
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            }
            leftContent={
              ticket ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-slate-500">{formatTicketId(ticket)}</span>
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusBadgeClass(ticket.status)}`}>{formatStatus(ticket.status)}</span>
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${priorityBadgeClass(ticket.priority)}`}>{formatPriority(ticket.priority)}</span>
                  <span className="rounded-md bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700">{formatChannel(ticket.channel)}</span>
                </div>
              ) : (
                <div>
                  <h1 className="text-xl font-semibold text-slate-900">Ticket details</h1>
                  <p className="text-sm text-slate-500">Review context, collaborate, and update workflow in one workspace.</p>
                </div>
              )
            }
          />
        </div>

      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {ticketError && <p className="absolute top-20 left-1/2 -translate-x-1/2 z-50 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600 shadow-lg">{ticketError}</p>}
        {accessDenied && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-lg">
            Switch to a user with access, or go back to the ticket list.
          </div>
        )}

        <div className="flex w-full max-w-[1600px] mx-auto min-h-0">
          {/* Left: conversation / timeline panel */}
          <div className="flex flex-1 flex-col border-r border-slate-200 bg-white min-w-0 min-h-0">
            <div className="flex flex-1 flex-col min-h-0">
              {/* Integrated Subject Header */}
              {ticket && (
                <div className="px-6 pt-6 pb-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h1 className="text-xl font-bold text-slate-900 tracking-tight sm:text-2xl">{ticket.subject}</h1>
                      {ticket.description ? (
                        <p className="mt-2 text-[14px] leading-relaxed text-slate-600">{ticket.description}</p>
                      ) : (
                        <p className="mt-2 text-[14px] leading-relaxed text-slate-500 italic">No description provided.</p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-medium text-slate-500">
                        <span>Created <RelativeTime value={ticket.createdAt} /></span>
                        <span className="text-slate-300">•</span>
                        <span>Requester: <span className="font-semibold text-slate-800">{ticket.requester?.displayName ?? ticket.requester?.email ?? 'Unknown'}</span></span>
                        <span className="text-slate-300">•</span>
                        <span>Assignee: <span className="font-semibold text-slate-800">{ticket.assignee?.displayName ?? 'Unassigned'}</span></span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button type="button" onClick={() => void handleCopyLink()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                        <Copy className="h-4 w-4 text-slate-400" /> Copy link
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab bar */}
              <div className="shrink-0 flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-3">
                <div className="flex items-center gap-2" role="tablist" aria-label="Ticket views">
                  <button type="button" role="tab" aria-selected={activeTab === 'conversation'} aria-controls="panel-conversation" onClick={() => setActiveTab('conversation')} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${activeTab === 'conversation' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
                    Conversation <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${activeTab === 'conversation' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{conversationCount}</span>
                  </button>
                  <button type="button" role="tab" aria-selected={activeTab === 'timeline'} aria-controls="panel-timeline" onClick={() => setActiveTab('timeline')} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${activeTab === 'timeline' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
                    Timeline <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${activeTab === 'timeline' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{timelineCount}</span>
                  </button>
                </div>
                <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex" />
              </div>

              {/* Tab content */}
              <div className="relative flex flex-1 flex-col min-h-0 bg-[#fafafa]">
                {loadingDetail && !ticket ? <div className="p-6"><TicketDetailSkeleton count={4} /></div> : null}
                {!loadingDetail && !ticket && !accessDenied ? <p className="p-6 text-sm text-slate-500">Ticket not found.</p> : null}

                {ticket && activeTab === 'conversation' ? (
                  <TicketConversation
                    ticket={ticket}
                    messages={messages}
                    messagesHasMore={messagesHasMore}
                    messagesLoading={messagesLoading}
                    currentEmail={currentEmail}
                    messageType={messageType}
                    setMessageType={setMessageType}
                    messageBody={messageBody}
                    onMessageBodyChange={handleMessageBodyChange}
                    onMessageInputBlur={handleMessageInputBlur}
                    messageSending={messageSending}
                    canManage={canManage}
                    canUpload={canUpload}
                    onReply={() => void handleReply()}
                    onLoadMore={() => ticketId && void loadMessagesPage(ticketId)}
                    onAttachmentUpload={handleAttachmentUpload}
                    onAttachmentDownload={(id, name) => void handleAttachmentDownload(id, name)}
                    onAttachmentView={(id) => void handleAttachmentView(id)}
                    attachmentUploading={attachmentUploading}
                    attachmentError={attachmentError}
                    typingUsers={typingUsers}
                    showJumpToLatest={showJumpToLatest}
                    onScrollToLatest={scrollToLatest}
                    messageInputRef={messageInputRef}
                    attachmentInputRef={attachmentInputRef}
                    conversationListRef={conversationListRef}
                  />
                ) : null}

                {ticket && activeTab === 'timeline' ? (
                  <TicketTimeline
                    events={events}
                    eventsHasMore={eventsHasMore}
                    eventsLoading={eventsLoading}
                    onLoadMore={() => ticketId && void loadEventsPage(ticketId)}
                  />
                ) : null}
              </div>
            </div>
          </div>

          {/* Right: sidebar */}
          {ticket && (
            <div className="w-80 shrink-0 overflow-y-auto bg-slate-50">
              <TicketSidebar
                ticket={ticket}
                canManage={canManage}
                actionError={actionError}
                actionLoading={actionLoading}
                assignToId={assignToId}
                setAssignToId={setAssignToId}
                teamMembers={teamMembers}
                membersLoading={membersLoading}
                onAssignMember={() => void handleAssignMember()}
                onAssignSelf={() => void handleAssignSelf()}
                nextStatus={nextStatus}
                setNextStatus={setNextStatus}
                availableTransitions={availableTransitions}
                statusSelectRef={statusSelectRef}
                onTransition={() => void handleTransition()}
                onTransitionTo={(s) => void transitionTo(s)}
                quickEscalationTarget={quickEscalationTarget}
                transferTeamId={transferTeamId}
                setTransferTeamId={setTransferTeamId}
                transferAssigneeId={transferAssigneeId}
                setTransferAssigneeId={setTransferAssigneeId}
                transferMembers={transferMembers}
                teamsList={teamsList}
                onTransfer={() => void handleTransfer()}
                expandedSections={expandedSections}
                toggleSection={toggleSection}
                loadingDetail={loadingDetail}
                followers={followers}
                isFollowing={isFollowing}
                followLoading={followLoading}
                followError={followError}
                onFollowToggle={() => void handleFollowToggle()}
                statusEvents={statusEvents}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
