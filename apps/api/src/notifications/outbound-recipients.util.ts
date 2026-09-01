import { MessageType } from '@prisma/client';

/** Local parts we must never reply to; replying starts a loop or annoys a robot. */
const NO_REPLY_LOCAL_PARTS = [
  'no-reply',
  'noreply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
];

const DEFAULT_ALLOWED_DOMAINS = 'csnhc.com';

/**
 * Thrown when an internal note is about to be addressed to the person who
 * raised the ticket. Deliberately not exported and deliberately not caught
 * anywhere: this is a programming error, and the only correct outcome is a loud
 * failure in CI rather than a quiet one in a requester's inbox.
 */
class InternalNoteRecipientError extends Error {
  constructor(addresses: readonly string[]) {
    super(
      `Refusing to build an outbound email: an INTERNAL note cannot be addressed to the requester (${addresses.length} recipient(s) refused)`,
    );
    this.name = 'InternalNoteRecipientError';
  }
}

export type OutboundRecipient = {
  readonly address: string;
  /** True for the person who raised the ticket, whatever their role. */
  readonly isRequester?: boolean;
};

export type ResolveOutboundRecipientsInput = {
  readonly recipients: readonly OutboundRecipient[];
  readonly messageType?: MessageType;
  /**
   * Comma-separated, as the env var holds it. Omit to read
   * EMAIL_ALLOWED_DOMAINS at call time so an operator can widen the list
   * without a restart.
   */
  readonly allowedDomains?: string;
  /**
   * Addresses that have bounced. TODO(1.23): this arrives as a parameter
   * because there is nowhere durable to keep it yet. A real version needs a
   * table keyed on address with the bounce type (hard vs soft), a count, a
   * first/last seen, and an operator way to clear one - which is an additive
   * migration and belongs to the card that turns sending on, not to this one.
   */
  readonly suppressed?: readonly string[];
};

export type ResolvedOutboundRecipients = {
  readonly allowed: string[];
  readonly refused: { address: string; reason: string }[];
};

function parseDomainList(raw: string | undefined): string[] {
  const value = raw ?? DEFAULT_ALLOWED_DOMAINS;
  return value
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain !== '');
}

function domainOf(address: string): string | null {
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) return null;
  return address.slice(at + 1).toLowerCase();
}

function isNoReplyAddress(address: string): boolean {
  const local = address.slice(0, address.lastIndexOf('@')).toLowerCase();
  return NO_REPLY_LOCAL_PARTS.some(
    (blocked) => local === blocked || local.startsWith(`${blocked}+`),
  );
}

/**
 * Decide who may actually receive an outbound email, and say who may not.
 *
 * This sits above the transport on purpose. Every guard that decides an
 * *address* lives here rather than in `EmailService`, so a future caller cannot
 * reach `sendMail` with an outside address by constructing its own payload.
 *
 * Refusals are returned rather than dropped: the caller records them on the
 * ticket so an agent can see their message did not reach someone. Nothing here
 * logs an address - that is the caller's decision and the logger conventions
 * apply.
 *
 * Throws when an INTERNAL note is addressed to the requester. Note the guard is
 * on *who the recipient is*, not on their role: `NotificationsService` excludes
 * EMPLOYEEs from internal notes, which silently lets an internal note through to
 * a requester who happens to be an agent - a real and normal case in a helpdesk.
 */
export function resolveOutboundRecipients(
  input: ResolveOutboundRecipientsInput,
): ResolvedOutboundRecipients {
  if (input.messageType === MessageType.INTERNAL) {
    const requesterAddresses = input.recipients
      .filter((recipient) => recipient.isRequester === true)
      .map((recipient) => recipient.address);
    if (requesterAddresses.length > 0) {
      throw new InternalNoteRecipientError(requesterAddresses);
    }
  }
  const allowedDomains = parseDomainList(
    input.allowedDomains ?? process.env.EMAIL_ALLOWED_DOMAINS,
  );
  const suppressed = new Set(
    (input.suppressed ?? []).map((address) => address.trim().toLowerCase()),
  );
  const allowed: string[] = [];
  const refused: { address: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const recipient of input.recipients) {
    const address = recipient.address.trim();
    const key = address.toLowerCase();
    if (address === '' || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const domain = domainOf(address);
    if (domain === null) {
      refused.push({ address, reason: 'not a valid email address' });
      continue;
    }
    if (!allowedDomains.includes(domain)) {
      refused.push({ address, reason: 'outside the allowed domains' });
      continue;
    }
    if (isNoReplyAddress(address)) {
      refused.push({ address, reason: 'no-reply address' });
      continue;
    }
    if (suppressed.has(key)) {
      refused.push({ address, reason: 'suppressed after a bounce' });
      continue;
    }
    allowed.push(address);
  }
  return { allowed, refused };
}
