import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GraphAttachmentContent,
  GraphAttachmentMeta,
  GraphDeltaPage,
  GraphMailClient,
  GraphMailMessage,
  GraphRecipient,
} from './graph-mail.client';
import { selectBodyText } from './select-body-text.util';

/** Where the consumed mail is filed, so the mailbox shows what was taken. */
const PROCESSED_FOLDER = 'Processed';
/** Graph page size. A helpdesk mailbox sees a few hundred messages a day. */
const PAGE_SIZE = 50;
/** Give up on a single Graph call rather than wedging the poll. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Graph's `contentId`, as the body's `cid:` reference spells it.
 *
 * Strips the angle brackets of RFC 2392's `<id@host>` form, which Graph passes
 * through from the original header. Anything blank comes back null, so a
 * missing id can never accidentally match a missing reference.
 */
function normaliseContentId(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim().replace(/^<|>$/g, '').trim();
  return trimmed === '' ? null : trimmed;
}

type TokenCache = { token: string; expiresAt: number };

/**
 * The real Graph client (card 1.24).
 *
 * ⚠️ **NOT EXERCISED BY ANY TEST, DELIBERATELY.** The permission it needs
 * (`Mail.ReadWrite`, scoped to one mailbox by an Application Access Policy)
 * had not been granted when this was written, and faking an HTTP transport
 * would prove nothing except that the fake matches the fake. Everything that
 * can be tested lives behind `GraphMailClient`; this class is exercised for
 * the first time by §6 of the handoff, which is why that checklist exists.
 *
 * Written against the documented shapes:
 *   GET  /users/{mailbox}/mailFolders/inbox/messages/delta
 *   POST /users/{mailbox}/messages/{id}/move   { destinationId }
 *
 * Uses the client-credentials flow on the EXISTING app registration
 * (`AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`), so no new
 * secret is introduced.
 */
@Injectable()
export class GraphMailHttpClient extends GraphMailClient {
  private readonly logger = new Logger(GraphMailHttpClient.name);
  private tokenCache: TokenCache | null = null;
  private processedFolderId: string | null = null;

