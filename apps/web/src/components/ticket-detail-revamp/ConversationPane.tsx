import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addTicketMessage,
  fetchTicketEvents,
  fetchTicketMessages,
  fetchUsers,
  uploadTicketAttachment,
  type TicketDetail,
  type TicketMessage,
  type UserRef,
} from '../../api/client';
import { useAuthSession } from '../../hooks/useAuthSession';
import { Pill, Prio, Avatar, Icn, I, toneFromName } from '../atoms';
import { MessageBody } from '../MessageBody';
import { RichTextEditor, type RichTextEditorRef } from '../RichTextEditor';
import { TagChips } from '../tags/TagChips';
import { TicketTimeline } from '../ticket-detail/TicketTimeline';
import { ticketToRow } from '../tickets/mappers';

interface ConversationPaneProps {
  ticket: TicketDetail;
}

type Tab = 'conversation' | 'attachments' | 'timeline';
type ComposerKind = 'public' | 'internal';

export function ConversationPane({ ticket }: ConversationPaneProps) {
  const [tab, setTab] = useState<Tab>('conversation');
  const { user, loading: authLoading } = useAuthSession();
  const authReady = !!user && !authLoading;

  const { data: messagesData, isLoading: messagesLoading, isError: messagesError } = useQuery({
    queryKey: ['ticket-messages-revamp', ticket.id],
    queryFn: () => fetchTicketMessages(ticket.id, { take: 50 }),
    enabled: authReady,
  });

  const { data: eventsData, isLoading: eventsLoading, isError: eventsError } = useQuery({
    queryKey: ['ticket-events-revamp', ticket.id],
    queryFn: () => fetchTicketEvents(ticket.id, { take: 50 }),
    enabled: authReady && tab === 'timeline',
  });

  const messages = messagesData?.data ?? [];
  const row = ticketToRow(ticket);

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <ConversationHeader ticket={ticket} statusTone={row.statusTone} statusLabel={row.status} />

      <Tabs
        tab={tab}
        onChange={setTab}
        counts={{
          conversation: messages.length,
          attachments: ticket.attachments.length,
          timeline: eventsData?.data.length ?? 0,
        }}
      />

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {tab === 'conversation' && (
          <>
            <MessageThread
              ticket={ticket}
              messages={messages}
              loading={messagesLoading}
              error={messagesError}
              currentEmail={user?.email ?? ''}
            />
            <Composer ticket={ticket} />
          </>
        )}
        {tab === 'attachments' && <AttachmentsTab ticket={ticket} />}
        {tab === 'timeline' && (
          <TicketTimeline
            events={eventsData?.data ?? []}
            eventsHasMore={false}
            eventsLoading={eventsLoading}
            eventsError={eventsError ? "Couldn't load timeline" : null}
            onLoadMore={() => {}}
            onRetryLoad={() => {}}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Header ─────────────────────────────────────────────────────── */

function ConversationHeader({
  ticket,
  statusTone,
  statusLabel,
}: {
  ticket: TicketDetail;
  statusTone: ReturnType<typeof ticketToRow>['statusTone'];
  statusLabel: string;
}) {
  const { user } = useAuthSession();
  const requesterName = ticket.requester?.displayName ?? '—';
  const created = new Date(ticket.createdAt).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const canEditTags =
    !!user &&
    (user.role === 'OWNER' ||
      user.role === 'LEAD' ||
      user.role === 'TEAM_ADMIN' ||
      (user.role === 'AGENT' &&
        (ticket.assignee?.id === user.id || ticket.assignee == null)));

  return (
    <header
      className="px-5 py-3 border-b flex flex-col gap-1.5 flex-none"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      <div className="flex items-center gap-2.5">
        <Prio level={ticket.priority} />
        <Pill tone={statusTone} dot>
          {statusLabel}
        </Pill>
        <span className="font-mono text-[11px]" style={{ color: 'var(--c-fg-4)' }}>
          {ticket.displayId ?? `#${ticket.number}`}
        </span>
        <span className="flex-1" />
        <button
          className="text-[11px] px-2 py-0.5 rounded border inline-flex items-center gap-1"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}
        >
          <Icn d={I.reply} s={11} /> Reply
        </button>
        <button
          className="text-[11px] px-2 py-0.5 rounded border"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}
        >
          <Icn d={I.more} s={11} />
        </button>
      </div>

      <h1 className="text-[18px] font-semibold leading-tight tracking-[-0.01em]" style={{ color: 'var(--c-fg)' }}>
        {ticket.subject}
      </h1>

      {ticket.description && (
        <p className="text-[12px] leading-snug" style={{ color: 'var(--c-fg-3)' }}>
          {ticket.description}
        </p>
      )}

      <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--c-fg-4)' }}>
        <span>
          Requested by <span style={{ color: 'var(--c-fg-2)' }}>{requesterName}</span>
        </span>
        <span>·</span>
        <span className="font-mono">Created {created}</span>
      </div>

      <div className="mt-1">
        <TagChips
          ticketId={ticket.id}
          tags={ticket.tags ?? []}
          canEdit={canEditTags}
        />
      </div>
    </header>
  );
}

