import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ActivityPoint = {
  day: string;
  date: string;
  open: number;
  resolved: number;
};

// ── Theme-aware chart tokens ──
// Use CSS vars so the chart respects light + dark themes.
const GRID_STROKE = "hsl(var(--border))";
const TICK_FILL = "hsl(var(--muted-foreground))";
const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: "10px",
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--popover))",
  boxShadow: "var(--shadow-elevated, 0 8px 32px rgba(0,0,0,0.18))",
  fontSize: "12px",
  color: "hsl(var(--popover-foreground))",
};

function ActivityTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ActivityPoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 text-[11px]">
      <div className="text-xs font-semibold mb-2 text-foreground/90">{point.date}</div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-[hsl(var(--status-progress))]" />
            Open
          </span>
          <span className="font-semibold tabular-nums text-foreground">{point.open ?? 0}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-[hsl(var(--status-resolved))]" />
            Resolved
          </span>
          <span className="font-semibold tabular-nums text-foreground">{point.resolved ?? 0}</span>
        </div>
      </div>
    </div>
  );
}

export function TicketActivityChart({ data }: { data: ActivityPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        No activity data available.
      </div>
    );
  }

  return (
    <div className="h-48 min-h-0 overflow-visible">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="openGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="hsl(var(--status-progress))" stopOpacity={0.25} />
              <stop offset="100%" stopColor="hsl(var(--status-progress))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="resolvedGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="hsl(var(--status-resolved))" stopOpacity={0.25} />
              <stop offset="100%" stopColor="hsl(var(--status-resolved))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: TICK_FILL, fontSize: 12 }} />
          <YAxis axisLine={false} tickLine={false} allowDecimals={false} tick={{ fill: TICK_FILL, fontSize: 12 }} />
          <Tooltip content={<ActivityTooltip />} />
          <Area type="monotone" dataKey="open"     stroke="hsl(var(--status-progress))" strokeWidth={2} fill="url(#openGradient)"     dot={false} activeDot={{ r: 4, strokeWidth: 0 }} animationBegin={0} animationDuration={800} animationEasing="ease-out" />
          <Area type="monotone" dataKey="resolved" stroke="hsl(var(--status-resolved))" strokeWidth={2} fill="url(#resolvedGradient)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} animationBegin={0} animationDuration={800} animationEasing="ease-out" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
