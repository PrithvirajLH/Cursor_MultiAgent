import { describe, expect, it } from "vitest";
import { filterPeople } from "./filterPeople";

const people = [
  { id: "1", displayName: "Ada Lovelace", email: "ada@csnhc.com" },
  { id: "2", displayName: "Grace Hopper", email: "grace@csnhc.com" },
  // The case that matters: no display name, so the raw address IS the name.
  { id: "3", displayName: "tpitts@csnhc.com", email: "tpitts@csnhc.com" },
  { id: "4", displayName: null, email: "nameless@csnhc.com" },
];

/**
 * Card 1.52 — the Add-member list rendered all 111 production users into a
 * 240px box, about four visible, roughly 28 scrolls to the end.
 */
describe("filterPeople", () => {
  it("⚠️ narrows the list as you type", () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK: with no filter at all
    // this returned everything, whatever was typed.
    expect(filterPeople(people, "grace").map((p) => p.id)).toEqual(["2"]);
    expect(filterPeople(people, "a").length).toBeLessThan(people.length);
  });

  it("⚠️ finds an account by EMAIL alone, with no display name", () => {
    // A name-only filter would hide exactly the people somebody is hunting
    // for - `nameless@csnhc.com` has no name to match on.
    expect(filterPeople(people, "nameless").map((p) => p.id)).toEqual(["4"]);
    expect(filterPeople(people, "tpitts").map((p) => p.id)).toEqual(["3"]);
  });

  it("is case-insensitive, both ways round", () => {
    expect(filterPeople(people, "ADA").map((p) => p.id)).toEqual(["1"]);
    expect(filterPeople(people, "lovelace").map((p) => p.id)).toEqual(["1"]);
  });

  it("matches a fragment from the middle, not just the start", () => {
    expect(filterPeople(people, "hopper").map((p) => p.id)).toEqual(["2"]);
    expect(filterPeople(people, "csnhc").length).toBe(4);
  });

  it("returns everyone for an empty or whitespace query", () => {
    expect(filterPeople(people, "")).toHaveLength(4);
    expect(filterPeople(people, "   ")).toHaveLength(4);
  });

  it("returns nothing rather than everything when nothing matches", () => {
    expect(filterPeople(people, "zzzz")).toEqual([]);
  });

  it("does not mutate the list it was given", () => {
    const original = [...people];
    filterPeople(people, "ada");
    expect(people).toEqual(original);
  });
});
