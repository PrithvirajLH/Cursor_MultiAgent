import {
  memo,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Paperclip, Send, Shield } from "lucide-react";
import type { TicketDetail, TicketMessage } from "../../api/client";
import { MessageBody } from "../MessageBody";
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
  messageInputRef: RefObject<HTMLTextAreaElement | null>;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  conversationListRef: RefObject<HTMLDivElement | null>;
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
}: TicketConversationProps) {
  void ticket;
  void onAttachmentDownload;
  void onAttachmentView;
  const handleMessageInputKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (!messageBody.trim()) {
      return;
    }
    onReply();
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
  const typingLeadLabel = typingLead
    ? typingLead.displayName || typingLead.email || "Someone"
    : "Someone";

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full">
      <div className="shrink-0 px-4 pt-5 sm:px-6">
        {messagesHasMore ? (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={messagesLoading}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            {messagesLoading ? "Loading..." : "↑ Load older messages"}
          </button>
        ) : null}
      </div>

      <div
        ref={conversationListRef}
        className="relative flex-1 overflow-y-auto bg-gradient-to-b from-slate-50 via-slate-50 to-slate-100 px-4 py-5 sm:px-6"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-slate-100/80 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-8 bg-gradient-to-t from-slate-200/80 to-transparent" />
        {messagesError ? (
          <div
            className="relative mx-auto mb-4 max-w-xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-left shadow-sm"
            role="alert"
          >
            <p className="text-sm font-semibold text-amber-950">
              Conversation history unavailable
            </p>
            <p className="mt-1 text-sm text-amber-900">{messagesError}</p>
            <button
              type="button"
              onClick={onRetryLoad}
              className="mt-3 inline-flex rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100"
            >
              Retry loading messages
            </button>
          </div>
        ) : null}
        {messages.length === 0 && !messagesLoading && !messagesError ? (
          <div className="relative mx-auto max-w-xl rounded-xl border border-dashed border-slate-300 bg-white/90 px-4 py-5 text-left text-sm text-slate-600 shadow-sm">
            <p className="font-semibold text-slate-800">
              Start the conversation
            </p>
            <p className="mt-1 text-xs text-slate-500">
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
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm">
                      {formatConversationDay(message.createdAt)}
                    </span>
                  </div>
                ) : null}
                <div
                  className={`flex items-end gap-2 py-0.5 ${isCurrentUser ? "justify-end" : "justify-start"}`}
                >
                  {!isCurrentUser ? (
                    isGroupEnd ? (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 shadow-sm">
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
                        <span className="text-xs font-semibold text-slate-700">
                          {isCurrentUser
                            ? "You"
                            : (message.author?.displayName ??
                              message.author?.email ??
                              "Unknown")}
                        </span>
                        {isInternal ? (
                          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                            Internal
                          </span>
                        ) : null}
                        <span className="flex items-center gap-1 text-[11px] text-slate-500">
                          {formatDate(message.createdAt)}
                          {isCurrentUser && localStatus === "sending" ? (
                            <span className="text-slate-400">…</span>
                          ) : null}
                          {isCurrentUser && localStatus === "sent" ? (
                            <span className="text-xs text-slate-400">✓</span>
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
                          ? "border-slate-700 bg-slate-700 text-slate-50"
                          : isInternal
                            ? "border-amber-200 bg-amber-50 text-slate-900"
                            : "border-slate-200 bg-white text-slate-900"
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
          <div className="mt-2 flex animate-fade-in justify-start px-4 sm:px-6">
            <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 shadow-sm">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-slate-50">
                {typingLeadInitials}
              </div>
              <div className="max-w-[260px] text-left">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold text-slate-800">
                    {typingLeadLabel}
                  </span>
                  {typingUsers.length > 1 ? (
                    <span className="text-[11px] text-slate-500">
                      +{typingUsers.length - 1} more
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-1">
                  <span className="h-1 w-1 animate-pulse rounded-full bg-slate-500" />
                  <span className="h-1 w-1 animate-pulse rounded-full bg-slate-400 [animation-delay:120ms]" />
                  <span className="h-1 w-1 animate-pulse rounded-full bg-slate-300 [animation-delay:240ms]" />
                  <span className="text-[11px] font-medium text-slate-500">
                    typing…
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {showJumpToLatest ? (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2">
          <button
            type="button"
            onClick={onScrollToLatest}
            className="rounded-full border border-slate-200 bg-gradient-to-r from-sky-50 via-white to-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:from-sky-100 hover:to-slate-100"
          >
            Jump to latest ↓
          </button>
        </div>
      ) : null}

      <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-6 sm:px-6 sm:py-7">
        <div className="mx-auto w-full max-w-4xl">
          <div className="flex w-full items-end gap-4">
            <div className="flex max-h-72 flex-1 items-end gap-3 overflow-y-auto rounded-full border border-slate-200 bg-white px-4 py-3 focus-within:border-slate-300">
              <textarea
                ref={messageInputRef}
                value={messageBody}
                onChange={(event) => onMessageBodyChange(event.target.value)}
                onBlur={onMessageInputBlur}
                onKeyDown={handleMessageInputKeyDown}
                placeholder="Type a message…"
                rows={1}
                className="min-h-[44px] flex-1 resize-none overflow-y-hidden border-0 bg-transparent px-2 py-2 text-[14px] text-slate-900 leading-relaxed outline-none placeholder:text-slate-400 focus:outline-none focus:ring-0"
              />

              <div className="flex items-center gap-1.5 text-slate-500">
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
                        ? "border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100"
                        : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
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
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-slate-100"
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
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                  title="Send"
                  aria-label="Send message"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>
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
