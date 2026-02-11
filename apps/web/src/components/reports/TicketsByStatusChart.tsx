import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

type Point = { status: string; count: number };

const STATUS_COLORS: Record<string, string> = {
  NEW: '#2563eb',
  TRIAGED: '#6366f1',
  ASSIGNED: '#0d9488',
  IN_PROGRESS: '#d97706',
  WAITING_ON_REQUESTER: '#ea580c',
  WAITING_ON_VENDOR: '#b45309',
  RESOLVED: '#059669',
  CLOSED: '#64748b',
  REOPENED: '#dc2626',
};

function colorForStatus(status: string): string {
  return STATUS_COLORS[status] ?? '#64748b';
}

function statusAxisLabel(status: string): string {
  if (status === 'WAITING_ON_REQUESTER') return 'Requestor';
  if (status === 'WAITING_ON_VENDOR') return 'Vendor';
  return status;
}

export function TicketsByStatusChart({ data, height = 200 }: { data: Point[]; height?: number }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-slate-500" style={{ height }}>
        No tickets in range
      </div>
    );
  }
  return (
    <div className="w-full min-h-0 overflow-visible" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="status"
            tick={{ fontSize: 11 }}
            stroke="#64748b"
            tickFormatter={statusAxisLabel}
          />
          <YAxis tick={{ fontSize: 11 }} stroke="#64748b" allowDecimals={false} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="count" name="Tickets" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={index} fill={colorForStatus(entry.status)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
