import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type ActivityPoint = {
  day: string;
  date: string;
  open: number;
  resolved: number;
};

function ActivityTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ActivityPoint }>;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] shadow-card">
      <div className="text-xs font-semibold text-slate-700">{point.date}</div>
      <div className="mt-2 space-y-1">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-slate-600">
            <span className="h-2 w-2 rounded-full bg-[hsl(var(--status-progress))]" />
            Open
          </span>
          <span className="font-semibold text-slate-800">{point.open ?? 0}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-slate-600">
            <span className="h-2 w-2 rounded-full bg-[hsl(var(--status-resolved))]" />
            Resolved
          </span>
          <span className="font-semibold text-slate-800">{point.resolved ?? 0}</span>
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
              <stop offset="0%" stopColor="hsl(var(--status-progress))" stopOpacity={0.2} />
              <stop offset="100%" stopColor="hsl(var(--status-progress))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="resolvedGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--status-resolved))" stopOpacity={0.2} />
              <stop offset="100%" stopColor="hsl(var(--status-resolved))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
          />
          <Tooltip content={<ActivityTooltip />} />
          <Area
            type="monotone"
            dataKey="open"
            stroke="hsl(var(--status-progress))"
            strokeWidth={2}
            fill="url(#openGradient)"
            dot={{ fill: 'hsl(var(--status-progress))', strokeWidth: 0, r: 4 }}
          />
          <Area
            type="monotone"
            dataKey="resolved"
            stroke="hsl(var(--status-resolved))"
            strokeWidth={2}
            fill="url(#resolvedGradient)"
            dot={{ fill: 'hsl(var(--status-resolved))', strokeWidth: 0, r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
