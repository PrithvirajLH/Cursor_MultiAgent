/**
 * Render the SLA at-risk threshold as the suffix on the "Breach risk" badge.
 *
 * ⚠️ CARD 1.70 ② EXISTS BECAUSE THIS WAS A LITERAL. The sidebar label read
 * `Breach risk · 1h` while the list used four hours and the count used
 * `SLA_AT_RISK_THRESHOLD_MINUTES` (default 120, so two hours) — three numbers
 * for one idea, arrived at by two separate drifts. Fixing the two numbers and
 * leaving the words hard-coded would only have reset that clock, so the label
 * is derived from the same value the counts were computed with, which
 * `getCounts` returns for exactly this purpose.
 *
 * Whole hours read as hours because that is how the desk talks about SLAs;
 * anything else stays in minutes rather than being rounded, since a badge
 * claiming "1h" for a 90-minute setting is the bug this card is closing.
 *
 * @param minutes The configured threshold, as returned by `GET /tickets/counts`.
 * @returns A short suffix such as `2h` or `90m`, or `null` when there is no
 *   usable value — in which case the caller renders the bare label rather than
 *   inventing a number.
 */
export function formatAtRiskThreshold(minutes: number | undefined): string | null {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  const whole = Math.round(minutes);
  if (whole % 60 === 0) {
    return `${whole / 60}h`;
  }
  return `${whole}m`;
}
