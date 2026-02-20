import { memo, type ReactNode, type RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
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
  // Assignment
  assignToId: string;
  setAssignToId: (id: string) => void;
  teamMembers: TeamMember[];
  membersLoading: boolean;
  onAssignMember: () => void;
  onAssignSelf: () => void;
  // Status
  nextStatus: string;
  setNextStatus: (status: string) => void;
  availableTransitions: string[];
  statusSelectRef: RefObject<HTMLSelectElement | null>;
  onTransition: () => void;
  onTransitionTo: (status: string) => void;
  quickEscalationTarget: string | null;
  // Transfer
  transferTeamId: string;
  setTransferTeamId: (id: string) => void;
  transferAssigneeId: string;
  setTransferAssigneeId: (id: string) => void;
  transferMembers: TeamMember[];
  teamsList: TeamRef[];
  onTransfer: () => void;
  // Sidebar sections
  expandedSections: ExpandedSections;
  toggleSection: (section: keyof ExpandedSections) => void;
  loadingDetail: boolean;
  // Followers
  followers: TicketFollower[];
  isFollowing: boolean;
  followLoading: boolean;
  followError: string | null;
  onFollowToggle: () => void;
  // Status history
  statusEvents: TicketEvent[];
};

export const TicketSidebar = memo(function TicketSidebar(props: TicketSidebarProps) {
  const {
    ticket, canManage, actionError, actionLoading,
    assignToId, setAssignToId, teamMembers, membersLoading, onAssignMember, onAssignSelf,
    nextStatus, setNextStatus, availableTransitions, statusSelectRef, onTransition, onTransitionTo, quickEscalationTarget,
    transferTeamId, setTransferTeamId, transferAssigneeId, setTransferAssigneeId, transferMembers, teamsList, onTransfer,
    expandedSections, toggleSection, loadingDetail,
    followers, isFollowing, followLoading, followError, onFollowToggle,
    statusEvents,
  } = props;

  const firstResponseSla = getFirstResponseSla(ticket, RelativeTime);
  const resolutionSla = getResolutionSla(ticket, RelativeTime);

  return (
    <aside className="space-y-4 xl:sticky xl:top-[160px] xl:col-span-1 xl:h-fit">
      {/* SLA Overview */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">SLA Overview</h3>
          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${slaBadgeClass(resolutionSla.label)}`}>
            {resolutionSla.label}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <SlaCard label="First Response" sla={firstResponseSla} />
          <SlaCard label="Resolution" sla={resolutionSla} />
        </div>
      </div>

      {/* Quick Actions */}
      {canManage && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
          <h3 className="text-sm font-semibold text-slate-900">Quick Actions</h3>
          {actionError && <p className="mt-2 text-xs text-rose-600">{actionError}</p>}

          <div className="mt-3 space-y-3">
            {/* Assign */}
            <div>
              <label id="assign-label" className="mb-1 block text-xs font-semibold text-slate-700">Assign</label>
              <div className="flex gap-2">
                <select
                  aria-labelledby="assign-label"
                  value={assignToId}
                  onChange={(e) => setAssignToId(e.target.value)}
                  disabled={membersLoading || actionLoading || teamMembers.length === 0}
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">{membersLoading ? 'Loading team...' : 'Select assignee'}</option>
                  {teamMembers.map((m) => (
                    <option key={m.id} value={m.user.id}>{m.user.displayName}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onAssignMember}
                  disabled={!assignToId || actionLoading}
                  className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Assign
                </button>
              </div>
              {!ticket.assignee && (
                <button
                  type="button"
                  onClick={onAssignSelf}
                  disabled={actionLoading}
                  className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
                >
                  Assign to me
                </button>
              )}
            </div>

            {/* Status */}
            <div>
              <label id="status-label" className="mb-1 block text-xs font-semibold text-slate-700">Status</label>
              <div className="flex gap-2">
                <select
                  ref={statusSelectRef}
                  aria-labelledby="status-label"
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value)}
                  disabled={actionLoading || availableTransitions.length === 0}
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {availableTransitions.length === 0 && <option value="">No transitions</option>}
                  {availableTransitions.map((s) => (
                    <option key={s} value={s}>{formatStatus(s)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onTransition}
                  disabled={actionLoading || !nextStatus || nextStatus === ticket.status}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  Update
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onTransitionTo('RESOLVED')}
                  disabled={actionLoading || !availableTransitions.includes('RESOLVED')}
                  className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Resolve
                </button>
                {quickEscalationTarget ? (
                  <button
                    type="button"
                    onClick={() => onTransitionTo(quickEscalationTarget)}
                    disabled={actionLoading}
                    className="rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {formatStatus(quickEscalationTarget)}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onTransitionTo('CLOSED')}
                  disabled={actionLoading || !availableTransitions.includes('CLOSED')}
                  className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Transfer */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Transfer</label>
              <div className="space-y-2">
                <select
                  aria-label="Transfer to department"
                  value={transferTeamId}
                  onChange={(e) => setTransferTeamId(e.target.value)}
                  disabled={actionLoading}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select department</option>
                  {teamsList.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <select
                  aria-label="Transfer to assignee"
                  value={transferAssigneeId}
                  onChange={(e) => setTransferAssigneeId(e.target.value)}
                  disabled={actionLoading || !transferTeamId}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select assignee</option>
                  {transferMembers.map((m) => (
                    <option key={m.id} value={m.user.id}>{m.user.displayName}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onTransfer}
                  disabled={actionLoading || !transferTeamId || transferTeamId === ticket.assignedTeam?.id}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  Transfer
                </button>
                <p className="text-xs text-slate-500">Tip: transferring to the same team is blocked.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ticket Details */}
      <CollapsibleSection
        title="Ticket Details"
        expanded={expandedSections.edit}
        onToggle={() => toggleSection('edit')}
      >
        {loadingDetail && (
          <div className="space-y-2">
            <div className="h-4 w-28 rounded bg-slate-200" />
            <div className="h-4 w-40 rounded bg-slate-100" />
          </div>
        )}
        {!loadingDetail && (
          <>
            <DetailRow label="Requester" value={ticket.requester?.displayName ?? 'Unknown'} />
            <DetailRow label="Email" value={ticket.requester?.email ?? '—'} />
            <DetailRow label="Department" value={ticket.assignedTeam?.name ?? 'Unassigned'} />
            <DetailRow label="Assignee" value={ticket.assignee?.displayName ?? 'Unassigned'} />
            <DetailRow label="Category" value={ticket.category?.name ?? 'None'} />
            <DetailRow label="Created" value={<RelativeTime value={ticket.createdAt} />} />
          </>
        )}
      </CollapsibleSection>

      {/* Followers */}
      <CollapsibleSection
        title={`Followers (${followers.length})`}
        expanded={expandedSections.followers}
        onToggle={() => toggleSection('followers')}
      >
        <div className="mb-3 space-y-2">
          {followers.length === 0 && <p className="text-xs text-slate-500">No followers yet.</p>}
          {followers.map((f) => (
            <div key={f.id} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-xs font-bold text-white">
                  {initialsFor(f.user.displayName)}
                </div>
                <span className="text-sm font-semibold text-slate-900">{f.user.displayName}</span>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onFollowToggle}
          disabled={followLoading}
          className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isFollowing ? 'Unfollow ticket' : 'Follow ticket'}
        </button>
        {followError && <p className="mt-2 text-xs text-rose-600">{followError}</p>}
      </CollapsibleSection>

      {/* Additional Details */}
      <CollapsibleSection
        title="Additional Details"
        expanded={expandedSections.additional}
        onToggle={() => toggleSection('additional')}
      >
        <DetailRow label="Reference ID" value={formatTicketId(ticket)} />
        <DetailRow
          label="First response due"
          value={ticket.firstResponseDueAt ? <RelativeTime value={ticket.firstResponseDueAt} /> : 'Not set'}
        />
        <DetailRow
          label="Resolution due"
          value={ticket.dueAt ? <RelativeTime value={ticket.dueAt} /> : 'Not set'}
        />
        {ticket.customFieldValues && ticket.customFieldValues.length > 0 && (
          <div className="pt-2">
            <CustomFieldsDisplay values={ticket.customFieldValues} />
          </div>
        )}
      </CollapsibleSection>

      {/* Status History */}
      <CollapsibleSection
        title="Status History"
        expanded={expandedSections.history}
        onToggle={() => toggleSection('history')}
      >
        {statusEvents.length === 0 && <p className="text-xs text-slate-500">No status changes recorded yet.</p>}
        {statusEvents.map((event) => {
          const payload = (event.payload ?? {}) as { from?: string; to?: string };
          const actor = event.createdBy?.displayName ?? event.createdBy?.email ?? 'System';
          return (
            <div key={event.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-slate-700">
                  {payload.from ? formatStatus(payload.from) : 'Unknown'} →{' '}
                  {payload.to ? formatStatus(payload.to) : formatStatus(ticket.status)}
                </span>
                <span className="text-slate-500"><RelativeTime value={event.createdAt} /></span>
              </div>
              <p className="text-slate-500">By {actor}</p>
            </div>
          );
        })}
      </CollapsibleSection>
    </aside>
  );
});

/* ——— Sub-components ——— */

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function SlaCard({ label, sla }: { label: string; sla: { label: string; tone: string; detail: ReactNode } }) {
  return (
    <div className={`rounded-xl border p-3 ${sla.tone}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold">{label}</span>
        <span className="text-xs font-bold">{sla.label}</span>
      </div>
      <p className="text-xs">{sla.detail}</p>
    </div>
  );
}

function CollapsibleSection({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-soft">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <ChevronDown
          aria-hidden="true"
          className={`h-5 w-5 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="space-y-2 px-4 pb-4 text-sm" role="region" aria-label={title}>{children}</div>
      )}
    </div>
  );
}
