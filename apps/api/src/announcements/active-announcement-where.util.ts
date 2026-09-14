import { AnnouncementAudience, Prisma } from '@prisma/client';

/**
 * What this viewer should see, right now (card 2.7).
 *
 * ⚠️ THIS IS THE SECURITY BOUNDARY OF THE CARD, and it is a QUERY filter on
 * purpose. A TEAM announcement belongs to one team; filtering it in the browser
 * would mean sending every team's announcements to every browser and hiding
 * some of them, which is not a filter — it is a payload anyone can read with
 * the network tab open.
 *
 * Two halves, both non-negotiable:
 *
 *  - **The window.** `startsAt <= now AND (endsAt IS NULL OR endsAt > now)`,
 *    evaluated server-side. ⚠️ NEVER against the browser's clock: a laptop set
 *    wrong would show or hide an outage notice, and being trustworthy is the
 *    one thing this feature cannot trade away. A null `endsAt` means "until I
 *    say otherwise" and stays visible.
 *  - **The audience.** `ALL` reaches everyone; `TEAM` reaches only members of
 *    that team. Somebody in no team sees only `ALL`, which is the correct answer
 *    for a requester.
 *
 * ⚠️ NO ROLE ESCAPE HATCH, deliberately — an OWNER does not see another team's
 * TEAM announcement in their banner either. The banner says what applies to
 * YOU; the admin list is where somebody responsible sees everything. A role
 * exemption here would be the hole this filter exists to close.
 *
 * @param now The server's current time.
 * @param teamIds Teams this viewer belongs to; empty is normal for a requester.
 * @returns A Prisma filter for the active, visible announcements.
 */
export function activeAnnouncementWhere(
  now: Date,
  teamIds: string[],
): Prisma.AnnouncementWhereInput {
  const audience: Prisma.AnnouncementWhereInput[] = [
    { audience: AnnouncementAudience.ALL },
  ];
  if (teamIds.length > 0) {
    audience.push({
      audience: AnnouncementAudience.TEAM,
      teamId: { in: teamIds },
    });
  }
  return {
    AND: [
      { startsAt: { lte: now } },
      { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      { OR: audience },
    ],
  };
}
