import type { TicketDetail } from '../../api/client';

interface SlaTrackingProps {
  ticket: TicketDetail;
}

type SlaState = 'met' | 'on_track' | 'at_risk' | 'breached' | 'paused' | 'none';

interface SlaInfo {
  label: string;
  state: SlaState;
  detail: string;
}

function relTime(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  const negative = ms < 0;
  const abs = Math.abs(ms);
  const mins = Math.floor(abs / 60_000);
  const days = Math.floor(mins / (60 * 24));
  const hours = Math.floor((mins % (60 * 24)) / 60);
  const remMins = mins % 60;
  let core: string;
  if (days > 0) core = `${days}d ${hours}h`;
  else if (hours > 0) core = `${hours}h ${remMins}m`;
  else core = `${remMins}m`;
  return negative ? `in ${core}` : `${core} ago`;
}

function firstResponseInfo(ticket: TicketDetail, now = Date.now()): SlaInfo {
  const dueAt = ticket.firstResponseDueAt;
  const respondedAt = ticket.firstResponseAt;

  if (respondedAt) {
    const responded = new Date(respondedAt).getTime();
    const due = dueAt ? new Date(dueAt).getTime() : null;
    if (due === null || responded <= due) {
      return { label: 'First response', state: 'met', detail: `${relTime(respondedAt, now)} responded` };
    }
    return { label: 'First response', state: 'breached', detail: `Responded ${relTime(respondedAt, now)} (late)` };
  }

  if (ticket.slaPausedAt) {
    return { label: 'First response', state: 'paused', detail: `Paused ${relTime(ticket.slaPausedAt, now)}` };
  }

  if (!dueAt) {
    return { label: 'First response', state: 'none', detail: 'No SLA' };
  }

  const due = new Date(dueAt).getTime();
  const remaining = due - now;
  if (remaining < 0) return { label: 'First response', state: 'breached', detail: `Due ${relTime(dueAt, now)}` };
  if (remaining < 60 * 60 * 1000) return { label: 'First response', state: 'at_risk', detail: `Due ${relTime(dueAt, now)}` };
  return { label: 'First response', state: 'on_track', detail: `Due ${relTime(dueAt, now)}` };
}

function resolutionInfo(ticket: TicketDetail, now = Date.now()): SlaInfo {
  const dueAt = ticket.dueAt;
  const resolvedAt = ticket.resolvedAt;

  if (resolvedAt) {
    const resolved = new Date(resolvedAt).getTime();
    const due = dueAt ? new Date(dueAt).getTime() : null;
    if (due === null || resolved <= due) {
      return { label: 'Resolution', state: 'met', detail: `Resolved ${relTime(resolvedAt, now)}` };
    }
    return { label: 'Resolution', state: 'breached', detail: `Resolved ${relTime(resolvedAt, now)} (late)` };
  }

  if (ticket.slaPausedAt) {
    return { label: 'Resolution', state: 'paused', detail: `Paused ${relTime(ticket.slaPausedAt, now)}` };
  }

  if (!dueAt) {
    return { label: 'Resolution', state: 'none', detail: 'No SLA' };
  }

  const due = new Date(dueAt).getTime();
  const remaining = due - now;
  if (remaining < 0) return { label: 'Resolution', state: 'breached', detail: `Due ${relTime(dueAt, now)}` };
  if (remaining < 60 * 60 * 1000) return { label: 'Resolution', state: 'at_risk', detail: `Due ${relTime(dueAt, now)}` };
  return { label: 'Resolution', state: 'on_track', detail: `Due ${relTime(dueAt, now)}` };
}

const STATE_STYLES: Record<SlaState, { dot: string; pillBg: string; pillFg: string; pillLabel: string }> = {
  met:       { dot: 'var(--c-green)', pillBg: 'var(--c-green-tint)', pillFg: 'var(--c-green)', pillLabel: 'Met' },
  on_track:  { dot: 'var(--c-green)', pillBg: 'var(--c-green-tint)', pillFg: 'var(--c-green)', pillLabel: 'On track' },
  at_risk:   { dot: 'var(--c-amber)', pillBg: 'var(--c-amber-tint)', pillFg: 'var(--c-amber)', pillLabel: 'At risk' },
  breached:  { dot: 'var(--c-red)',   pillBg: 'var(--c-red-tint)',   pillFg: 'var(--c-red)',   pillLabel: 'Breached' },
  paused:    { dot: 'var(--c-amber)', pillBg: 'var(--c-amber-tint)', pillFg: 'var(--c-amber)', pillLabel: 'Paused' },
  none:      { dot: 'var(--c-fg-5)',  pillBg: 'var(--c-surface-3)',  pillFg: 'var(--c-fg-4)',  pillLabel: '—' },
};

export function SlaTracking({ ticket }: SlaTrackingProps) {
  const fr = firstResponseInfo(ticket);
  const res = resolutionInfo(ticket);

  return (
    <div className="flex flex-col gap-2">
      <SlaRow info={fr} />
      <SlaRow info={res} />
    </div>
  );
}

function SlaRow({ info }: { info: SlaInfo }) {
  const s = STATE_STYLES[info.state];
  return (
    <div className="flex items-center justify-between gap-2 rounded border px-2.5 py-1.5"
      style={{ backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)' }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ backgroundColor: s.dot }} />
        <div className="flex flex-col min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--c-fg-3)' }}>
            {info.label}
          </span>
          <span className="text-[11px] truncate" style={{ color: 'var(--c-fg-4)' }}>
            {info.detail}
          </span>
        </div>
      </div>
      <span
        className="text-[10px] font-semibold uppercase tracking-[0.03em] px-1.5 py-px rounded-sm border flex-none"
        style={{ backgroundColor: s.pillBg, color: s.pillFg, borderColor: 'transparent' }}
      >
        {s.pillLabel}
      </span>
    </div>
  );
}
