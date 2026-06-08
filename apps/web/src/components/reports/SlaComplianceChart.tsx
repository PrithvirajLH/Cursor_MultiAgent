import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type SlaData = {
  met: number;
  breached: number;
  total: number;
  atRisk?: number;
};

const TOOLTIP_STYLE: React.CSSProperties = {
  borderRadius: "10px",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "hsl(222,40%,13%)",
  boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
  fontSize: "12px",
  color: "hsl(213,45%,91%)",
};

const COLORS = { met: "hsl(var(--status-green))", breached: "hsl(var(--status-red))", atRisk: "hsl(var(--status-amber))" };

export function SlaComplianceChart({ data }: { data: SlaData }) {
  const points = [
    { name: "Met",      value: data.met,          color: COLORS.met },
    { name: "At Risk",  value: data.atRisk ?? 0,  color: COLORS.atRisk },
    { name: "Breached", value: data.breached,      color: COLORS.breached },
  ].filter((p) => p.value > 0);

  if (points.length === 0) {
    return (
      <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
        No SLA data in range
      </div>
    );
  }

  return (
    <div className="h-[240px] w-full min-h-0 overflow-visible">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={points}
            cx="50%"
            cy="50%"
            innerRadius={52}
            outerRadius={82}
            paddingAngle={3}
            dataKey="value"
            nameKey="name"
            label={({ name, percent }) =>
              `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
            }
            labelLine={{ stroke: "rgba(255,255,255,0.25)" }}
          >
            {points.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number | undefined) => [value ?? 0, "Tickets"]}
            contentStyle={TOOLTIP_STYLE}
          />
          <Legend wrapperStyle={{ fontSize: "12px", color: "hsl(var(--muted-foreground))" }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
