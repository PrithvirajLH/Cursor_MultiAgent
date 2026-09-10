/**
 * The organisation's half of the From line. In code, not in the environment:
 * the LMS learned this the hard way - an env var holding a display name is one
 * typo away from mail going out branded wrong, and only the ADDRESS is
 * genuinely deployment-specific.
 */
const HELPDESK_IDENTITY = 'CSNHC Helpdesk';

/** Used only when SMTP_FROM is unset, which is the case until card 1.23. */
const FALLBACK_ADDRESS = 'helpdesk@csnhc.com';

/** RFC 5322 specials: a display name containing any of these must be quoted. */
const SPECIALS = /[()<>[\]:;@\\,."]/;

export type FromIdentityInput = {
  /** The agent whose reply this is; omit for the generic team identity. */
  readonly agentDisplayName?: string | null;
  /**
   * The mailbox to name. Overrides SMTP_FROM.
   *
   * Card 1.67 gave this a second caller: `Reply-To` passes the per-ticket
   * plus address here and omits `agentDisplayName`, because that mailbox
   * belongs to the desk and not to whichever agent happened to reply.
   */
  readonly address?: string | null;
};

/**
 * Quote a display name if it needs it, escaping what RFC 5322 requires.
 *
 * Concatenating raw would be enough right up until someone's display name is
 * `Chen, Sarah` and every recipient's client reads it as two addresses.
 */
function encodeDisplayName(displayName: string): string {
  if (!SPECIALS.test(displayName)) {
    return displayName;
  }
  const escaped = displayName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Build an RFC 5322 mailbox: a display name and an address in angle brackets.
 *
 * `Sarah Chen (CSNHC Helpdesk) <helpdesk@csnhc.com>` for an agent's reply, and
 * the generic `CSNHC Helpdesk <helpdesk@csnhc.com>` when no agent is named -
 * a notification raised by a worker has no person behind it.
 *
 * The agent form always ends up quoted, because the parentheses that make it
 * readable are themselves RFC specials. The generic form does not: `CSNHC
 * Helpdesk` is two atoms and needs no quoting, which is why the emitted
 * `Reply-To` reads `CSNHC Helpdesk <...>` rather than `"CSNHC Helpdesk" <...>`.
 * Both are the same header to a parser; quoting what needs no quoting is the
 * kind of thing a strict client is entitled to dislike.
 *
 * ⚠️ Card 1.67: this now builds `Reply-To` as well as `From`, and it is the
 * ONLY formatter that may. A second one would be a second place for the
 * quoting to be wrong, and the address it wraps has a ticket token in it -
 * one mangled byte and the reply lands nowhere.
 */
export function buildFromIdentity(input: FromIdentityInput = {}): string {
  const address = (
    input.address ??
    process.env.SMTP_FROM ??
    FALLBACK_ADDRESS
  ).trim();
  const agentName = input.agentDisplayName?.trim();
  const displayName =
    agentName === undefined || agentName === ''
      ? HELPDESK_IDENTITY
      : `${agentName} (${HELPDESK_IDENTITY})`;
  return `${encodeDisplayName(displayName)} <${address}>`;
}
