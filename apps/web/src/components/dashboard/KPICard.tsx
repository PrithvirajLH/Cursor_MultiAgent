import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface KPICardProps {
  icon: LucideIcon;
  value: number;
  label: string;
  variant?: "blue" | "green" | "default";
  dropdown?: string;
  helper?: string;
}

const accentColors: Record<NonNullable<KPICardProps["variant"]>, {
  icon: string;
  iconBg: string;
  bar: string;
}> = {
  blue: {
    icon: "hsl(var(--status-progress))",
    iconBg: "hsl(var(--status-progress-bg))",
    bar: "hsl(var(--status-progress))",
  },
  green: {
    icon: "hsl(var(--status-open))",
    iconBg: "hsl(var(--status-open-bg))",
    bar: "hsl(var(--status-open))",
  },
  default: {
    icon: "hsl(var(--status-waiting))",
    iconBg: "hsl(var(--status-waiting-bg))",
    bar: "hsl(var(--status-waiting))",
  },
};

export function KPICard({
  icon: Icon,
  value,
  label,
  variant = "default",
  dropdown,
  helper,
}: KPICardProps) {
  const colors = accentColors[variant];

  return (
    <div
      className={cn(
        "relative flex items-center gap-4 rounded-xl border p-4 transition-all duration-200 overflow-hidden",
        "hover:border-white/[0.12] hover:shadow-card group cursor-default",
      )}
      style={{
        background: "hsl(var(--card))",
        borderColor: "hsl(var(--border))",
      }}
    >
      {/* Subtle left accent bar */}
      <span
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full opacity-70 group-hover:opacity-100 transition-opacity"
        style={{ background: colors.bar }}
        aria-hidden="true"
      />

      {/* Icon */}
      <div
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105"
        style={{
          background: colors.iconBg,
          color: colors.icon,
        }}
      >
        <Icon className="h-5 w-5" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-[26px] font-bold leading-none tracking-tight tabular-nums text-foreground">
          {value.toLocaleString()}
        </div>
        <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        {helper && (
          <div className="mt-1 text-[12px] text-muted-foreground/70 leading-tight">
            {helper}
          </div>
        )}
      </div>

      {dropdown && (
        <span
          className="absolute right-4 top-4 flex items-center gap-1 text-xs text-muted-foreground"
          aria-hidden
        >
          {dropdown}
        </span>
      )}
    </div>
  );
}
