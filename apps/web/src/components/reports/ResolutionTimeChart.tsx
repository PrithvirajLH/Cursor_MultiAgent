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

type Point = { label: string; avgHours: number; count: number };

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

const DEPARTMENT_COLORS = [
  "hsl(var(--chart-6))", "hsl(var(--status-green))", "hsl(var(--status-purple))",
  "hsl(var(--status-amber))", "hsl(var(--status-blue))", "hsl(var(--chart-3))",
  "hsl(var(--status-red))", "hsl(var(--muted-foreground))",
];

export function ResolutionTimeChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
        No resolution data in range
      </div>
    );
  }

  return (
    <div
      className="h-[240px] w-full min-h-0 overflow-visible"
      role="img"
      aria-label="Average resolution time by department"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: TICK_FILL, fontSize: 11 }} unit="h" axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(value: number | undefined) => [value ?? 0, "Avg hours"]}
            contentStyle={TOOLTIP_STYLE}
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
