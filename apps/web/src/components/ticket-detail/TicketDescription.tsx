import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { LinkifiedText } from "../LinkifiedText";

/**
 * How many lines of description show before it is clamped.
 *
 * A knob, not a law — if agents say three is too tight, change this one number
 * and nothing else.
 */
export const DESCRIPTION_CLAMP_LINES = 3;

/**
 * The clamp itself, as inline style rather than `line-clamp-N`.
 *
 * Tailwind generates only class names it can find as literal text, so
 * `line-clamp-${DESCRIPTION_CLAMP_LINES}` would never be emitted — it works
 * today purely because TicketCreated.tsx happens to use `line-clamp-3`
 * literally. Move the knob to 4 and the clamp would silently stop working.
 * This is what the utility compiles to anyway, and it keeps the knob to one
 * number that cannot rot.
 */
const CLAMP_STYLE = {
  display: "-webkit-box",
  WebkitBoxOrient: "vertical" as const,
  WebkitLineClamp: DESCRIPTION_CLAMP_LINES,
  overflow: "hidden",
};

export type TicketDescriptionProps = {
  /** The description exactly as it will be shown when expanded. */
  text: string;
};

/**
 * The ticket description, clamped to a few lines with a toggle (card 1.39).
 *
 * On a real PAF termination ticket the description ran eleven lines and took
 * ~240px of a ~827px viewport, leaving the conversation ~275px — three messages
 * out of ten. Every line of description was a line taken from the conversation.
 *
 * Clamping is HIDING, never dropping: `whitespace-pre-wrap` stays, the text is
 * passed through untouched, and expanding shows the original
 * character-for-character. The owner asked explicitly to see the raw
 * description, and `stripFacilityFromDescription` was removed for eating lines.
 *
 * Most of those eleven lines are PAF form fields that belong in the sidebar's
 * Custom Fields card and will move there once the Power Automate flow sends
 * `category` + `customFields`. This helps every ticket in the meantime and
 * assumes nothing about that shape.
 */
export function TicketDescription({ text }: TicketDescriptionProps) {
  const [expanded, setExpanded] = useState(false);
  /**
   * Whether the text is actually too tall to show in full.
   *
   * Seeded from hard line breaks and then corrected by measurement. The seed is
   * a sound LOWER bound, not a character-count guess: text containing at least
   * as many newlines as the clamp allows occupies more lines than the clamp,
   * whatever the width. What it misses is a single long line that WRAPS past
   * the clamp, and that is exactly what the measurement below catches — so the
   * toggle is never offered when it is not needed, and never withheld once the
   * component has rendered in a real browser.
   *
   * The seed also matters because the web suite renders through
   * renderToStaticMarkup in a node environment, where no effect runs and no
   * element has a height. Without it the eleven-line case could not be
   * asserted at all.
   */
  const [overflows, setOverflows] = useState(
    () => text.split("\n").length > DESCRIPTION_CLAMP_LINES,
  );
  const textRef = useRef<HTMLSpanElement | null>(null);

  /**
   * Does the text need more room than the clamp allows?
   *
   * Compared against the clamp's TARGET height, computed from the element's own
   * line-height, rather than against its current `clientHeight`. That
   * distinction is the whole correctness of this component: measuring
   * `scrollHeight > clientHeight` is circular, because the element is only
   * clamped when we already believe it overflows. A single long line with no
   * newlines seeded `overflows` false, so no clamp was applied, so scrollHeight
   * equalled clientHeight, so the measurement agreed with the wrong seed
   * forever — a 375-character description rendered at 159px with no toggle.
   *
   * `scrollHeight` is the natural full height of the content in BOTH states
   * (a -webkit-line-clamp element still reports its unclipped height), so this
   * comparison is independent of whether the clamp is currently on.
   */
  const measure = useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
    setOverflows(el.scrollHeight > lineHeight * DESCRIPTION_CLAMP_LINES + 1);
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, text, expanded]);

  // Re-measure on width changes: a description that fits on a wide window can
  // wrap past the clamp on a narrow one.
  useEffect(() => {
    const el = textRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const clamped = !expanded && overflows;

  return (
    <div className="mt-2">
      <span
        ref={textRef}
        // whitespace-pre-wrap stays: the description is line-oriented.
        className="block text-[14px] leading-relaxed text-muted-foreground whitespace-pre-wrap"
        style={clamped ? CLAMP_STYLE : undefined}
      >
        <LinkifiedText text={text} />
      </span>
      {overflows ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="mt-1 rounded text-[12px] font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring/30"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
