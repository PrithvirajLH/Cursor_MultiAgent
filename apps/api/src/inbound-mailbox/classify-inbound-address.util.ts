import { DEPARTMENT_ALIASES } from './department-aliases.const';

/** The prefix that marks a suffix as a reply token rather than a department. */
const REPLY_SUFFIX_PREFIX = 'ticket-';

/**
 * What an inbound message's recipients say about where it should go.
 *
 * `unknown` deliberately carries the suffix it could not place, so the worker
 * can say what it saw rather than guessing.
 */
export type InboundAddressing =
  | { kind: 'reply'; token: string; matchedAddress: string }
  | { kind: 'department'; slug: string; matchedAddress: string }
  | { kind: 'bare'; matchedAddress: string }
  | { kind: 'unknown'; suffix: string; matchedAddress: string }
  | { kind: 'none' };

/** One recipient, and which header it came from. Order is the priority order. */
export type RecipientCandidate = {
  address: string;
  source: 'to' | 'cc' | 'delivered-to';
};

/**
 * Decide what an inbound message's recipients mean (card 1.24).
 *
 * ⚠️ **`To`, `CC` AND `Delivered-To`, not just `To`.** On a reply-all or a
 * forward our plus address is very often NOT in `To` - the human sender is,
 * and we are carried in `Cc`. Parsing only `To` drops exactly the loop-in cases
 * card 1.40 exists to fix, and `Delivered-To` is the only witness when a list
 * or a forwarding rule rewrote the envelope. All three are searched.
 *
 * **The rule, from the owner (2026-09-01): a suffix beginning `ticket-` is a
 * reply token; anything else is a department slug.** One mailbox carries both.
 *
 * ⚠️ **A reply token beats a department suffix when both are present**, which
 * happens constantly: someone replies-all to an acknowledgement, so the
 * original `helpdesk+payroll@` is still in `To` while our `Reply-To`
 * (`helpdesk+ticket-…@`) is the address that actually matters. Routing on the
 * department there would open a second ticket for a conversation that already
 * has one - the exact duplicate card 1.43 removed. Department addressing is
 * for the FIRST message only.
 *
 * @param candidates Every address from To, CC and Delivered-To.
 * @param baseAddress The mailbox we own, e.g. `helpdesk@csnhc.com`.
 * @param aliases Short forms mapped to real slugs; defaults to the shared map.
 * @returns What to do, or `none` when we are not addressed at all.
 */
export function classifyInboundAddress(
  candidates: readonly RecipientCandidate[],
  baseAddress: string,
  aliases: Readonly<Record<string, string>> = DEPARTMENT_ALIASES,
): InboundAddressing {
  const base = splitAddress(baseAddress);
  if (!base) {
    return { kind: 'none' };
  }
  const matches: Array<{ suffix: string; address: string }> = [];
  for (const candidate of candidates) {
    const parsed = splitAddress(candidate.address);
    if (!parsed || parsed.domain !== base.domain) {
      continue;
    }
    if (parsed.local === base.local) {
      matches.push({ suffix: '', address: parsed.normalized });
      continue;
    }
    if (parsed.local.startsWith(`${base.local}+`)) {
      matches.push({
        suffix: parsed.local.slice(base.local.length + 1),
        address: parsed.normalized,
      });
    }
  }
  if (matches.length === 0) {
    return { kind: 'none' };
  }
  // A reply token wins over everything, wherever it appeared. See above.
  const reply = matches.find((match) =>
    match.suffix.startsWith(REPLY_SUFFIX_PREFIX),
  );
  if (reply) {
    const token = reply.suffix.slice(REPLY_SUFFIX_PREFIX.length);
    return token
      ? { kind: 'reply', token, matchedAddress: reply.address }
      : { kind: 'unknown', suffix: reply.suffix, matchedAddress: reply.address };
  }
  const suffixed = matches.find((match) => match.suffix !== '');
  if (!suffixed) {
    return { kind: 'bare', matchedAddress: matches[0].address };
  }
  const slug = aliases[suffixed.suffix] ?? suffixed.suffix;
  return { kind: 'department', slug, matchedAddress: suffixed.address };
}

/** Lower-cased local part and domain, or null if this is not an address. */
function splitAddress(
  value: string | null | undefined,
): { local: string; domain: string; normalized: string } | null {
  if (!value) {
    return null;
  }
  // Accept `Name <addr@host>` as well as a bare address: Graph gives us the
  // bare form, but a Delivered-To header taken from raw MIME may not.
  const angled = value.match(/<([^>]+)>/);
  const raw = (angled ? angled[1] : value).trim().toLowerCase();
  const atIndex = raw.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === raw.length - 1) {
    return null;
  }
  return {
    local: raw.slice(0, atIndex),
    domain: raw.slice(atIndex + 1),
    normalized: raw,
  };
}
