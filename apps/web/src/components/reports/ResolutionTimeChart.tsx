import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

type Point = { label: string; avgHours: number; count: number };

const DEPARTMENT_COLORS = [
  '#2563eb',
  '#0d9488',
  '#6366f1',
  '#ea580c',
  '#059669',
  '#7c3aed',
  '#dc2626',
  '#64748b',
];

export function ResolutionTimeChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <div className="h-[240px] flex items-center justify-center text-sm text-slate-500">
        No resolution data in range
      </div>
    );
  }
  return (
    <div className="h-[240px] w-full min-h-0 overflow-visible">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} unit="h" axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(value: number | undefined) => [value ?? 0, 'Avg hours']}
            contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 15px rgba(0, 0, 0, 0.04)', fontSize: '12px' }}
          />
          <Bar dataKey="avgHours" name="Avg resolution (h)" radius={[6, 6, 0, 0]} animationBegin={0} animationDuration={800} animationEasing="ease-out">
            {data.map((_, index) => (
              <Cell key={index} fill={DEPARTMENT_COLORS[index % DEPARTMENT_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
