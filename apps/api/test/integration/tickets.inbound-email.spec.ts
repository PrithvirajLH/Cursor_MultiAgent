import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { TicketEmailThreadService } from '../../src/notifications/ticket-email-thread.service';
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

function getOutboxEmailMetadata(payload: unknown): {
  replyTo?: string;
  inReplyTo?: string;
  references?: string[];
} {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    return {};
  }

  const email = (payload as { email?: unknown }).email;
  if (!email || Array.isArray(email) || typeof email !== 'object') {
    return {};
  }

  return {
    replyTo:
      typeof (email as { replyTo?: unknown }).replyTo === 'string'
        ? ((email as { replyTo?: string }).replyTo ?? undefined)
        : undefined,
    inReplyTo:
      typeof (email as { inReplyTo?: unknown }).inReplyTo === 'string'
        ? ((email as { inReplyTo?: string }).inReplyTo ?? undefined)
        : undefined,
    references: Array.isArray((email as { references?: unknown }).references)
      ? ((email as { references?: string[] }).references ?? [])
      : undefined,
  };
}

function expectedReplyToPattern() {
  const base =
    process.env.SMTP_REPLY_TO ?? process.env.SMTP_FROM ?? 'no-reply@localhost';
  const match = base.match(/<([^<>]+)>/);
  const email = (match?.[1] ?? base).trim().toLowerCase();
  const atIndex = email.lastIndexOf('@');
  const localPart = atIndex > 0 ? email.slice(0, atIndex) : 'no-reply';
  const domain = atIndex > 0 ? email.slice(atIndex + 1) : 'localhost';
  const escapedLocal = localPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^${escapedLocal}\\+ticket-[A-Za-z0-9_-]+@${escapedDomain}$`,
    'i',
  );
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
      priority: 'SEV3',
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
    const inboundMessageId = `ack-${Date.now()}@mail.example`;
    const response = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: inboundEmail,
        fromName: 'Ack Requester',
        subject,
        body: 'Please confirm you received this request.',
        messageId: inboundMessageId,
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
    const emailMetadata = getOutboxEmailMetadata(outbox[0]?.payload);
    expect(html).toContain('Request received');
    expect(html).toContain('What happens next');
    expect(html).toContain('View Ticket');
    expect(emailMetadata.replyTo).toMatch(expectedReplyToPattern());
    expect(emailMetadata.inReplyTo).toBe(inboundMessageId);
    expect(emailMetadata.references).toContain(inboundMessageId);

    const thread = await prisma.ticketEmailThread.findUnique({
      where: { ticketId: body.ticket.id },
    });
    expect(thread).toBeTruthy();
    expect(thread?.canonicalSubject).toBe(subject);
    expect(thread?.rootInboundMessageId).toBe(inboundMessageId);
    expect(thread?.lastInboundMessageId).toBe(inboundMessageId);
  });

  it('keeps requester notifications anchored to the original inbound email thread after transfer', async () => {
    const inboundEmail = fixtureEmails.requester;
    const subject = `Transfer thread ${Date.now()}`;
    const inboundMessageId = `transfer-thread-${Date.now()}@mail.example`;

    const response = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: inboundEmail,
        fromName: 'Threaded Requester',
        subject,
        body: 'VPN access is still failing after restart.',
        messageId: inboundMessageId,
      })
      .expect(201);

    const created = response.body as InboundEmailResponse;

    await request(server)
      .post(`/api/tickets/${created.ticket.id}/assign`)
      .set(authHeader(fixtureEmails.owner))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(201);

    await request(server)
      .post(`/api/tickets/${created.ticket.id}/transfer`)
      .set(authHeader(fixtureEmails.owner))
      .send({ newTeamId: fixtureTeamIds.hr })
      .expect(201);

    await request(server)
      .post(`/api/tickets/${created.ticket.id}/messages`)
      .set(authHeader(fixtureEmails.owner))
      .send({
        body: `Transfer follow-up ${Date.now()}: the new team is reviewing this now.`,
        type: 'PUBLIC',
      })
      .expect(201);

    const requesterOutbox = await prisma.notificationOutbox.findMany({
      where: {
        ticketId: created.ticket.id,
        toEmail: inboundEmail,
        eventType: {
          in: ['TICKET_TRANSFERRED', 'TICKET_STATUS_CHANGED', 'MESSAGE_ADDED'],
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    expect(requesterOutbox).toHaveLength(3);

    const transferOutbox = requesterOutbox.find(
      (entry) => entry.eventType === 'TICKET_TRANSFERRED',
    );
    const statusOutbox = requesterOutbox.find(
      (entry) => entry.eventType === 'TICKET_STATUS_CHANGED',
    );
    const replyOutbox = requesterOutbox.find(
      (entry) => entry.eventType === 'MESSAGE_ADDED',
    );

    expect(transferOutbox).toBeTruthy();
    expect(statusOutbox).toBeTruthy();
    expect(replyOutbox).toBeTruthy();

    const assignedOutbox = await prisma.notificationOutbox.findFirst({
      where: {
        ticketId: created.ticket.id,
        toEmail: fixtureEmails.agent,
        eventType: 'TICKET_ASSIGNED',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(assignedOutbox).toBeTruthy();

    const transferMetadata = getOutboxEmailMetadata(transferOutbox?.payload);
    const statusMetadata = getOutboxEmailMetadata(statusOutbox?.payload);
    const replyMetadata = getOutboxEmailMetadata(replyOutbox?.payload);
    const assignedHtml = getOutboxHtml(assignedOutbox?.payload);
    const transferHtml = getOutboxHtml(transferOutbox?.payload);
    const statusHtml = getOutboxHtml(statusOutbox?.payload);

    expect(transferMetadata.inReplyTo).toBe(inboundMessageId);
    expect(statusMetadata.inReplyTo).toBe(inboundMessageId);
    expect(replyMetadata.inReplyTo).toBe(inboundMessageId);
    expect(transferMetadata.references).toContain(inboundMessageId);
    expect(statusMetadata.references).toContain(inboundMessageId);
    expect(replyMetadata.references).toContain(inboundMessageId);

    const transferMessageId = buildOutboundMessageId(
      transferOutbox!.id,
      transferMetadata.replyTo,
    );
    expect(statusMetadata.inReplyTo).not.toBe(transferMessageId);
    expect(replyMetadata.inReplyTo).not.toBe(transferMessageId);

    expect(assignedHtml).toContain('Assignment updated');
    expect(assignedHtml).toContain('View Ticket');
    expect(transferHtml).toContain('Ticket transferred');
    expect(transferHtml).toContain('View Ticket');
    expect(statusHtml).toContain('Status updated');
    expect(statusHtml).toContain('View Ticket');
  });

  it('threads consecutive outbound status notifications for portal-created tickets', async () => {
    const created = await createTicket(
      server,
      `Outbound status thread ${Date.now()}`,
    );

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

    await request(server)
      .post(`/api/tickets/${created.id}/transition`)
      .set(authHeader(fixtureEmails.owner))
      .send({ status: 'REOPENED' })
      .expect(201);

    await request(server)
      .post(`/api/tickets/${created.id}/transition`)
      .set(authHeader(fixtureEmails.owner))
      .send({ status: 'RESOLVED' })
      .expect(201);

    // A single transition fans out a notification to EVERY recipient (here the
    // requester AND the assigned agent). queueEmails reserves the thread anchor
    // for each recipient in parallel (Promise.all), so the
    // thread.lastOutboundMessageId that the NEXT transition threads against is
    // whichever recipient's reservation happened to land last — it is NOT
    // guaranteed to be the requester's copy. The two copies for a given step
    // share the same outbound message-id candidates, so assert that the next
    // step replies to ONE of the prior step's notifications rather than
    // hard-coding the requester's copy (which made this test depend on a
    // nondeterministic reservation race — see FLAG in the report).
    const statusOutbox = await prisma.notificationOutbox.findMany({
      where: {
        ticketId: created.id,
        eventType: 'TICKET_STATUS_CHANGED',
      },
      orderBy: { createdAt: 'asc' },
    });

    const stepMessageIds = (fragment: string) =>
      statusOutbox
        .filter((entry) => entry.body.includes(fragment))
        .map((entry) =>
          buildOutboundMessageId(
            entry.id,
            getOutboxEmailMetadata(entry.payload).replyTo,
          ),
        );
    const requesterStep = (fragment: string) =>
      statusOutbox.find(
        (entry) =>
          entry.toEmail === fixtureEmails.requester &&
          entry.body.includes(fragment),
      );

    const closedMessageIds = stepMessageIds(
      'Status changed from RESOLVED to CLOSED.',
    );
    const reopenedMessageIds = stepMessageIds(
      'Status changed from CLOSED to REOPENED.',
    );
    const reopenedOutbox = requesterStep('Status changed from CLOSED to REOPENED.');
    const resolvedOutbox = requesterStep(
      'Status changed from REOPENED to RESOLVED.',
    );

    expect(closedMessageIds.length).toBeGreaterThan(0);
    expect(reopenedMessageIds.length).toBeGreaterThan(0);
    expect(reopenedOutbox).toBeTruthy();
    expect(resolvedOutbox).toBeTruthy();

    const reopenedMetadata = getOutboxEmailMetadata(reopenedOutbox?.payload);
    const resolvedMetadata = getOutboxEmailMetadata(resolvedOutbox?.payload);

    expect(reopenedMetadata.replyTo).toMatch(expectedReplyToPattern());
    expect(resolvedMetadata.replyTo).toMatch(expectedReplyToPattern());
    // Each step threads onto one of the immediately-preceding step's messages.
    expect(closedMessageIds).toContain(reopenedMetadata.inReplyTo);
    expect(reopenedMetadata.references ?? []).toEqual(
      expect.arrayContaining([reopenedMetadata.inReplyTo]),
    );
    expect(reopenedMessageIds).toContain(resolvedMetadata.inReplyTo);
    expect(resolvedMetadata.references ?? []).toEqual(
      expect.arrayContaining([resolvedMetadata.inReplyTo]),
    );
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

    // The IT team is QUEUE_ONLY, so the portal ticket is created unassigned. A
    // team agent who is not the assignee is a "peer agent" whose messages are
    // forced to INTERNAL (AccessControlService.isPeerAgent); internal notes do
    // not generate a requester MESSAGE_ADDED notification, so there would be no
    // outbound email to thread. Self-assign first so the public reply notifies
    // the requester.
    await request(server)
      .post(`/api/tickets/${created.id}/assign`)
      .set(authHeader(fixtureEmails.agent))
      .send({})
      .expect(201);

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
    const emailMetadata = getOutboxEmailMetadata(outbox?.payload);
    expect(html).toContain('Update on your request');
    expect(html).toContain('Ticket details');
    expect(html).toContain('background:#f8fafc');
    expect(html).toContain('View Ticket');
    expect(emailMetadata.replyTo).toMatch(expectedReplyToPattern());

    const threadedReply = `Reply from inbox ${Date.now()}: the restart worked.`;
    const inboundMessageId = `header-thread-${Date.now()}@mail.example`;
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
        messageId: inboundMessageId,
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

    const thread = await prisma.ticketEmailThread.findUnique({
      where: { ticketId: created.id },
    });
    expect(thread?.lastInboundMessageId).toBe(inboundMessageId);
  });

  it('threads replies by tokenized reply-to even without matching subject or headers', async () => {
    const created = await createTicket(server, `Token thread ${Date.now()}`);
    const agentReply = `Token routing ${Date.now()}: sending a follow-up.`;

    // QUEUE_ONLY IT team => unassigned ticket. Self-assign so the agent is the
    // assignee and their public reply is sent to the requester (a peer agent's
    // messages would be forced to INTERNAL and not notify the requester).
    await request(server)
      .post(`/api/tickets/${created.id}/assign`)
      .set(authHeader(fixtureEmails.agent))
      .send({})
      .expect(201);

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

    const emailMetadata = getOutboxEmailMetadata(outbox?.payload);
    expect(emailMetadata.replyTo).toBeTruthy();

    const inboundReply = `Token reply ${Date.now()}: here are more details.`;
    const threadedResponse = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: fixtureEmails.requester,
        fromName: 'Existing Requester',
        toEmail: emailMetadata.replyTo,
        subject: `Completely different subject ${Date.now()}`,
        body: inboundReply,
        messageId: `token-thread-${Date.now()}@mail.example`,
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
      messagesBody.data.some((message) => message.body === inboundReply),
    ).toBe(true);
  });

  it('creates a new ticket for the same requester when no thread token or headers are present', async () => {
    const created = await createTicket(server, `Same requester ${Date.now()}`);

    await request(server)
      .post(`/api/tickets/${created.id}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .send({ body: 'Initial outbound email context', type: 'PUBLIC' })
      .expect(201);

    const response = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: fixtureEmails.requester,
        fromName: 'Existing Requester',
        subject: `Fresh issue ${Date.now()}`,
        body: 'This should be treated as a new request.',
        messageId: `same-requester-new-ticket-${Date.now()}@mail.example`,
      })
      .expect(201);

    const body = response.body as InboundEmailResponse;
    expect(body.threaded).toBe(false);
    expect(body.ticket.id).not.toBe(created.id);
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

  it('replays the original ticket after a post-persist failure on retry', async () => {
    const fromEmail = `partial.retry.${Date.now()}@example.com`;
    const messageId = `partial-retry-${Date.now()}@mail.example`;
    const subject = `Inbound partial retry ${Date.now()}`;
    const payload = {
      fromEmail,
      fromName: 'Retry Requester',
      subject,
      body: 'Please help with printer access.',
      messageId,
    };

    const ticketEmailThreads = app.get(TicketEmailThreadService);
    const recordSpy = jest
      .spyOn(ticketEmailThreads, 'recordInboundEmail')
      .mockRejectedValueOnce(new Error('simulated post-persist failure'));

    try {
      await request(server)
        .post('/api/tickets/inbound-email')
        .set(inboundSecretHeader)
        .send(payload)
        .expect(500);

      const afterFailure = await prisma.ticket.findMany({
        where: { subject },
        select: { id: true },
      });
      expect(afterFailure).toHaveLength(1);

      const replay = await request(server)
        .post('/api/tickets/inbound-email')
        .set(inboundSecretHeader)
        .send(payload)
        .expect(201);

      const replayBody = replay.body as InboundEmailResponse;
      expect(replayBody.threaded).toBe(false);
      expect(replayBody.ticket.id).toBe(afterFailure[0]?.id);

      const afterRetry = await prisma.ticket.findMany({
        where: { subject },
        select: { id: true },
      });
      expect(afterRetry).toHaveLength(1);
    } finally {
      recordSpy.mockRestore();
    }
  });
});
