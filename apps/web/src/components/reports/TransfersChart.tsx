import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { date: string; count: number };

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

function shortDateLabel(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function TransfersChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
        No transfers recorded for the selected range.
      </div>
    );
  }

  const chartData = data.map((row) => ({ ...row, short: shortDateLabel(row.date) }));

  return (
    <div className="h-[200px] w-full" role="img" aria-label="Transfers over time">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="short" tick={{ fill: TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: TICK_FILL, fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(value: number | undefined) => [value ?? 0, "Transfers"]}
            labelFormatter={(_, payload) => payload[0]?.payload?.date ?? ""}
            contentStyle={TOOLTIP_STYLE}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="hsl(var(--status-purple))"
            strokeWidth={2}
            dot={{ r: 3, fill: "hsl(var(--status-purple))", strokeWidth: 0 }}
            activeDot={{ r: 5, fill: "hsl(var(--status-purple))", strokeWidth: 0 }}
            animationBegin={0}
            animationDuration={800}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
