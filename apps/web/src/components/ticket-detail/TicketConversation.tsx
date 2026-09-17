import {
  memo,
  useState,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Loader2, Paperclip, Send, Shield } from "lucide-react";
import type {
  MessageAttachment,
  TicketDetail,
  TicketMessage,
  UserRef,
} from "../../api/client";
import { MessageBody } from "../MessageBody";
import { MessageContextMenu } from "./MessageContextMenu";
import { copyToClipboard } from "../../utils/clipboard";
import {
  RichTextEditor,
  type RichTextEditorRef,
} from "../RichTextEditor";
import { initialsFor, formatDate } from "../../utils/format";
import { AnimatedList } from "../ui/animated-list";

function isSameDay(leftIso: string, rightIso: string) {
  const left = new Date(leftIso);
  const right = new Date(rightIso);
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isWithinMinutes(leftIso: string, rightIso: string, minutes: number) {
  const left = new Date(leftIso).getTime();
  const right = new Date(rightIso).getTime();
  return Math.abs(right - left) <= minutes * 60 * 1000;
}

function formatConversationDay(iso: string) {
  const current = new Date(iso);
  const now = new Date();
  const startOfCurrent = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate(),
  );
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfCurrent.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  return current.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      startOfCurrent.getFullYear() !== startOfToday.getFullYear()
        ? "numeric"
        : undefined,
  });
}

/**
 * What happened to a message's email, in a few muted words (card 1.28, 6c).
 *
 * Null for an internal note: the amber marker card 1.37 puts on every internal
 * bubble already says it is not sent, and two notices side by side read as two
 * competing warnings.
 *
 * ⚠️ CARD 1.73 CORRECTED THIS COMMENT AND THE CODE UNDER IT. It used to say
 * the no-label case was momentary because "with Redis off the processor runs at
 * queue time". That was true of a dev machine and false of production, where
 * there is no Redis and the sweeper runs on a SIXTY-SECOND interval - the same
 * wrong belief card 1.47 had already corrected in `tickets.service.ts`. The
 * effect was that a queued email rendered nothing at all, which reads exactly
 * like an internal note. `pending` was in the API response the whole time and
 * this type simply omitted it.
 */
