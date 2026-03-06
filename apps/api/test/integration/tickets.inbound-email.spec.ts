import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { buildOutboundMessageId } from '../../src/notifications/email-threading.util';
import {
  fixtureEmails,
  fixtureTeamIds,
  fixtureUserIds,
} from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

const inboundSecretHeader = { 'x-inbound-email-secret': 'test-inbound-secret' };
const scanSecretHeader = { 'x-attachment-scan-secret': 'test-scan-secret' };

type TicketResponse = {
  id: string;
  subject?: string | null;
  displayId?: string | null;
  status?: string | null;
  channel?: string | null;
  requester?: { email?: string | null } | null;
  attachments?: Array<{
    id: string;
    fileName: string;
  }>;
};

type InboundEmailResponse = {
  threaded: boolean;
  ticket: TicketResponse;
};

type TicketMessagesResponse = {
  data: Array<{ body: string }>;
};

type TicketListResponse = {
  data: Array<{ subject: string }>;
};

function getOutboxHtml(payload: unknown): string | null {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    return null;
  }

  const content = (payload as { content?: unknown }).content;
  if (!content || Array.isArray(content) || typeof content !== 'object') {
    return null;
  }

  const html = (content as { html?: unknown }).html;
  return typeof html === 'string' ? html : null;
}

