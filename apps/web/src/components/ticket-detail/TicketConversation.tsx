import {
  memo,
  type ChangeEvent,
  type RefObject,
} from "react";
import { Paperclip, Send, Shield } from "lucide-react";
import type { TicketDetail, TicketMessage, UserRef } from "../../api/client";
import { MessageBody } from "../MessageBody";
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

export type TicketConversationProps = {
  ticket: TicketDetail;
  messages: Array<
    TicketMessage & { localStatus?: "sending" | "sent" | "failed" }
  >;
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
  canUpload: boolean;
  onReply: () => void;
  onLoadMore: () => void;
  onRetryLoad: () => void;
  onAttachmentUpload: (event: ChangeEvent<HTMLInputElement>) => void;
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
  cannedVariables: {
    ticketId?: string;
    ticketSubject?: string;
    requesterName?: string;
  };
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
  canUpload,
  onReply,
  onLoadMore,
  onRetryLoad,
  onAttachmentUpload,
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
}: TicketConversationProps) {
  void ticket;
  void onAttachmentDownload;
  void onAttachmentView;

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
            const isCurrentUser = message.author?.email === currentEmail;
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
                  className={`flex items-end gap-2 py-0.5 ${isCurrentUser ? "justify-end" : "justify-start"}`}
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
                      className={`inline-flex min-h-[32px] items-center max-w-full break-words whitespace-pre-wrap border px-4 py-2.5 text-left text-sm leading-relaxed shadow-sm ${
                        isCurrentUser
                          ? "border-primary bg-primary text-primary-foreground"
                          : isInternal
                            ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                            : "border-border bg-card text-foreground"
                      } ${
                        isCurrentUser
                          ? `${isGroupStart ? "rounded-tr-[20px]" : "rounded-tr-md"} ${isGroupEnd ? "rounded-br-[20px]" : "rounded-br-md"} rounded-tl-[20px] rounded-bl-[20px]`
                          : `${isGroupStart ? "rounded-tl-[20px]" : "rounded-tl-md"} ${isGroupEnd ? "rounded-bl-[20px]" : "rounded-bl-md"} rounded-tr-[20px] rounded-br-[20px]`
                      }`}
                    >
                      {message.body.includes("\n") ? (
                        <pre className="w-full whitespace-pre-wrap break-words text-sm">
                          {message.body}
                        </pre>
                      ) : (
                        <MessageBody
                          body={message.body}
                          invert={isCurrentUser}
                          className="flex w-full items-center"
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </AnimatedList>

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

      <div className="shrink-0 border-t border-border bg-background px-4 py-2 sm:px-6 sm:py-2.5">
        <div className="mx-auto w-full max-w-4xl">
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
            />
            <div className="flex items-center justify-end gap-1.5 border-t border-border bg-card px-3 py-2 text-muted-foreground">
              {canManage ? (
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
                  />
                </>
              ) : null}

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
            </div>
          </div>

          {attachmentError ? (
            <p className="mt-2 text-xs text-rose-300">{attachmentError}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
});
