import type { AnnouncementRecord } from "../api/client";

/**
 * Where an announcement sits in its own lifetime (card 2.7).
 *
 * An admin's question is almost always "what is showing right now", so the
 * screen groups by this rather than listing everything by date.
 *
 * ⚠️ THIS MIRRORS THE SERVER'S `activeAnnouncementWhere`, and the two must agree
 * about the boundaries: `startsAt <= now` and a null or future `endsAt`. It is a
 * second implementation of one rule — the shape this repo keeps getting burned
 * by — so it is confined to this file, tested against the same cases, and used
 * ONLY to label rows the server already returned. The banner never decides for
 * itself what is active; the server does.
 */
export type AnnouncementPhase = "active" | "scheduled" | "expired";

export function announcementPhase(
  announcement: Pick<AnnouncementRecord, "startsAt" | "endsAt">,
  now: Date = new Date(),
): AnnouncementPhase {
  const startsAt = new Date(announcement.startsAt).getTime();
  const endsAt = announcement.endsAt
    ? new Date(announcement.endsAt).getTime()
    : null;
  if (Number.isFinite(startsAt) && startsAt > now.getTime()) {
    return "scheduled";
  }
  if (endsAt !== null && Number.isFinite(endsAt) && endsAt <= now.getTime()) {
    return "expired";
  }
  return "active";
}

/**
 * Split a list into the three groups the screen shows.
 *
 * Active first and newest-first within it; expired newest-first too, because
 * "what did we say last week" is read backwards from now.
 */
export function groupAnnouncements(
  announcements: AnnouncementRecord[],
  now: Date = new Date(),
): Record<AnnouncementPhase, AnnouncementRecord[]> {
  const groups: Record<AnnouncementPhase, AnnouncementRecord[]> = {
    active: [],
    scheduled: [],
    expired: [],
  };
  for (const announcement of announcements) {
    groups[announcementPhase(announcement, now)].push(announcement);
  }
  groups.active.sort(byStartDescending);
  groups.expired.sort(byStartDescending);
  // Scheduled reads forwards: the next thing to appear belongs at the top.
  groups.scheduled.sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  return groups;
}

function byStartDescending(a: AnnouncementRecord, b: AnnouncementRecord) {
  return new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime();
}
