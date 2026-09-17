import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TicketDetail, TicketMessage, UserRef } from "../../api/client";
import { TicketConversation } from "./TicketConversation";
import type { TicketConversationProps } from "./TicketConversation";
import type { RichTextEditorRef } from "../RichTextEditor";

/**
 * Card 1.129, fault A — the owner's question was "how will an agent know that
 * they attached a file? there is no indication apart from number increase on
 * attachment".
 *
 * ⚠️ THIS COULD NOT HAVE BEEN WRITTEN BEFORE 2026-09-16. `listMessages`
 * returned no attachment data at all, and `Attachment.messageId` was NULL on
 * every row until card 1.121 linked it - so there was nothing to render and
 * nothing to render it from.
 */

// MessageBody sanitises through DOMPurify, which needs a real DOM; this suite
// runs in vitest's node environment like the rest of the web tests. The chips
// are what is under test, not the sanitiser.
vi.mock("../MessageBody", () => ({
  // `className` is surfaced because card 1.133 is a fault in what the CALLER
  // passes, not in what MessageBody does with it.
  MessageBody: ({ body, className }: { body: string; className?: string }) => (
    <span data-mb-class={className}>{body}</span>
  ),
}));

const CURRENT = "agent@company.com";

type ConversationMessage = TicketMessage & {
  localStatus?: "sending" | "sent" | "failed";
};

function message(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: "m1",
    body: "Here you go.",
    type: "PUBLIC",
    createdAt: "2026-09-16T10:00:00.000Z",
    author: { id: "u-agent", email: CURRENT, displayName: "Ada Agent" },
    ...overrides,
  } as ConversationMessage;
}

