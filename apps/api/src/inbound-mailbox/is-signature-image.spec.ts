import {
  DEFAULT_INLINE_IMAGE_MIN_BYTES,
  isSignatureImage,
} from './is-signature-image.util';

/** The real files from the email that produced card 1.116, with Graph's sizes. */
const PASTED_SCREENSHOT = {
  contentType: 'image/png',
  sizeBytes: 212 * 1024,
  isInline: true,
};
const REAL_ATTACHMENT = {
  contentType: 'image/png',
  sizeBytes: 4.36 * 1024 * 1024,
  isInline: false,
};
const SIGNATURE_LOGO = {
  contentType: 'image/png',
  sizeBytes: 6 * 1024,
  isInline: true,
};

/**
 * Card 1.116 — which emailed images are content and which are furniture.
 *
 * ⚠️ THE OWNER'S DECISION: "dont pull signature logos." Every Outlook reply
 * carries two or three, and attaching a company logo to a ticket each time
 * somebody answers an email buries the files an agent actually needs.
 *
 * ⚠️ INLINE IS NOT THE SAME AS JUNK, which is the whole difficulty. The image
 * that started this card was pasted into the body — inline, and exactly what the
 * sender meant to send. So the rule cannot be "skip inline". The discriminator
 * is size, measured from the real email: logos are a few KB, the pasted
 * screenshot was 212 KB.
 */
describe('isSignatureImage (card 1.116)', () => {
  it('⚠️ skips a small inline logo', () => {
    // THE REGRESSION ASSERTION for the owner's decision.
    expect(isSignatureImage(SIGNATURE_LOGO)).toBe(true);
  });

  it('⚠️ KEEPS the pasted screenshot, which is also inline', () => {
    // NON-VACUITY, and the one that matters most: a rule that skipped all
    // inline images would pass the test above and throw away the very file
    // this card exists to deliver.
    expect(isSignatureImage(PASTED_SCREENSHOT)).toBe(false);
  });

  it('⚠️ never skips a NON-inline file, however small', () => {
    // Somebody deliberately attaching a 2 KB file meant to attach it. Only
    // images the mail client embedded on the sender's behalf are candidates.
    expect(
      isSignatureImage({
        contentType: 'image/png',
        sizeBytes: 900,
        isInline: false,
      }),
    ).toBe(false);
    expect(isSignatureImage(REAL_ATTACHMENT)).toBe(false);
  });

  it('never skips a non-image, however small and inline', () => {
    // An inline calendar invite or a tiny text part is not signature furniture.
    expect(
      isSignatureImage({
        contentType: 'text/calendar',
        sizeBytes: 800,
        isInline: true,
      }),
    ).toBe(false);
  });

  it('is case- and whitespace-insensitive about the content type', () => {
    expect(
      isSignatureImage({
        contentType: '  IMAGE/PNG  ',
        sizeBytes: 900,
        isInline: true,
      }),
    ).toBe(true);
  });

  it('⚠️ the threshold is the boundary, and it is configurable', () => {
    const at = { contentType: 'image/png', isInline: true };
    // Exactly at the limit is kept: the rule is "smaller than".
    expect(
      isSignatureImage({ ...at, sizeBytes: DEFAULT_INLINE_IMAGE_MIN_BYTES }),
    ).toBe(false);
    expect(
      isSignatureImage({ ...at, sizeBytes: DEFAULT_INLINE_IMAGE_MIN_BYTES - 1 }),
    ).toBe(true);
    // Raising it lets an operator reclaim a small pasted screenshot without a
    // deploy - the accepted cost of the rule, made adjustable on purpose.
    expect(isSignatureImage(PASTED_SCREENSHOT, 512 * 1024)).toBe(true);
  });
});
