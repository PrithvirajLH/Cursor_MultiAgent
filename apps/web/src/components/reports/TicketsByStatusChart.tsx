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

type Point = { status: string; count: number };

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

const STATUS_COLORS: Record<string, string> = {
  NEW:                    "hsl(var(--status-new))",
  TRIAGED:                "hsl(var(--status-progress))",
  ASSIGNED:               "hsl(var(--status-progress))",
  IN_PROGRESS:            "hsl(var(--status-progress))",
  WAITING_ON_REQUESTER:   "hsl(var(--status-waiting))",
  WAITING_ON_VENDOR:      "hsl(var(--status-waiting))",
  RESOLVED:               "hsl(var(--status-resolved))",
  CLOSED:                 "hsl(var(--muted-foreground))",
  REOPENED:               "hsl(var(--status-red))",
};

function colorForStatus(status: string): string {
  return STATUS_COLORS[status] ?? "hsl(var(--muted-foreground))";
}

function statusAxisLabel(status: string): string {
  if (status === "WAITING_ON_REQUESTER") return "Requestor";
  if (status === "WAITING_ON_VENDOR") return "Vendor";
  return status;
}

export function TicketsByStatusChart({
  data,
  height = 200,
}: {
  data: Point[];
  height?: number;
}) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No tickets in range
      </div>
    );
  }

  return (
    <div className="w-full min-h-0 overflow-visible" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="status" tick={{ fill: TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={statusAxisLabel} />
          <YAxis tick={{ fill: TICK_FILL, fontSize: 11 }} allowDecimals={false} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="count" name="Tickets" radius={[6, 6, 0, 0]} animationBegin={0} animationDuration={800} animationEasing="ease-out">
            {data.map((entry, index) => (
              <Cell key={index} fill={colorForStatus(entry.status)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
