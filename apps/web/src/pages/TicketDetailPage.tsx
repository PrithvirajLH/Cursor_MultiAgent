import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type RichTextEditorRef } from "../components/RichTextEditor";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Clock3, Copy } from "lucide-react";
import {
  addTicketMessage,
  ApiError,
  assignTicket,
  bulkPriorityTickets,
  downloadAttachment,
  fetchCategories,
  followTicket,
  fetchTeamMembers,
  fetchTicketById,
  fetchTicketEvents,
  fetchTicketMessages,
  sendTicketTypingSignal,
  setTicketCategory,
  transitionTicket,
  transferTicket,
  unfollowTicket,
  uploadTicketAttachment,
  type CategoryRef,
  type TeamMember,
  type TeamRef,
  type TicketDetail,
  type TicketEvent,
  type TicketMessage,
  type TicketPriority,
  type TicketStatus,
} from "../api/client";
import { useTicketTabs } from "../contexts/TicketTabsContext";
import { TagChips } from "../components/tags/TagChips";
import { TicketConversation } from "../components/ticket-detail/TicketConversation";
import { TicketTimeline } from "../components/ticket-detail/TicketTimeline";
import { TicketAttachments } from "../components/ticket-detail/TicketAttachments";
import {
  TicketSidebar,
  type ExpandedSections,
} from "../components/ticket-detail/TicketSidebar";
import {
  formatChannel,
  formatPriority,
  priorityBadgeClass,
  statusBadgeClass,
} from "../components/ticket-detail/utils";
import { TopBar } from "../components/TopBar";
import { TicketDetailMidList } from "../components/TicketDetailMidList";
import { TicketDetailSkeleton } from "../components/skeletons";
import { useHeaderContext } from "../contexts/HeaderContext";
import { useTicketDataInvalidation } from "../contexts/TicketDataInvalidationContext";
import { handleApiError } from "../utils/handleApiError";
import type { Role } from "../types";
import { copyToClipboard } from "../utils/clipboard";
import { getUiZoom } from "../utils/uiZoom";
import { formatStatus, formatTicketId } from "../utils/format";
import {
  clearMessageDraft,
  readMessageDraft,
  writeMessageDraft,
} from "../utils/messageDraft";
import { TICKET_DETAIL_LAYOUT_CLASSNAMES } from "./ticket-detail-layout";
import {
  getNextTicketDetailTab,
  getTicketDetailTabAccessibilityState,
  getTicketDetailTabIds,
  getTicketDetailTabPanelClassName,
  type TicketDetailTabId,
} from "./ticket-detail-tabs";
import {
  REALTIME_TICKET_CHANGED_EVENT,
  REALTIME_TICKET_TYPING_EVENT,
  type RealtimeTicketChangedEventPayload,
  type RealtimeTicketTypingEventPayload,
  type RealtimeTicketMessagePayload,
} from "../realtime/events";

/** Strips "Facility: ..." prefix from description so only the message is shown. */
function stripFacilityFromDescription(description: string): string {
  const lines = description.split("\n");
  const firstLine = lines[0] ?? "";
  if (firstLine.startsWith("Facility:")) {
    return lines.slice(2).join("\n").trim();
  }
  return description;
}

/**
 * For AI-generated tickets, extracts only the original user message from the
 * structured description. Handles both formats:
 *   - Agent 4 format: "What: ...\nWho: ...\nOriginal message: <text>"
 *   - buildDescription format: "**What:** ...\n---\n**Original message:**\n<text>"
 * Returns just the original message portion. For non-AI descriptions, returns as-is.
 */
function extractOriginalMessage(description: string): string {
  // Try markdown bold format first
  const mdMarker = "**Original message:**";
  const mdIdx = description.indexOf(mdMarker);
  if (mdIdx !== -1) {
    return description.substring(mdIdx + mdMarker.length).trim();
  }
  // Try plain format from Agent 4
  const plainMarker = "Original message:";
  const plainIdx = description.indexOf(plainMarker);
  if (plainIdx !== -1) {
    return description.substring(plainIdx + plainMarker.length).trim();
  }
  // Check if it starts with "What:" — AI structured description, return as-is but strip metadata
  if (description.match(/^What:/m)) {
    return stripFacilityFromDescription(description);
  }
  return stripFacilityFromDescription(description);
}

type TypingUserEntry = {
  id: string;
  displayName: string;
  email: string;
  expiresAt: number;
};

type ConversationMessage = TicketMessage & {
  localStatus?: "sending" | "sent" | "failed";
};

