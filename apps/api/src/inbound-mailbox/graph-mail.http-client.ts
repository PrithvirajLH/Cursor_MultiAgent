import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GraphAttachment,
  GraphDeltaPage,
  GraphMailClient,
  GraphMailMessage,
  GraphRecipient,
} from './graph-mail.client';

/** Where the consumed mail is filed, so the mailbox shows what was taken. */
const PROCESSED_FOLDER = 'Processed';
/** Graph page size. A helpdesk mailbox sees a few hundred messages a day. */
const PAGE_SIZE = 50;
/** Give up on a single Graph call rather than wedging the poll. */
const REQUEST_TIMEOUT_MS = 20_000;

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
    const bodyText =
      typeof item.bodyPreview === 'string' && item.bodyPreview.trim()
        ? String(body?.content ?? item.bodyPreview)
        : String(body?.content ?? '');
    return {
      id,
      internetMessageId,
      subject: typeof item.subject === 'string' ? item.subject : '(no subject)',
      bodyText,
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
      attachments: this.toAttachments(item.attachments),
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

  private toAttachments(raw: unknown): GraphAttachment[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const out: GraphAttachment[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.name !== 'string') continue;
      out.push({
        name: item.name,
        contentType:
          typeof item.contentType === 'string'
            ? item.contentType
            : 'application/octet-stream',
        sizeBytes: typeof item.size === 'number' ? item.size : 0,
        contentBytes:
          typeof item.contentBytes === 'string' ? item.contentBytes : null,
      });
    }
    return out;
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
