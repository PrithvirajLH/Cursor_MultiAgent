import { htmlToText } from '../inbound-mailbox/html-to-text.util';
import { containsHtmlMarkup } from './contains-html-markup.util';

/** An `<img>`, however it is attributed, including its `alt` when it has one. */
const IMAGE_TAG = /<img\b[^>]*>/gi;
const ALT_ATTRIBUTE = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/**
 * What a picture becomes when there are no pictures - a named placeholder
 * rather than a silent gap, so the sentence around it still makes sense.
 */
function describeImage(tag: string): string {
  const alt = ALT_ATTRIBUTE.exec(tag);
  const name = (alt?.[1] ?? alt?.[2] ?? '').trim();
  return name === '' ? '[image]' : `[image: ${name}]`;
}

/**
 * The plain-text half of an outbound email, from a stored message body
 * (card 1.129, fault C).
 *
 * ⚠️ WHAT THIS REPLACED. The text part was the stored body, verbatim. For a
 * body the composer had written as HTML that meant the requester read
 * `IT BOT <img data-temp-id="6bdd3f50-..." alt="image.png" class=""
 * data-attachment-id="324e680b-...">see the img` - measured on a real
 * outbound email, 2026-09-16, in the part that most clients show. **This is
 * the exact mirror of card 1.62**, which fixed inbound email showing its own
 * HTML source; the same fault was running outbound the whole time.
 *
 * ⚠️ A PLAIN-TEXT BODY IS RETURNED UNCHANGED, byte for byte. `htmlToText`
 * strips per-line indentation - right for a document, wrong for text somebody
 * typed - so it must only ever see HTML. That is `selectBodyText`'s rule at the
 * inbound boundary and it is the same rule here.
 *
 * @param body A stored `TicketMessage.body`.
 * @returns Readable text with no markup in it.
 */
export function messageBodyToEmailText(body: string): string {
  if (!body || !containsHtmlMarkup(body)) {
    return body;
  }
  // ⚠️ ON ITS OWN LINE (card 1.136). `<img>` is an inline element, so a
  // straight swap produced `[image: image.png]see the img` - the name welded
  // to the next word, measured on a real reply. The HTML half draws the same
  // picture as `display:block`, and the two halves should not disagree about
  // whether a screenshot interrupts the sentence or sits under it.
  return htmlToText(body.replace(IMAGE_TAG, (tag) => `\n${describeImage(tag)}\n`));
}
