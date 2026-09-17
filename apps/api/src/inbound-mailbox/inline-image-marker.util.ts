/**
 * The placeholder an inline image leaves in a flattened mail body
 * (card 1.129, fault B).
 *
 * ⚠️ THE SHAPE IS WRITTEN IN ONE PLACE AND READ IN ANOTHER - the mailbox worker
 * puts markers in, and `inbound-email.service.ts` swaps them for real
 * attachment ids once the files are stored. **Both halves live on this object
 * on purpose.** Two spellings of one format in two files is precisely this
 * project's recurring failure (cards 1.99, 1.127, and a dozen before them), and
 * that is worth more than the one-export-per-file convention here.
 *
 * ⚠️ IT MUST SURVIVE `htmlToText`, which strips tags and decodes entities. So
 * it is deliberately neither markup nor an entity.
 */
export const INLINE_IMAGE_MARKER = Object.freeze({
  /**
   * The marker for one `Content-ID`.
   *
   * @param contentId The id the body's `cid:` reference named.
   * @returns The text to leave in the body in the image's place.
   */
  write(contentId: string): string {
    return `[[cid:${contentId}]]`;
  },
  /**
   * Every marker in a body, capturing the `Content-ID`.
   *
   * ⚠️ Recreated on each read rather than shared: a `g` regex carries
   * `lastIndex`, and a module-level one silently skips matches on its second
   * use.
   */
  findAll(): RegExp {
    return /\[\[cid:([^\]]+)\]\]/g;
  },
});
