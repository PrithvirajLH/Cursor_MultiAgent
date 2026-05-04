import { FilterChip } from './FilterChip';
import { AddFilterPopover } from './AddFilterPopover';
import type { TicketFilters } from '../../types';

interface FilterRowProps {
  filters: TicketFilters;
  setFilters: (updates: Partial<TicketFilters>) => void;
  hasActiveFilters: boolean;
  onClearAll: () => void;
}

interface DerivedChip {
  key: string;
  label: string;
  value: string;
  clear: Partial<TicketFilters>;
}

function deriveChips(filters: TicketFilters): DerivedChip[] {
  const chips: DerivedChip[] = [];

  if (filters.statusGroup && filters.statusGroup !== 'all') {
    chips.push({
      key: 'statusGroup',
      label: 'status',
      value: filters.statusGroup,
      clear: { statusGroup: 'all' },
    });
  }

  if (filters.statuses.length) {
    chips.push({
      key: 'statuses',
      label: 'status',
      value: filters.statuses.join(', '),
      clear: { statuses: [] },
    });
  }

  if (filters.priorities.length) {
    chips.push({
      key: 'priorities',
      label: 'priority',
      value: filters.priorities.join(', '),
      clear: { priorities: [] },
    });
  }

  if (filters.scope !== 'all') {
    chips.push({
      key: 'scope',
      label: 'scope',
      value: filters.scope,
      clear: { scope: 'all' },
    });
  }

  if (filters.slaStatus.length) {
    chips.push({
      key: 'slaStatus',
      label: 'sla',
      value: filters.slaStatus.join(', ').replace(/_/g, ' '),
      clear: { slaStatus: [] },
    });
  }

  if (filters.assigneeIds.length) {
    chips.push({
      key: 'assigneeIds',
      label: 'assignee',
      value: `${filters.assigneeIds.length} selected`,
      clear: { assigneeIds: [] },
    });
  }

  if (filters.teamIds.length) {
    chips.push({
      key: 'teamIds',
      label: 'team',
      value: `${filters.teamIds.length} selected`,
      clear: { teamIds: [] },
    });
  }

  if (filters.requesterIds.length) {
    chips.push({
      key: 'requesterIds',
      label: 'requester',
      value: `${filters.requesterIds.length} selected`,
      clear: { requesterIds: [] },
    });
  }

  if (filters.q.trim()) {
    chips.push({
      key: 'q',
      label: 'search',
      value: filters.q.trim(),
      clear: { q: '' },
    });
  }

  if (filters.createdFrom || filters.createdTo) {
    chips.push({
      key: 'created',
      label: 'created',
      value: `${filters.createdFrom || '…'} → ${filters.createdTo || '…'}`,
      clear: { createdFrom: '', createdTo: '' },
    });
  }

  if (filters.updatedFrom || filters.updatedTo) {
    chips.push({
      key: 'updated',
      label: 'updated',
      value: `${filters.updatedFrom || '…'} → ${filters.updatedTo || '…'}`,
      clear: { updatedFrom: '', updatedTo: '' },
    });
  }

  if (filters.dueFrom || filters.dueTo) {
    chips.push({
      key: 'due',
      label: 'due',
      value: `${filters.dueFrom || '…'} → ${filters.dueTo || '…'}`,
      clear: { dueFrom: '', dueTo: '' },
    });
  }

  return chips;
}

export function FilterRow({ filters, setFilters, hasActiveFilters, onClearAll }: FilterRowProps) {
  const chips = deriveChips(filters);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {chips.map(c => (
        <FilterChip
          key={c.key}
          label={c.label}
          value={c.value}
          active
          onRemove={() => setFilters(c.clear)}
        />
      ))}
      {hasActiveFilters && (
        <button
          onClick={onClearAll}
          className="text-[11px] px-1.5 py-1 rounded inline-flex items-center gap-1"
          style={{ color: 'var(--c-fg-4)' }}
        >
          Clear all
        </button>
      )}
      <AddFilterPopover filters={filters} setFilters={setFilters} />
    </div>
  );
}
