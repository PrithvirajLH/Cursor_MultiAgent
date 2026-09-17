import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { UserRef } from "../api/client";
import { isEligibleTeamMemberUser } from "../utils/team-member-eligibility";

function person(role: string | undefined): UserRef {
  return {
    id: `id-${role ?? "none"}`,
    email: `${role ?? "none"}@csnhc.com`,
    displayName: role ?? "No role",
    ...(role === undefined ? {} : { role }),
  };
}

/**
 * Card 1.132 — the picker stops offering people the server will refuse.
 *
 * ⚠️ THE RISK WORTH NAMING IS THE OPPOSITE ONE. Failing closed empties the
 * picker entirely if the users endpoint ever stops sending `role`, which would
 * be worse than the bug. `users.service.ts:131` selects it, and the last test
 * here is the non-vacuity half that would catch a filter that refused
 * everybody.
 */
describe("who the add-member picker offers (card 1.132)", () => {
  it("⚠️ an OWNER is not offered", () => {
    // The server refuses one, deliberately and permanently.
    expect(isEligibleTeamMemberUser(person("OWNER"))).toBe(false);
  });

  it("⚠️ somebody with no role at all is not offered", () => {
    // THE CHANGED BEHAVIOUR. `!user.role ||` used to admit exactly this.
    expect(isEligibleTeamMemberUser(person(undefined))).toBe(false);
  });

  it("an unrecognised role is not offered either", () => {
    expect(isEligibleTeamMemberUser(person("SUPERUSER"))).toBe(false);
  });

  it("⚠️ every role the server accepts is still offered", () => {
    // NON-VACUITY, AND THE ONE MOST LIKELY TO BREAK: a filter that empties the
    // picker is worse than the bug it fixes. These four are exactly the roles
    // `ensureEligibleTeamMemberRole` lets through.
    for (const role of ["EMPLOYEE", "AGENT", "LEAD", "TEAM_ADMIN"]) {
      expect(isEligibleTeamMemberUser(person(role))).toBe(true);
    }
  });
});

/**
 * ⚠️ THE WIRING, WHICH IS THE HALF CARD 1.107 GOT WRONG.
 *
 * Its first test passed while the page showed nothing, because it proved a
 * component could render a value and never that the page supplied one. These
 * pages need the router, several contexts and loaded data to mount, so the
 * wiring is asserted on the source - the same choice, and for the same stated
 * reason, as `ticket-detail-no-container-tooltip.test.tsx`.
 */
describe("no page still swallows a server refusal", () => {
  const source = (file: string) => readFileSync(join(__dirname, file), "utf8");

  /**
   * The catch block that follows `marker`, as CODE.
   *
   * Comments are stripped: each of these blocks now carries a note naming the
   * sentence it used to hard-code, and matching on that would fail the very
   * fix it is checking for.
   */
  function catchAfter(file: string, marker: string): string {
    const text = source(file);
    const at = text.indexOf(marker);
    expect(at, `${marker} not found in ${file}`).toBeGreaterThan(-1);
    const catchAt = text.indexOf("} catch", at);
    return text
      .slice(catchAt, text.indexOf("} finally", catchAt))
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
  }

  const SITES: { file: string; marker: string; name: string }[] = [
    {
      file: "TeamPage.tsx",
      marker: "await addTeamMember(",
      name: "adding a team member",
    },
    {
      file: "TicketDetailPage.tsx",
      marker: "await updateTicket(ticket.id, { followUpAt })",
      name: "setting the follow-up date",
    },
    {
      file: "TicketDetailPage.tsx",
      marker: "await transferTicket(ticket.id, {",
      name: "transferring a ticket",
    },
  ];

  for (const site of SITES) {
    it(`⚠️ ${site.name} shows what the server said`, () => {
      const block = catchAfter(site.file, site.marker);
      // A bare `catch {` cannot even see the error, which is the defect.
      expect(block).not.toMatch(/^\} catch \{/);
      expect(block).toContain("handleApiError(error)");
    });

    it(`${site.name} no longer hard-codes its own sentence`, () => {
      expect(catchAfter(site.file, site.marker)).not.toMatch(/"Unable to /);
    });
  }
});
