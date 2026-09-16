import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { attachmentCarousel } from "./attachment-carousel";

const img = (id: string) => ({ id, contentType: "image/png" });
const pdf = (id: string) => ({ id, contentType: "application/pdf" });

/** The reported ticket: seven images, several over a megabyte. */
const SEVEN = ["a", "b", "c", "d", "e", "f", "g"].map(img);

/**
 * Card 1.117 — paging through a ticket's images.
 *
 * ⚠️ RAISED BECAUSE CARD 1.116 CHANGED THE VOLUME. Until the mailbox worker
 * started fetching emailed attachments, a ticket carried one or two hand-uploaded
 * files and clicking View on each was fine. One email reply now arrives with
 * seven, and seven clicks with a trip back to the list between each is not.
 */
describe("attachmentCarousel (card 1.117)", () => {
  it("⚠️ steps forward and back through every image", () => {
    // THE ASSERTION THE CARD EXISTS FOR.
    const first = attachmentCarousel(SEVEN, "a");
    expect(first.nextId).toBe("b");
    const middle = attachmentCarousel(SEVEN, "d");
    expect(middle.nextId).toBe("e");
    expect(middle.prevId).toBe("c");
    const last = attachmentCarousel(SEVEN, "g");
    expect(last.prevId).toBe("f");
  });

  it("⚠️ counts IMAGES, not files", () => {
    // A count that promises a seventh picture and then refuses to show it is
    // worse than no count at all.
    const mixed = [img("a"), pdf("doc"), img("b"), img("c")];
    const at = attachmentCarousel(mixed, "a");
    expect(at.total).toBe(3);
    expect(at.index).toBe(0);
    // The PDF is never a stop on the way through.
    expect(at.nextId).toBe("b");
    expect(attachmentCarousel(mixed, "b").nextId).toBe("c");
  });

  it("⚠️ a PDF opened directly is not given a position", () => {
    // It keeps its own View/Download row and the existing "images only" message;
    // it just is not part of the sequence. index -1 is what the UI keys off to
    // hide the arrows entirely.
    const mixed = [img("a"), pdf("doc")];
    const at = attachmentCarousel(mixed, "doc");
    expect(at.index).toBe(-1);
    expect(at.prevId).toBeNull();
    expect(at.nextId).toBeNull();
  });

  it("⚠️ the ends stop rather than wrapping", () => {
    // `null` is what disables the arrow. On seven near-identical photos,
    // wrapping silently to the first is indistinguishable from a dead button.
    expect(attachmentCarousel(SEVEN, "a").prevId).toBeNull();
    expect(attachmentCarousel(SEVEN, "g").nextId).toBeNull();
  });

  it("⚠️ a single image offers no navigation", () => {
    const one = attachmentCarousel([img("only")], "only");
    expect(one.total).toBe(1);
    expect(one.prevId).toBeNull();
    expect(one.nextId).toBeNull();
  });

  it("⚠️ a ticket with no images at all is handled", () => {
    // NON-VACUITY: the list itself must still render, so this must not throw
    // or report a phantom position.
    const none = attachmentCarousel([pdf("a"), pdf("b")], null);
    expect(none.total).toBe(0);
    expect(none.index).toBe(-1);
    expect(none.images).toEqual([]);
  });

  it("⚠️ it only ever returns ids from the list it was given", () => {
    // Card 1.83: the server filters this list per viewer — a file pasted into an
    // internal note is absent from a requester's copy. Constructing or guessing
    // a neighbouring id would ask for files this viewer was not shown.
    const ids = new Set(SEVEN.map((a) => a.id));
    for (const attachment of SEVEN) {
      const at = attachmentCarousel(SEVEN, attachment.id);
      for (const candidate of [at.prevId, at.nextId]) {
        if (candidate !== null) {
          expect(ids.has(candidate)).toBe(true);
        }
      }
    }
    // An id that is not in the list gets no position rather than a guess.
    expect(attachmentCarousel(SEVEN, "not-on-this-ticket").index).toBe(-1);
  });

  it("⚠️ each direction is ONE id, never a range", () => {
    // Card 3.5 writes an audit row per `GET /attachments/:id`, so the log
    // answers "who opened this file". A shape that could hand back a list is a
    // shape somebody preloads from, and the log would then record what the
    // software fetched rather than what a person saw.
    const at = attachmentCarousel(SEVEN, "d");
    expect(Array.isArray(at.nextId)).toBe(false);
    expect(Array.isArray(at.prevId)).toBe(false);
    expect(typeof at.nextId).toBe("string");
  });
});

/**
 * ⚠️ THE PREFETCH RULE, ASSERTED ON THE COMPONENT ITSELF.
 *
 * The pure module above cannot prefetch, but the component could. There is no
 * jsdom in this project — the web tests run in a node environment with
 * `renderToStaticMarkup` — so mounting the panel and clicking Next is not
 * available, and the honest substitute is to hold the source to one fetch site.
 */
describe("the viewer fetches only what the reader opened (card 3.5)", () => {
  const SOURCE = readFileSync(
    join(__dirname, "TicketAttachments.tsx"),
    "utf8",
  );

  it("⚠️ downloadAttachment is called from exactly one place", () => {
    // THE ASSERTION THAT WOULD FAIL IF A PREFETCH WERE ADDED. A lookahead needs
    // a second call site, or a loop around this one.
    const calls = SOURCE.match(/downloadAttachment\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("⚠️ nothing walks the image list fetching as it goes", () => {
    // The other shape a prefetch takes: mapping over `carousel.images` and
    // loading each. `images` is exposed for counting and rendering, not for
    // fetching.
    expect(SOURCE).not.toMatch(/carousel\.images[\s\S]{0,120}downloadAttachment/);
    // Asserted on CODE, not prose: the comment above the fetch deliberately
    // explains why preloading is forbidden, and an earlier run of this very
    // test tripped on its own explanation.
    const withoutComments = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /\/\/.*$/gm,
      "",
    );
    expect(withoutComments).not.toMatch(/prefetch|preload|warm/i);
  });

  it("⚠️ the full-screen viewer is a transient layer", () => {
    // Card 1.76: without `role="dialog"`, Escape reaches TicketDetailPage's
    // window-capture handler first and navigates the ticket away behind the
    // open viewer, and stopPropagation cannot undo it.
    expect(SOURCE).toMatch(/role="dialog"/);
    expect(SOURCE).toMatch(/aria-modal="true"/);
  });
});
