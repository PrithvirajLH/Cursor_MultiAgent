import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { downloadAttachment } from "../api/client";
import { messageBodyToHtml } from "../utils/messageBody";

export function MessageBody({
  body,
  className = "",
  invert = false,
}: {
  body: string;
  className?: string;
  /** When true, use light text for dark backgrounds (e.g. own message bubble). */
  invert?: boolean;
}) {
  const html = useMemo(() => messageBodyToHtml(body ?? ""), [body]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(
    null,
  );

  // Hydrate <img data-attachment-id="..."> elements: fetch the attachment via
  // the authed API and swap `src` to a blob URL. Stored body src values (e.g.
  // stale blob: URLs left over from composing) are overridden here.
  useEffect(() => {
    if (!containerRef.current) return;
    const root = containerRef.current;
    const objectUrls: string[] = [];
    let cancelled = false;
    // Cache of attachmentId → blob URL so we don't re-fetch on every re-render
    // when the parent re-applies dangerouslySetInnerHTML (which wipes prior
    // mutations like src).
    const blobUrlByAttachment = new Map<string, string>();

    const onImgClick = (e: Event) => {
      const img = e.currentTarget as HTMLImageElement;
      if (!img.src || img.dataset.attLoaded !== "1") return;
      setLightbox({ src: img.src, alt: img.alt });
    };

    const hydrate = () => {
      const imgs = root.querySelectorAll<HTMLImageElement>(
        "img[data-attachment-id]",
      );
      for (const img of imgs) {
        const id = img.dataset.attachmentId;
        if (!id) continue;
        if (!img.classList.contains("att-hydrated")) {
          img.classList.add(
            "att-hydrated",
            "att-thumb",
            "cursor-zoom-in",
          );
          img.alt = img.alt || "attachment";
          img.title = "Click to view full size";
          // Inline styles so they survive even without the global stylesheet.
          img.style.maxWidth = "min(320px, 100%)";
          img.style.maxHeight = "260px";
          img.style.width = "auto";
          img.style.height = "auto";
          img.style.objectFit = "cover";
          img.style.display = "block";
          img.style.marginTop = "6px";
          img.style.borderRadius = "12px";
          img.style.boxShadow =
            "0 1px 2px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.10)";
          img.style.transition = "filter 120ms ease, transform 120ms ease";
          img.style.background =
            "repeating-conic-gradient(rgba(120,120,120,0.10) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px";
          img.style.minHeight = "44px";
          img.addEventListener("click", onImgClick);
          img.addEventListener("mouseenter", () => {
            img.style.filter = "brightness(0.94)";
          });
          img.addEventListener("mouseleave", () => {
            img.style.filter = "none";
          });
        }
        const cached = blobUrlByAttachment.get(id);
        if (cached) {
          if (img.src !== cached) {
            img.src = cached;
            img.dataset.attLoaded = "1";
          }
          continue;
        }
        if (img.dataset.attLoading === "1") continue;
        img.dataset.attLoading = "1";
        downloadAttachment(id)
          .then((blob) => {
            if (cancelled) return;
            const url = URL.createObjectURL(blob);
            objectUrls.push(url);
            blobUrlByAttachment.set(id, url);
            // Re-query in case React replaced the node
            const current = root.querySelector<HTMLImageElement>(
              `img[data-attachment-id="${id}"]`,
            );
            if (current) {
              current.src = url;
              current.dataset.attLoaded = "1";
              current.style.background = "transparent";
              current.style.minHeight = "";
            }
          })
          .catch(() => {
            if (cancelled) return;
            const current = root.querySelector<HTMLImageElement>(
              `img[data-attachment-id="${id}"]`,
            );
            if (current) current.alt = "attachment failed to load";
          });
      }
    };

    hydrate();
    // dangerouslySetInnerHTML re-applies its content on every parent re-render
    // (React diffs the __html string and replaces the subtree). Use a
    // MutationObserver so we re-hydrate the newly-inserted <img> nodes with
    // the cached blob URL instead of refetching.
    const observer = new MutationObserver(() => hydrate());
    observer.observe(root, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
      root
        .querySelectorAll<HTMLImageElement>("img.att-hydrated")
        .forEach((img) => img.removeEventListener("click", onImgClick));
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [html]);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  if (!html) {
    return (
      <p
        className={`text-sm ${invert ? "text-foreground" : "text-muted-foreground"} ${className}`}
      >
        —
      </p>
    );
  }

  const baseClasses =
    "message-body text-sm max-w-none whitespace-pre-wrap break-words prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0";
  const colorClasses = invert
    ? "text-white prose-invert prose-a:text-sky-200 [&_.mention]:text-white [&_.mention]:bg-transparent"
    : "text-foreground prose prose-invert";

  return (
    <>
      <div
        ref={containerRef}
        className={`${baseClasses} ${colorClasses} ${className}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {lightbox &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={lightbox.alt}
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/85 p-4 backdrop-blur-sm animate-fade-in cursor-zoom-out"
          >
            {/* Top bar */}
            <div
              className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-5 py-4"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="truncate text-sm font-medium text-white/90">
                {lightbox.alt}
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={lightbox.src}
                  download={lightbox.alt || "attachment"}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Download"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                >
                  <Download className="h-[18px] w-[18px]" />
                </a>
                <button
                  type="button"
                  onClick={() => setLightbox(null)}
                  aria-label="Close"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <img
              src={lightbox.src}
              alt={lightbox.alt}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[86vh] max-w-[92vw] cursor-default rounded-xl shadow-2xl ring-1 ring-white/10"
            />
          </div>,
          document.body,
        )}
    </>
  );
}
