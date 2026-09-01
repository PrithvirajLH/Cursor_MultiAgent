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
  /** Overrides SMTP_FROM; mainly for tests. */
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
 * Build the From header.
 *
 * `Sarah Chen (CSNHC Helpdesk) <helpdesk@csnhc.com>` for an agent's reply, and
 * the generic `CSNHC Helpdesk <helpdesk@csnhc.com>` when no agent is named -
 * a notification raised by a worker has no person behind it.
 *
 * The agent form always ends up quoted, because the parentheses that make it
 * readable are themselves RFC specials.
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
