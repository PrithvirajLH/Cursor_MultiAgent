import type { TicketRecord, TicketStatus } from '../../api/client';
import type { PrioLevel, AvatarTone, PillTone, SlaState } from '../atoms';
import { toneFromName } from '../atoms';

export interface TicketRow {
  id: string;                    // Database UUID for navigation
  displayId: string;             // human-readable, e.g. "TCK-48201" or "#42"
  subject: string;
  customer: string;              // requester display name (or "—" if missing)
  customerId: string;            // requester email or empty
  priority: PrioLevel;
  status: string;                // human label, e.g. "in progress"
  statusTone: PillTone;
  team: string;                  // assignedTeam name or "—"
  assigneeInitials: string;      // 1-2 chars, "—" if no assignee
  assigneeTone: AvatarTone;
  sla: { pct: number; state: SlaState; text: string };
  updated: string;               // relative time, e.g. "11m", "2h", "1d"
  tags: string[];                // empty for now (Ticket has no tags field)
}

const STATUS_TONE: Record<TicketStatus, PillTone> = {
  NEW:                  'gray',
  TRIAGED:              'gray',
  ASSIGNED:             'amber',
  IN_PROGRESS:          'amber',
  WAITING_ON_REQUESTER: 'blue',
  WAITING_ON_VENDOR:    'blue',
  RESOLVED:             'green',
  CLOSED:               'gray',
  REOPENED:             'red',
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW:                  'new',
  TRIAGED:              'triaged',
  ASSIGNED:             'assigned',
  IN_PROGRESS:          'in progress',
  WAITING_ON_REQUESTER: 'pending',
  WAITING_ON_VENDOR:    'pending',
  RESOLVED:             'resolved',
  CLOSED:               'closed',
  REOPENED:             'reopened',
};

function initials(name: string | undefined | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diff = now - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

function durText(ms: number): string {
  const negative = ms < 0;
  const abs = Math.abs(ms);
  const mins = Math.floor(abs / 60000);
  const days = Math.floor(mins / (60 * 24));
  const hours = Math.floor((mins % (60 * 24)) / 60);
  const remMins = mins % 60;
  let core: string;
  if (days > 0) core = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  else if (hours > 0) core = remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  else core = `${remMins}m`;
  return negative ? `−${core}` : core;
}

function computeSla(t: TicketRecord, now = Date.now()): { pct: number; state: SlaState; text: string } {
  // Use firstResponseDueAt if no first response yet, otherwise dueAt (resolution).
  const target = t.firstResponseAt ? t.dueAt : (t.firstResponseDueAt ?? t.dueAt);
  if (!target) return { pct: 0, state: 'ok', text: '—' };

  // If paused, show ok with paused text
  if (t.slaPausedAt) {
    return { pct: 0, state: 'ok', text: 'paused' };
  }

  // If already resolved, show met
  if (t.resolvedAt || t.status === 'RESOLVED' || t.status === 'CLOSED') {
    return { pct: 100, state: 'ok', text: 'met' };
  }

  const targetMs = new Date(target).getTime();
  const startMs = new Date(t.createdAt).getTime();
  const totalMs = targetMs - startMs;
  const elapsedMs = now - startMs;
  const remainMs = targetMs - now;
  const pct = totalMs > 0 ? Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100)) : 0;

  let state: SlaState = 'ok';
  if (remainMs < 0) state = 'breach';
  else if (remainMs < 60 * 60 * 1000) state = 'warn'; // <1h

  return { pct, state, text: durText(remainMs) };
}

export function ticketToRow(t: TicketRecord): TicketRow {
  const requesterName = t.requester?.displayName ?? '—';
  const assigneeName = t.assignee?.displayName;
  const assigneeChars = initials(assigneeName);
  const assigneeTone: AvatarTone = assigneeName ? toneFromName(assigneeName) : 'g';

  return {
    id: t.id,
    displayId: t.displayId ?? `#${t.number}`,
    subject: t.subject,
    customer: requesterName,
    customerId: t.requester?.email ?? '',
    priority: t.priority,
    status: STATUS_LABEL[t.status] ?? t.status.toLowerCase(),
    statusTone: STATUS_TONE[t.status] ?? 'gray',
    team: t.assignedTeam?.name ?? '—',
    assigneeInitials: assigneeChars,
    assigneeTone,
    sla: computeSla(t),
    updated: relTime(t.updatedAt),
    tags: [], // TicketRecord has no tags field; future addition
  };
}
