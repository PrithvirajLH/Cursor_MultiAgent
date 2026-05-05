import type { ReactNode } from 'react';
import type { TicketDetail, TicketStatus } from '../../api/client';
import { Avatar, toneFromName } from '../atoms';
import { ticketToRow } from '../tickets/mappers';
import { ActivityList } from './ActivityList';
import { StatusSelector } from './StatusSelector';
import { AssigneeSelector } from './AssigneeSelector';
import { PrioritySelector } from './PrioritySelector';
import { SlaTracking } from './SlaTracking';
import { AiSummaryPanel } from '../ticket-detail/AiSummaryPanel';
import {
  useAssignTicket,
  useChangePriority,
  useTransitionTicket,
} from './ticket-mutations';

interface PropertiesPaneProps {
  ticket: TicketDetail;
}

export function PropertiesPane({ ticket }: PropertiesPaneProps) {
  const row = ticketToRow(ticket);
  const transition = useTransitionTicket(ticket.id);
  const assign = useAssignTicket(ticket.id);
  const changePriority = useChangePriority(ticket.id);
  const allowed = (ticket.allowedTransitions ?? []) as TicketStatus[];

  return (
    <div className="flex flex-col">
      {/* AI Classification at top */}
      <section className="border-b" style={{ borderColor: 'var(--c-divider)' }}>
        <AiSummaryPanel ticketId={ticket.id} />
      </section>

      {/* Status / Priority */}
      <Section title="Actions">
        <Row label="State">
          <StatusSelector
            current={ticket.status}
            currentLabel={row.status}
            currentTone={row.statusTone}
            allowed={allowed}
            onChange={next => transition.mutate(next)}
            disabled={transition.isPending}
          />
        </Row>
        <Row label="Priority">
          <PrioritySelector
            current={ticket.priority}
            onChange={p => changePriority.mutate(p)}
            disabled={changePriority.isPending}
          />
        </Row>
        <Row label="Assignee">
          <AssigneeSelector
            current={ticket.assignee ?? null}
            onChange={assignee => assign.mutate({ assignee })}
            disabled={assign.isPending}
          />
        </Row>
        <Row label="Department">
          <span className="text-[12px]" style={{ color: 'var(--c-fg)' }}>
            {ticket.assignedTeam?.name ?? '—'}
          </span>
        </Row>
        <Row label="Category">
          <span className="text-[12px]" style={{ color: 'var(--c-fg)' }}>
            {ticket.category?.name ?? '—'}
          </span>
        </Row>
        <Row label="Channel">
          <span className="text-[12px]" style={{ color: 'var(--c-fg)' }}>
            {ticket.channel ?? '—'}
          </span>
        </Row>
      </Section>

      {/* SLA Tracking */}
      <Section title="SLA Tracking">
        <SlaTracking ticket={ticket} />
      </Section>

      {/* Information (Requester) */}
      <Section title="Information">
        {ticket.requester ? (
          <div className="flex items-start gap-2 mb-2">
            <Avatar
              name={initials(ticket.requester.displayName)}
              size="lg"
              tone={toneFromName(ticket.requester.displayName)}
            />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold truncate" style={{ color: 'var(--c-fg)' }}>
                {ticket.requester.displayName}
              </div>
              <div className="text-[11px] truncate" style={{ color: 'var(--c-fg-4)' }}>
                {ticket.requester.email}
              </div>
            </div>
          </div>
        ) : null}
        <Row label="Requester">
          <span className="text-[12px]" style={{ color: 'var(--c-fg)' }}>
            {ticket.requester?.displayName ?? '—'}
          </span>
        </Row>
        <Row label="Email">
          <span className="text-[11px] truncate" style={{ color: 'var(--c-fg-2)' }}>
            {ticket.requester?.email ?? '—'}
          </span>
        </Row>
        {ticket.requester?.department && (
          <Row label="Facility">
            <span className="text-[12px]" style={{ color: 'var(--c-fg)' }}>
              {ticket.requester.department}
            </span>
          </Row>
        )}
        <Row label="Reference">
          <span className="font-mono text-[11px]" style={{ color: 'var(--c-fg-2)' }}>
            {ticket.displayId ?? `#${ticket.number}`}
          </span>
        </Row>
        <Row label="Created">
          <span className="font-mono text-[11px]" style={{ color: 'var(--c-fg-2)' }}>
            {new Date(ticket.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        </Row>
        <Row label="Updated">
          <span className="font-mono text-[11px]" style={{ color: 'var(--c-fg-2)' }}>
            {new Date(ticket.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        </Row>
        {ticket.resolvedAt && (
          <Row label="Resolved">
            <span className="font-mono text-[11px]" style={{ color: 'var(--c-green)' }}>
              {new Date(ticket.resolvedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </Row>
        )}
      </Section>

      {/* Activity log */}
      <Section title="Activity">
        <ActivityList ticketId={ticket.id} />
      </Section>
    </div>
  );
}

/* ─── Helpers ────────────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b py-3 px-4" style={{ borderColor: 'var(--c-divider)' }}>
      <h3
        className="text-[10px] font-semibold uppercase tracking-[0.06em] mb-2"
        style={{ color: 'var(--c-fg-4)' }}
      >
        {title}
      </h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px]" style={{ color: 'var(--c-fg-4)' }}>{label}</span>
      <div className="flex items-center justify-end min-w-0">{children}</div>
    </div>
  );
}

function initials(name: string | undefined | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
