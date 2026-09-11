import { describe, expect, it } from "vitest";
import { isUuid, ticketRefFor, ticketUrl } from "./ticket-ref";

const UUID = "7fe5d219-4b3c-4a2f-9f3a-1c2d3e4f5a6b";

describe("isUuid", () => {
  it("recognises a ticket uuid", () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid(UUID.toUpperCase())).toBe(true);
  });

  it("⚠️ does not mistake a display id for one", () => {
    // The whole resolver rests on these two never colliding.
    expect(isUuid("IT-0042")).toBe(false);
    expect(isUuid("PA_20260829_021")).toBe(false);
  });

  it("rejects a near miss rather than guessing", () => {
    expect(isUuid(UUID.slice(0, -1))).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("ticketRefFor / ticketUrl", () => {
  it("⚠️ shares the display id, which is the point of the card", () => {
    expect(
      ticketUrl("https://tickets.example.com", {
        id: UUID,
        displayId: "IT-0042",
      }),
    ).toBe("https://tickets.example.com/tickets/IT-0042");
  });

  it("⚠️ falls back to the uuid when there is no display id", () => {
    // The column is nullable. /tickets/undefined would be worse than ugly.
    expect(
      ticketUrl("https://tickets.example.com", { id: UUID, displayId: null }),
    ).toBe(`https://tickets.example.com/tickets/${UUID}`);
    expect(ticketRefFor({ id: UUID })).toBe(UUID);
  });

  it("treats a blank display id as absent", () => {
    expect(ticketRefFor({ id: UUID, displayId: "   " })).toBe(UUID);
  });

  it("does not double the slash when the origin carries one", () => {
    expect(
      ticketUrl("https://tickets.example.com/", {
        id: UUID,
        displayId: "IT-0042",
      }),
    ).toBe("https://tickets.example.com/tickets/IT-0042");
  });
});
