/**
 * The line every outbound message carries at the top of its body.
 *
 * A reply quotes our whole email underneath the sender's own words, so this
 * marker is the first thing inside the quoted block and the most reliable cut
 * point we have — the only one we control rather than infer. It lives here
 * beside the trimmer because the two are one contract: `email.service.ts`
 * writes it, `stripQuotedReply` reads it, and changing the string in one place
 * alone silently stops the trimming from working.
 */
export const REPLY_ABOVE_MARKER = '----- Reply above this line -----';

/** Escape a literal for use inside a RegExp. */
function toLiteralPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Where a quoted block starts, most reliable first. Order does not decide the
 * outcome - the earliest match in the body wins - but it documents intent.
 *
 * Every one of these is a marker a mail client writes deliberately. Nothing
 * here guesses: no "Sent from my iPhone", no corporate disclaimer sniffing. A
 * trimmer that guesses eats real words, and losing what a requester wrote is far
 * worse than showing an agent some quoted text.
 *
 * ⚠️ CARD 1.66 REMOVED TWO MARKERS, and the reason is worth keeping because
 * both looked harmless. They were a line of five or more underscores
 * (`/^_{5,}\s*$/m`) and a bare `--` (`/^--[ \t]?$/m`, the RFC 3676 signature
 * delimiter).
 *
 * Card 1.62 wired this trimmer into `listMessages`, the single message-read
 * path, so from that commit it ran over EVERY displayed message - including
 * ones an agent typed in the app, which no mail client ever touched. Those two
 * markers are things a person writes: a divider line, or a sign-off dash.
 *
 * The argument is complete rather than probabilistic. The cut is made at the
 * EARLIEST match, so a marker can only change the outcome when it beats every
 * other one or when none of the others match at all. The four that remain are
 * unambiguous email artefacts that a real quoted reply always carries. So those
 * two could only ever bite a body with no email signal in it whatsoever - which
 * is to say, an agent's own note.
 *
 * Measured on the real production fixture
 * (`inbound-mailbox/__fixtures__/outlook-reply.html`): both matched ZERO times,
 * and the trimming there is done by markers 1 and 3. Nothing is lost.
 *
 * The signature delimiter also contradicted this comment's own first paragraph:
 * declining to guess at signature blocks is the stated rule, and a signature
 * delimiter is exactly that guess.
 */
const QUOTE_MARKERS: readonly RegExp[] = [
  // Our own marker.
  new RegExp(`^${toLiteralPattern(REPLY_ABOVE_MARKER)}\\s*$`, 'm'),
  // "-----Original Message-----", Outlook and several others.
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/m,
  // Outlook's header block: a From: line immediately followed by Sent:/Date:.
  /^From:[ \t].+\r?\n(?:Sent|Date):[ \t]/m,
  // Gmail's attribution, which wraps onto a second line on long names.
  /^On\s[^\n]{0,200}(?:\r?\n[^\n]{0,200})?\bwrote:\s*$/m,
];

/**
 * Return the part of an inbound email the sender actually typed.
 *
 * Display only. The full body stays on the record: this is called when showing
 * a message, never before storing one, so nothing an audit might need is ever
 * discarded.
 *
 * Returns the input **unchanged** when no marker matches, and also when cutting
 * at the earliest marker would leave nothing behind - a reply that is entirely
 * quoted text is better shown in full than shown as an empty message.
 */
export function stripQuotedReply(body: string): string {
  if (!body) return body;
  let earliest = -1;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(body);
    if (match && (earliest === -1 || match.index < earliest)) {
      earliest = match.index;
    }
  }
  if (earliest === -1) return body;
  const kept = body.slice(0, earliest).trimEnd();
  return kept.length === 0 ? body : kept;
}