function ticket(): TicketDetail {
  return {
    id: "t-1",
    number: 7,
    displayId: "PA_20260916_007",
    subject: "Missing overtime",
    status: "NEW",
    priority: "SEV3",
    createdAt: "2026-09-16T09:00:00.000Z",
    updatedAt: "2026-09-16T09:00:00.000Z",
    assignee: null,
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

/** The chip row carries a stable attribute so these tests do not read styling. */
function chipRowCount(html: string): number {
  return html.split('data-message-attachments="true"').length - 1;
}

describe("1.129 fault A — a message says which files came with it", () => {
  it("names every file on the message that carried it", () => {
    const html = render({
      messages: [
        message({
          attachments: [
            {
              id: "a-1",
              fileName: "timesheet.pdf",
              contentType: "application/pdf",
              sizeBytes: 20480,
            },
            {
              id: "a-2",
              fileName: "punch-detail.csv",
              contentType: "text/csv",
              sizeBytes: 1024,
            },
          ],
        }),
      ],
    });

    expect(chipRowCount(html)).toBe(1);
    expect(html).toContain("timesheet.pdf");
    expect(html).toContain("punch-detail.csv");
    // The size is the point of the chip as much as the name: it is how an
    // agent tells the file they asked for from a 4 KB signature crop.
    expect(html).toContain("20.0 KB");
    expect(html).toContain("1.0 KB");
  });

  it("renders no row at all when the message carried nothing", () => {
    const html = render({ messages: [message({ attachments: [] })] });

    expect(chipRowCount(html)).toBe(0);
  });

  it("shows nothing for a message stored before attachments were linked", () => {
    // Every row before 2026-09-16 has `messageId = NULL`, so the API sends no
    // `attachments` key at all. An empty chip row here would put a permanent
    // blank strip under most of the conversation's history.
    const html = render({ messages: [message()] });

    expect(chipRowCount(html)).toBe(0);
  });

  it("⚠️ renders a multi-line emailed body through MessageBody once it has an image", () => {
    // Fault B. An emailed reply is multi-line, so it took the raw-text branch -
    // right for the plain body card 1.62 produces, and fatal for a pasted
    // screenshot, whose <img> would have been printed to the agent as markup.
    const emailed = [
      "The error looks like this:",
      "",
      '<img data-attachment-id="a-img" alt="screenshot.png">',
      "",
      "Can you fix it?",
    ].join(String.fromCharCode(10));
    const html = render({ messages: [message({ body: emailed })] });

    // ⚠️ ASSERTED ON THE BRANCH, NOT ON THE MARKUP. `MessageBody` is mocked
    // here (it needs a real DOM for DOMPurify), so what it renders proves
    // nothing - but WHICH branch ran is exactly the bug: the <pre> one prints
    // the body as text, and is what would have shown the agent an <img> tag.
    expect(html).not.toContain("<pre");
  });

  it("keeps the raw-text branch for a multi-line body with no image", () => {
    // Non-vacuity: this is the branch the fix above had to leave alone, and it
    // is what keeps an emailed body's line breaks exactly as they arrived.
    const plain = ["Line one.", "", "Line two."].join(String.fromCharCode(10));
    const html = render({ messages: [message({ body: plain })] });

    expect(html).toContain("<pre");
  });

  it("does not chip an image the body already draws", () => {
    // A pasted screenshot is stored as <img data-attachment-id="..."> and
    // hydrated in place, so it is already on screen. The document beside it is
    // not, and still gets a chip.
    const html = render({
      messages: [
        message({
          body: 'See below. <img data-attachment-id="a-img" alt="screenshot.png">',
          attachments: [
            {
              id: "a-img",
              fileName: "screenshot.png",
              contentType: "image/png",
              sizeBytes: 13307,
            },
            {
              id: "a-doc",
              fileName: "policy.pdf",
              contentType: "application/pdf",
              sizeBytes: 51200,
            },
          ],
        }),
      ],
    });

    // Matched on the chip's own truncating span, not on the bare name: the
    // alt text puts "screenshot.png" in the body too, so a looser assertion
    // would pass with the filter removed.
    expect(chipRowCount(html)).toBe(1);
    expect(html).toContain('truncate">policy.pdf');
    expect(html).not.toContain('truncate">screenshot.png');
  });
});

/**
 * Card 1.133 — the layout half.
 *
 * Card 1.129 sent mixed bodies (a sentence, a pasted screenshot, a signature)
 * to `MessageBody` for the first time, still wearing `flex w-full items-center`
 * — a class written when every body rendered as ONE line. `display:flex` makes
 * each block child a flex ITEM, so the three stacked blocks rendered as three
 * COLUMNS side by side. Measured on a real reply, 2026-09-17.
 */
describe("1.133 — a mixed body renders in normal flow", () => {
  const MIXED = [
    "Yes I am still seeing this error, when I login",
    "",
    '<img data-attachment-id="a-img" alt="image.png">',
    "",
    "Thank you,",
    "Prithviraj Hulgur",
  ].join(String.fromCharCode(10));

  it("⚠️ does not lay text, picture and signature out as a flex row", () => {
    const html = render({ messages: [message({ body: MIXED })] });
    expect(html).not.toContain("flex w-full items-center");
  });

  it("keeps the flex row for an ordinary one-line message", () => {
    // Non-vacuity: this is what the class was written for, and the fix has to
    // leave it alone. A single line has exactly one block to centre.
    const html = render({ messages: [message({ body: "Sure, on it." })] });
    expect(html).toContain("flex w-full items-center");
  });

  it("⚠️ a body still waiting for its picture is not printed as raw text", () => {
    // The pending placeholder arrives over the socket before the file has an
    // id. If `hasInlineImage` did not recognise it, this multi-line body would
    // take the <pre> branch and show the agent the <img> tag itself - the
    // exact fault card 1.129 fixed, returning under a second spelling.
    const pending = [
      "Yes I am still seeing this error, when I login",
      "",
      '<img data-attachment-pending="1" alt="image">',
      "",
      "Thank you,",
    ].join(String.fromCharCode(10));
    const html = render({ messages: [message({ body: pending })] });

    expect(html).not.toContain("<pre");
    expect(html).not.toContain("flex w-full items-center");
  });
});

/**
 * Card 1.137 — a file that arrives live gets its chip without a reload, and a
 * picture still on its way does not get one at all.
 */
describe('1.137 — chips while the message is still settling', () => {
  const PDF = {
    id: 'a-9',
    fileName: 'policy.pdf',
    contentType: 'application/pdf',
    sizeBytes: 4096,
  };

  it('⚠️ a body still showing a placeholder chips nothing', () => {
    // THE FLICKER THIS CARD CHOSE TO REMOVE. `chipAttachments` hides a file
    // the body already draws by finding its id in the body - and card 1.135's
    // placeholder holds no id, so a pasted screenshot would chip for a moment
    // and then vanish as the real <img data-attachment-id> replaced it.
    const pending = [
      'Here is the screenshot.',
      '<img data-attachment-pending="1" alt="image">',
    ].join(String.fromCharCode(10));
    const html = render({
      messages: [message({ body: pending, attachments: [PDF] })],
    });

    expect(chipRowCount(html)).toBe(0);
  });

  it('⚠️ and chips it once the picture has resolved', () => {
    // NON-VACUITY, and the half that proves the suppression is temporary
    // rather than a file quietly lost. The document was never drawn by the
    // body, so once the placeholder is gone it must appear.
    const resolved = [
      'Here is the screenshot.',
      '<img data-attachment-id="a-img" alt="image">',
    ].join(String.fromCharCode(10));
    const html = render({
      messages: [message({ body: resolved, attachments: [PDF] })],
    });

    expect(chipRowCount(html)).toBe(1);
    expect(html).toContain('policy.pdf');
  });

  it('a document on an ordinary live reply chips straight away', () => {
    // The case the card was raised for: no image anywhere, so nothing to wait
    // for.
    const html = render({
      messages: [message({ body: 'Here you go.', attachments: [PDF] })],
    });

    expect(chipRowCount(html)).toBe(1);
  });
});
