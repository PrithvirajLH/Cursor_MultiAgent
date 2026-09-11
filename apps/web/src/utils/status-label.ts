/**
 * What a status is called on screen (card 2.12, UX review Theme 2).
 *
 * ⚠️ `IN_PROGRESS` IS NOT A WORD. The screen had been title-casing the enum —
 * "In Progress", "Waiting On Requester" — which is better than shouting the
 * constant but still reads like a database column wearing a hat. These are the
 * words a person would use.
 *
 * Deliberately keyed loosely (`Record<string, string>`) and with a fallback:
 * a status added to the API before this map knows about it must still render
 * as something a reader can parse, not as an empty badge. The fallback is the
 * old title-casing, which is exactly what every caller had before.
 */
const TICKET_STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  TRIAGED: "Triaged",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  WAITING_ON_REQUESTER: "Waiting on requester",
  WAITING_ON_VENDOR: "Waiting on vendor",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
};

/** Title-case an unknown enum, so a new status is still readable. */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * The label for a ticket status.
 *
 * @param value The API's enum value, or anything unrecognised.
 * @returns The human label; title-cased fallback for anything not mapped.
 */
export function statusLabel(value: string): string {
  return TICKET_STATUS_LABELS[value] ?? titleCase(value);
}
