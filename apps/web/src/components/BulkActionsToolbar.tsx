import { useState, useEffect } from "react";
import {
  UserPlus,
  X,
  ArrowRightLeft,
  CircleDot,
  Signal,
  Loader2,
  ChevronDown,
} from "lucide-react";
import type { TeamRef, TeamMember } from "../api/client";
import type { UserRef } from "../api/client";
import { fetchTeamMembers } from "../api/client";
import { formatStatus } from "../utils/format";

const STATUS_OPTIONS = [
  "NEW",
  "TRIAGED",
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_ON_REQUESTER",
  "WAITING_ON_VENDOR",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
];

const PRIORITY_OPTIONS = ["P1", "P2", "P3", "P4"];

type BulkActionsToolbarProps = {
  selectedCount: number;
  onClearSelection: () => void;
  onBulkAssign: (
    assigneeId?: string,
  ) => Promise<{ success: number; failed: number }>;
  onBulkTransfer: (
    newTeamId: string,
    assigneeId?: string,
  ) => Promise<{ success: number; failed: number }>;
  onBulkStatus: (
    status: string,
  ) => Promise<{ success: number; failed: number }>;
  onBulkPriority: (
    priority: string,
  ) => Promise<{ success: number; failed: number }>;
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
  onError,
}: BulkActionsToolbarProps) {
  const [loading, setLoading] = useState(false);
  const [assignToId, setAssignToId] = useState("");
  const [transferTeamId, setTransferTeamId] = useState("");
  const [transferAssigneeId, setTransferAssigneeId] = useState("");
  const [transferMembers, setTransferMembers] = useState<TeamMember[]>([]);
  const [transferMembersLoading, setTransferMembersLoading] = useState(false);
  const [statusValue, setStatusValue] = useState("");
  const [priorityValue, setPriorityValue] = useState("");

  // Fetch team members when transfer team changes
  useEffect(() => {
    if (!transferTeamId) {
      setTransferMembers([]);
      setTransferAssigneeId("");
      return;
    }
    setTransferMembersLoading(true);
    setTransferAssigneeId("");
    fetchTeamMembers(transferTeamId)
      .then((res) => setTransferMembers(res.data))
      .catch(() => setTransferMembers([]))
      .finally(() => setTransferMembersLoading(false));
  }, [transferTeamId]);

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
        onError?.(
          result.failed === 1
            ? "Unable to assign ticket."
            : `Unable to assign (${result.failed} failed).`,
        );
      }
    } catch {
      onError?.("Unable to assign tickets.");
    } finally {
      setLoading(false);
      setAssignToId("");
    }
  }

  async function handleBulkTransfer() {
    if (!transferTeamId) return;
    setLoading(true);
    try {
      const result = await onBulkTransfer(
        transferTeamId,
        transferAssigneeId || undefined,
      );
      if (result.failed === 0) {
        onSuccess?.(`${result.success} ticket(s) transferred.`);
        onClearSelection();
        setTransferTeamId("");
        setTransferAssigneeId("");
      } else if (result.success > 0) {
        onSuccess?.(`${result.success} transferred, ${result.failed} failed.`);
        onClearSelection();
        setTransferTeamId("");
        setTransferAssigneeId("");
      } else {
        onError?.(`Transfer failed (${result.failed} ticket(s)).`);
      }
    } catch {
      onError?.("Unable to transfer tickets.");
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
        onSuccess?.(
          `${result.success} ticket(s) updated to ${formatStatus(statusValue)}.`,
        );
        onClearSelection();
        setStatusValue("");
      } else if (result.success > 0) {
        onSuccess?.(`${result.success} updated, ${result.failed} failed.`);
        onClearSelection();
        setStatusValue("");
      } else {
        onError?.(`Status update failed (${result.failed} ticket(s)).`);
      }
    } catch {
      onError?.("Unable to update status.");
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
        setPriorityValue("");
      } else if (result.success > 0) {
        onSuccess?.(`${result.success} updated, ${result.failed} failed.`);
        onClearSelection();
        setPriorityValue("");
      } else {
        onError?.(`Priority update failed (${result.failed} ticket(s)).`);
      }
    } catch {
      onError?.("Unable to update priority.");
    } finally {
      setLoading(false);
      setPriorityValue("");
    }
  }

  return (
    <div className="rounded-xl border border-primary/20 bg-card shadow-card">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50">
        <div className="flex items-center gap-2">
          <span className="h-6 min-w-[24px] px-1.5 rounded-md bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">
            {selectedCount}
          </span>
          <span className="text-[12px] font-medium text-foreground">
            selected
          </span>
        </div>

        {loading && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        )}

        <button
          type="button"
          onClick={onClearSelection}
          className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      </div>

      {/* Actions row */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        {/* Assign to me */}
        <button
          type="button"
          onClick={() => handleBulkAssign()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 rounded-xl border border-border bg-card shadow-sm px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:border-foreground/20 disabled:opacity-50"
        >
          <UserPlus className="h-3.5 w-3.5" />
          Assign to me
        </button>

        <Divider />

        {/* Assign to user */}
        <ActionGroup>
          <StyledSelect
            value={assignToId}
            onChange={setAssignToId}
            disabled={loading || assignableUsers.length === 0}
            placeholder="Assign to..."
            options={assignableUsers.map((u) => ({
              value: u.id,
              label: u.displayName,
            }))}
          />
          {assignToId && (
            <ActionButton
              onClick={() => handleBulkAssign(assignToId || undefined)}
              disabled={loading}
            >
              Apply
            </ActionButton>
          )}
        </ActionGroup>

        <Divider />

        {/* Status */}
        <ActionGroup>
          <StyledSelect
            value={statusValue}
            onChange={setStatusValue}
            disabled={loading}
            placeholder="Status"
            icon={CircleDot}
            options={STATUS_OPTIONS.map((s) => ({
              value: s,
              label: formatStatus(s),
            }))}
          />
          {statusValue && (
            <ActionButton onClick={() => handleBulkStatus()} disabled={loading}>
              Apply
            </ActionButton>
          )}
        </ActionGroup>

        {/* Priority */}
        <ActionGroup>
          <StyledSelect
            value={priorityValue}
            onChange={setPriorityValue}
            disabled={loading}
            placeholder="Priority"
            icon={Signal}
            options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: p }))}
          />
          {priorityValue && (
            <ActionButton
              onClick={() => handleBulkPriority()}
              disabled={loading}
            >
              Apply
            </ActionButton>
          )}
        </ActionGroup>

        <Divider />

        {/* Transfer */}
        <ActionGroup>
          <StyledSelect
            value={transferTeamId}
            onChange={setTransferTeamId}
            disabled={loading}
            placeholder="Transfer to..."
            icon={ArrowRightLeft}
            options={teamsList.map((t) => ({ value: t.id, label: t.name }))}
          />
          {transferTeamId && (
            <>
              <StyledSelect
                value={transferAssigneeId}
                onChange={setTransferAssigneeId}
                disabled={loading || transferMembersLoading}
                placeholder={
                  transferMembersLoading ? "Loading..." : "Assignee (optional)"
                }
                options={transferMembers.map((m) => ({
                  value: m.user.id,
                  label: m.user.displayName,
                }))}
              />
              <ActionButton
                onClick={() => handleBulkTransfer()}
                disabled={loading}
              >
                Transfer
              </ActionButton>
            </>
          )}
        </ActionGroup>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function Divider() {
  return <div className="h-5 w-px bg-border/60 mx-0.5 shrink-0" />;
}

function ActionGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>;
}

function ActionButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0 shadow-sm"
    >
      {children}
    </button>
  );
}

function StyledSelect({
  value,
  onChange,
  disabled,
  placeholder,
  icon: Icon,
  options,
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  placeholder: string;
  icon?: typeof CircleDot;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      {Icon && (
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`h-9 appearance-none rounded-xl border border-border bg-card shadow-sm pr-8 text-sm transition-all cursor-pointer
          focus:outline-none focus:ring-2 focus:ring-ring/30
          hover:border-foreground/20 disabled:opacity-50 disabled:cursor-not-allowed
          ${Icon ? "pl-8" : "pl-3"}
          text-foreground`}
        style={{ fontFamily: "inherit" }}
      >
        <option value="">
          {placeholder}
        </option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="text-foreground" style={{ color: "black" }}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
    </div>
  );
}
