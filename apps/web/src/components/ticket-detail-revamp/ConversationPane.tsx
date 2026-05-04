import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchTicketMessages,
  type TicketDetail,
  type TicketMessage,
} from '../../api/client';
import { useAuthSession } from '../../hooks/useAuthSession';
import { Pill, Prio, Avatar, Icn, I, toneFromName } from '../atoms';
import { MessageBody } from '../MessageBody';
import { ticketToRow } from '../tickets/mappers';

interface ConversationPaneProps {
  ticket: TicketDetail;
}

type ComposerTab = 'public' | 'internal' | 'forward';

export function ConversationPane({ ticket }: ConversationPaneProps) {
  const [composerTab, setComposerTab] = useState<ComposerTab>('public');
  const { user, loading: authLoading } = useAuthSession();

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['ticket-messages-revamp', ticket.id],
    queryFn: () => fetchTicketMessages(ticket.id, { take: 50 }),
    enabled: !!user && !authLoading,
  });

  const messages = messagesData?.data ?? [];
  const row = ticketToRow(ticket); // re-use the same status/priority mapping

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <ConversationHeader ticket={ticket} statusTone={row.statusTone} statusLabel={row.status} />
      <MessageThread messages={messages} loading={messagesLoading} />
      <Composer tab={composerTab} onTabChange={setComposerTab} />
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
  const requesterName = ticket.requester?.displayName ?? '—';
  const created = new Date(ticket.createdAt).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <header
      className="px-5 py-3 border-b flex flex-col gap-1.5"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      <div className="flex items-center gap-2.5">
        <Prio level={ticket.priority} />
        <Pill tone={statusTone} dot>
          {statusLabel}
        </Pill>
        <span
          className="font-mono text-[11px]"
          style={{ color: 'var(--c-fg-4)' }}
        >
          {ticket.displayId ?? `#${ticket.number}`}
        </span>
        <span className="flex-1" />
        <button className="text-[11px] px-2 py-0.5 rounded border inline-flex items-center gap-1" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>
          <Icn d={I.reply} s={11} /> Reply
        </button>
        <button className="text-[11px] px-2 py-0.5 rounded border" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>
          <Icn d={I.more} s={11} />
        </button>
      </div>

      <h1
        className="text-[18px] font-semibold leading-tight tracking-[-0.01em]"
        style={{ color: 'var(--c-fg)' }}
      >
        {ticket.subject}
      </h1>

      <div
        className="flex items-center gap-3 text-[11px]"
        style={{ color: 'var(--c-fg-4)' }}
      >
        <span>
          Requested by <span style={{ color: 'var(--c-fg-2)' }}>{requesterName}</span>
        </span>
        <span>·</span>
        <span className="font-mono">Created {created}</span>
      </div>
    </header>
  );
}

/* ─── Message thread ─────────────────────────────────────────────── */

function MessageThread({ messages, loading }: { messages: TicketMessage[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px]" style={{ color: 'var(--c-fg-4)' }}>
        Loading messages…
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
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: TicketMessage }) {
  const authorName = message.author?.displayName ?? 'Unknown';
  const tone = toneFromName(authorName);
  const initials = authorName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('') || '—';
  const isInternal = message.type === 'INTERNAL';
  const time = new Date(message.createdAt).toLocaleString([], {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return (
    <article
      className="flex gap-2.5"
      style={{
        backgroundColor: isInternal ? 'var(--c-amber-tint)' : 'var(--c-surface-2)',
        border: `1px solid ${isInternal ? '#f4d8b6' : 'var(--c-border)'}`,
        borderRadius: 'var(--r)',
        padding: '10px 12px',
      }}
    >
      <Avatar name={initials} size="md" tone={tone} />
      <div className="flex-1 min-w-0">
        <header className="flex items-center gap-2 mb-1">
          <span className="text-[12px] font-semibold" style={{ color: 'var(--c-fg)' }}>
            {authorName}
          </span>
          {isInternal && (
            <Pill tone="amber">Internal</Pill>
          )}
          <span
            className="font-mono text-[10px] ml-auto"
            style={{ color: 'var(--c-fg-4)' }}
          >
            {time}
          </span>
        </header>
        <MessageBody body={message.body} className="text-[12px]" />
      </div>
    </article>
  );
}

/* ─── Composer placeholder ───────────────────────────────────────── */

function Composer({ tab, onTabChange }: { tab: ComposerTab; onTabChange: (t: ComposerTab) => void }) {
  const tabs: Array<{ id: ComposerTab; label: string }> = [
    { id: 'public',   label: 'Public reply' },
    { id: 'internal', label: 'Internal note' },
    { id: 'forward',  label: 'Forward' },
  ];

  return (
    <footer
      className="border-t flex flex-col"
      style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
    >
      <div className="flex border-b" style={{ borderColor: 'var(--c-divider)' }}>
        {tabs.map(t => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className="px-3 py-1.5 text-[12px] border-b-2"
              style={{
                borderBottomColor: active ? 'var(--c-accent)' : 'transparent',
                color: active ? 'var(--c-fg)' : 'var(--c-fg-3)',
                fontWeight: active ? 600 : 500,
                marginBottom: '-1px',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="px-5 py-4 text-[12px]" style={{ color: 'var(--c-fg-4)' }}>
        <div
          className="border rounded p-3 cursor-not-allowed"
          style={{
            backgroundColor: 'var(--c-surface-2)',
            borderColor: 'var(--c-border)',
            minHeight: 80,
          }}
          title="Reply composer wiring is a follow-up task"
        >
          Reply UI coming in a follow-up — for now use the existing legacy detail page
          for sending messages.
        </div>
      </div>
    </footer>
  );
}
