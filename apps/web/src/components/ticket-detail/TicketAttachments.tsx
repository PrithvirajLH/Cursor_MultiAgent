import { useEffect, useState } from "react";
import type { TicketDetail } from "../../api/client";
import { downloadAttachment } from "../../api/client";
import { Maximize2, Paperclip, X } from "lucide-react";

interface TicketAttachmentsProps {
  ticket: TicketDetail;
  onDownloadAttachment: (id: string, fileName: string) => void;
  attachmentError: string | null;
}

export function TicketAttachments({
  ticket,
  onDownloadAttachment,
  attachmentError,
}: TicketAttachmentsProps) {
  const [expandedAttachmentId, setExpandedAttachmentId] = useState<
    string | null
  >(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isFullscreenPreview, setIsFullscreenPreview] = useState(false);

  const expandedAttachment =
    ticket.attachments.find(
      (attachment) => attachment.id === expandedAttachmentId,
    ) ?? null;

  useEffect(() => {
    return () => {
      if (previewUrl) {
        window.URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  async function handleTogglePreview(attachmentId: string) {
    if (expandedAttachmentId === attachmentId) {
      setExpandedAttachmentId(null);
      setPreviewError(null);
      if (previewUrl) {
        window.URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl(null);
      setIsFullscreenPreview(false);
      return;
    }

    setExpandedAttachmentId(attachmentId);
    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const blob = await downloadAttachment(attachmentId);
      if (previewUrl) {
        window.URL.revokeObjectURL(previewUrl);
      }
      const url = window.URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to preview attachment.";
      setPreviewError(message);
    } finally {
      setPreviewLoading(false);
    }
  }

  if (!ticket.attachments.length) {
    return (
      <div
        id="panel-attachments"
        role="tabpanel"
        aria-label="Attachments"
        className="flex flex-1 items-center justify-center px-6 py-8"
      >
        <div className="max-w-md rounded-2xl border border-dashed border-border bg-card px-8 py-10 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white">
            <Paperclip className="h-5 w-5" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">
            No attachments yet
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Files you upload to this ticket will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        id="panel-attachments"
        role="tabpanel"
        aria-label="Attachments"
        className="flex flex-1 flex-col gap-4 px-6 py-5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-white">
              <Paperclip className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Attachments
              </p>
              <p className="text-xs text-muted-foreground">
                {ticket.attachments.length} file
                {ticket.attachments.length > 1 ? "s" : ""} attached.
              </p>
            </div>
          </div>
        </div>

        {attachmentError ? (
          <p className="text-xs text-rose-600">{attachmentError}</p>
        ) : null}

        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {ticket.attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-foreground"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {attachment.fileName}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {(attachment.sizeBytes / 1024).toFixed(1)} KB •{" "}
                    {attachment.contentType}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleTogglePreview(attachment.id)}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800"
                >
                  View
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onDownloadAttachment(attachment.id, attachment.fileName)
                  }
                  className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-semibold text-foreground hover:bg-muted"
                >
                  Download
                </button>
              </div>
            </div>
          ))}
        </div>

        {expandedAttachment ? (
          <div className="relative mt-4 overflow-hidden rounded-2xl border border-border bg-slate-950 text-slate-50 shadow-2xl transition-all">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.22),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(94,234,212,0.18),_transparent_55%)]" />
            <div className="relative flex flex-col gap-4 p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                    Preview
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-50">
                    {expandedAttachment.fileName}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {(expandedAttachment.sizeBytes / 1024).toFixed(1)} KB •{" "}
                    {expandedAttachment.contentType}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onDownloadAttachment(
                        expandedAttachment.id,
                        expandedAttachment.fileName,
                      )
                    }
                    className="rounded-full border border-slate-600 px-3 py-1.5 text-[11px] font-semibold text-slate-100 hover:border-slate-300 hover:text-white"
                  >
                    Download
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsFullscreenPreview(true)}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-600 text-slate-100 hover:border-slate-300 hover:text-white"
                    title="View full screen"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="relative mt-1 flex min-h-[220px] max-h-[420px] items-center justify-center overflow-auto rounded-xl bg-slate-900/60">
                {previewLoading ? (
                  <p className="text-xs text-slate-300">Loading preview…</p>
                ) : previewError ? (
                  <p className="text-xs text-rose-300">{previewError}</p>
                ) : expandedAttachment.contentType.startsWith("image/") &&
                  previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={expandedAttachment.fileName}
                    className="max-h-[360px] w-full max-w-full cursor-zoom-in object-contain"
                    onClick={() => setIsFullscreenPreview(true)}
                  />
                ) : (
                  <p className="text-xs text-slate-400">
                    Inline preview is only available for image attachments. Use
                    Download to open this file.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {isFullscreenPreview && expandedAttachment && previewUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <button
            type="button"
            onClick={() => setIsFullscreenPreview(false)}
            className="absolute right-6 top-6 flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-slate-100 hover:bg-black"
            title="Close full screen"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="max-h-[calc(90vh/var(--ui-zoom))] max-w-[calc(90vw/var(--ui-zoom))] overflow-auto rounded-2xl border border-slate-700 bg-slate-950/80 p-3">
            <img
              src={previewUrl}
              alt={expandedAttachment.fileName}
              className="h-full w-full max-h-[calc(85vh/var(--ui-zoom))] max-w-[calc(85vw/var(--ui-zoom))] object-contain"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
