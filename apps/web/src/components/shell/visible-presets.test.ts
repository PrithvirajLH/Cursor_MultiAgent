import { describe, expect, it } from "vitest";
import { visiblePresets } from "./visible-presets";
import { SAVED_VIEWS } from "./saved-views";
import { canShareViewWithTeam } from "./can-share-view-with-team";

/**
 * Card 1.53 — a team hides the built-in presets it does not use.
 */
describe("visiblePresets", () => {
  it("⚠️ hides only the ids this team asked to hide", () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. Payroll switching off
    // "SEV1 today" must remove exactly that row and nothing else.
    const hidden = ["p1-today", "awaiting-24h"];
    const shown = visiblePresets(SAVED_VIEWS, hidden);
    expect(shown.map((p) => p.id)).not.toContain("p1-today");
    expect(shown.map((p) => p.id)).not.toContain("awaiting-24h");
    expect(shown).toHaveLength(SAVED_VIEWS.length - 2);
    // Everything else survives, in its original order.
    const expected = SAVED_VIEWS.filter((p) => !hidden.includes(p.id)).map(
      (p) => p.id,
    );
    expect(shown.map((p) => p.id)).toEqual(expected);
  });

  it("⚠️ ignores an id whose preset no longer exists", () => {
    // Preset ids are CODE CONSTANTS, not rows, so a stored id can outlive the
    // preset it named. It must be a no-op: not a ghost row, not a crash, and
    // nothing to clean up when a preset is retired.
    const shown = visiblePresets(SAVED_VIEWS, [
      "a-preset-that-was-renamed",
      "p1-today",
    ]);
    expect(shown).toHaveLength(SAVED_VIEWS.length - 1);
    expect(shown.map((p) => p.id)).not.toContain("p1-today");
  });

  it("shows everything when the team has hidden nothing", () => {
    expect(visiblePresets(SAVED_VIEWS, [])).toHaveLength(SAVED_VIEWS.length);
    expect(visiblePresets(SAVED_VIEWS, undefined)).toHaveLength(
      SAVED_VIEWS.length,
    );
  });

  it("does not mutate the list it was given", () => {
    const before = SAVED_VIEWS.map((p) => p.id);
    visiblePresets(SAVED_VIEWS, ["p1-today"]);
    expect(SAVED_VIEWS.map((p) => p.id)).toEqual(before);
  });

  it("can hide everything, without collapsing to the full list", () => {
    // A team that wants only its own views is a legitimate end state, and an
    // empty result must not be mistaken for "nothing hidden".
    const all = SAVED_VIEWS.map((p) => p.id);
    expect(visiblePresets(SAVED_VIEWS, all)).toEqual([]);
  });
});

/**
 * Card 1.53 — who is offered the "share with my team" checkbox.
 */
describe("canShareViewWithTeam", () => {
  it("⚠️ is not offered to an agent or an employee", () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. Before this card there
    // was no role check anywhere, server or client, so any user could publish a
    // view into every colleague's sidebar.
    expect(canShareViewWithTeam("AGENT", "team-1")).toBe(false);
    expect(canShareViewWithTeam("EMPLOYEE", "team-1")).toBe(false);
    expect(canShareViewWithTeam("LEAD", "team-1")).toBe(false);
  });

  it("is offered to a team admin with a team, and to an owner", () => {
    expect(canShareViewWithTeam("TEAM_ADMIN", "team-1")).toBe(true);
    expect(canShareViewWithTeam("OWNER", "team-1")).toBe(true);
    expect(canShareViewWithTeam("OWNER", null)).toBe(true);
  });

  it("is not offered to a team admin with no resolved team", () => {
    expect(canShareViewWithTeam("TEAM_ADMIN", null)).toBe(false);
  });

  it("is not offered when the role is unknown", () => {
    expect(canShareViewWithTeam(undefined, "team-1")).toBe(false);
  });
});
