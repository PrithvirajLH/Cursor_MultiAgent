import {
  type ReactNode,
  type RefObject,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, UserPlus, UserMinus, Clock } from "lucide-react";
import { AiSummaryPanel } from "./AiSummaryPanel";
import { CsatWidget } from "./CsatWidget";
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
  currentEmail?: string;
  ticketId?: string;
  csatTicketId?: string;
  csatTicketStatus?: string;
  csatIsRequester?: boolean;
};

export function TicketSidebar(
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
    currentEmail,
    ticketId,
    csatTicketId,
    csatTicketStatus,
    csatIsRequester,
  } = props;

  const isRequester =
    !!currentEmail && ticket.requester?.email === currentEmail;

  const firstResponseSla = getFirstResponseSla(ticket, RelativeTime);
  const resolutionSla = getResolutionSla(ticket, RelativeTime);

  const facility = (() => {
    const firstLine = (ticket.description ?? "").split("\n")[0] ?? "";
    const prefix = "Facility:";
    if (!firstLine.startsWith(prefix)) return null;
    return firstLine.slice(prefix.length).trim() || null;
  })();

  return (
    <aside className="flex min-h-full flex-col gap-3 bg-background px-3 pt-3 pb-6 text-[13px] text-foreground">
      {/* AI Summary Panel */}
      {ticketId && <AiSummaryPanel ticketId={ticketId} />}

      {/* CSAT Widget */}
      {csatTicketId && (
        <CsatWidget
          ticketId={csatTicketId}
          ticketStatus={csatTicketStatus ?? ""}
          isRequester={csatIsRequester ?? false}
        />
      )}

      {/* Actions card */}
      <div className="flex flex-col overflow-visible rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Actions
          </h3>
          <div className="flex items-center gap-2">
            {followers.length > 0 && (
              <div className="flex items-center">
                {followers.slice(0, 5).map((f) => (
                  <AnimatedTooltipAvatar
                    key={f.id}
                    name={f.user.displayName}
                    initials={initialsFor(f.user.displayName)}
                  />
                ))}
                {followers.length > 5 && (
                  <div className="-ml-2 flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground ring-2 ring-card z-0">
                    +{followers.length - 5}
                  </div>
                )}
              </div>
            )}
            {/* Hide unfollow for requesters — they always follow their own ticket */}
            {isFollowing && isRequester ? null : (
              <button
                onClick={onFollowToggle}
                disabled={followLoading}
                className={`flex h-7 w-7 items-center justify-center rounded-full border transition-all ${
                  isFollowing
                    ? "border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
                    : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                }`}
                title={isFollowing ? "Unfollow" : "Follow"}
              >
                {isFollowing ? (
                  <UserMinus className="h-3.5 w-3.5" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5" />
                )}
              </button>
            )}
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
        <div className="divide-y divide-border/50 p-1">
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
              <div className="flex items-center gap-1.5 w-full">
                {(() => {
                  const effectiveId = assignToId || (ticket.assignee?.id ?? "");
                  const pendingMember = assignToId
                    ? teamMembers.find((m) => m.user.id === assignToId)
                    : null;
                  const hasPendingChange = assignToId && assignToId !== (ticket.assignee?.id ?? "");

                  return (
                    <>
                      <InlineSelect
                        buttonClassName="flex-1 w-full"
                        value={effectiveId}
                        placeholder="Unassigned"
                        options={teamMembers.map((m) => ({
                          value: m.user.id,
                          label: m.user.displayName,
                          avatarString: m.user.displayName,
                        }))}
                        onChange={(val) => setAssignToId(val)}
                        disabled={actionLoading || membersLoading}
                        renderValue={() => {
                          if (pendingMember) {
                            return (
                              <div className="flex items-center gap-1.5 text-foreground truncate font-medium">
                                <Avatar name={pendingMember.user.displayName} />
                                <span className="truncate">{pendingMember.user.displayName}</span>
                              </div>
                            );
                          }
                          if (ticket.assignee) {
                            return (
                              <div className="flex items-center gap-1.5 text-foreground truncate font-medium">
                                <Avatar name={ticket.assignee.displayName} />
                                <span className="truncate">{ticket.assignee.displayName}</span>
                              </div>
                            );
                          }
                          return <span className="text-muted-foreground font-medium">Unassigned</span>;
                        }}
                      />
                      {hasPendingChange && !actionLoading ? (
                        <button
                          onClick={onAssignMember}
                          className="h-6 px-2.5 bg-primary text-primary-foreground rounded-md text-[11px] font-semibold hover:bg-primary/90 shadow-sm shrink-0"
                        >
                          Save
                        </button>
                      ) : !ticket.assignee && !assignToId ? (
                        <button
                          onClick={onAssignSelf}
                          disabled={actionLoading}
                          className="h-6 px-2 text-[11px] font-semibold text-primary bg-primary/10 rounded-md hover:bg-primary/15 shrink-0 whitespace-nowrap"
                        >
                          Me
                        </button>
                      ) : null}
                    </>
                  );
                })()}
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
              <div className="flex w-full items-center gap-1.5">
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
                      className="h-6 px-2.5 bg-primary text-primary-foreground rounded-md text-[11px] font-semibold hover:bg-primary/90 shadow-sm shrink-0"
                    >
                      Save
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
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> SLA Tracking
          </h4>
        </div>
        <div className="p-2 space-y-1.5">
          <SlaRow label="First Response" sla={firstResponseSla} />
          <SlaRow label="Resolution" sla={resolutionSla} />
        </div>
      </div>

      {/* Details */}
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="px-4 py-3 border-b border-border">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Information
          </h4>
        </div>
        <div className="divide-y divide-border/50">
          <DetailRow
            label="Requester"
            value={ticket.requester?.displayName ?? "Unknown"}
          />
          {(ticket.requester?.graphProfile?.jobTitle || ticket.requester?.department) && (
            <DetailRow
              label="Job Title"
              value={ticket.requester.graphProfile?.jobTitle || ticket.requester.department || "—"}
            />
          )}
          <DetailRow
            label="Email"
            value={ticket.requester?.email ?? "—"}
            mono
          />
          {(ticket.requester?.location || ticket.requester?.graphProfile?.officeLocation || facility) && (
            <DetailRow
              label="Facility"
              value={ticket.requester?.location || ticket.requester?.graphProfile?.officeLocation || facility || "—"}
            />
          )}
          <DetailRow label="Reference" value={formatTicketId(ticket)} mono />
          <DetailRow
            label="Created"
            value={<RelativeTime value={ticket.createdAt} />}
          />
        </div>
      </div>

      {/* Custom Fields */}
      {ticket.customFieldValues && ticket.customFieldValues.length > 0 && (
        <div className="rounded-xl border border-border bg-card shadow-card">
          <div className="px-4 py-3 border-b border-border">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Custom Fields
            </h4>
          </div>
          <div className="p-4 space-y-3">
            <CustomFieldsDisplay values={ticket.customFieldValues} />
          </div>
        </div>
      )}

      {/* History */}
      <div className="rounded-xl border border-border bg-card shadow-card">
        <button
          type="button"
          onClick={() => toggleSection("history")}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-accent/30 transition-colors"
        >
          <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            Status History
            {statusEvents.length > 0 && (
              <span className="ml-1.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground/60">
                ({statusEvents.length})
              </span>
            )}
          </h4>
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${expandedSections.history ? "rotate-180" : ""}`}
          />
        </button>

        {statusEvents.length === 0 && (
          <div className="px-4 pb-3">
            <p className="text-xs text-muted-foreground/60 italic">
              No status changes yet
            </p>
          </div>
        )}

        {expandedSections.history && statusEvents.length > 0 && (
          <div className="px-4 pb-3 space-y-0">
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
                <div key={event.id} className="flex gap-3">
                  {/* Timeline rail */}
                  <div className="flex flex-col items-center w-4 flex-shrink-0">
                    <div className="h-2 w-2 mt-2 rounded-full bg-primary ring-2 ring-card" />
                    {!isLast && (
                      <div className="flex-1 w-px bg-border mt-1" />
                    )}
                  </div>
                  {/* Event content */}
                  <div className="flex-1 pb-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <StatusBadge status={fromLabel.toUpperCase().replace(/ /g, "_")} />
                      <span className="text-[10px] text-muted-foreground">→</span>
                      <StatusBadge status={toStatus} />
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {actor}{" "}
                      <span className="text-muted-foreground/50">·</span>{" "}
                      <RelativeTime value={event.createdAt} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

/* ——— Sub-components ——— */

function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center px-3 py-2.5 min-h-[40px] group/row rounded-lg hover:bg-accent/40 transition-colors">
      <div className="w-[90px] shrink-0 text-xs text-muted-foreground font-medium select-none">
        {label}
      </div>
      <div className="flex-1 min-w-0 flex items-center">{children}</div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center px-4 py-2.5">
      <span className="w-[80px] shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <span
        className={`flex-1 text-xs font-medium text-foreground text-right truncate ${mono ? "font-mono text-[11px]" : ""}`}
      >
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

  let bgClass = "bg-muted/30 border-border";
  if (isDanger)
    bgClass = "bg-rose-50 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/30";
  if (isWarning)
    bgClass = "bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30";
  if (isSuccess)
    bgClass = "bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30";

  const dotClass = isDanger
    ? "bg-rose-500"
    : isWarning
      ? "bg-amber-500"
      : isSuccess
        ? "bg-emerald-500"
        : "bg-muted-foreground";

  return (
    <div className={`flex items-center justify-between gap-3 p-2.5 rounded-lg border ${bgClass}`}>
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
      <div className={`text-[11px] font-bold ${sla.tone} px-2 py-0.5 rounded-md`}>
        {sla.label}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    NEW: "bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400",
    TRIAGED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
    ASSIGNED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
    IN_PROGRESS: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
    WAITING_ON_REQUESTER: "bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400",
    WAITING_ON_VENDOR: "bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400",
    RESOLVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
    CLOSED: "bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-400",
    REOPENED: "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  };
  const colors = colorMap[status] ?? "bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-400";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${colors}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownHeight = 240; // max-h-60 = 15rem = 240px
    const openUpward = spaceBelow < dropdownHeight && rect.top > dropdownHeight;
    setDropdownPos({
      top: openUpward ? rect.top - Math.min(dropdownHeight, rect.top - 8) : rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 224), // min w-56 = 224px
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isOpen]);

  const selectedOption = options.find((o) => o.value === value);

  return (
    <div className={`relative ${buttonClassName}`} ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`flex w-full items-center justify-between gap-1 rounded-lg px-2.5 py-1.5 transition-all outline-none disabled:opacity-50 text-left min-w-0 text-[12px] cursor-pointer border ${
          disabled
            ? "pointer-events-none opacity-60 border-transparent"
            : isOpen
              ? "bg-card border-primary/30 shadow-sm"
              : "bg-card border-border hover:border-foreground/20"
        }`}
      >
        <span className="truncate flex-1">
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
            className={`h-3.5 w-3.5 flex-shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180 text-primary" : "text-muted-foreground"}`}
          />
        )}
      </button>

      {isOpen && createPortal(
        <ul
          ref={dropdownRef}
          role="listbox"
          className="fixed z-[9999] max-h-60 overflow-y-auto rounded-xl border border-border bg-card py-1.5 shadow-elevated focus:outline-none"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        >
          {options.map((option) => (
            <li
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`relative cursor-pointer select-none py-2.5 pl-3 pr-9 text-[12px] transition-colors ${
                value === option.value
                  ? "bg-primary/8 text-primary font-semibold"
                  : "text-foreground hover:bg-accent/60"
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
        </ul>,
        document.body,
      )}
    </div>
  );
}

/* ── Animated Tooltip Avatar (Aceternity-style) ── */

const AVATAR_COLORS = [
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
  "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400",
];

function AnimatedTooltipAvatar({
  name,
  initials,
}: {
  name: string;
  initials: string;
}) {
  const colorIndex =
    name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) %
    AVATAR_COLORS.length;

  return (
    <div className="group/avatar relative -ml-2 first:ml-0 z-10 hover:z-30">
      {/* Tooltip */}
      <div className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-foreground px-2.5 py-1 text-[10px] font-semibold text-background shadow-lg pointer-events-none opacity-0 scale-90 translate-y-1 group-hover/avatar:opacity-100 group-hover/avatar:scale-100 group-hover/avatar:translate-y-0 transition-all duration-200 z-50">
        {name}
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-2 w-2 rotate-45 bg-foreground" />
      </div>
      {/* Avatar */}
      <div
        className={`flex h-7 w-7 items-center justify-center rounded-full text-[9px] font-bold ring-2 ring-card cursor-pointer transition-transform duration-200 hover:-translate-y-1 hover:scale-110 ${AVATAR_COLORS[colorIndex]}`}
      >
        {initials}
      </div>
    </div>
  );
}
