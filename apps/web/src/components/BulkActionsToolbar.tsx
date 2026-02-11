import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import type { TeamRef } from '../api/client';
import type { UserRef } from '../api/client';
import { formatStatus } from '../utils/format';

const STATUS_OPTIONS = [
  'NEW',
  'TRIAGED',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_ON_REQUESTER',
  'WAITING_ON_VENDOR',
  'RESOLVED',
  'CLOSED',
  'REOPENED'
];

const PRIORITY_OPTIONS = ['P1', 'P2', 'P3', 'P4'];

type BulkActionsToolbarProps = {
  selectedCount: number;
  onClearSelection: () => void;
  onBulkAssign: (assigneeId?: string) => Promise<{ success: number; failed: number }>;
  onBulkTransfer: (newTeamId: string, assigneeId?: string) => Promise<{ success: number; failed: number }>;
  onBulkStatus: (status: string) => Promise<{ success: number; failed: number }>;
  onBulkPriority: (priority: string) => Promise<{ success: number; failed: number }>;
  teamsList: TeamRef[];
  assignableUsers: UserRef[];
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
};

export function BulkActionsToolbar({
  selectedCount,
  onClearSelection,
  onBulkAssign,
  onBulkTransfer,
  onBulkStatus,
  onBulkPriority,
  teamsList,
  assignableUsers,
  onSuccess,
  onError
}: BulkActionsToolbarProps) {
  const [loading, setLoading] = useState(false);
  const [assignToId, setAssignToId] = useState('');
  const [transferTeamId, setTransferTeamId] = useState('');
  const [transferAssigneeId, setTransferAssigneeId] = useState('');
  const [statusValue, setStatusValue] = useState('');
  const [priorityValue, setPriorityValue] = useState('');

  async function handleBulkAssign(assigneeId?: string) {
    setLoading(true);
    try {
      const result = await onBulkAssign(assigneeId);
      if (result.failed === 0) {
        onSuccess?.(`${result.success} ticket(s) assigned.`);
        onClearSelection();
      } else if (result.success > 0) {
        onSuccess?.(`${result.success} assigned, ${result.failed} failed.`);
        onClearSelection();
      } else {
        onError?.(result.failed === 1 ? 'Unable to assign ticket.' : `Unable to assign (${result.failed} failed).`);
      }
    } catch {
      onError?.('Unable to assign tickets.');
    } finally {
      setLoading(false);
      setAssignToId('');
    }
  }

  async function handleBulkTransfer() {
    if (!transferTeamId) return;
    setLoading(true);
    try {
      const result = await onBulkTransfer(transferTeamId, transferAssigneeId || undefined);
      if (result.failed === 0) {
        onSuccess?.(`${result.success} ticket(s) transferred.`);
        onClearSelection();
        setTransferTeamId('');
        setTransferAssigneeId('');
      } else if (result.success > 0) {
        onSuccess?.(`${result.success} transferred, ${result.failed} failed.`);
        onClearSelection();
        setTransferTeamId('');
        setTransferAssigneeId('');
      } else {
        onError?.(`Transfer failed (${result.failed} ticket(s)).`);
      }
    } catch {
      onError?.('Unable to transfer tickets.');
    } finally {
      setLoading(false);
    }
  }

  async function handleBulkStatus() {
    if (!statusValue) return;
    setLoading(true);
    try {
      const result = await onBulkStatus(statusValue);
      if (result.failed === 0) {
        onSuccess?.(`${result.success} ticket(s) updated to ${formatStatus(statusValue)}.`);
        onClearSelection();
        setStatusValue('');
      } else if (result.success > 0) {
        onSuccess?.(`${result.success} updated, ${result.failed} failed.`);
        onClearSelection();
        setStatusValue('');
      } else {
        onError?.(`Status update failed (${result.failed} ticket(s)).`);
      }
    } catch {
      onError?.('Unable to update status.');
    } finally {
      setLoading(false);
    }
  }

  async function handleBulkPriority() {
    if (!priorityValue) return;
    setLoading(true);
    try {
      const result = await onBulkPriority(priorityValue);
      if (result.failed === 0) {
        onSuccess?.(`${result.success} ticket(s) set to ${priorityValue}.`);
        onClearSelection();
        setPriorityValue('');
      } else if (result.success > 0) {
        onSuccess?.(`${result.success} updated, ${result.failed} failed.`);
        onClearSelection();
        setPriorityValue('');
      } else {
        onError?.(`Priority update failed (${result.failed} ticket(s)).`);
      }
    } catch {
      onError?.('Unable to update priority.');
    } finally {
      setLoading(false);
      setPriorityValue('');
    }
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-blue-900">
          {selectedCount} ticket{selectedCount === 1 ? '' : 's'} selected
          </span>
          <button
            type="button"
            onClick={onClearSelection}
            className="text-sm text-blue-600 transition-colors hover:text-blue-700"
          >
            Clear selection
          </button>
          {loading ? (
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-600">
              Processing...
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Assign to me */}
        <button
          type="button"
          onClick={() => handleBulkAssign()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          <UserPlus className="h-4 w-4" />
          Assign to me
        </button>

        {/* Assign to user */}
        <div className="flex items-center gap-1 rounded-md border border-gray-300 bg-white p-1">
          <select
            value={assignToId}
            onChange={(e) => setAssignToId(e.target.value)}
            disabled={loading || assignableUsers.length === 0}
            className="rounded-md bg-white px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
          >
            <option value="">Assign to…</option>
            {assignableUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => handleBulkAssign(assignToId || undefined)}
            disabled={loading || !assignToId}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            Apply
          </button>
        </div>

        {/* Status */}
        <div className="flex items-center gap-1 rounded-md border border-gray-300 bg-white p-1">
          <select
            value={statusValue}
            onChange={(e) => setStatusValue(e.target.value)}
            disabled={loading}
            className="rounded-md bg-white px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
          >
            <option value="">Status…</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => handleBulkStatus()}
            disabled={loading || !statusValue}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            Apply
          </button>
        </div>

        {/* Priority */}
        <div className="flex items-center gap-1 rounded-md border border-gray-300 bg-white p-1">
          <select
            value={priorityValue}
            onChange={(e) => setPriorityValue(e.target.value)}
            disabled={loading}
            className="rounded-md bg-white px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
          >
            <option value="">Priority…</option>
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => handleBulkPriority()}
            disabled={loading || !priorityValue}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            Apply
          </button>
        </div>

        {/* Transfer */}
        <div className="flex items-center gap-1 rounded-md border border-gray-300 bg-white p-1">
          <select
            value={transferTeamId}
            onChange={(e) => setTransferTeamId(e.target.value)}
            disabled={loading}
            className="rounded-md bg-white px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
          >
            <option value="">Transfer to team…</option>
            {teamsList.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <select
            value={transferAssigneeId}
            onChange={(e) => setTransferAssigneeId(e.target.value)}
            disabled={loading}
            className="rounded-md bg-white px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
          >
            <option value="">Assignee (optional)…</option>
            {assignableUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => handleBulkTransfer()}
            disabled={loading || !transferTeamId}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            Transfer
          </button>
        </div>

      </div>
    </div>
  );
}