  constructor(private readonly config: ConfigService) {
    super();
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('AZURE_TENANT_ID') &&
        this.config.get<string>('AZURE_CLIENT_ID') &&
        this.config.get<string>('AZURE_CLIENT_SECRET'),
    );
  }

  describeConfiguration(): string {
    if (this.isConfigured()) {
      return 'AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET present';
    }
    const missing = [
      'AZURE_TENANT_ID',
      'AZURE_CLIENT_ID',
      'AZURE_CLIENT_SECRET',
    ].filter((name) => !this.config.get<string>(name));
    return `missing ${missing.join(', ')}`;
  }

  async fetchDelta(mailbox: string, link: string | null): Promise<GraphDeltaPage> {
    const url =
      link ??
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}` +
        `/mailFolders/inbox/messages/delta?$top=${PAGE_SIZE}`;
    const payload = await this.request<{
      value?: unknown[];
      '@odata.deltaLink'?: string;
      '@odata.nextLink'?: string;
    }>(url, { method: 'GET' });
    const messages = (payload.value ?? [])
      .map((item) => this.toMessage(item))
      .filter((item): item is GraphMailMessage => item !== null);
    return {
      messages,
      deltaLink: payload['@odata.deltaLink'] ?? null,
      nextLink: payload['@odata.nextLink'] ?? null,
    };
  }

  async moveToProcessed(mailbox: string, messageId: string): Promise<void> {
    const folderId = await this.resolveProcessedFolderId(mailbox);
    await this.request(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}` +
        `/messages/${encodeURIComponent(messageId)}/move`,
      {
        method: 'POST',
        body: JSON.stringify({ destinationId: folderId }),
        headers: { 'content-type': 'application/json' },
      },
    );
  }

  /** The Processed folder's id, created on first use if it does not exist. */
  private async resolveProcessedFolderId(mailbox: string): Promise<string> {
    if (this.processedFolderId) {
      return this.processedFolderId;
    }
    const base =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}` +
      '/mailFolders';
    const existing = await this.request<{ value?: { id: string; displayName: string }[] }>(
      `${base}?$filter=${encodeURIComponent(`displayName eq '${PROCESSED_FOLDER}'`)}`,
      { method: 'GET' },
    );
    const found = existing.value?.[0]?.id;
    if (found) {
      this.processedFolderId = found;
      return found;
    }
    const created = await this.request<{ id: string }>(base, {
      method: 'POST',
      body: JSON.stringify({ displayName: PROCESSED_FOLDER }),
      headers: { 'content-type': 'application/json' },
    });
    this.processedFolderId = created.id;
    return created.id;
  }

  /** Reduce Graph's message shape to ours. Null when it is unusable. */
  private toMessage(raw: unknown): GraphMailMessage | null {
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }
    const item = raw as Record<string, unknown>;
    // A delta page reports deletions as `@removed`. Nothing to ingest.
    if ('@removed' in item) {
      return null;
    }
    const id = typeof item.id === 'string' ? item.id : null;
    const internetMessageId =
      typeof item.internetMessageId === 'string' ? item.internetMessageId : null;
    if (!id || !internetMessageId) {
      return null;
    }
    const headers = this.readHeaders(item.internetMessageHeaders);
    const body = item.body as { content?: unknown; contentType?: unknown } | undefined;
    // ⚠️ CARD 1.62. THE FIELD IS CALLED `bodyText` AND MUST ACTUALLY BE TEXT.
    //
    // It used to be `body.content` regardless, and for anything sent from
    // Outlook that is a complete HTML document - so the first real reply this
    // worker ingested showed an agent 5,325 characters of markup where one
    // sentence should have been. `contentType` was read into scope on the line
    // above and then never used; it is the thing to branch on.
    //
    // ⚠️ Converting HERE, at the boundary, is what also fixes the ticket
    // DESCRIPTION (fault C): `inbound-email.service.ts` writes `payload.body`
    // into a column carrying `Ticket_description_trgm_idx`, so markup landing
    // there would put `font-family` and a confidentiality footer into ticket
    // search for every email ticket. One conversion, before the value leaves
    // this class, and neither the message nor the description can be markup.
    //
    // The old expression was a ternary on `bodyPreview.trim()` that looked
    // like a choice and was not - both arms took `body.content` first, so the
    // preview was reached only when content was missing. That behaviour is
    // KEPT, because a body with no content and a usable preview is still worth
    // showing; it is just written so it says so.
    const bodyText = selectBodyText(body, item.bodyPreview);
    // ⚠️ CARD 1.129 FAULT B: the same content, BEFORE the conversion above
    // threw the `cid:` references away. Kept only for mapping a pasted image
    // back to its place in the sentence; nothing stores it.
    const bodyContentType =
      typeof body?.contentType === 'string' ? body.contentType.toLowerCase() : '';
    const bodyHtml =
      bodyContentType === 'html' && typeof body?.content === 'string'
        ? body.content
        : null;
    return {
      id,
      internetMessageId,
      subject: typeof item.subject === 'string' ? item.subject : '(no subject)',
      bodyText,
      bodyHtml,
      from: this.toRecipient(item.from) ?? { address: '' },
      toRecipients: this.toRecipients(item.toRecipients),
      ccRecipients: this.toRecipients(item.ccRecipients),
      // Both spellings appear in the wild depending on the relay.
      deliveredTo: [
        ...(headers['delivered-to'] ?? []),
        ...(headers['x-original-to'] ?? []),
      ],
      inReplyTo: headers['in-reply-to']?.[0] ?? null,
      references: headers['references']?.[0] ?? null,
      autoSubmitted: headers['auto-submitted']?.[0] ?? null,
      autoResponseSuppress: headers['x-auto-response-suppress']?.[0] ?? null,
      precedence: headers['precedence']?.[0] ?? null,
      listId: headers['list-id']?.[0] ?? null,
      returnPath: headers['return-path']?.[0] ?? null,
      // ⚠️ CARD 1.116: A FLAG, BECAUSE THE LIST WAS ALWAYS A LIE.
      // This used to be `this.toAttachments(item.attachments)`. `attachments`
      // is a navigation property: a delta query does not return it and does not
      // support `$expand`, so `item.attachments` was ALWAYS undefined and the
      // array was ALWAYS empty. Every emailed image since this worker shipped
      // was left in the mailbox, and an empty array is indistinguishable from
      // "no attachments", which is why nothing ever reported a problem.
      //
      // `hasAttachments` IS returned by delta. The worker asks separately.
      hasAttachments: item.hasAttachments === true,
    };
  }

  private readHeaders(raw: unknown): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    if (!Array.isArray(raw)) {
      return out;
    }
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue;
      const header = entry as { name?: unknown; value?: unknown };
      if (typeof header.name !== 'string' || typeof header.value !== 'string') {
        continue;
      }
      const key = header.name.toLowerCase();
      out[key] = [...(out[key] ?? []), header.value];
    }
    return out;
  }

  private toRecipients(raw: unknown): GraphRecipient[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((entry) => this.toRecipient(entry))
      .filter((entry): entry is GraphRecipient => entry !== null);
  }

  private toRecipient(raw: unknown): GraphRecipient | null {
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }
    const wrapper = raw as { emailAddress?: { address?: unknown; name?: unknown } };
    const address = wrapper.emailAddress?.address;
    if (typeof address !== 'string' || !address) {
      return null;
    }
    const name = wrapper.emailAddress?.name;
    return { address, name: typeof name === 'string' ? name : null };
  }

  /**
   * One message's attachments, described but not downloaded (card 1.116).
   *
   * ⚠️ `$select` KEEPS `contentBytes` OUT OF THIS RESPONSE. Without it Graph
   * returns the content of every attachment inline, which is the cost this call
   * exists to avoid: the worker wants to know what is there before deciding
   * what is worth fetching.
   *
   * `itemAttachment` and `referenceAttachment` have no file content to store,
   * so only `fileAttachment` comes back.
   */
  async listAttachments(
    mailbox: string,
    messageId: string,
  ): Promise<GraphAttachmentMeta[]> {
    const url =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}` +
      `/messages/${encodeURIComponent(messageId)}/attachments` +
      `?$select=${encodeURIComponent('id,name,contentType,size,isInline')}`;
    const payload = await this.request<{ value?: unknown[] }>(url, {
      method: 'GET',
    });
    const out: GraphAttachmentMeta[] = [];
    for (const entry of payload.value ?? []) {
      if (typeof entry !== 'object' || entry === null) continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.id !== 'string' || typeof item.name !== 'string') continue;
      const odataType = item['@odata.type'];
      if (
        typeof odataType === 'string' &&
        !odataType.endsWith('fileAttachment')
      ) {
        continue;
      }
      out.push({
        id: item.id,
        name: item.name,
        contentType:
          typeof item.contentType === 'string'
            ? item.contentType
            : 'application/octet-stream',
        sizeBytes: typeof item.size === 'number' ? item.size : 0,
        isInline: item.isInline === true,
      });
    }
    return out;
  }

  /**
   * One attachment's content as base64 (card 1.116).
   *
   * Fetched by id, one file at a time, only for files the worker has already
   * decided to keep.
   *
   * ⚠️ NO `$select` HERE, AND THAT IS THE POINT (card 1.119). This used to ask
   * for `?$select=contentBytes` and Graph answered **400 BadRequest** every
   * time: *"Could not find a property named 'contentBytes' on type
   * 'microsoft.graph.attachment'."* `contentBytes` belongs to the derived
   * `fileAttachment` type, and OData will not select a derived property off the
   * base type without a cast. So every download failed, silently enough that
   * the email still landed — card 1.105 doing its job — with no files on it.
   *
   * `?$select=microsoft.graph.fileAttachment/contentBytes` also works and was
   * verified to return byte-identical content. Plain GET is preferred because
   * the response is one attachment either way, so the projection buys nothing
   * and the cast is one more thing to get wrong.
   *
   * ⚠️ DO NOT use Graph's `size` as the byte length. Measured on five real
   * files, `size` runs about **2x** the decoded length — it describes the
   * stored MIME representation, not the file. `inbound-mailbox.service.ts`
   * decodes and measures instead, which is what keeps the exact-byte-match in
   * `inbound-email.service.ts` from rejecting every attachment.
   */
  async fetchAttachmentContent(
    mailbox: string,
    messageId: string,
    attachmentId: string,
  ): Promise<GraphAttachmentContent> {
    const url =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}` +
      `/messages/${encodeURIComponent(messageId)}` +
      `/attachments/${encodeURIComponent(attachmentId)}`;
    const payload = await this.request<{
      contentBytes?: unknown;
      contentId?: unknown;
    }>(url, {
      method: 'GET',
    });
    if (typeof payload.contentBytes !== 'string' || !payload.contentBytes) {
      throw new Error('Graph returned no content for the attachment');
    }
    return {
      contentBytes: payload.contentBytes,
      // ⚠️ CARD 1.129 FAULT B. Free: the plain GET above already returns the
      // whole resource, so this is read from a response that was paid for.
      // ⚠️ THE ANGLE BRACKETS COME OFF HERE. Graph returns the raw
      // `Content-ID` header, which by RFC 2392 is often `<abc@def>`, while the
      // body refers to it as `src="cid:abc@def"`. Comparing the two without
      // this never matches, and never matching looks exactly like "the sender
      // did not paste an image".
      contentId: normaliseContentId(payload.contentId),
    };
  }

  /** One Graph call, with a bearer token and a timeout. Throws on failure. */
  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const token = await this.getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        // ⚠️ 403 here is the shape a missing or UNSCOPED Application Access
        // Policy takes. Named explicitly because it is the security decision
        // on this card and the operator needs to recognise it instantly.
        throw new Error(
          `Graph ${init.method ?? 'GET'} ${response.status}: ${detail.slice(0, 300)}`,
        );
      }
      if (response.status === 204) {
        return {} as T;
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Client-credentials token, cached until shortly before it expires. */
  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.token;
    }
    const tenant = this.config.get<string>('AZURE_TENANT_ID');
    const clientId = this.config.get<string>('AZURE_CLIENT_ID');
    const secret = this.config.get<string>('AZURE_CLIENT_SECRET');
    if (!tenant || !clientId || !secret) {
      throw new Error(`Graph is not configured: ${this.describeConfiguration()}`);
    }
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const response = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      },
    );
    if (!response.ok) {
      throw new Error(`Graph token request failed: ${response.status}`);
    }
    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!payload.access_token) {
      throw new Error('Graph token response carried no access_token');
    }
    this.tokenCache = {
      token: payload.access_token,
      expiresAt: now + (payload.expires_in ?? 3600) * 1000,
    };
    this.logger.log('Acquired a Graph token for the inbound mailbox worker');
    return payload.access_token;
  }
}
