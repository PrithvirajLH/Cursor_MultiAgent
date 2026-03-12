import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TicketDetail } from "../../api/client";
import { TicketConversation } from "./TicketConversation";
import { TicketTimeline } from "./TicketTimeline";

vi.mock("../MessageBody", () => ({
  MessageBody: () => null,
}));

function buildTicket(): TicketDetail {
  return {
    id: "ticket-1",
    number: 101,
    displayId: "T-101",
    subject: "Printer offline",
    description: "The printer is offline.",
    status: "NEW",
    priority: "P3",
    channel: "PORTAL",
    createdAt: "2026-03-10T10:00:00.000Z",
    updatedAt: "2026-03-10T10:00:00.000Z",
    requester: null,
    assignee: null,
    assignedTeam: null,
    category: null,
    followers: [],
    attachments: [],
  };
}

describe("ticket history error states", () => {
  it("shows a conversation load error instead of the empty conversation prompt", () => {
    const html = renderToStaticMarkup(
      <TicketConversation
        ticket={buildTicket()}
        messages={[]}
        messagesHasMore={false}
        messagesLoading={false}
        messagesError="Network request failed"
        currentEmail="agent@example.com"
        messageType="PUBLIC"
        setMessageType={() => {}}
        messageBody=""
        onMessageBodyChange={() => {}}
        onMessageInputBlur={() => {}}
        canManage
        canUpload
        onReply={() => {}}
        onLoadMore={() => {}}
        onRetryLoad={() => {}}
        onAttachmentUpload={() => {}}
        onAttachmentDownload={() => {}}
        onAttachmentView={() => {}}
        attachmentUploading={false}
        attachmentError={null}
        typingUsers={[]}
        showJumpToLatest={false}
        onScrollToLatest={() => {}}
        messageInputRef={{ current: null }}
        attachmentInputRef={{ current: null }}
        conversationListRef={{ current: null }}
      />,
    );

    expect(html).toContain("Conversation history unavailable");
    expect(html).toContain("Retry loading messages");
    expect(html).not.toContain("Start the conversation");
  });

  it("shows a timeline load error instead of the empty timeline state", () => {
    const html = renderToStaticMarkup(
      <TicketTimeline
        events={[]}
        eventsHasMore={false}
        eventsLoading={false}
        eventsError="Network request failed"
        onLoadMore={() => {}}
        onRetryLoad={() => {}}
      />,
    );

    expect(html).toContain("Timeline unavailable");
    expect(html).toContain("Retry loading timeline");
    expect(html).not.toContain("No events yet.");
  });
});
