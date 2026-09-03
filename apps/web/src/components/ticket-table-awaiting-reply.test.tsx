import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { TicketRecord } from "../api/client";
import { TicketTableView } from "./TicketTableView";

/**
 * Card 1.29 Gap B — the queue shows who owes the next move.
 *
 * The marker is driven by `awaitingAgentReply` on the row, which the server
 * computes from the ticket's last public message. That is the point: a badge
 * worked out in the browser would not survive a reload, and a reload is exactly
 * when an agent comes back to the queue to decide who to chase.
 */

vi.mock("../hooks/useToast", () => ({
  useToast: () => ({ show: () => {}, toasts: [], dismiss: () => {} }),
}));

function ticket(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return {
    id: "t-1",
    number: 1,
    displayId: "IS_20260903_001",
    subject: "Cannot reach the VPN",
    status: "IN_PROGRESS",
    priority: "SEV3",
    createdAt: "2026-09-03T09:00:00.000Z",
    updatedAt: "2026-09-03T09:00:00.000Z",
    requester: { id: "u-req", email: "r@company.com", displayName: "Rita Req" },
    ...overrides,
  } as TicketRecord;
}

function render(tickets: TicketRecord[]): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <TicketTableView
        tickets={tickets}
        role="AGENT"
        selection={{
          isSelected: () => false,
          toggle: () => {},
          toggleAll: () => {},
          isAllSelected: false,
        }}
        onRowClick={() => {}}
      />
    </MemoryRouter>,
  );
}

const MARKER = 'data-awaiting-agent-reply="true"';

describe("the awaiting-reply row marker", () => {
  it("renders when the server says the requester spoke last", () => {
    const html = render([ticket({ awaitingAgentReply: true })]);
    expect(html).toContain(MARKER);
    expect(html).toContain("Replied");
  });

  it("does not render when the server says otherwise", () => {
    expect(render([ticket({ awaitingAgentReply: false })])).not.toContain(
      MARKER,
    );
  });

  it("does not render when the field is absent", () => {
    // An older API response, or a payload that never carried the field, must
    // not produce a marker by accident.
    expect(render([ticket()])).not.toContain(MARKER);
  });

  it("is driven ONLY by the payload, not by the status", () => {
    // WAITING_ON_REQUESTER with the flag false is the case that matters: the
    // status still says we are waiting on them, and the marker must agree with
    // the messages rather than second-guessing from the status. If someone
    // reimplements this client-side off `status`, this test fails.
    const html = render([
      ticket({
        id: "t-waiting",
        status: "WAITING_ON_REQUESTER",
        awaitingAgentReply: false,
      }),
    ]);
    expect(html).not.toContain(MARKER);
  });

  it("marks the flagged row and only the flagged row", () => {
    const html = render([
      ticket({ id: "t-a", subject: "AAA", awaitingAgentReply: true }),
      ticket({ id: "t-b", subject: "BBB", awaitingAgentReply: false }),
    ]);
    expect(html.split(MARKER)).toHaveLength(2);
    // The marker belongs to the flagged row, not merely present somewhere on
    // the page. Anchored on the second row's checkbox label rather than on the
    // subject text, which also appears in the first row's own checkbox label.
    const markerAt = html.indexOf(MARKER);
    const secondRowAt = html.indexOf("Select ticket BBB");
    expect(secondRowAt).toBeGreaterThan(-1);
    expect(markerAt).toBeLessThan(secondRowAt);
  });

  it("keeps the subject truncating, so the marker cannot widen the row", () => {
    const html = render([ticket({ awaitingAgentReply: true })]);
    expect(html).toContain("truncate");
  });
});
