import { stripQuotedReply } from '../notifications/quoted-reply.util';
import { markInlineImagesPending } from './inline-image-placeholder.util';

/**
 * A stored message body, made ready for a person to read (card 1.139).
 *
 * ⚠️ THE ONE PLACE A BODY IS TRANSFORMED FOR DISPLAY, AND THE REASON THIS FILE
 * EXISTS. A message reaches a screen by two routes - `listMessages` builds one
 * when somebody opens the ticket, `toRealtimeMessagePayload` builds another
 * when a message arrives while they watch - and every display rule therefore
 * had to be written twice. Four times it was written once:
 *
 * - **Card 1.62** wired `stripQuotedReply` into the fetch path, calling it
 *   "the single message-read path". It was not.
 * - **Card 1.75** found the socket push still carried the untrimmed body.
 *   Measured in production on `PA_20260910_381`: 1,655 characters pushed where
 *   192 were fetched - the whole quoted thread, both signatures, the pilot-mode
 *   notice and the tenant's confidentiality footer.
 * - **Card 1.135** added `markInlineImagesPending` to the socket path, because
 *   an unresolved `[[cid:...]]` reached a viewer as literal text.
 * - **Card 1.139** found that same transform had never been added to the FETCH
 *   path - the identical trap, running the other way, and the direction nobody
 *   had checked. Between a message being stored and its files finishing upload,
 *   anyone OPENING the ticket read the raw marker.
 *
 * ⚠️ THE SHAPE OF THE BUG IS ALWAYS THE SAME AND IT IS THE WORST KIND: one
 * viewer sees a worse version than another, and reloading fixes it, so the
 * person who saw it assumes they imagined it and never reports it.
 *
 * ⚠️ DISPLAY ONLY, ON BOTH PATHS. This transforms what is SENT to a viewer,
 * never what is stored. `TicketMessage.body` keeps the whole thing, so nothing
 * an audit needs is lost, and trimming before storing would throw away the one
 * copy.
 *
 * ⚠️ THIS FUNCTION DOES NOT DECIDE WHO MAY READ THE MESSAGE. Card 1.83's rule -
 * an internal note reaches only somebody who may read internal notes - is
 * enforced where the messages are SELECTED, by the `where` in `listMessages`
 * and by the `type === PUBLIC` guard on both socket pushes. A body transform is
 * the wrong place for an access decision and must not become one.
 *
 * ⚠️ ORDER MATTERS. `stripQuotedReply` runs first: its markers are anchored to
 * whole lines, and replacing a marker with an `<img>` tag beforehand would put
 * markup on a line it needs to match.
 *
 * @param body The stored body, exactly as `TicketMessage.body` holds it.
 * @returns The body as a viewer should see it.
 */
export function messageBodyForViewer(body: string): string {
  return markInlineImagesPending(stripQuotedReply(body));
}
