/**
 * Availability, as the browser has to talk about it (card 2.2).
 *
 * ⚠️ THE RULE HERE MIRRORS THE SERVER'S `availableUserFilter`, and that is a
 * second implementation of one rule — the exact shape this repo keeps getting
 * burned by (cards 1.36, 1.61, 1.70, 1.72). It is here anyway because the
 * screen has to label a state the server never sends a label for, and the
 * alternative is a label computed inline in a component where nothing can test
 * it. The mitigation is that this file is the ONLY copy on the web side, and
 * `availability.test.ts` pins the same three cases the API spec pins.
 *
 * The rule: a past `awayUntil` means back, whatever the stored flag says.
 */

export type AvailabilityState = {
  isAvailable: boolean;
  awayUntil: string | null;
};

/** Is this person away *right now* — flag and return date taken together. */
export function isAwayNow(
  state: AvailabilityState,
  now: Date = new Date(),
): boolean {
  if (state.isAvailable) {
    return false;
  }
  if (!state.awayUntil) {
    // Away with no end in sight. No date could say this.
    return true;
  }
  const until = new Date(state.awayUntil).getTime();
  if (Number.isNaN(until)) {
    return true;
  }
  return until > now.getTime();
}

/** How the avatar menu says it. */
export function availabilityLabel(
  state: AvailabilityState,
  now: Date = new Date(),
): string {
  if (!isAwayNow(state, now)) {
    return "Available";
  }
  if (!state.awayUntil) {
    return "Away";
  }
  const back = new Date(state.awayUntil);
  if (Number.isNaN(back.getTime())) {
    return "Away";
  }
  return `Away until ${back.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

/** ISO instant to the `yyyy-mm-dd` a date input wants, in the viewer's zone. */
export function backOnInputValue(awayUntil: string | null): string {
  if (!awayUntil) {
    return "";
  }
  const date = new Date(awayUntil);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * `yyyy-mm-dd` back to an ISO instant — local midnight on the day they return.
 *
 * Midnight, not end of day, because the field asks when they are BACK: pick the
 * 12th and assignment may reach you from the first minute of the 12th. Local,
 * not UTC, because a date picked in a browser is a date in that browser's zone;
 * `new Date("2026-09-12")` would be UTC midnight and put someone in
 * Australia back a day early.
 */
export function backOnToIso(value: string): string | null {
  if (!value) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

/**
 * Would the server take this date?
 *
 * It refuses a return date already in the past — that would read as "away" while
 * work kept arriving. Checked here too so the refusal is a disabled button and a
 * sentence rather than a 400 the user has to interpret.
 */
export function backOnIsUsable(value: string, now: Date = new Date()): boolean {
  if (!value) {
    // No date at all is legitimate: away, no end in sight.
    return true;
  }
  const iso = backOnToIso(value);
  if (!iso) {
    return false;
  }
  return new Date(iso).getTime() > now.getTime();
}

/**
 * The offer made when somebody goes away, or null when there is nothing to
 * offer. Card 2.2 asks for it in the agent's own words: how many, and to where.
 */
export function reassignOffer(
  count: number,
  truncated: boolean,
): string | null {
  if (count <= 0) {
    return null;
  }
  const noun = count === 1 ? "open ticket" : "open tickets";
  if (truncated) {
    // ⚠️ Says the smaller number it can actually act on. One bulk call carries
    // 100 ids; claiming 140 and moving 100 is the kind of quiet shortfall
    // nobody notices until a ticket goes missing.
    return `You have ${count} ${noun}. Hand the first 100 to the queue`;
  }
  return `You have ${count} ${noun}. Hand them to the queue`;
}
