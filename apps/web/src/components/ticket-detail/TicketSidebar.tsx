import {
  memo,
  type ReactNode,
  type RefObject,
  useState,
  useRef,
  useEffect,
} from "react";
import { ChevronDown, Check, UserPlus, UserMinus, Clock } from "lucide-react";
import type {
  TicketDetail,
  TicketEvent,
  TicketFollower,
  TeamMember,
  TeamRef,
} from "../../api/client";
import { CustomFieldsDisplay } from "../CustomFieldRenderer";
import { RelativeTime } from "../RelativeTime";
import { formatStatus, formatTicketId, initialsFor } from "../../utils/format";
import {
  formatPriority,
  getFirstResponseSla,
  getResolutionSla,
  priorityBadgeClass,
  slaBadgeClass,
} from "./utils";

export type ExpandedSections = {
  edit: boolean;
  followers: boolean;
  additional: boolean;
  history: boolean;
};

export type TicketSidebarProps = {
  ticket: TicketDetail;
  canManage: boolean;
  actionError: string | null;
  actionLoading: boolean;
  assignToId: string;
  setAssignToId: (id: string) => void;
  teamMembers: TeamMember[];
  membersLoading: boolean;
  onAssignMember: () => void;
  onAssignSelf: () => void;
  nextStatus: string;
  setNextStatus: (status: string) => void;
  availableTransitions: string[];
  statusSelectRef: RefObject<HTMLSelectElement | null>;
  onTransition: () => void;
  onTransitionTo: (status: string) => void;
  quickEscalationTarget: string | null;
  transferTeamId: string;
  setTransferTeamId: (id: string) => void;
  transferAssigneeId: string;
  setTransferAssigneeId: (id: string) => void;
  transferMembers: TeamMember[];
  teamsList: TeamRef[];
  onTransfer: () => void;
  expandedSections: ExpandedSections;
  toggleSection: (section: keyof ExpandedSections) => void;
  loadingDetail: boolean;
  followers: TicketFollower[];
  isFollowing: boolean;
  followLoading: boolean;
  followError: string | null;
  onFollowToggle: () => void;
  statusEvents: TicketEvent[];
};

