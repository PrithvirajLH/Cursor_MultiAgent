import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeftRight,
  ChevronRight,
  Eye,
  MoreVertical,
  Tag,
  User,
  UserPlus
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  bulkPriorityTickets,
  assignTicket,
  fetchTickets,
  fetchTeamMembers,
  transferTicket,
  transitionTicket,
  type NotificationRecord,
  type TeamMember,
  type TeamRef,
  type TicketRecord
} from '../api/client';
import { RelativeTime } from '../components/RelativeTime';
import { TopBar } from '../components/TopBar';
import { useToast } from '../hooks/useToast';
import { formatStatus, formatTicketId, getSlaTone } from '../utils/format';

const TRIAGE_COLUMNS = [
  { key: 'NEW', label: 'New' },
  { key: 'TRIAGED', label: 'Triaged' },
  { key: 'ASSIGNED', label: 'Assigned' },
  { key: 'IN_PROGRESS', label: 'In Progress' },
  { key: 'WAITING_ON_REQUESTER', label: 'Waiting on Requester' },
  { key: 'WAITING_ON_VENDOR', label: 'Waiting on Vendor' },
  { key: 'REOPENED', label: 'Reopened' }
];

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  NEW: ['TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_ON_REQUESTER', 'WAITING_ON_VENDOR', 'RESOLVED'],
  TRIAGED: ['ASSIGNED', 'IN_PROGRESS', 'WAITING_ON_REQUESTER', 'WAITING_ON_VENDOR', 'RESOLVED'],
  ASSIGNED: ['IN_PROGRESS', 'WAITING_ON_REQUESTER', 'WAITING_ON_VENDOR', 'RESOLVED'],
  IN_PROGRESS: ['WAITING_ON_REQUESTER', 'WAITING_ON_VENDOR', 'RESOLVED'],
  WAITING_ON_REQUESTER: ['IN_PROGRESS', 'RESOLVED'],
  WAITING_ON_VENDOR: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['REOPENED', 'CLOSED'],
  CLOSED: ['REOPENED'],
  REOPENED: ['TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_ON_REQUESTER', 'WAITING_ON_VENDOR', 'RESOLVED']
};

const PRIORITY_OPTIONS = [
  { label: 'Urgent', value: 'P1' },
  { label: 'High', value: 'P2' },
  { label: 'Medium', value: 'P3' },
  { label: 'Low', value: 'P4' }
];

type CardSubmenuType = 'assign' | 'move' | 'priority' | 'transfer';

type TriageHeaderProps = {
  title: string;
  subtitle: string;
  currentEmail: string;
  personas: { label: string; email: string }[];
  onEmailChange: (email: string) => void;
  onOpenSearch?: () => void;
  notificationProps?: {
    notifications: NotificationRecord[];
    unreadCount: number;
    loading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
    onMarkAsRead: (id: string) => void;
    onMarkAllAsRead: () => void;
    onRefresh: () => void;
  };
};

