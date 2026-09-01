import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTicketTabs } from "../contexts/TicketTabsContext";
import { TicketTabBar } from "../components/TicketTabBar";
import { TicketDetailPage } from "./TicketDetailPage";
import {
  bulkAssignTickets,
  bulkPriorityTickets,
  bulkStatusTickets,
  bulkTransferTickets,
  fetchTicketById,
  exportTicketsCsv,
  fetchTickets,
  fetchUsers,
  type BulkResult,
  type TicketRecord,
  type TeamRef,
  type UserRef,
} from "../api/client";
import { BulkActionsToolbar } from "../components/BulkActionsToolbar";
// import { TopBar } from "../components/TopBar";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { FilterPanel } from "../components/filters/FilterPanel";
import { SaveViewButton } from "../components/SaveViewButton";
import { TicketTableView } from "../components/TicketTableView";
import { TicketsTableSkeleton } from "../components/skeletons";
import { useFilters } from "../hooks/useFilters";
import { useFocusSearchOnShortcut } from "../hooks/useKeyboardShortcuts";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";
import { useTicketSelection } from "../hooks/useTicketSelection";
import { useTabVisible } from "../hooks/useTabVisible";
import { useToast } from "../hooks/useToast";
import { downloadCsvContent } from "../utils/download-csv";
import { handleApiError } from "../utils/handleApiError";
import {
  REALTIME_TICKET_CHANGED_EVENT,
  type RealtimeTicketChangedEventPayload,
} from "../realtime/events";
import type { Role, StatusFilter, TicketFilters, TicketScope } from "../types";
// import { useHeaderContext } from "../contexts/HeaderContext";
import { useTicketDataInvalidation } from "../contexts/TicketDataInvalidationContext";
import { ListFreshnessNotice } from "../components/ListFreshnessNotice";

type SortPreset =
  | "updated_desc"
  | "updated_asc"
  | "created_desc"
  | "created_asc"
  | "completed_desc";
const DEFAULT_PAGE_SIZE = 50;
/** Backstop poll, used only while the realtime socket is down (card 1.26). */
const LIST_POLL_INTERVAL_MS = 30_000;
const PAGE_KEYS: Array<keyof TicketFilters> = ["page", "pageSize"];
const RESOLVED_STATUSES = new Set(["RESOLVED", "CLOSED"]);

function sortPresetFromFilters(sort: string, order: string): SortPreset {
  if (sort === "createdAt" && order === "asc") return "created_asc";
  if (sort === "createdAt" && order === "desc") return "created_desc";
  if (sort === "updatedAt" && order === "asc") return "updated_asc";
  if (sort === "updatedAt" && order === "desc") return "updated_desc";
  return "completed_desc";
}

function countActiveFilterGroups(
  filters: ReturnType<typeof useFilters>["filters"],
) {
  let count = 0;
  if (filters.statuses.length > 0) count += 1;
  if (filters.priorities.length > 0) count += 1;
  if (filters.teamIds.length > 0) count += 1;
  if (filters.assigneeIds.length > 0) count += 1;
  if (filters.requesterIds.length > 0) count += 1;
  if (filters.slaStatus.length > 0) count += 1;
  if (
    filters.createdFrom ||
    filters.createdTo ||
    filters.updatedFrom ||
    filters.updatedTo ||
    filters.dueFrom ||
    filters.dueTo
  )
    count += 1;
  if (filters.q.trim()) count += 1;
  return count;
}

function cloneTicketFilters(filters: TicketFilters): TicketFilters {
  return {
    ...filters,
    statuses: [...filters.statuses],
    priorities: [...filters.priorities],
    teamIds: [...filters.teamIds],
    assigneeIds: [...filters.assigneeIds],
    requesterIds: [...filters.requesterIds],
    slaStatus: [...filters.slaStatus],
    tags: [...filters.tags],
  };
}

