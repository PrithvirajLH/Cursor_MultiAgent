import type { ReactNode } from "react";

/**
 * Shared presentational primitives for the Reports page and its tab components.
 * Pure, stateless — lifted out of ReportsPage.tsx so individual tabs can be
 * split into their own files without duplicating these helpers.
 */

export function toPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

export function MiniBars({
  points,
  height = 60,
}: {
  points: number[];
  height?: number;
}) {
  const width = 220;
  const max = Math.max(...points, 1);
  const barWidth = width / Math.max(points.length, 1);
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="block">
      {points.map((point, idx) => {
        const barHeight = (point / max) * (height - 10);
        return (
          <rect
            key={`bar-${idx}`}
            x={idx * barWidth + 3}
            y={height - barHeight}
            width={Math.max(barWidth - 6, 2)}
            height={barHeight}
            rx="3"
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}

export function CardShell({
  title,
  sub,
  right,
  children,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {sub ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
          ) : null}
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
