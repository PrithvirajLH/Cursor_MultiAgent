import { htmlToText } from './html-to-text.util';
import { INLINE_IMAGE_MARKER } from './inline-image-marker.util';

/** An `<img>` in the sender's HTML, with whatever attribute order it used. */
const IMAGE_TAG = /<img\b[^>]*>/gi;
/** `src="cid:whatever"`, single- or double-quoted, `cid:` case-insensitive. */
const CID_SOURCE = /\bsrc\s*=\s*(?:"cid:([^"]+)"|'cid:([^']+)')/i;

/**
 * Flatten an HTML mail body to text, but remember where the pasted images were
 * (card 1.129, fault B).
 *
 * ⚠️ WHY THIS IS NEEDED AT ALL. Card 1.62 converts the body to text at the
 * Graph boundary, which is right for everything else and is what stops an agent
 * reading 5,325 characters of markup. But `htmlToText` drops `<img>` with every
 * other tag, and with it the `src="cid:..."` that said *"the image belongs
 * here, between these two sentences"*. **A pasted screenshot mid-sentence is
 * meaningless once separated from the sentence** - *"the error looks like
 * this: [image]"* - so the position has to be carried across the conversion.
 *
 * ⚠️ THIS RETURNS NULL UNLESS IT HAS SOMETHING TO SAY, and that is the safety
 * property of the whole change. A body with no `cid:` reference, a reference to
 * a file that was never kept (every signature logo), or a message Graph sent as
 * plain text all come back null, and the caller keeps the body card 1.62
 * already produced - byte for byte. Only a message that genuinely pasted an
 * image the worker also stored takes a different path.
 *
 * @param html The body as Graph sent it, or null when Graph sent text.
 * @param contentIds The `Content-ID`s of the files that were actually kept.
 * @returns The flattened body carrying markers, or null to change nothing.
 */
export function buildBodyTextWithInlineMarkers(
  html: string | null,
  contentIds: ReadonlySet<string>,
): string | null {
  if (!html || contentIds.size === 0) {
    return null;
  }
  let substituted = false;
  const marked = html.replace(IMAGE_TAG, (tag) => {
    const match = CID_SOURCE.exec(tag);
    const contentId = (match?.[1] ?? match?.[2] ?? '').trim();
    if (contentId === '' || !contentIds.has(contentId)) {
      return tag;
    }
    substituted = true;
    return INLINE_IMAGE_MARKER.write(contentId);
  });
  return substituted ? htmlToText(marked) : null;
}
