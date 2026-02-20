import { memo, type ChangeEvent, type RefObject } from 'react';
import { Paperclip } from 'lucide-react';
import type { TicketDetail, TicketMessage } from '../../api/client';
import { MessageBody } from '../MessageBody';
import { RelativeTime } from '../RelativeTime';
import { initialsFor } from '../../utils/format';
import { formatFileSize } from './utils';

export type TicketConversationProps = {
  ticket: TicketDetail;
  messages: TicketMessage[];
  messagesHasMore: boolean;
  messagesLoading: boolean;
  currentEmail: string;
  messageType: 'PUBLIC' | 'INTERNAL';
  setMessageType: (type: 'PUBLIC' | 'INTERNAL') => void;
  messageBody: string;
  setMessageBody: (body: string) => void;
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
  setMessageBody,
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
  showJumpToLatest,
  onScrollToLatest,
  messageInputRef,
  attachmentInputRef,
  conversationListRef,
}: TicketConversationProps) {
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
        className="max-h-[560px] space-y-4 overflow-y-auto px-4 py-5 sm:px-6"
      >
        {messages.length === 0 && !messagesLoading ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            No messages yet.
          </div>
        ) : null}

        {messages.map((message) => {
          const isCurrentUser = message.author?.email === currentEmail;
          const isInternal = message.type === 'INTERNAL';
          const initials = initialsFor(message.author?.displayName ?? message.author?.email ?? 'U');

          return (
            <div key={message.id} className="animate-fade-in">
              <div className={`flex items-start gap-3 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
                {!isCurrentUser ? (
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-xs font-bold text-slate-700">
                    {initials}
                  </div>
                ) : null}

                <div className={`max-w-[78%] sm:max-w-[70%] ${isCurrentUser ? 'text-right' : 'text-left'}`}>
                  <div className={`mb-1 flex items-center gap-2 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
                    <span className="text-sm font-semibold text-slate-900">
                      {message.author?.displayName ?? message.author?.email ?? 'Unknown'}
                    </span>
                    {isInternal ? (
                      <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                        Internal
                      </span>
                    ) : null}
                    <span className="text-xs text-slate-500">
                      <RelativeTime value={message.createdAt} />
                    </span>
                  </div>

                  <div
                    className={`rounded-2xl border px-4 py-3 text-sm leading-relaxed ${
                      isCurrentUser
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : isInternal
                          ? 'border-amber-200 bg-amber-50 text-slate-900'
                          : 'border-slate-200 bg-white text-slate-900'
                    }`}
                  >
                    <MessageBody body={message.body} />
                  </div>
                </div>

                {isCurrentUser ? (
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-xs font-bold text-white shadow-soft">
                    {initials}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
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

      <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setMessageType('PUBLIC')}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                messageType === 'PUBLIC' ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              Public
            </button>
            {canManage ? (
              <button
                type="button"
                onClick={() => setMessageType('INTERNAL')}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  messageType === 'INTERNAL' ? 'bg-amber-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                Internal
              </button>
            ) : null}
          </div>

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
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {messageSending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>

        <textarea
          ref={messageInputRef}
          value={messageBody}
          onChange={(event) => setMessageBody(event.target.value)}
          placeholder={messageType === 'INTERNAL' ? 'Add an internal note...' : 'Write a reply...'}
          rows={4}
          className="mt-3 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-blue-500"
        />

        {ticket.attachments.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {ticket.attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
              >
                <Paperclip className="h-4 w-4 text-slate-500" />
                <span className="font-semibold">{attachment.fileName}</span>
                <span className="text-slate-400">•</span>
                <span className="text-slate-500">{formatFileSize(attachment.sizeBytes)}</span>
                <button
                  type="button"
                  onClick={() => onAttachmentView(attachment.id)}
                  className="rounded-full p-1 text-blue-600 hover:bg-slate-100 hover:text-blue-700"
                >
                  View
                </button>
                <button
                  type="button"
                  onClick={() => onAttachmentDownload(attachment.id, attachment.fileName)}
                  className="rounded-full p-1 text-blue-600 hover:bg-slate-100 hover:text-blue-700"
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {attachmentError ? <p className="mt-2 text-xs text-rose-600">{attachmentError}</p> : null}
      </div>
    </>
  );
});
