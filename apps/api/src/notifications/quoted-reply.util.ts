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
  // Outlook's horizontal rule above a forwarded block.
  /^_{5,}\s*$/m,
  // RFC 3676 signature delimiter: "-- " on a line of its own. Deliberately not
  // "---" or longer, which is ordinary prose punctuation.
  /^--[ \t]?$/m,
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
