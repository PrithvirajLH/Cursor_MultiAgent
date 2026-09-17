import { INLINE_IMAGE_MARKER } from '../inbound-mailbox/inline-image-marker.util';

/**
 * What a viewer sees in the picture's place while it is still being stored.
 *
 * An `<img>` with no `src`, which the web styles as a skeleton - deliberately
 * the same ELEMENT the resolved body uses, so the swap is an attribute change
 * rather than a different box appearing and shifting the text under it.
 */
const PENDING_IMAGE = '<img data-attachment-pending="1" alt="image">';

/**
 * Hide unresolved inline-image markers from anything being SENT to a viewer
 * (card 1.135).
 *
 * ⚠️ WHY A MARKER EVER REACHES A VIEWER. Card 1.129 stores an emailed body
 * carrying `[[cid:...]]` because the files have no ids yet, then swaps each
 * marker for a real `<img data-attachment-id>` once they do. Both happen inside
 * one ingest - but `addMessage` pushes the message over the socket BETWEEN
 * them, roughly a hundred lines before `resolveInlineImageMarkers` runs. So
 * whoever had the ticket OPEN read `[[cid:5f02c6aa-...]]` as literal text, and
 * whoever opened it later saw the picture. Observed in production 2026-09-17.
 *
 * ⚠️ THIS IS CARD 1.75 AGAIN, IN THE SAME METHOD. That card found the socket
 * push was the SECOND message-read path and had never been taught to trim
 * quoted replies. The same push had never been taught about markers either.
 * **Anything that transforms a body for display belongs here, not only in
 * `listMessages`** - a third such rule will have the same bug on the same day
 * it ships unless it is added in both places.
 *
 * Display only: `TicketMessage.body` keeps the marker until the real ids
 * replace it, so nothing an audit needs is lost.
 *
 * @param body A message body, possibly still carrying markers.
 * @returns The body with each marker replaced by a loading placeholder.
 */
export function markInlineImagesPending(body: string): string {
  return body.replace(INLINE_IMAGE_MARKER.findAll(), PENDING_IMAGE);
}
