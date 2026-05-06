import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Eye,
  MoreVertical,
  Search,
  Tag,
  UserPlus,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  bulkPriorityTickets,
  assignTicket,
  fetchTicketById,
  fetchTickets,
  fetchTeamMembers,
  transferTicket,
  transitionTicket,
  type TeamMember,
  type TeamRef,
  type TicketRecord,
} from "../api/client";
import { RelativeTime } from "../components/RelativeTime";
import { TopBar } from "../components/TopBar";
import { useHeaderContext } from "../contexts/HeaderContext";
import { useToast } from "../hooks/useToast";
import {
  REALTIME_TICKET_CHANGED_EVENT,
  type RealtimeTicketChangedEventPayload,
} from "../realtime/events";
import type { Role } from "../types";
import {
  formatStatus,
  formatTicketId,
  getSlaTone,
  initialsFor,
} from "../utils/format";
import { priorityBadgeClass, statusBadgeClass } from "../utils/statusColors";
import { useTicketDataInvalidation } from "../contexts/TicketDataInvalidationContext";

const TRIAGE_COLUMNS: Array<{
  key: import("../api/client").TicketStatus;
  label: string;
}> = [
  { key: "NEW", label: "New" },
  { key: "TRIAGED", label: "Triaged" },
  { key: "ASSIGNED", label: "Assigned" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "WAITING_ON_REQUESTER", label: "Waiting on Requester" },
  { key: "WAITING_ON_VENDOR", label: "Waiting on Vendor" },
  { key: "REOPENED", label: "Reopened" },
];
const TRIAGE_COLUMN_KEYS = TRIAGE_COLUMNS.map((column) => column.key);

const PRIORITY_OPTIONS = [
  { label: "P1", value: "P1" },
  { label: "P2", value: "P2" },
  { label: "P3", value: "P3" },
  { label: "P4", value: "P4" },
];

const CARD_MENU_WIDTH = 208;
const CARD_MENU_MARGIN = 8;
const CARD_MENU_APPROX_HEIGHT = 220;

type CardSubmenuType = "assign" | "move" | "priority" | "transfer";

