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

/** The badge carries its count, so tests read the attribute, not the styling. */
const MARKER = "data-unread-replies=";
/** The red row bar, shared with the detail rail so the two cannot drift. */
const BAR = "shadow-[inset_3px_0_0_0_theme(colors.red.500)]";

describe("card 1.10 — the overdue follow-up badge", () => {
  const BADGE = 'data-follow-up-due="true"';

  it("shows when the follow-up has come due", () => {
    const html = render([
      ticket({ followUpAt: new Date(Date.now() - 60_000).toISOString() }),
    ]);
    expect(html).toContain(BADGE);
    expect(html).toContain("Follow-up");
  });

  it("does not show for one still in the future", () => {
    expect(
      render([
        ticket({ followUpAt: new Date(Date.now() + 86_400_000).toISOString() }),
      ]),
    ).not.toContain(BADGE);
  });

  it("does not show when there is no follow-up at all", () => {
    expect(render([ticket()])).not.toContain(BADGE);
  });

  it("comes off the row, so it survives a reload", () => {
    // Same reasoning as the replied marker: computed on the server row, not
    // from client state, so a refresh does not lose it.
    const html = render([
      ticket({ followUpAt: new Date(Date.now() - 60_000).toISOString() }),
    ]);
    expect(html).toContain("truncate");
    expect(html.split(BADGE)).toHaveLength(2);
  });
});

describe("card 1.138 — the unread-reply indicator", () => {
  /**
   * ⚠️ REWRITTEN, NOT DELETED. This block used to assert the blue "Replied"
   * pill, driven by `awaitingAgentReply` - *"the requester spoke last, so the
   * next move is ours"*. That stayed true after somebody had read the reply,
   * and the owner reported exactly that: *"seen doesn't show up as reply
   * received"*. The question changed from WHOSE MOVE to WHAT IS UNREAD, so the
   * assertions change with it - and the two that were really about the table
   * rather than about card 1.29 are kept verbatim below.
   */
  it("renders the badge and the row bar when replies are unread", () => {
    const html = render([ticket({ unreadReplyCount: 1 })]);
    expect(html).toContain(MARKER);
    expect(html).toContain(BAR);
  });

  it("counts them, so two unread replies do not look like one", () => {
    const html = render([ticket({ unreadReplyCount: 3 })]);
    expect(html).toContain('data-unread-replies="3"');
    expect(html).toContain(">3<");
  });

  it("caps at 9+, so a neglected thread cannot widen the column", () => {
    expect(render([ticket({ unreadReplyCount: 42 })])).toContain(">9+<");
  });

  it("renders nothing at zero", () => {
    const html = render([ticket({ unreadReplyCount: 0 })]);
    expect(html).not.toContain(MARKER);
    expect(html).not.toContain(BAR);
  });

  it("renders nothing when the field is absent", () => {
    // An older API response, or a payload that never carried the field, must
    // not put a red bar on every row.
    expect(render([ticket()])).not.toContain(MARKER);
  });

  it("⚠️ is driven ONLY by the payload, not by the status", () => {
    // KEPT FROM CARD 1.29, because it is about this table rather than about
    // that card. WAITING_ON_REQUESTER with nothing unread is the case that
    // matters: the status still says we are waiting on them, and the row must
    // agree with the messages rather than second-guessing from the status. If
    // someone reimplements this client-side off `status`, this fails.
    const html = render([
      ticket({
        id: "t-waiting",
        status: "WAITING_ON_REQUESTER",
        unreadReplyCount: 0,
      }),
    ]);
    expect(html).not.toContain(MARKER);
  });

  it("marks the unread row and only the unread row", () => {
    const html = render([
      ticket({ id: "t-a", subject: "AAA", unreadReplyCount: 1 }),
      ticket({ id: "t-b", subject: "BBB", unreadReplyCount: 0 }),
    ]);
    expect(html.split(MARKER)).toHaveLength(2);
    // The marker belongs to the unread row, not merely present somewhere on
    // the page. Anchored on the second row's checkbox label rather than on the
    // subject text, which also appears in the first row's own checkbox label.
    const markerAt = html.indexOf(MARKER);
    const secondRowAt = html.indexOf("Select ticket BBB");
    expect(secondRowAt).toBeGreaterThan(-1);
    expect(markerAt).toBeLessThan(secondRowAt);
  });

  it("keeps the subject truncating, so the badge cannot widen the row", () => {
    const html = render([ticket({ unreadReplyCount: 1 })]);
    expect(html).toContain("truncate");
  });

  it("⚠️ the old \"Replied\" pill is gone", () => {
    // The owner asked for it to be replaced, not joined. Two markers about the
    // same conversation, one of which never clears, is the confusion this card
    // exists to remove.
    const html = render([
      ticket({ unreadReplyCount: 1 }),
      ticket({ id: "t-2", unreadReplyCount: 0 }),
    ]);
    expect(html).not.toContain("data-awaiting-agent-reply");
    expect(html).not.toContain(">Replied<");
  });
});
