import type { ChangeEvent } from 'react';
import type { TicketPriority, TicketStatus, UserRef } from '../../api/client';
import { useBulkAssign, useBulkPriority, useBulkStatus } from './bulk-actions';

interface BulkActionBarProps {
  ticketIds: string[];
  currentUser?: UserRef;
  onClear?: () => void;
  onActionComplete?: () => void;
}

const STATUS_OPTIONS: TicketStatus[] = [
  'NEW',
  'TRIAGED',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_ON_REQUESTER',
  'WAITING_ON_VENDOR',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
];

const PRIORITY_OPTIONS: TicketPriority[] = ['SEV1', 'SEV2', 'SEV3', 'SEV4'];

const buttonStyle = {
  borderColor: 'var(--c-border-strong)',
  color: 'var(--c-fg-2)',
};

const selectStyle = {
  ...buttonStyle,
  backgroundColor: 'white',
};

export function BulkActionBar({
  ticketIds,
  currentUser,
  onClear,
  onActionComplete,
}: BulkActionBarProps) {
  const count = ticketIds.length;
  const assign = useBulkAssign();
  const status = useBulkStatus();
  const priority = useBulkPriority();

  if (count === 0) return null;

  const busy = assign.isPending || status.isPending || priority.isPending;

  const handleAfter = () => {
    onActionComplete?.();
    onClear?.();
  };

  const onAssignToMe = () => {
    if (!currentUser) return;
    assign.mutate({ ticketIds, assignee: currentUser }, { onSuccess: handleAfter });
  };

  const onUnassign = () => {
    assign.mutate({ ticketIds, assignee: undefined }, { onSuccess: handleAfter });
  };

  const onStatusChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as TicketStatus | '';
    if (!value) return;
    status.mutate({ ticketIds, status: value }, { onSuccess: handleAfter });
    e.target.value = '';
  };

  const onPriorityChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as TicketPriority | '';
    if (!value) return;
    priority.mutate({ ticketIds, priority: value }, { onSuccess: handleAfter });
    e.target.value = '';
  };

  return (
    <div
      className="flex items-center gap-2.5 text-[12px] border-b"
      style={{
        backgroundColor: 'var(--c-accent-tint)',
        borderColor: 'var(--c-accent-tint-2)',
        padding: '6px 18px',
      }}
    >
      <span className="font-semibold" style={{ color: 'var(--c-accent)' }}>
        {count} ticket{count === 1 ? '' : 's'} selected
      </span>
      <span className="w-px h-3.5" style={{ backgroundColor: 'var(--c-accent-tint-2)' }} />

      <button
        onClick={onAssignToMe}
        disabled={busy || !currentUser}
        className="text-[12px] px-2 py-0.5 rounded border bg-white disabled:opacity-50"
        style={buttonStyle}
      >
        Assign to me
      </button>
      <button
        onClick={onUnassign}
        disabled={busy}
        className="text-[12px] px-2 py-0.5 rounded border bg-white disabled:opacity-50"
        style={buttonStyle}
      >
        Unassign
      </button>

      <select
        defaultValue=""
        onChange={onStatusChange}
        disabled={busy}
        className="text-[12px] px-2 py-0.5 rounded border bg-white disabled:opacity-50"
        style={selectStyle}
        aria-label="Set status"
      >
        <option value="" disabled>
          Set status…
        </option>
        {STATUS_OPTIONS.map(s => (
          <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>
        ))}
      </select>

      <select
        defaultValue=""
        onChange={onPriorityChange}
        disabled={busy}
        className="text-[12px] px-2 py-0.5 rounded border bg-white disabled:opacity-50"
        style={selectStyle}
        aria-label="Set priority"
      >
        <option value="" disabled>
          Set priority…
        </option>
        {PRIORITY_OPTIONS.map(p => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      <button
        disabled
        className="text-[12px] px-2 py-0.5 rounded border bg-white opacity-50 cursor-not-allowed"
        style={buttonStyle}
        title="Tags coming soon"
      >
        Add tag
      </button>
      <button
        disabled
        className="text-[12px] px-2 py-0.5 rounded border bg-white opacity-50 cursor-not-allowed"
        style={buttonStyle}
        title="Merge coming soon"
      >
        Merge
      </button>

      <span className="flex-1" />
      {(assign.isError || status.isError || priority.isError) && (
        <span className="text-[11px]" style={{ color: 'var(--c-red)' }}>
          Action failed — try again
        </span>
      )}
      <button onClick={onClear} className="text-[12px]" style={{ color: 'var(--c-fg-4)' }}>
        <span
          className="font-mono text-[10px] px-1 rounded-sm border"
          style={{ backgroundColor: 'var(--c-surface-3)', borderColor: 'var(--c-border)' }}
        >
          Esc
        </span>
        {' '}to clear
      </button>
    </div>
  );
}