export function TicketDetailPage({
  currentEmail,
  role,
  teamsList,
  ticketId: ticketIdProp,
  onBack,
  onSelectTicket,
}: {
  currentEmail: string;
  role: Role;
  teamsList: TeamRef[];
  ticketId?: string;
  onBack?: () => void;
  onSelectTicket?: (
    ticket: import("../api/client").TicketRecord,
    opts?: { newTab?: boolean },
  ) => void;
}) {
  const headerCtx = useHeaderContext();
  const { ticketId: ticketIdParam } = useParams();
  const ticketId = ticketIdProp ?? ticketIdParam;
  const location = useLocation();
  const navigate = useNavigate();
  const ticketTabs = useTicketTabs();
  const queryClient = useQueryClient();

  /* ——— State ——— */

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [eventCursor, setEventCursor] = useState<string | null>(null);
  const [eventsHasMore, setEventsHasMore] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const [activeTab, setActiveTab] =
    useState<TicketDetailTabId>("conversation");
  const [messageType, setMessageType] = useState<"PUBLIC" | "INTERNAL">(
    "PUBLIC",
  );
  const [messageBody, setMessageBody] = useState(() =>
    readMessageDraft(ticketId),
  );

  // Standalone /tickets/:id keeps this component mounted across ticket
  // navigation, so reload the draft when ticketId changes.
  useEffect(() => {
    setMessageBody(readMessageDraft(ticketId));
  }, [ticketId]);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [followLoading, setFollowLoading] = useState(false);

  const teamMembersQuery = useQuery({
    queryKey: ["team-members", ticket?.assignedTeam?.id],
    queryFn: () => fetchTeamMembers(ticket!.assignedTeam!.id),
    enabled: !!ticket?.assignedTeam?.id,
    staleTime: 5 * 60_000,
  });
  const teamMembers = useMemo<TeamMember[]>(
    () => teamMembersQuery.data?.data ?? [],
    [teamMembersQuery.data],
  );
  const membersLoading = teamMembersQuery.isLoading;
  const [assignToId, setAssignToId] = useState("");
  const [nextStatus, setNextStatus] = useState("");
  const [transferTeamId, setTransferTeamId] = useState("");
  const [transferAssigneeId, setTransferAssigneeId] = useState("");
  const transferMembersQuery = useQuery({
    queryKey: ["team-members", transferTeamId],
    queryFn: () => fetchTeamMembers(transferTeamId),
    enabled: !!transferTeamId,
    staleTime: 5 * 60_000,
  });
  const transferMembers = useMemo<TeamMember[]>(
    () => transferMembersQuery.data?.data ?? [],
    [transferMembersQuery.data],
  );

  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [categories, setCategories] = useState<CategoryRef[]>([]);

  const [copyToast, setCopyToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [expandedSections, setExpandedSections] = useState<ExpandedSections>({
    edit: true,
    followers: false,
    additional: false,
    history: false,
  });
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [typingUsersById, setTypingUsersById] = useState<
    Record<string, TypingUserEntry>
  >({});

  // Categories for the editable Category dropdown in the sidebar.
  useEffect(() => {
    let cancelled = false;
    fetchCategories()
      .then((res) => {
        if (!cancelled) setCategories(res.data);
      })
      .catch(() => {
        /* non-fatal: category editor falls back to read-only */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ——— Refs ——— */

  const messageInputRef = useRef<RichTextEditorRef | null>(null);
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
  const hasInitialConversationScrollRef = useRef(false);
  const tabsContainerRef = useRef<HTMLDivElement | null>(null);
  const conversationTabRef = useRef<HTMLButtonElement | null>(null);
  const timelineTabRef = useRef<HTMLButtonElement | null>(null);
  const attachmentsTabRef = useRef<HTMLButtonElement | null>(null);

  const { notifyTicketAggregatesChanged, notifyTicketReportsChanged } =
    useTicketDataInvalidation();

  /* ——— Register ticket in tab bar ——— */
  useEffect(() => {
    if (ticket && ticketId) {
      ticketTabs.openTab({
        id: ticket.id,
        displayId: ticket.displayId ?? `#${ticket.number}`,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, ticket?.subject, ticket?.status, ticket?.priority]);

  // Sync active tab when navigating to this ticket
  useEffect(() => {
    if (ticketId && ticketTabs.activeTabId !== ticketId) {
      ticketTabs.setActiveTabId(ticketId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  /* ——— Derived / memoized values (6.3) ——— */

  const followers = ticket?.followers ?? [];
  const statusEvents = useMemo(
    () =>
      events
        .filter((event) => event.type === "TICKET_STATUS_CHANGED")
        .slice()
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime(),
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
    if (role === "OWNER") return true;
    if (role === "EMPLOYEE") return false;
    if (role === "LEAD" || role === "TEAM_ADMIN")
      return isCurrentUserOnAssignedTeam;
    const isAssignee = ticket.assignee?.email === currentEmail;
    return isCurrentUserOnAssignedTeam && (isAssignee || !ticket.assignee);
  }, [currentEmail, isCurrentUserOnAssignedTeam, role, ticket]);

  // Peer agent: same team, not the assignee. Can read + post INTERNAL notes only.
  const isPeerAgent = useMemo(() => {
    if (!ticket) return false;
    if (role !== "AGENT") return false;
    if (!isCurrentUserOnAssignedTeam) return false;
    if (!ticket.assignee) return false; // unassigned tickets are open to any agent
    return ticket.assignee.email !== currentEmail;
  }, [currentEmail, isCurrentUserOnAssignedTeam, role, ticket]);

  const canUpload = ticket
    ? role !== "EMPLOYEE" || ticket.requester?.email === currentEmail
    : false;

  const availableTransitions = useMemo(
    () => ticket?.allowedTransitions ?? [],
    [ticket?.allowedTransitions],
  );

  const quickEscalationTarget = useMemo(() => {
    if (availableTransitions.includes("WAITING_ON_VENDOR"))
      return "WAITING_ON_VENDOR";
    if (availableTransitions.includes("TRIAGED")) return "TRIAGED";
    return null;
  }, [availableTransitions]);
  const typingUsers = useMemo(
    () =>
      Object.values(typingUsersById)
        .sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        )
        .map(({ id, displayName, email }) => ({ id, displayName, email })),
    [typingUsersById],
  );

  const headerTitle = headerCtx?.title ?? "Ticket details";
  const currentUserId = headerCtx?.currentUser?.id ?? null;

  const [tabIndicator, setTabIndicator] = useState<{
    left: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    ticketSnapshotRef.current = ticket;
    if (!ticket?.updatedAt) {
      return;
    }
    const updatedAtMs = Date.parse(ticket.updatedAt);
    if (
      Number.isFinite(updatedAtMs) &&
      updatedAtMs > lastTicketUpdateAtMsRef.current
    ) {
      lastTicketUpdateAtMsRef.current = updatedAtMs;
    }
  }, [ticket]);

  /* ——— Navigation (memoized, 6.3) ——— */

  const navigateBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    const fromTicketsPath = (
      location.state as { fromTicketsPath?: string } | null
    )?.fromTicketsPath;
    if (fromTicketsPath) {
      navigate(fromTicketsPath);
      return;
    }
    const historyState = window.history.state as { idx?: number } | null;
    if (typeof historyState?.idx === "number" && historyState.idx > 0) {
      navigate(-1);
      return;
    }
    navigate("/tickets");
  }, [onBack, location.state, navigate]);

  const toTicketMessage = useCallback(
    (payload: RealtimeTicketMessagePayload): ConversationMessage => ({
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
            new Date(left.createdAt).getTime() -
            new Date(right.createdAt).getTime(),
        );
      });
      if (appended) {
        seenRealtimeMessageIdsRef.current.add(incoming.id);
      }
      return appended;
    },
    [toTicketMessage],
  );

  const appendRealtimeEvent = useCallback((event: TicketEvent) => {
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
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime(),
      );
    });
    if (appended) {
      seenRealtimeEventIdsRef.current.add(event.id);
    }
    return appended;
  }, []);

  const applyTicketRealtimePatch = useCallback(
    (payload: RealtimeTicketChangedEventPayload) => {
      let patched = false;
      setTicket((prev) => {
        if (!prev || !payload.ticketId || prev.id !== payload.ticketId) {
          return prev;
        }

        const next = { ...prev };
        if (payload.status && payload.status !== next.status) {
          next.status = payload.status as TicketDetail["status"];
          patched = true;
        }
        if (payload.priority && payload.priority !== next.priority) {
          next.priority = payload.priority as TicketDetail["priority"];
          patched = true;
        }
        if (payload.updatedAt && payload.updatedAt !== next.updatedAt) {
          next.updatedAt = payload.updatedAt;
          patched = true;
        }
        if (payload.assignee && payload.assignee.id !== next.assignee?.id) {
          next.assignee = payload.assignee;
          patched = true;
        } else if (payload.assigneeId === null && next.assignee !== null) {
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
          typeof payload.followerCount === "number" &&
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
    (isTyping: boolean, targetTicketId?: string | null, forceEmit = false) => {
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
      !localTypingActiveRef.current ||
      now - lastTypingEmitAtRef.current >= 1500;
    setLocalTypingState(true, ticketId, shouldEmitHeartbeat);
    clearTypingIdleTimer();
    typingIdleTimerRef.current = window.setTimeout(() => {
      setLocalTypingState(false, ticketId);
    }, 3500);
  }, [ticketId, clearTypingIdleTimer, setLocalTypingState]);

  /* ——— Data loaders ——— */

  const loadMessagesPage = useCallback(
    async (id: string, reset = false) => {
      const requestSeq = ++messageRequestSeqRef.current;
      setMessagesError(null);
      setMessagesLoading(true);
      try {
        const response = await fetchTicketMessages(id, {
          cursor: reset ? undefined : (messageCursor ?? undefined),
          take: 50,
        });
        if (messageRequestSeqRef.current !== requestSeq) return;
        if (reset) {
          seenRealtimeMessageIdsRef.current.clear();
        }
        setMessages((prev) =>
          reset ? response.data : [...response.data, ...prev],
        );
        for (const message of response.data) {
          seenRealtimeMessageIdsRef.current.add(message.id);
        }
        setMessageCursor(response.nextCursor ?? null);
        setMessagesHasMore(Boolean(response.nextCursor));
        setMessagesError(null);
      } catch (error) {
        if (messageRequestSeqRef.current !== requestSeq) return;
        setMessagesError(handleApiError(error));
      } finally {
        if (messageRequestSeqRef.current === requestSeq)
          setMessagesLoading(false);
      }
    },
    [messageCursor],
  );

  const loadEventsPage = useCallback(
    async (id: string, reset = false) => {
      const requestSeq = ++eventRequestSeqRef.current;
      setEventsError(null);
      setEventsLoading(true);
      try {
        const response = await fetchTicketEvents(id, {
          cursor: reset ? undefined : (eventCursor ?? undefined),
          take: 50,
        });
        if (eventRequestSeqRef.current !== requestSeq) return;
        if (reset) {
          seenRealtimeEventIdsRef.current.clear();
        }
        setEvents((prev) => {
          const merged = reset ? response.data : [...response.data, ...prev];
          return merged;
        });
        for (const event of response.data) {
          seenRealtimeEventIdsRef.current.add(event.id);
        }
        setEventCursor(response.nextCursor ?? null);
        setEventsHasMore(Boolean(response.nextCursor));
        setEventsError(null);
      } catch (error) {
        if (eventRequestSeqRef.current !== requestSeq) return;
        setEventsError(handleApiError(error));
      } finally {
        if (eventRequestSeqRef.current === requestSeq) setEventsLoading(false);
      }
    },
    [eventCursor],
  );

  const loadTicketDetail = useCallback(
    async (id: string) => {
      const requestSeq = ++detailRequestSeqRef.current;
      const isNewTicket =
        activeTicketIdRef.current !== null && activeTicketIdRef.current !== id;
      activeTicketIdRef.current = id;

      setLoadingDetail(true);
      setTicketError(null);
      setAccessDenied(false);
      if (isNewTicket) {
        // Try the React Query cache first — if we've loaded this ticket
        // before, populate from cache so the subject + right pane chrome
        // appear instantly while the background fetch refreshes data.
        // Messages / events still clear so the conversation pane shows
        // a coherent loading state (cached convo would be a much bigger
        // refactor; cursor-based pagination doesn't fit cleanly).
        const cached = queryClient.getQueryData<TicketDetail>([
          "ticket",
          id,
        ]);
        setTicket(cached ?? null);
        setMessages([]);
        setEvents([]);
        setMessageCursor(null);
        setEventCursor(null);
        setMessagesHasMore(false);
        setEventsHasMore(false);
        setMessagesError(null);
        setEventsError(null);
        seenRealtimeMessageIdsRef.current.clear();
        seenRealtimeEventIdsRef.current.clear();
        lastTicketUpdateAtMsRef.current = 0;
      }
      try {
        const detail = await fetchTicketById(id);
        if (detailRequestSeqRef.current !== requestSeq) return;
        setTicket(detail);
        // Mirror into the React Query cache so re-visiting this ticket
        // is an instant cache hit rather than another cold fetch.
        queryClient.setQueryData(["ticket", id], detail);
        await Promise.all([
          loadMessagesPage(id, true),
          loadEventsPage(id, true),
        ]);
      } catch (error) {
        if (detailRequestSeqRef.current !== requestSeq) return;
        if (error instanceof ApiError && error.status === 403) {
          setAccessDenied(true);
          setTicketError("You do not have access to this ticket.");
        } else {
          setTicketError(handleApiError(error));
        }
        if (isNewTicket) setTicket(null);
      } finally {
        if (detailRequestSeqRef.current === requestSeq) setLoadingDetail(false);
      }
    },
    [loadMessagesPage, loadEventsPage],
  );

  const refreshAfterMutation = useCallback(
    async (id: string, options?: { reloadEvents?: boolean }) => {
      const shouldReloadEvents = options?.reloadEvents ?? false;
      try {
        const [detail] = await Promise.all([
          fetchTicketById(id),
          shouldReloadEvents ? loadEventsPage(id, true) : Promise.resolve(),
        ]);
        setTicket(detail);
      } catch {
        /* optimistic update is already applied */
      }
    },
    [loadEventsPage],
  );

  /* ——— Effects ——— */

  useEffect(() => {
    if (ticketId) void loadTicketDetail(ticketId);
  }, [ticketId]);

  useEffect(() => {
    if (!ticketId) {
      return;
    }

    const handleRealtimeTicketChanged = (event: Event) => {
      const customEvent =
        event as CustomEvent<RealtimeTicketChangedEventPayload>;
      const payload = customEvent.detail;
      if (!payload || payload.ticketId !== ticketId) {
        return;
      }

      const incomingUpdatedAtMs = Number.isFinite(
        Date.parse(payload.updatedAt ?? ""),
      )
        ? Date.parse(payload.updatedAt ?? "")
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
      if (payload.reason === "message_added") {
        // Skip self-authored message events: the local optimistic/send flow already updated UI.
        if (
          payload.actorId &&
          currentUserId &&
          payload.actorId === currentUserId
        ) {
          return;
        }

        if (payload.message) {
          const appended = appendRealtimeMessage(payload.message);
          if (appended) {
            appendRealtimeEvent({
              id: `rt:msg:${payload.message.id}`,
              type: "MESSAGE_ADDED",
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
        void loadMessagesPage(ticketId, true);
        if (activeTab === "timeline") {
          void loadEventsPage(ticketId, true);
        }
        return;
      }

      const shouldPatchInPlace =
        payload.reason === "attachment_added" ||
        payload.reason === "attachment_scan_status_changed" ||
        payload.reason === "followers_changed" ||
        payload.reason === "status_changed" ||
        payload.reason === "assigned" ||
        payload.reason === "transferred" ||
        payload.reason === "priority_changed" ||
        payload.reason === "ticket_created" ||
        payload.reason === "automation_rule_executed";

      if (!shouldPatchInPlace) {
        return;
      }

      const patched = applyTicketRealtimePatch(payload);

      if (payload.reason === "ticket_created") {
        appendRealtimeEvent({
          id: `rt:create:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
          type: "TICKET_CREATED",
          createdAt: occurredAtIso,
          payload: null,
          createdBy: actorForEvent,
        });
      }

      if (
        payload.reason === "status_changed" &&
        ticketSnapshot?.status &&
        payload.status &&
        ticketSnapshot.status !== payload.status
      ) {
        appendRealtimeEvent({
          id: `rt:status:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
          type: "TICKET_STATUS_CHANGED",
          createdAt: occurredAtIso,
          payload: {
            from: ticketSnapshot.status,
            to: payload.status,
          },
          createdBy: actorForEvent,
        });
      }

      if (payload.reason === "assigned") {
        appendRealtimeEvent({
          id: `rt:assign:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
          type: "TICKET_ASSIGNED",
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
            type: "TICKET_STATUS_CHANGED",
            createdAt: occurredAtIso,
            payload: {
              from: ticketSnapshot.status,
              to: payload.status,
            },
            createdBy: actorForEvent,
          });
        }
      }

      if (payload.reason === "transferred") {
        appendRealtimeEvent({
          id: `rt:transfer:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
          type: "TICKET_TRANSFERRED",
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
            type: "TICKET_STATUS_CHANGED",
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
        payload.reason === "priority_changed" &&
        ticketSnapshot?.priority &&
        payload.priority &&
        ticketSnapshot.priority !== payload.priority
      ) {
        appendRealtimeEvent({
          id: `rt:priority:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
          type: "TICKET_PRIORITY_CHANGED",
          createdAt: occurredAtIso,
          payload: {
            from: ticketSnapshot.priority,
            to: payload.priority,
          },
          createdBy: actorForEvent,
        });
      }

      if (payload.reason === "attachment_added") {
        appendRealtimeEvent({
          id: `rt:attachment:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
          type: "ATTACHMENT_ADDED",
          createdAt: occurredAtIso,
          payload: {},
          createdBy: actorForEvent,
        });
      }

      if (payload.reason === "attachment_scan_status_changed") {
        appendRealtimeEvent({
          id: `rt:attachment-scan:${ticketId}:${payload.updatedAt ?? occurredAtIso}`,
          type: "ATTACHMENT_SCAN_STATUS_CHANGED",
          createdAt: occurredAtIso,
          payload: {},
          createdBy: actorForEvent,
        });
      }

      const requiresDetailHydration =
        payload.reason === "attachment_added" ||
        payload.reason === "attachment_scan_status_changed" ||
        payload.reason === "followers_changed";
      const hasPatchData =
        typeof payload.status === "string" ||
        typeof payload.priority === "string" ||
        typeof payload.updatedAt === "string" ||
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
      const customEvent =
        event as CustomEvent<RealtimeTicketTypingEventPayload>;
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

      const occurredAtMs = Number.isFinite(Date.parse(payload.occurredAt ?? ""))
        ? Date.parse(payload.occurredAt ?? "")
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
          payload.actorDisplayName ||
          payload.actorEmail ||
          existing?.displayName ||
          "Someone";
        const nextEmail = payload.actorEmail || existing?.email || "";
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

  // Reset transferAssigneeId when transferTeamId changes — the team
  // members themselves come from React Query (teamMembersQuery /
  // transferMembersQuery) which dedupes per-team-id and caches for 5min.
  useEffect(() => {
    setTransferAssigneeId("");
  }, [transferTeamId]);

  useEffect(() => {
    if (!ticket) return;
    setNextStatus(availableTransitions[0] ?? "");
    setAssignToId("");
    setTransferTeamId("");
    setTransferAssigneeId("");
  }, [ticket?.id, ticket?.status, availableTransitions]);

  // Scroll management for conversation
  useEffect(() => {
    if (activeTab !== "conversation") return;
    const el = conversationListRef.current;
    if (!el) return;
    const onScroll = () =>
      setShowJumpToLatest(
        el.scrollHeight - el.scrollTop - el.clientHeight > 250,
      );
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [activeTab, ticket?.id]);

  useEffect(() => {
    if (activeTab !== "conversation") return;
    const el = conversationListRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      hasInitialConversationScrollRef.current = true;
    }
  }, [ticket?.id, activeTab]);

  useEffect(() => {
    if (activeTab !== "conversation") return;
    const el = conversationListRef.current;
    if (!el) return;
    if (!hasInitialConversationScrollRef.current) {
      el.scrollTop = el.scrollHeight;
      hasInitialConversationScrollRef.current = true;
      return;
    }
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 180) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, activeTab]);

  useEffect(() => {
    if (activeTab !== "conversation") return;
    const el = conversationListRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 180)
      el.scrollTop = el.scrollHeight;
  }, [typingUsers.length, activeTab]);

  useEffect(() => {
    setTypingUsersById({});
    seenRealtimeMessageIdsRef.current.clear();
    seenRealtimeEventIdsRef.current.clear();
    lastTicketUpdateAtMsRef.current = 0;
    lastTypingOccurredAtByActorRef.current = {};
    hasInitialConversationScrollRef.current = false;
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
    if (activeTab === "conversation") {
      return;
    }
    stopTyping();
  }, [activeTab, stopTyping]);

  useEffect(() => {
    if (role === "EMPLOYEE") setMessageType("PUBLIC");
  }, [role]);

  // Force INTERNAL when the viewer is a peer agent (server enforces the same
  // rule; this just keeps the UI honest).
  useEffect(() => {
    if (isPeerAgent) setMessageType("INTERNAL");
  }, [isPeerAgent]);

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
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (event.key) {
        case "r":
        case "R":
          if (!event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            messageInputRef.current?.focus();
          }
          break;
        case "a":
        case "A":
          if (
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            canManage &&
            !ticket?.assignee
          ) {
            event.preventDefault();
            void handleAssignSelf();
          }
          break;
        case "s":
        case "S":
          if (!event.ctrlKey && !event.metaKey && !event.altKey && canManage) {
            event.preventDefault();
            statusSelectRef.current?.focus();
          }
          break;
        case "Escape":
          event.preventDefault();
          navigateBack();
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [canManage, navigateBack, ticket?.assignee]);

  /* ——— Event handlers (memoized, 6.3) ——— */

  const handleCopyLink = useCallback(async () => {
    if (!ticketId) return;
    const url = `${window.location.origin}/tickets/${ticketId}`;
    const copied = await copyToClipboard(url);
    setCopyToast({
      message: copied ? "Link copied to clipboard" : "Could not copy link",
      type: copied ? "success" : "error",
    });
  }, [ticketId]);

  const handleMessageBodyChange = useCallback(
    (nextBody: string) => {
      setMessageBody(nextBody);
      writeMessageDraft(ticketId, nextBody);

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
    const body = (messageInputRef.current?.getValue() ?? messageBody).trim();
    if (!ticketId || !ticket || !body) return;
    setTicketError(null);
    stopTyping();

    const optimisticId = `opt-${Date.now()}`;
    const optimisticMessage: ConversationMessage = {
      id: optimisticId,
      body,
      type: messageType,
      createdAt: new Date().toISOString(),
      author: {
        id: "pending",
        email: currentEmail,
        displayName: currentEmail.split("@")[0] || "You",
      },
      localStatus: "sending",
    };
    setMessages((prev) => [...prev, optimisticMessage]);
    setMessageBody("");
    clearMessageDraft(ticketId);

    try {
      const serverMessage = await addTicketMessage(ticketId, {
        body,
        type: messageType,
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimisticId ? { ...m, localStatus: "sent" } : m,
        ),
      );
      appendRealtimeEvent({
        id: `rt:msg:${serverMessage.id}`,
        type: "MESSAGE_ADDED",
        createdAt: serverMessage.createdAt,
        payload: {
          type: serverMessage.type,
          messageId: serverMessage.id,
        },
        createdBy: serverMessage.author,
      });
      setCopyToast({
        message:
          messageType === "INTERNAL" ? "Internal note added" : "Reply sent",
        type: "success",
      });
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setTicketError("Unable to send message.");
      setCopyToast({ message: "Unable to send message.", type: "error" });
    }
  }, [
    messageBody,
    ticketId,
    ticket,
    messageType,
    currentEmail,
    appendRealtimeEvent,
    stopTyping,
  ]);

  const handleAssignSelf = useCallback(async () => {
    if (!ticket) return;
    setActionError(null);
    setActionLoading(true);
    try {
      const updated = await assignTicket(ticket.id, {});
      setTicket((prev) => (prev ? { ...prev, ...updated } : prev));
      void refreshAfterMutation(ticket.id);
      setCopyToast({ message: "Assigned to you.", type: "success" });
      notifyTicketAggregatesChanged();
      notifyTicketReportsChanged();
    } catch {
      setActionError("Unable to assign ticket.");
      setCopyToast({ message: "Unable to assign ticket.", type: "error" });
    } finally {
      setActionLoading(false);
    }
  }, [
    ticket,
    refreshAfterMutation,
    notifyTicketAggregatesChanged,
    notifyTicketReportsChanged,
  ]);

  const handleAssignMember = useCallback(async () => {
    if (!ticket || !assignToId) return;
    setActionError(null);
    setActionLoading(true);
    try {
      const updated = await assignTicket(ticket.id, { assigneeId: assignToId });
      setTicket((prev) => (prev ? { ...prev, ...updated } : prev));
      setAssignToId("");
      void refreshAfterMutation(ticket.id);
      setCopyToast({ message: "Assignee updated.", type: "success" });
      notifyTicketAggregatesChanged();
      notifyTicketReportsChanged();
    } catch {
      setActionError("Unable to assign ticket.");
      setCopyToast({ message: "Unable to assign ticket.", type: "error" });
    } finally {
      setActionLoading(false);
    }
  }, [
    ticket,
    assignToId,
    refreshAfterMutation,
    notifyTicketAggregatesChanged,
    notifyTicketReportsChanged,
  ]);

  const transitionTo = useCallback(
    async (targetStatus: string) => {
      if (!ticket || !targetStatus || targetStatus === ticket.status) return;
      const previousStatus = ticket.status;
      setActionError(null);
      setActionLoading(true);

      // Optimistic update (7.6 fix): update UI immediately, rollback on error
      setTicket((prev) =>
        prev
          ? { ...prev, status: targetStatus as TicketDetail["status"] }
          : prev,
      );
      setCopyToast({
        message: `Status updated to ${formatStatus(targetStatus)}.`,
        type: "success",
      });

      try {
        const updated = await transitionTicket(ticket.id, {
          status: targetStatus as TicketStatus,
        });
        setTicket((prev) => (prev ? { ...prev, ...updated } : prev));
        void refreshAfterMutation(ticket.id);
        notifyTicketAggregatesChanged();
        if (targetStatus === "RESOLVED" || targetStatus === "CLOSED")
          notifyTicketReportsChanged();
      } catch {
        // Rollback optimistic update
        setTicket((prev) =>
          prev ? { ...prev, status: previousStatus } : prev,
        );
        setActionError("Unable to change status.");
        setCopyToast({ message: "Unable to change status.", type: "error" });
      } finally {
        setActionLoading(false);
      }
    },
    [
      ticket,
      refreshAfterMutation,
      notifyTicketAggregatesChanged,
      notifyTicketReportsChanged,
    ],
  );

  const handleTransition = useCallback(
    () => transitionTo(nextStatus),
    [transitionTo, nextStatus],
  );

  const handleTransfer = useCallback(async () => {
    if (!ticket || !transferTeamId) return;
    setActionError(null);
    setActionLoading(true);
    try {
      const updated = await transferTicket(ticket.id, {
        newTeamId: transferTeamId,
        assigneeId: transferAssigneeId || undefined,
      });
      setTicket((prev) => (prev ? { ...prev, ...updated } : prev));
      void refreshAfterMutation(ticket.id);
      setCopyToast({ message: "Ticket transferred.", type: "success" });
      notifyTicketAggregatesChanged();
      notifyTicketReportsChanged();
    } catch {
      setActionError("Unable to transfer ticket.");
      setCopyToast({ message: "Unable to transfer ticket.", type: "error" });
    } finally {
      setActionLoading(false);
    }
  }, [
    ticket,
    transferTeamId,
    transferAssigneeId,
    refreshAfterMutation,
    notifyTicketAggregatesChanged,
    notifyTicketReportsChanged,
  ]);

  const changePriority = useCallback(
    async (priority: string) => {
      if (!ticket || priority === ticket.priority) return;
      const previous = ticket.priority;
      setActionError(null);
      setActionLoading(true);
      setTicket((prev) =>
        prev ? { ...prev, priority: priority as TicketPriority } : prev,
      );
      try {
        await bulkPriorityTickets([ticket.id], priority);
        void refreshAfterMutation(ticket.id);
        notifyTicketAggregatesChanged();
        setCopyToast({ message: `Priority set to ${priority}.`, type: "success" });
      } catch {
        setTicket((prev) => (prev ? { ...prev, priority: previous } : prev));
        setActionError("Unable to change priority.");
        setCopyToast({ message: "Unable to change priority.", type: "error" });
      } finally {
        setActionLoading(false);
      }
    },
    [ticket, refreshAfterMutation, notifyTicketAggregatesChanged],
  );

  const changeCategory = useCallback(
    async (categoryId: string | null) => {
      if (!ticket || categoryId === (ticket.category?.id ?? null)) return;
      const previous = ticket.category ?? null;
      setActionError(null);
      setActionLoading(true);
      const nextCategory =
        categories.find((c) => c.id === categoryId) ?? null;
      setTicket((prev) =>
        prev ? { ...prev, category: nextCategory } : prev,
      );
      try {
        await setTicketCategory(ticket.id, categoryId);
        void refreshAfterMutation(ticket.id);
        setCopyToast({
          message: categoryId
            ? `Category set to ${nextCategory?.name ?? "category"}.`
            : "Category cleared.",
          type: "success",
        });
      } catch {
        setTicket((prev) => (prev ? { ...prev, category: previous } : prev));
        setActionError("Unable to change category.");
        setCopyToast({ message: "Unable to change category.", type: "error" });
      } finally {
        setActionLoading(false);
      }
    },
    [ticket, categories, refreshAfterMutation],
  );

  const handleFollowToggle = useCallback(async () => {
    if (!ticket) return;
    setFollowError(null);
    setFollowLoading(true);
    try {
      if (isFollowing) await unfollowTicket(ticket.id);
      else await followTicket(ticket.id);
      void refreshAfterMutation(ticket.id);
      setCopyToast({
        message: isFollowing ? "Unfollowed ticket." : "Following ticket.",
        type: "success",
      });
    } catch {
      setFollowError("Unable to update followers.");
      setCopyToast({ message: "Unable to update followers.", type: "error" });
    } finally {
      setFollowLoading(false);
    }
  }, [ticket, isFollowing, refreshAfterMutation]);

  const uploadAttachmentFiles = useCallback(
    async (files: File[]) => {
      if (!ticketId || files.length === 0) return;
      setAttachmentError(null);
      setAttachmentUploading(true);
      try {
        for (const file of files)
          await uploadTicketAttachment(ticketId, file);
        void refreshAfterMutation(ticketId);
        setCopyToast({
          message:
            files.length === 1
              ? "Attachment uploaded."
              : `${files.length} attachments uploaded.`,
          type: "success",
        });
      } catch {
        setAttachmentError("Unable to upload attachment.");
        setCopyToast({
          message: "Unable to upload attachment.",
          type: "error",
        });
      } finally {
        setAttachmentUploading(false);
      }
    },
    [ticketId, refreshAfterMutation],
  );

  const handleAttachmentUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;
      await uploadAttachmentFiles(Array.from(files));
      event.target.value = "";
    },
    [uploadAttachmentFiles],
  );

  const handlePasteFiles = useCallback(
    async (items: { file: File; tempId?: string }[]) => {
      if (!ticketId || items.length === 0) return;
      setAttachmentError(null);
      setAttachmentUploading(true);
      let anyFailed = false;
      // Upload in the background; images were already inserted inline with a
      // loading state, so we just resolve each as it finishes.
      for (const { file, tempId } of items) {
        try {
          const attachment = await uploadTicketAttachment(ticketId, file);
          if (tempId) {
            messageInputRef.current?.resolveUploadingImage(
              tempId,
              attachment.id,
            );
          }
        } catch {
          anyFailed = true;
          if (tempId) {
            messageInputRef.current?.resolveUploadingImage(tempId, null);
          }
        }
      }
      setAttachmentUploading(false);
      if (anyFailed) {
        setAttachmentError("Unable to upload attachment.");
        setCopyToast({
          message: "Unable to upload attachment.",
          type: "error",
        });
      }
      void refreshAfterMutation(ticketId);
    },
    [ticketId, refreshAfterMutation, messageInputRef],
  );

  const handleAttachmentDownload = useCallback(
    async (attachmentId: string, fileName: string) => {
      setAttachmentError(null);
      try {
        const blob = await downloadAttachment(attachmentId);
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to download attachment.";
        setAttachmentError(message || "Unable to download attachment.");
      }
    },
    [],
  );

  const handleAttachmentView = useCallback(async (attachmentId: string) => {
    setAttachmentError(null);
    try {
      const blob = await downloadAttachment(attachmentId);
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to open attachment.";
      setAttachmentError(message || "Unable to open attachment.");
    }
  }, []);

  const toggleSection = useCallback((section: keyof ExpandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  const scrollToLatest = useCallback(() => {
    conversationListRef.current?.scrollTo({
      top: conversationListRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  const conversationCount = messages.length;
  const timelineCount = events.length;
  const attachmentsCount = ticket?.attachments.length ?? 0;
  const ticketTabRefs = {
    conversation: conversationTabRef,
    attachments: attachmentsTabRef,
    timeline: timelineTabRef,
  } as const;

  const focusTicketTab = useCallback(
    (tab: TicketDetailTabId) => {
      setActiveTab(tab);
      ticketTabRefs[tab].current?.focus();
    },
    [ticketTabRefs],
  );

  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, currentTab: TicketDetailTabId) => {
      const nextTab = getNextTicketDetailTab(currentTab, event.key);
      if (!nextTab) {
        return;
      }
      event.preventDefault();
      focusTicketTab(nextTab);
    },
    [focusTicketTab],
  );

  useEffect(() => {
    const currentContainer = tabsContainerRef.current;
    if (!currentContainer) {
      return;
    }

    function updateIndicator() {
      let target: HTMLButtonElement | null = null;
      if (activeTab === "conversation") {
        target = conversationTabRef.current;
      } else if (activeTab === "timeline") {
        target = timelineTabRef.current;
      } else if (activeTab === "attachments") {
        target = attachmentsTabRef.current;
      }
      if (!target) {
        return;
      }
      const containerRect = currentContainer!.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      // rect deltas are visual px; the indicator lives in the zoomed container,
      // so convert to zoomed-CSS px by dividing by the zoom. See getUiZoom().
      const z = getUiZoom();
      setTabIndicator({
        left: (targetRect.left - containerRect.left) / z,
        width: targetRect.width / z,
      });
    }

    updateIndicator();

    const handleResize = () => {
      updateIndicator();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [activeTab]);

  /* ——— Render ——— */

  return (
    <section
      className={`flex flex-col bg-card animate-fade-in ${ticketIdProp ? "h-full overflow-hidden" : "h-screen"}`}
      title={headerTitle}
    >
      {/* Toast notification */}
      {copyToast && (
        <div className="fixed right-4 top-4 z-50">
          <div
            className={`flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-lg ${
              copyToast.type === "success"
                ? "border-emerald-200 text-foreground"
                : "border-rose-200 text-rose-700"
            }`}
          >
            {copyToast.type === "success" ? (
              <Check className="h-5 w-5 text-emerald-600" />
            ) : (
              <Clock3 className="h-5 w-5" />
            )}
            <span className="text-sm font-medium">{copyToast.message}</span>
          </div>
        </div>
      )}

      {/* Sticky header — hidden when embedded in tabs */}
      {!ticketIdProp && (
      <div className="shrink-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="px-6 py-3">
          <TopBar
            title={headerTitle}
            subtitle={
              headerCtx?.subtitle ??
              "Review context, collaborate, and update workflow in one workspace."
            }
            currentEmail={headerCtx?.currentEmail ?? currentEmail}
            onOpenSearch={headerCtx?.onOpenSearch}
            notificationProps={headerCtx?.notificationProps}
            leftAction={
              <button
                type="button"
                onClick={navigateBack}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-foreground hover:bg-accent hover:text-foreground"
                aria-label="Back"
                title="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            }
            leftContent={
              ticket ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {formatTicketId(ticket)}
                  </span>
                  <span
                    className={`rounded-md px-2 py-1 text-xs font-semibold ${statusBadgeClass(ticket.status)}`}
                  >
                    {formatStatus(ticket.status)}
                  </span>
                  <span
                    className={`rounded-md px-2 py-1 text-xs font-semibold ${priorityBadgeClass(ticket.priority)}`}
                  >
                    {formatPriority(ticket.priority)}
                  </span>
                  <span className="rounded-md bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-400">
                    {formatChannel(ticket.channel)}
                  </span>
                </div>
              ) : (
                <div>
                  <h1 className="text-xl font-semibold text-foreground">
                    Ticket details
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Review context, collaborate, and update workflow in one
                    workspace.
                  </p>
                </div>
              )
            }
          />
        </div>
      </div>
      )}

      {/* Top progress bar — visible while a ticket fetch is in flight.
          Appears as a thin animated stripe across the top of the detail
          panel so the user has an explicit "loading new ticket" cue. */}
      {loadingDetail && (
        <div
          className="relative h-[3px] shrink-0 overflow-hidden bg-primary/10"
          aria-hidden="true"
        >
          <div className="absolute inset-y-0 left-0 w-1/3 bg-primary animate-progress-slide" />
        </div>
      )}

      {/* Main content */}
      <div className={TICKET_DETAIL_LAYOUT_CLASSNAMES.contentShell}>
        {ticketError && (
          <p className="absolute top-20 left-1/2 -translate-x-1/2 z-50 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600 shadow-lg">
            {ticketError}
          </p>
        )}
        {accessDenied && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 rounded-md bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-lg">
            Switch to a user with access, or go back to the ticket list.
          </div>
        )}

        <div className={TICKET_DETAIL_LAYOUT_CLASSNAMES.contentContainer}>
          {/* Left: mid-list rail (queue at a glance) */}
          <aside
            className={TICKET_DETAIL_LAYOUT_CLASSNAMES.midList}
            aria-label="Ticket list"
          >
            <TicketDetailMidList
              currentTicketId={ticketId}
              onSelectTicket={(ticket, opts) => {
                if (onSelectTicket) {
                  onSelectTicket(ticket, opts);
                } else if (opts?.newTab) {
                  // Standalone /tickets/:id route — open new browser tab.
                  window.open(
                    `/tickets/${ticket.id}${location.search}`,
                    "_blank",
                    "noopener",
                  );
                } else {
                  navigate(`/tickets/${ticket.id}${location.search}`);
                }
              }}
            />
          </aside>

          {/* Center: conversation / timeline panel */}
          <div className={TICKET_DETAIL_LAYOUT_CLASSNAMES.mainPanel}>
            <div className="flex flex-1 flex-col min-h-0">
              {/* Integrated Subject Header */}
              {ticket && (
                <div className="px-6 pt-3 pb-0">
                  <div className="relative overflow-hidden rounded-xl border border-border bg-card px-5 py-3 shadow-sm sm:px-6 sm:py-3.5">
                    <div className="pointer-events-none absolute inset-y-0 right-[-80px] hidden w-64 rounded-full bg-gradient-to-l from-cyan-500/10 to-transparent blur-3xl sm:block" />
                    <div className="flex items-start justify-between gap-6">
                      <div className="min-w-0">
                        <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                          {ticket.subject}
                        </h1>
                        {ticket.description ? (
                          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                            {extractOriginalMessage(ticket.description) ||
                              "No description provided."}
                          </p>
                        ) : (
                          <p className="mt-2 text-[14px] leading-relaxed italic text-muted-foreground">
                            No description provided.
                          </p>
                        )}
                        <div className="mt-3">
                          <TagChips
                            ticketId={ticket.id}
                            tags={ticket.tags ?? []}
                            canEdit={canManage}
                          />
                        </div>
                      </div>
                      <div className="flex shrink-0 items-start gap-2">
                        <button
                          type="button"
                          onClick={() => void handleCopyLink()}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-sm transition hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring/30"
                          title="Copy ticket link"
                          aria-label="Copy ticket link"
                        >
                          <Copy className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab bar – Aceternity-style segmented tabs with sliding indicator */}
              <div className="shrink-0 flex items-center justify-between gap-4 border-b border-border px-6 py-1.5">
                <div
                  ref={tabsContainerRef}
                  className="relative inline-flex items-center gap-1 rounded-full border border-border bg-accent/70 p-1 text-xs shadow-sm"
                  role="tablist"
                  aria-label="Ticket views"
                  aria-orientation="horizontal"
                >
                  {tabIndicator ? (
                    <div
                      className="absolute inset-y-1 rounded-full bg-slate-900 shadow-sm transition-all duration-300 ease-out"
                      style={{
                        transform: `translateX(${tabIndicator.left}px)`,
                        width: tabIndicator.width,
                      }}
                    />
                  ) : null}

                  <button
                    ref={conversationTabRef}
                    type="button"
                    id={getTicketDetailTabIds("conversation").tabId}
                    role="tab"
                    aria-selected={activeTab === "conversation"}
                    aria-controls={getTicketDetailTabIds("conversation").panelId}
                    tabIndex={
                      getTicketDetailTabAccessibilityState(
                        "conversation",
                        activeTab,
                      ).tabIndex
                    }
                    onClick={() => setActiveTab("conversation")}
                    onKeyDown={(event) =>
                      handleTabKeyDown(event, "conversation")
                    }
                    className={`relative inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
                      activeTab === "conversation"
                        ? "text-slate-50"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>Conversation</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        activeTab === "conversation"
                          ? "bg-slate-800 text-slate-100"
                          : "bg-accent text-foreground"
                      }`}
                    >
                      {conversationCount}
                    </span>
                  </button>

                  <button
                    ref={attachmentsTabRef}
                    type="button"
                    id={getTicketDetailTabIds("attachments").tabId}
                    role="tab"
                    aria-selected={activeTab === "attachments"}
                    aria-controls={getTicketDetailTabIds("attachments").panelId}
                    tabIndex={
                      getTicketDetailTabAccessibilityState(
                        "attachments",
                        activeTab,
                      ).tabIndex
                    }
                    onClick={() => setActiveTab("attachments")}
                    onKeyDown={(event) =>
                      handleTabKeyDown(event, "attachments")
                    }
                    className={`relative inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
                      activeTab === "attachments"
                        ? "text-slate-50"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>Attachments</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        activeTab === "attachments"
                          ? "bg-slate-800 text-slate-100"
                          : "bg-accent text-foreground"
                      }`}
                    >
                      {attachmentsCount}
                    </span>
                  </button>

                  <button
                    ref={timelineTabRef}
                    type="button"
                    id={getTicketDetailTabIds("timeline").tabId}
                    role="tab"
                    aria-selected={activeTab === "timeline"}
                    aria-controls={getTicketDetailTabIds("timeline").panelId}
                    tabIndex={
                      getTicketDetailTabAccessibilityState(
                        "timeline",
                        activeTab,
                      ).tabIndex
                    }
                    onClick={() => setActiveTab("timeline")}
                    onKeyDown={(event) => handleTabKeyDown(event, "timeline")}
                    className={`relative inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
                      activeTab === "timeline"
                        ? "text-slate-50"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>Timeline</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        activeTab === "timeline"
                          ? "bg-slate-800 text-slate-100"
                          : "bg-accent text-foreground"
                      }`}
                    >
                      {timelineCount}
                    </span>
                  </button>
                </div>
                <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex" />
              </div>

              {/* Tab content with smooth cross-fade motion */}
              <div className="relative flex flex-1 min-h-0 bg-background">
                {loadingDetail && !ticket ? (
                  <TicketDetailSkeleton count={5} className="flex-1" />
                ) : null}
                {!loadingDetail && !ticket && !accessDenied ? (
                  <p className="p-6 text-sm text-muted-foreground">
                    Ticket not found.
                  </p>
                ) : null}

                {ticket ? (
                  <>
                    <div
                      id={getTicketDetailTabIds("conversation").panelId}
                      role="tabpanel"
                      aria-labelledby={getTicketDetailTabIds("conversation").tabId}
                      aria-hidden={
                        getTicketDetailTabAccessibilityState(
                          "conversation",
                          activeTab,
                        ).hidden
                      }
                      hidden={
                        getTicketDetailTabAccessibilityState(
                          "conversation",
                          activeTab,
                        ).hidden
                      }
                      className={getTicketDetailTabPanelClassName(
                        "conversation",
                        activeTab,
                      )}
                    >
                      <TicketConversation
                        ticket={ticket}
                        messages={messages}
                        messagesHasMore={messagesHasMore}
                        messagesLoading={messagesLoading}
                        messagesError={messagesError}
                        currentEmail={currentEmail}
                        messageType={messageType}
                        setMessageType={setMessageType}
                        messageBody={messageBody}
                        onMessageBodyChange={handleMessageBodyChange}
                        onMessageInputBlur={handleMessageInputBlur}
                        canManage={canManage}
                        isPeerAgent={isPeerAgent}
                        canUpload={canUpload}
                        onReply={() => void handleReply()}
                        onLoadMore={() =>
                          ticketId && void loadMessagesPage(ticketId)
                        }
                        onRetryLoad={() =>
                          ticketId && void loadMessagesPage(ticketId, true)
                        }
                        onAttachmentUpload={handleAttachmentUpload}
                        onPasteFiles={handlePasteFiles}
                        onAttachmentDownload={(id, name) =>
                          void handleAttachmentDownload(id, name)
                        }
                        onAttachmentView={(id) => void handleAttachmentView(id)}
                        attachmentUploading={attachmentUploading}
                        attachmentError={attachmentError}
                        typingUsers={typingUsers}
                        showJumpToLatest={showJumpToLatest}
                        onScrollToLatest={scrollToLatest}
                        messageInputRef={messageInputRef}
                        attachmentInputRef={attachmentInputRef}
                        conversationListRef={conversationListRef}
                        users={teamMembers.map((m) => m.user)}
                        cannedVariables={{
                          ticketId: ticket.id,
                          ticketSubject: ticket.subject,
                          requesterName:
                            ticket.requester?.displayName ??
                            ticket.requester?.email,
                        }}
                      />
                    </div>

                    <div
                      id={getTicketDetailTabIds("attachments").panelId}
                      role="tabpanel"
                      aria-labelledby={getTicketDetailTabIds("attachments").tabId}
                      aria-hidden={
                        getTicketDetailTabAccessibilityState(
                          "attachments",
                          activeTab,
                        ).hidden
                      }
                      hidden={
                        getTicketDetailTabAccessibilityState(
                          "attachments",
                          activeTab,
                        ).hidden
                      }
                      className={getTicketDetailTabPanelClassName(
                        "attachments",
                        activeTab,
                      )}
                    >
                      <TicketAttachments
                        ticket={ticket}
                        onDownloadAttachment={(id, name) =>
                          void handleAttachmentDownload(id, name)
                        }
                        attachmentError={attachmentError}
                      />
                    </div>

                    <div
                      id={getTicketDetailTabIds("timeline").panelId}
                      role="tabpanel"
                      aria-labelledby={getTicketDetailTabIds("timeline").tabId}
                      aria-hidden={
                        getTicketDetailTabAccessibilityState(
                          "timeline",
                          activeTab,
                        ).hidden
                      }
                      hidden={
                        getTicketDetailTabAccessibilityState(
                          "timeline",
                          activeTab,
                        ).hidden
                      }
                      className={getTicketDetailTabPanelClassName(
                        "timeline",
                        activeTab,
                      )}
                    >
                      <TicketTimeline
                        events={events}
                        eventsHasMore={eventsHasMore}
                        eventsLoading={eventsLoading}
                        eventsError={eventsError}
                        onLoadMore={() =>
                          ticketId && void loadEventsPage(ticketId)
                        }
                        onRetryLoad={() =>
                          ticketId && void loadEventsPage(ticketId, true)
                        }
                      />
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {/* Right: sidebar */}
          {ticket && (
            <div className={TICKET_DETAIL_LAYOUT_CLASSNAMES.sidebar}>
              <TicketSidebar
                ticketId={ticket.id}
                csatTicketId={ticket.id}
                csatTicketStatus={ticket.status}
                csatIsRequester={ticket.requester?.email === currentEmail}
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
                categories={categories}
                onPriorityChange={(p) => void changePriority(p)}
                onCategoryChange={(c) => void changeCategory(c)}
                expandedSections={expandedSections}
                toggleSection={toggleSection}
                loadingDetail={loadingDetail}
                followers={followers}
                isFollowing={isFollowing}
                followLoading={followLoading}
                followError={followError}
                onFollowToggle={() => void handleFollowToggle()}
                statusEvents={statusEvents}
                currentEmail={currentEmail}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
