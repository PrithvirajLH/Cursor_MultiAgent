import { describe, expect, it } from "vitest";
import type { AnnouncementRecord } from "../api/client";
import { announcementPhase, groupAnnouncements } from "./announcement-window";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function make(
  id: string,
  startsAt: string,
  endsAt: string | null,
): AnnouncementRecord {
  return {
    id,
    title: id,
    body: "x",
    severity: "INFO",
    audience: "ALL",
    teamId: null,
    linkedTicketId: null,
    startsAt,
    endsAt,
    createdById: null,
    createdAt: startsAt,
    updatedAt: startsAt,
  };
}

describe("announcementPhase (card 2.7)", () => {
  it("is active inside the window", () => {
    expect(
      announcementPhase(
        { startsAt: "2026-09-14T11:00:00.000Z", endsAt: "2026-09-14T13:00:00.000Z" },
        NOW,
      ),
    ).toBe("active");
  });

  it("⚠️ is active with no end date at all", () => {
    // "Until I say otherwise" is the normal case for an outage.
    expect(
      announcementPhase(
        { startsAt: "2026-09-14T11:00:00.000Z", endsAt: null },
        NOW,
      ),
    ).toBe("active");
  });

  it("is scheduled before it starts", () => {
    expect(
      announcementPhase(
        { startsAt: "2026-09-20T00:00:00.000Z", endsAt: null },
        NOW,
      ),
    ).toBe("scheduled");
  });

  it("is expired once the end has passed", () => {
    expect(
      announcementPhase(
        { startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-02T00:00:00.000Z" },
        NOW,
      ),
    ).toBe("expired");
  });

  it("⚠️ agrees with the server about both boundaries", () => {
    // The server's rule is `startsAt <= now` and `endsAt > now`. An
    // announcement starting exactly now is live; one ending exactly now is not.
    expect(
      announcementPhase({ startsAt: NOW.toISOString(), endsAt: null }, NOW),
    ).toBe("active");
    expect(
      announcementPhase(
        { startsAt: "2026-09-01T00:00:00.000Z", endsAt: NOW.toISOString() },
        NOW,
      ),
    ).toBe("expired");
  });
});

describe("groupAnnouncements", () => {
  it("splits the three groups and orders each one usefully", () => {
    const rows = [
      make("expired-old", "2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z"),
      make("active-new", "2026-09-14T10:00:00.000Z", null),
      make("scheduled-later", "2026-10-01T00:00:00.000Z", null),
      make("active-old", "2026-09-01T00:00:00.000Z", null),
      make("scheduled-sooner", "2026-09-15T00:00:00.000Z", null),
      make("expired-recent", "2026-09-10T00:00:00.000Z", "2026-09-11T00:00:00.000Z"),
    ];
    const groups = groupAnnouncements(rows, NOW);
    expect(groups.active.map((r) => r.id)).toEqual(["active-new", "active-old"]);
    // Scheduled reads forwards - the next thing to appear is at the top.
    expect(groups.scheduled.map((r) => r.id)).toEqual([
      "scheduled-sooner",
      "scheduled-later",
    ]);
    expect(groups.expired.map((r) => r.id)).toEqual([
      "expired-recent",
      "expired-old",
    ]);
  });

  it("returns three empty groups for an empty list rather than throwing", () => {
    expect(groupAnnouncements([], NOW)).toEqual({
      active: [],
      scheduled: [],
      expired: [],
    });
  });
});
