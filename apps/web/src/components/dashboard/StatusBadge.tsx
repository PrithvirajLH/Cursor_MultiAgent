import { cn } from "@/lib/utils";
import { formatStatus } from "@/utils/format";

const statusConfig: Record<string, { dot: string; bg: string; text: string; border: string }> = {
  NEW:         { dot: "hsl(var(--status-new))",      bg: "hsl(var(--status-new-bg))",      text: "hsl(var(--status-new))",      border: "hsl(var(--status-new) / 0.3)" },
  OPEN:        { dot: "hsl(var(--status-open))",     bg: "hsl(var(--status-open-bg))",     text: "hsl(var(--status-open))",     border: "hsl(var(--status-open) / 0.3)" },
  TRIAGED:     { dot: "hsl(var(--status-progress))", bg: "hsl(var(--status-progress-bg))", text: "hsl(var(--status-progress))", border: "hsl(var(--status-progress) / 0.3)" },
  ASSIGNED:    { dot: "hsl(var(--status-progress))", bg: "hsl(var(--status-progress-bg))", text: "hsl(var(--status-progress))", border: "hsl(var(--status-progress) / 0.3)" },
  IN_PROGRESS: { dot: "hsl(var(--status-progress))", bg: "hsl(var(--status-progress-bg))", text: "hsl(var(--status-progress))", border: "hsl(var(--status-progress) / 0.3)" },
  WAITING:               { dot: "hsl(var(--status-waiting))",  bg: "hsl(var(--status-waiting-bg))",  text: "hsl(var(--status-waiting))",  border: "hsl(var(--status-waiting) / 0.3)" },
  WAITING_ON_REQUESTER:  { dot: "hsl(var(--status-waiting))",  bg: "hsl(var(--status-waiting-bg))",  text: "hsl(var(--status-waiting))",  border: "hsl(var(--status-waiting) / 0.3)" },
  WAITING_ON_VENDOR:     { dot: "hsl(var(--status-waiting))",  bg: "hsl(var(--status-waiting-bg))",  text: "hsl(var(--status-waiting))",  border: "hsl(var(--status-waiting) / 0.3)" },
  RESOLVED:    { dot: "hsl(var(--status-resolved))", bg: "hsl(var(--status-resolved-bg))", text: "hsl(var(--status-resolved))", border: "hsl(var(--status-resolved) / 0.3)" },
  CLOSED:      { dot: "hsl(215 16% 42%)",            bg: "hsl(215 16% 10%)",               text: "hsl(215 16% 55%)",            border: "hsl(215 16% 30% / 0.35)" },
};

const fallbackConfig = { dot: "hsl(215 16% 42%)", bg: "hsl(215 16% 10%)", text: "hsl(215 16% 55%)", border: "hsl(215 16% 30% / 0.35)" };

/**
 * Status badge with colored dot + pill format.
 */
export function StatusBadge({ status }: { status?: string | null }) {
  const key = status?.toUpperCase() ?? "";
  const config = statusConfig[key] ?? fallbackConfig;
  const label = status ? formatStatus(status) : "Unknown";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none whitespace-nowrap",
      )}
      style={{
        background: config.bg,
        color: config.text,
        borderColor: config.border,
      }}
      title={label}
    >
      <span
        className="h-1.5 w-1.5 rounded-full flex-shrink-0"
        style={{ background: config.dot }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
