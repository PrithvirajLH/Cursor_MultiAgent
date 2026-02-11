import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Point = { bucket: string; count: number };

export function TicketsByAgeChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-sm text-slate-500">
        No tickets in range
      </div>
    );
  }
  return (
    <div className="h-[220px] w-full min-h-0 overflow-visible">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="#64748b" />
          <YAxis tick={{ fontSize: 11 }} stroke="#64748b" allowDecimals={false} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="count" name="Tickets" radius={[4, 4, 0, 0]} fill="#2563eb" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
