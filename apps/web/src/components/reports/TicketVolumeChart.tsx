import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Point = { date: string; count: number };

const LINE_COLOR     = "#5468e0"; // indigo — brand accent, reads on light + dark
const GRID_STROKE    = "rgba(120,130,150,0.18)";
const TICK_FILL      = "#94a3b8";
const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: "10px",
  border: "1px solid rgba(120,130,150,0.25)",
  background: "hsl(var(--popover))",
  boxShadow: "var(--shadow-elevated)",
  fontSize: "12px",
  color: "hsl(var(--popover-foreground))",
};

export function TicketVolumeChart({ data }: { data: Point[] }) {
  const display = data.map((d) => ({ ...d, short: d.date.slice(5) }));

  return (
    <div className="h-[240px] w-full min-h-0 overflow-visible">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={display} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="short" tick={{ fill: TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: TICK_FILL, fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(value: number | undefined) => [value ?? 0, "Tickets"]}
            labelFormatter={(_, payload) => payload[0]?.payload?.date ?? ""}
            contentStyle={TOOLTIP_STYLE}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke={LINE_COLOR}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, fill: LINE_COLOR, strokeWidth: 0 }}
            name="Tickets"
            animationBegin={0}
            animationDuration={800}
            animationEasing="ease-out"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
