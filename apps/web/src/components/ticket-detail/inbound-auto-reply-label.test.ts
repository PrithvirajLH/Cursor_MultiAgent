import { describe, expect, it } from "vitest";
import { formatEventText } from "./utils";
import type { TicketEvent } from "../../api/client";

function inboundEvent(payload: Record<string, unknown>): TicketEvent {
  return {
    id: "e1",
    type: "INBOUND_EMAIL_RECEIVED",
    payload,
    createdAt: "2026-09-14T10:00:00.000Z",
    createdBy: { id: "u1", displayName: "Jane Doe", email: "jane@x.com" },
  } as unknown as TicketEvent;
}

/**
 * Card 1.80 — the API withholds the reopen when a machine sent the reply and
 * records `statusChangeSkipped`. Recording it is only half the job: an agent
 * looking at a reply that changed nothing has to be told why.
 */
describe("inbound email timeline label (card 1.80)", () => {
  it("⚠️ says the ticket was deliberately left alone for an autoresponder", () => {
    expect(
      formatEventText(inboundEvent({ statusChangeSkipped: "automated" })),
    ).toBe(
      "Inbound email received — automatic reply, the ticket was left as it was",
    );
  });

  it("⚠️ says nothing extra for an ordinary inbound reply", () => {
    // The non-vacuity half: a label that always explained itself would be
    // wrong on every human reply, which is most of them.
    expect(formatEventText(inboundEvent({ fromEmail: "jane@x.com" }))).toBe(
      "Inbound email received",
    );
  });

  it("ignores an unrecognised skip reason rather than inventing a sentence", () => {
    expect(formatEventText(inboundEvent({ statusChangeSkipped: "???" }))).toBe(
      "Inbound email received",
    );
  });
});
