import type { TicketRecord } from '../api/client';
import { RelativeTime } from './RelativeTime';
import {
  formatStatus,
  formatTicketId,
  getSlaTone,
  priorityBadgeClass,
  statusBadgeClass,
} from '../utils/format';

type TicketTableViewProps = {
  tickets: TicketRecord[];
  role: string;
  focusedTicketId?: string | null;
  selection: {
    isSelected: (id: string) => boolean;
    toggle: (id: string) => void;
    toggleAll: () => void;
    isAllSelected: boolean;
  };
  onRowClick: (ticket: TicketRecord) => void;
};

export function TicketTableView({
  tickets,
  role,
  focusedTicketId,
  selection,
  onRowClick,
}: TicketTableViewProps) {
  const showCheckbox = role !== 'EMPLOYEE';

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px]">
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr>
            {showCheckbox ? (
              <th className="w-12 px-6 py-3 text-left">
                <input
                  type="checkbox"
                  checked={selection.isAllSelected}
                  onChange={selection.toggleAll}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  aria-label="Select all tickets"
                />
              </th>
            ) : null}
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">ID</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Subject</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Requester</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Priority</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Assignee</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Created</th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">SLA</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {tickets.map((ticket) => {
            const sla = getSlaTone({
              dueAt: ticket.dueAt,
              completedAt: ticket.completedAt,
              status: ticket.status,
              slaPausedAt: ticket.slaPausedAt,
            });
            const requesterName = ticket.requester?.displayName ?? ticket.requester?.email ?? 'Unknown';
            const assigneeName = ticket.assignee?.displayName ?? ticket.assignee?.email ?? 'Unassigned';
            const snippet = ticket.description?.trim() || ticket.category?.name || 'No additional details';
            const selected = selection.isSelected(ticket.id);
            const focused = focusedTicketId === ticket.id;
            return (
              <tr
                key={ticket.id}
                onClick={() => onRowClick(ticket)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onRowClick(ticket);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-selected={selected || focused}
                className={`cursor-pointer text-sm transition-colors hover:bg-gray-50 focus-visible:bg-gray-100 ${
                  selected ? 'bg-blue-50' : focused ? 'bg-slate-50' : 'bg-white'
                }`}
              >
                {showCheckbox ? (
                  <td
                    className="px-6 py-4"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => selection.toggle(ticket.id)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600"
                      aria-label={`Select ticket ${ticket.subject}`}
                    />
                  </td>
                ) : null}
                <td className="whitespace-nowrap px-6 py-4">
                  <span className="font-medium text-blue-600">{formatTicketId(ticket)}</span>
                </td>
                <td className="px-6 py-4">
                  <p className="max-w-lg truncate text-sm font-medium text-gray-900">{ticket.subject}</p>
                  <p className="max-w-lg truncate text-sm text-gray-500">{snippet}</p>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{requesterName}</td>
                <td className="whitespace-nowrap px-6 py-4">
                  <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${priorityBadgeClass(ticket.priority)}`}>
                    {ticket.priority ?? 'P3'}
                  </span>
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${statusBadgeClass(ticket.status)}`}>
                    {formatStatus(ticket.status)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{assigneeName}</td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                  <RelativeTime value={ticket.createdAt} />
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <span className={`inline-flex rounded px-2 py-1 text-xs font-medium ${sla.className}`}>
                    {sla.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