function parseDateMillis(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortByUpdatedDesc(tickets: TicketRecord[]) {
  return [...tickets].sort(
    (a, b) => parseDateMillis(b.updatedAt) - parseDateMillis(a.updatedAt),
  );
}

export function TriageBoardPage({
  teamsList,
  role,
}: {
  teamsList: TeamRef[];
  role: Role;
}) {
  const headerCtx = useHeaderContext();
  const location = useLocation();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingActionTicketIds, setPendingActionTicketIds] = useState<
    Set<string>
  >(() => new Set());
  const [draggingTicketId, setDraggingTicketId] = useState<string | null>(null);
  const [draggingStatus, setDraggingStatus] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [activeCardMenu, setActiveCardMenu] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<{
    ticketId: string;
    type: CardSubmenuType;
  } | null>(null);
  const [teamMembersByTeamId, setTeamMembersByTeamId] = useState<
    Record<
      string,
      { loading: boolean; members: TeamMember[]; error: string | null }
    >
  >({});
  const loadRequestIdRef = useRef(0);
  const ticketSnapshotRef = useRef<TicketRecord[]>([]);
  const realtimeHydrationInFlightRef = useRef<Set<string>>(new Set());
  const draggingTicketIdRef = useRef<string | null>(null);
  const toast = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [teamFilterId, setTeamFilterId] = useState("all");
  const isOwner = role === "OWNER";
  const { notifyTicketAggregatesChanged, notifyTicketReportsChanged } =
    useTicketDataInvalidation();

  useEffect(() => {
    loadTickets();
  }, [teamFilterId, isOwner]);

  useEffect(() => {
    const handleTicketChanged = (event: Event) => {
      const payload = (event as CustomEvent<RealtimeTicketChangedEventPayload>)
        .detail;
      const ticketId = payload?.ticketId;
      if (!ticketId) {
        return;
      }

      const presentBeforePatch = ticketSnapshotRef.current.some(
        (ticket) => ticket.id === ticketId,
      );

      setTickets((prev) => {
        const index = prev.findIndex((ticket) => ticket.id === ticketId);
        if (index === -1) {
          return prev;
        }

        const current = prev[index];
        const currentUpdatedAtMs = parseDateMillis(current.updatedAt);
        const incomingUpdatedAtMs = parseDateMillis(payload.updatedAt);

        if (
          incomingUpdatedAtMs > 0 &&
          incomingUpdatedAtMs < currentUpdatedAtMs
        ) {
          return prev;
        }

        const patched: TicketRecord = { ...current };
        if (typeof payload.status === "string" && payload.status) {
          patched.status =
            payload.status as import("../api/client").TicketStatus;
        }
        if (typeof payload.priority === "string" && payload.priority) {
          patched.priority =
            payload.priority as import("../api/client").TicketPriority;
        }
        if (typeof payload.updatedAt === "string" && payload.updatedAt) {
          patched.updatedAt = payload.updatedAt;
        }
        if (Object.prototype.hasOwnProperty.call(payload, "assignedTeamId")) {
          if (payload.assignedTeamId === null) {
            patched.assignedTeam = null;
          } else if (payload.assignedTeam?.id) {
            patched.assignedTeam = payload.assignedTeam;
          } else if (
            payload.assignedTeamId &&
            patched.assignedTeam?.id !== payload.assignedTeamId
          ) {
            patched.assignedTeam = {
              id: payload.assignedTeamId,
              name: patched.assignedTeam?.name ?? "Team",
            };
          }
        } else if (payload.assignedTeam?.id) {
          patched.assignedTeam = payload.assignedTeam;
        }
        if (Object.prototype.hasOwnProperty.call(payload, "assigneeId")) {
          if (payload.assigneeId === null) {
            patched.assignee = null;
          } else if (payload.assignee?.id) {
            patched.assignee = payload.assignee;
          } else if (
            payload.assigneeId &&
            patched.assignee?.id !== payload.assigneeId
          ) {
            patched.assignee = {
              id: payload.assigneeId,
              email: patched.assignee?.email ?? "",
              displayName: patched.assignee?.displayName ?? "Assigned user",
            };
          }
        } else if (payload.assignee?.id) {
          patched.assignee = payload.assignee;
        }

        const belongsToVisibleTeam =
          teamFilterId === "all" || patched.assignedTeam?.id === teamFilterId;
        const isVisibleStatus = TRIAGE_COLUMN_KEYS.includes(patched.status);
        if (!belongsToVisibleTeam || !isVisibleStatus) {
          return prev.filter((ticket) => ticket.id !== ticketId);
        }

        const next = [...prev];
        next[index] = patched;
        return sortByUpdatedDesc(next);
      });

      if (presentBeforePatch) {
        return;
      }

      if (realtimeHydrationInFlightRef.current.has(ticketId)) {
        return;
      }

      realtimeHydrationInFlightRef.current.add(ticketId);
      void fetchTicketById(ticketId)
        .then((ticket) => {
          setTickets((prev) => {
            if (prev.some((row) => row.id === ticket.id)) {
              return prev;
            }
            if (!TRIAGE_COLUMN_KEYS.includes(ticket.status)) {
              return prev;
            }
            if (
              teamFilterId !== "all" &&
              ticket.assignedTeam?.id !== teamFilterId
            ) {
              return prev;
            }
            return sortByUpdatedDesc([...prev, ticket]);
          });
        })
        .catch(() => {
          // Ignore hydration misses for hidden/deleted tickets.
        })
        .finally(() => {
          realtimeHydrationInFlightRef.current.delete(ticketId);
        });
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
  }, [teamFilterId]);

  useEffect(() => {
    if (!isOwner && teamFilterId !== "all") {
      setTeamFilterId("all");
    }
  }, [isOwner, teamFilterId]);

  useEffect(() => {
    if (teamFilterId === "all") {
      return;
    }
    const exists = teamsList.some((team) => team.id === teamFilterId);
    if (!exists) {
      setTeamFilterId("all");
    }
  }, [teamsList, teamFilterId]);

  useEffect(() => {
    function handleDocumentClick(event: globalThis.MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-card-menu]")) {
        setActiveCardMenu(null);
        setActiveSubmenu(null);
      }
    }
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, []);

  async function loadTickets() {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError(null);
    setActionError(null);
    try {
      const response = await fetchTickets({
        statusGroup: "open",
        sort: "updatedAt",
        order: "desc",
        pageSize: 100,
        includeTotal: false,
        teamId: isOwner && teamFilterId !== "all" ? teamFilterId : undefined,
      });
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      setTickets(response.data);
    } catch (err) {
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      setError("Unable to load triage tickets.");
      setTickets([]);
    } finally {
      if (loadRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    ticketSnapshotRef.current = tickets;
  }, [tickets]);

  useEffect(() => {
    draggingTicketIdRef.current = draggingTicketId;
  }, [draggingTicketId]);

  function isVisibleOnBoard(
    ticket: Pick<TicketRecord, "status" | "assignedTeam">,
  ) {
    const belongsToVisibleTeam =
      teamFilterId === "all" || ticket.assignedTeam?.id === teamFilterId;
    const isVisibleStatus = TRIAGE_COLUMN_KEYS.includes(ticket.status);
    return belongsToVisibleTeam && isVisibleStatus;
  }

  function getTicketSnapshot(ticketId: string) {
    return (
      ticketSnapshotRef.current.find((item) => item.id === ticketId) ?? null
    );
  }

  function startTicketAction(ticketId: string) {
    setPendingActionTicketIds((prev) => {
      if (prev.has(ticketId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(ticketId);
      return next;
    });
  }

  function endTicketAction(ticketId: string) {
    setPendingActionTicketIds((prev) => {
      if (!prev.has(ticketId)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(ticketId);
      return next;
    });
  }

  function isTicketActionInProgress(ticketId: string) {
    return pendingActionTicketIds.has(ticketId);
  }

  function patchTicketInPlace(
    ticketId: string,
    patcher: (ticket: TicketRecord) => TicketRecord,
  ) {
    setTickets((prev) => {
      const index = prev.findIndex((item) => item.id === ticketId);
      if (index === -1) {
        return prev;
      }
      const patched = patcher(prev[index]);
      if (!isVisibleOnBoard(patched)) {
        return prev.filter((item) => item.id !== ticketId);
      }
      const next = [...prev];
      next[index] = patched;
      return sortByUpdatedDesc(next);
    });
  }

  function reconcileTicketFromServer(ticketId: string, updated: TicketRecord) {
    setTickets((prev) => {
      const index = prev.findIndex((item) => item.id === ticketId);
      if (index === -1) {
        if (!isVisibleOnBoard(updated)) {
          return prev;
        }
        return sortByUpdatedDesc([...prev, updated]);
      }
      const merged = { ...prev[index], ...updated };
      if (!isVisibleOnBoard(merged)) {
        return prev.filter((item) => item.id !== ticketId);
      }
      const next = [...prev];
      next[index] = merged;
      return sortByUpdatedDesc(next);
    });
  }

  function restoreTicket(previousTicket: TicketRecord | null) {
    if (!previousTicket) {
      return;
    }
    setTickets((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.id === previousTicket.id,
      );
      if (!isVisibleOnBoard(previousTicket)) {
        if (existingIndex === -1) {
          return prev;
        }
        return prev.filter((item) => item.id !== previousTicket.id);
      }
      if (existingIndex === -1) {
        return sortByUpdatedDesc([...prev, previousTicket]);
      }
      const next = [...prev];
      next[existingIndex] = previousTicket;
      return sortByUpdatedDesc(next);
    });
  }

  async function handleAssignSelf(ticket: TicketRecord) {
    const previousTicket = getTicketSnapshot(ticket.id);
    if (!previousTicket) {
      return;
    }
    startTicketAction(ticket.id);
    setActionError(null);
    const currentUser = headerCtx?.currentUser;
    patchTicketInPlace(ticket.id, (current) => ({
      ...current,
      assignee: currentUser
        ? {
            id: currentUser.id,
            email: currentUser.email,
            displayName: currentUser.displayName,
            role: currentUser.role,
          }
        : current.assignee,
    }));
    try {
      const updated = await assignTicket(ticket.id, {});
      reconcileTicketFromServer(ticket.id, updated);
      toast.success("Ticket assigned to you.");
      notifyTicketAggregatesChanged();
      notifyTicketReportsChanged();
    } catch (err) {
      restoreTicket(previousTicket);
      setActionError("Unable to assign ticket.");
      toast.error("Unable to assign ticket.");
    } finally {
      endTicketAction(ticket.id);
    }
  }

  async function handleAssignUser(
    ticket: TicketRecord,
    assigneeId: string,
    assigneeName: string,
  ) {
    const previousTicket = getTicketSnapshot(ticket.id);
    if (!previousTicket) {
      return;
    }
    startTicketAction(ticket.id);
    setActionError(null);
    patchTicketInPlace(ticket.id, (current) => ({
      ...current,
      assignee: {
        id: assigneeId,
        displayName: assigneeName,
        email:
          current.assignee?.id === assigneeId ? current.assignee.email : "",
      },
    }));
    try {
      const updated = await assignTicket(ticket.id, { assigneeId });
      reconcileTicketFromServer(ticket.id, updated);
      toast.success(`Assigned to ${assigneeName}.`);
      notifyTicketAggregatesChanged();
      notifyTicketReportsChanged();
    } catch (err) {
      restoreTicket(previousTicket);
      setActionError("Unable to assign ticket.");
      toast.error("Unable to assign ticket.");
    } finally {
      endTicketAction(ticket.id);
    }
  }

  async function handlePriorityChange(
    ticketId: string,
    priority: string,
    priorityLabel: string,
  ) {
    const previousTicket = getTicketSnapshot(ticketId);
    if (!previousTicket) {
      return;
    }
    startTicketAction(ticketId);
    setActionError(null);
    patchTicketInPlace(ticketId, (current) => ({
      ...current,
      priority: priority as import("../api/client").TicketPriority,
    }));
    try {
      const result = await bulkPriorityTickets([ticketId], priority);
      if (result.success > 0) {
        toast.success(`Priority changed to ${priorityLabel}.`);
      } else {
        throw new Error("No tickets updated");
      }
    } catch (err) {
      restoreTicket(previousTicket);
      setActionError("Unable to update priority.");
      toast.error("Unable to update priority.");
    } finally {
      endTicketAction(ticketId);
    }
  }

  async function handleTransfer(
    ticketId: string,
    newTeamId: string,
    newTeamName: string,
  ) {
    const previousTicket = getTicketSnapshot(ticketId);
    if (!previousTicket) {
      return;
    }
    startTicketAction(ticketId);
    setActionError(null);
    patchTicketInPlace(ticketId, (current) => ({
      ...current,
      assignedTeam: { id: newTeamId, name: newTeamName },
      assignee: null,
    }));
    try {
      const updated = await transferTicket(ticketId, { newTeamId });
      reconcileTicketFromServer(ticketId, updated);
      toast.success(`Transferred to ${newTeamName}.`);
      notifyTicketAggregatesChanged();
      notifyTicketReportsChanged();
    } catch (err) {
      restoreTicket(previousTicket);
      setActionError("Unable to transfer ticket.");
      toast.error("Unable to transfer ticket.");
    } finally {
      endTicketAction(ticketId);
    }
  }

  async function ensureTeamMembersLoaded(teamId: string) {
    const existing = teamMembersByTeamId[teamId];
    if (existing?.loading || existing?.error === null) {
      return;
    }
    setTeamMembersByTeamId((prev) => ({
      ...prev,
      [teamId]: { loading: true, members: [], error: null },
    }));
    try {
      const response = await fetchTeamMembers(teamId);
      setTeamMembersByTeamId((prev) => ({
        ...prev,
        [teamId]: { loading: false, members: response.data, error: null },
      }));
    } catch (err) {
      setTeamMembersByTeamId((prev) => ({
        ...prev,
        [teamId]: {
          loading: false,
          members: [],
          error: "Unable to load team members.",
        },
      }));
    }
  }

  async function handleTransition(ticketId: string, status: string) {
    const ticket = getTicketSnapshot(ticketId);
    if (!ticket) {
      return;
    }
    if (!isValidTransition(ticket, status)) {
      const message = `Cannot move from ${formatStatus(ticket.status)} to ${formatStatus(status)}.`;
      setActionError(message);
      toast.error(message);
      return;
    }
    startTicketAction(ticketId);
    setActionError(null);
    patchTicketInPlace(ticketId, (current) => ({
      ...current,
      status: status as import("../api/client").TicketStatus,
    }));
    try {
      const updated = await transitionTicket(ticketId, {
        status: status as import("../api/client").TicketStatus,
      });
      reconcileTicketFromServer(ticketId, updated);
      toast.success(`Moved to ${formatStatus(status)}.`);
      notifyTicketAggregatesChanged();
      // Only some status changes materially affect report data; for now, refresh
      // reports when tickets move out of open states.
      if (status === "RESOLVED" || status === "CLOSED") {
        notifyTicketReportsChanged();
      }
    } catch (err) {
      restoreTicket(ticket);
      setActionError("Unable to move ticket to that status.");
      toast.error("Unable to move ticket to that status.");
    } finally {
      endTicketAction(ticketId);
    }
  }

  function handleDragStart(
    event: DragEvent<HTMLDivElement>,
    ticket: TicketRecord,
  ) {
    setDraggingTicketId(ticket.id);
    setDraggingStatus(ticket.status);
    event.dataTransfer.setData(
      "text/plain",
      JSON.stringify({ id: ticket.id, status: ticket.status }),
    );
    event.dataTransfer.effectAllowed = "move";
  }

  function clearDragState() {
    setDraggingTicketId(null);
    setDraggingStatus(null);
    setDragOverColumn(null);
  }

  function clearDragStateForTicket(ticketId: string) {
    if (draggingTicketIdRef.current !== ticketId) {
      return;
    }
    clearDragState();
  }

  function handleDragEnd() {
    clearDragState();
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!draggingStatus) {
      return;
    }
    event.preventDefault();
  }

  function handleDragEnter(status: string) {
    if (!draggingStatus) {
      return;
    }
    const ticket = draggingTicketId
      ? tickets.find((item) => item.id === draggingTicketId)
      : null;
    if (!ticket) {
      return;
    }
    if (!isValidTransition(ticket, status)) {
      return;
    }
    setDragOverColumn(status);
  }

  function handleDragLeave() {
    setDragOverColumn(null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, status: string) {
    const droppedTicketId = draggingTicketId;
    const droppedFromStatus = draggingStatus;
    setDragOverColumn(null);

    if (!droppedFromStatus || !droppedTicketId) {
      clearDragState();
      return;
    }
    event.preventDefault();
    const draggingTicket = tickets.find((item) => item.id === droppedTicketId);
    if (!draggingTicket) {
      clearDragStateForTicket(droppedTicketId);
      return;
    }
    if (!isValidTransition(draggingTicket, status)) {
      toast.error(
        `Cannot move from ${formatStatus(droppedFromStatus)} to ${formatStatus(status)}.`,
      );
      clearDragStateForTicket(droppedTicketId);
      return;
    }
    const payload = event.dataTransfer.getData("text/plain");
    if (!payload) {
      clearDragStateForTicket(droppedTicketId);
      return;
    }
    try {
      const { id } = JSON.parse(payload) as { id: string; status?: string };
      const ticket = tickets.find((item) => item.id === id);
      if (!ticket || ticket.status === status) {
        if (ticket?.status === status) {
          toast.info("Ticket already in that status.");
        }
        clearDragStateForTicket(droppedTicketId);
        return;
      }
      void handleTransition(ticket.id, status).finally(() => {
        clearDragStateForTicket(droppedTicketId);
      });
    } catch {
      clearDragStateForTicket(droppedTicketId);
      return;
    }
  }

  function handleCardClick(ticketId: string) {
    navigate(`/tickets/${ticketId}`, {
      state: { fromTicketsPath: `${location.pathname}${location.search}` },
    });
  }

  function toggleCardMenu(
    event: MouseEvent<HTMLButtonElement>,
    ticketId: string,
  ) {
    event.stopPropagation();
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    setActiveCardMenu((prev) => {
      const next = prev === ticketId ? null : ticketId;
      if (!next) {
        setActiveSubmenu(null);
        setMenuAnchor(null);
      } else {
        const preferredLeft = rect.right - CARD_MENU_WIDTH;
        const maxLeft = window.innerWidth - CARD_MENU_WIDTH - CARD_MENU_MARGIN;
        const left = Math.max(
          CARD_MENU_MARGIN,
          Math.min(preferredLeft, maxLeft),
        );
        const preferredTop = rect.bottom + 4;
        const maxTop =
          window.innerHeight - CARD_MENU_APPROX_HEIGHT - CARD_MENU_MARGIN;
        const top = Math.max(CARD_MENU_MARGIN, Math.min(preferredTop, maxTop));
        setMenuAnchor({ top, left });
      }
      return next;
    });
  }

  function toggleSubmenu(
    event: MouseEvent<HTMLButtonElement>,
    ticket: TicketRecord,
    type: CardSubmenuType,
  ) {
    event.stopPropagation();
    setActiveSubmenu((prev) => {
      if (prev?.ticketId === ticket.id && prev.type === type) {
        return null;
      }
      return { ticketId: ticket.id, type };
    });
    if (type === "assign" && ticket.assignedTeam?.id) {
      void ensureTeamMembersLoaded(ticket.assignedTeam.id);
    }
  }

  function closeMenus() {
    setActiveSubmenu(null);
    setActiveCardMenu(null);
    setMenuAnchor(null);
  }

  function getPriorityBadge(priority: string) {
    const normalized = priority.toUpperCase();
    const label =
      normalized === "P1" || normalized === "URGENT"
        ? "P1"
        : normalized === "P2" || normalized === "HIGH"
          ? "P2"
          : normalized === "P3" || normalized === "MEDIUM"
            ? "P3"
            : normalized === "P4" || normalized === "LOW"
              ? "P4"
              : priority;
    return { label, className: priorityBadgeClass(priority) };
  }

  function getSlaChipClass(label: string) {
    if (label === "Breached") {
      return "bg-red-100 text-red-700";
    }
    if (label === "At risk") {
      return "bg-orange-100 text-orange-700";
    }
    if (label === "Paused" || label === "Waiting") {
      return "bg-orange-100 text-orange-700";
    }
    return "bg-green-100 text-green-700";
  }

  function isValidTransition(ticket: TicketRecord, to: string) {
    const from = ticket.status;
    if (from === to) {
      return true;
    }
    return (ticket.allowedTransitions ?? []).includes(to);
  }

  function getPossibleMoves(ticket: TicketRecord) {
    return ticket.allowedTransitions ?? [];
  }

  const filteredTickets = useMemo(() => {
    if (!searchQuery.trim()) {
      return tickets;
    }
    const lowered = searchQuery.toLowerCase();
    return tickets.filter((ticket) => {
      return (
        ticket.subject.toLowerCase().includes(lowered) ||
        ticket.requester?.displayName?.toLowerCase().includes(lowered) ||
        ticket.assignedTeam?.name?.toLowerCase().includes(lowered) ||
        formatTicketId(ticket).toLowerCase().includes(lowered)
      );
    });
  }, [tickets, searchQuery]);

  const grouped = useMemo(() => {
    const map = new Map<string, TicketRecord[]>();
    TRIAGE_COLUMNS.forEach((col) => map.set(col.key, []));
    filteredTickets.forEach((ticket) => {
      if (!map.has(ticket.status)) {
        map.set(ticket.status, []);
      }
      map.get(ticket.status)?.push(ticket);
    });
    return map;
  }, [filteredTickets]);

  return (
    <section className="min-h-full bg-background animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto max-w-none px-6 py-4">
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
                    Triage Board
                  </h1>
                  <span className="text-sm text-muted-foreground">
                    ({filteredTickets.length} tickets)
                  </span>
                </div>
              }
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold text-foreground">
                Triage Board
              </h1>
              <span className="text-sm text-muted-foreground">
                ({filteredTickets.length} tickets)
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-none p-6">
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        {actionError && (
          <p className="mb-2 text-sm text-red-600">{actionError}</p>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[260px] flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by ID, subject, requester, or team..."
              className="h-10 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>

          {isOwner && (
            <select
              value={teamFilterId}
              onChange={(event) => setTeamFilterId(event.target.value)}
              className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="all">All teams</option>
              {teamsList.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          )}

          {(searchQuery.trim() || (isOwner && teamFilterId !== "all")) && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                if (isOwner) {
                  setTeamFilterId("all");
                }
              }}
              className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground transition-colors hover:bg-accent"
            >
              Clear
            </button>
          )}
        </div>

        {loading && (
          <div className="flex gap-6 overflow-x-auto pb-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={`col-skel-${i}`} className="w-80 flex-shrink-0">
                <div className="mb-3 h-5 w-28 skeleton-shimmer rounded" />
                <div className="space-y-3 rounded-xl border border-border bg-muted p-3">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div
                      key={`card-skel-${i}-${j}`}
                      className="rounded-lg border border-border bg-card p-4"
                    >
                      <div className="mb-2 h-4 w-3/4 skeleton-shimmer rounded" />
                      <div className="mb-3 h-3 w-1/2 skeleton-shimmer rounded" />
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-14 skeleton-shimmer rounded-full" />
                        <div className="h-5 w-14 skeleton-shimmer rounded-full" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && (
          <div className="overflow-x-auto pb-4">
            <div className="flex space-x-4">
              {TRIAGE_COLUMNS.map((column) => {
                const columnTickets = grouped.get(column.key) ?? [];
                return (
                  <div
                    key={column.key}
                    className="w-80 flex-shrink-0"
                    onDragOver={handleDragOver}
                    onDragEnter={() => handleDragEnter(column.key)}
                    onDragLeave={handleDragLeave}
                    onDrop={(event) => handleDrop(event, column.key)}
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <h2 className="text-sm font-semibold text-foreground">
                          {column.label}
                        </h2>
                        <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-accent px-2 text-xs font-medium text-foreground">
                          {columnTickets.length}
                        </span>
                      </div>
                    </div>

                    <div
                      className={`h-[680px] min-h-[400px] overflow-y-auto rounded-lg border-2 bg-muted p-3 transition-colors [&::-webkit-scrollbar-thumb]:rounded-[3px] [&::-webkit-scrollbar-thumb]:bg-muted [&::-webkit-scrollbar-track]:rounded-[3px] [&::-webkit-scrollbar-track]:bg-accent [&::-webkit-scrollbar]:w-1.5 ${
                        dragOverColumn === column.key
                          ? "border-primary bg-blue-100/60"
                          : "border-border"
                      }`}
                    >
                      {columnTickets.length === 0 ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">
                          No tickets
                        </div>
                      ) : (
                        columnTickets.map((ticket) => {
                          const priority = getPriorityBadge(ticket.priority);
                          const sla = getSlaTone({
                            dueAt: ticket.dueAt,
                            completedAt: ticket.completedAt,
                            status: ticket.status,
                            slaPausedAt: ticket.slaPausedAt,
                          });
                          const tags = [
                            ticket.category?.name,
                            ticket.channel,
                          ].filter(Boolean) as string[];
                          const possibleMoves = getPossibleMoves(ticket);
                          const assigneeName =
                            ticket.assignee?.displayName ??
                            ticket.assignee?.email ??
                            "";

                          return (
                            <div
                              key={ticket.id}
                              draggable
                              onDragStart={(event) =>
                                handleDragStart(event, ticket)
                              }
                              onDragEnd={handleDragEnd}
                              onClick={() => handleCardClick(ticket.id)}
                              className={`mb-2 cursor-grab overflow-hidden rounded-lg border border-border bg-card p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing ${
                                draggingTicketId === ticket.id
                                  ? "opacity-50"
                                  : ""
                              }`}
                            >
                              <div className="mb-1 flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="mb-1 flex items-center gap-2">
                                    <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      {formatTicketId(ticket)}
                                    </span>
                                    <span
                                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${priority.className}`}
                                    >
                                      {priority.label}
                                    </span>
                                    <span
                                      className={`ml-auto whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${getSlaChipClass(sla.label)}`}
                                    >
                                      {sla.label}
                                    </span>
                                  </div>
                                  <h3 className="truncate text-sm font-medium text-foreground">
                                    {ticket.subject}
                                  </h3>
                                </div>
                                <div
                                  className="relative flex-shrink-0 pl-1"
                                  data-card-menu
                                >
                                  <button
                                    type="button"
                                    onClick={(event) =>
                                      toggleCardMenu(event, ticket.id)
                                    }
                                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-muted-foreground"
                                    aria-label="Ticket actions"
                                  >
                                    <MoreVertical className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>

                              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                                <span className="truncate">
                                  {ticket.requester?.displayName ??
                                    "Requester unknown"}
                                </span>
                                <span className="text-muted-foreground">•</span>
                                <span className="truncate">
                                  {ticket.assignedTeam?.name ??
                                    "Unassigned team"}
                                </span>
                                <span className="text-muted-foreground">•</span>
                                {ticket.assignee ? (
                                  <button
                                    type="button"
                                    onClick={(event) => event.stopPropagation()}
                                    className="group inline-flex items-center gap-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-accent"
                                    title={assigneeName}
                                  >
                                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[9px] font-bold text-white shadow-sm ring-1 ring-slate-100">
                                      {initialsFor(assigneeName || "U")}
                                    </span>
                                    <span className="hidden sm:inline truncate max-w-[100px] group-hover:inline">
                                      {assigneeName}
                                    </span>
                                  </button>
                                ) : (
                                  <span className="text-muted-foreground">
                                    Unassigned
                                  </span>
                                )}
                              </div>

                              {tags.length > 0 && (
                                <div className="mb-1 flex flex-wrap gap-1">
                                  {tags.map((tag) => (
                                    <span
                                      key={tag}
                                      className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[11px] text-foreground"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}

                              <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                                {possibleMoves.length > 0 && (
                                  <div
                                    className="relative min-w-0 flex-1"
                                    onClick={(event) => event.stopPropagation()}
                                    onKeyDown={(event) =>
                                      event.stopPropagation()
                                    }
                                  >
                                    <button
                                      type="button"
                                      className="flex w-full items-center justify-between rounded-md px-2 py-1 transition-all outline-none disabled:opacity-50 text-left min-w-0 bg-muted border border-border hover:bg-accent hover:shadow-sm focus:ring-2 focus:ring-ring/40"
                                    >
                                      <span className="truncate">
                                        <span
                                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide border ${statusBadgeClass(ticket.status)}`}
                                        >
                                          {formatStatus(ticket.status)}
                                        </span>
                                      </span>
                                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform" />
                                    </button>
                                    <select
                                      id={`triage-move-${ticket.id}`}
                                      defaultValue=""
                                      disabled={isTicketActionInProgress(
                                        ticket.id,
                                      )}
                                      onChange={(event) => {
                                        const nextStatus = event.target.value;
                                        if (
                                          !nextStatus ||
                                          nextStatus === ticket.status
                                        ) {
                                          return;
                                        }
                                        void handleTransition(
                                          ticket.id,
                                          nextStatus,
                                        );
                                        event.target.value = "";
                                      }}
                                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                    >
                                      <option value="">
                                        {formatStatus(ticket.status)}
                                      </option>
                                      {possibleMoves.map((status) => (
                                        <option key={status} value={status}>
                                          {formatStatus(status)}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}

                                <span className="shrink-0 whitespace-nowrap text-right">
                                  Updated{" "}
                                  <RelativeTime value={ticket.updatedAt} />
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeCardMenu &&
          menuAnchor &&
          (() => {
            const ticket = tickets.find((t) => t.id === activeCardMenu);
            if (!ticket) return null;
            const possibleMoves = getPossibleMoves(ticket);
            const teamId = ticket.assignedTeam?.id;
            const teamMembersState = teamId
              ? teamMembersByTeamId[teamId]
              : undefined;
            const isAssignSubmenuOpen =
              activeSubmenu?.ticketId === ticket.id &&
              activeSubmenu.type === "assign";
            const isMoveSubmenuOpen =
              activeSubmenu?.ticketId === ticket.id &&
              activeSubmenu.type === "move";
            const isPrioritySubmenuOpen =
              activeSubmenu?.ticketId === ticket.id &&
              activeSubmenu.type === "priority";
            const isTransferSubmenuOpen =
              activeSubmenu?.ticketId === ticket.id &&
              activeSubmenu.type === "transfer";
            const openSubmenuToLeft =
              menuAnchor.left + CARD_MENU_WIDTH + 260 >
              window.innerWidth - CARD_MENU_MARGIN;
            const submenuPositionClass = openSubmenuToLeft
              ? "right-full mr-1"
              : "left-full ml-1";
            return createPortal(
              <div
                data-card-menu
                className="w-52 rounded-md border border-border bg-card py-1 shadow-lg"
                style={{
                  position: "fixed",
                  top: menuAnchor.top,
                  left: menuAnchor.left,
                  zIndex: 9999,
                }}
              >
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => toggleSubmenu(e, ticket, "assign")}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="flex items-center gap-2">
                      <UserPlus className="h-4 w-4" />
                      <span>Assign to...</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {isAssignSubmenuOpen && (
                    <div
                      className={`absolute top-0 z-20 min-w-52 rounded-md border border-border bg-card py-1 shadow-lg ${submenuPositionClass}`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeMenus();
                          void handleAssignSelf(ticket);
                        }}
                        disabled={isTicketActionInProgress(ticket.id)}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                      >
                        <UserPlus className="h-4 w-4" />
                        <span>Assign to me</span>
                      </button>
                      <div className="my-1 border-t border-border" />
                      {!teamId && (
                        <p className="px-4 py-2 text-xs text-muted-foreground">
                          No team on ticket
                        </p>
                      )}
                      {teamId && teamMembersState?.loading && (
                        <p className="px-4 py-2 text-xs text-muted-foreground">
                          Loading members...
                        </p>
                      )}
                      {teamId && teamMembersState?.error && (
                        <p className="px-4 py-2 text-xs text-red-600">
                          {teamMembersState.error}
                        </p>
                      )}
                      {teamId &&
                        (teamMembersState?.members ?? []).map((member) => (
                          <button
                            key={member.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              closeMenus();
                              void handleAssignUser(
                                ticket,
                                member.user.id,
                                member.user.displayName,
                              );
                            }}
                            disabled={isTicketActionInProgress(ticket.id)}
                            className="block w-full px-4 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                          >
                            {member.user.displayName}
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => toggleSubmenu(e, ticket, "priority")}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="flex items-center gap-2">
                      <Tag className="h-4 w-4" />
                      <span>Edit priority</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {isPrioritySubmenuOpen && (
                    <div
                      className={`absolute top-0 z-20 min-w-44 rounded-md border border-border bg-card py-1 shadow-lg ${submenuPositionClass}`}
                    >
                      {PRIORITY_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeMenus();
                            void handlePriorityChange(
                              ticket.id,
                              option.value,
                              option.label,
                            );
                          }}
                          disabled={isTicketActionInProgress(ticket.id)}
                          className="block w-full px-4 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => toggleSubmenu(e, ticket, "move")}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="flex items-center gap-2">
                      <ChevronRight className="h-4 w-4" />
                      <span>Move to</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {isMoveSubmenuOpen && (
                    <div
                      className={`absolute top-0 z-20 min-w-56 rounded-md border border-border bg-card py-1 shadow-lg ${submenuPositionClass}`}
                    >
                      {possibleMoves.length === 0 && (
                        <p className="px-4 py-2 text-xs text-muted-foreground">
                          No valid moves
                        </p>
                      )}
                      {possibleMoves.map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeMenus();
                            void handleTransition(ticket.id, status);
                          }}
                          disabled={isTicketActionInProgress(ticket.id)}
                          className="block w-full px-4 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                        >
                          {formatStatus(status)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => toggleSubmenu(e, ticket, "transfer")}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="flex items-center gap-2">
                      <ArrowLeftRight className="h-4 w-4" />
                      <span>Transfer</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {isTransferSubmenuOpen && (
                    <div
                      className={`absolute top-0 z-20 min-w-56 rounded-md border border-border bg-card py-1 shadow-lg ${submenuPositionClass}`}
                    >
                      {teamsList.map((team) => (
                        <button
                          key={team.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeMenus();
                            void handleTransfer(ticket.id, team.id, team.name);
                          }}
                          disabled={
                            isTicketActionInProgress(ticket.id) ||
                            team.id === ticket.assignedTeam?.id
                          }
                          className="block w-full px-4 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {team.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeMenus();
                    handleCardClick(ticket.id);
                  }}
                  className="flex w-full items-center space-x-2 border-t border-border px-4 py-2 text-left text-sm hover:bg-accent"
                >
                  <Eye className="h-4 w-4" />
                  <span>View details</span>
                </button>
              </div>,
              document.body,
            );
          })()}
      </div>
    </section>
  );
}
