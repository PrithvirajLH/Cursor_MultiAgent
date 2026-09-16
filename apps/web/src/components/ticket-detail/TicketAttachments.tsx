import { useCallback, useEffect, useState } from "react";
import type { TicketDetail } from "../../api/client";
import { downloadAttachment } from "../../api/client";
import { ChevronLeft, ChevronRight, Paperclip, X } from "lucide-react";
import { attachmentCarousel } from "./attachment-carousel";

interface TicketAttachmentsProps {
  ticket: TicketDetail;
  onDownloadAttachment: (id: string, fileName: string) => void;
  attachmentError: string | null;
}

/** One attachment as the viewer needs it. */
type ViewerAttachment = {
  id: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
};

/**
 * The full-screen attachment viewer (card 1.128).
 *
 * ⚠️ THERE USED TO BE TWO SURFACES AND NOW THERE IS ONE. View opened a small
 * inline panel, which carried its own arrows, filename and Download, and a
 * separate button promoted it to full screen. Two sets of arrows to keep in
 * step, for one job. The owner asked for the big one; the small one is gone.
 *
 * ⚠️ `role="dialog"` IS LOAD-BEARING, NOT DECORATION.
 * `isTransientLayerOpen()` (card 1.76) looks for exactly this, and
 * `TicketDetailPage` registers its Escape handler on `window` with CAPTURE - so
 * without the role, Escape here would navigate the ticket away before the
 * viewer ever saw the key, and `stopPropagation` could not undo it. `aria-modal`
 * is honest: this one really does cover the page, unlike the four anchored
 * popovers card 1.76 was careful not to mislabel.
 *
 * Presentational and exported on purpose: the web tests run in a NODE
 * environment with `renderToStaticMarkup` and no jsdom, so a viewer that could
 * only be reached by clicking could not be tested at all. Same reason
 * `ProfilePopoverPanel` is exported.
 */
