import { Fragment } from "react";

/**
 * http(s) only, and never a bare `<`, `>` or quote. Two consequences that
 * matter: a `javascript:` or `data:` href can never match, and a description
 * that still carries HTML fragments (an integration writing `.../file<br>`)
 * cannot pull them into the link.
 */
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

/** Punctuation that ends the sentence rather than the URL. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

type TextSegment = {
  readonly value: string;
  readonly href: string | null;
};

type LinkifiedTextProps = {
  readonly text: string;
  /** Extra classes for the anchors; the surrounding text keeps the parent's. */
  readonly linkClassName?: string;
};

/** Drop the characters that trail a URL in prose: "see https://x.com/a." and "(https://x.com/a)". */
function trimUrlEnd(url: string): string {
  const trimmed = url.replace(TRAILING_PUNCTUATION, "");
  const hasUnopenedBracket = trimmed.endsWith(")") && !trimmed.includes("(");
  return hasUnopenedBracket ? trimmed.slice(0, -1) : trimmed;
}

/** Cut the text into alternating plain and link segments, in order. */
function splitOnUrls(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const url = trimUrlEnd(match[0]);
    if (start > cursor) {
      segments.push({ value: text.slice(cursor, start), href: null });
    }
    segments.push({ value: url, href: url });
    // Advance by the trimmed length so stripped punctuation stays as text.
    cursor = start + url.length;
  }
  if (cursor < text.length) {
    segments.push({ value: text.slice(cursor), href: null });
  }
  return segments;
}

/**
 * Render plain text with its URLs clickable.
 *
 * The text is never treated as HTML — every segment is a React text node — so a
 * description written by an outside system (a Power Automate flow, an inbound
 * email) cannot inject markup. The link text is the URL itself: anyone who can
 * email the helpdesk can put a link in a ticket, so the destination stays
 * visible instead of hiding behind friendlier wording.
 *
 * Emits no wrapper element, so the parent keeps control of `whitespace-pre-wrap`
 * and line clamping.
 */
export function LinkifiedText({ text, linkClassName = "" }: LinkifiedTextProps) {
  const segments = splitOnUrls(text);
  return (
    <>
      {segments.map((segment, index) =>
        segment.href === null ? (
          <Fragment key={index}>{segment.value}</Fragment>
        ) : (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            title={segment.href}
            className={`break-words text-primary underline underline-offset-2 transition hover:text-primary/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${linkClassName}`}
          >
            {segment.value}
          </a>
        ),
      )}
    </>
  );
}
