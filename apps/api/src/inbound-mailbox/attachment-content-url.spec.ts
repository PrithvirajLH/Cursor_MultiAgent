import { ConfigService } from '@nestjs/config';
import { GraphMailHttpClient } from './graph-mail.http-client';

/**
 * Card 1.119 — the attachment download URL must carry no `$select`.
 *
 * `fetchAttachmentContent` asked Graph for
 * `/attachments/{id}?$select=contentBytes` and got **400 BadRequest** every
 * time: *"Could not find a property named 'contentBytes' on type
 * 'microsoft.graph.attachment'."* `contentBytes` is a property of the derived
 * `fileAttachment` type, and OData will not project a derived property off the
 * base type without a cast.
 *
 * Measured against production on 2026-09-16: five real attachments, five 400s,
 * zero `Attachment` rows — while the email itself still landed, because card
 * 1.105 refuses to lose an email over a bad file. That is what made this
 * invisible: the summary read `failed=0 error=null`.
 *
 * These cases pin the URL, so re-adding the projection fails here rather than
 * in production.
 */
describe('fetchAttachmentContent URL (card 1.119)', () => {
  const MAILBOX = 'glovebox@csnhc.com';
  const MESSAGE_ID = 'AAMkAGI2=';
  const ATTACHMENT_ID = 'AAMkAGI2xyz=';
  let client: GraphMailHttpClient;
  let requested: string[];

  beforeEach(() => {
    const config = {
      get: (key: string) =>
        ({
          AZURE_TENANT_ID: 'tenant',
          AZURE_CLIENT_ID: 'client',
          AZURE_CLIENT_SECRET: 'secret',
        })[key],
    } as unknown as ConfigService;
    client = new GraphMailHttpClient(config);
    requested = [];
    // Stand in for the token call and the attachment call, recording every URL.
    jest
      .spyOn(
        client as unknown as { request: (url: string, init: unknown) => unknown },
        'request',
      )
      .mockImplementation(async (url: string) => {
        requested.push(url);
        return { contentBytes: 'aGVsbG8=' };
      });
  });

  it('does not ask for a $select at all', async () => {
    await client.fetchAttachmentContent(MAILBOX, MESSAGE_ID, ATTACHMENT_ID);
    expect(requested).toHaveLength(1);
    expect(requested[0]).not.toContain('$select');
    expect(requested[0]).not.toContain('%24select');
  });

  it('never names contentBytes in the query string', async () => {
    await client.fetchAttachmentContent(MAILBOX, MESSAGE_ID, ATTACHMENT_ID);
    const [url] = requested;
    const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
    expect(query).toBe('');
  });

  it('addresses the attachment by id under its message', async () => {
    await client.fetchAttachmentContent(MAILBOX, MESSAGE_ID, ATTACHMENT_ID);
    expect(requested[0]).toBe(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}` +
        `/messages/${encodeURIComponent(MESSAGE_ID)}` +
        `/attachments/${encodeURIComponent(ATTACHMENT_ID)}`,
    );
  });

  it('returns the base64 Graph gave back', async () => {
    const content = await client.fetchAttachmentContent(
      MAILBOX,
      MESSAGE_ID,
      ATTACHMENT_ID,
    );
    expect(content).toBe('aGVsbG8=');
  });

  it('refuses an empty body rather than storing a zero-byte file', async () => {
    jest
      .spyOn(
        client as unknown as { request: (url: string, init: unknown) => unknown },
        'request',
      )
      .mockImplementation(async () => ({ contentBytes: '' }));
    await expect(
      client.fetchAttachmentContent(MAILBOX, MESSAGE_ID, ATTACHMENT_ID),
    ).rejects.toThrow('Graph returned no content');
  });
});