async function createTicket(
  server: SupertestApp,
  subject: string,
): Promise<TicketResponse> {
  const response = await request(server)
    .post('/api/tickets')
    .set(authHeader(fixtureEmails.requester))
    .send({
      subject,
      description: 'Inbound email threading test ticket',
      priority: 'P3',
      channel: 'PORTAL',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);
  return response.body as TicketResponse;
}

describe('Inbound email ingestion', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let prisma: PrismaService;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects inbound ingestion when webhook secret is missing or invalid', async () => {
    const messageId = `missing-secret-${Date.now()}@mail.example`;
    const payload = {
      fromEmail: `missing.secret.${Date.now()}@example.com`,
      fromName: 'Missing Secret',
      subject: 'Inbound auth check',
      body: 'Please create a ticket from this email.',
      messageId,
    };

    await request(server)
      .post('/api/tickets/inbound-email')
      .send(payload)
      .expect(403);

    await request(server)
      .post('/api/tickets/inbound-email')
      .set('x-inbound-email-secret', 'wrong-secret')
      .send(payload)
      .expect(403);
  });

  it('creates a new EMAIL ticket when no display id is present', async () => {
    const inboundEmail = `new.inbound.${Date.now()}@example.com`;
    const subject = `Inbound create ${Date.now()}`;

    const response = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: inboundEmail,
        fromName: 'Inbound Requester',
        subject,
        body: 'My workstation cannot connect to VPN.',
        messageId: `create-${Date.now()}@mail.example`,
      })
      .expect(201);

    const body = response.body as InboundEmailResponse;
    expect(body.threaded).toBe(false);
    expect(body.ticket.subject).toBe(subject);
    expect(body.ticket.channel).toBe('EMAIL');
    expect(body.ticket.requester?.email).toBe(inboundEmail.toLowerCase());
  });

  it('acknowledges new inbound tickets with the ticket id and reply instructions', async () => {
    const inboundEmail = `ack.inbound.${Date.now()}@example.com`;
    const subject = `Need help ${Date.now()}`;
    const response = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: inboundEmail,
        fromName: 'Ack Requester',
        subject,
        body: 'Please confirm you received this request.',
        messageId: `ack-${Date.now()}@mail.example`,
      })
      .expect(201);

    const body = response.body as InboundEmailResponse;
    const outbox = await prisma.notificationOutbox.findMany({
      where: {
        ticketId: body.ticket.id,
        toEmail: inboundEmail.toLowerCase(),
        eventType: 'INBOUND_EMAIL_ACKNOWLEDGED',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.subject).toBe(
      `${subject} [${body.ticket.displayId ?? body.ticket.id}]`,
    );
    expect(outbox[0]?.body).toContain('Hello Ack Requester,');
    expect(outbox[0]?.body).toContain('What happens next');
    expect(outbox[0]?.body).toContain('Status: New');
    const html = getOutboxHtml(outbox[0]?.payload);
    expect(html).toContain('Request received');
    expect(html).toContain('What happens next');
    expect(html).toContain('View Ticket');
  });

  it('ingests inbound attachments for a newly created EMAIL ticket', async () => {
    const subject = `Inbound attachment create ${Date.now()}`;
    const attachmentBody = `log line ${Date.now()}`;
    const attachmentBase64 = Buffer.from(attachmentBody, 'utf8').toString(
      'base64',
    );

    const response = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: `attachment.create.${Date.now()}@example.com`,
        fromName: 'Attachment Requester',
        subject,
        body: 'Please review the attached file.',
        messageId: `attachment-create-${Date.now()}@mail.example`,
        attachments: [
          {
            fileName: 'inbound-log.txt',
            contentType: 'text/plain',
            sizeBytes: Buffer.byteLength(attachmentBody, 'utf8'),
            contentBase64: attachmentBase64,
          },
        ],
      })
      .expect(201);

    const body = response.body as InboundEmailResponse;
    const detail = await request(server)
      .get(`/api/tickets/${body.ticket.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const detailBody = detail.body as TicketResponse;
    expect(detailBody.attachments?.length).toBe(1);

    const attachment = detailBody.attachments?.[0];
    expect(attachment?.fileName).toBe('inbound-log.txt');
    if (!attachment) {
      throw new Error('Expected inbound attachment to be present');
    }

    await request(server)
      .post(`/api/attachments/${attachment.id}/scan-status`)
      .set(scanSecretHeader)
      .send({ status: 'CLEAN' })
      .expect(201);

    const download = await request(server)
      .get(`/api/attachments/${attachment.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    expect(download.text).toContain(attachmentBody);
  });

  it('threads by display id and reopens a closed ticket', async () => {
    const created = await createTicket(server, `Inbound thread ${Date.now()}`);
    expect(created.displayId).toBeTruthy();

    await request(server)
      .post(`/api/tickets/${created.id}/transition`)
      .set(authHeader(fixtureEmails.owner))
      .send({ status: 'TRIAGED' })
      .expect(201);

    await request(server)
      .post(`/api/tickets/${created.id}/assign`)
      .set(authHeader(fixtureEmails.owner))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(201);

    await request(server)
      .post(`/api/tickets/${created.id}/transition`)
      .set(authHeader(fixtureEmails.owner))
      .send({ status: 'RESOLVED' })
      .expect(201);

    await request(server)
      .post(`/api/tickets/${created.id}/transition`)
      .set(authHeader(fixtureEmails.owner))
      .send({ status: 'CLOSED' })
      .expect(201);

    const inboundBody = `Follow-up ${Date.now()}: issue persists`;
    const threadedAttachment = `thread-attachment-${Date.now()}`;
    const threadedResponse = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: fixtureEmails.requester,
        fromName: 'Existing Requester',
        subject: `Re: ${created.displayId} update`,
        body: inboundBody,
        messageId: `thread-${Date.now()}@mail.example`,
        attachments: [
          {
            fileName: 'thread-reply.txt',
            contentType: 'text/plain',
            sizeBytes: Buffer.byteLength(threadedAttachment, 'utf8'),
            contentBase64: Buffer.from(threadedAttachment, 'utf8').toString(
              'base64',
            ),
          },
        ],
      })
      .expect(201);

    const threaded = threadedResponse.body as InboundEmailResponse;
    expect(threaded.threaded).toBe(true);
    expect(threaded.ticket.id).toBe(created.id);
    expect(threaded.ticket.status).toBe('REOPENED');

    const messagesResponse = await request(server)
      .get(`/api/tickets/${created.id}/messages`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const messagesBody = messagesResponse.body as TicketMessagesResponse;
    expect(
      messagesBody.data.some((message) => message.body === inboundBody),
    ).toBe(true);

    const detail = await request(server)
      .get(`/api/tickets/${created.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const detailBody = detail.body as TicketResponse;
    expect(
      detailBody.attachments?.some(
        (attachment) => attachment.fileName === 'thread-reply.txt',
      ),
    ).toBe(true);
  });

  it('threads replies by outbound email headers even when the subject changes', async () => {
    const created = await createTicket(server, `Header thread ${Date.now()}`);
    const agentReply = [
      `Agent follow-up ${Date.now()}: please restart your VPN client.`,
      'If the issue continues, send a screenshot.',
      'We will keep the ticket open while you test.',
    ].join('\n');

    await request(server)
      .post(`/api/tickets/${created.id}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .send({ body: agentReply, type: 'PUBLIC' })
      .expect(201);

    const outbox = await prisma.notificationOutbox.findFirst({
      where: {
        ticketId: created.id,
        toEmail: fixtureEmails.requester,
        eventType: 'MESSAGE_ADDED',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(outbox).toBeTruthy();
    expect(outbox?.subject).toBe(
      `${created.subject} [${created.displayId ?? created.id}]`,
    );
    expect(outbox?.body).toContain(agentReply);
    expect(outbox?.body).toContain('Reply to this email');
    const html = getOutboxHtml(outbox?.payload);
    expect(html).toContain('Update on your request');
    expect(html).toContain('Ticket details');
    expect(html).toContain('background:#f8fafc');
    expect(html).toContain('View Ticket');

    const threadedReply = `Reply from inbox ${Date.now()}: the restart worked.`;
    const outboundMessageId = buildOutboundMessageId(
      outbox!.id,
      process.env.SMTP_REPLY_TO ?? process.env.SMTP_FROM ?? undefined,
    );

    const threadedResponse = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: fixtureEmails.requester,
        fromName: 'Existing Requester',
        subject: `Re: follow-up ${Date.now()}`,
        body: threadedReply,
        messageId: `header-thread-${Date.now()}@mail.example`,
        inReplyTo: outboundMessageId,
      })
      .expect(201);

    const threaded = threadedResponse.body as InboundEmailResponse;
    expect(threaded.threaded).toBe(true);
    expect(threaded.ticket.id).toBe(created.id);

    const messagesResponse = await request(server)
      .get(`/api/tickets/${created.id}/messages`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const messagesBody = messagesResponse.body as TicketMessagesResponse;
    expect(
      messagesBody.data.some((message) => message.body === threadedReply),
    ).toBe(true);
  });

  it('deduplicates webhook retries by messageId', async () => {
    const fromEmail = `retry.${Date.now()}@example.com`;
    const messageId = `retry-${Date.now()}@mail.example`;
    const subject = `Inbound retry ${Date.now()}`;
    const payload = {
      fromEmail,
      fromName: 'Retry Requester',
      subject,
      body: 'Please help with printer access.',
      messageId,
      attachments: [
        {
          fileName: 'retry.txt',
          contentType: 'text/plain',
          sizeBytes: Buffer.byteLength('retry file', 'utf8'),
          contentBase64: Buffer.from('retry file', 'utf8').toString('base64'),
        },
      ],
    };

    const first = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send(payload)
      .expect(201);

    const second = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send(payload)
      .expect(201);

    const firstBody = first.body as InboundEmailResponse;
    const secondBody = second.body as InboundEmailResponse;
    expect(secondBody.ticket.id).toBe(firstBody.ticket.id);
    expect(secondBody.threaded).toBe(firstBody.threaded);

    const list = await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    const listBody = list.body as TicketListResponse;
    const matches = listBody.data.filter((item) => item.subject === subject);
    expect(matches).toHaveLength(1);

    const detail = await request(server)
      .get(`/api/tickets/${firstBody.ticket.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const detailBody = detail.body as TicketResponse;
    expect(
      detailBody.attachments?.filter((a) => a.fileName === 'retry.txt'),
    ).toHaveLength(1);
  });
});