export function AttachmentViewer({
  attachment,
  previewUrl,
  loading,
  error,
  position,
  prevId,
  nextId,
  onOpen,
  onClose,
  onDownload,
}: {
  attachment: ViewerAttachment;
  previewUrl: string | null;
  loading: boolean;
  error: string | null;
  position: { index: number; total: number } | null;
  prevId: string | null;
  nextId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  onDownload: (id: string, fileName: string) => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${attachment.fileName}, full screen`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
    >
      {/*
        ⚠️ THE FILENAME IS NOT DECORATION ON THIS TICKET. Four of its ten
        attachments are called `image.png`, so "8 of 10 images" alone cannot tell
        you which file is on screen. The inline panel used to carry the name and
        it went with the panel, so it is carried here instead.
      */}
      <div className="absolute left-6 top-6 right-44 flex flex-col gap-0.5">
        <p className="truncate text-sm font-semibold text-slate-100">
          {attachment.fileName}
        </p>
        <p className="text-[11px] text-slate-400">
          {(attachment.sizeBytes / 1024).toFixed(1)} KB • {attachment.contentType}
        </p>
      </div>

      <div className="absolute right-6 top-6 flex items-center gap-2">
        {/*
          ⚠️ DOWNLOAD HAD TO COME WITH THE PANEL TOO. Without it the only way
          to save a file becomes "close the viewer, find the row again", which is
          worse than what this replaced.
        */}
        <button
          type="button"
          onClick={() => onDownload(attachment.id, attachment.fileName)}
          className="rounded-full border border-slate-600 bg-black/70 px-3 py-1.5 text-[11px] font-semibold text-slate-100 hover:border-slate-300 hover:text-white"
        >
          Download
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-slate-100 hover:bg-black"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {position ? (
        <>
          <button
            type="button"
            onClick={() => prevId && onOpen(prevId)}
            disabled={!prevId}
            aria-label="Previous image"
            className="absolute left-6 flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-slate-100 hover:bg-black disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-black/70"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => nextId && onOpen(nextId)}
            disabled={!nextId}
            aria-label="Next image"
            className="absolute right-6 flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-slate-100 hover:bg-black disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-black/70"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <p className="absolute bottom-6 rounded-full bg-black/70 px-3 py-1 text-[11px] tabular-nums text-slate-200">
            {position.index + 1} of {position.total} images
          </p>
        </>
      ) : null}

      <div className="max-h-[calc(90vh/var(--ui-zoom))] max-w-[calc(90vw/var(--ui-zoom))] overflow-auto rounded-2xl border border-slate-700 bg-slate-950/80 p-3">
        {loading ? (
          <p className="px-8 py-16 text-xs text-slate-300">Loading…</p>
        ) : error ? (
          <p className="px-8 py-16 text-xs text-rose-300">{error}</p>
        ) : previewUrl ? (
          <img
            src={previewUrl}
            alt={attachment.fileName}
            className="h-full w-full max-h-[calc(85vh/var(--ui-zoom))] max-w-[calc(85vw/var(--ui-zoom))] object-contain"
          />
        ) : null}
      </div>
    </div>
  );
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

  const expandedAttachment =
    ticket.attachments.find(
      (attachment) => attachment.id === expandedAttachmentId,
    ) ?? null;

  // Card 1.117. Images only, in the server's order, one id per direction.
  const carousel = attachmentCarousel(
    ticket.attachments,
    expandedAttachmentId,
  );

  useEffect(() => {
    return () => {
      if (previewUrl) {
        window.URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  /**
   * Open one attachment in the preview.
   *
   * ⚠️ ONE FETCH, FOR THE FILE THE PERSON ASKED FOR, AND NEVER A NEIGHBOUR.
   * Card 3.5 makes every `GET /attachments/:id` write an audit row naming the
   * file and the reader, so the log answers "who opened this" after an incident
   * on a desk handling PHI. Preloading the next image would file a row for a
   * picture nobody looked at, and the log would then describe what the software
   * fetched instead of what a person saw. This is the only call to
   * `downloadAttachment` in the component, and a test holds it to that.
   *
   * ⚠️ NO CACHE, DELIBERATELY. Stepping away revokes the object URL and
   * stepping back fetches again, which is the existing revoke-on-change pattern
   * kept exactly as it was. Two consequences, both intended: seven 1-2 MB images
   * never accumulate in memory while somebody holds an arrow key down, and every
   * viewing of a file is one row in the audit log - so a repeat view reads as a
   * repeat view rather than disappearing into a cache.
   */
  const openPreview = useCallback(async (attachmentId: string) => {
    setExpandedAttachmentId(attachmentId);
    setPreviewLoading(true);
    // Per image, not per panel: stepping off a broken file must not leave its
    // error sitting over the next one.
    setPreviewError(null);

    try {
      const blob = await downloadAttachment(attachmentId);
      const url = window.URL.createObjectURL(blob);
      // The effect above revokes whatever this replaces.
      setPreviewUrl(url);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to preview attachment.";
      setPreviewUrl(null);
      setPreviewError(message);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const closePreview = useCallback(() => {
    setExpandedAttachmentId(null);
    setPreviewError(null);
    setPreviewUrl(null);
  }, []);

  function handleTogglePreview(attachmentId: string) {
    if (expandedAttachmentId === attachmentId) {
      closePreview();
      return;
    }
    void openPreview(attachmentId);
  }

  const { prevId, nextId } = carousel;

  /**
   * Keyboard navigation, live only while a preview is open (card 1.117).
   *
   * ⚠️ BOUND ON `document` AND ONLY WHILE THE PREVIEW IS OPEN, which is the
   * scoping choice card 1.117 asks to be stated. Neither page that can host this
   * component binds the arrow keys - `TicketDetailPage` takes r/a/s/Escape and
   * `TicketsPage` takes j/k/x/Enter - so there is nothing to collide with, and
   * the listener does not exist at all when no preview is up.
   *
   * ⚠️ ESCAPE WORKS ONLY BECAUSE THE VIEWER IS A `role="dialog"`.
   * `isTransientLayerOpen()` (card 1.76) looks for exactly that, and
   * `TicketDetailPage` registers its own Escape handler on `window` with
   * CAPTURE - so without the role the page would navigate the ticket away
   * before this listener ever ran, and `stopPropagation` could not undo it.
   *
   * The typing guard mirrors `TicketsPage`: a reader typing a reply with a
   * preview open still owns their arrow keys.
   */
  useEffect(() => {
    if (!expandedAttachmentId) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowRight" && nextId) {
        event.preventDefault();
        void openPreview(nextId);
        return;
      }
      if (event.key === "ArrowLeft" && prevId) {
        event.preventDefault();
        void openPreview(prevId);
        return;
      }
      if (event.key === "Escape") {
        // One surface now, so Escape closes the viewer outright rather than
        // dropping back to an inline panel that no longer exists. `closePreview`
        // clears previewUrl and previewError together - leaving either behind
        // would show the last image's error over the next file opened.
        event.preventDefault();
        closePreview();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [expandedAttachmentId, prevId, nextId, openPreview, closePreview]);

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
                {/*
                  ⚠️ NO View ON A FILE THAT CANNOT BE VIEWED. With one surface,
                  View opens a full-screen viewer - and a PDF or a .docx would
                  open a black rectangle with nothing in it. The old inline panel
                  had somewhere to put "Inline preview is only available for
                  image attachments"; a dimmed overlay does not.

                  A button that cannot do what it says is card 1.81's team filter
                  again, so it is hidden rather than left to disappoint. The row
                  keeps Download, which is the thing that actually works for
                  those files.

                  `carousel.images` is the test, not a second content-type check:
                  the carousel already decides what is previewable, and asking it
                  keeps that decision in one place.
                */}
                {carousel.images.some((image) => image.id === attachment.id) ? (
                  <button
                    type="button"
                    onClick={() => void handleTogglePreview(attachment.id)}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800"
                  >
                    View
                  </button>
                ) : null}
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

      </div>

      {expandedAttachment ? (
        <AttachmentViewer
          attachment={expandedAttachment}
          previewUrl={previewUrl}
          loading={previewLoading}
          error={previewError}
          position={
            carousel.index >= 0 && carousel.total > 1
              ? { index: carousel.index, total: carousel.total }
              : null
          }
          prevId={prevId}
          nextId={nextId}
          onOpen={(id) => void openPreview(id)}
          onClose={closePreview}
          onDownload={onDownloadAttachment}
        />
      ) : null}
    </>
  );
}