/* ─── Tabs ───────────────────────────────────────────────────────── */

function Tabs({
  tab,
  onChange,
  counts,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  counts: { conversation: number; attachments: number; timeline: number };
}) {
  const items: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'conversation', label: 'Conversation', count: counts.conversation },
    { id: 'attachments',  label: 'Attachments',  count: counts.attachments },
    { id: 'timeline',     label: 'Timeline',     count: counts.timeline },
  ];

  return (
    <nav
      className="flex items-center gap-3 px-5 border-b flex-none"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      {items.map(it => {
        const active = it.id === tab;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className="py-2 text-[12px] inline-flex items-center gap-1.5 border-b-2"
            style={{
              borderBottomColor: active ? 'var(--c-accent)' : 'transparent',
              color: active ? 'var(--c-fg)' : 'var(--c-fg-3)',
              fontWeight: active ? 600 : 500,
              marginBottom: '-1px',
            }}
          >
            <span>{it.label}</span>
            <span
              className="font-mono text-[10px] px-1.5 py-px rounded-sm"
              style={{
                backgroundColor: active ? 'var(--c-accent-tint)' : 'var(--c-surface-3)',
                color: active ? 'var(--c-accent)' : 'var(--c-fg-4)',
              }}
            >
              {it.count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/* ─── Message thread (chat bubbles) ──────────────────────────────── */

function isSameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today.getTime() - sd.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sd.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

function initials(name: string | undefined | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function MessageThread({
  messages,
  loading,
  error,
  currentEmail,
}: {
  ticket: TicketDetail;
  messages: TicketMessage[];
  loading: boolean;
  error: boolean;
  currentEmail: string;
}) {
  if (loading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px]" style={{ color: 'var(--c-fg-4)' }}>
        Loading messages…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[12px]" style={{ color: 'var(--c-red)' }}>
        Couldn't load messages
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[12px]" style={{ color: 'var(--c-fg-4)' }}>
        <Icn d={I.msg} s={28} />
        <span>No messages yet</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-5 py-4 flex flex-col gap-3">
      {messages.map((msg, i) => {
        const prev = messages[i - 1];
        const showDay = !prev || !isSameDay(prev.createdAt, msg.createdAt);
        const isMine = msg.author?.email?.toLowerCase() === currentEmail.toLowerCase();
        return (
          <div key={msg.id} className="flex flex-col">
            {showDay && <DayDivider iso={msg.createdAt} />}
            <Bubble message={msg} isMine={isMine} />
          </div>
        );
      })}
    </div>
  );
}

function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="flex items-center justify-center my-2">
      <span
        className="text-[10px] font-mono px-2.5 py-0.5 rounded-full border"
        style={{
          backgroundColor: 'var(--c-surface-2)',
          borderColor: 'var(--c-border)',
          color: 'var(--c-fg-4)',
        }}
      >
        {dayLabel(iso)}
      </span>
    </div>
  );
}

function Bubble({ message, isMine }: { message: TicketMessage; isMine: boolean }) {
  const authorName = message.author?.displayName ?? 'Unknown';
  const tone = toneFromName(authorName);
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isInternal = message.type === 'INTERNAL';

  if (isMine) {
    return (
      <div className="flex justify-end">
        <div className="flex flex-col items-end gap-0.5 max-w-[70%]">
          <div className="flex items-center gap-2 text-[10px] mb-0.5" style={{ color: 'var(--c-fg-4)' }}>
            <span className="font-medium" style={{ color: 'var(--c-fg-2)' }}>You</span>
            <span className="font-mono">{time}</span>
            {isInternal && <Pill tone="amber">Internal</Pill>}
          </div>
          <div
            className="rounded-lg px-3 py-2 text-[12px]"
            style={{
              backgroundColor: isInternal ? 'var(--c-amber)' : 'var(--c-accent)',
              color: 'white',
            }}
          >
            <MessageBody body={message.body} className="text-[12px]" invert />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start gap-2 max-w-[70%]">
      <Avatar name={initials(authorName)} size="md" tone={tone} />
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2 text-[10px] mb-0.5" style={{ color: 'var(--c-fg-4)' }}>
          <span className="font-semibold" style={{ color: 'var(--c-fg)' }}>{authorName}</span>
          <span className="font-mono">{time}</span>
          {isInternal && <Pill tone="amber">Internal</Pill>}
        </div>
        <div
          className="rounded-lg px-3 py-2 text-[12px] border"
          style={{
            backgroundColor: isInternal ? 'var(--c-amber-tint)' : 'var(--c-surface-2)',
            borderColor: isInternal ? '#f4d8b6' : 'var(--c-border)',
            color: 'var(--c-fg)',
          }}
        >
          <MessageBody body={message.body} className="text-[12px]" />
        </div>
      </div>
    </div>
  );
}

/* ─── Composer ───────────────────────────────────────────────────── */

function Composer({ ticket }: { ticket: TicketDetail }) {
  const qc = useQueryClient();
  const { user } = useAuthSession();
  // Peer agent: AGENT role viewing a ticket assigned to someone else.
  // They can only post INTERNAL notes — no toggle, no public option.
  const isPeerAgent =
    user?.role === 'AGENT' &&
    ticket.assignee != null &&
    ticket.assignee.id !== user.id;
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<ComposerKind>(
    isPeerAgent ? 'internal' : 'public',
  );
  const editorRef = useRef<RichTextEditorRef | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Keep kind locked to 'internal' if peer-agent status changes after mount.
  useEffect(() => {
    if (isPeerAgent && kind !== 'internal') setKind('internal');
  }, [isPeerAgent, kind]);

  // Fetch some users for @mention autocomplete (legacy RichTextEditor expects array)
  const { data: usersData } = useQuery({
    queryKey: ['mention-users'],
    queryFn: ({ signal }) => fetchUsers({ pageSize: 50 }, { signal }),
    staleTime: 5 * 60_000,
    enabled: !!user,
  });

  const users: UserRef[] = useMemo(() => usersData?.data ?? [], [usersData]);

  const send = useMutation({
    mutationFn: () =>
      addTicketMessage(ticket.id, {
        body: body.trim(),
        type: kind === 'internal' ? 'INTERNAL' : 'PUBLIC',
      }),
    onSuccess: () => {
      setBody('');
      editorRef.current?.focus();
      qc.invalidateQueries({ queryKey: ['ticket-messages-revamp', ticket.id] });
      qc.invalidateQueries({ queryKey: ['ticket-detail-revamp', ticket.id] });
      qc.invalidateQueries({ queryKey: ['tickets-revamp'] });
    },
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadTicketAttachment(ticket.id, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket-detail-revamp', ticket.id] });
    },
  });

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    upload.mutate(file);
    e.target.value = ''; // allow re-uploading the same filename
  };

  const onSend = () => {
    const value = editorRef.current?.getValue?.() ?? body;
    if (!value.trim()) return;
    setBody(value);
    send.mutate();
  };

  const canSend = !send.isPending;

  return (
    <footer
      className="border-t flex flex-col flex-none"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      <div className="flex border-b" style={{ borderColor: 'var(--c-divider)' }}>
        {(isPeerAgent
          ? (['internal'] as ComposerKind[])
          : (['public', 'internal'] as ComposerKind[])
        ).map(k => {
          const active = k === kind;
          return (
            <button
              key={k}
              onClick={() => setKind(k)}
              className="px-3 py-1.5 text-[12px] border-b-2"
              style={{
                borderBottomColor: active ? 'var(--c-accent)' : 'transparent',
                color: active ? 'var(--c-fg)' : 'var(--c-fg-3)',
                fontWeight: active ? 600 : 500,
                marginBottom: '-1px',
              }}
            >
              {k === 'public' ? 'Public reply' : 'Internal note'}
            </button>
          );
        })}
        <span className="flex-1" />
        {upload.isPending && (
          <span className="px-3 self-center text-[11px]" style={{ color: 'var(--c-fg-4)' }}>
            Uploading…
          </span>
        )}
        {upload.isError && (
          <span className="px-3 self-center text-[11px]" style={{ color: 'var(--c-red)' }}>
            Upload failed
          </span>
        )}
      </div>

      <div className="px-5 py-3 flex flex-col gap-2">
        <RichTextEditor
          ref={editorRef}
          value={body}
          onChange={setBody}
          onSubmit={onSend}
          users={users}
          cannedVariables={{
            ticketId: ticket.id,
            ticketSubject: ticket.subject,
            requesterName: ticket.requester?.displayName ?? ticket.requester?.email,
          }}
          placeholder={
            kind === 'internal'
              ? 'Internal note (only visible to agents). Type @ to mention. ⌘+Enter to send.'
              : 'Reply to requester. Type @ to mention. ⌘+Enter to send.'
          }
          onPasteFiles={async (items) => {
            for (const { file, tempId } of items) {
              try {
                const att = await upload.mutateAsync(file);
                if (tempId)
                  editorRef.current?.resolveUploadingImage?.(tempId, att.id);
              } catch {
                if (tempId)
                  editorRef.current?.resolveUploadingImage?.(tempId, null);
              }
            }
          }}
        />

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            onChange={onFileChange}
            className="hidden"
            aria-label="Attach a file"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={upload.isPending}
            className="text-[12px] inline-flex items-center gap-1 px-2 py-1 rounded disabled:opacity-50"
            style={{ color: 'var(--c-fg-3)' }}
            title="Attach file"
          >
            <Icn d={I.paperclip} s={13} />
          </button>
          {send.isError && (
            <span className="text-[11px]" style={{ color: 'var(--c-red)' }}>
              Send failed — try again
            </span>
          )}
          <span className="flex-1" />
          <span className="text-[11px]" style={{ color: 'var(--c-fg-4)' }}>
            <span
              className="font-mono text-[10px] px-1 rounded-sm border"
              style={{ backgroundColor: 'var(--c-surface-3)', borderColor: 'var(--c-border)' }}
            >⌘</span>
            {'+'}
            <span
              className="font-mono text-[10px] px-1 rounded-sm border"
              style={{ backgroundColor: 'var(--c-surface-3)', borderColor: 'var(--c-border)' }}
            >Enter</span>
            {' '}to send
          </span>
          <button
            onClick={onSend}
            disabled={!canSend}
            className="text-[12px] px-3 py-1 rounded inline-flex items-center gap-1 disabled:opacity-50"
            style={{ backgroundColor: 'var(--c-accent)', color: 'white' }}
          >
            <Icn d={I.send} s={11} />
            {send.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </footer>
  );
}

/* ─── Attachments tab ────────────────────────────────────────────── */

function AttachmentsTab({ ticket }: { ticket: TicketDetail }) {
  if (ticket.attachments.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-[13px]" style={{ color: 'var(--c-fg-4)' }}>
        <Icn d={I.paperclip} s={32} />
        <span>No attachments yet</span>
      </div>
    );
  }

  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="flex-1 overflow-auto p-5">
      <ul className="flex flex-col gap-2">
        {ticket.attachments.map(att => (
          <li
            key={att.id}
            className="flex items-center gap-3 px-3 py-2 rounded border"
            style={{ backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)' }}
          >
            <span
              className="w-9 h-9 rounded-full inline-flex items-center justify-center flex-none"
              style={{ backgroundColor: 'var(--c-surface-3)', color: 'var(--c-fg-3)' }}
            >
              <Icn d={I.paperclip} s={14} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium truncate" style={{ color: 'var(--c-fg)' }}>
                {att.fileName}
              </div>
              <div className="text-[11px] flex items-center gap-2" style={{ color: 'var(--c-fg-4)' }}>
                <span>{fmtSize(att.sizeBytes)}</span>
                <span>·</span>
                <span>{new Date(att.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span>·</span>
                <span>{att.uploadedBy.displayName}</span>
              </div>
            </div>
            <button
              className="text-[11px] px-2 py-0.5 rounded border"
              style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}
            >
              Download
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