export const TicketSidebar = memo(function TicketSidebar(
  props: TicketSidebarProps,
) {
  const {
    ticket,
    canManage,
    actionError,
    actionLoading,
    assignToId,
    setAssignToId,
    teamMembers,
    membersLoading,
    onAssignMember,
    onAssignSelf,
    availableTransitions,
    onTransitionTo,
    transferTeamId,
    setTransferTeamId,
    teamsList,
    onTransfer,
    followers,
    isFollowing,
    followLoading,
    followError,
    onFollowToggle,
    statusEvents,
    expandedSections,
    toggleSection,
  } = props;

  const firstResponseSla = getFirstResponseSla(ticket, RelativeTime);
  const resolutionSla = getResolutionSla(ticket, RelativeTime);

  const facility = (() => {
    const firstLine = (ticket.description ?? "").split("\n")[0] ?? "";
    const prefix = "Facility:";
    if (!firstLine.startsWith(prefix)) return null;
    return firstLine.slice(prefix.length).trim() || null;
  })();

  return (
    <aside className="flex h-full flex-col gap-3 bg-background px-3 pt-3 pb-6 text-[13px] text-foreground">
      {/* Properties card */}
      <div className="flex flex-col overflow-visible rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-[13px] font-semibold text-foreground">
            Properties
          </h3>
          <div className="flex items-center gap-2">
            {followers.length > 0 && (
              <div className="flex -space-x-1.5">
                {followers.slice(0, 3).map((f) => (
                  <div
                    key={f.id}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary ring-2 ring-card shadow-sm"
                    title={f.user.displayName}
                  >
                    {initialsFor(f.user.displayName)}
                  </div>
                ))}
                {followers.length > 3 && (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground ring-2 ring-card shadow-sm">
                    +{followers.length - 3}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={onFollowToggle}
              disabled={followLoading}
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-muted-foreground transition-all ${
                isFollowing
                  ? "border-primary/30 bg-primary/10 text-primary hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-400 group"
                  : "border-border bg-card hover:border-border/80 hover:bg-muted hover:text-foreground"
              }`}
              title={isFollowing ? "Unfollow" : "Follow"}
            >
              {isFollowing ? (
                <>
                  <UserPlus className="h-3.5 w-3.5 group-hover:hidden" />
                  <UserMinus className="hidden h-3.5 w-3.5 group-hover:block" />
                </>
              ) : (
                <UserPlus className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

        {actionError && (
          <div className="mx-5 mt-3 rounded-lg bg-rose-500/10 p-2 text-[12px] font-medium text-rose-400">
            {actionError}
          </div>
        )}
        {followError && (
          <div className="mx-5 mt-2 rounded-lg bg-rose-500/10 p-2 text-[12px] font-medium text-rose-400">
            {followError}
          </div>
        )}

        {/* Property List */}
        <div className="mt-3 space-y-0.5 border-t border-border bg-card/50 p-2">
          <PropertyRow label="Status">
            {canManage && availableTransitions.length > 0 ? (
              <InlineSelect
                value={ticket.status}
                placeholder="Status"
                options={[
                  { value: ticket.status, label: formatStatus(ticket.status) },
                  ...availableTransitions
                    .filter((s) => s !== ticket.status)
                    .map((s) => ({ value: s, label: formatStatus(s) })),
                ]}
                onChange={(val) => onTransitionTo(val)}
                disabled={actionLoading}
                renderValue={(val) => <StatusBadge status={val} />}
              />
            ) : (
              <div className="px-1.5">
                <StatusBadge status={ticket.status} />
              </div>
            )}
          </PropertyRow>

          <PropertyRow label="Assignee">
            {canManage ? (
              <div className="flex items-center gap-1 overflow-hidden w-full group/assign overflow-visible relative">
                <InlineSelect
                  buttonClassName="flex-1 w-full"
                  value={ticket.assignee?.id ?? ""}
                  placeholder="Unassigned"
                  options={[
                    ...teamMembers.map((m) => ({
                      value: m.user.id,
                      label: m.user.displayName,
                      avatarString: m.user.displayName,
                    })),
                  ]}
                  onChange={(val) => {
                    setAssignToId(val);
                  }}
                  disabled={actionLoading || membersLoading}
                  renderValue={() =>
                    ticket.assignee ? (
                      <div className="flex items-center gap-1.5 text-foreground truncate font-medium">
                        <Avatar name={ticket.assignee.displayName} />
                        <span className="truncate">
                          {ticket.assignee.displayName}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground font-medium">
                        Unassigned
                      </span>
                    )
                  }
                />
                {assignToId && assignToId !== (ticket.assignee?.id ?? "") && (
                  <button
                    onClick={onAssignMember}
                    disabled={actionLoading}
                    className="h-6 px-2.5 bg-primary text-primary-foreground rounded text-[11px] font-semibold hover:bg-primary/90 shadow-sm shrink-0"
                  >
                    Save
                  </button>
                )}
                {!ticket.assignee && (
                  <button
                    onClick={onAssignSelf}
                    disabled={actionLoading}
                    className="hidden group-hover/assign:flex absolute right-0 bg-card shadow-sm ring-1 ring-border h-6 px-2 text-[11px] font-semibold text-muted-foreground items-center rounded-md hover:text-primary"
                  >
                    Assign to me
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-foreground truncate px-1.5 font-medium">
                {ticket.assignee ? (
                  <>
                    <Avatar name={ticket.assignee.displayName} />
                    <span className="truncate">
                      {ticket.assignee.displayName}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Unassigned</span>
                )}
              </div>
            )}
          </PropertyRow>

          <PropertyRow label="Department">
            {canManage ? (
              <div className="relative flex w-full items-center gap-1 overflow-visible">
                <InlineSelect
                  buttonClassName="flex-1 w-full"
                  value={transferTeamId || (ticket.assignedTeam?.id ?? "")}
                  placeholder="None"
                  options={teamsList.map((t) => ({
                    value: t.id,
                    label: t.name,
                  }))}
                  onChange={(val) => setTransferTeamId(val)}
                  disabled={actionLoading}
                  renderValue={(val) => {
                    const label =
                      teamsList.find((t) => t.id === val)?.name ||
                      ticket.assignedTeam?.name;
                    return label ? (
                      <span className="text-foreground font-medium truncate">
                        {label}
                      </span>
                    ) : (
                      <span className="text-muted-foreground font-medium">None</span>
                    );
                  }}
                />
                {transferTeamId &&
                  transferTeamId !== ticket.assignedTeam?.id && (
                    <button
                      onClick={onTransfer}
                      disabled={actionLoading}
                      className="h-6 px-2.5 bg-primary text-primary-foreground rounded text-[11px] font-semibold hover:bg-primary/90 shadow-sm shrink-0"
                    >
                      Set
                    </button>
                  )}
              </div>
            ) : (
              <span className="text-foreground truncate px-1.5 font-medium">
                {ticket.assignedTeam?.name ?? "None"}
              </span>
            )}
          </PropertyRow>

          <PropertyRow label="Priority">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ${priorityBadgeClass(ticket.priority)}`}
            >
              {formatPriority(ticket.priority)}
            </span>
          </PropertyRow>

          <PropertyRow label="Category">
            <span className="text-foreground truncate px-1.5 font-medium">
              {ticket.category?.name ?? "None"}
            </span>
          </PropertyRow>
        </div>
      </div>

      {/* SLAs */}
      <div className="rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> SLAs
          </h4>
          <span
            className={`rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase border ${slaBadgeClass(resolutionSla.label)}`}
          >
            {resolutionSla.label}
          </span>
        </div>
        <div className="grid gap-2">
          <SlaRow label="First Response" sla={firstResponseSla} />
          <SlaRow label="Resolution" sla={resolutionSla} />
        </div>
      </div>

      {/* Details */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Details
        </h4>
        <div className="space-y-2.5">
          <DetailText
            label="Requester"
            value={ticket.requester?.displayName ?? "Unknown"}
          />
          <DetailText label="Email" value={ticket.requester?.email ?? "—"} />
          <DetailText label="Reference" value={formatTicketId(ticket)} />
          {facility && <DetailText label="Facility" value={facility} />}
          <DetailText
            label="Created"
            value={<RelativeTime value={ticket.createdAt} />}
          />
        </div>
      </div>

      {/* Custom Fields */}
      {ticket.customFieldValues && ticket.customFieldValues.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Custom Fields
          </h4>
          <div className="space-y-3">
            <CustomFieldsDisplay values={ticket.customFieldValues} />
          </div>
        </div>
      )}

      {/* History */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <button
          type="button"
          onClick={() => toggleSection("history")}
          className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left hover:bg-muted/30"
        >
          <div className="flex flex-col gap-0.5">
            <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              Status History
            </h4>
            {statusEvents.length > 0 && (
              <span className="text-[11px] text-muted-foreground">
                Showing last {statusEvents.length} change
                {statusEvents.length > 1 ? "s" : ""} • Full history in{" "}
                <span className="font-semibold text-foreground">Timeline</span>
              </span>
            )}
          </div>
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expandedSections.history ? "rotate-180" : ""}`}
          />
        </button>
        {statusEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No status changes recorded yet.
          </p>
        ) : null}
        {expandedSections.history && statusEvents.length > 0 ? (
          <div className="space-y-3">
            {statusEvents.map((event, index) => {
              const payload = (event.payload ?? {}) as {
                from?: string;
                to?: string;
              };
              const actor =
                event.createdBy?.displayName ??
                event.createdBy?.email ??
                "System";
              const fromLabel = payload.from
                ? formatStatus(payload.from)
                : "Unknown";
              const toStatus = payload.to ?? ticket.status;
              const isLast = index === statusEvents.length - 1;
              return (
                <div key={event.id} className="flex gap-3 text-xs">
                  <div className="flex flex-col items-center pt-1">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                    {!isLast && (
                      <div className="mt-1 h-full w-px bg-border" />
                    )}
                  </div>
                  <div className="flex-1 rounded-lg border border-border bg-card/80 px-3 py-2 shadow-sm">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {fromLabel}
                        </span>
                        <span className="text-[10px] text-muted-foreground">to</span>
                        <StatusBadge status={toStatus} />
                      </div>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        <RelativeTime value={event.createdAt} />
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Changed by{" "}
                      <span className="font-medium text-foreground">
                        {actor}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </aside>
  );
});

/* ——— Sub-components ——— */

function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center px-3 py-1.5 min-h-[36px] group/row rounded-lg hover:bg-muted/30 transition-colors">
      <div className="w-1/3 shrink-0 text-muted-foreground font-medium select-none">
        {label}
      </div>
      <div className="w-2/3 min-w-0 flex items-center">{children}</div>
    </div>
  );
}

function DetailText({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4 text-xs">
      <span className="text-muted-foreground font-medium">{label}</span>
      <span className="text-foreground font-medium text-right break-words">
        {value}
      </span>
    </div>
  );
}

function SlaRow({
  label,
  sla,
}: {
  label: string;
  sla: { label: string; tone: string; detail: ReactNode };
}) {
  const isDanger = sla.tone.includes("rose") || sla.tone.includes("red");
  const isWarning = sla.tone.includes("amber") || sla.tone.includes("yellow");
  const isSuccess = sla.tone.includes("emerald") || sla.tone.includes("green");

  let bgClass = "bg-card border-border";
  if (isDanger) bgClass = "bg-rose-500/10 border-rose-500/30";
  if (isWarning) bgClass = "bg-amber-500/10 border-amber-500/30";
  if (isSuccess) bgClass = "bg-emerald-500/10 border-emerald-500/30";

  const dotClass = isDanger
    ? "bg-rose-500"
    : isWarning
      ? "bg-amber-500"
      : isSuccess
        ? "bg-emerald-500"
        : "bg-muted-foreground";

  return (
    <div
      className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border shadow-sm ${bgClass}`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 rounded-full ${dotClass}`} />
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            {label}
          </span>
          <span className="text-[11px] text-muted-foreground font-medium">
            {sla.detail}
          </span>
        </div>
      </div>
      <div
        className={`text-[12px] font-bold ${sla.tone} bg-background/80 px-2.5 py-1 rounded-md shadow-sm border border-border/60`}
      >
        {sla.label}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const getColors = () => {
    switch (status) {
      case "OPEN":
        return "bg-blue-500/10 text-blue-400 border-blue-500/30";
      case "IN_PROGRESS":
        return "bg-amber-500/10 text-amber-400 border-amber-500/30";
      case "RESOLVED":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
      case "CLOSED":
        return "bg-muted text-muted-foreground border-border";
      default:
        return "bg-muted text-foreground border-border";
    }
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide border ${getColors()}`}
    >
      {formatStatus(status)}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[9px] font-bold text-primary shadow-sm ring-1 ring-border">
      {initialsFor(name)}
    </div>
  );
}

function InlineSelect({
  value,
  onChange,
  disabled,
  options,
  placeholder,
  renderValue,
  buttonClassName = "",
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  options: { value: string; label: ReactNode; avatarString?: string }[];
  placeholder?: string;
  renderValue: (val: string) => ReactNode;
  buttonClassName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isOpen]);

  const selectedOption = options.find((o) => o.value === value);

  return (
    <div className={`relative ${buttonClassName}`} ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`flex w-full items-center justify-between rounded-md px-2 py-1 transition-all outline-none disabled:opacity-50 text-left min-w-0 ${
          disabled
            ? "pointer-events-none"
            : "bg-muted border border-border hover:bg-muted/80 hover:shadow-sm focus:ring-2 focus:ring-primary/40"
        }`}
      >
        <span className="truncate">
          {selectedOption ? (
            renderValue(value)
          ) : (
            <span className="text-muted-foreground font-medium">
              {placeholder || "Select..."}
            </span>
          )}
        </span>
        {!disabled && (
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {isOpen && (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-[70] mt-1 max-h-60 min-w-full w-56 overflow-y-auto rounded-xl border border-border bg-popover py-1.5 shadow-xl ring-1 ring-black/10 focus:outline-none"
        >
          {options.map((option) => (
            <li
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`relative cursor-pointer select-none py-1.5 pl-3 pr-9 text-sm transition-colors ${
                value === option.value
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:bg-muted"
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                {option.avatarString && <Avatar name={option.avatarString} />}
                <span
                  className={`block truncate ${value === option.value ? "font-medium" : ""}`}
                >
                  {option.label}
                </span>
              </div>
              {value === option.value && (
                <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-primary">
                  <Check className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
