import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { TicketRecord } from "../../api/client";
import { RequesterHistoryList } from "./RequesterHistoryList";
import { RequesterHistoryPanel } from "./RequesterHistoryPanel";

const fetchTicketsSpy = vi.fn();
vi.mock("../../api/client", () => ({
  fetchTickets: (...args: unknown[]) => fetchTicketsSpy(...args),
}));

const CURRENT_TICKET_ID = "ticket-current";

function buildTicket(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return {
    id: "ticket-1",
    number: 101,
    displayId: "IS_20260830_101",
    subject: "Printer offline again",
    status: "NEW",
    priority: "SEV3",
    createdAt: "2026-08-30T10:00:00.000Z",
    updatedAt: "2026-08-30T10:00:00.000Z",
    ...overrides,
  } as TicketRecord;
}

function renderList(
  props: Partial<Parameters<typeof RequesterHistoryList>[0]> = {},
) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <RequesterHistoryList
        rows={[]}
        total={0}
        currentTicketId={CURRENT_TICKET_ID}
        requesterId="requester-1"
        loading={false}
        error={false}
        onRetry={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("RequesterHistoryPanel", () => {
  it("renders the header collapsed, with no list and no request", () => {
    fetchTicketsSpy.mockClear();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <RequesterHistoryPanel
            requesterId="requester-1"
            currentTicketId={CURRENT_TICKET_ID}
            expanded={false}
            onToggle={() => {}}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain("Other tickets from this requester");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("No other tickets from this person.");
    expect(fetchTicketsSpy).not.toHaveBeenCalled();
  });
});

describe("RequesterHistoryList", () => {
  it("renders the empty state when the requester has no other tickets", () => {
    const html = renderList({
      rows: [buildTicket({ id: CURRENT_TICKET_ID })],
      total: 1,
    });

    expect(html).toContain("No other tickets from this person.");
    expect(html).not.toContain("IS_20260830_101");
  });

  it("lists the other tickets and leaves out the one being viewed", () => {
    const html = renderList({
      rows: [
        buildTicket({
          id: CURRENT_TICKET_ID,
          displayId: "IS_20260830_999",
          subject: "The ticket being viewed",
        }),
        buildTicket({ id: "ticket-a", displayId: "IS_20260830_101" }),
        buildTicket({
          id: "ticket-b",
          displayId: "IS_20260830_102",
          subject: "Laptop will not charge",
          status: "RESOLVED",
        }),
      ],
      total: 3,
    });

    expect(html).toContain("IS_20260830_101");
    expect(html).toContain("IS_20260830_102");
    expect(html).not.toContain("IS_20260830_999");
    expect(html).toContain('href="/tickets/ticket-a"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Resolved");
    expect(html).not.toContain("See all");
  });

  it("offers the see-all link when the requester has more than five others", () => {
    const rows = [
      buildTicket({ id: CURRENT_TICKET_ID }),
      ...Array.from({ length: 5 }, (_, index) =>
        buildTicket({
          id: `ticket-${index}`,
          displayId: `IS_20260830_20${index}`,
        }),
      ),
    ];
    const html = renderList({ rows, total: 9 });

    expect(html).toContain("See all 8 tickets from this person");
    expect(html).toContain(
      "/tickets?requesterIds=requester-1&amp;statusGroup=all",
    );
  });

  it("renders the retry affordance when the query failed", () => {
    const html = renderList({ error: true });

    // JSX &apos; renders as the &#x27; entity in static markup.
    expect(html).toContain("t load this person");
    expect(html).toContain("s other tickets");
    expect(html).toContain("Try again");
    expect(html).not.toContain("No other tickets from this person.");
  });

  it("renders skeleton rows while loading", () => {
    const html = renderList({ loading: true });

    expect(html).toContain("skeleton-shimmer");
    expect(html).not.toContain("No other tickets from this person.");
  });
});
