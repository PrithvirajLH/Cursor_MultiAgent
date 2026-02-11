import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type Point = { date: string; count: number };

const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function dayLabel(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

function shortDateLabel(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function ReopenRateChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-sm text-slate-500">
        No reopen data in range
      </div>
    );
  }

  const chartData = data.map((item) => ({
    ...item,
    day: dayLabel(item.date),
    short: shortDateLabel(item.date),
  }));

  const total = data.reduce((sum, item) => sum + item.count, 0);
  const avg = total / Math.max(1, data.length);

  const byDay = DAY_ORDER.map((day) => ({
    day,
    count: chartData.filter((row) => row.day === day).reduce((sum, row) => sum + row.count, 0),
  }));
  const dayTotal = byDay.reduce((sum, row) => sum + row.count, 0) || 1;

  return (
    <div className="w-full">
      <div className="h-[200px] w-full min-h-0 overflow-visible">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="short" tick={{ fontSize: 11 }} stroke="#64748b" />
            <YAxis tick={{ fontSize: 11 }} stroke="#64748b" allowDecimals={false} />
            <Tooltip
              formatter={(value: number | undefined) => [value ?? 0, 'Reopens']}
              labelFormatter={(_, payload) => payload[0]?.payload?.date ?? ''}
              contentStyle={{ fontSize: 12 }}
            />
            <ReferenceLine
              y={avg}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
            />
            <Line type="monotone" dataKey="count" stroke="#0f172a" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
          {byDay.map((row) => {
            const width = Math.max(0, (row.count / dayTotal) * 100);
            return (
              <span
                key={row.day}
                style={{ width: `${width}%` }}
                className="h-full bg-slate-300"
              />
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between text-[11px] text-muted-foreground">
          <span>Average rate: {avg.toFixed(1)} / day</span>
          <span>Reopens by day</span>
        </div>
      </div>
    </div>
  );
}
