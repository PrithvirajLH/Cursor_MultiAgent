import { messageBodyToEmailText } from './message-body-email-text.util';

/** The placeholder `messageBodyToEmailText` leaves standing for a picture. */
const IMAGE_PLACEHOLDER = /\[image(?::[^\]]*)?\]/g;

/**
 * The text a preheader is built from - the message with its pictures taken
 * out (card 1.136).
 *
 * ⚠️ WHY THIS IS NOT JUST `messageBodyToEmailText`. The two look like the same
 * job and are not. The plain-text PART is the whole message for anyone whose
 * client will not render HTML, so `[image: name]` earns its place there: it is
 * the only trace that a picture existed and where it sat. The PREHEADER is one
 * line in an inbox list, and there the same string is pure cost - it spends the
 * front of the preview, the part a reader actually sees, on a filename that is
 * almost always `image.png` and tells them nothing. Measured on a real reply,
 * 2026-09-17: the owner's inbox read `[image: image.png]Are you still getting
 * this...` when the sentence alone would have fitted.
 *
 * ⚠️ AN IMAGE-ONLY MESSAGE KEEPS ITS PLACEHOLDER. Strip the picture from a
 * message that is nothing but a picture and the preheader is empty, at which
 * point the client falls through to the next text in the document - our own
 * hidden layout - and previews something worse than a filename. So the
 * placeholder is dropped only when there are words to drop it in favour of.
 *
 * @param body A stored `TicketMessage.body`.
 * @returns Preview text, flattened to one line, with no image placeholders in
 * it unless they are all that was there.
 */
export function messageBodyToPreheaderText(body: string): string {
  const text = messageBodyToEmailText(body);
  const withoutImages = text
    .replace(IMAGE_PLACEHOLDER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutImages === '' ? text : withoutImages;
}
