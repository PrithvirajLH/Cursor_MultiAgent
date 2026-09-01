import { describe, expect, it } from "vitest";
import type { TicketEvent } from "../../api/client";
import { collapseIntakeCreationEvents, formatEventText } from "./utils";

/**
 * Intake writes two creation events at once. On a ticket's own timeline that
 * reads as a duplicate, so the intake row stands in for both. The audit log
 * keeps them separate on purpose, which is why this collapse lives here and not
 * in the shared client.
 */
function event(partial: Partial<TicketEvent> & { type: string }): TicketEvent {
  return {
    id: partial.id ?? `${partial.type}-1`,
    type: partial.type,
    payload: partial.payload ?? null,
    createdAt: partial.createdAt ?? "2026-09-01T16:00:00.000Z",
    createdBy: partial.createdBy ?? {
      id: "u1",
      email: "crichardson@csnhc.com",
      // `User.displayName` is non-nullable, and every creation path falls back to
      // the address when no name is supplied — which is why an intake ticket's
      // timeline shows an email here rather than a name.
      displayName: "crichardson@csnhc.com",
    },
  } as TicketEvent;
}

describe("collapseIntakeCreationEvents", () => {
  it("drops the plain create row when the intake row is present", () => {
    const events = [
      event({ id: "a", type: "TICKET_CREATED", payload: { channel: "API" } }),
      event({
        id: "b",
        type: "TICKET_CREATED_VIA_INTAKE",
        payload: { sourceRef: "PAF-52561", department: "payroll" },
      }),
    ];
    const collapsed = collapseIntakeCreationEvents(events);
    expect(collapsed.map((e) => e.id)).toEqual(["b"]);
  });

  it("leaves a normal ticket's events untouched", () => {
    const events = [
      event({ id: "a", type: "TICKET_CREATED", payload: { channel: "PORTAL" } }),
      event({ id: "b", type: "MESSAGE_ADDED" }),
    ];
    expect(collapseIntakeCreationEvents(events)).toBe(events);
  });

  it("keeps every other event on an intake ticket", () => {
    const events = [
      event({ id: "a", type: "TICKET_CREATED" }),
      event({ id: "b", type: "TICKET_CREATED_VIA_INTAKE" }),
      event({ id: "c", type: "MESSAGE_ADDED" }),
      event({ id: "d", type: "TICKET_STATUS_CHANGED" }),
    ];
    expect(collapseIntakeCreationEvents(events).map((e) => e.id)).toEqual([
      "b",
      "c",
      "d",
    ]);
  });

  it("returns an empty list unchanged", () => {
    expect(collapseIntakeCreationEvents([])).toEqual([]);
  });
});

describe("the surviving intake row carries everything the dropped one did", () => {
  it("names the actor as well as the source and department", () => {
    const text = formatEventText(
      event({
        type: "TICKET_CREATED_VIA_INTAKE",
        payload: { sourceRef: "PAF-52561", department: "payroll" },
      }),
    );
    expect(text).toContain("crichardson@csnhc.com");
    expect(text).toContain("PAF-52561");
    expect(text).toContain("payroll");
  });

  it("still names the actor when the flow sent no reference", () => {
    const text = formatEventText(
      event({ type: "TICKET_CREATED_VIA_INTAKE", payload: {} }),
    );
    expect(text).toContain("crichardson@csnhc.com");
    expect(text).toContain("integration");
  });
});
