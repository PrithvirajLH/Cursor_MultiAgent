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

const GRID_STROKE    = "rgba(255,255,255,0.07)";
const TICK_FILL      = "#94a3b8";
const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: "10px",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "hsl(222,40%,13%)",
  boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
  fontSize: "12px",
  color: "hsl(213,45%,91%)",
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
            stroke="#14d4f4"
            strokeWidth={2}
            dot={{ r: 3, fill: "#14d4f4", strokeWidth: 0 }}
            activeDot={{ r: 5, fill: "#14d4f4", strokeWidth: 0 }}
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
