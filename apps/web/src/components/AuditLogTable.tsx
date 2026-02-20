import { Link } from 'react-router-dom';
import type { AuditLogEntry } from '../api/client';
import { formatDate } from '../utils/format';

const EVENT_LABELS: Record<string, string> = {
  TICKET_CREATED: 'Created ticket',
  TICKET_ASSIGNED: 'Assigned ticket',
  TICKET_TRANSFERRED: 'Transferred ticket',
  TICKET_STATUS_CHANGED: 'Changed status',
  TICKET_PRIORITY_CHANGED: 'Changed priority',
  MESSAGE_ADDED: 'Added message',
  ATTACHMENT_ADDED: 'Added attachment',
};

function eventDescription(entry: AuditLogEntry): string {
  const label = EVENT_LABELS[entry.type] ?? entry.type;
  const p = entry.payload;
  if (!p) return label;
  if (entry.type === 'TICKET_STATUS_CHANGED' && p.from != null && p.to != null) {
    return `Changed status from ${String(p.from)} to ${String(p.to)}`;
  }
  if (entry.type === 'TICKET_PRIORITY_CHANGED' && p.from != null && p.to != null) {
    return `Changed priority from ${String(p.from)} to ${String(p.to)}`;
  }
  if (entry.type === 'TICKET_TRANSFERRED' && p.toTeamId) {
    return `Transferred ticket to team`;
  }
  return label;
}

/** Before/after or extra details for the Details column. */
function formatDetails(entry: AuditLogEntry): string {
  const p = entry.payload;
  if (!p) return '—';
  if (entry.type === 'TICKET_STATUS_CHANGED' && p.from != null && p.to != null) {
    return `${String(p.from)} → ${String(p.to)}`;
  }
  if (entry.type === 'TICKET_PRIORITY_CHANGED' && p.from != null && p.to != null) {
    return `${String(p.from)} → ${String(p.to)}`;
  }
  if (entry.type === 'TICKET_ASSIGNED' && (p.assigneeName != null || p.assigneeEmail != null)) {
    return String(p.assigneeName ?? p.assigneeEmail ?? '—');
  }
  if (entry.type === 'TICKET_TRANSFERRED' && p.toTeamName != null) {
    return String(p.toTeamName);
  }
  return '—';
}

function ticketLabel(entry: AuditLogEntry): string {
  if (entry.ticketDisplayId) return entry.ticketDisplayId;
  if (entry.ticketNumber > 0) return `#${entry.ticketNumber}`;
  return 'N/A';
}

export function AuditLogTable({ data }: { data: AuditLogEntry[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        No audit events match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-3 font-semibold text-foreground">Date</th>
            <th className="px-4 py-3 font-semibold text-foreground">User</th>
            <th className="px-4 py-3 font-semibold text-foreground">Ticket</th>
            <th className="px-4 py-3 font-semibold text-foreground">Action</th>
            <th className="px-4 py-3 font-semibold text-foreground">Details</th>
          </tr>
        </thead>
        <tbody>
          {data.map((entry) => (
            <tr key={entry.id} className="border-b border-border/80 last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap" title={entry.createdAt}>
                {formatDate(entry.createdAt)}
              </td>
              <td className="px-4 py-3">
                {entry.createdBy ? entry.createdBy.displayName || entry.createdBy.email : 'System'}
              </td>
              <td className="px-4 py-3">
                {entry.ticketId && entry.ticketNumber > 0 ? (
                  <Link
                    to={`/tickets/${entry.ticketId}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {ticketLabel(entry)}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{ticketLabel(entry)}</span>
                )}
              </td>
              <td className="px-4 py-3 text-foreground">
                {eventDescription(entry)}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatDetails(entry)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