function deliveryLabel(
  delivery:
    | { emailed: number; refused: number; pending: number; internal: boolean }
    | undefined,
): string | null {
  if (!delivery || delivery.internal) return null;
  const parts: string[] = [];
  if (delivery.emailed > 0) parts.push(`emailed to ${delivery.emailed}`);
  if (delivery.pending > 0) parts.push(`${delivery.pending} queued`);
  if (delivery.refused > 0) parts.push(`${delivery.refused} refused`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * An image drawn inside a body: one that is stored (`data-attachment-id`) or
 * one still being stored (`data-attachment-pending`, card 1.135).
 *
 * ⚠️ BOTH, EVERYWHERE THIS IS ASKED. The raw-text branch below is chosen on
 * this test, and a body that failed it rendered its own `<img>` to the agent as
 * visible markup - the fault card 1.129 had just fixed for the stored spelling
 * would have come straight back for the pending one.
 */
const INLINE_IMAGE_ATTRIBUTE = /data-attachment-(?:id|pending)=/;

/**
 * True when a message body contains only attachment image(s) and no real text —
 * used to render the message without the colored chat bubble (image is the bubble).
 */
function isImageOnlyBody(body: string): boolean {
  if (!body) return false;
  // Card 1.135: a pending placeholder counts, so a picture that arrives alone
  // does not start inside a bubble and then jump out of one when it resolves.
  if (!INLINE_IMAGE_ATTRIBUTE.test(body)) return false;
  // Strip <img> tags and structural break/paragraph tags, then check for leftover text.
  const withoutImgs = body
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<\/?(br|p|div)\b[^>]*>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return withoutImgs.length === 0;
}

/**
 * The files to show as chips under a message (card 1.129, fault A).
 *
 * ⚠️ AN IMAGE ALREADY DRAWN IN THE BODY DOES NOT GET A CHIP. A screenshot
 * pasted in the composer is stored as `<img data-attachment-id="...">` and
 * `MessageBody` hydrates it in place, so the picture is already on screen -
 * a chip beside it would name the same file twice. Everything else gets one:
 * an emailed file, a document, an image the body never referenced.
 *
 * @param message The message being rendered.
 * @returns The attachments that are not already visible in the body.
 */
function chipAttachments(message: ConversationMessage): MessageAttachment[] {
  const attachments = message.attachments ?? [];
  const body = message.body ?? "";
  return attachments.filter(
    (attachment) => !body.includes(`data-attachment-id="${attachment.id}"`),
  );
}

/**
 * The same one-decimal KB the Attachments tab uses, so one file reads
 * identically in both places.
 *
 * @param sizeBytes The stored byte count.
 * @returns A short human-readable size.
 */
function formatAttachmentSize(sizeBytes: number): string {
  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

/**
 * The message shape this component renders.
 *
 * ⚠️ Named rather than repeated inline because card 1.73's menu handlers
 * take it too, and an inline intersection written twice is one edit away from
 * two different shapes.
 */
type ConversationMessage = TicketMessage & {
  localStatus?: "sending" | "sent" | "failed";
};

export type TicketConversationProps = {
  ticket: TicketDetail;
  messages: Array<ConversationMessage>;
  messagesHasMore: boolean;
  messagesLoading: boolean;
  messagesError: string | null;
  currentEmail: string;
  messageType: "PUBLIC" | "INTERNAL";
  setMessageType: (type: "PUBLIC" | "INTERNAL") => void;
  messageBody: string;
  onMessageBodyChange: (body: string) => void;
  onMessageInputBlur: () => void;
  canManage: boolean;
  isPeerAgent?: boolean;
  /**
   * True when the peer-agent restriction is in force because nobody is
   * assigned, rather than because a teammate is. The two need different
   * wording: "assigned to a teammate" is simply false on an unassigned ticket,
   * and the way out is the Me button beside Assignee. Passed in rather than
   * recomputed here so this component keeps knowing nothing about ticket state.
   */
  isUnassigned?: boolean;
  /**
   * The "who does this reach" line (card 1.28), rendered directly above the
   * compose box. A slot rather than the data itself: this component has no
   * business knowing about outbox rows or followers.
   */
  audienceSlot?: ReactNode;
  /** Hide the composer entirely (e.g. a soft-deleted ticket viewed by an owner). */
  readOnly?: boolean;
  canUpload: boolean;
  onReply: () => void;
  onLoadMore: () => void;
  onRetryLoad: () => void;
  onAttachmentUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onPasteFiles?: (items: { file: File; tempId?: string }[]) => void;
  onAttachmentDownload: (id: string, fileName: string) => void;
  onAttachmentView: (id: string) => void;
  attachmentUploading: boolean;
  attachmentError: string | null;
  typingUsers: Array<{
    id: string;
    displayName: string;
    email: string;
  }>;
  showJumpToLatest: boolean;
  onScrollToLatest: () => void;
  messageInputRef: RefObject<RichTextEditorRef | null>;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  conversationListRef: RefObject<HTMLDivElement | null>;
  users: UserRef[];
  /**
   * The ticket a template is applied to (card 1.7).
   *
   * Just the id now. It used to carry `ticketSubject` and `requesterName` for
   * CannedResponsePicker's own client-side substitution, which card 1.7 deleted
   * because it had drifted from the server's key names - so those two fields
   * had no reader left.
   */
  cannedVariables: { ticketId?: string };
  /** Re-read the ticket after a macro's actions changed it. */
  onMacroApplied?: () => void;
  /**
   * Remove a message's content (card 1.11). Absent when the viewer may not
   * remove anything, which hides the control entirely rather than offering one
   * that answers 403.
   */
  onRedactMessage?: (message: TicketMessage) => void;
  /** Whether THIS viewer may remove THIS message. The server decides too. */
  canRedactMessage?: (message: TicketMessage) => boolean;
};

export const TicketConversation = memo(function TicketConversation({
  ticket,
  messages,
  messagesHasMore,
  messagesLoading,
  messagesError,
  currentEmail,
  messageType,
  setMessageType,
  messageBody,
  onMessageBodyChange,
  onMessageInputBlur,
  canManage,
  isPeerAgent = false,
  isUnassigned = false,
  audienceSlot = null,
  readOnly = false,
  canUpload,
  onReply,
  onLoadMore,
  onRetryLoad,
  onAttachmentUpload,
  onPasteFiles,
  onAttachmentDownload,
  onAttachmentView,
  attachmentUploading,
  attachmentError,
  typingUsers,
  showJumpToLatest,
  onScrollToLatest,
  messageInputRef,
  attachmentInputRef,
  conversationListRef,
  users,
  cannedVariables,
  onMacroApplied,
  onRedactMessage,
  canRedactMessage,
}: TicketConversationProps) {
  void ticket;

  // ⚠️ CARD 1.73. The owner asked for the per-message actions on right-click.
  // `messageMenu` holds the pointer position and the message; the same state
  // serves all three openers, because a right-click, the ⋯ button and Shift+F10
  // must reach exactly the same menu - a mouse-only menu would be a step
  // backwards from the link it replaces.
  const [messageMenu, setMessageMenu] = useState<{
    x: number;
    y: number;
    message: ConversationMessage;
  } | null>(null);

  const messageMenuAvailable = (message: ConversationMessage) =>
    !message.redactedAt;

  const canRemoveMessage = (message: ConversationMessage) =>
    Boolean(onRedactMessage && canRedactMessage?.(message) && !message.redactedAt);

  const openMessageMenu = (
    event: { preventDefault: () => void; clientX: number; clientY: number },
    message: ConversationMessage,
  ) => {
    if (!messageMenuAvailable(message)) return;
    event.preventDefault();
    setMessageMenu({ x: event.clientX, y: event.clientY, message });
  };

  // The button and the keyboard route have no pointer coordinates, so the menu
  // opens at the control itself. Without this the menu would appear in the
  // top-left corner for every keyboard user.
  const openMessageMenuFromButton = (
    event: React.MouseEvent<HTMLButtonElement>,
    message: ConversationMessage,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMessageMenu({ x: rect.left, y: rect.bottom, message });
  };

  // Shift+F10 and the Menu key are the standard keyboard route to a context
  // menu, and the reason this card is not mouse-only.
  const handleMessageKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    message: ConversationMessage,
  ) => {
    const isMenuKey =
      event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
    if (!isMenuKey || !messageMenuAvailable(message)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMessageMenu({ x: rect.left, y: rect.bottom, message });
  };

  const copyMessageText = (message: { body: string }) => {
    void copyToClipboard(message.body);
  };

  const typingText = (() => {
    if (typingUsers.length === 0) {
      return null;
    }

    const names = typingUsers
      .slice(0, 2)
      .map((user) => user.displayName || user.email || "Someone");
    if (typingUsers.length === 1) {
      return `${names[0]} is typing...`;
    }
    if (typingUsers.length === 2) {
      return `${names[0]} and ${names[1]} are typing...`;
    }
    return `${names[0]}, ${names[1]}, and ${typingUsers.length - 2} others are typing...`;
  })();
  const typingLead = typingUsers[0];
  const typingLeadInitials = typingLead
    ? initialsFor(typingLead.displayName || typingLead.email || "U")
    : "U";

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full">
      <div className="shrink-0 px-4 pt-5 sm:px-6">
        {messagesHasMore ? (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={messagesLoading}
            className="text-sm font-medium text-primary hover:text-primary/80"
          >
            {messagesLoading ? "Loading..." : "↑ Load older messages"}
          </button>
        ) : null}
      </div>

      <div
        ref={conversationListRef}
        className="relative flex-1 overflow-y-auto bg-background px-4 py-3 sm:px-6"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-background/80 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-8 bg-gradient-to-t from-background/80 to-transparent" />
        {messagesError ? (
          <div
            className="relative mx-auto mb-4 max-w-xl rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-left shadow-sm"
            role="alert"
          >
            <p className="text-sm font-semibold text-amber-300">
              Conversation history unavailable
            </p>
            <p className="mt-1 text-sm text-amber-400/80">{messagesError}</p>
            <button
              type="button"
              onClick={onRetryLoad}
              className="mt-3 inline-flex rounded-lg border border-amber-500/50 bg-amber-950/30 px-3 py-1.5 text-sm font-medium text-amber-300 hover:bg-amber-900/40"
            >
              Retry loading messages
            </button>
          </div>
        ) : null}
        {messages.length === 0 && !messagesLoading && !messagesError ? (
          <div className="relative mx-auto max-w-xl rounded-xl border border-dashed border-border bg-card/90 px-4 py-5 text-left text-sm text-muted-foreground shadow-sm">
            <p className="font-semibold text-foreground">
              Start the conversation
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your first reply will show up here and notify the requester.
            </p>
          </div>
        ) : null}

        <AnimatedList className="relative w-full items-stretch gap-1">
          {messages.map((message, index) => {
            // Case-insensitive match: the optimistic echo uses the login
            // email verbatim, but server-sourced messages (e.g. attachment
            // uploads, which re-fetch rather than echo) may differ only in
            // letter case. A strict === would mis-flag the user's own image
            // as someone else's and left-align it.
            const isCurrentUser =
              !!message.author?.email &&
              !!currentEmail &&
              message.author.email.toLowerCase() === currentEmail.toLowerCase();
            const isInternal = message.type === "INTERNAL";
            const localStatus = message.localStatus;
            const initials = initialsFor(
              message.author?.displayName ?? message.author?.email ?? "U",
            );
            const previousMessage = index > 0 ? messages[index - 1] : null;
            const nextMessage =
              index < messages.length - 1 ? messages[index + 1] : null;

            const previousIsSameSender =
              previousMessage != null &&
              (previousMessage.author?.email ?? null) ===
                (message.author?.email ?? null) &&
              previousMessage.type === message.type &&
              isWithinMinutes(previousMessage.createdAt, message.createdAt, 5);
            const nextIsSameSender =
              nextMessage != null &&
              (nextMessage.author?.email ?? null) ===
                (message.author?.email ?? null) &&
              nextMessage.type === message.type &&
              isWithinMinutes(message.createdAt, nextMessage.createdAt, 5);

            const isGroupStart = !previousIsSameSender;
            const isGroupEnd = !nextIsSameSender;
            const shouldShowDateDivider =
              previousMessage == null ||
              !isSameDay(previousMessage.createdAt, message.createdAt);
            // Image-only messages (just attachment image(s), no real text) render
            // without the colored bubble — the image is the visual element.
            const isImageOnly = isImageOnlyBody(message.body);
            // Card 1.129 fault B: an image drawn INSIDE the body, whether it
            // was pasted in the composer or arrived on an email.
            const hasInlineImage = INLINE_IMAGE_ATTRIBUTE.test(message.body);

            return (
              <div key={message.id}>
                {shouldShowDateDivider ? (
                  <div className="my-4 flex items-center justify-center">
                    <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
                      {formatConversationDay(message.createdAt)}
                    </span>
                  </div>
                ) : null}
                <div
                  onContextMenu={(event) => openMessageMenu(event, message)}
                  onKeyDown={(event) => handleMessageKeyDown(event, message)}
                  className={`group/message flex items-end gap-2 py-0.5 ${isCurrentUser ? "justify-end" : "justify-start"}`}
                >
                  {!isCurrentUser ? (
                    isGroupEnd ? (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-xs font-bold text-foreground shadow-sm">
                        {initials}
                      </div>
                    ) : (
                      <div className="h-9 w-9 shrink-0" />
                    )
                  ) : null}

                  <div
                    className={`max-w-[82%] sm:max-w-[70%] min-w-0 ${isCurrentUser ? "text-right" : "text-left"}`}
                  >
                    {/*
                      The badge below sits inside the isGroupStart header, so a
                      run of six internal notes carried exactly one marker.
                      Grouping requires previousMessage.type === message.type,
                      so a group is never mixed and a per-message marker is
                      always accurate.
                    */}
                    {isInternal ? (
                      <div
                        data-internal-marker="true"
                        className={`mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 ${isCurrentUser ? "justify-end" : "justify-start"}`}
                      >
                        <Shield className="h-3 w-3" />
                        <span>Internal — not sent to the requester</span>
                      </div>
                    ) : null}
                    {isGroupStart ? (
                      <div
                        className={`mb-1 flex items-center gap-2 ${isCurrentUser ? "justify-end" : "justify-start"}`}
                      >
                        <span className="text-xs font-semibold text-foreground">
                          {isCurrentUser
                            ? "You"
                            : (message.author?.displayName ??
                              message.author?.email ??
                              "Unknown")}
                        </span>
                        {isInternal ? (
                          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/30">
                            Internal
                          </span>
                        ) : null}
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          {formatDate(message.createdAt)}
                          {isCurrentUser && localStatus === "sending" ? (
                            <span className="text-muted-foreground">…</span>
                          ) : null}
                          {isCurrentUser && localStatus === "sent" ? (
                            <span className="text-xs text-muted-foreground">✓</span>
                          ) : null}
                          {isCurrentUser && localStatus === "failed" ? (
                            <span className="text-xs text-rose-500">!</span>
                          ) : null}
                        </span>
                      </div>
                    ) : null}

                    <div
                      className={
                        isImageOnly
                          ? // The attachment <img> is display:block, and its
                            // max-width:min(320px,100%) breaks shrink-to-fit
                            // (intrinsic sizing uses the image's natural width,
                            // so the container balloons to the column cap and
                            // the block image is stuck at the left → looks
                            // centered). Keep the container full-width and push
                            // the image to the correct side with auto margin.
                            `max-w-full ${isCurrentUser ? "[&_img]:ml-auto" : "[&_img]:mr-auto"}`
                          : `inline-flex min-h-[32px] items-center max-w-full break-words whitespace-pre-wrap border px-4 py-2.5 text-left text-sm leading-relaxed shadow-sm ${
                              isCurrentUser
                                ? isInternal
                                  ? // Your own internal note. The amber ring
                                    // rides on the sent bubble rather than
                                    // replacing it: reordering this ternary
                                    // instead would make your own notes look
                                    // like someone else's and cost the
                                    // left/right sent-received distinction the
                                    // whole layout depends on.
                                    "border-amber-400 bg-primary text-primary-foreground ring-1 ring-amber-400"
                                  : "border-primary bg-primary text-primary-foreground"
                                : isInternal
                                  ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                                  : "border-border bg-card text-foreground"
                            } ${
                              isCurrentUser
                                ? `${isGroupStart ? "rounded-tr-[20px]" : "rounded-tr-md"} ${isGroupEnd ? "rounded-br-[20px]" : "rounded-br-md"} rounded-tl-[20px] rounded-bl-[20px]`
                                : `${isGroupStart ? "rounded-tl-[20px]" : "rounded-tl-md"} ${isGroupEnd ? "rounded-bl-[20px]" : "rounded-bl-md"} rounded-tr-[20px] rounded-br-[20px]`
                            }`
                      }
                    >
                      {message.redactedAt ? (
                        // Card 1.11. Deliberately still a bubble in
                        // the right place: the conversation keeps its
                        // shape, and a reader can see that something
                        // was here and is not any more.
                        <span className="italic opacity-70">
                          {message.body}
                        </span>
                      ) : !isImageOnly &&
                        !hasInlineImage &&
                        message.body.includes("\n") ? (
                        // ⚠️ CARD 1.129 FAULT B ADDED `hasInlineImage`, AND
                        // WITHOUT IT THE FIX WOULD HAVE SHIPPED BROKEN. An
                        // emailed reply is multi-line, so it took this branch
                        // and rendered as RAW TEXT - which is right for the
                        // plain body card 1.62 produces, and would have printed
                        // the `<img data-attachment-id>` of a pasted screenshot
                        // to the agent as visible markup. The same fault as
                        // fault C, one screen over.
                        <pre className="w-full whitespace-pre-wrap break-words text-sm">
                          {message.body}
                        </pre>
                      ) : (
                        <MessageBody
                          body={message.body}
                          invert={isCurrentUser}
                          // ⚠️ CARD 1.133: `hasInlineImage` DROPS THE FLEX ROW
                          // TOO, and the branch above is why. Card 1.129 sent
                          // mixed bodies - a sentence, a pasted screenshot, a
                          // signature - here for the first time, still wearing
                          // a class written for a body that renders as ONE
                          // line. `display:flex` makes every block child a flex
                          // ITEM, so the three stacked blocks became three
                          // COLUMNS: the sentence, the picture and the
                          // signature side by side, vertically centred.
                          // Measured on a real reply, 2026-09-17.
                          //
                          // `items-center` only ever meant "centre the single
                          // line"; there is nothing to centre once the body has
                          // more than one block, and normal flow is what a
                          // paragraph-image-paragraph body wants.
                          className={
                            isImageOnly || hasInlineImage
                              ? ""
                              : "flex w-full items-center"
                          }
                        />
                      )}
                    </div>
                    {/*
                      Card 1.129 fault A. The owner's question was "how will an
                      agent know that they attached a file? there is no
                      indication apart from number increase on attachment".
                      Under the bubble, on the message that carried them.

                      An image opens in a tab and anything else downloads,
                      which is the split the Attachments tab already makes -
                      both handlers were already passed to this component and
                      had no reader until now.
                    */}
                    {chipAttachments(message).length > 0 ? (
                      <div
                        data-message-attachments="true"
                        className={`mt-1 flex max-w-full flex-wrap gap-1.5 ${
                          isCurrentUser ? "justify-end" : "justify-start"
                        }`}
                      >
                        {chipAttachments(message).map((attachment) => (
                          <button
                            key={attachment.id}
                            type="button"
                            onClick={() =>
                              attachment.contentType.startsWith("image/")
                                ? onAttachmentView(attachment.id)
                                : onAttachmentDownload(
                                    attachment.id,
                                    attachment.fileName,
                                  )
                            }
                            title={`${attachment.fileName} — ${formatAttachmentSize(attachment.sizeBytes)}`}
                            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-foreground shadow-sm transition-colors hover:border-primary hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <Paperclip className="h-3 w-3 shrink-0" />
                            <span className="max-w-[180px] truncate">
                              {attachment.fileName}
                            </span>
                            <span className="shrink-0 text-muted-foreground">
                              {formatAttachmentSize(attachment.sizeBytes)}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {/*
                      Card 1.11, and card 1.73 moved its conclusion without
                      discarding its reasoning. The note here said the control
                      sits UNDER the bubble because a control layered over the
                      text would cover the very words somebody is deciding
                      about. That is still right - and a context menu answers it
                      better than a permanent link did, because it opens at the
                      pointer and closes again. The link became a ⋯ button so
                      the menu has an opener that is not a right-click: a
                      right-click alone is unreachable by keyboard and by touch.
                      It keeps `focus:opacity-100` for the same reason 1.11 gave
                      - without it the only way to reach this is a mouse.
                    */}
                    {messageMenuAvailable(message) ? (
                      <button
                        type="button"
                        onClick={(event) => openMessageMenuFromButton(event, message)}
                        aria-label="Message actions"
                        aria-haspopup="menu"
                        className={`mt-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover/message:opacity-100 ${
                          isCurrentUser ? "text-right" : "text-left"
                        }`}
                      >
                        ⋯
                      </button>
                    ) : null}
                    {deliveryLabel(message.delivery) ? (
                      <div
                        data-delivery-label="true"
                        className={`mt-0.5 text-[10px] text-muted-foreground ${isCurrentUser ? "text-right" : "text-left"}`}
                      >
                        {deliveryLabel(message.delivery)}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </AnimatedList>
        {/*
          ⚠️ CARD 1.73. One menu for the whole list rather than one per bubble:
          only ever one is open, and rendering hundreds of closed menus is the
          kind of thing that makes a long conversation scroll badly.
        */}
        {messageMenu ? (
          <MessageContextMenu
            x={messageMenu.x}
            y={messageMenu.y}
            message={messageMenu.message}
            canRemove={canRemoveMessage(messageMenu.message)}
            onCopy={copyMessageText}
            onRemove={(message) => {
              const full = messages.find((row) => row.id === message.id);
              if (full && onRedactMessage) onRedactMessage(full);
            }}
            onClose={() => setMessageMenu(null)}
          />
        ) : null}

        {typingText ? (
          <div className="mt-1 flex animate-fade-in items-end gap-2 justify-start">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-xs font-bold text-foreground shadow-sm">
              {typingLeadInitials}
            </div>
            <div className="inline-flex items-center gap-[5px] rounded-full bg-card border border-border px-3.5 py-2.5 shadow-sm">
              <span className="h-[6px] w-[6px] rounded-full bg-muted-foreground/60 animate-bounce [animation-duration:1s]" />
              <span className="h-[6px] w-[6px] rounded-full bg-muted-foreground/60 animate-bounce [animation-duration:1s] [animation-delay:150ms]" />
              <span className="h-[6px] w-[6px] rounded-full bg-muted-foreground/60 animate-bounce [animation-duration:1s] [animation-delay:300ms]" />
            </div>
          </div>
        ) : null}
      </div>

      {showJumpToLatest ? (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2">
          <button
            type="button"
            onClick={onScrollToLatest}
            className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm hover:bg-muted"
          >
            Jump to latest ↓
          </button>
        </div>
      ) : null}

      {readOnly ? null : (
      <div className="shrink-0 border-t border-border bg-background px-4 py-2 sm:px-6 sm:py-2.5">
        <div className="mx-auto w-full max-w-4xl">
          {/*
            Height is reserved so the line appearing after its fetch does not
            resize the composer under the agent's cursor. The footer is
            bottom-anchored, so growing it moves the message list rather than
            the box being typed in.
          */}
          <div className="min-h-[20px]">{audienceSlot}</div>
          <div
            className="w-full overflow-hidden rounded-xl border border-border focus-within:border-primary/50"
            onBlur={onMessageInputBlur}
          >
            <RichTextEditor
              ref={messageInputRef}
              value={messageBody}
              onChange={onMessageBodyChange}
              onSubmit={messageBody.trim() ? onReply : undefined}
              placeholder="Type a message… (use @ to mention someone)"
              users={users}
              cannedVariables={cannedVariables}
              onMacroApplied={onMacroApplied}
              onPasteFiles={canUpload ? onPasteFiles : undefined}
            />
            <div className="flex items-center justify-end gap-1.5 border-t border-border bg-card px-3 py-2 text-muted-foreground">
              {isPeerAgent ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-400"
                  title={
                    isUnassigned
                      ? "Assign this ticket to yourself to reply to the requester. Until then anything you write is an internal note."
                      : "You can only leave internal notes on tickets assigned to a teammate. The requester will not see this message."
                  }
                >
                  <Shield className="h-3.5 w-3.5" />
                  <span>Internal note only</span>
                </span>
              ) : canManage ? (
                <button
                  type="button"
                  onClick={() =>
                    setMessageType(
                      messageType === "PUBLIC" ? "INTERNAL" : "PUBLIC",
                    )
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    messageType === "PUBLIC"
                      ? "border-border bg-muted text-foreground hover:bg-muted/80"
                      : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20"
                  }`}
                  title={
                    messageType === "PUBLIC"
                      ? "Messages are visible to the requester"
                      : "Messages are internal and only visible to your team"
                  }
                  aria-label={
                    messageType === "PUBLIC"
                      ? "Sending public replies"
                      : "Sending internal notes"
                  }
                >
                  <Shield className="h-3.5 w-3.5" />
                  <span>
                    {messageType === "PUBLIC" ? "Public" : "Internal"}
                  </span>
                </button>
              ) : null}

              {canUpload ? (
                <>
                  <button
                    type="button"
                    onClick={() => attachmentInputRef.current?.click()}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"
                    title="Attach file"
                    aria-label="Attach file"
                  >
                    <Paperclip className="h-5 w-5" />
                  </button>
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    multiple
                    className="sr-only"
                    onChange={onAttachmentUpload}
                    disabled={attachmentUploading}
                    aria-label="Attach files to this ticket"
                  />
                </>
              ) : null}

              {attachmentUploading ? (
                <span
                  className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-muted-foreground"
                  aria-live="polite"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading…
                </span>
              ) : (
                <button
                  type="button"
                  onClick={onReply}
                  disabled={!messageBody.trim()}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  title="Send"
                  aria-label="Send message"
                >
                  <Send className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>

          {attachmentError ? (
            <p className="mt-2 text-xs text-rose-300">{attachmentError}</p>
          ) : null}
        </div>
      </div>
      )}
    </div>
  );
});
