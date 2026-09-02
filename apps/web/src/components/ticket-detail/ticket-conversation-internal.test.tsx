import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  TicketDetail,
  TicketMessage,
  UserRef,
} from "../../api/client";
import { TicketConversation } from "./TicketConversation";
import type { TicketConversationProps } from "./TicketConversation";
import type { RichTextEditorRef } from "../RichTextEditor";

/**
 * Cards 1.37 and 1.38, both of which are invisible to a typecheck.
 *
 * 1.37: an internal note that the author wrote themselves did not look
 * internal. `isCurrentUser` short-circuited ahead of `isInternal`, so the amber
 * treatment was unreachable for your own notes and worked only for other
 * people's — and the `Internal` badge lived inside the group header, so a run
 * of six internal notes carried exactly one marker.
 *
 * 1.38: on an unassigned ticket the composer offered `Public` and the API
 * silently stored `INTERNAL`. Proven in the browser on 2026-09-02: four
 * messages posted with the toggle plainly reading `Public`, all four stored
 * INTERNAL, zero outbox rows.
 */

// MessageBody sanitises through DOMPurify, which needs a real DOM; these tests
// run in vitest's node environment like the rest of the web suite. The bubble's
// styling and markers are what is under test, not the sanitiser.
vi.mock("../MessageBody", () => ({
  MessageBody: ({ body }: { body: string }) => <span>{body}</span>,
}));

const CURRENT = "agent@company.com";
const OTHER = "lead@company.com";

type ConversationMessage = TicketMessage & {
  localStatus?: "sending" | "sent" | "failed";
};

function message(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: "m1",
    body: "A message body.",
    type: "PUBLIC",
    createdAt: "2026-09-02T10:00:00.000Z",
    author: {
      id: "u-agent",
      email: CURRENT,
      displayName: "Ada Agent",
    },
    ...overrides,
  } as ConversationMessage;
}

function ticket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: "t-1",
    number: 7,
    displayId: "IS_20260902_007",
    subject: "Printer offline",
    status: "NEW",
    priority: "SEV3",
    createdAt: "2026-09-02T09:00:00.000Z",
    updatedAt: "2026-09-02T09:00:00.000Z",
    assignee: null,
    ...overrides,
  } as TicketDetail;
}

