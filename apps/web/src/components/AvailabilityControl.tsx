import { CalendarClock, CircleCheck, CircleSlash } from "lucide-react";
import {
  availabilityLabel,
  backOnIsUsable,
  isAwayNow,
  reassignOffer,
  type AvailabilityState,
} from "../utils/availability";

export type AvailabilityControlProps = {
  state: AvailabilityState | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** `yyyy-mm-dd`, the date input's own value. Owned by the caller. */
  backOn: string;
  onBackOnChange: (value: string) => void;
  onGoAway: () => void;
  onComeBack: () => void;
  /** Null until asked for — it is only asked for once somebody is away. */
  openTickets: { count: number; truncated: boolean } | null;
  onReassign: () => void;
  /** How many were actually handed over, for the line after the click. */
  reassigned: number | null;
};

/**
 * Availability in the avatar menu (card 2.2).
 *
 * Presentational on purpose — every piece of state and every call lives in
 * `TopBar`, so this renders to static markup in a test without a DOM, which is
 * the only kind of web test this repo has (no jsdom anywhere, deliberately).
 *
 * ⚠️ THE DATE FIELD SAYS "BACK ON", NOT "AWAY UNTIL". They are the same stored
 * value and opposite readings: "away until the 12th" sounds like the 12th is
 * still away, while the server treats the stored instant as the moment work may
 * reach you again. Naming the field for the return date is what makes the two
 * agree — see `backOnToIso`, which pins it at local midnight on that day.
 */
export function AvailabilityControl({
  state,
  loading,
  busy,
  error,
  backOn,
  onBackOnChange,
  onGoAway,
  onComeBack,
  openTickets,
  onReassign,
  reassigned,
}: AvailabilityControlProps) {
  if (loading || !state) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        Checking availability…
      </div>
    );
  }
  const away = isAwayNow(state);
  const offer = openTickets
    ? reassignOffer(openTickets.count, openTickets.truncated)
    : null;
  const dateUsable = backOnIsUsable(backOn);
  return (
    <div className="px-4 py-3 space-y-3 border-t" style={{ borderColor: "hsl(var(--border))" }}>
      <div className="flex items-center gap-2 text-xs">
        {away ? (
          <CircleSlash className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <CircleCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium text-foreground">
          {availabilityLabel(state)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {away
          ? "New tickets are not being auto-assigned to you."
          : "Auto-assignment can send you new tickets."}
      </p>
      {away ? (
        <button
          type="button"
          disabled={busy}
          onClick={onComeBack}
          className="w-full rounded-lg border px-3 py-2 text-sm font-medium text-foreground transition-all hover:bg-accent disabled:opacity-60"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          I&apos;m back
        </button>
      ) : (
        <div className="space-y-2">
          <label
            className="flex items-center gap-2 text-xs text-muted-foreground"
            htmlFor="availability-back-on"
          >
            <CalendarClock className="h-4 w-4 shrink-0" />
            Back on (optional)
          </label>
          <input
            id="availability-back-on"
            type="date"
            value={backOn}
            onChange={(event) => onBackOnChange(event.target.value)}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
            style={{ borderColor: "hsl(var(--border))" }}
          />
          <button
            type="button"
            disabled={busy || !dateUsable}
            onClick={onGoAway}
            className="w-full rounded-lg border px-3 py-2 text-sm font-medium text-foreground transition-all hover:bg-accent disabled:opacity-60"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            Set me away
          </button>
          {!dateUsable && (
            <p className="text-xs text-destructive">
              Pick a date in the future — a past date would mean you are already
              back.
            </p>
          )}
        </div>
      )}
      {away && offer && (
        <button
          type="button"
          disabled={busy}
          onClick={onReassign}
          className="w-full rounded-lg border px-3 py-2 text-left text-xs font-medium text-foreground transition-all hover:bg-accent disabled:opacity-60"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          {offer}
        </button>
      )}
      {away && openTickets?.count === 0 && reassigned === null && (
        <p className="text-xs text-muted-foreground">
          Nothing open is assigned to you.
        </p>
      )}
      {reassigned !== null && (
        <p className="text-xs text-muted-foreground">
          {reassigned === 1
            ? "1 ticket is back in its team's queue."
            : `${reassigned} tickets are back in their teams' queues.`}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
