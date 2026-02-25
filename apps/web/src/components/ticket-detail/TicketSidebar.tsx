import { memo, type ReactNode, type RefObject, useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, UserPlus, UserMinus, Clock } from 'lucide-react';
import type { TicketDetail, TicketEvent, TicketFollower, TeamMember, TeamRef } from '../../api/client';
import { CustomFieldsDisplay } from '../CustomFieldRenderer';
import { RelativeTime } from '../RelativeTime';
import { formatStatus, formatTicketId, initialsFor } from '../../utils/format';
import { getFirstResponseSla, getResolutionSla, slaBadgeClass } from './utils';

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

export const TicketSidebar = memo(function TicketSidebar(props: TicketSidebarProps) {
  const {
    ticket, canManage, actionError, actionLoading,
    assignToId, setAssignToId, teamMembers, membersLoading, onAssignMember, onAssignSelf,
    availableTransitions, onTransitionTo,
    transferTeamId, setTransferTeamId, teamsList, onTransfer,
    followers, isFollowing, followLoading, followError, onFollowToggle,
    statusEvents,
    expandedSections, toggleSection,
  } = props;

  const firstResponseSla = getFirstResponseSla(ticket, RelativeTime);
  const resolutionSla = getResolutionSla(ticket, RelativeTime);

  return (
    <aside className="flex flex-col text-[13px] text-slate-700 pb-10 min-h-full">
      {/* Header & Followers */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-slate-200">
        <h3 className="font-semibold text-slate-900">Properties</h3>
        <div className="flex items-center gap-2">
          {followers.length > 0 && (
            <div className="flex -space-x-1.5">
              {followers.slice(0, 3).map((f) => (
                <div key={f.id} className="h-6 w-6 rounded-full bg-slate-800 text-white flex items-center justify-center text-[10px] font-bold ring-2 ring-slate-50 shadow-sm" title={f.user.displayName}>
                  {initialsFor(f.user.displayName)}
                </div>
              ))}
              {followers.length > 3 && (
                <div className="h-6 w-6 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px] font-bold ring-2 ring-slate-50 shadow-sm">
                  +{followers.length - 3}
                </div>
              )}
            </div>
          )}
          <button
            onClick={onFollowToggle}
            disabled={followLoading}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-all border ${isFollowing
                ? 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 group'
                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 hover:border-slate-300'
              }`}
            title={isFollowing ? 'Unfollow' : 'Follow'}
          >
            {isFollowing ? (
              <>
                <UserPlus className="h-3.5 w-3.5 group-hover:hidden" />
                <UserMinus className="h-3.5 w-3.5 hidden group-hover:block" />
              </>
            ) : (
              <UserPlus className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {actionError && <div className="mx-5 mt-4 p-2 bg-rose-50 text-rose-600 text-[12px] rounded-lg font-medium">{actionError}</div>}
      {followError && <div className="mx-5 mt-4 p-2 bg-rose-50 text-rose-600 text-[12px] rounded-lg font-medium">{followError}</div>}

      {/* Property List */}
      <div className="p-2 space-y-0.5 border-b border-slate-200">

        <PropertyRow label="Status">
          {canManage && availableTransitions.length > 0 ? (
            <InlineSelect
              value={ticket.status}
              placeholder="Status"
              options={[
                { value: ticket.status, label: formatStatus(ticket.status) },
                ...availableTransitions.filter(s => s !== ticket.status).map(s => ({ value: s, label: formatStatus(s) }))
              ]}
              onChange={(val) => onTransitionTo(val)}
              disabled={actionLoading}
              renderValue={(val) => (
                <StatusBadge status={val} />
              )}
            />
          ) : (
            <div className="px-1.5"><StatusBadge status={ticket.status} /></div>
          )}
        </PropertyRow>

        <PropertyRow label="Assignee">
          {canManage ? (
            <div className="flex items-center gap-1 overflow-hidden w-full group/assign overflow-visible relative">
              <InlineSelect
                buttonClassName="flex-1 w-full"
                value={ticket.assignee?.id ?? ''}
                placeholder="Unassigned"
                options={[
                  ...teamMembers.map(m => ({ value: m.user.id, label: m.user.displayName, avatarString: m.user.displayName }))
                ]}
                onChange={(val) => {
                  setAssignToId(val);
                }}
                disabled={actionLoading || membersLoading}
                renderValue={() => ticket.assignee ? (
                  <div className="flex items-center gap-1.5 text-slate-900 truncate font-medium">
                    <Avatar name={ticket.assignee.displayName} />
                    <span className="truncate">{ticket.assignee.displayName}</span>
                  </div>
                ) : <span className="text-slate-400 font-medium">Unassigned</span>}
              />
              {assignToId && assignToId !== (ticket.assignee?.id ?? '') && (
                <button onClick={onAssignMember} disabled={actionLoading} className="h-6 px-2.5 bg-blue-600 text-white rounded text-[11px] font-semibold hover:bg-blue-700 shadow-sm shrink-0">Save</button>
              )}
              {!ticket.assignee && (
                <button onClick={onAssignSelf} disabled={actionLoading} className="hidden group-hover/assign:flex absolute right-0 bg-white shadow-sm ring-1 ring-slate-200 h-6 px-2 text-[11px] font-semibold text-slate-600 items-center rounded-md hover:text-blue-600">Assign to me</button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-slate-900 truncate px-1.5 font-medium">
              {ticket.assignee ? <><Avatar name={ticket.assignee.displayName} /><span className="truncate">{ticket.assignee.displayName}</span></> : <span className="text-slate-400">Unassigned</span>}
            </div>
          )}
        </PropertyRow>

        <PropertyRow label="Department">
          {canManage ? (
            <div className="flex items-center gap-1 overflow-hidden w-full">
              <InlineSelect
                buttonClassName="flex-1 w-full"
                value={transferTeamId || (ticket.assignedTeam?.id ?? '')}
                placeholder="None"
                options={teamsList.map(t => ({ value: t.id, label: t.name }))}
                onChange={(val) => setTransferTeamId(val)}
                disabled={actionLoading}
                renderValue={(val) => {
                  const label = teamsList.find(t => t.id === val)?.name || ticket.assignedTeam?.name;
                  return label ? <span className="text-slate-900 font-medium truncate">{label}</span> : <span className="text-slate-400 font-medium">None</span>;
                }}
              />
              {transferTeamId && transferTeamId !== ticket.assignedTeam?.id && (
                <button onClick={onTransfer} disabled={actionLoading} className="h-6 px-2.5 bg-blue-600 text-white rounded text-[11px] font-semibold hover:bg-blue-700 shadow-sm shrink-0">Set</button>
              )}
            </div>
          ) : (
            <span className="text-slate-900 truncate px-1.5 font-medium">{ticket.assignedTeam?.name ?? 'None'}</span>
          )}
        </PropertyRow>

        <PropertyRow label="Priority">
          <span className={`inline-flex items-center gap-1.5 font-medium px-1.5
             ${ticket.priority === 'URGENT' ? 'text-rose-600' :
              ticket.priority === 'HIGH' ? 'text-amber-600' :
                'text-slate-700'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${ticket.priority === 'URGENT' ? 'bg-rose-500' : ticket.priority === 'HIGH' ? 'bg-amber-500' : 'bg-slate-400'}`}></span>
            {ticket.priority.charAt(0) + ticket.priority.slice(1).toLowerCase()}
          </span>
        </PropertyRow>

        <PropertyRow label="Category">
          <span className="text-slate-900 truncate px-1.5 font-medium">{ticket.category?.name ?? 'None'}</span>
        </PropertyRow>
      </div>

      {/* SLAs */}
      <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/60">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> SLAs
          </h4>
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wider uppercase border ${slaBadgeClass(resolutionSla.label)}`}>
            {resolutionSla.label}
          </span>
        </div>
        <div className="grid gap-2">
          <SlaRow label="First Response" sla={firstResponseSla} />
          <SlaRow label="Resolution" sla={resolutionSla} />
        </div>
      </div>

      {/* Details */}
      <div className="p-5 border-b border-slate-200">
        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Details</h4>
        <div className="space-y-2.5">
          <DetailText label="Requester" value={ticket.requester?.displayName ?? 'Unknown'} />
          <DetailText label="Email" value={ticket.requester?.email ?? '—'} />
          <DetailText label="Reference" value={formatTicketId(ticket)} />
          <DetailText label="Created" value={<RelativeTime value={ticket.createdAt} />} />
        </div>
      </div>

      {/* Custom Fields */}
      {ticket.customFieldValues && ticket.customFieldValues.length > 0 && (
        <div className="p-5 border-b border-slate-200">
          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Custom Fields</h4>
          <div className="space-y-3">
            <CustomFieldsDisplay values={ticket.customFieldValues} />
          </div>
        </div>
      )}

      {/* History */}
      <div className="p-5 space-y-3">
        <button
          type="button"
          onClick={() => toggleSection('history')}
          className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left hover:bg-slate-50"
        >
          <div className="flex flex-col gap-0.5">
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status History</h4>
            {statusEvents.length > 0 && (
              <span className="text-[11px] text-slate-400">
                Showing last {statusEvents.length} change{statusEvents.length > 1 ? 's' : ''} • Full history in{' '}
                <span className="font-semibold text-slate-600">Timeline</span>
              </span>
            )}
          </div>
          <ChevronDown
            className={`h-3.5 w-3.5 text-slate-400 transition-transform ${expandedSections.history ? 'rotate-180' : ''}`}
          />
        </button>
        {statusEvents.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No status changes recorded yet.</p>
        ) : null}
        {expandedSections.history && statusEvents.length > 0 ? (
          <div className="space-y-3">
            {statusEvents.map((event, index) => {
              const payload = (event.payload ?? {}) as { from?: string; to?: string };
              const actor = event.createdBy?.displayName ?? event.createdBy?.email ?? 'System';
              const fromLabel = payload.from ? formatStatus(payload.from) : 'Unknown';
              const toStatus = payload.to ?? ticket.status;
              const isLast = index === statusEvents.length - 1;
              return (
                <div key={event.id} className="flex gap-3 text-xs">
                  <div className="flex flex-col items-center pt-1">
                    <div className="h-2 w-2 rounded-full bg-blue-500" />
                    {!isLast && <div className="mt-1 h-full w-px bg-slate-200" />}
                  </div>
                  <div className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {fromLabel}
                        </span>
                        <span className="text-[10px] text-slate-400">to</span>
                        <StatusBadge status={toStatus} />
                      </div>
                      <span className="text-[11px] text-slate-400 whitespace-nowrap">
                        <RelativeTime value={event.createdAt} />
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Changed by <span className="font-medium text-slate-700">{actor}</span>
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

function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center px-3 py-1.5 min-h-[36px] group/row rounded-lg hover:bg-slate-100/50 transition-colors">
      <div className="w-1/3 shrink-0 text-slate-500 font-medium select-none">
        {label}
      </div>
      <div className="w-2/3 min-w-0 flex items-center">
        {children}
      </div>
    </div>
  );
}

function DetailText({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4 text-xs">
      <span className="text-slate-500 font-medium">{label}</span>
      <span className="text-slate-900 font-medium text-right break-words">{value}</span>
    </div>
  );
}

function SlaRow({ label, sla }: { label: string; sla: { label: string; tone: string; detail: ReactNode } }) {
  // Translate the old card styling to a cleaner row
  // tone is typically text-emerald-xxx, text-rose-xxx, etc.
  // We extract the base color name for the background.
  const isDanger = sla.tone.includes('rose') || sla.tone.includes('red');
  const isWarning = sla.tone.includes('amber') || sla.tone.includes('yellow');
  const isSuccess = sla.tone.includes('emerald') || sla.tone.includes('green');

  let bgClass = 'bg-slate-50 border-slate-200';
  if (isDanger) bgClass = 'bg-rose-50 border-rose-200';
  if (isWarning) bgClass = 'bg-amber-50 border-amber-200';
  if (isSuccess) bgClass = 'bg-emerald-50 border-emerald-200';

  const dotClass = isDanger
    ? 'bg-rose-500'
    : isWarning
      ? 'bg-amber-500'
      : isSuccess
        ? 'bg-emerald-500'
        : 'bg-slate-400';

  return (
    <div className={`flex items-center justify-between gap-3 p-2.5 rounded-xl border shadow-sm ${bgClass}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 rounded-full ${dotClass}`} />
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
          <span className="text-[11px] text-slate-600 font-medium">{sla.detail}</span>
        </div>
      </div>
      <div className={`text-[12px] font-bold ${sla.tone} bg-white/80 px-2.5 py-1 rounded-md shadow-sm border border-white/60`}>
        {sla.label}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const getColors = () => {
    switch (status) {
      case 'OPEN': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'IN_PROGRESS': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'RESOLVED': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'CLOSED': return 'bg-slate-100 text-slate-600 border-slate-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide border ${getColors()}`}>
      {formatStatus(status)}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[9px] font-bold text-white shadow-sm ring-1 ring-slate-100">
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
  buttonClassName = ''
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
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  const selectedOption = options.find((o) => o.value === value);

  return (
    <div className={`relative ${buttonClassName}`} ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`flex w-full items-center justify-between rounded-md px-2 py-1 transition-all outline-none disabled:opacity-50 text-left min-w-0 ${disabled
            ? 'pointer-events-none'
            : 'bg-slate-50 border border-slate-200 hover:bg-white hover:shadow-sm focus:ring-2 focus:ring-blue-500/40'
          }`}
      >
        <span className="truncate">
          {selectedOption ? renderValue(value) : <span className="text-slate-400 font-medium">{placeholder || 'Select...'}</span>}
        </span>
        {!disabled && (
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {isOpen && (
        <ul className="absolute z-50 left-0 top-full mt-1 max-h-60 w-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl ring-1 ring-black ring-opacity-5 focus:outline-none">
          {options.map((option) => (
            <li
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`relative cursor-pointer select-none py-1.5 pl-3 pr-9 text-sm transition-colors ${value === option.value
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-700 hover:bg-slate-50'
                }`}
            >
              <div className="flex items-center gap-2 truncate">
                {option.avatarString && <Avatar name={option.avatarString} />}
                <span className={`block truncate ${value === option.value ? 'font-medium' : ''}`}>{option.label}</span>
              </div>
              {value === option.value && (
                <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-blue-600">
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