function render(overrides: Partial<TicketConversationProps> = {}): string {
  const props: TicketConversationProps = {
    ticket: ticket(),
    messages: [],
    messagesHasMore: false,
    messagesLoading: false,
    messagesError: null,
    currentEmail: CURRENT,
    messageType: "PUBLIC",
    setMessageType: () => {},
    messageBody: "",
    onMessageBodyChange: () => {},
    onMessageInputBlur: () => {},
    canManage: true,
    canUpload: true,
    onReply: () => {},
    onLoadMore: () => {},
    onRetryLoad: () => {},
    onAttachmentUpload: () => {},
    onAttachmentDownload: () => {},
    onAttachmentView: () => {},
    attachmentUploading: false,
    attachmentError: null,
    typingUsers: [],
    showJumpToLatest: false,
    messageInputRef: createRef<RichTextEditorRef | null>(),
    attachmentInputRef: createRef<HTMLInputElement | null>(),
    conversationListRef: createRef<HTMLDivElement | null>(),
    users: [] as UserRef[],
    cannedVariables: {},
    onScrollToLatest: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(<TicketConversation {...props} />);
}

/** Counts the per-message internal markers, which carry a stable data attribute. */
function markerCount(html: string): number {
  return html.split('data-internal-marker="true"').length - 1;
}

describe("1.37 — an internal note looks internal to its author", () => {
  it("makes the author's own internal note distinct from their own public one", () => {
    // The bug: isCurrentUser won the ternary outright, so your own internal
    // note rendered as a plain blue sent bubble, identical to a public reply.
    const asPublic = render({
      messages: [message({ id: "p", type: "PUBLIC" })],
    });
    const asInternal = render({
      messages: [message({ id: "i", type: "INTERNAL" })],
    });
    expect(asPublic).not.toEqual(asInternal);
    expect(asInternal).toContain("ring-amber-400");
    expect(asPublic).not.toContain("ring-amber-400");
  });

  it("keeps the sent-bubble shape rather than reordering the ternary", () => {
    // Reordering would have made the author's own note render as a received
    // bubble, costing the left/right distinction the layout depends on.
    const asInternal = render({
      messages: [message({ id: "i", type: "INTERNAL" })],
    });
    expect(asInternal).toContain("bg-primary");
    expect(asInternal).toContain("text-primary-foreground");
  });

  it("marks EVERY message in a grouped run of internal notes", () => {
    // Same author, same type, within five minutes: the grouping predicate
    // collapses these into one run, which used to leave a single badge on the
    // header for all six.
    const run = Array.from({ length: 6 }, (_, index) =>
      message({
        id: `i${index}`,
        type: "INTERNAL",
        body: `Internal note ${index}`,
        createdAt: `2026-09-02T10:0${index}:00.000Z`,
      }),
    );
    const html = render({ messages: run });
    // Prove the run really did collapse into ONE group first, or the count
    // below would pass trivially with six separate single-message groups and
    // assert nothing about the bug.
    expect(html.split(">You<").length - 1).toBe(1);
    expect(markerCount(html)).toBe(6);
  });

  it("still renders another user's internal message amber with the badge", () => {
    // The view that was already correct must not regress.
    const html = render({
      messages: [
        message({
          id: "o",
          type: "INTERNAL",
          author: { id: "u-lead", email: OTHER, displayName: "Lee Lead" },
        }),
      ],
    });
    expect(html).toContain("bg-amber-50");
    expect(html).toContain("Internal");
    expect(markerCount(html)).toBe(1);
  });

  it("leaves public messages unmarked in both views", () => {
    const own = render({ messages: [message({ id: "a", type: "PUBLIC" })] });
    const theirs = render({
      messages: [
        message({
          id: "b",
          type: "PUBLIC",
          author: { id: "u-lead", email: OTHER, displayName: "Lee Lead" },
        }),
      ],
    });
    expect(markerCount(own)).toBe(0);
    expect(markerCount(theirs)).toBe(0);
    expect(own).not.toContain("ring-amber-400");
  });
});

describe("1.38 — the composer stops offering Public where the server refuses it", () => {
  it("shows the internal-only chip and no toggle for a peer agent", () => {
    const html = render({ isPeerAgent: true, isUnassigned: true });
    expect(html).toContain("Internal note only");
    // The toggle is the only control that offers the word "Public" here.
    expect(html).not.toContain("Messages are visible to the requester");
  });

  it("names the way out when the ticket is simply unassigned", () => {
    // "assigned to a teammate" is plainly false on an unassigned ticket, and
    // the sidebar already has a Me button beside Assignee.
    const html = render({ isPeerAgent: true, isUnassigned: true });
    expect(html).toContain("Assign this ticket to yourself");
    expect(html).not.toContain("assigned to a teammate");
  });

  it("keeps the teammate wording when a teammate really is assigned", () => {
    const html = render({ isPeerAgent: true, isUnassigned: false });
    expect(html).toContain("assigned to a teammate");
    expect(html).not.toContain("Assign this ticket to yourself");
  });

  it("leaves the toggle in place for a role the rule does not cover", () => {
    // Scoped to AGENT only: a LEAD on the same unassigned ticket is not a peer
    // agent, so they keep replying publicly.
    const html = render({ isPeerAgent: false, canManage: true });
    expect(html).toContain("Messages are visible to the requester");
    expect(html).not.toContain("Internal note only");
  });
});

describe("1.38 — the bubble reflects what the server stored", () => {
  it("renders a message the server downgraded as internal, not as requested", () => {
    // handleReply now writes serverMessage.type over the optimistic message's
    // own. This asserts the consequence: whatever the composer asked for, a
    // message carrying INTERNAL renders with the marker.
    const html = render({
      messageType: "PUBLIC",
      messages: [
        message({ id: "d", type: "INTERNAL", localStatus: "sent" }),
      ],
    });
    expect(markerCount(html)).toBe(1);
    expect(html).toContain("ring-amber-400");
  });
});

describe("1.28 6c — what actually happened, per message", () => {
  it("reports how many people an email reached", () => {
    const html = render({
      messages: [
        message({
          id: "e",
          type: "PUBLIC",
          delivery: { emailed: 3, refused: 0, internal: false },
        }),
      ],
    });
    expect(html).toContain("emailed to 3");
  });

  it("reports refusals alongside the sends", () => {
    const html = render({
      messages: [
        message({
          id: "r",
          type: "PUBLIC",
          delivery: { emailed: 2, refused: 1, internal: false },
        }),
      ],
    });
    expect(html).toContain("emailed to 2 · 1 refused");
  });

  it("says nothing at all while the outbox has nothing to report", () => {
    // Reports the outbox, not the intent. "emailed to 0" would be a lie in
    // the window before the processor runs, and a label claiming a send that
    // was refused is worse than none, because the agent stops chasing.
    const html = render({
      messages: [
        message({
          id: "p",
          type: "PUBLIC",
          delivery: { emailed: 0, refused: 0, internal: false },
        }),
      ],
    });
    expect(html).not.toContain("data-delivery-label");
  });

  it("leaves an internal note to its own marker, not two warnings", () => {
    // Coexisting with 1.37: the amber marker already says it was not sent.
    const html = render({
      messages: [
        message({
          id: "i",
          type: "INTERNAL",
          delivery: { emailed: 0, refused: 0, internal: true },
        }),
      ],
    });
    expect(html).toContain('data-internal-marker="true"');
    expect(html).not.toContain("data-delivery-label");
  });

  it("renders no label for a message the server said nothing about", () => {
    const html = render({ messages: [message({ id: "n", type: "PUBLIC" })] });
    expect(html).not.toContain("data-delivery-label");
  });
});

describe("the stale reference is gone", () => {
  it("no longer mentions ConversationPane, a file that does not exist", async () => {
    const source = await import("fs/promises").then((fs) =>
      fs.readFile(
        new URL("./TicketConversation.tsx", import.meta.url),
        "utf-8",
      ),
    );
    expect(source).not.toContain("ConversationPane");
  });
});
