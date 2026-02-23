import { memo, type ChangeEvent, type KeyboardEvent, type RefObject } from 'react';
import { Paperclip } from 'lucide-react';
import type { TicketDetail, TicketMessage } from '../../api/client';
import { MessageBody } from '../MessageBody';
import { RelativeTime } from '../RelativeTime';
import { initialsFor } from '../../utils/format';
import { formatFileSize } from './utils';

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
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfCurrent.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  return current.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: startOfCurrent.getFullYear() !== startOfToday.getFullYear() ? 'numeric' : undefined,
  });
}

function getAttachmentScanBadge(scanStatus?: string) {
  if (scanStatus === 'CLEAN') {
    return {
      label: 'Clean',
      tone: 'bg-emerald-100 text-emerald-700',
      canDownload: true,
      blockedReason: null,
    };
  }
  if (scanStatus === 'INFECTED') {
    return {
      label: 'Infected',
      tone: 'bg-rose-100 text-rose-700',
      canDownload: false,
      blockedReason: 'Blocked: file was flagged as infected.',
    };
  }
  if (scanStatus === 'FAILED') {
    return {
      label: 'Scan failed',
      tone: 'bg-amber-100 text-amber-700',
      canDownload: false,
      blockedReason: 'Blocked: attachment scan failed.',
    };
  }
  return {
    label: 'Scan pending',
    tone: 'bg-slate-100 text-slate-700',
    canDownload: false,
    blockedReason: 'Blocked: attachment scan is still pending.',
  };
}

