import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { date: string; count: number };

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const GRID_STROKE   = "rgba(255,255,255,0.07)";
const TICK_FILL     = "hsl(var(--muted-foreground))";
const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: "10px",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "hsl(222,40%,13%)",
  boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
  fontSize: "12px",
  color: "hsl(213,45%,91%)",
};

function dayLabel(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function shortDateLabel(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function ReopenRateChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
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
  const avg   = total / Math.max(1, data.length);

  const byDay = DAY_ORDER.map((day) => ({
    day,
    count: chartData
      .filter((row) => row.day === day)
      .reduce((sum, row) => sum + row.count, 0),
  }));
  const dayTotal = byDay.reduce((sum, row) => sum + row.count, 0) || 1;

  return (
    <div className="w-full">
      <div
        className="h-[200px] w-full min-h-0 overflow-visible"
        role="img"
        aria-label="Reopen rate over time"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="short" tick={{ fontSize: 11, fill: TICK_FILL }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: TICK_FILL }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              formatter={(value: number | undefined) => [value ?? 0, "Reopens"]}
              labelFormatter={(_, payload) => payload[0]?.payload?.date ?? ""}
              contentStyle={TOOLTIP_STYLE}
            />
            <ReferenceLine y={avg} stroke="rgba(148,163,184,0.4)" strokeDasharray="4 4" ifOverflow="extendDomain" />
            <Line
              type="monotone"
              dataKey="count"
              stroke="hsl(var(--status-amber))"
              strokeWidth={2}
              dot={{ r: 3, fill: "hsl(var(--status-amber))", strokeWidth: 0 }}
              activeDot={{ r: 5, fill: "hsl(var(--status-amber))", strokeWidth: 0 }}
              animationBegin={0}
              animationDuration={800}
              animationEasing="ease-out"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3">
        <div className="flex h-1.5 w-full overflow-hidden rounded-full" style={{ background: "hsl(var(--muted))" }}>
          {byDay.map((row) => {
            const width = Math.max(0, (row.count / dayTotal) * 100);
            return (
              <span
                key={row.day}
                style={{ width: `${width}%`, background: "rgba(251,191,36,0.6)" }}
                className="h-full"
              />
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between text-[11px] text-muted-foreground">
          <span>Average: {avg.toFixed(1)} reopens / day</span>
          <span>Distribution by day of week</span>
        </div>
      </div>
    </div>
  );
}
