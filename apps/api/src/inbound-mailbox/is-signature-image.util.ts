/** The size below which an inline image is treated as signature furniture. */
export const DEFAULT_INLINE_IMAGE_MIN_BYTES = 50 * 1024;

/**
 * Whether an emailed image is signature furniture rather than content (card 1.116).
 *
 * ⚠️ THE OWNER'S DECISION, 2026-09-16: "dont pull signature logos." Every reply
 * from Outlook carries two or three of them, and attaching a company logo to a
 * ticket every time somebody answers an email is noise that buries the files an
 * agent actually needs.
 *
 * ⚠️ INLINE IS NOT THE SAME AS JUNK, WHICH IS THE WHOLE DIFFICULTY. A pasted
 * screenshot is inline too — the image that started this card was inline, and it
 * is exactly what the requester meant to send. So the rule cannot be "skip
 * inline"; the discriminator is SIZE. The measured case: signature logos are a
 * few KB, the pasted screenshot was 212 KB.
 *
 * ⚠️ A NON-INLINE FILE IS NEVER SKIPPED, WHATEVER ITS SIZE. Somebody who
 * deliberately attaches a 2 KB text file meant to attach it. Only images that
 * the mail client embedded on the sender's behalf are candidates, which is why
 * all three conditions have to hold.
 *
 * ⚠️ THE SIZE IS GRAPH'S WIRE SIZE, and that is fine here. It runs about a third
 * larger than the real file because of base64 and MIME overhead, so this rule is
 * slightly biased towards KEEPING things — the safe direction. It must not be
 * used anywhere that needs a true byte count (see `sizeBytes` in the poller,
 * which decodes for exactly that reason).
 *
 * THE ACCEPTED COST: a genuinely tiny pasted screenshot, under the threshold, is
 * skipped along with the logos. `INBOUND_INLINE_IMAGE_MIN_BYTES` exists so that
 * line can be moved without a deploy.
 */
export function isSignatureImage(
  attachment: { contentType: string; sizeBytes: number; isInline: boolean },
  minInlineImageBytes: number = DEFAULT_INLINE_IMAGE_MIN_BYTES,
): boolean {
  if (!attachment.isInline) {
    return false;
  }
  if (!attachment.contentType.trim().toLowerCase().startsWith('image/')) {
    return false;
  }
  return attachment.sizeBytes < minInlineImageBytes;
}
