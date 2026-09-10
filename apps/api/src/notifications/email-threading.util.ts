import { createHash } from 'crypto';

const OUTBOX_MESSAGE_ID_PREFIX = 'outbox';
/** Prefix of the synthetic per-ticket root id (card 1.33). */
const TICKET_ROOT_MESSAGE_ID_PREFIX = 'ticket';
/** Same shape the reply-token extractor accepts. */
const REPLY_TOKEN_PATTERN = '[A-Za-z0-9_-]{16,128}';
const UUID_PATTERN =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

function sanitizeMessageIdDomain(domain: string | null | undefined) {
  if (!domain) {
    return 'localhost';
  }

  const normalized = domain.trim().toLowerCase();
  if (!normalized) {
    return 'localhost';
  }

  const cleaned = normalized
    .replace(/^[^@]*@/, '')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/^\.+|\.+$/g, '');

  return cleaned || 'localhost';
}

export function buildOutboundMessageId(
  outboxId: string,
  replyAddress?: string | null,
) {
  const domain = sanitizeMessageIdDomain(replyAddress);
  return `<${OUTBOX_MESSAGE_ID_PREFIX}.${outboxId}@${domain}>`;
}

/**
 * The one id every email about a ticket references, forever.
 *
 * Derived from the thread's existing `replyToken` rather than stored, so there
 * is no new column and no second piece of state that can drift out of step with
 * the reply address. Because it is derived and never recorded, a send that
 * failed cannot leave a pointer behind - which is the whole fault this fixes.
 *
 * One consequence, stated plainly: the domain comes from the configured reply
 * address, so if the sending domain ever changes, threads break at that
 * boundary. Rare, acceptable, and softened by the accumulating References list.
 */
export function buildTicketRootMessageId(
  replyToken: string,
  replyAddress?: string | null,
) {
  const domain = sanitizeMessageIdDomain(replyAddress);
  return `<${TICKET_ROOT_MESSAGE_ID_PREFIX}.${replyToken}@${domain}>`;
}

/**
 * Reply tokens quoted in an inbound reply's threading headers.
 *
 * The synthetic root is a NEW shape of id, and the outbox extractor below only
 * matches `outbox.<uuid>`. Without this, an inbound reply that quotes only the
 * root would stop resolving to its ticket - outbound threading would improve
 * and inbound threading would silently regress.
 */
export function extractReplyTokensFromThreadHeaders(
  ...headerValues: Array<string | null | undefined>
) {
  const pattern = new RegExp(
    `<?${TICKET_ROOT_MESSAGE_ID_PREFIX}\.(${REPLY_TOKEN_PATTERN})@[a-z0-9.-]+>?`,
    'gi',
  );
  const tokens = new Set<string>();

  for (const headerValue of headerValues) {
    if (!headerValue) {
      continue;
    }

    for (const match of headerValue.matchAll(pattern)) {
      const token = match[1]?.toLowerCase();
      if (token) {
        tokens.add(token);
      }
    }
  }

  return Array.from(tokens);
}

/** True when the id could not be given a routable domain and must not be used. */
export function isUnroutableMessageId(messageId: string | null | undefined) {
  if (!messageId) {
    return true;
  }
  return /@localhost>?\s*$/i.test(messageId.trim());
}

export function extractOutboxIdsFromThreadHeaders(
  ...headerValues: Array<string | null | undefined>
) {
  const pattern = new RegExp(
    `<?${OUTBOX_MESSAGE_ID_PREFIX}\\.(${UUID_PATTERN})@[a-z0-9.-]+>?`,
    'gi',
  );
  const outboxIds = new Set<string>();

  for (const headerValue of headerValues) {
    if (!headerValue) {
      continue;
    }

    for (const match of headerValue.matchAll(pattern)) {
      const outboxId = match[1]?.toLowerCase();
      if (outboxId) {
        outboxIds.add(outboxId);
      }
    }
  }

  return Array.from(outboxIds);
}

/** Bytes in a ConversationIndex root block: 1 header + 5 time + 16 GUID. */
const THREAD_INDEX_ROOT_BYTES = 22;
/** The only ConversationIndex version Outlook has ever emitted. */
const THREAD_INDEX_VERSION = 1;

/**
 * The Microsoft conversation header, derived so every email about a ticket
 * carries the same one.
 *
 * `References` is the RFC 5322 answer and ours has always been correct - proven
 * from live headers on 2026-09-10, where both emails carried the same
 * `<ticket.…>` root and the second referenced the first. **Outlook does not use
 * it.** It groups on `Thread-Index` (ConversationIndex), and when that header is
 * absent Exchange has to infer a conversation instead. That inference is what
 * fails here: the tenant's security gateway re-injects each message separately,
 * so two correctly-threaded emails arrived as two conversations.
 *
 * Derived from `replyToken` by the same reasoning as `buildTicketRootMessageId`:
 * no new column, no second piece of state that can drift, and a send that failed
 * leaves no pointer behind. Deterministic, so every message on the ticket
 * produces an identical value.
 *
 * Every message gets the ROOT block rather than a per-message child block.
 * Outlook groups on the 22-byte root prefix, so identical roots is what makes a
 * conversation; ordering inside it then falls back to `Date`, which is the
 * correct order anyway. Child blocks would need a parent-position we do not
 * store, and getting them wrong nests replies under the wrong parent - worse
 * than not nesting at all.
 */
export function buildThreadIndex(replyToken: string): string {
  const digest = createHash('sha256').update(replyToken).digest();
  const block = Buffer.alloc(THREAD_INDEX_ROOT_BYTES);
  block[0] = THREAD_INDEX_VERSION;
  digest.copy(block, 1, 0, 5);
  digest.copy(block, 6, 5, 21);
  return block.toString('base64');
}