function clearedTicketFilters(
  presetScope: TicketScope,
  presetStatus: StatusFilter,
): TicketFilters {
  return {
    statusGroup: presetStatus,
    statuses: [],
    priorities: [],
    teamIds: [],
    assigneeIds: [],
    requesterIds: [],
    slaStatus: [],
    tags: [],
    createdFrom: "",
    createdTo: "",
    updatedFrom: "",
    updatedTo: "",
    dueFrom: "",
    dueTo: "",
    q: "",
    scope: presetScope,
    sort: "updatedAt",
    order: "desc",
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

function parseDateMillis(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Is this realtime payload older than the row already on screen?
 *
 * Shared by the row patch and the header-count arithmetic so the two can never
 * disagree about whether an event was applied.
 */
function isStaleRealtimePatch(
  current: TicketRecord,
  payload: RealtimeTicketChangedEventPayload,
): boolean {
  const incomingUpdatedAtMs = parseDateMillis(payload.updatedAt);
  return (
    incomingUpdatedAtMs > 0 &&
    incomingUpdatedAtMs < parseDateMillis(current.updatedAt)
  );
}

/**
 * Merge a background refresh into the rows already on screen.
 *
 * The server decides membership and ordering; a row already held locally wins
 * only when it is strictly newer, so a realtime patch that landed while the
 * request was in flight is not undone by it. Same comparison the realtime
 * handler makes, for the same reason.
 */
function reconcileTicketRows(
  current: TicketRecord[],
  incoming: TicketRecord[],
): TicketRecord[] {
  const currentById = new Map(current.map((row) => [row.id, row]));
  return incoming.map((row) => {
    const existing = currentById.get(row.id);
    if (!existing) return row;
    return parseDateMillis(existing.updatedAt) > parseDateMillis(row.updatedAt)
      ? existing
      : row;
  });
}

function isResolvedStatus(status: string): boolean {
  return RESOLVED_STATUSES.has(status);
}

function isOpenStatus(status: string): boolean {
  return !isResolvedStatus(status);
}

function compareTickets(
  a: TicketRecord,
  b: TicketRecord,
  sort: TicketFilters["sort"],
  order: TicketFilters["order"],
) {
  const getSortValue = (ticket: TicketRecord) => {
    if (sort === "createdAt") return parseDateMillis(ticket.createdAt);
    if (sort === "completedAt") return parseDateMillis(ticket.completedAt);
    return parseDateMillis(ticket.updatedAt);
  };

  const aValue = getSortValue(a);
  const bValue = getSortValue(b);
  const diff = aValue - bValue;
  if (diff !== 0) {
    return order === "asc" ? diff : -diff;
  }

  // Keep a stable deterministic fallback ordering.
  return b.number - a.number;
}

export function TicketsPage({
  role,
  currentEmail,
  presetStatus,
  presetScope,
  teamsList,
  realtimeAvailable,
  onCreateTicket,
}: {
  role: Role;
  currentEmail: string;
  presetStatus: StatusFilter;
  presetScope: TicketScope;
  teamsList: TeamRef[];
  /** Whether the realtime socket is up. False means this list must poll. */
  realtimeAvailable: boolean;
  onCreateTicket?: () => void;
}) {
  // const headerCtx = useHeaderContext();
  const navigate = useNavigate();
  const location = useLocation();
  const ticketTabs = useTicketTabs();
  const [activeTicketId, setActiveTicketId] = useState<string | null>(() => {
    // Restore active ticket from tab context on mount
    const stored = ticketTabs.activeTabId;
    if (stored && stored !== "__queue__" && ticketTabs.tabs.some(t => t.id === stored)) {
      return stored;
    }
    return null;
  });
  const isQueueView = activeTicketId === null;

  // Reset to queue view when sidebar navigation changes filters
  useEffect(() => {
    setActiveTicketId(null);
    ticketTabs.switchTab("__queue__");
  }, [presetStatus, presetScope]);

  const [searchParams] = useSearchParams();
  const { filters, setFilters, clearFilters, hasActiveFilters, apiParams } =
    useFilters(presetScope, presetStatus);
  const toast = useToast();
  const [exportingCsv, setExportingCsv] = useState(false);

  // Exports exactly what the list is showing: same params, same access filter.
  async function handleExportCsv() {
    setExportingCsv(true);
    try {
      const csv = await exportTicketsCsv({
        ...apiParams,
        page: undefined,
        pageSize: undefined,
      });
      downloadCsvContent(
        csv,
        `tickets-${new Date().toISOString().slice(0, 10)}.csv`,
      );
      toast.success("Export downloaded");
    } catch (err) {
      toast.error(handleApiError(err));
    } finally {
      setExportingCsv(false);
    }
  }

  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [listMeta, setListMeta] = useState<{
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  } | null>(null);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [assignableUsers, setAssignableUsers] = useState<UserRef[]>([]);
  const [requesterOptions, setRequesterOptions] = useState<UserRef[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [advancedDraft, setAdvancedDraft] = useState<TicketFilters | null>(
    null,
  );
  const [searchDraft, setSearchDraft] = useState(filters.q);
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);
  const [rangeAnchorIndex, setRangeAnchorIndex] = useState<number | null>(null);
  const ticketsRequestSeqRef = useRef(0);
  const realtimeHydrationInFlightRef = useRef<Set<string>>(new Set());
  const ticketsRef = useRef<TicketRecord[]>([]);
  const isTabVisible = useTabVisible();
  const hasLoadedOnceRef = useRef(false);
  const previousRealtimeAvailableRef = useRef(realtimeAvailable);
  const previousTabVisibleRef = useRef(isTabVisible);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const advancedFiltersDialogRef = useRef<HTMLDivElement>(null);
  const advancedFiltersAnchorRef = useRef<HTMLDivElement>(null);
  const { notifyTicketAggregatesChanged, notifyTicketReportsChanged } =
    useTicketDataInvalidation();

  useFocusSearchOnShortcut(searchInputRef);

  useEffect(() => {
    setSearchDraft(filters.q);
  }, [filters.q]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchDraft === filters.q) return;
      setFilters({ q: searchDraft }, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.q, searchDraft, setFilters]);

  const openAdvancedFilters = useCallback(() => {
    setAdvancedDraft(cloneTicketFilters(filters));
    setShowAdvancedFilters(true);
  }, [filters]);

  const closeAdvancedFilters = useCallback(() => {
    setShowAdvancedFilters(false);
    setAdvancedDraft(null);
  }, []);

  // Close the Advanced popover on outside click / Escape.
  useEffect(() => {
    if (!showAdvancedFilters) return;
    function onPointer(e: MouseEvent) {
      const anchor = advancedFiltersAnchorRef.current;
      if (anchor && !anchor.contains(e.target as Node)) {
        closeAdvancedFilters();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeAdvancedFilters();
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [showAdvancedFilters, closeAdvancedFilters]);

  useModalFocusTrap({
    open: showAdvancedFilters && role !== "EMPLOYEE",
    containerRef: advancedFiltersDialogRef,
    onClose: closeAdvancedFilters,
  });

  const setAdvancedDraftFilters = useCallback(
    (updates: Partial<TicketFilters>) => {
      setAdvancedDraft((prev) => {
        const base = prev ?? cloneTicketFilters(filters);
        const hasNonPageUpdates = Object.keys(updates).some(
          (key) => !PAGE_KEYS.includes(key as keyof TicketFilters),
        );
        const next = { ...base, ...updates };
        if (hasNonPageUpdates) {
          next.page = 1;
        }
        return next;
      });
    },
    [filters],
  );

  const clearAdvancedDraft = useCallback(() => {
    setAdvancedDraft(clearedTicketFilters(presetScope, presetStatus));
  }, [presetScope, presetStatus]);

  const applyAdvancedDraft = useCallback(() => {
    if (advancedDraft) {
      setFilters(advancedDraft);
    }
    closeAdvancedFilters();
  }, [advancedDraft, closeAdvancedFilters, setFilters]);

  const hasOnlyResolvedStatuses = useMemo(
    () =>
      filters.statuses.length > 0 &&
      filters.statuses.every(
        (status) => status === "RESOLVED" || status === "CLOSED",
      ),
    [filters.statuses],
  );

  const effectiveSort = useMemo(
    () =>
      filters.sort === "completedAt" &&
      filters.statusGroup !== "resolved" &&
      !hasOnlyResolvedStatuses
        ? "createdAt"
        : filters.sort,
    [filters.sort, filters.statusGroup, hasOnlyResolvedStatuses],
  );

  const matchesTicketFilters = useCallback(
    (ticket: TicketRecord) => {
      const normalizedCurrentEmail = currentEmail.trim().toLowerCase();

      if (
        filters.statuses.length > 0 &&
        !filters.statuses.includes(ticket.status)
      ) {
        return false;
      }
      if (
        filters.statuses.length === 0 &&
        filters.statusGroup === "open" &&
        !isOpenStatus(ticket.status)
      ) {
        return false;
      }
      if (
        filters.statuses.length === 0 &&
        filters.statusGroup === "resolved" &&
        !isResolvedStatus(ticket.status)
      ) {
        return false;
      }
      if (
        filters.priorities.length > 0 &&
        !filters.priorities.includes(ticket.priority)
      ) {
        return false;
      }
      if (
        filters.teamIds.length > 0 &&
        (!ticket.assignedTeam?.id ||
          !filters.teamIds.includes(ticket.assignedTeam.id))
      ) {
        return false;
      }
      if (
        filters.assigneeIds.length > 0 &&
        (!ticket.assignee?.id ||
          !filters.assigneeIds.includes(ticket.assignee.id))
      ) {
        return false;
      }
      if (
        filters.requesterIds.length > 0 &&
        (!ticket.requester?.id ||
          !filters.requesterIds.includes(ticket.requester.id))
      ) {
        return false;
      }
      if (filters.scope === "assigned") {
        const assigneeEmail = ticket.assignee?.email?.toLowerCase() ?? "";
        if (
          !normalizedCurrentEmail ||
          assigneeEmail !== normalizedCurrentEmail
        ) {
          return false;
        }
      }
      if (filters.scope === "unassigned" && ticket.assignee) {
        return false;
      }
      if (filters.scope === "created") {
        const requesterEmail = ticket.requester?.email?.toLowerCase() ?? "";
        if (
          !normalizedCurrentEmail ||
          requesterEmail !== normalizedCurrentEmail
        ) {
          return false;
        }
      }
      if (
        filters.updatedFrom &&
        parseDateMillis(ticket.updatedAt) < parseDateMillis(filters.updatedFrom)
      ) {
        return false;
      }
      if (
        filters.updatedTo &&
        parseDateMillis(ticket.updatedAt) > parseDateMillis(filters.updatedTo)
      ) {
        return false;
      }
      if (
        filters.createdFrom &&
        parseDateMillis(ticket.createdAt) < parseDateMillis(filters.createdFrom)
      ) {
        return false;
      }
      if (
        filters.createdTo &&
        parseDateMillis(ticket.createdAt) > parseDateMillis(filters.createdTo)
      ) {
        return false;
      }
      if (
        filters.dueFrom &&
        parseDateMillis(ticket.dueAt) < parseDateMillis(filters.dueFrom)
      ) {
        return false;
      }
      if (
        filters.dueTo &&
        parseDateMillis(ticket.dueAt) > parseDateMillis(filters.dueTo)
      ) {
        return false;
      }

      const query = filters.q.trim().toLowerCase();
      if (query) {
        const haystack = [
          ticket.displayId,
          ticket.subject,
          ticket.description,
          ticket.requester?.displayName,
          ticket.requester?.email,
          ticket.assignee?.displayName,
          ticket.assignee?.email,
          ticket.assignedTeam?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }

      return true;
    },
    [currentEmail, filters],
  );

  const applyRealtimeTicketPatch = useCallback(
    (
      ticket: TicketRecord,
      payload: RealtimeTicketChangedEventPayload,
    ): TicketRecord => {
      const next: TicketRecord = { ...ticket };
      if (typeof payload.status === "string" && payload.status) {
        next.status = payload.status as import("../api/client").TicketStatus;
      }
      if (typeof payload.priority === "string" && payload.priority) {
        next.priority =
          payload.priority as import("../api/client").TicketPriority;
      }
      if (typeof payload.updatedAt === "string" && payload.updatedAt) {
        next.updatedAt = payload.updatedAt;
      }
      if (Object.prototype.hasOwnProperty.call(payload, "assignedTeamId")) {
        if (payload.assignedTeamId === null) {
          next.assignedTeam = null;
        } else if (payload.assignedTeam?.id) {
          next.assignedTeam = payload.assignedTeam;
        } else if (
          payload.assignedTeamId &&
          next.assignedTeam?.id !== payload.assignedTeamId
        ) {
          next.assignedTeam = {
            id: payload.assignedTeamId,
            name: next.assignedTeam?.name ?? "Team",
          };
        }
      } else if (payload.assignedTeam?.id) {
        next.assignedTeam = payload.assignedTeam;
      }
      if (Object.prototype.hasOwnProperty.call(payload, "assigneeId")) {
        if (payload.assigneeId === null) {
          next.assignee = null;
        } else if (payload.assignee?.id) {
          next.assignee = payload.assignee;
        } else if (
          payload.assigneeId &&
          next.assignee?.id !== payload.assigneeId
        ) {
          next.assignee = {
            id: payload.assigneeId,
            email: next.assignee?.email ?? "",
            displayName: next.assignee?.displayName ?? "Assigned user",
          };
        }
      } else if (payload.assignee?.id) {
        next.assignee = payload.assignee;
      }
      return next;
    },
    [],
  );

  /**
   * Move the header total with a realtime insert or removal.
   *
   * An approximation between fetches, and deliberately so: an exact count needs
   * an API round trip. The poll and the reconnect refetch both correct it.
   */
  const adjustListTotal = useCallback((delta: number) => {
    setListMeta((prev) =>
      prev ? { ...prev, total: Math.max(0, prev.total + delta) } : prev,
    );
  }, []);

  const maybeHydrateRealtimeTicket = useCallback(
    async (ticketId: string) => {
      if (filters.page > 1) {
        return;
      }
      if (realtimeHydrationInFlightRef.current.has(ticketId)) {
        return;
      }
      realtimeHydrationInFlightRef.current.add(ticketId);
      try {
        const ticket = await fetchTicketById(ticketId);
        // Decided out here, not inside the updater: a state updater must stay
        // pure, and the header total is a second piece of state. A row that the
        // page-size slice hides still belongs in the total.
        const alreadyPresent = ticketsRef.current.some(
          (row) => row.id === ticket.id,
        );
        const belongsInList = matchesTicketFilters(ticket);
        setTickets((prev) => {
          if (prev.some((row) => row.id === ticket.id)) {
            return prev;
          }
          if (!matchesTicketFilters(ticket)) {
            return prev;
          }
          const next = [...prev, ticket].sort((a, b) =>
            compareTickets(a, b, effectiveSort, filters.order),
          );
          return next.slice(0, filters.pageSize);
        });
        if (!alreadyPresent && belongsInList) {
          adjustListTotal(1);
        }
      } catch {
        // Ignore hydration misses for deleted/hidden tickets.
      } finally {
        realtimeHydrationInFlightRef.current.delete(ticketId);
      }
    },
    [
      adjustListTotal,
      effectiveSort,
      filters.order,
      filters.page,
      filters.pageSize,
      matchesTicketFilters,
    ],
  );

  const applyBulkPatchForTicketIds = useCallback(
    (
      ticketIds: string[],
      patcher: (ticket: TicketRecord, nowIso: string) => TicketRecord,
    ) => {
      if (ticketIds.length === 0) {
        return;
      }
      const selectedIdSet = new Set(ticketIds);
      const nowIso = new Date().toISOString();
      setTickets((prev) => {
        let changed = false;
        const next: TicketRecord[] = [];
        for (const ticket of prev) {
          if (!selectedIdSet.has(ticket.id)) {
            next.push(ticket);
            continue;
          }
          changed = true;
          const patched = patcher(ticket, nowIso);
          if (matchesTicketFilters(patched)) {
            next.push(patched);
          }
        }
        if (!changed) {
          return prev;
        }
        next.sort((a, b) => compareTickets(a, b, effectiveSort, filters.order));
        return next;
      });
    },
    [effectiveSort, filters.order, matchesTicketFilters],
  );

  const snapshotTicketsById = useCallback((ticketIds: string[]) => {
    if (ticketIds.length === 0) {
      return new Map<string, TicketRecord>();
    }
    const selectedIdSet = new Set(ticketIds);
    const snapshots = new Map<string, TicketRecord>();
    for (const ticket of ticketsRef.current) {
      if (selectedIdSet.has(ticket.id)) {
        snapshots.set(ticket.id, ticket);
      }
    }
    return snapshots;
  }, []);

  const restoreTicketSnapshots = useCallback(
    (snapshots: Map<string, TicketRecord>) => {
      if (snapshots.size === 0) {
        return;
      }
      const snapshotIds = new Set(snapshots.keys());
      setTickets((prev) => {
        const seenIds = new Set<string>();
        const next: TicketRecord[] = [];
        for (const ticket of prev) {
          if (!snapshotIds.has(ticket.id)) {
            next.push(ticket);
            continue;
          }
          seenIds.add(ticket.id);
          const original = snapshots.get(ticket.id);
          if (original && matchesTicketFilters(original)) {
            next.push(original);
          }
        }
        for (const [ticketId, original] of snapshots.entries()) {
          if (seenIds.has(ticketId)) {
            continue;
          }
          if (matchesTicketFilters(original)) {
            next.push(original);
          }
        }
        next.sort((a, b) => compareTickets(a, b, effectiveSort, filters.order));
        return next;
      });
    },
    [effectiveSort, filters.order, matchesTicketFilters],
  );

  const restoreFailedSnapshots = useCallback(
    (snapshots: Map<string, TicketRecord>, failedTicketIds: string[]) => {
      if (snapshots.size === 0 || failedTicketIds.length === 0) {
        return;
      }
      const failedSet = new Set(failedTicketIds);
      const failedSnapshots = new Map<string, TicketRecord>();
      for (const [ticketId, ticket] of snapshots.entries()) {
        if (failedSet.has(ticketId)) {
          failedSnapshots.set(ticketId, ticket);
        }
      }
      restoreTicketSnapshots(failedSnapshots);
    },
    [restoreTicketSnapshots],
  );

  const failedTicketIdsFromBulkResult = useCallback((result: BulkResult) => {
    const failedTicketIds = result.failedTicketIds ?? [];
    if (failedTicketIds.length > 0) {
      return failedTicketIds;
    }
    if (result.errors.length > 0) {
      return result.errors.map((error) => error.ticketId);
    }
    return [];
  }, []);

  const resolveAssigneeForBulkAction = useCallback(
    (assigneeId?: string): UserRef => {
      const normalizedCurrentEmail = currentEmail.trim().toLowerCase();
      if (assigneeId) {
        const assignedUser = assignableUsers.find(
          (user) => user.id === assigneeId,
        );
        if (assignedUser) {
          return assignedUser;
        }
        return {
          id: assigneeId,
          email: "",
          displayName: "Assigned user",
        };
      }
      const currentUserByEmail = assignableUsers.find(
        (user) => user.email.toLowerCase() === normalizedCurrentEmail,
      );
      if (currentUserByEmail) {
        return currentUserByEmail;
      }
      return {
        id: `me:${normalizedCurrentEmail || "current-user"}`,
        email: currentEmail,
        displayName: currentEmail.split("@")[0] || "You",
      };
    },
    [assignableUsers, currentEmail],
  );

  /**
   * Load the list. A background refresh (the poll and the reconnect catch-up)
   * shows no skeleton, merges rather than replaces, and leaves the rows alone if
   * it fails - a stale list an agent can still read beats an empty one.
   */
  const loadTickets = useCallback(
    async (options: { background?: boolean } = {}) => {
      const isBackgroundRefresh = options.background === true;
      // A foreground load claims the list and supersedes everything older. A
      // background refresh does not: it keeps the current sequence number, so
      // an initial load still in flight is left alone and this refresh is the
      // one discarded if a foreground load starts while it is out.
      const requestSeq = isBackgroundRefresh
        ? ticketsRequestSeqRef.current
        : ++ticketsRequestSeqRef.current;
      if (!isBackgroundRefresh) {
        setLoadingTickets(true);
        setTicketError(null);
      }
      try {
        const response = await fetchTickets(
          { ...apiParams, sort: effectiveSort },
          // A background refresh exists to find what the socket missed, so it
          // must not be served from the 15s hot GET cache - that cache is the
          // very snapshot it is trying to replace.
          isBackgroundRefresh ? { cache: "no-store" } : undefined,
        );
        if (ticketsRequestSeqRef.current !== requestSeq) return;
        setTickets((prev) =>
          isBackgroundRefresh
            ? reconcileTicketRows(prev, response.data)
            : response.data,
        );
        setListMeta(response.meta ?? null);
        setTicketError(null);
        setLastLoadedAt(new Date().toISOString());
        hasLoadedOnceRef.current = true;
      } catch {
        if (ticketsRequestSeqRef.current !== requestSeq) return;
        if (isBackgroundRefresh) return;
        setTicketError("Unable to load tickets.");
        setListMeta(null);
        setTickets([]);
      } finally {
        if (ticketsRequestSeqRef.current === requestSeq && !isBackgroundRefresh) {
          setLoadingTickets(false);
        }
      }
    },
    [apiParams, effectiveSort],
  );

  const searchParamsString = searchParams.toString();
  useEffect(() => {
    loadTickets();
  }, [searchParamsString, loadTickets]);

  useEffect(() => {
    const handleTicketChanged = (event: Event) => {
      const payload = (event as CustomEvent<RealtimeTicketChangedEventPayload>)
        .detail;
      const ticketId = payload?.ticketId;
      if (!ticketId) {
        return;
      }
      // Soft delete / restore are not in-place patches: a deleted ticket must
      // leave every queue immediately (the API hides it from all non-owner
      // reads), and a restored one comes back through the normal hydrate path.
      if (payload.reason === "deleted") {
        const wasPresent = ticketsRef.current.some(
          (ticket) => ticket.id === ticketId,
        );
        setTickets((prev) => prev.filter((ticket) => ticket.id !== ticketId));
        if (wasPresent) {
          adjustListTotal(-1);
        }
        return;
      }
      if (payload.reason === "restored") {
        void maybeHydrateRealtimeTicket(ticketId);
        return;
      }
      // Neither the edited text nor any SLA field is in the realtime payload,
      // so both reasons mean the same thing here: re-read the row.
      if (payload.reason === "edited" || payload.reason === "sla_changed") {
        void fetchTicketById(ticketId)
          .then((fresh) => {
            setTickets((prev) =>
              prev.map((row) => (row.id === ticketId ? { ...row, ...fresh } : row)),
            );
          })
          .catch(() => undefined);
        return;
      }
      const presentBeforePatch = ticketsRef.current.some(
        (ticket) => ticket.id === ticketId,
      );
      // Same reason as the hydrate path: worked out here so the updater stays
      // pure. A status change can move a ticket out of the filter the agent is
      // looking at, which is a removal as far as the header total is concerned.
      const rowBeforePatch = ticketsRef.current.find(
        (ticket) => ticket.id === ticketId,
      );
      const leavesTheList =
        rowBeforePatch !== undefined &&
        !isStaleRealtimePatch(rowBeforePatch, payload) &&
        !matchesTicketFilters(applyRealtimeTicketPatch(rowBeforePatch, payload));
      setTickets((prev) => {
        const index = prev.findIndex((ticket) => ticket.id === ticketId);
        if (index === -1) {
          return prev;
        }
        const current = prev[index];
        if (isStaleRealtimePatch(current, payload)) {
          return prev;
        }
        const patched = applyRealtimeTicketPatch(current, payload);
        if (!matchesTicketFilters(patched)) {
          return prev.filter((ticket) => ticket.id !== ticketId);
        }

        const next = [...prev];
        next[index] = patched;
        next.sort((a, b) => compareTickets(a, b, effectiveSort, filters.order));
        return next;
      });

      if (leavesTheList) {
        adjustListTotal(-1);
      }
      if (!presentBeforePatch) {
        void maybeHydrateRealtimeTicket(ticketId);
      }
    };

    window.addEventListener(
      REALTIME_TICKET_CHANGED_EVENT,
      handleTicketChanged as EventListener,
    );

    return () => {
      window.removeEventListener(
        REALTIME_TICKET_CHANGED_EVENT,
        handleTicketChanged as EventListener,
      );
    };
  }, [
    adjustListTotal,
    applyRealtimeTicketPatch,
    effectiveSort,
    filters.order,
    matchesTicketFilters,
    maybeHydrateRealtimeTicket,
  ]);

  // --- Freshness: the socket is the live path, this is what happens without it.
  //
  // Web PubSub does not replay messages missed while a socket was down, so the
  // reconnect below must re-read the list once or every ticket created during
  // the outage stays invisible until the agent happens to act.
  useEffect(() => {
    if (realtimeAvailable || !isTabVisible || filters.page > 1) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadTickets({ background: true });
    }, LIST_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [filters.page, isTabVisible, loadTickets, realtimeAvailable]);

  useEffect(() => {
    const wasAvailable = previousRealtimeAvailableRef.current;
    previousRealtimeAvailableRef.current = realtimeAvailable;
    if (wasAvailable || !realtimeAvailable || !hasLoadedOnceRef.current) {
      return;
    }
    void loadTickets({ background: true });
  }, [loadTickets, realtimeAvailable]);

  // A tab hidden while disconnected ran no poll at all, so catch up on the way
  // back in rather than making the agent wait out another interval.
  useEffect(() => {
    const wasVisible = previousTabVisibleRef.current;
    previousTabVisibleRef.current = isTabVisible;
    if (wasVisible || !isTabVisible || realtimeAvailable || filters.page > 1) {
      return;
    }
    void loadTickets({ background: true });
  }, [filters.page, isTabVisible, loadTickets, realtimeAvailable]);

  useEffect(() => {
    if (role === "EMPLOYEE") {
      setAssignableUsers([]);
      setRequesterOptions([]);
      return;
    }
    setUsersLoading(true);
    fetchUsers()
      .then((res) => {
        const allUsers = res.data;
        const assignable = allUsers.filter((user) =>
          ["AGENT", "LEAD", "TEAM_ADMIN", "OWNER"].includes(
            (user.role ?? "").toUpperCase(),
          ),
        );
        setAssignableUsers(assignable);
        setRequesterOptions(allUsers);
      })
      .catch(() => {
        setAssignableUsers([]);
        setRequesterOptions([]);
      })
      .finally(() => setUsersLoading(false));
  }, [role]);

  useEffect(() => {
    if (role !== "OWNER" && filters.teamIds.length > 0) {
      setFilters({ teamIds: [] }, { replace: true });
    }
  }, [filters.teamIds.length, role, setFilters]);

  const ticketIds = useMemo(() => tickets.map((t) => t.id), [tickets]);
  const selection = useTicketSelection(ticketIds);
  const focusedTicketId = tickets[focusedRowIndex]?.id ?? null;

  useEffect(() => {
    if (tickets.length === 0) {
      setFocusedRowIndex(0);
      setRangeAnchorIndex(null);
      return;
    }
    setFocusedRowIndex((prev) => Math.min(prev, tickets.length - 1));
  }, [tickets.length]);

  useEffect(() => {
    ticketsRef.current = tickets;
  }, [tickets]);

  useEffect(() => {
    function handleTicketListKeyboardShortcuts(event: KeyboardEvent) {
      if (location.pathname !== "/tickets") {
        return;
      }

      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTypingContext =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (isTypingContext) {
        return;
      }

      if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        setFocusedRowIndex((prev) =>
          Math.min(prev + 1, Math.max(tickets.length - 1, 0)),
        );
        return;
      }

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setFocusedRowIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (event.key.toLowerCase() === "x" && role !== "EMPLOYEE") {
        const currentTicket = tickets[focusedRowIndex];
        if (!currentTicket) return;
        event.preventDefault();

        if (
          event.shiftKey &&
          rangeAnchorIndex !== null &&
          rangeAnchorIndex !== focusedRowIndex
        ) {
          const start = Math.min(rangeAnchorIndex, focusedRowIndex);
          const end = Math.max(rangeAnchorIndex, focusedRowIndex);
          for (let index = start; index <= end; index++) {
            const ticketId = tickets[index]?.id;
            if (ticketId && !selection.isSelected(ticketId)) {
              selection.toggle(ticketId);
            }
          }
          return;
        }

        selection.toggle(currentTicket.id);
        setRangeAnchorIndex(focusedRowIndex);
        return;
      }

      if (event.key === "Enter") {
        const currentTicket = tickets[focusedRowIndex];
        if (!currentTicket) return;
        event.preventDefault();
        navigate(`/tickets/${currentTicket.id}`, {
          state: { fromTicketsPath: `${location.pathname}${location.search}` },
        });
      }
    }

    window.addEventListener("keydown", handleTicketListKeyboardShortcuts);
    return () =>
      window.removeEventListener("keydown", handleTicketListKeyboardShortcuts);
  }, [
    focusedRowIndex,
    location.pathname,
    location.search,
    navigate,
    rangeAnchorIndex,
    role,
    selection,
    tickets,
  ]);

  async function handleBulkAssign(assigneeId?: string) {
    const selectedIds = selection.selectedIds;
    const snapshots = snapshotTicketsById(selectedIds);
    const optimisticAssignee = resolveAssigneeForBulkAction(assigneeId);
    applyBulkPatchForTicketIds(selectedIds, (ticket, nowIso) => ({
      ...ticket,
      assignee: optimisticAssignee,
      updatedAt: nowIso,
    }));

    try {
      const result = await bulkAssignTickets(selectedIds, assigneeId);
      if (result.failed > 0) {
        restoreFailedSnapshots(
          snapshots,
          failedTicketIdsFromBulkResult(result),
        );
      }
      if (result.success > 0) {
        notifyTicketAggregatesChanged();
        notifyTicketReportsChanged();
      }
      return result;
    } catch (error) {
      restoreTicketSnapshots(snapshots);
      throw error;
    }
  }

  async function handleBulkTransfer(newTeamId: string, assigneeId?: string) {
    const selectedIds = selection.selectedIds;
    const snapshots = snapshotTicketsById(selectedIds);
    const assignedTeam = teamsList.find((team) => team.id === newTeamId) ?? {
      id: newTeamId,
      name: "Team",
    };
    const optimisticAssignee = assigneeId
      ? resolveAssigneeForBulkAction(assigneeId)
      : null;

    applyBulkPatchForTicketIds(selectedIds, (ticket, nowIso) => ({
      ...ticket,
      assignedTeam,
      assignee: optimisticAssignee,
      updatedAt: nowIso,
    }));

    try {
      const result = await bulkTransferTickets(
        selectedIds,
        newTeamId,
        assigneeId,
      );
      if (result.failed > 0) {
        restoreFailedSnapshots(
          snapshots,
          failedTicketIdsFromBulkResult(result),
        );
      }
      if (result.success > 0) {
        notifyTicketAggregatesChanged();
        notifyTicketReportsChanged();
      }
      return result;
    } catch (error) {
      restoreTicketSnapshots(snapshots);
      throw error;
    }
  }

  async function handleBulkStatus(status: string) {
    const selectedIds = selection.selectedIds;
    const snapshots = snapshotTicketsById(selectedIds);
    applyBulkPatchForTicketIds(selectedIds, (ticket, nowIso) => ({
      ...ticket,
      status: status as import("../api/client").TicketStatus,
      updatedAt: nowIso,
      completedAt: isResolvedStatus(status) ? nowIso : ticket.completedAt,
    }));

    try {
      const result = await bulkStatusTickets(selectedIds, status);
      if (result.failed > 0) {
        restoreFailedSnapshots(
          snapshots,
          failedTicketIdsFromBulkResult(result),
        );
      }
      if (result.success > 0) {
        notifyTicketAggregatesChanged();
        notifyTicketReportsChanged();
      }
      return result;
    } catch (error) {
      restoreTicketSnapshots(snapshots);
      throw error;
    }
  }

  async function handleBulkPriority(priority: string) {
    const selectedIds = selection.selectedIds;
    const snapshots = snapshotTicketsById(selectedIds);
    applyBulkPatchForTicketIds(selectedIds, (ticket, nowIso) => ({
      ...ticket,
      priority: priority as import("../api/client").TicketPriority,
      updatedAt: nowIso,
    }));

    try {
      const result = await bulkPriorityTickets(selectedIds, priority);
      if (result.failed > 0) {
        restoreFailedSnapshots(
          snapshots,
          failedTicketIdsFromBulkResult(result),
        );
      }
      if (result.success > 0) {
        notifyTicketAggregatesChanged();
        notifyTicketReportsChanged();
      }
      return result;
    } catch (error) {
      restoreTicketSnapshots(snapshots);
      throw error;
    }
  }

  const quickAssigneeValue =
    filters.assigneeIds.length === 1 ? filters.assigneeIds[0] : "";
  const quickPriorityValue =
    filters.priorities.length === 1 ? filters.priorities[0] : "";
  const sortPreset = sortPresetFromFilters(effectiveSort, filters.order);
  const activeFilterCount = countActiveFilterGroups(filters);
  const drawerFilters = advancedDraft ?? filters;

  const totalCount = listMeta?.total ?? tickets.length;
  const countLabel =
    filters.statuses.length > 0
      ? `${totalCount} tickets`
      : filters.statusGroup === "open"
        ? `${totalCount} open tickets`
        : filters.statusGroup === "resolved"
          ? `${totalCount} resolved tickets`
          : `${totalCount} tickets`;

  const pageStart = listMeta ? (listMeta.page - 1) * listMeta.pageSize + 1 : 0;
  const pageEnd = listMeta
    ? Math.min(listMeta.page * listMeta.pageSize, listMeta.total)
    : 0;
  const visiblePages = useMemo(() => {
    if (!listMeta) return [] as number[];
    const current = listMeta.page;
    const total = listMeta.totalPages;
    if (total <= 3)
      return Array.from({ length: total }, (_, index) => index + 1);
    if (current <= 2) return [1, 2, 3];
    if (current >= total - 1) return [total - 2, total - 1, total];
    return [current - 1, current, current + 1];
  }, [listMeta]);

  return (
    <section className={`bg-background animate-fade-in flex flex-col ${isQueueView ? "h-[calc(100vh/var(--ui-zoom))] overflow-hidden" : "max-h-screen overflow-hidden"}`}>
      {/* Header — hidden, tab bar replaces it
      <div className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="px-6 py-4">
          {headerCtx ? (
            <TopBar
              title={headerCtx.title}
              subtitle={headerCtx.subtitle}
              currentEmail={headerCtx.currentEmail}
              onOpenSearch={headerCtx.onOpenSearch}
              notificationProps={headerCtx.notificationProps}
              leftContent={
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-xl font-semibold text-foreground">
                    Tickets
                  </h1>
                  <span className="text-sm text-muted-foreground">
                    ({totalCount} tickets)
                  </span>
                </div>
              }
            />
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold text-foreground">
                  Tickets
                </h1>
                <span className="text-sm text-muted-foreground">
                  ({totalCount} tickets)
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      */}

      {/* Tab bar — always visible */}
      <TicketTabBar
        onSwitchTab={(id) => setActiveTicketId(id)}
      />

      {/* Filter bar — queue view only */}
      {isQueueView && <div className="shrink-0 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 border-r border-border pr-4">
              {(["all", "open", "resolved"] as StatusFilter[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={(filters.statusGroup ?? "all") === value}
                  aria-label={`Filter: ${value === "all" ? "All" : value === "open" ? "Open" : "Resolved"}`}
                  onClick={() =>
                    setFilters({ statusGroup: value, statuses: [] })
                  }
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    (filters.statusGroup ?? "all") === value
                      ? "bg-primary text-white"
                      : "text-foreground hover:bg-accent"
                  }`}
                >
                  {value === "all"
                    ? "All"
                    : value === "open"
                      ? "Open"
                      : "Resolved"}
                </button>
              ))}
            </div>

            <div className="relative min-w-[240px] flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Search by ticket ID, subject, or description..."
                className="h-10 w-full rounded-xl border border-border bg-card shadow-sm pl-9 pr-3 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring/30 transition-all"
              />
            </div>

            {role !== "EMPLOYEE" ? (
              <select
                aria-label="Filter by assignee"
                value={quickAssigneeValue}
                onChange={(event) =>
                  setFilters({
                    assigneeIds: event.target.value ? [event.target.value] : [],
                  })
                }
                className="h-10 rounded-xl border border-border bg-card shadow-sm px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 transition-all"
              >
                <option value="">
                  {usersLoading ? "Loading users..." : "Assignee"}
                </option>
                {assignableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
            ) : null}

            <select
              aria-label="Filter by priority"
              value={quickPriorityValue}
              onChange={(event) =>
                setFilters({
                  priorities: event.target.value ? [event.target.value] : [],
                })
              }
              className="h-10 rounded-xl border border-border bg-card shadow-sm px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 transition-all"
            >
              <option value="">Priority</option>
              <option value="SEV1">SEV1</option>
              <option value="SEV2">SEV2</option>
              <option value="SEV3">SEV3</option>
              <option value="SEV4">SEV4</option>
            </select>

            <input
              type="text"
              aria-label="Filter by tags (comma-separated)"
              placeholder="Tags (csv)"
              value={filters.tags.join(", ")}
              onChange={(event) => {
                const tags = event.target.value
                  .split(",")
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean);
                setFilters({ tags });
              }}
              className="h-10 w-44 rounded-xl border border-border bg-card shadow-sm px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 transition-all"
            />

            <select
              aria-label="Sort tickets"
              value={sortPreset}
              onChange={(event) => {
                const preset = event.target.value as SortPreset;
                if (preset === "updated_desc")
                  setFilters({ sort: "updatedAt", order: "desc" });
                if (preset === "updated_asc")
                  setFilters({ sort: "updatedAt", order: "asc" });
                if (preset === "created_desc")
                  setFilters({ sort: "createdAt", order: "desc" });
                if (preset === "created_asc")
                  setFilters({ sort: "createdAt", order: "asc" });
                if (preset === "completed_desc")
                  setFilters({ sort: "completedAt", order: "desc" });
              }}
              className="h-10 rounded-xl border border-border bg-card shadow-sm px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 transition-all"
            >
              <option value="updated_desc">Sort: Newest</option>
              <option value="updated_asc">Sort: Oldest</option>
              <option value="created_desc">Sort: Created</option>
              <option value="created_asc">Sort: Created (oldest)</option>
              <option value="completed_desc">Sort: Completed</option>
            </select>

            {role !== "EMPLOYEE" ? (
              <div className="relative inline-block" ref={advancedFiltersAnchorRef}>
                <button
                  type="button"
                  onClick={
                    showAdvancedFilters
                      ? closeAdvancedFilters
                      : openAdvancedFilters
                  }
                  aria-expanded={showAdvancedFilters}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card shadow-sm px-3 text-sm text-foreground transition-all hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring/30"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Advanced
                  {activeFilterCount > 0 ? (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                      {activeFilterCount}
                    </span>
                  ) : null}
                </button>

                {showAdvancedFilters ? (
                  <div
                    ref={advancedFiltersDialogRef}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Advanced filters"
                    tabIndex={-1}
                    className="absolute right-0 top-full mt-2 z-40 w-[520px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card shadow-xl flex flex-col"
                    style={{ maxHeight: "min(80vh, 720px)" }}
                  >
                    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                      <h2 className="text-sm font-semibold text-foreground">
                        Advanced Filters
                      </h2>
                      <button
                        type="button"
                        onClick={closeAdvancedFilters}
                        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label="Close advanced filters"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4">
                      <FilterPanel
                        filters={drawerFilters}
                        setFilters={setAdvancedDraftFilters}
                        clearFilters={clearAdvancedDraft}
                        hasActiveFilters={
                          countActiveFilterGroups(drawerFilters) > 0
                        }
                        showTeamFilter={role === "OWNER"}
                        teamsList={teamsList}
                        assignableUsers={assignableUsers}
                        requesterOptions={requesterOptions}
                        drawerMode
                        onSaveSuccess={() => {
                          toast.success("View saved");
                        }}
                        onError={(message) => toast.error(message)}
                        onClose={closeAdvancedFilters}
                      />
                    </div>

                    <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
                      <button
                        type="button"
                        onClick={clearAdvancedDraft}
                        className="text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Clear all
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={closeAdvancedFilters}
                          className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-[12px] font-medium text-foreground hover:bg-accent"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={applyAdvancedDraft}
                          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[12px] font-semibold text-white hover:bg-primary/90"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {role !== "EMPLOYEE" ? (
              <SaveViewButton
                filters={filters}
                disabled={!hasActiveFilters}
              />
            ) : null}

            {role !== "EMPLOYEE" ? (
              <button
                type="button"
                onClick={() => void handleExportCsv()}
                disabled={exportingCsv}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card shadow-sm px-3 text-sm text-foreground transition-all hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                {exportingCsv ? "Exporting…" : "Export"}
              </button>
            ) : null}

            {onCreateTicket ? (
              <button
                type="button"
                onClick={onCreateTicket}
                className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white transition-all hover:bg-primary/90 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring/50"
              >
                <Plus className="h-4 w-4" />
                New Ticket
              </button>
            ) : null}
          </div>
        </div>
      </div>}

      {/* Queue view — ticket list */}
      {isQueueView ? (
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{countLabel}</p>
          {/* Page 2+ polls nothing by design (rows must not move under someone
              paging through history) but still says so when the socket is down. */}
          <ListFreshnessNotice
            connected={realtimeAvailable}
            lastUpdatedAt={lastLoadedAt}
          />
        </div>

        <div
          className={`mt-4 grid transition-all duration-300 ease-out ${
            selection.isSomeSelected && role !== "EMPLOYEE"
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <BulkActionsToolbar
              selectedCount={selection.selectedCount}
              onClearSelection={selection.clearSelection}
              onBulkAssign={handleBulkAssign}
              onBulkTransfer={handleBulkTransfer}
              onBulkStatus={handleBulkStatus}
              onBulkPriority={handleBulkPriority}
              teamsList={teamsList}
              assignableUsers={assignableUsers}
              onSuccess={(message) => {
                toast.success(message);
              }}
              onError={(message) => toast.error(message)}
            />
          </div>
        </div>

        {ticketError ? (
          <div className="mt-4">
            <ErrorState
              title="Unable to load tickets"
              description={ticketError}
              onRetry={loadTickets}
              secondaryAction={{
                label: "Go to Dashboard",
                onClick: () => navigate("/dashboard"),
              }}
            />
          </div>
        ) : null}

        {loadingTickets ? (
          <TicketsTableSkeleton
            className="mt-4"
            rowCount={8}
            showCheckbox={role !== "EMPLOYEE"}
          />
        ) : null}

        {!loadingTickets && !ticketError && tickets.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No tickets found"
              description="Try adjusting your filters or create a new ticket to get started."
              primaryAction={
                onCreateTicket
                  ? { label: "Create Ticket", onClick: onCreateTicket }
                  : undefined
              }
              secondaryAction={
                hasActiveFilters
                  ? { label: "Clear filters", onClick: clearFilters }
                  : undefined
              }
            />
          </div>
        ) : null}

        {!loadingTickets && tickets.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-xl bg-card border border-border shadow-card">
            <TicketTableView
              tickets={tickets}
              role={role}
              focusedTicketId={focusedTicketId}
              selection={{
                isSelected: selection.isSelected,
                toggle: selection.toggle,
                toggleAll: selection.toggleAll,
                isAllSelected: selection.isAllSelected,
              }}
              onRowClick={(ticket, opts) => {
                const tab = {
                  id: ticket.id,
                  displayId: ticket.displayId ?? `#${ticket.number}`,
                  subject: ticket.subject,
                  status: ticket.status,
                  priority: ticket.priority,
                };
                if (opts?.newTab) {
                  ticketTabs.openTab(tab);
                } else {
                  ticketTabs.replaceActiveTab(tab);
                }
                setActiveTicketId(ticket.id);
              }}
              onTicketMutated={() => {
                void loadTickets();
                notifyTicketAggregatesChanged();
                notifyTicketReportsChanged();
              }}
            />

        {listMeta && listMeta.total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/50 px-6 py-3">
            <div className="text-sm text-foreground">
              Showing <span className="font-medium">{pageStart}</span> to{" "}
              <span className="font-medium">{pageEnd}</span> of{" "}
              <span className="font-medium">{listMeta.total}</span> results
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
                Rows
                <select
                  aria-label="Rows per page"
                  value={filters.pageSize}
                  onChange={(event) =>
                    setFilters({
                      pageSize: Number(event.target.value),
                      page: 1,
                    })
                  }
                  className="bg-transparent text-sm text-foreground focus:outline-none"
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>

              <button
                type="button"
                disabled={listMeta.page <= 1}
                onClick={() => setFilters({ page: listMeta.page - 1 })}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>

              {visiblePages.map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setFilters({ page })}
                  className={`rounded-md px-3 py-2 text-sm ${
                    page === listMeta.page
                      ? "bg-primary text-white"
                      : "border border-border bg-card text-foreground hover:bg-accent"
                  }`}
                >
                  {page}
                </button>
              ))}

              <button
                type="button"
                disabled={listMeta.page >= listMeta.totalPages}
                onClick={() => setFilters({ page: listMeta.page + 1 })}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
          </div>
        ) : null}
      </div>
      ) : (
        /* Ticket detail view — embedded in tab */
        <div style={{ height: "calc(100vh / var(--ui-zoom) - 40px)", overflow: "hidden" }}>
          <TicketDetailPage
            ticketId={activeTicketId}
            currentEmail={currentEmail}
            role={role}
            teamsList={teamsList}
            onBack={() => {
              setActiveTicketId(null);
              ticketTabs.switchTab("__queue__");
            }}
            onSelectTicket={(ticket, opts) => {
              const tab = {
                id: ticket.id,
                displayId: ticket.displayId ?? `#${ticket.number}`,
                subject: ticket.subject,
                status: ticket.status,
                priority: ticket.priority,
              };
              if (opts?.newTab) {
                ticketTabs.openTab(tab);
              } else {
                ticketTabs.replaceActiveTab(tab);
              }
              setActiveTicketId(ticket.id);
            }}
          />
        </div>
      )}

    </section>
  );
}
