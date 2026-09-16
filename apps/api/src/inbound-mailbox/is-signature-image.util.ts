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
 *
 * ⚠️ CARD 1.122: THIS THRESHOLD IS KNOWN TO BE TOO LOW, AND THE OWNER CHOSE
 * TO LEAVE IT. DO NOT RAISE IT WITHOUT ASKING THEM AGAIN.
 *
 * The first real email to reach this platform carried seven files, and two
 * signature graphics of 104.7 KB and 120.9 KB sailed straight through - both
 * roughly double this ceiling. So the filter is not catching what it was built
 * to catch, and that is a measured fact rather than a suspicion.
 *
 * ⚠️ IT WAS LEFT ALONE BECAUSE SIZE IS THE ONLY THING THAT SEPARATES THE TWO
 * CASES, AND THE GAP IS NARROW. A signature logo and a deliberately pasted
 * screenshot are both `isInline`, both referenced by `cid:` in the body, both
 * `image/png`, and in the observed mail both were even named `image.png`.
 * Graph's attachment metadata carries no dimensions. The screenshot in that
 * same email was 212 KB, so a ceiling high enough to catch a 121 KB logo sits
 * uncomfortably close to real content.
 *
 * The owner's call, asked with those numbers in front of them: keep the logos
 * arriving as noise rather than risk silently dropping a file somebody meant to
 * send. Noise on a ticket is visible and annoying; a lost screenshot is neither.
 *
 * If this is revisited, the honest fix is a signal that is CERTAIN rather than a
 * better guess - image dimensions, or the same file recurring across a sender's
 * emails - not a larger number here.
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
