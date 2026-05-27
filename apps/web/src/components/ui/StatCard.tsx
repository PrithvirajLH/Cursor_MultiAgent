import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone = "blue" | "green" | "purple" | "amber" | "red" | "neutral";

const TONES: Record<StatTone, { text: string; bg: string }> = {
  blue: { text: "text-primary", bg: "bg-blue-50 dark:bg-blue-500/10" },
  green: { text: "text-green-600", bg: "bg-green-50 dark:bg-green-500/10" },
  purple: { text: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-500/10" },
  amber: { text: "text-yellow-600", bg: "bg-yellow-50 dark:bg-yellow-500/10" },
  red: { text: "text-red-600", bg: "bg-red-50 dark:bg-red-500/10" },
  neutral: { text: "text-foreground", bg: "bg-accent" },
};

export type StatCardProps = {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  /** Color accent for the value + icon chip. */
  tone?: StatTone;
  /** Optional sub-line under the value. */
  hint?: string;
  className?: string;
};

/** Compact KPI tile for admin pages: label, big value, and an optional tinted icon. */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  hint,
  className,
}: StatCardProps) {
  const t = TONES[tone];
  return (
    <div
      className={cn(
        "card rounded-xl border border-border bg-card p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className={cn("mt-0.5 text-2xl font-bold", t.text)}>{value}</p>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {Icon && (
          <div
            className={cn(
              "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
              t.bg,
            )}
          >
            <Icon className={cn("h-5 w-5", t.text)} />
          </div>
        )}
      </div>
    </div>
  );
}
