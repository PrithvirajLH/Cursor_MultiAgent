import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronDown, Clock3, Copy, MessageSquare, Paperclip } from 'lucide-react';
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
  transitionTicket,
  transferTicket,
  unfollowTicket,
  uploadTicketAttachment,
  type NotificationRecord,
  type TeamMember,
  type TeamRef,
  type TicketDetail,
  type TicketEvent,
  type TicketMessage,
} from '../api/client';
import { CustomFieldsDisplay } from '../components/CustomFieldRenderer';
import { MessageBody } from '../components/MessageBody';
import { RelativeTime } from '../components/RelativeTime';
import { TopBar } from '../components/TopBar';
import { TicketDetailSkeleton } from '../components/skeletons';
import type { Role } from '../types';
import { copyToClipboard } from '../utils/clipboard';
import { formatStatus, formatTicketId, initialsFor } from '../utils/format';

const STATUS_TRANSITIONS: Record<string, string[]> = {
  NEW: ['TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_ON_REQUESTER', 'WAITING_ON_VENDOR', 'RESOLVED', 'CLOSED'],
  TRIAGED: ['ASSIGNED', 'IN_PROGRESS', 'WAITING_ON_REQUESTER', 'WAITING_ON_VENDOR', 'RESOLVED', 'CLOSED'],
  ASSIGNED: ['IN_PROGRESS', 'WAITING_ON_REQUESTER', 'WAITING_ON_VENDOR', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['WAITING_ON_REQUESTER', 'WAITING_ON_VENDOR', 'RESOLVED', 'CLOSED'],
  WAITING_ON_REQUESTER: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  WAITING_ON_VENDOR: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['REOPENED', 'CLOSED'],
  CLOSED: ['REOPENED'],
  REOPENED: ['TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_ON_REQUESTER', 'WAITING_ON_VENDOR', 'RESOLVED', 'CLOSED'],
};

export function TicketDetailPage({
  refreshKey,
  currentEmail,
  role,
  teamsList,
  headerProps,
}: {
  refreshKey: number;
  currentEmail: string;
  role: Role;
  teamsList: TeamRef[];
  headerProps?: {
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
}) {
  const { ticketId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

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
  const [expandedSections, setExpandedSections] = useState({
    edit: true,
    followers: false,
    additional: false,
    history: false,
  });
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const conversationListRef = useRef<HTMLDivElement | null>(null);
  const statusSelectRef = useRef<HTMLSelectElement | null>(null);

  const activeTicketIdRef = useRef<string | null>(null);
  const detailRequestSeqRef = useRef(0);
  const messageRequestSeqRef = useRef(0);
  const eventRequestSeqRef = useRef(0);

  const followers = ticket?.followers ?? [];
  const statusEvents = events.filter((event) => event.type === 'TICKET_STATUS_CHANGED');
  const isFollowing = followers.some((follower) => follower.user.email === currentEmail);
  const isCurrentUserOnAssignedTeam = useMemo(
    () => teamMembers.some((member) => member.user.email === currentEmail),
    [teamMembers, currentEmail],
  );
  const canManage = useMemo(() => {
    if (!ticket) {
      return false;
    }
    if (role === 'OWNER') {
      return true;
    }
    if (role === 'EMPLOYEE') {
      return false;
    }
    if (role === 'LEAD' || role === 'TEAM_ADMIN') {
      return isCurrentUserOnAssignedTeam;
    }
    const isAssignee = ticket.assignee?.email === currentEmail;
    const isUnassigned = !ticket.assignee;
    return isCurrentUserOnAssignedTeam && (isAssignee || isUnassigned);
  }, [currentEmail, isCurrentUserOnAssignedTeam, role, ticket]);
  const canUpload = ticket ? role !== 'EMPLOYEE' || ticket.requester?.email === currentEmail : false;
  const availableTransitions = useMemo(() => {
    if (!ticket) {
      return [];
    }
    return STATUS_TRANSITIONS[ticket.status] ?? [];
  }, [ticket]);
  const quickEscalationTarget = useMemo(() => {
    if (availableTransitions.includes('WAITING_ON_VENDOR')) {
      return 'WAITING_ON_VENDOR';
    }
    if (availableTransitions.includes('TRIAGED')) {
      return 'TRIAGED';
    }
    return null;
  }, [availableTransitions]);
  const headerTitle = headerProps?.title ?? 'Ticket details';

  const navigateBack = useCallback(() => {
    const fromTicketsPath = (location.state as { fromTicketsPath?: string } | null)?.fromTicketsPath;
    if (fromTicketsPath) {
      navigate(fromTicketsPath);
      return;
    }
    const historyState = window.history.state as { idx?: number } | null;
    if (typeof historyState?.idx === 'number' && historyState.idx > 0) {
      navigate(-1);
      return;
    }
    navigate('/tickets');
  }, [location.state, navigate]);

  useEffect(() => {
    if (!ticketId) {
      return;
    }
    void loadTicketDetail(ticketId);
  }, [ticketId, refreshKey]);

  useEffect(() => {
    if (!ticket?.assignedTeam?.id) {
      setTeamMembers([]);
      return;
    }
    setTeamMembers([]);
    setMembersLoading(true);
    fetchTeamMembers(ticket.assignedTeam.id)
      .then((response) => setTeamMembers(response.data))
      .catch(() => setTeamMembers([]))
      .finally(() => setMembersLoading(false));
  }, [ticket?.assignedTeam?.id]);

  useEffect(() => {
    if (!transferTeamId) {
      setTransferMembers([]);
      setTransferAssigneeId('');
      return;
    }
    setTransferAssigneeId('');
    fetchTeamMembers(transferTeamId)
      .then((response) => setTransferMembers(response.data))
      .catch(() => setTransferMembers([]));
  }, [transferTeamId]);

  useEffect(() => {
    if (!ticket) {
      return;
    }
    const next = availableTransitions[0] ?? '';
    setNextStatus(next);
    setAssignToId('');
    setTransferTeamId('');
    setTransferAssigneeId('');
  }, [ticket?.id, ticket?.status, availableTransitions]);

  useEffect(() => {
    if (activeTab !== 'conversation') return;
    const listEl = conversationListRef.current;
    if (!listEl) return;

    const onScroll = () => {
      const distanceFromBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
      setShowJumpToLatest(distanceFromBottom > 250);
    };

    listEl.addEventListener('scroll', onScroll);
    onScroll();
    return () => listEl.removeEventListener('scroll', onScroll);
  }, [activeTab, ticket?.id]);

  useEffect(() => {
    if (activeTab !== 'conversation') return;
    const listEl = conversationListRef.current;
    if (!listEl) return;
    listEl.scrollTop = listEl.scrollHeight;
  }, [ticket?.id, activeTab]);

  useEffect(() => {
    if (activeTab !== 'conversation') return;
    const listEl = conversationListRef.current;
    if (!listEl) return;
    const distanceFromBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
    if (distanceFromBottom <= 180) {
      listEl.scrollTop = listEl.scrollHeight;
    }
  }, [messages.length, activeTab]);

  useEffect(() => {
    if (role === 'EMPLOYEE') {
      setMessageType('PUBLIC');
    }
  }, [role]);

  useEffect(() => {
    if (!copyToast) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setCopyToast(null);
    }, 3000);
    return () => window.clearTimeout(timeoutId);
  }, [copyToast]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

      const target = event.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;
      if (isInput) return;

      switch (event.key) {
        case 'r':
        case 'R':
          if (!event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            messageInputRef.current?.focus();
          }
          break;
        case 'a':
        case 'A':
          if (!event.ctrlKey && !event.metaKey && !event.altKey && canManage && !ticket?.assignee) {
            event.preventDefault();
            void handleAssignSelf();
          }
          break;
        case 's':
        case 'S':
          if (!event.ctrlKey && !event.metaKey && !event.altKey && canManage) {
            event.preventDefault();
            statusSelectRef.current?.focus();
          }
          break;
        case 'Escape':
          event.preventDefault();
          navigateBack();
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canManage, navigateBack, ticket?.assignee]);

  async function loadMessagesPage(id: string, reset = false) {
    const requestSeq = ++messageRequestSeqRef.current;
    if (reset) {
      setMessages([]);
      setMessageCursor(null);
      setMessagesHasMore(false);
    }

    setMessagesLoading(true);
    try {
      const response = await fetchTicketMessages(id, {
        cursor: reset ? undefined : messageCursor ?? undefined,
        take: 50,
      });
      if (messageRequestSeqRef.current !== requestSeq) {
        return;
      }
      setMessages((prev) => (reset ? response.data : [...response.data, ...prev]));
      setMessageCursor(response.nextCursor ?? null);
      setMessagesHasMore(Boolean(response.nextCursor));
    } catch {
      if (messageRequestSeqRef.current === requestSeq && reset) {
        setMessages([]);
        setMessagesHasMore(false);
      }
    } finally {
      if (messageRequestSeqRef.current === requestSeq) {
        setMessagesLoading(false);
      }
    }
  }

  async function loadEventsPage(id: string, reset = false) {
    const requestSeq = ++eventRequestSeqRef.current;
    if (reset) {
      setEvents([]);
      setEventCursor(null);
      setEventsHasMore(false);
    }

    setEventsLoading(true);
    try {
      const response = await fetchTicketEvents(id, {
        cursor: reset ? undefined : eventCursor ?? undefined,
        take: 50,
      });
      if (eventRequestSeqRef.current !== requestSeq) {
        return;
      }
      setEvents((prev) => (reset ? response.data : [...response.data, ...prev]));
      setEventCursor(response.nextCursor ?? null);
      setEventsHasMore(Boolean(response.nextCursor));
    } catch {
      if (eventRequestSeqRef.current === requestSeq && reset) {
        setEvents([]);
        setEventsHasMore(false);
      }
    } finally {
      if (eventRequestSeqRef.current === requestSeq) {
        setEventsLoading(false);
      }
    }
  }

  async function loadTicketDetail(id: string) {
    const requestSeq = ++detailRequestSeqRef.current;
    const isNavigatingToDifferentTicket = activeTicketIdRef.current !== null && activeTicketIdRef.current !== id;
    activeTicketIdRef.current = id;

    setLoadingDetail(true);
    setTicketError(null);
    setAccessDenied(false);

    if (isNavigatingToDifferentTicket) {
      setTicket(null);
      setMessages([]);
      setEvents([]);
      setMessageCursor(null);
      setEventCursor(null);
      setMessagesHasMore(false);
      setEventsHasMore(false);
    }

    try {
      const detail = await fetchTicketById(id);
      if (detailRequestSeqRef.current !== requestSeq) {
        return;
      }

      setTicket(detail);
      await Promise.all([loadMessagesPage(id, true), loadEventsPage(id, true)]);
    } catch (error) {
      if (detailRequestSeqRef.current !== requestSeq) {
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        setAccessDenied(true);
        setTicketError('You do not have access to this ticket.');
      } else {
        setTicketError('Unable to load ticket details.');
      }
      if (isNavigatingToDifferentTicket) {
        setTicket(null);
      }
    } finally {
      if (detailRequestSeqRef.current === requestSeq) {
        setLoadingDetail(false);
      }
    }
  }

  async function handleCopyLink() {
    if (!ticketId) {
      return;
    }
    const url = `${window.location.origin}/tickets/${ticketId}`;
    const copied = await copyToClipboard(url);
    if (copied) {
      setCopyToast({ message: 'Link copied to clipboard', type: 'success' });
      return;
    }
    setCopyToast({ message: 'Could not copy link', type: 'error' });
  }

  async function handleReply() {
    const body = messageBody.trim();
    if (!ticketId || !ticket || !body || messageSending) {
      return;
    }

    setTicketError(null);
    setMessageSending(true);

    const optimisticId = `opt-${Date.now()}`;
    const optimisticMessage: TicketMessage = {
      id: optimisticId,
      body,
      type: messageType,
      createdAt: new Date().toISOString(),
      author: {
        id: 'pending',
        email: currentEmail,
        displayName: currentEmail.split('@')[0] || 'You',
      },
    };

    setMessages((prev) => [...prev, optimisticMessage]);
    setMessageBody('');

    try {
      const serverMessage = await addTicketMessage(ticketId, { body, type: messageType });
      setMessages((prev) => prev.map((item) => (item.id === optimisticId ? serverMessage : item)));
      void loadEventsPage(ticketId, true);
      setCopyToast({
        message: messageType === 'INTERNAL' ? 'Internal note added' : 'Reply sent',
        type: 'success',
      });
    } catch {
      setMessages((prev) => prev.filter((item) => item.id !== optimisticId));
      setTicketError('Unable to send message.');
      setCopyToast({ message: 'Unable to send message.', type: 'error' });
    } finally {
      setMessageSending(false);
    }
  }

  async function handleAssignSelf() {
    if (!ticket) {
      return;
    }
    setActionError(null);
    setActionLoading(true);
    try {
      const updated = await assignTicket(ticket.id, {});
      setTicket((prev) => (prev ? { ...prev, ...updated } : prev));
      void loadTicketDetail(ticket.id);
      setCopyToast({ message: 'Assigned to you.', type: 'success' });
    } catch {
      setActionError('Unable to assign ticket.');
      setCopyToast({ message: 'Unable to assign ticket.', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAssignMember() {
    if (!ticket || !assignToId) {
      return;
    }
    setActionError(null);
    setActionLoading(true);
    try {
      const updated = await assignTicket(ticket.id, { assigneeId: assignToId });
      setTicket((prev) => (prev ? { ...prev, ...updated } : prev));
      void loadTicketDetail(ticket.id);
      setCopyToast({ message: 'Assignee updated.', type: 'success' });
    } catch {
      setActionError('Unable to assign ticket.');
      setCopyToast({ message: 'Unable to assign ticket.', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  }

  async function transitionTo(targetStatus: string) {
    if (!ticket || !targetStatus || targetStatus === ticket.status) {
      return;
    }
    setActionError(null);
    setActionLoading(true);
    try {
      const updated = await transitionTicket(ticket.id, { status: targetStatus });
      setTicket((prev) => (prev ? { ...prev, ...updated } : prev));
      void loadTicketDetail(ticket.id);
      setCopyToast({ message: `Status updated to ${formatStatus(targetStatus)}.`, type: 'success' });
    } catch {
      setActionError('Unable to change status.');
      setCopyToast({ message: 'Unable to change status.', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleTransition() {
    await transitionTo(nextStatus);
  }

  async function handleTransfer() {
    if (!ticket || !transferTeamId) {
      return;
    }
    setActionError(null);
    setActionLoading(true);
    try {
      const updated = await transferTicket(ticket.id, {
        newTeamId: transferTeamId,
        assigneeId: transferAssigneeId || undefined,
      });
      setTicket((prev) => (prev ? { ...prev, ...updated } : prev));
      void loadTicketDetail(ticket.id);
      setCopyToast({ message: 'Ticket transferred.', type: 'success' });
    } catch {
      setActionError('Unable to transfer ticket.');
      setCopyToast({ message: 'Unable to transfer ticket.', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleFollowToggle() {
    if (!ticket) {
      return;
    }
    setFollowError(null);
    setFollowLoading(true);
    try {
      if (isFollowing) {
        await unfollowTicket(ticket.id);
      } else {
        await followTicket(ticket.id);
      }
      void loadTicketDetail(ticket.id);
      setCopyToast({ message: isFollowing ? 'Unfollowed ticket.' : 'Following ticket.', type: 'success' });
    } catch {
      setFollowError('Unable to update followers.');
      setCopyToast({ message: 'Unable to update followers.', type: 'error' });
    } finally {
      setFollowLoading(false);
    }
  }

  async function handleAttachmentUpload(event: ChangeEvent<HTMLInputElement>) {
    if (!ticketId) {
      return;
    }
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    setAttachmentError(null);
    setAttachmentUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadTicketAttachment(ticketId, file);
      }
      void loadTicketDetail(ticketId);
      setCopyToast({ message: 'Attachment uploaded.', type: 'success' });
    } catch {
      setAttachmentError('Unable to upload attachment.');
      setCopyToast({ message: 'Unable to upload attachment.', type: 'error' });
    } finally {
      setAttachmentUploading(false);
      event.target.value = '';
    }
  }

  async function handleAttachmentDownload(attachmentId: string, fileName: string) {
    setAttachmentError(null);
    try {
      const blob = await downloadAttachment(attachmentId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setAttachmentError('Unable to download attachment.');
    }
  }

  async function handleAttachmentView(attachmentId: string) {
    setAttachmentError(null);
    try {
      const blob = await downloadAttachment(attachmentId);
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch {
      setAttachmentError('Unable to open attachment.');
    }
  }

  function toggleSection(section: keyof typeof expandedSections) {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }

  function scrollToLatest() {
    const listEl = conversationListRef.current;
    if (!listEl) return;
    listEl.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' });
  }

  const conversationCount = messages.length;
  const timelineCount = events.length;

  return (
    <section className="min-h-full bg-slate-50 animate-fade-in" title={headerTitle}>
      {copyToast && (
        <div className="fixed right-4 top-4 z-50">
          <div
            className={`flex items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-lg ${
              copyToast.type === 'success'
                ? 'border-emerald-200 text-slate-900'
                : 'border-rose-200 text-rose-700'
            }`}
          >
            {copyToast.type === 'success' ? (
              <Check className="h-5 w-5 text-emerald-600" />
            ) : (
              <Clock3 className="h-5 w-5" />
            )}
            <span className="text-sm font-medium">{copyToast.message}</span>
          </div>
        </div>
      )}

      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-[1600px] pl-6 pr-2 py-3">
          <TopBar
            title={headerTitle}
            subtitle={headerProps?.subtitle ?? 'Review context, collaborate, and update workflow in one workspace.'}
            currentEmail={headerProps?.currentEmail ?? currentEmail}
            personas={headerProps?.personas ?? [{ label: currentEmail, email: currentEmail }]}
            onEmailChange={headerProps?.onEmailChange ?? (() => {})}
            onOpenSearch={headerProps?.onOpenSearch}
            notificationProps={headerProps?.notificationProps}
            leftAction={
                <button
                  type="button"
                  onClick={navigateBack}
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                >
                  <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            }
            leftContent={
              ticket ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-slate-500">{formatTicketId(ticket)}</span>
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusBadgeClass(ticket.status)}`}>
                    {formatStatus(ticket.status)}
                  </span>
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${priorityBadgeClass(ticket.priority)}`}>
                    {formatPriority(ticket.priority)}
                  </span>
                  <span className="rounded-md bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700">
                    {formatChannel(ticket.channel)}
                  </span>
                </div>
              ) : (
                <div>
                  <h1 className="text-xl font-semibold text-slate-900">Ticket details</h1>
                  <p className="text-sm text-slate-500">
                    Review context, collaborate, and update workflow in one workspace.
                  </p>
                </div>
              )
            }
          />
        </div>

        {ticket && (
          <div className="border-t border-slate-200 bg-white">
            <div className="mx-auto max-w-[1600px] pl-6 pr-2 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">{ticket.subject}</h1>
                  {ticket.description ? (
                    <p className="mt-1 text-sm text-slate-600">{ticket.description}</p>
                  ) : (
                    <p className="mt-1 text-sm text-slate-500">No description provided.</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>
                      Created <RelativeTime value={ticket.createdAt} />
                    </span>
                    <span className="text-slate-300">•</span>
                    <span>
                      Requester:{' '}
                      <span className="font-medium text-slate-800">
                        {ticket.requester?.displayName ?? ticket.requester?.email ?? 'Unknown'}
                      </span>
                    </span>
                    <span className="text-slate-300">•</span>
                    <span>
                      Assignee:{' '}
                      <span className="font-medium text-slate-800">
                        {ticket.assignee?.displayName ?? 'Unassigned'}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyLink()}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <Copy className="h-4 w-4" />
                    Copy link
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('conversation');
                      messageInputRef.current?.focus();
                    }}
                    className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    Reply
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mx-auto max-w-[1600px] pl-6 pr-2 py-6">
        {ticketError && <p className="mb-4 text-sm text-red-600">{ticketError}</p>}
        {accessDenied && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <p className="text-sm">Switch to a user with access, or go back to the ticket list.</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
              <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-6">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('conversation')}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${
                      activeTab === 'conversation'
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    Conversation
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                        activeTab === 'conversation' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {conversationCount}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('timeline')}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${
                      activeTab === 'timeline'
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    Timeline
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                        activeTab === 'timeline' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {timelineCount}
                    </span>
                  </button>
                </div>
                <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex">
                  <span className="inline-flex items-center gap-1">
                    <kbd className="rounded-md border border-slate-200 bg-slate-100 px-2 py-1">R</kbd> Reply
                  </span>
                  {canManage ? (
                    <>
                      <span className="text-slate-300">•</span>
                      <span className="inline-flex items-center gap-1">
                        <kbd className="rounded-md border border-slate-200 bg-slate-100 px-2 py-1">A</kbd> Assign
                      </span>
                      <span className="text-slate-300">•</span>
                      <span className="inline-flex items-center gap-1">
                        <kbd className="rounded-md border border-slate-200 bg-slate-100 px-2 py-1">S</kbd> Status
                      </span>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="relative">
                {loadingDetail && !ticket ? <div className="p-6"><TicketDetailSkeleton count={4} /></div> : null}
                {!loadingDetail && !ticket && !accessDenied ? (
                  <p className="p-6 text-sm text-slate-500">Ticket not found.</p>
                ) : null}

                {ticket && activeTab === 'conversation' ? (
                  <>
                    <div className="px-4 pt-5 sm:px-6">
                      {messagesHasMore ? (
                        <button
                          type="button"
                          onClick={() => ticketId && void loadMessagesPage(ticketId)}
                          disabled={messagesLoading}
                          className="text-sm font-medium text-blue-600 hover:text-blue-700"
                        >
                          {messagesLoading ? 'Loading...' : '↑ Load older messages'}
                        </button>
                      ) : null}
                    </div>

                    <div
                      ref={conversationListRef}
                      className="max-h-[560px] space-y-4 overflow-y-auto px-4 py-5 sm:px-6"
                    >
                      {messages.length === 0 && !messagesLoading ? (
                        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                          No messages yet.
                        </div>
                      ) : null}

                      {messages.map((message) => {
                        const isCurrentUser = message.author?.email === currentEmail;
                        const isInternal = message.type === 'INTERNAL';
                        const initials = initialsFor(message.author?.displayName ?? message.author?.email ?? 'U');

                        return (
                          <div key={message.id} className="animate-fade-in">
                            <div className={`flex items-start gap-3 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
                              {!isCurrentUser ? (
                                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-xs font-bold text-slate-700">
                                  {initials}
                                </div>
                              ) : null}

                              <div className={`max-w-[78%] sm:max-w-[70%] ${isCurrentUser ? 'text-right' : 'text-left'}`}>
                                <div className={`mb-1 flex items-center gap-2 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
                                  <span className="text-sm font-semibold text-slate-900">
                                    {message.author?.displayName ?? message.author?.email ?? 'Unknown'}
                                  </span>
                                  {isInternal ? (
                                    <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                                      Internal
                                    </span>
                                  ) : null}
                                  <span className="text-xs text-slate-500">
                                    <RelativeTime value={message.createdAt} />
                                  </span>
                                </div>

                                <div
                                  className={`rounded-2xl border px-4 py-3 text-sm leading-relaxed ${
                                    isCurrentUser
                                      ? 'border-blue-600 bg-blue-600 text-white'
                                      : isInternal
                                        ? 'border-amber-200 bg-amber-50 text-slate-900'
                                        : 'border-slate-200 bg-white text-slate-900'
                                  }`}
                                >
                                  <MessageBody body={message.body} />
                                </div>
                              </div>

                              {isCurrentUser ? (
                                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-xs font-bold text-white shadow-soft">
                                  {initials}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {showJumpToLatest ? (
                      <div className="absolute bottom-[108px] left-1/2 -translate-x-1/2">
                        <button
                          type="button"
                          onClick={scrollToLatest}
                          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-slate-800"
                        >
                          Jump to latest ↓
                        </button>
                      </div>
                    ) : null}

                    <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-4 sm:px-6">
                      <div className="flex items-center justify-between gap-3">
                        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
                          <button
                            type="button"
                            onClick={() => setMessageType('PUBLIC')}
                            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                              messageType === 'PUBLIC' ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            Public
                          </button>
                          {canManage ? (
                            <button
                              type="button"
                              onClick={() => setMessageType('INTERNAL')}
                              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                                messageType === 'INTERNAL'
                                  ? 'bg-amber-600 text-white'
                                  : 'text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              Internal
                            </button>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-2">
                          {canUpload ? (
                            <>
                              <button
                                type="button"
                                onClick={() => attachmentInputRef.current?.click()}
                                className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                                title="Attach file"
                                aria-label="Attach file"
                              >
                                <Paperclip className="h-5 w-5" />
                              </button>
                              <input
                                ref={attachmentInputRef}
                                type="file"
                                multiple
                                className="sr-only"
                                onChange={handleAttachmentUpload}
                                disabled={attachmentUploading}
                              />
                            </>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void handleReply()}
                            disabled={!messageBody.trim() || messageSending}
                            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {messageSending ? 'Sending...' : 'Send'}
                          </button>
                        </div>
                      </div>

                      <textarea
                        ref={messageInputRef}
                        value={messageBody}
                        onChange={(event) => setMessageBody(event.target.value)}
                        placeholder={messageType === 'INTERNAL' ? 'Add an internal note...' : 'Write a reply...'}
                        rows={4}
                        className="mt-3 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-blue-500"
                      />

                      {ticket.attachments.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {ticket.attachments.map((attachment) => (
                            <div
                              key={attachment.id}
                              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                            >
                              <Paperclip className="h-4 w-4 text-slate-500" />
                              <span className="font-semibold">{attachment.fileName}</span>
                              <span className="text-slate-400">•</span>
                              <span className="text-slate-500">{formatFileSize(attachment.sizeBytes)}</span>
                              <button
                                type="button"
                                onClick={() => void handleAttachmentView(attachment.id)}
                                className="rounded-full p-1 text-blue-600 hover:bg-slate-100 hover:text-blue-700"
                              >
                                View
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleAttachmentDownload(attachment.id, attachment.fileName)}
                                className="rounded-full p-1 text-blue-600 hover:bg-slate-100 hover:text-blue-700"
                              >
                                Download
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {attachmentError ? <p className="mt-2 text-xs text-rose-600">{attachmentError}</p> : null}
                    </div>
                  </>
                ) : null}

                {ticket && activeTab === 'timeline' ? (
                  <div className="px-4 py-5 sm:px-6">
                    {eventsHasMore ? (
                      <button
                        type="button"
                        onClick={() => ticketId && void loadEventsPage(ticketId)}
                        disabled={eventsLoading}
                        className="text-sm font-medium text-blue-600 hover:text-blue-700"
                      >
                        {eventsLoading ? 'Loading...' : '↑ Load older events'}
                      </button>
                    ) : null}

                    <div className="mt-5 max-h-[660px] space-y-4 overflow-y-auto">
                      {events.length === 0 && !eventsLoading ? (
                        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                          No events yet.
                        </div>
                      ) : null}

                      {events.map((event, index) => {
                        const eventKind = getEventKind(event);
                        return (
                          <div key={event.id} className="flex items-start gap-3">
                            <div className="relative">
                              <div
                                className={`flex h-9 w-9 items-center justify-center rounded-xl border ${
                                  eventKind === 'message'
                                    ? 'border-blue-200 bg-blue-50'
                                    : eventKind === 'internal'
                                      ? 'border-amber-200 bg-amber-50'
                                      : 'border-slate-200 bg-slate-100'
                                }`}
                              >
                                {eventKind === 'message' || eventKind === 'internal' ? (
                                  <MessageSquare className="h-4 w-4 text-slate-600" />
                                ) : (
                                  <Clock3 className="h-4 w-4 text-slate-600" />
                                )}
                              </div>
                              {index < events.length - 1 ? (
                                <div className="absolute left-1/2 top-9 h-6 w-px -translate-x-1/2 bg-slate-200" />
                              ) : null}
                            </div>
                            <div className="pt-1">
                              <p className="text-sm text-slate-900">{formatEventText(event)}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                <RelativeTime value={event.createdAt} />
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-[160px] xl:col-span-1 xl:h-fit">
            {ticket && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">SLA Overview</h3>
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${slaBadgeClass(getResolutionSla(ticket).label)}`}>
                    {getResolutionSla(ticket).label}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {renderSlaCard('First Response', getFirstResponseSla(ticket))}
                  {renderSlaCard('Resolution', getResolutionSla(ticket))}
                </div>
              </div>
            )}

            {canManage && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
                <h3 className="text-sm font-semibold text-slate-900">Quick Actions</h3>
                {actionError && <p className="mt-2 text-xs text-rose-600">{actionError}</p>}

                <div className="mt-3 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Assign</label>
                    <div className="flex gap-2">
                      <select
                        value={assignToId}
                        onChange={(event) => setAssignToId(event.target.value)}
                        disabled={membersLoading || actionLoading || teamMembers.length === 0}
                        className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">{membersLoading ? 'Loading team...' : 'Select assignee'}</option>
                        {teamMembers.map((member) => (
                          <option key={member.id} value={member.user.id}>
                            {member.user.displayName}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleAssignMember()}
                        disabled={!assignToId || actionLoading}
                        className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        Assign
                      </button>
                    </div>
                    {!ticket?.assignee && (
                      <button
                        type="button"
                        onClick={() => void handleAssignSelf()}
                        disabled={actionLoading}
                        className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
                      >
                        Assign to me
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Status</label>
                    <div className="flex gap-2">
                      <select
                        ref={statusSelectRef}
                        value={nextStatus}
                        onChange={(event) => setNextStatus(event.target.value)}
                        disabled={actionLoading || availableTransitions.length === 0}
                        className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {availableTransitions.length === 0 && <option value="">No transitions</option>}
                        {availableTransitions.map((status) => (
                          <option key={status} value={status}>
                            {formatStatus(status)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleTransition()}
                        disabled={actionLoading || !nextStatus || nextStatus === ticket?.status}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Update
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void transitionTo('RESOLVED')}
                        disabled={actionLoading || !availableTransitions.includes('RESOLVED')}
                        className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Resolve
                      </button>
                      {quickEscalationTarget ? (
                        <button
                          type="button"
                          onClick={() => void transitionTo(quickEscalationTarget)}
                          disabled={actionLoading}
                          className="rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          {formatStatus(quickEscalationTarget)}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void transitionTo('CLOSED')}
                        disabled={actionLoading || !availableTransitions.includes('CLOSED')}
                        className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Transfer</label>
                    <div className="space-y-2">
                      <select
                        value={transferTeamId}
                        onChange={(event) => setTransferTeamId(event.target.value)}
                        disabled={actionLoading}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Select department</option>
                        {teamsList.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={transferAssigneeId}
                        onChange={(event) => setTransferAssigneeId(event.target.value)}
                        disabled={actionLoading || !transferTeamId}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Select assignee</option>
                        {transferMembers.map((member) => (
                          <option key={member.id} value={member.user.id}>
                            {member.user.displayName}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleTransfer()}
                        disabled={actionLoading || !transferTeamId || transferTeamId === ticket?.assignedTeam?.id}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Transfer
                      </button>
                      <p className="text-xs text-slate-500">Tip: transferring to the same team is blocked.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-white shadow-soft">
              <button
                type="button"
                onClick={() => toggleSection('edit')}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <span className="text-sm font-semibold text-slate-900">Ticket Details</span>
                <ChevronDown
                  className={`h-5 w-5 text-slate-500 transition-transform ${expandedSections.edit ? 'rotate-180' : ''}`}
                />
              </button>
              {expandedSections.edit && (
                <div className="space-y-2 px-4 pb-4 text-sm">
                  {loadingDetail && (
                    <div className="space-y-2">
                      <div className="h-4 w-28 rounded bg-slate-200" />
                      <div className="h-4 w-40 rounded bg-slate-100" />
                    </div>
                  )}
                  {!loadingDetail && ticket && (
                    <>
                      <DetailRow label="Requester" value={ticket.requester?.displayName ?? 'Unknown'} />
                      <DetailRow label="Email" value={ticket.requester?.email ?? '—'} />
                      <DetailRow label="Department" value={ticket.assignedTeam?.name ?? 'Unassigned'} />
                      <DetailRow label="Assignee" value={ticket.assignee?.displayName ?? 'Unassigned'} />
                      <DetailRow label="Category" value={ticket.category?.name ?? 'None'} />
                      <DetailRow label="Created" value={<RelativeTime value={ticket.createdAt} />} />
                    </>
                  )}
                </div>
              )}
            </div>

            {ticket && (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-soft">
                <button
                  type="button"
                  onClick={() => toggleSection('followers')}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="text-sm font-semibold text-slate-900">Followers ({followers.length})</span>
                  <ChevronDown
                    className={`h-5 w-5 text-slate-500 transition-transform ${
                      expandedSections.followers ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {expandedSections.followers && (
                  <div className="px-4 pb-4">
                    <div className="mb-3 space-y-2">
                      {followers.length === 0 && <p className="text-xs text-slate-500">No followers yet.</p>}
                      {followers.map((follower) => (
                        <div key={follower.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-xs font-bold text-white">
                              {initialsFor(follower.user.displayName)}
                            </div>
                            <span className="text-sm font-semibold text-slate-900">{follower.user.displayName}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleFollowToggle()}
                      disabled={followLoading}
                      className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isFollowing ? 'Unfollow ticket' : 'Follow ticket'}
                    </button>
                    {followError && <p className="mt-2 text-xs text-rose-600">{followError}</p>}
                  </div>
                )}
              </div>
            )}

            {ticket && (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-soft">
                <button
                  type="button"
                  onClick={() => toggleSection('additional')}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="text-sm font-semibold text-slate-900">Additional Details</span>
                  <ChevronDown
                    className={`h-5 w-5 text-slate-500 transition-transform ${
                      expandedSections.additional ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {expandedSections.additional && (
                  <div className="space-y-2 px-4 pb-4 text-sm">
                    <DetailRow label="Reference ID" value={formatTicketId(ticket)} />
                    <DetailRow
                      label="First response due"
                      value={ticket.firstResponseDueAt ? <RelativeTime value={ticket.firstResponseDueAt} /> : 'Not set'}
                    />
                    <DetailRow
                      label="Resolution due"
                      value={ticket.dueAt ? <RelativeTime value={ticket.dueAt} /> : 'Not set'}
                    />
                    {ticket.customFieldValues && ticket.customFieldValues.length > 0 && (
                      <div className="pt-2">
                        <CustomFieldsDisplay values={ticket.customFieldValues} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {ticket && (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-soft">
                <button
                  type="button"
                  onClick={() => toggleSection('history')}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="text-sm font-semibold text-slate-900">Status History</span>
                  <ChevronDown
                    className={`h-5 w-5 text-slate-500 transition-transform ${expandedSections.history ? 'rotate-180' : ''}`}
                  />
                </button>

                {expandedSections.history && (
                  <div className="space-y-3 px-4 pb-4">
                    {statusEvents.length === 0 && <p className="text-xs text-slate-500">No status changes recorded yet.</p>}

                    {statusEvents.map((event) => {
                      const payload = (event.payload ?? {}) as { from?: string; to?: string };
                      const actor = event.createdBy?.displayName ?? event.createdBy?.email ?? 'System';
                      return (
                        <div key={event.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="font-semibold text-slate-700">
                              {payload.from ? formatStatus(payload.from) : 'Unknown'} →{' '}
                              {payload.to ? formatStatus(payload.to) : formatStatus(ticket.status)}
                            </span>
                            <span className="text-slate-500">
                              <RelativeTime value={event.createdAt} />
                            </span>
                          </div>
                          <p className="text-slate-500">By {actor}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function slaBadgeClass(label?: string) {
  if (label === 'Met' || label === 'On Track' || label === 'Open') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
  if (label === 'At Risk' || label === 'Paused') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
  if (label === 'Breached') return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200';
  return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
}

const SLA_RISK_WINDOW_MS = 4 * 60 * 60 * 1000;
const SLA_FIRST_RESPONSE_RISK_MS = 2 * 60 * 60 * 1000;

function renderSlaCard(label: string, sla: { label: string; tone: string; detail: ReactNode }) {
  return (
    <div className={`rounded-xl border p-3 ${sla.tone}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold">{label}</span>
        <span className="text-xs font-bold">{sla.label}</span>
      </div>
      <p className="text-xs">{sla.detail}</p>
    </div>
  );
}

function getFirstResponseSla(ticket: TicketDetail) {
  if (ticket.firstResponseAt) {
    return {
      label: 'Met',
      tone: 'border-green-200 bg-green-50 text-green-700',
      detail: (
        <>
          Responded <RelativeTime value={ticket.firstResponseAt} />
        </>
      ),
    };
  }

  if (!ticket.firstResponseDueAt) {
    return {
      label: 'Not set',
      tone: 'border-gray-200 bg-gray-100 text-gray-600',
      detail: 'No SLA configured',
    };
  }

  const dueMs = new Date(ticket.firstResponseDueAt).getTime() - Date.now();
  if (dueMs < 0) {
    return {
      label: 'Breached',
      tone: 'border-red-200 bg-red-50 text-red-700',
      detail: (
        <>
          Due <RelativeTime value={ticket.firstResponseDueAt} />
        </>
      ),
    };
  }

  if (dueMs <= SLA_FIRST_RESPONSE_RISK_MS) {
    return {
      label: 'At Risk',
      tone: 'border-orange-200 bg-orange-50 text-orange-700',
      detail: (
        <>
          Due <RelativeTime value={ticket.firstResponseDueAt} />
        </>
      ),
    };
  }

  return {
    label: 'Open',
    tone: 'border-blue-200 bg-blue-50 text-blue-700',
    detail: (
      <>
        Due <RelativeTime value={ticket.firstResponseDueAt} />
      </>
    ),
  };
}

function getResolutionSla(ticket: TicketDetail) {
  if (ticket.completedAt) {
    return {
      label: 'Met',
      tone: 'border-green-200 bg-green-50 text-green-700',
      detail: (
        <>
          Completed <RelativeTime value={ticket.completedAt} />
        </>
      ),
    };
  }

  if (!ticket.dueAt) {
    return {
      label: 'Not set',
      tone: 'border-gray-200 bg-gray-100 text-gray-600',
      detail: 'No SLA configured',
    };
  }

  const isPaused = ticket.status === 'WAITING_ON_REQUESTER' || ticket.status === 'WAITING_ON_VENDOR';
  if (isPaused) {
    return {
      label: 'Paused',
      tone: 'border-orange-200 bg-orange-50 text-orange-700',
      detail: ticket.slaPausedAt ? (
        <>
          Paused <RelativeTime value={ticket.slaPausedAt} />
        </>
      ) : (
        'Paused'
      ),
    };
  }

  const dueMs = new Date(ticket.dueAt).getTime() - Date.now();
  if (dueMs < 0) {
    return {
      label: 'Breached',
      tone: 'border-red-200 bg-red-50 text-red-700',
      detail: (
        <>
          Due <RelativeTime value={ticket.dueAt} />
        </>
      ),
    };
  }

  if (dueMs <= SLA_RISK_WINDOW_MS) {
    return {
      label: 'At Risk',
      tone: 'border-orange-200 bg-orange-50 text-orange-700',
      detail: (
        <>
          Due <RelativeTime value={ticket.dueAt} />
        </>
      ),
    };
  }

  return {
    label: 'On Track',
    tone: 'border-green-200 bg-green-50 text-green-700',
    detail: (
      <>
        Due <RelativeTime value={ticket.dueAt} />
      </>
    ),
  };
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function formatPriority(priority?: string | null) {
  const value = (priority ?? '').toUpperCase();
  switch (value) {
    case 'P1':
    case 'URGENT':
      return 'Urgent';
    case 'P2':
    case 'HIGH':
      return 'High';
    case 'P3':
    case 'MEDIUM':
      return 'Medium';
    case 'P4':
    case 'LOW':
      return 'Low';
    default:
      return priority ?? 'Unknown';
  }
}

function priorityBadgeClass(priority?: string | null) {
  const label = formatPriority(priority);
  if (label === 'Urgent') return 'bg-red-100 text-red-700';
  if (label === 'High') return 'bg-orange-100 text-orange-700';
  if (label === 'Medium') return 'bg-blue-100 text-blue-700';
  return 'bg-gray-100 text-gray-700';
}

function statusBadgeClass(status?: string | null) {
  switch (status) {
    case 'NEW':
      return 'bg-blue-100 text-blue-800';
    case 'TRIAGED':
    case 'ASSIGNED':
    case 'IN_PROGRESS':
    case 'WAITING_ON_REQUESTER':
    case 'WAITING_ON_VENDOR':
      return 'bg-yellow-100 text-yellow-800';
    case 'RESOLVED':
    case 'CLOSED':
      return 'bg-green-100 text-green-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function formatChannel(channel?: string | null) {
  if (!channel) {
    return 'Unknown';
  }
  return channel
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getEventKind(event: TicketEvent) {
  if (event.type === 'MESSAGE_ADDED') {
    const payload = (event.payload ?? {}) as { type?: string };
    return payload.type === 'INTERNAL' ? 'internal' : 'message';
  }
  return 'default';
}

function formatEventText(event: TicketEvent) {
  const actor = event.createdBy?.displayName ?? event.createdBy?.email ?? 'System';
  const payload = (event.payload ?? {}) as {
    type?: string;
    from?: string;
    to?: string;
    assigneeName?: string | null;
    assigneeEmail?: string | null;
    toTeamName?: string | null;
  };

  switch (event.type) {
    case 'TICKET_CREATED':
      return `Ticket created by ${actor}`;
    case 'TICKET_ASSIGNED':
      return `Assigned to ${payload.assigneeName ?? payload.assigneeEmail ?? 'team member'}`;
    case 'TICKET_STATUS_CHANGED':
      return `Status changed from ${formatStatus(payload.from ?? 'UNKNOWN')} to ${formatStatus(payload.to ?? 'UNKNOWN')}`;
    case 'TICKET_TRANSFERRED':
      return `Transferred to ${payload.toTeamName ?? 'another department'}`;
    case 'TICKET_PRIORITY_CHANGED':
      return `Priority changed from ${formatPriority(payload.from)} to ${formatPriority(payload.to)}`;
    case 'MESSAGE_ADDED':
      return payload.type === 'INTERNAL' ? `${actor} added internal note` : `${actor} replied`;
    default:
      return formatStatus(event.type.replace(/_/g, ' '));
  }
}
