import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Point = { priority: string; count: number };

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

const PRIORITY_COLORS: Record<string, string> = {
  SEV1: "hsl(var(--status-red))",
  SEV2: "hsl(var(--status-amber))",
  SEV3: "hsl(var(--status-blue))",
  SEV4: "hsl(var(--muted-foreground))",
};

function colorForPriority(priority: string): string {
  return PRIORITY_COLORS[priority] ?? "hsl(var(--muted-foreground))";
}

export function TicketsByPriorityChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
        No tickets in range
      </div>
    );
  }

  return (
    <div
      className="h-[200px] w-full min-h-0 overflow-visible"
      role="img"
      aria-label="Tickets by priority"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="priority" tick={{ fill: TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: TICK_FILL, fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="count" name="Tickets" radius={[6, 6, 0, 0]} animationBegin={0} animationDuration={800} animationEasing="ease-out">
            {data.map((entry, index) => (
              <Cell key={index} fill={colorForPriority(entry.priority)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
