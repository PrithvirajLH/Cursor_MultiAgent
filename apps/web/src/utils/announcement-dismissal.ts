import type { ActiveAnnouncement, AnnouncementSeverity } from "../api/client";

/**
 * Who may dismiss what, and for how long (card 2.7).
 *
 * ⚠️ THE OWNER DECIDED THIS, it is not a default: INFO and WARNING dismiss and
 * stay dismissed; an OUTAGE may be COLLAPSED to a slim strip but comes back in
 * full on a fresh session. The card exists to stop forty duplicate tickets, and
 * a banner someone cleared at 9am does not do that at 2pm — but a notice nobody
 * can quieten is its own kind of useless, so the quiet ones get out of the way.
 *
 * ⚠️ BROWSER STORAGE IS PER BROWSER, NOT PER USER. On a shared desk machine one
 * person's dismissal hides the notice from the next, and clearing site data
 * resurrects everything. That is a real limitation of this approach and it is
 * the reason OUTAGE is not allowed to be silenced this way.
 */
export const DISMISSED_STORAGE_KEY = "announcement.dismissed";
export const COLLAPSED_STORAGE_KEY = "announcement.collapsed";

/** An outage cannot be dismissed for good — only collapsed for this session. */
export function canDismissPermanently(severity: AnnouncementSeverity): boolean {
  return severity !== "OUTAGE";
}

/**
 * Read a stored id list.
 *
 * ⚠️ EVERY ACCESS IS WRAPPED. `localStorage` throws outright in some privacy
 * modes, and a banner that crashes the shell is worse than no banner. A missing
 * or corrupt value reads as "nothing dismissed", which fails towards showing
 * the notice rather than hiding it.
 */
export function readDismissedIds(storage: Storage | undefined): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

/** Add an id to a stored list. Silently does nothing when storage is unusable. */
export function rememberId(
  storage: Storage | undefined,
  key: string,
  id: string,
): void {
  if (!storage) return;
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const ids = Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
    if (!ids.includes(id)) {
      ids.push(id);
    }
    storage.setItem(key, JSON.stringify(ids));
  } catch {
    // A viewer who cannot store a dismissal simply sees the banner again.
  }
}

/** The same read as `readDismissedIds`, for whichever key the caller wants. */
export function readIds(
  storage: Storage | undefined,
  key: string,
): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * What the banner should actually render.
 *
 * ⚠️ ONLY DISMISSIBLE SEVERITIES CAN BE FILTERED OUT. An id in the dismissed
 * list that belongs to an OUTAGE is ignored — otherwise an announcement edited
 * up to OUTAGE after somebody dismissed it would stay invisible to exactly the
 * people who need it.
 */
export function visibleAnnouncements(
  announcements: ActiveAnnouncement[],
  dismissedIds: string[],
): ActiveAnnouncement[] {
  return announcements.filter(
    (announcement) =>
      !(
        canDismissPermanently(announcement.severity) &&
        dismissedIds.includes(announcement.id)
      ),
  );
}
