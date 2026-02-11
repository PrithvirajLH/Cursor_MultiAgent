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

type Point = { priority: string; count: number };

const PRIORITY_COLORS: Record<string, string> = {
  P1: '#dc2626',
  P2: '#ea580c',
  P3: '#2563eb',
  P4: '#64748b',
};

function colorForPriority(priority: string): string {
  return PRIORITY_COLORS[priority] ?? '#64748b';
}

export function TicketsByPriorityChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-sm text-slate-500">
        No tickets in range
      </div>
    );
  }
  return (
    <div className="h-[200px] w-full min-h-0 overflow-visible">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="priority" tick={{ fontSize: 11 }} stroke="#64748b" />
          <YAxis tick={{ fontSize: 11 }} stroke="#64748b" allowDecimals={false} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="count" name="Tickets" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={index} fill={colorForPriority(entry.priority)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
