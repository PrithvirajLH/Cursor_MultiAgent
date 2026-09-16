import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { join } from "path";
import { AttachmentViewer } from "./TicketAttachments";

/**
 * ⚠️ TWO FILES WITH THE SAME NAME, BECAUSE THAT IS THE REAL TICKET.
 * `PA_20260910_381` carries ten attachments and FOUR of them are called
 * `image.png`. A position counter alone cannot say which one is on screen.
 */
const FIRST = {
  id: "att-1",
  fileName: "image.png",
  sizeBytes: 104_755,
  contentType: "image/png",
};
const SECOND = {
  id: "att-2",
  fileName: "image.png",
  sizeBytes: 2_214_592,
  contentType: "image/png",
};

/** Everything a reader can actually SEE: markup with attributes stripped out. */
const visibleText = (html: string) =>
  html.replace(/<[^>]*>/g, " ");

const render = (
  attachment: typeof FIRST,
  over: Partial<Parameters<typeof AttachmentViewer>[0]> = {},
) =>
  renderToStaticMarkup(
    <AttachmentViewer
      attachment={attachment}
      previewUrl="blob:fake"
      loading={false}
      error={null}
      position={{ index: 0, total: 10 }}
      prevId={null}
      nextId="att-2"
      onOpen={() => {}}
      onClose={() => {}}
      onDownload={() => {}}
      {...over}
    />,
  );

/**
 * Card 1.128 — View opens the full-screen viewer, and the small panel is gone.
 *
 * The owner asked for one viewer, not two. Card 1.117 had built the carousel
 * into both an inline panel and a full-screen layer a day earlier; keeping two
 * sets of arrows in step for one job was the cost of that.
 *
 * ⚠️ THE DANGER IN A DELETION IS WHAT GOES WITH IT. The inline panel carried
 * three things the full-screen layer did not — Download, the filename, and the
 * answer for a file that is not an image. Losing any of them silently is how
 * this becomes a regression rather than a simplification.
 */
describe("the full-screen attachment viewer (card 1.128)", () => {
  it("⚠️ shows the filename, not just the position", () => {
    // THE REGRESSION ASSERTION for 2b. With four files called image.png on the
    // real ticket, "1 of 10 images" identifies nothing.
    //
    // ⚠️ ASSERTED ON VISIBLE TEXT, NOT THE MARKUP. The dialog also carries the
    // filename in its `aria-label`, so a plain `toContain` passed even with the
    // visible name deleted - this test was vacuous until an inversion caught it.
    const html = render(FIRST);
    expect(visibleText(html)).toContain("image.png");
    expect(visibleText(html)).toContain("1 of 10 images");
  });

  it("⚠️ the size shown belongs to the image on screen", () => {
    // Two files, same name, different bytes: the only thing that tells them
    // apart. A viewer that showed the first file's details beside the second
    // file's picture would be worse than showing nothing.
    expect(render(FIRST)).toContain("102.3 KB");
    expect(render(SECOND)).toContain("2162.7 KB");
  });

  it("⚠️ Download is reachable from inside the viewer, with the right id", () => {
    // THE REGRESSION ASSERTION for 2a. Without this the only way to save a file
    // becomes "close the viewer, find the row again" — worse than before.
    const onDownload = vi.fn();
    renderToStaticMarkup(
      <AttachmentViewer
        attachment={SECOND}
        previewUrl="blob:fake"
        loading={false}
        error={null}
        position={{ index: 1, total: 10 }}
        prevId="att-1"
        nextId={null}
        onOpen={() => {}}
        onClose={() => {}}
        onDownload={onDownload}
      />,
    );
    // renderToStaticMarkup does not fire handlers, so the wiring is asserted by
    // rendering the label and checking the source passes the right arguments.
    expect(render(SECOND)).toContain("Download");
    const source = readFileSync(join(__dirname, "TicketAttachments.tsx"), "utf8");
    expect(source).toContain("onDownload(attachment.id, attachment.fileName)");
  });

  it("⚠️ it is a transient layer, so Escape does not also navigate the ticket", () => {
    // Card 1.76: TicketDetailPage's Escape handler is on `window` with capture,
    // so it runs BEFORE anything here. `isTransientLayerOpen()` is what makes it
    // stand down, and it looks for exactly this role.
    const html = render(FIRST);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });

  it("arrows disable at the ends rather than silently doing nothing", () => {
    // Asserted on the ATTRIBUTE, not the word: the Tailwind classes carry
    // `disabled:cursor-not-allowed` and would match any substring check.
    expect(render(FIRST)).toContain('disabled=""');
    const middle = render(FIRST, { prevId: "att-0", nextId: "att-2" });
    expect(middle).not.toContain('disabled=""');
  });

  it("⚠️ a single image gets no arrows and no counter", () => {
    // NON-VACUITY: `position: null` is how the parent says "one image", and
    // rendering a counter reading "1 of 1 images" beside two dead arrows would
    // be noise.
    const html = render(FIRST, { position: null });
    expect(html).not.toContain("images");
    expect(html).not.toContain("Previous image");
  });

  it("shows an error in place of the image, not beside it", () => {
    const html = render(FIRST, { error: "Unable to preview attachment.", previewUrl: null });
    expect(html).toContain("Unable to preview attachment.");
    expect(html).not.toContain("<img");
  });
});

/**
 * The rules from the last two days that this rewrite could have quietly undone.
 */
describe("what the rewrite had to preserve (card 1.128)", () => {
  const SOURCE = readFileSync(
    join(__dirname, "TicketAttachments.tsx"),
    "utf8",
  );

  it("⚠️ still exactly one fetch site — card 1.117's no-prefetch rule survives", () => {
    // THE ASSERTION THE CARD SINGLES OUT. Card 3.5 writes an audit row per
    // `GET /attachments/:id`, so the log answers "who opened this file". A
    // lookahead needs a second call site or a loop around this one, and a test
    // that only checked the picture appeared would pass with one present.
    const calls = SOURCE.match(/downloadAttachment\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("⚠️ the inline preview panel is gone, not merely hidden", () => {
    // THE REGRESSION ASSERTION for the card itself. A panel left in the markup
    // behind a flag is two surfaces again, which is the thing being removed.
    expect(SOURCE).not.toContain("isFullscreenPreview");
    expect(SOURCE).not.toContain("Maximize2");
  });

  it("⚠️ View is not offered for a file that cannot be viewed", () => {
    // 2c, and the choice made: HIDE View for non-images. With one surface a PDF
    // would open a black rectangle — the old inline panel had somewhere to put
    // "preview is only available for images" and a dimmed overlay does not. A
    // button that cannot do what it says is card 1.81's team filter again.
    //
    // Asserted against `carousel.images` rather than a content-type check,
    // because that keeps "what is previewable" in one place.
    expect(SOURCE).toMatch(/carousel\.images\.some\([\s\S]{0,80}attachment\.id/);
  });

  it("⚠️ the arrow-key typing guard is still there", () => {
    // A reader typing a reply with the viewer open still owns their arrow keys.
    expect(SOURCE).toContain("isContentEditable");
    expect(SOURCE).toContain("TEXTAREA");
  });

  it("⚠️ Escape closes the viewer outright and clears its state", () => {
    // With one surface there is nothing to fall back to, and leaving previewUrl
    // or previewError behind would show the last image's error over the next
    // file opened.
    expect(SOURCE).toMatch(/event\.key === "Escape"[\s\S]{0,600}closePreview\(\)/);
  });
});
