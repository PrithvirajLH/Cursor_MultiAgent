/**
 * The tags a stored message body may legitimately contain.
 *
 * Mirrors `ALLOWED_TAGS` in `apps/web/src/components/RichTextEditor.tsx`, which
 * is what produces these bodies. ⚠️ THE WEB KEEPS ITS OWN COPY. The two answer
 * different questions - what to sanitise a body down to, versus whether one
 * arrived with markup in it - and a shared package for four lines would be the
 * larger mistake. Adding a tag to the composer means adding it here.
 */
const BODY_TAGS = [
  'p',
  'br',
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
  'a',
  'blockquote',
  'span',
  'img',
];

/**
 * An OPENING body tag: `<tag` followed by a space, `>` or `/>`.
 *
 * ⚠️ THE DELIMITER IS LOAD BEARING. Without it `s` matches `<script` and `b`
 * matches `<body`, which would send exactly the input the escaping exists for
 * down the rendering path. Closing tags are deliberately not matched: on their
 * own they are noise, and `</script>` must not qualify a body as markup.
 */
const CONTAINS_A_BODY_TAG = new RegExp(`<(${BODY_TAGS.join('|')})(\\s|>|/)`, 'i');

/**
 * Does this stored message body contain markup, or is it the plain text
 * somebody typed?
 *
 * ⚠️ BOTH SHAPES ARE STORED, WHICH IS THE WHOLE REASON THIS EXISTS. The
 * composer is a contentEditable: one typed line comes back as a bare text node,
 * while a second line, a bold word or a pasted image comes back as markup. An
 * inbound email's body is plain text by the time card 1.62 has flattened it.
 * One column holds all of it.
 *
 * ⚠️ NOT ANCHORED TO THE START, AND THAT IS THE CORRECTION THAT MATTERS.
 * `apps/web/src/utils/messageBody.ts` tests the FIRST tag, which is right for
 * it - `marked` renders inline HTML either way, so the web is correct whichever
 * branch it takes. Email is not: a body reading `hello <strong>world</strong>`
 * begins with a text node, and a start-anchored test would have escaped it and
 * sent the tags to the requester as visible text. That is the very bug card
 * 1.129 fault C is fixing, so the test has to look at the whole body.
 *
 * @param body A stored `TicketMessage.body`.
 * @returns True when the body carries markup that must be rendered, not escaped.
 */
export function containsHtmlMarkup(body: string): boolean {
  return CONTAINS_A_BODY_TAG.test(body ?? '');
}
