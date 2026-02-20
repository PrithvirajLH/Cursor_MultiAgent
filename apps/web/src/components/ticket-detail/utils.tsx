import type { ReactNode } from 'react';
import type { TicketDetail, TicketEvent } from '../../api/client';
import { formatStatus } from '../../utils/format';
import {
  statusBadgeClass as _statusBadgeClass,
  priorityBadgeClass as _priorityBadgeClass,
  slaBadgeClass as _slaBadgeClass,
  slaDetailClass,
} from '../../utils/statusColors';
import type { SlaTone } from '../../utils/statusColors';

/* ——— SLA helpers ——— */

const SLA_RISK_WINDOW_MS = 4 * 60 * 60 * 1000;
const SLA_FIRST_RESPONSE_RISK_MS = 2 * 60 * 60 * 1000;

export type SlaInfo = {
  label: string;
  tone: string;
  detail: ReactNode;
};

export function getFirstResponseSla(ticket: TicketDetail, RelativeTime: React.ComponentType<{ value: string }>): SlaInfo {
  if (ticket.firstResponseAt) {
    const tone: SlaTone = 'met';
    return { label: 'Met', tone: slaDetailClass(tone), detail: <><RelativeTime value={ticket.firstResponseAt} /> responded</> };
  }
  if (!ticket.firstResponseDueAt) {
    return { label: 'Not set', tone: slaDetailClass('none'), detail: 'No SLA configured' };
  }
  const dueMs = new Date(ticket.firstResponseDueAt).getTime() - Date.now();
  if (dueMs < 0) {
    return { label: 'Breached', tone: slaDetailClass('breached'), detail: <>Due <RelativeTime value={ticket.firstResponseDueAt} /></> };
  }
  if (dueMs <= SLA_FIRST_RESPONSE_RISK_MS) {
    return { label: 'At Risk', tone: slaDetailClass('atRisk'), detail: <>Due <RelativeTime value={ticket.firstResponseDueAt} /></> };
  }
  return { label: 'Open', tone: slaDetailClass('onTrack'), detail: <>Due <RelativeTime value={ticket.firstResponseDueAt} /></> };
}

export function getResolutionSla(ticket: TicketDetail, RelativeTime: React.ComponentType<{ value: string }>): SlaInfo {
  if (ticket.completedAt) {
    return { label: 'Met', tone: slaDetailClass('met'), detail: <>Completed <RelativeTime value={ticket.completedAt} /></> };
  }
  if (!ticket.dueAt) {
    return { label: 'Not set', tone: slaDetailClass('none'), detail: 'No SLA configured' };
  }
  const isPaused = ticket.status === 'WAITING_ON_REQUESTER' || ticket.status === 'WAITING_ON_VENDOR';
  if (isPaused) {
    return {
      label: 'Paused', tone: slaDetailClass('paused'),
      detail: ticket.slaPausedAt ? <>Paused <RelativeTime value={ticket.slaPausedAt} /></> : 'Paused',
    };
  }
  const dueMs = new Date(ticket.dueAt).getTime() - Date.now();
  if (dueMs < 0) {
    return { label: 'Breached', tone: slaDetailClass('breached'), detail: <>Due <RelativeTime value={ticket.dueAt} /></> };
  }
  if (dueMs <= SLA_RISK_WINDOW_MS) {
    return { label: 'At Risk', tone: slaDetailClass('atRisk'), detail: <>Due <RelativeTime value={ticket.dueAt} /></> };
  }
  return { label: 'On Track', tone: slaDetailClass('onTrack'), detail: <>Due <RelativeTime value={ticket.dueAt} /></> };
}

// Re-export from centralized utility (7.4 fix)
export const slaBadgeClass = _slaBadgeClass;

/* ——— Formatting helpers ——— */

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function formatPriority(priority?: string | null) {
  const value = (priority ?? '').toUpperCase();
  switch (value) {
    case 'P1': case 'URGENT': return 'Urgent';
    case 'P2': case 'HIGH': return 'High';
    case 'P3': case 'MEDIUM': return 'Medium';
    case 'P4': case 'LOW': return 'Low';
    default: return priority ?? 'Unknown';
  }
}

// Re-export from centralized utility (7.4 fix)
export const priorityBadgeClass = _priorityBadgeClass;
export const statusBadgeClass = _statusBadgeClass;

export function formatChannel(channel?: string | null) {
  if (!channel) return 'Unknown';
  return channel
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getEventKind(event: TicketEvent) {
  if (event.type === 'MESSAGE_ADDED') {
    const payload = (event.payload ?? {}) as { type?: string };
    return payload.type === 'INTERNAL' ? 'internal' : 'message';
  }
  return 'default';
}

export function formatEventText(event: TicketEvent) {
  const actor = event.createdBy?.displayName ?? event.createdBy?.email ?? 'System';
  const payload = (event.payload ?? {}) as {
    type?: string; from?: string; to?: string;
    assigneeName?: string | null; assigneeEmail?: string | null;
    toTeamName?: string | null;
  };

  switch (event.type) {
    case 'TICKET_CREATED': return `Ticket created by ${actor}`;
    case 'TICKET_ASSIGNED': return `Assigned to ${payload.assigneeName ?? payload.assigneeEmail ?? 'team member'}`;
    case 'TICKET_STATUS_CHANGED': return `Status changed from ${formatStatus(payload.from ?? 'UNKNOWN')} to ${formatStatus(payload.to ?? 'UNKNOWN')}`;
    case 'TICKET_TRANSFERRED': return `Transferred to ${payload.toTeamName ?? 'another department'}`;
    case 'TICKET_PRIORITY_CHANGED': return `Priority changed from ${formatPriority(payload.from)} to ${formatPriority(payload.to)}`;
    case 'MESSAGE_ADDED': return payload.type === 'INTERNAL' ? `${actor} added internal note` : `${actor} replied`;
    default: return formatStatus(event.type.replace(/_/g, ' '));
  }
}
