import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

type SlaData = { met: number; breached: number; total: number; atRisk?: number };

const COLORS = { met: '#16a34a', breached: '#dc2626', atRisk: '#f59e0b' };

export function SlaComplianceChart({ data }: { data: SlaData }) {
  const points = [
    { name: 'Met', value: data.met, color: COLORS.met },
    { name: 'At Risk', value: data.atRisk ?? 0, color: COLORS.atRisk },
    { name: 'Breached', value: data.breached, color: COLORS.breached },
  ].filter((p) => p.value > 0);
  if (points.length === 0) {
    return (
      <div className="h-[240px] flex items-center justify-center text-sm text-slate-500">
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
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
            nameKey="name"
            label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
          >
            {points.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip formatter={(value: number | undefined) => [value ?? 0, 'Tickets']} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
