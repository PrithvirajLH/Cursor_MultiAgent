/** Elements whose CONTENT is not content. Removed wholesale, tags and all. */
const DISCARDED_ELEMENTS = /<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
/** Tags that end a line of prose when they open or close. */
const BLOCK_TAGS =
  'p|div|tr|li|h[1-6]|blockquote|section|article|header|footer|ul|ol|table|pre|hr|address|figure|fieldset';

/** Named entities worth handling. `&amp;` is deliberately absent - see below. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  middot: '·',
  bull: '•',
  trade: '™',
  copy: '©',
  reg: '®',
};

/**
 * Flatten an HTML email body to readable plain text (card 1.62).
 *
 * ⚠️ WHY THIS EXISTS. Card 1.24's Graph client called its field `bodyText` and
 * filled it from `body.content`, which for anything sent from Outlook is a
 * complete HTML document. The first real reply the worker ever ingested showed
 * an agent 5,325 characters of markup where one sentence should have been -
 * the requester's actual words were about 0.6% of the screen.
 *
 * ⚠️ **THIS IS NOT A SANITISER AND MUST NOT BECOME ONE.** Nothing renders this
 * as HTML - `TicketConversation.tsx` prints bodies as text on purpose, and
 * changing that would inject third-party markup into an authenticated page.
 * There is no injection to defend against here, only noise to remove. If
 * somebody ever does want rendered HTML, that is a different decision needing
 * a real sanitiser, and this function is not it.
 *
 * ⚠️ **It must put block boundaries on their own lines**, and that is load
 * bearing rather than cosmetic. `stripQuotedReply`'s markers are all anchored
 * with `^...$` and the `m` flag, and in a real Outlook reply our own marker
 * arrives as `<p>----- Reply above this line -----</p>`. Until the `</p>`
 * becomes a newline those anchors cannot match, so quote-trimming silently
 * does nothing. Fixing the trimmer without fixing this would look like a fix
 * and change nothing.
 *
 * Deliberately dependency-free: block elements become newlines, `<br>` becomes
 * a newline, `<script>`/`<style>`/`<head>` go with their contents, remaining
 * tags are dropped and entities are decoded. A full HTML parser would be a new
 * dependency in the ingestion path for a job this size.
 *
 * ⚠️ Leading whitespace is stripped per line, because Outlook indents its
 * markup and the indentation is an artefact of the document rather than the
 * sender's intent. The cost is that a `<pre>` block loses its indent - an
 * acceptable trade in email, and noted here so it is a decision rather than a
 * surprise.
 *
 * @param html A message body that may or may not be HTML.
 * @returns Readable text. An empty or falsy input comes back unchanged.
 */
export function htmlToText(html: string): string {
  if (!html) {
    return html;
  }
  let text = html.replace(DISCARDED_ELEMENTS, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  // An unclosed <head> would otherwise leak <meta> noise into the output.
  text = text.replace(/<head\b[^>]*>[\s\S]*$/i, (match) =>
    /<\/head>/i.test(match) ? match : '',
  );
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(new RegExp(`</(?:${BLOCK_TAGS})\\s*>`, 'gi'), '\n');
  text = text.replace(new RegExp(`<(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n');
  // ⚠️ A tag must LOOK like one. `<[^>]*>` would eat "5 < 7 and 9 > 2" whole
  // and silently lose the sentence, so the opener has to be followed by a
  // letter, a slash, `!` or `?`.
  text = text.replace(/<[/!?]?[a-zA-Z][^>]*>/g, '');
  // ⚠️ ENTITIES ARE DECODED AFTER TAGS ARE STRIPPED, and the order is load
  // bearing. A real Outlook reply quotes addresses as `&lt;name@host&gt;`;
  // decoding first would turn those into `<name@host>` and the tag stripper
  // would then eat them as markup. Proved by the real fixture, which keeps
  // both quoted addresses intact.
  text = decodeEntities(text);
  text = text.replace(/\r\n?/g, '\n');
  text = text
    .split('\n')
    .map((line) => line.replace(/[\t  ]+/g, ' ').trim())
    .join('\n');
  // Three or more blank lines is always the document's doing, never the
  // sender's; two is a paragraph break and is kept.
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/**
 * Decode the entities that turn up in mail.
 *
 * ⚠️ `&amp;` is decoded LAST and on its own. Doing it with the others turns
 * `&amp;lt;` into `<` in two passes, which invents markup that the sender
 * wrote as literal text.
 */
function decodeEntities(value: string): string {
  let out = value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === 'amp') {
      return match;
    }
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? safeFromCodePoint(code, match) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? safeFromCodePoint(code, match) : match;
    }
    return NAMED_ENTITIES[lower] ?? match;
  });
  out = out.replace(/&amp;/gi, '&');
  return out;
}

/** A code point, or the original text when it is not one we can render. */
function safeFromCodePoint(code: number, fallback: string): string {
  if (code <= 0 || code > 0x10ffff) {
    return fallback;
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}
