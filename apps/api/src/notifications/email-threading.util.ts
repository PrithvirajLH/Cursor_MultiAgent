const OUTBOX_MESSAGE_ID_PREFIX = 'outbox';
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