export type TicketConversationProps = {
  ticket: TicketDetail;
  messages: TicketMessage[];
  messagesHasMore: boolean;
  messagesLoading: boolean;
  currentEmail: string;
  messageType: 'PUBLIC' | 'INTERNAL';
  setMessageType: (type: 'PUBLIC' | 'INTERNAL') => void;
  messageBody: string;
  onMessageBodyChange: (body: string) => void;
  onMessageInputBlur: () => void;
  messageSending: boolean;
  canManage: boolean;
  canUpload: boolean;
  onReply: () => void;
  onLoadMore: () => void;
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
  currentEmail,
  messageType,
  setMessageType,
  messageBody,
  onMessageBodyChange,
  onMessageInputBlur,
  messageSending,
  canManage,
  canUpload,
  onReply,
  onLoadMore,
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
  const handleMessageInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (!messageBody.trim() || messageSending) {
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
      .map((user) => user.displayName || user.email || 'Someone');
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
    ? initialsFor(typingLead.displayName || typingLead.email || 'U')
    : 'U';
  const typingLeadLabel = typingLead
    ? typingLead.displayName || typingLead.email || 'Someone'
    : 'Someone';

  return (
    <>
      <div className="px-4 pt-5 sm:px-6">
        {messagesHasMore ? (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={messagesLoading}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            {messagesLoading ? 'Loading...' : '↑ Load older messages'}
          </button>
        ) : null}
      </div>

      <div
        ref={conversationListRef}
        className="max-h-[560px] space-y-1 overflow-y-auto bg-slate-50/70 px-4 py-5 sm:px-6"
      >
        {messages.length === 0 && !messagesLoading ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            No messages yet.
          </div>
        ) : null}

        {messages.map((message, index) => {
          const isCurrentUser = message.author?.email === currentEmail;
          const isInternal = message.type === 'INTERNAL';
          const initials = initialsFor(
            message.author?.displayName ?? message.author?.email ?? 'U',
          );
          const previousMessage = index > 0 ? messages[index - 1] : null;
          const nextMessage = index < messages.length - 1 ? messages[index + 1] : null;

          const previousIsSameSender =
            previousMessage != null &&
            (previousMessage.author?.email ?? null) ===
              (message.author?.email ?? null) &&
            previousMessage.type === message.type &&
            isWithinMinutes(previousMessage.createdAt, message.createdAt, 10);
          const nextIsSameSender =
            nextMessage != null &&
            (nextMessage.author?.email ?? null) === (message.author?.email ?? null) &&
            nextMessage.type === message.type &&
            isWithinMinutes(message.createdAt, nextMessage.createdAt, 10);

          const isGroupStart = !previousIsSameSender;
          const isGroupEnd = !nextIsSameSender;
          const shouldShowDateDivider =
            previousMessage == null ||
            !isSameDay(previousMessage.createdAt, message.createdAt);

          return (
            <div key={message.id} className="animate-fade-in">
              {shouldShowDateDivider ? (
                <div className="my-4 flex items-center justify-center">
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 shadow-sm">
                    {formatConversationDay(message.createdAt)}
                  </span>
                </div>
              ) : null}
              <div
                className={`flex items-end gap-2 py-0.5 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}
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
                  className={`max-w-[82%] sm:max-w-[70%] ${isCurrentUser ? 'text-right' : 'text-left'}`}
                >
                  {isGroupStart ? (
                    <div
                      className={`mb-1 flex items-center gap-2 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}
                    >
                      <span className="text-xs font-semibold text-slate-700">
                        {message.author?.displayName ??
                          message.author?.email ??
                          'Unknown'}
                      </span>
                      {isInternal ? (
                        <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                          Internal
                        </span>
                      ) : null}
                      <span className="text-[11px] text-slate-500">
                        <RelativeTime value={message.createdAt} />
                      </span>
                    </div>
                  ) : (
                    <div
                      className={`mb-1 text-[11px] text-slate-400 ${isCurrentUser ? 'text-right' : 'text-left'}`}
                    >
                      <RelativeTime value={message.createdAt} />
                    </div>
                  )}

                  <div
                    className={`inline-block max-w-full border px-4 py-2.5 text-left text-sm leading-relaxed shadow-sm ${
                      isCurrentUser
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : isInternal
                          ? 'border-amber-200 bg-amber-50 text-slate-900'
                          : 'border-slate-200 bg-white text-slate-900'
                    } ${
                      isCurrentUser
                        ? `${isGroupStart ? 'rounded-tr-2xl' : 'rounded-tr-md'} ${isGroupEnd ? 'rounded-br-2xl' : 'rounded-br-md'} rounded-tl-2xl rounded-bl-2xl`
                        : `${isGroupStart ? 'rounded-tl-2xl' : 'rounded-tl-md'} ${isGroupEnd ? 'rounded-bl-2xl' : 'rounded-bl-md'} rounded-tr-2xl rounded-br-2xl`
                    }`}
                  >
                    <MessageBody body={message.body} invert={isCurrentUser} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {typingText ? (
          <div className="animate-fade-in">
            <div className="flex items-end gap-2 py-1">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 shadow-sm">
                {typingLeadInitials}
              </div>
              <div className="max-w-[82%] text-left sm:max-w-[70%]">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700">
                    {typingLeadLabel}
                  </span>
                  {typingUsers.length > 1 ? (
                    <span className="text-[11px] text-slate-500">
                      +{typingUsers.length - 1} more
                    </span>
                  ) : null}
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-2 shadow-sm">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-duration:900ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:140ms] [animation-duration:900ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:280ms] [animation-duration:900ms]" />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {showJumpToLatest ? (
        <div className="absolute bottom-[108px] left-1/2 -translate-x-1/2">
          <button
            type="button"
            onClick={onScrollToLatest}
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-slate-800"
          >
            Jump to latest ↓
          </button>
        </div>
      ) : null}

      <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          {canManage ? (
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setMessageType('PUBLIC')}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  messageType === 'PUBLIC'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                Public
              </button>
              <button
                type="button"
                onClick={() => setMessageType('INTERNAL')}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  messageType === 'INTERNAL'
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                Internal
              </button>
            </div>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            {canUpload ? (
              <>
                <button
                  type="button"
                  onClick={() => attachmentInputRef.current?.click()}
                  className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
              disabled={!messageBody.trim() || messageSending}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {messageSending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>

        <textarea
          ref={messageInputRef}
          value={messageBody}
          onChange={(event) => onMessageBodyChange(event.target.value)}
          onBlur={onMessageInputBlur}
          onKeyDown={handleMessageInputKeyDown}
          placeholder={messageType === 'INTERNAL' ? 'Add an internal note...' : 'Write a reply...'}
          rows={4}
          className="mt-3 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed outline-none transition focus:bg-white focus:ring-2 focus:ring-blue-500"
        />

        {ticket.attachments.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {ticket.attachments.map((attachment) => {
              const badge = getAttachmentScanBadge(attachment.scanStatus);
              return (
                <div
                  key={attachment.id}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
                >
                  <Paperclip className="h-4 w-4 text-slate-500" />
                  <span className="font-semibold">{attachment.fileName}</span>
                  <span className="text-slate-400">•</span>
                  <span className="text-slate-500">{formatFileSize(attachment.sizeBytes)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.tone}`}>
                    {badge.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => onAttachmentView(attachment.id)}
                    disabled={!badge.canDownload}
                    title={badge.blockedReason ?? 'Open attachment'}
                    className={`rounded-full p-1 ${
                      badge.canDownload
                        ? 'text-blue-600 hover:bg-slate-100 hover:text-blue-700'
                        : 'cursor-not-allowed text-slate-400'
                    }`}
                  >
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => onAttachmentDownload(attachment.id, attachment.fileName)}
                    disabled={!badge.canDownload}
                    title={badge.blockedReason ?? 'Download attachment'}
                    className={`rounded-full p-1 ${
                      badge.canDownload
                        ? 'text-blue-600 hover:bg-slate-100 hover:text-blue-700'
                        : 'cursor-not-allowed text-slate-400'
                    }`}
                  >
                    Download
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        {attachmentError ? <p className="mt-2 text-xs text-rose-600">{attachmentError}</p> : null}
      </div>
    </>
  );
});
