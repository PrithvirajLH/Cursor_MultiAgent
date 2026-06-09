import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { AgentWorkloadResponse } from "../../api/client";

type Point = AgentWorkloadResponse["data"][number] & {
  label: string;
  assignedOther: number;
};

const GRID_STROKE        = "rgba(255,255,255,0.07)";
const TICK_FILL          = "hsl(var(--muted-foreground))";
const ASSIGNED_COLOR     = "rgba(148,163,184,0.35)";
const IN_PROGRESS_COLOR  = "hsl(var(--status-blue))";

const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: "10px",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "hsl(222,40%,13%)",
  boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
  fontSize: "12px",
  color: "hsl(213,45%,91%)",
};

function truncateLabel(value: string) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 16)}…`;
}

function WorkloadTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Point }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 text-[11px]">
      <div className="text-xs font-semibold mb-2 text-foreground/90">{row.label}</div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4 text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ASSIGNED_COLOR }} />
            Open assigned
          </span>
          <span className="font-semibold tabular-nums text-foreground">{row.assignedOpen}</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: IN_PROGRESS_COLOR }} />
            In progress
          </span>
          <span className="font-semibold tabular-nums text-foreground">{row.inProgress}</span>
        </div>
      </div>
    </div>
  );
}

export function AgentWorkloadChart({
  data,
}: {
  data: AgentWorkloadResponse["data"];
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
        No assigned open tickets.
      </div>
    );
  }

  const chartData: Point[] = data.map((row) => {
    const assignedOpen = Math.max(0, row.assignedOpen ?? 0);
    const inProgress   = Math.max(0, row.inProgress ?? 0);
    return {
      ...row,
      label: row.name || row.email || row.userId,
      assignedOpen,
      inProgress,
      assignedOther: Math.max(0, assignedOpen - inProgress),
    };
  });

  return (
    <div className="w-full">
      <div
        className="h-[240px] w-full min-h-0 overflow-visible"
        role="img"
        aria-label="Agent workload by open and in-progress tickets"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
            <XAxis type="number" tick={{ fill: TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11, fill: TICK_FILL }} axisLine={false} tickLine={false} tickFormatter={truncateLabel} />
            <Tooltip content={<WorkloadTooltip />} />
            <Bar dataKey="assignedOther" stackId="open" fill={ASSIGNED_COLOR} radius={[6, 0, 0, 6]} name="Open assigned" animationBegin={0} animationDuration={800} animationEasing="ease-out" />
            <Bar dataKey="inProgress"   stackId="open" fill={IN_PROGRESS_COLOR} radius={[0, 6, 6, 0]} name="In progress"   animationBegin={0} animationDuration={800} animationEasing="ease-out" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ASSIGNED_COLOR }} />
          Open assigned
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: IN_PROGRESS_COLOR }} />
          In progress
        </div>
      </div>
    </div>
  );
}
