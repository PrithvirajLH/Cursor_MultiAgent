import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { AgentWorkloadResponse } from '../../api/client';

type Point = AgentWorkloadResponse['data'][number] & {
  label: string;
  assignedOther: number;
};

const ASSIGNED_COLOR = '#cbd5f5';
const IN_PROGRESS_COLOR = 'hsl(var(--status-progress))';

function truncateLabel(value: string) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 16)}...`;
}

function WorkloadTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Point }>;
}) {
  if (!active || !payload?.length) {
    return null;
  }
  const row = payload[0]?.payload;
  if (!row) {
    return null;
  }
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] shadow-card">
      <div className="text-xs font-semibold text-slate-700">{row.label}</div>
      <div className="mt-2 space-y-1">
        <div className="flex items-center justify-between gap-3 text-slate-600">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ASSIGNED_COLOR }} />
            Open assigned
          </span>
          <span className="font-semibold text-slate-800">{row.assignedOpen}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-slate-600">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: IN_PROGRESS_COLOR }} />
            In progress
          </span>
          <span className="font-semibold text-slate-800">{row.inProgress}</span>
        </div>
      </div>
    </div>
  );
}

export function AgentWorkloadChart({ data }: { data: AgentWorkloadResponse['data'] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-slate-500">
        No assigned open tickets.
      </div>
    );
  }

  const chartData: Point[] = data.map((row) => {
    const assignedOpen = Math.max(0, row.assignedOpen ?? 0);
    const inProgress = Math.max(0, row.inProgress ?? 0);
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
      <div className="h-[240px] w-full min-h-0 overflow-visible">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#64748b" allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="label"
              width={140}
              tick={{ fontSize: 11, fill: '#475569' }}
              tickFormatter={truncateLabel}
            />
            <Tooltip content={<WorkloadTooltip />} />
            <Bar
              dataKey="assignedOther"
              stackId="open"
              fill={ASSIGNED_COLOR}
              radius={[4, 0, 0, 4]}
              name="Open assigned"
            />
            <Bar
              dataKey="inProgress"
              stackId="open"
              fill={IN_PROGRESS_COLOR}
              radius={[0, 4, 4, 0]}
              name="In progress"
            />
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
