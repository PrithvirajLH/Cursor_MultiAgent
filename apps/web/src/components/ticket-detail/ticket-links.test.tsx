import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { TicketLinkRecord } from "../../api/client";
import { TicketLinks, linkLabel, linkReference } from "./TicketLinks";

vi.mock("../../api/client", () => ({
  fetchTickets: vi.fn(),
  linkTicket: vi.fn(),
  unlinkTicket: vi.fn(),
}));

const SECRET_SUBJECT = "Payroll query for Dana Whitfield";

function buildLink(overrides: Partial<TicketLinkRecord> = {}): TicketLinkRecord {
  return {
    id: "link-1",
    type: "RELATED",
    direction: "outgoing",
    createdAt: "2026-09-03T10:00:00.000Z",
    createdBy: { id: "user-1", displayName: "Ada Agent" },
    otherTicket: {
      id: "ticket-2",
      number: 412,
      visible: true,
      deleted: false,
      displayId: "IS_20260903_412",
      subject: "Laptop will not charge",
      status: "NEW",
      priority: "SEV3",
    },
    ...overrides,
  };
}

function render(links: TicketLinkRecord[], canManage = true) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TicketLinks
          ticketId="ticket-1"
          links={links}
          canManage={canManage}
          onChanged={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("linkLabel", () => {
  // One row is stored per relationship, so the inverse has to be derived. These
  // six cases ARE the derivation - if a stored row ever rendered the same text
  // from both ends, two of them would be saying the wrong thing.
  it("reads the same from both ends for RELATED, which is symmetric", () => {
    expect(linkLabel("RELATED", "outgoing")).toBe("Related");
    expect(linkLabel("RELATED", "incoming")).toBe("Related");
  });

  it("inverts DUPLICATE_OF", () => {
    expect(linkLabel("DUPLICATE_OF", "outgoing")).toBe("Duplicate of");
    expect(linkLabel("DUPLICATE_OF", "incoming")).toBe("Duplicated by");
  });

  it("inverts PARENT_OF, so a parent lists children and a child lists its parent", () => {
    expect(linkLabel("PARENT_OF", "outgoing")).toBe("Child");
    expect(linkLabel("PARENT_OF", "incoming")).toBe("Parent");
  });
});

describe("linkReference", () => {
  it("uses the ticket's own id when the reader may open it", () => {
    expect(linkReference(buildLink())).toBe("IS_20260903_412");
  });

  it("falls back to the bare number when the target is not visible", () => {
    // displayId encodes the owning department, which is itself information
    // about a ticket the reader cannot open. The server withholds it; this
    // asserts the component does not invent one.
    const link = buildLink({
      otherTicket: {
        ...buildLink().otherTicket,
        visible: false,
        displayId: null,
        subject: null,
        status: null,
        priority: null,
      },
    });
    expect(linkReference(link)).toBe("#412");
  });
});

describe("TicketLinks", () => {
  it("renders a readable link with its subject and a route to it", () => {
    const html = render([buildLink()]);
    expect(html).toContain("Linked tickets");
    expect(html).toContain("Laptop will not charge");
    expect(html).toContain("/tickets/ticket-2");
  });

  it("does NOT expose the subject of a ticket the reader cannot open", () => {
    // The assertion that matters. The server never sends the subject for an
    // invisible target, and the link still has to appear - hiding it would
    // leave an agent unable to see the ticket was linked at all.
    const html = render([
      buildLink({
        otherTicket: {
          id: "ticket-secret",
          number: 907,
          visible: false,
          deleted: false,
          displayId: null,
          subject: null,
          status: null,
          priority: null,
        },
      }),
    ]);
    expect(html).not.toContain(SECRET_SUBJECT);
    expect(html).toContain("#907");
    expect(html).toContain("you do not have access");
    // and it must not be a link to a ticket that would 403 on open
    expect(html).not.toContain("/tickets/ticket-secret");
  });

  it("marks a soft-deleted target as deleted rather than dropping it", () => {
    const html = render([
      buildLink({
        otherTicket: {
          id: "ticket-gone",
          number: 55,
          visible: false,
          deleted: true,
          displayId: null,
          subject: null,
          status: null,
          priority: null,
        },
      }),
    ]);
    expect(html).toContain("#55");
    expect(html).toContain("deleted");
  });

  it("offers no Link or remove control to someone who cannot write", () => {
    const html = render([buildLink()], false);
    expect(html).not.toContain("Remove the link to");
    expect(html).not.toContain('aria-expanded="false"');
  });

  it("says so plainly when there are no links", () => {
    expect(render([])).toContain("Not linked to any other ticket.");
  });
});