export function TriageBoardPage({
  refreshKey,
  teamsList,
  headerProps
}: {
  refreshKey: number;
  teamsList: TeamRef[];
  headerProps?: TriageHeaderProps;
}) {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionTicketId, setActionTicketId] = useState<string | null>(null);
  const [draggingTicketId, setDraggingTicketId] = useState<string | null>(null);
  const [draggingStatus, setDraggingStatus] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [activeCardMenu, setActiveCardMenu] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<{ ticketId: string; type: CardSubmenuType } | null>(null);
  const [teamMembersByTeamId, setTeamMembersByTeamId] = useState<
    Record<string, { loading: boolean; members: TeamMember[]; error: string | null }>
  >({});
  const toast = useToast();
  const [searchQuery, _setSearchQuery] = useState('');
  const [teamFilterId, setTeamFilterId] = useState('all');

  useEffect(() => {
    loadTickets();
  }, [refreshKey, teamFilterId]);

  useEffect(() => {
    if (teamFilterId === 'all') {
      return;
    }
    const exists = teamsList.some((team) => team.id === teamFilterId);
    if (!exists) {
      setTeamFilterId('all');
    }
  }, [teamsList, teamFilterId]);

  useEffect(() => {
    function handleDocumentClick(event: globalThis.MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-card-menu]')) {
        setActiveCardMenu(null);
        setActiveSubmenu(null);
      }
    }
    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, []);

  async function loadTickets() {
    setLoading(true);
    setError(null);
    setActionError(null);
    try {
      const response = await fetchTickets({
        statusGroup: 'open',
        sort: 'updatedAt',
        order: 'desc',
        pageSize: 100,
        teamId: teamFilterId === 'all' ? undefined : teamFilterId
      });
      setTickets(response.data);
    } catch (err) {
      setError('Unable to load triage tickets.');
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAssignSelf(ticket: TicketRecord) {
    setActionTicketId(ticket.id);
    setActionError(null);
    try {
      const updated = await assignTicket(ticket.id, {});
      setTickets((prev) => prev.map((item) => (item.id === ticket.id ? { ...item, ...updated } : item)));
      toast.success('Ticket assigned to you.');
    } catch (err) {
      setActionError('Unable to assign ticket.');
      toast.error('Unable to assign ticket.');
    } finally {
      setActionTicketId(null);
    }
  }

  async function handleAssignUser(ticket: TicketRecord, assigneeId: string, assigneeName: string) {
    setActionTicketId(ticket.id);
    setActionError(null);
    try {
      const updated = await assignTicket(ticket.id, { assigneeId });
      setTickets((prev) => prev.map((item) => (item.id === ticket.id ? { ...item, ...updated } : item)));
      toast.success(`Assigned to ${assigneeName}.`);
    } catch (err) {
      setActionError('Unable to assign ticket.');
      toast.error('Unable to assign ticket.');
    } finally {
      setActionTicketId(null);
    }
  }

  async function handlePriorityChange(ticketId: string, priority: string, priorityLabel: string) {
    setActionTicketId(ticketId);
    setActionError(null);
    try {
      const result = await bulkPriorityTickets([ticketId], priority);
      if (result.success > 0) {
        setTickets((prev) => prev.map((item) => (item.id === ticketId ? { ...item, priority } : item)));
        toast.success(`Priority changed to ${priorityLabel}.`);
      } else {
        throw new Error('No tickets updated');
      }
    } catch (err) {
      setActionError('Unable to update priority.');
      toast.error('Unable to update priority.');
    } finally {
      setActionTicketId(null);
    }
  }

  async function handleTransfer(ticketId: string, newTeamId: string, newTeamName: string) {
    setActionTicketId(ticketId);
    setActionError(null);
    try {
      const updated = await transferTicket(ticketId, { newTeamId });
      setTickets((prev) => prev.map((item) => (item.id === ticketId ? { ...item, ...updated } : item)));
      toast.success(`Transferred to ${newTeamName}.`);
    } catch (err) {
      setActionError('Unable to transfer ticket.');
      toast.error('Unable to transfer ticket.');
    } finally {
      setActionTicketId(null);
    }
  }

  async function ensureTeamMembersLoaded(teamId: string) {
    const existing = teamMembersByTeamId[teamId];
    if (existing?.loading || existing?.members.length) {
      return;
    }
    setTeamMembersByTeamId((prev) => ({
      ...prev,
      [teamId]: { loading: true, members: [], error: null }
    }));
    try {
      const response = await fetchTeamMembers(teamId);
      setTeamMembersByTeamId((prev) => ({
        ...prev,
        [teamId]: { loading: false, members: response.data, error: null }
      }));
    } catch (err) {
      setTeamMembersByTeamId((prev) => ({
        ...prev,
        [teamId]: { loading: false, members: [], error: 'Unable to load team members.' }
      }));
    }
  }

  async function handleTransition(ticketId: string, status: string) {
    setActionTicketId(ticketId);
    setActionError(null);
    try {
      const updated = await transitionTicket(ticketId, { status });
      setTickets((prev) => prev.map((item) => (item.id === ticketId ? { ...item, ...updated } : item)));
      toast.success(`Moved to ${formatStatus(status)}.`);
    } catch (err) {
      setActionError('Unable to move ticket to that status.');
      toast.error('Unable to move ticket to that status.');
    } finally {
      setActionTicketId(null);
    }
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>, ticket: TicketRecord) {
    setDraggingTicketId(ticket.id);
    setDraggingStatus(ticket.status);
    event.dataTransfer.setData('text/plain', JSON.stringify({ id: ticket.id, status: ticket.status }));
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleDragEnd() {
    setDraggingTicketId(null);
    setDraggingStatus(null);
    setDragOverColumn(null);
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
    if (!isValidTransition(draggingStatus, status)) {
      return;
    }
    setDragOverColumn(status);
  }

  function handleDragLeave() {
    setDragOverColumn(null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, status: string) {
    setDragOverColumn(null);
    if (!draggingStatus) {
      return;
    }
    if (!isValidTransition(draggingStatus, status)) {
      toast.error(`Cannot move from ${formatStatus(draggingStatus)} to ${formatStatus(status)}.`);
      return;
    }
    event.preventDefault();
    const payload = event.dataTransfer.getData('text/plain');
    if (!payload) {
      return;
    }
    try {
      const { id } = JSON.parse(payload) as { id: string; status?: string };
      const ticket = tickets.find((item) => item.id === id);
      if (!ticket || ticket.status === status) {
        if (ticket?.status === status) {
          toast.info('Ticket already in that status.');
        }
        return;
      }
      handleTransition(ticket.id, status);
    } catch {
      return;
    }
  }

  function handleCardClick(ticketId: string) {
    navigate(`/tickets/${ticketId}`);
  }

  function toggleCardMenu(event: MouseEvent<HTMLButtonElement>, ticketId: string) {
    event.stopPropagation();
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    setActiveCardMenu((prev) => {
      const next = prev === ticketId ? null : ticketId;
      if (!next) {
        setActiveSubmenu(null);
        setMenuAnchor(null);
      } else {
        setMenuAnchor({ top: rect.bottom + 4, left: rect.right - 208 });
      }
      return next;
    });
  }

  function toggleSubmenu(event: MouseEvent<HTMLButtonElement>, ticket: TicketRecord, type: CardSubmenuType) {
    event.stopPropagation();
    setActiveSubmenu((prev) => {
      if (prev?.ticketId === ticket.id && prev.type === type) {
        return null;
      }
      return { ticketId: ticket.id, type };
    });
    if (type === 'assign' && ticket.assignedTeam?.id) {
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
    if (normalized === 'P1' || normalized === 'URGENT') {
      return { label: normalized.startsWith('P') ? 'Urgent' : priority, className: 'bg-red-100 text-red-700' };
    }
    if (normalized === 'P2' || normalized === 'HIGH') {
      return { label: normalized.startsWith('P') ? 'High' : priority, className: 'bg-orange-100 text-orange-700' };
    }
    if (normalized === 'P3' || normalized === 'MEDIUM') {
      return { label: normalized.startsWith('P') ? 'Medium' : priority, className: 'bg-blue-100 text-blue-700' };
    }
    return { label: normalized.startsWith('P') ? 'Low' : priority, className: 'bg-gray-100 text-gray-700' };
  }

  function getSlaChipClass(label: string) {
    if (label === 'Breached') {
      return 'bg-red-100 text-red-700';
    }
    if (label === 'At risk') {
      return 'bg-orange-100 text-orange-700';
    }
    if (label === 'Paused' || label === 'Waiting') {
      return 'bg-orange-100 text-orange-700';
    }
    return 'bg-green-100 text-green-700';
  }

  function isValidTransition(from: string, to: string) {
    if (from === to) {
      return true;
    }
    return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
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
    <section className="min-h-full bg-gray-50 animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-[1600px] pl-6 pr-2 py-4">
          {headerProps ? (
            <TopBar
              title={headerProps.title}
              subtitle={headerProps.subtitle}
              currentEmail={headerProps.currentEmail}
              personas={headerProps.personas}
              onEmailChange={headerProps.onEmailChange}
              onOpenSearch={headerProps.onOpenSearch}
              notificationProps={headerProps.notificationProps}
              leftContent={
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-xl font-semibold text-gray-900">Triage Board</h1>
                  <span className="text-sm text-gray-500">({filteredTickets.length} tickets)</span>
                </div>
              }
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold text-gray-900">Triage Board</h1>
              <span className="text-sm text-gray-500">({filteredTickets.length} tickets)</span>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] pl-6 pr-2 py-6">
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        {actionError && <p className="mb-2 text-sm text-red-600">{actionError}</p>}

        {loading && (
          <div className="rounded-lg border border-gray-200 bg-white p-6 animate-pulse">
            <div className="h-4 w-48 rounded bg-gray-200" />
            <div className="mt-4 h-3 w-72 rounded bg-gray-100" />
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
                        <h2 className="text-sm font-semibold text-gray-900">{column.label}</h2>
                        <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-gray-100 px-2 text-xs font-medium text-gray-700">
                          {columnTickets.length}
                        </span>
                      </div>
                    </div>

                    <div
                      className={`h-[740px] min-h-[400px] overflow-y-auto rounded-lg border-2 bg-gray-50 p-3 transition-colors [&::-webkit-scrollbar-thumb]:rounded-[3px] [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:rounded-[3px] [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar]:w-1.5 ${
                        dragOverColumn === column.key ? 'border-blue-500 bg-blue-100/60' : 'border-gray-200'
                      }`}
                    >
                      {columnTickets.length === 0 ? (
                        <div className="py-8 text-center text-sm text-gray-400">No tickets</div>
                      ) : (
                        columnTickets.map((ticket) => {
                          const priority = getPriorityBadge(ticket.priority);
                          const sla = getSlaTone({
                            dueAt: ticket.dueAt,
                            completedAt: ticket.completedAt,
                            status: ticket.status,
                            slaPausedAt: ticket.slaPausedAt
                          });
                          const tags = [ticket.category?.name, ticket.channel].filter(Boolean) as string[];

                          return (
                            <div
                              key={ticket.id}
                              draggable
                              onDragStart={(event) => handleDragStart(event, ticket)}
                              onDragEnd={handleDragEnd}
                              onClick={() => handleCardClick(ticket.id)}
                              className={`mb-3 cursor-grab rounded-lg border border-gray-200 bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing ${
                                draggingTicketId === ticket.id ? 'opacity-50' : ''
                              }`}
                            >
                              <div className="mb-2 flex items-start justify-between">
                                <div className="flex items-center space-x-2">
                                  <span className="text-sm font-semibold text-blue-600">{formatTicketId(ticket)}</span>
                                  <span
                                    className={`whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ${priority.className}`}
                                  >
                                    {priority.label}
                                  </span>
                                </div>
                                <div className="relative" data-card-menu>
                                  <button
                                    type="button"
                                    onClick={(event) => toggleCardMenu(event, ticket.id)}
                                    className="p-1 text-gray-400 hover:text-gray-600"
                                    aria-label="Ticket actions"
                                  >
                                    <MoreVertical className="h-5 w-5" />
                                  </button>
                                </div>
                              </div>

                              <h3 className="mb-2 text-sm font-medium text-gray-900">{ticket.subject}</h3>

                              <div className="mb-3 flex items-center text-xs text-gray-600">
                                <User className="mr-1 h-4 w-4" />
                                <span>{ticket.requester?.displayName ?? 'Requester unknown'}</span>
                              </div>

                              <div className="mb-3 flex items-center justify-between text-xs">
                                <span className="text-gray-600">{ticket.assignedTeam?.name ?? 'Unassigned team'}</span>
                                <span
                                  className={`rounded px-2 py-1 text-xs ${getSlaChipClass(sla.label)}`}
                                >
                                  {sla.label}
                                </span>
                              </div>

                              {ticket.assignee && (
                                <div className="mb-3 flex items-center text-xs text-gray-600">
                                  <UserPlus className="mr-1 h-4 w-4 text-gray-400" />
                                  <span>Assigned to {ticket.assignee.displayName}</span>
                                </div>
                              )}

                              {tags.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {tags.map((tag) => (
                                    <span key={tag} className="inline-flex items-center rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}

                              <div className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
                                Updated <RelativeTime value={ticket.updatedAt} />
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
            const possibleMoves = ALLOWED_TRANSITIONS[ticket.status] ?? [];
            const teamId = ticket.assignedTeam?.id;
            const teamMembersState = teamId ? teamMembersByTeamId[teamId] : undefined;
            const isAssignSubmenuOpen =
              activeSubmenu?.ticketId === ticket.id && activeSubmenu.type === 'assign';
            const isMoveSubmenuOpen =
              activeSubmenu?.ticketId === ticket.id && activeSubmenu.type === 'move';
            const isPrioritySubmenuOpen =
              activeSubmenu?.ticketId === ticket.id && activeSubmenu.type === 'priority';
            const isTransferSubmenuOpen =
              activeSubmenu?.ticketId === ticket.id && activeSubmenu.type === 'transfer';
            return createPortal(
              <div
                data-card-menu
                className="w-52 rounded-md border border-gray-200 bg-white py-1 shadow-lg"
                style={{
                  position: 'fixed',
                  top: menuAnchor.top,
                  left: menuAnchor.left,
                  zIndex: 9999
                }}
              >
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => toggleSubmenu(e, ticket, 'assign')}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-gray-100"
                  >
                    <span className="flex items-center gap-2">
                      <UserPlus className="h-4 w-4" />
                      <span>Assign to...</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-gray-500" />
                  </button>
                  {isAssignSubmenuOpen && (
                    <div className="absolute left-full top-0 z-20 ml-1 min-w-52 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeMenus();
                          void handleAssignSelf(ticket);
                        }}
                        disabled={actionTicketId === ticket.id}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-gray-100 disabled:opacity-50"
                      >
                        <UserPlus className="h-4 w-4" />
                        <span>Assign to me</span>
                      </button>
                      <div className="my-1 border-t border-gray-100" />
                      {!teamId && (
                        <p className="px-4 py-2 text-xs text-gray-500">No team on ticket</p>
                      )}
                      {teamId && teamMembersState?.loading && (
                        <p className="px-4 py-2 text-xs text-gray-500">Loading members...</p>
                      )}
                      {teamId && teamMembersState?.error && (
                        <p className="px-4 py-2 text-xs text-red-600">{teamMembersState.error}</p>
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
                                member.user.displayName
                              );
                            }}
                            disabled={actionTicketId === ticket.id}
                            className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 disabled:opacity-50"
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
                    onClick={(e) => toggleSubmenu(e, ticket, 'priority')}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-gray-100"
                  >
                    <span className="flex items-center gap-2">
                      <Tag className="h-4 w-4" />
                      <span>Edit priority</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-gray-500" />
                  </button>
                  {isPrioritySubmenuOpen && (
                    <div className="absolute left-full top-0 z-20 ml-1 min-w-44 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
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
                              option.label
                            );
                          }}
                          disabled={actionTicketId === ticket.id}
                          className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 disabled:opacity-50"
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
                    onClick={(e) => toggleSubmenu(e, ticket, 'move')}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-gray-100"
                  >
                    <span className="flex items-center gap-2">
                      <ChevronRight className="h-4 w-4" />
                      <span>Move to</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-gray-500" />
                  </button>
                  {isMoveSubmenuOpen && (
                    <div className="absolute left-full top-0 z-20 ml-1 min-w-56 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                      {possibleMoves.length === 0 && (
                        <p className="px-4 py-2 text-xs text-gray-500">No valid moves</p>
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
                          disabled={actionTicketId === ticket.id}
                          className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 disabled:opacity-50"
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
                    onClick={(e) => toggleSubmenu(e, ticket, 'transfer')}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-gray-100"
                  >
                    <span className="flex items-center gap-2">
                      <ArrowLeftRight className="h-4 w-4" />
                      <span>Transfer</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-gray-500" />
                  </button>
                  {isTransferSubmenuOpen && (
                    <div className="absolute left-full top-0 z-20 ml-1 min-w-56 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
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
                            actionTicketId === ticket.id ||
                            team.id === ticket.assignedTeam?.id
                          }
                          className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
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
                  className="flex w-full items-center space-x-2 border-t border-gray-100 px-4 py-2 text-left text-sm hover:bg-gray-100"
                >
                  <Eye className="h-4 w-4" />
                  <span>View details</span>
                </button>
              </div>,
              document.body
            );
          })()}
      </div>
    </section>
  );
}
