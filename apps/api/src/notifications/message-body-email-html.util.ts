import { containsHtmlMarkup } from './contains-html-markup.util';

/** Elements whose CONTENT is not content. Removed wholesale, tags and all. */
const DISCARDED_ELEMENTS =
  /<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
/** A tag, with `>` inside a quoted attribute value not ending it. */
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
/** Formatting that survives to the recipient, emitted WITHOUT its attributes. */
const KEPT_TAGS = new Set([
  'p',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'blockquote',
]);
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const ALT = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
/** The composer's marker, and card 1.129's inbound one - the same attribute. */
const ATTACHMENT_ID = /\bdata-attachment-id\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
/** Anything that is not a link a mail client should follow. */
const SAFE_LINK_SCHEME = /^(?:https?:\/\/|mailto:)/i;
/** `&` that is not already the start of an entity. */
const BARE_AMPERSAND = /&(?!#?[a-zA-Z0-9]+;)/g;

/** Escape a text node without double-encoding the entities already in it. */
function escapeText(value: string): string {
  return value
    .replace(BARE_AMPERSAND, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape a value going inside a double-quoted attribute. */
function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The whole plain-text path, unchanged from what card 1.34 shipped. */
function renderPlainText(body: string): string {
  return body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br />');
}

/** A link, or nothing at all when its scheme is not one worth following. */
function renderAnchor(attributes: string): string {
  const match = HREF.exec(attributes);
  const href = (match?.[1] ?? match?.[2] ?? '').trim();
  if (!SAFE_LINK_SCHEME.test(href)) {
    return '';
  }
  return `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">`;
}

/**
 * A picture - drawn when its bytes are travelling with the email, named when
 * they are not (cards 1.129 and 1.130).
 *
 * ⚠️ `cid:` AND NOT A URL. A link to `/api/attachments/:id` sits behind Easy
 * Auth and the app's own guard, and the requester has neither; most clients
 * also block remote images by default, so even a public URL would show a grey
 * box. An inline part displays.
 *
 * ⚠️ THE FALLBACK IS NOT AN ERROR PATH, IT IS THE NORMAL ONE for anything the
 * email declined to carry - a file on an internal note, one over the size
 * ceiling, one the AV gate refuses, one that could not be read. Card 1.129's
 * `[image: name]` then reads as a sentence, and the file is on the ticket
 * either way.
 */
function renderImage(
  attributes: string,
  inlineImages: ReadonlyMap<string, string> | undefined,
): string {
  const altMatch = ALT.exec(attributes);
  const name = (altMatch?.[1] ?? altMatch?.[2] ?? '').trim();
  const idMatch = ATTACHMENT_ID.exec(attributes);
  const attachmentId = (idMatch?.[1] ?? idMatch?.[2] ?? '').trim();
  const cid = attachmentId ? inlineImages?.get(attachmentId) : undefined;
  if (cid) {
    // `max-width:100%` because an agent's screenshot is routinely wider than a
    // phone, and a mail client will not reflow it for us.
    return (
      `<img src="cid:${escapeAttribute(cid)}" alt="${escapeAttribute(name || 'attachment')}" ` +
      'style="max-width:100%;height:auto;display:block;margin:8px 0;" />'
    );
  }
  return escapeText(name === '' ? '[image]' : `[image: ${name}]`);
}

/**
 * Render a stored message body as the HTML half of an outbound email
 * (card 1.129, fault C).
 *
 * ⚠️ WHAT THIS REPLACED, AND WHY IT IS NOT SIMPLY "STOP ESCAPING". The builder
 * ran `escapeHtml(messageBody)` over the whole body, so an agent's formatting
 * reached the requester as visible tags - measured 2026-09-16 on a real
 * outbound email, whose HTML part carried `data-attachment-id` as literal text
 * and no image element at all. ⚠️ **But the escaping was doing a real job**,
 * and `reply-email-body.spec.ts` pins it: a body is not trusted markup. It can
 * be typed, pasted, or posted straight at the API by anything holding a token.
 *
 * So this is DEFAULT-DENY. A known-safe tag is re-emitted **without its
 * attributes**, a link keeps only an `http(s)`/`mailto` href, an image becomes
 * its name, and **everything else is dropped** - including `data-temp-id` and
 * `data-attachment-id`, which are internal markers that no recipient should
 * ever have seen.
 *
 * ⚠️ A PLAIN-TEXT BODY TAKES THE OLD PATH UNCHANGED, character for character.
 * Most replies are one typed line, and rewriting how those render would put
 * every existing email at risk to fix a subset of them.
 *
 * @param body A stored `TicketMessage.body`.
 * @param inlineImages Attachment id to `cid`, for images travelling with this
 * email (card 1.130). Anything absent is named instead of drawn.
 * @returns HTML safe to place inside an email body.
 */
export function renderMessageBodyEmailHtml(
  body: string,
  inlineImages?: ReadonlyMap<string, string>,
): string {
  if (!body) {
    return '';
  }
  if (!containsHtmlMarkup(body)) {
    return renderPlainText(body);
  }
  const source = body
    .replace(DISCARDED_ELEMENTS, '')
    .replace(HTML_COMMENT, '');
  const out: string[] = [];
  let cursor = 0;
  TAG.lastIndex = 0;
  for (
    let match = TAG.exec(source);
    match !== null;
    match = TAG.exec(source)
  ) {
    out.push(escapeText(source.slice(cursor, match.index)));
    cursor = match.index + match[0].length;
    const isClosing = match[1] === '/';
    const name = match[2].toLowerCase();
    const attributes = match[3] ?? '';
    if (name === 'br') {
      out.push(isClosing ? '' : '<br />');
    } else if (name === 'a') {
      out.push(isClosing ? '</a>' : renderAnchor(attributes));
    } else if (name === 'img') {
      out.push(isClosing ? '' : renderImage(attributes, inlineImages));
    } else if (KEPT_TAGS.has(name)) {
      out.push(isClosing ? `</${name}>` : `<${name}>`);
    }
  }
  out.push(escapeText(source.slice(cursor)));
  return out.join('');
}
