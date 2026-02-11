export function formatStatus(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatDate(value: string | null | undefined) {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

/** Full date/time for tooltips: "January 29, 2026 at 2:45 PM" */
export function formatDateLong(value: string | Date | null | undefined): string {
  if (value == null) {
    return '—';
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const datePart = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
  const timePart = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });
  return `${datePart} at ${timePart}`;
}

/**
 * Relative time for display: "Just now", "5 minutes ago", "2 hours ago", "3 days ago", or "Jan 29, 2026" for >= 7 days.
 */
export function formatRelative(value: string | Date | null | undefined): string {
  if (value == null) {
    return '—';
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const now = Date.now();
  const ms = now - date.getTime();
  const absMs = Math.abs(ms);
  const seconds = Math.floor(absMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (ms < 0) {
    return formatDate(date.toISOString());
  }
  if (seconds < 60) {
    return 'Just now';
  }
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (days < 7) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export function departmentCode(name?: string | null) {
  if (!name) {
    return 'NA';
  }
  const words = name
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(' ')
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) {
    return 'NA';
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function formatTicketId(ticket: {
  displayId?: string | null;
  assignedTeam?: { name?: string | null } | null;
  createdAt?: string;
  number?: number;
}) {
  if (ticket.displayId) {
    return ticket.displayId;
  }
  const date = ticket.createdAt ? new Date(ticket.createdAt) : null;
  if (!date || Number.isNaN(date.getTime()) || ticket.number === undefined || ticket.number === null) {
    return '—';
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const sequence = String(ticket.number).padStart(3, '0');
  return `${departmentCode(ticket.assignedTeam?.name)}_${yyyy}${mm}${dd}_${sequence}`;
}

export function initialsFor(name: string) {
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 0) {
    return 'U';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function statusBadgeClass(status?: string | null) {
  const neutral = 'bg-slate-100 text-slate-700 border-slate-200';
  const newTone = 'bg-sky-100 text-sky-700 border-sky-200';
  const progressTone = 'bg-amber-100 text-amber-700 border-amber-200';
  const resolvedTone = 'bg-emerald-100 text-emerald-700 border-emerald-200';
  switch (status) {
    case 'NEW':
      return newTone;
    case 'TRIAGED':
    case 'ASSIGNED':
    case 'IN_PROGRESS':
    case 'WAITING_ON_REQUESTER':
    case 'WAITING_ON_VENDOR':
      return progressTone;
    case 'RESOLVED':
    case 'CLOSED':
      return resolvedTone;
    case 'REOPENED':
    default:
      return neutral;
  }
}

export function getSlaTone(args: {
  dueAt?: string | null;
  completedAt?: string | null;
  status?: string | null;
  slaPausedAt?: string | null;
}) {
  const { dueAt, completedAt, status, slaPausedAt } = args;
  if (completedAt) {
    return { label: 'Met', className: 'border-emerald-200 bg-emerald-100 text-emerald-700' };
  }
  if (!dueAt) {
    return { label: 'No SLA', className: 'border-slate-200 bg-slate-100 text-slate-600' };
  }
  if (status === 'WAITING_ON_REQUESTER' || status === 'WAITING_ON_VENDOR') {
    return {
      label: slaPausedAt ? 'Paused' : 'Waiting',
      className: 'border-amber-200 bg-amber-100 text-amber-700'
    };
  }
  const ms = new Date(dueAt).getTime() - Date.now();
  if (ms < 0) {
    return { label: 'Breached', className: 'border-rose-200 bg-rose-100 text-rose-700' };
  }
  if (ms <= 4 * 60 * 60 * 1000) {
    return { label: 'At risk', className: 'border-amber-200 bg-amber-100 text-amber-700' };
  }
  return { label: 'On track', className: 'border-sky-200 bg-sky-100 text-sky-700' };
}
