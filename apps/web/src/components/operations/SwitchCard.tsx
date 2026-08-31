import type { OperationsSwitch } from "../../api/client";

/**
 * One system-wide switch, read-only (card 1.21). These live in Azure app
 * settings, so the card names the setting rather than pretending to toggle it.
 *
 * `flex flex-col` with a `flex-1` description so a row of cards shares one
 * height and every state chip lands on the same line — the LMS console's
 * mechanism, and the reason a row of mismatched paragraphs does not look ragged.
 */
export function SwitchCard({ item }: { item: OperationsSwitch }) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{item.label}</h3>
        <span
          className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            item.on
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {item.state}
        </span>
      </div>
      <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">
        {item.description}
      </p>
      {item.setting ? (
        <p className="mt-3 font-mono text-[11px] text-muted-foreground/80">
          {item.setting}
        </p>
      ) : null}
    </div>
  );
}
