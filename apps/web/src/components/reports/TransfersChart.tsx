import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Point = { date: string; count: number };

function shortDateLabel(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function TransfersChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-sm text-slate-500">
        No transfers recorded for the selected range.
      </div>
    );
  }
  const chartData = data.map((row) => ({
    ...row,
    short: shortDateLabel(row.date),
  }));
  return (
    <div className="h-[200px] w-full" role="img" aria-label="Transfers over time">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="short" tick={{ fontSize: 11 }} stroke="#64748b" />
          <YAxis tick={{ fontSize: 11 }} stroke="#64748b" allowDecimals={false} />
          <Tooltip
            formatter={(value: number | undefined) => [value ?? 0, 'Transfers']}
            labelFormatter={(_, payload) => payload[0]?.payload?.date ?? ''}
            contentStyle={{ fontSize: 12 }}
          />
          <Line type="monotone" dataKey="count" stroke="#0f172a" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
