import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { TicketEmailThreadService } from '../../src/notifications/ticket-email-thread.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  buildOutboundMessageId,
  buildTicketRootMessageId,
} from '../../src/notifications/email-threading.util';
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
    // REWRITTEN BY CARD 1.42: the "What happens next" block is deleted - it
    // promised only that we would respond - along with the Ticket details
    // block and the sign-off. What is left is the reference and how to reply.
    expect(outbox[0]?.body).toContain('We have your email');
    expect(outbox[0]?.body).toContain('Your reference is');
    expect(outbox[0]?.body).not.toContain('Best regards');
    // No status line at all now. It read "Status: New", which told a requester
    // nothing and is the shape card 1.42 forbids reaching them.
    expect(outbox[0]?.body).not.toContain('Status:');
    const html = getOutboxHtml(outbox[0]?.payload);
    const emailMetadata = getOutboxEmailMetadata(outbox[0]?.payload);
    // The heading, the "What happens next" panel and the hero button are all
    // deleted (card 1.34's treatment, applied by 1.42). A hidden preheader
    // takes their place, and it is asserted on its style attribute because a
    // preheader that is not really hidden is a duplicated visible line.
    expect(html).not.toContain('Request received');
    expect(html).not.toContain('What happens next');
    expect(html).not.toContain('View Ticket');
    // ⚠️ INVERTED BY CARD 1.68. The footer is gone from all five emails. The
    // preheader assertion below is NOT part of it and stays - that is card
    // 1.35, and it is the whole inbox preview.
    expect(html).not.toContain('view online');
    expect(html).not.toContain('Reply to this email');
    expect(html).toContain(
      'display:none;font-size:0;line-height:0;max-height:0;overflow:hidden;mso-hide:all;',
    );
    expect(emailMetadata.replyTo).toMatch(expectedReplyToPattern());
    // UPDATED BY CARD 1.43, and the second of the two tests that pinned the
    // unbracketed acknowledgement header. Both used to assert the BARE id;
    // buildOutboundEmailContext now brackets `preferredInReplyTo` once and uses
    // that for In-Reply-To and References alike, as RFC 5322 requires.
    //
    // References changed too, and it is worth being precise about why the old
    // assertion passed: the bare id went in from preferredInReplyTo while the
    // ancestry contributed the same id bracketed, so the header carried the
    // pair. Now there is one entry, in the correct form.
    const bracketedInbound = `<${inboundMessageId}>`;
    expect(emailMetadata.inReplyTo).toBe(bracketedInbound);
    expect(emailMetadata.references).toContain(bracketedInbound);
    expect(emailMetadata.references).not.toContain(inboundMessageId);

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

    // REWRITTEN BY CARD 1.42, and the rewrite is most of the point of that card.
    //
    // This used to assert that a transfer, a status change and a reply each
    // produced an email to the requester, and that all three threaded. Two of
    // those three emails no longer exist: a transfer is an internal routing
    // decision and a non-RESOLVED status change is a note to ourselves. What
    // survives is the inbound acknowledgement and the public reply.
    //
    // The threading contract it was written to protect (card 1.33) is asserted
    // in full below on the emails that remain, so the coverage moves rather
    // than disappearing.
    const surviving = await prisma.notificationOutbox.findMany({
      where: { ticketId: created.ticket.id, toEmail: inboundEmail },
      orderBy: { createdAt: 'asc' },
    });
    expect(surviving.map((entry) => entry.eventType)).toEqual([
      'INBOUND_EMAIL_ACKNOWLEDGED',
      'MESSAGE_ADDED',
    ]);

    // THE DELETIONS, ASSERTED AS ABSENCES (card 1.42 §7). A count, not a
    // response code - a count is what catches a re-introduction.
    const deleted = await prisma.notificationOutbox.findMany({
      where: {
        ticketId: created.ticket.id,
        eventType: {
          in: [
            'TICKET_ASSIGNED',
            'TICKET_TRANSFERRED',
            'TICKET_STATUS_CHANGED',
          ],
        },
      },
    });
    expect(deleted).toHaveLength(0);

    // AND THE OTHER HALF: staff must still be told, in the app. This is the
    // assertion most likely to be lost by accident, which is why it sits
    // directly beside the absence above.
    const assignedBell = await prisma.notification.findMany({
      where: {
        ticketId: created.ticket.id,
        type: 'TICKET_ASSIGNED',
        userId: fixtureUserIds.agent,
      },
    });
    expect(assignedBell).toHaveLength(1);
    const transferBell = await prisma.notification.findMany({
      where: { ticketId: created.ticket.id, type: 'TICKET_TRANSFERRED' },
    });
    expect(transferBell.length).toBeGreaterThan(0);

    const ackOutbox = surviving[0];
    const replyOutbox = surviving[1];
    const ackMetadata = getOutboxEmailMetadata(ackOutbox.payload);
    const replyMetadata = getOutboxEmailMetadata(replyOutbox.payload);

    // Card 1.33 brackets composed msg-ids. RFC 5322 requires
    // `msg-id = "<" id-left "@" id-right ">"`, and this webhook payload
    // supplies the id bare; emitting it bare was malformed and could fail a
    // strict client's matching. The STORED value is unchanged.
    const bracketed = `<${inboundMessageId}>`;
    expect(replyMetadata.inReplyTo).toBe(bracketed);
    expect(replyMetadata.references).toContain(bracketed);

    // FIXED BY CARD 1.43, and this assertion is the visible change.
    //
    // It used to read `toBe(inboundMessageId)` - BARE - because card 1.42 found
    // that the acknowledgement emitted In-Reply-To unbracketed and was told not
    // to touch the threading headers, so it pinned the defect instead of
    // hiding it. buildOutboundEmailContext now routes `preferredInReplyTo`
    // through normalizeMessageId once and uses the result for both headers.
    //
    // Why it mattered: RFC 5322 requires the angle brackets, and this is the
    // requester's FIRST email. Whether their reply threads onto this ticket or
    // opens a new one is decided by whether their client matched this header.
    expect(ackMetadata.inReplyTo).toBe(bracketed);
    expect(ackMetadata.references).toContain(bracketed);

    // Still anchored to the ORIGINAL inbound email after the transfer, which
    // is what this test is named for: In-Reply-To never names another
    // outbound copy.
    const ackMessageId = buildOutboundMessageId(
      ackOutbox.id,
      ackMetadata.replyTo,
    );
    expect(replyMetadata.inReplyTo).not.toBe(ackMessageId);

    // Card 1.42 §5 on the survivors: no hero button, no sign-off, and a
    // preheader that is really hidden.
    const ackHtml = getOutboxHtml(ackOutbox.payload);
    const replyHtml = getOutboxHtml(replyOutbox.payload);
    for (const html of [ackHtml, replyHtml]) {
      expect(html).not.toContain('View Ticket');
      expect(html).not.toContain('Best regards');
      // ⚠️ INVERTED BY CARD 1.68, across both emails in the loop.
      expect(html).not.toContain('view online');
      expect(html).not.toContain('Reply to this email');
      expect(html).toContain('display:none;font-size:0;line-height:0');
    }
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

    // REWRITTEN BY CARD 1.33. This test used to assert that each step's
    // In-Reply-To named one of the PREVIOUS step's outbound message ids, and
    // its own comment described the mechanism as "a nondeterministic
    // reservation race". That race was the bug: one shared
    // thread.lastOutboundMessageId while Message-IDs were per recipient, so
    // the pointer usually named somebody else's copy and at least one
    // recipient could never thread. The contract now is the opposite - every
    // notification about a ticket carries the same synthetic root, and
    // In-Reply-To never names a shared outbound id.
    const statusOutbox = await prisma.notificationOutbox.findMany({
      where: {
        ticketId: created.id,
        eventType: 'TICKET_STATUS_CHANGED',
      },
      orderBy: { createdAt: 'asc' },
    });

    // REWRITTEN AGAIN BY CARD 1.42. Six transitions were driven above -
    // TRIAGED, an assignment, RESOLVED, CLOSED, REOPENED, RESOLVED - and they
    // now produce exactly TWO emails, one for each RESOLVED, both to the
    // requester alone. That count is simultaneously the threading fixture and
    // the deletion assertion for this flow: if a non-RESOLVED status email
    // came back, this length changes.
    expect(statusOutbox).toHaveLength(2);
    expect(statusOutbox.map((entry) => entry.toEmail)).toEqual([
      fixtureEmails.requester,
      fixtureEmails.requester,
    ]);
    // No raw enum reaches the requester any more. The old bodies read
    // "Status changed from CLOSED to REOPENED."
    for (const entry of statusOutbox) {
      expect(entry.body).toContain('We have marked your request as resolved.');
      expect(entry.body).not.toContain('RESOLVED');
      expect(entry.body).not.toContain('REOPENED');
      expect(entry.body).not.toContain('CLOSED');
    }

    const [firstResolved, secondResolved] = statusOutbox;
    const firstMetadata = getOutboxEmailMetadata(firstResolved.payload);
    const secondMetadata = getOutboxEmailMetadata(secondResolved.payload);

    expect(firstMetadata.replyTo).toMatch(expectedReplyToPattern());
    expect(secondMetadata.replyTo).toMatch(expectedReplyToPattern());
    // Every step references the one stable root, so they all land in one
    // conversation regardless of which recipient's copy went out when.
    const thread = await prisma.ticketEmailThread.findUnique({
      where: { ticketId: created.id },
      select: { replyToken: true },
    });
    const root = buildTicketRootMessageId(
      thread?.replyToken ?? '',
      secondMetadata.replyTo,
    );
    expect(firstMetadata.references?.[0]).toBe(root);
    expect(secondMetadata.references?.[0]).toBe(root);
    // And In-Reply-To is never one of those per-recipient outbound ids.
    const firstMessageId = buildOutboundMessageId(
      firstResolved.id,
      firstMetadata.replyTo,
    );
    expect(secondMetadata.inReplyTo).not.toBe(firstMessageId);
    // Nothing unroutable is ever emitted.
    for (const metadata of [firstMetadata, secondMetadata]) {
      expect(metadata.inReplyTo ?? '').not.toContain('@localhost');
      expect(
        (metadata.references ?? []).some((id) => id.includes('@localhost')),
      ).toBe(false);
    }
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
    // ⚠️ INVERTED BY CARD 1.68 - three assertions here, the text half and both
    // halves of the footer in the HTML.
    expect(outbox?.body).not.toContain('Reply to this email');
    const html = getOutboxHtml(outbox?.payload);
    const emailMetadata = getOutboxEmailMetadata(outbox?.payload);
    // Card 1.34 rewrote this body: it used to assert the heading, the "Ticket
    // details" block and the View Ticket button - all three removed on purpose,
    // the first two repeating the subject line and the details block printing
    // ticket.status raw, so a requester was shown WAITING_ON_REQUESTER.
    //
    // ⚠️ CARD 1.68 THEN REVERSED THE REST OF THAT DECISION. 1.34's note read
    // "what the body must carry now is the message, the instruction and the
    // link"; the owner has since cut the instruction and the link too, so the
    // body is the author's name and the message and nothing else. Replying
    // still works - it always did, and the Reply-To header is what makes it
    // work, not a sentence telling the reader to. This comment is updated
    // rather than deleted so the reversal is legible instead of looking like
    // an assertion someone dropped.
    expect(html).toContain('please restart your VPN client');
    expect(html).not.toContain('Reply to this email');
    expect(html).not.toContain('view online');
    expect(html).toContain('mso-hide:all');
    expect(html).not.toContain('Update on your request');
    expect(html).not.toContain('Ticket details');
    expect(html).not.toContain('View Ticket');
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
