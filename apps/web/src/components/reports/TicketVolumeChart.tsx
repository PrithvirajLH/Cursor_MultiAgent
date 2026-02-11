import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

type Point = { date: string; count: number };

export function TicketVolumeChart({ data }: { data: Point[] }) {
  const display = data.map((d) => ({
    ...d,
    short: d.date.slice(5),
  }));
  return (
    <div className="h-[240px] w-full min-h-0 overflow-visible">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={display} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="short" tick={{ fontSize: 11 }} stroke="#64748b" />
          <YAxis tick={{ fontSize: 11 }} stroke="#64748b" allowDecimals={false} />
          <Tooltip
            formatter={(value: number | undefined) => [value ?? 0, 'Tickets']}
            labelFormatter={(_, payload) => payload[0]?.payload?.date ?? ''}
            contentStyle={{ fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="#0f172a"
            strokeWidth={2}
            dot={{ r: 3 }}
            name="Tickets"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
