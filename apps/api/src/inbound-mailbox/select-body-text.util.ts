import { htmlToText } from './html-to-text.util';

/**
 * Choose the text of a Graph message body (card 1.62).
 *
 * ⚠️ WHAT THIS REPLACED, AND WHY IT IS A NAMED FUNCTION NOW.
 *
 * Card 1.24 wrote this inline as:
 *
 *     const bodyText =
 *       typeof item.bodyPreview === 'string' && item.bodyPreview.trim()
 *         ? String(body?.content ?? item.bodyPreview)
 *         : String(body?.content ?? '');
 *
 * That ternary looks like it makes a choice and does not: BOTH arms take
 * `body.content` first, so the `bodyPreview.trim()` test only ever decides
 * which fallback applies when content is missing - and both fallbacks are
 * then equivalent in every case that matters. Meanwhile `contentType`, the
 * one field that should have decided anything, was read into scope and never
 * used.
 *
 * The surviving behaviour is deliberately the same in the one respect that
 * was real: **when there is no content, fall back to the preview.** Graph
 * returns `bodyPreview` already flattened to plain text, so it is a genuinely
 * useful last resort rather than a consolation. Everything else is new:
 * `contentType` now decides whether the content needs flattening.
 *
 * ⚠️ A `text` body is returned UNCHANGED, byte for byte. `htmlToText` is not
 * an identity function - it strips per-line indentation, which is right for a
 * document and wrong for text somebody wrote - so it must only ever see HTML.
 *
 * @param body Graph's `body` object, or undefined.
 * @param preview Graph's `bodyPreview`, already plain text.
 * @returns The message text to store and display.
 */
export function selectBodyText(
  body: { content?: unknown; contentType?: unknown } | undefined,
  preview: unknown,
): string {
  const content = typeof body?.content === 'string' ? body.content : '';
  const previewText = typeof preview === 'string' ? preview : '';
  if (!content) {
    return previewText;
  }
  const contentType =
    typeof body?.contentType === 'string' ? body.contentType.toLowerCase() : '';
  return contentType === 'html' ? htmlToText(content) : content;
}
