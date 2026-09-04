import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import {
  fixtureEmails,
  fixtureTeamIds,
  fixtureUserIds,
} from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

const inboundSecretHeader = { 'x-inbound-email-secret': 'test-inbound-secret' };

function authHeader(email: string) {
  return { 'x-user-email': email };
}

/**
 * The outbox stores the composed email under `content` and its headers under
 * `email` - NOT `emailContent`/`emailMetadata`, which are the names of the
 * service-layer inputs. Worth stating: the mismatch cost a first run of this
 * spec, where every html assertion silently compared against ''.
 */
function htmlOf(payload: unknown): string {
  const content = (payload as { content?: { html?: string } } | null)?.content;
  return content?.html ?? '';
}

function ccOf(payload: unknown): string[] | undefined {
  const email = (payload as { email?: { cc?: string[] } } | null)?.email;
  return email?.cc;
}

/**
 * Card 1.42 — email is for people outside the system.
 *
 * The owner's rule, in one line: *"Email leaves this system only for the
 * requester and the people CC'd with them. Staff use the app."* Ten email types
 * became four, and every survivor goes to somebody outside the system.
 *
 * EVERY DELETION IS ASSERTED AS A COUNT OF ZERO, AND ALWAYS BESIDE THE IN-APP
 * ROW THAT REPLACED IT. Zero-emails alone would still pass if a later tidy-up
 * removed the bell as well, which would turn a quiet system into a silent one -
 * and for ticket creation there was no bell at all before this card, so that
 * half is the fragile one.
 */
describe('Email policy: only people outside the system', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  let seq = 0;
  const unique = () => {
    seq += 1;
    return `${Date.now()}${seq}`;
  };

  async function createTicket(subject: string, requester = fixtureEmails.requester) {
    const res = await request(server)
      .post('/api/tickets')
      .set(authHeader(requester))
      .send({
        subject,
        description: 'Card 1.42 policy spec.',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    return res.body as { id: string; displayId: string | null };
  }

  const outboxFor = (ticketId: string, eventType?: string) =>
    prisma.notificationOutbox.findMany({
      where: { ticketId, ...(eventType ? { eventType } : {}) },
      orderBy: { createdAt: 'asc' },
    });

  describe('a new ticket', () => {
    it('emails the requester and NOBODY else', async () => {
      const ticket = await createTicket(`policy created ${unique()}`);
      await request(server)
        .post(`/api/tickets/${ticket.id}/assign`)
        .set(authHeader(fixtureEmails.owner))
        .send({ assigneeId: fixtureUserIds.agent })
        .expect(201);

      const created = await outboxFor(ticket.id, 'TICKET_CREATED');
      expect(created).toHaveLength(1);
      expect(created[0].toEmail).toBe(fixtureEmails.requester);
    });

    it('rings the assigned team, which is the ONLY signal work arrived', async () => {
      // Before this card `ticketCreated` queued email and never touched the
      // in-app service, so deleting the email without building this would have
      // left staff to discover new work by opening the queue and looking.
      const ticket = await createTicket(`policy bell ${unique()}`);
      const bells = await prisma.notification.findMany({
        where: { ticketId: ticket.id, type: 'TICKET_CREATED' },
        select: { userId: true },
      });
      const userIds = bells.map((row) => row.userId);
      // The IT roster is agent, lead and admin.
      expect(userIds).toContain(fixtureUserIds.agent);
      expect(userIds).toContain(fixtureUserIds.lead);
      expect(userIds).toContain(fixtureUserIds.admin);
      // And never the requester, for their own ticket.
      expect(userIds).not.toContain(fixtureUserIds.requester);
    });

    it('says nothing about our internal routing, and no raw enum', async () => {
      const ticket = await createTicket(`policy body ${unique()}`);
      const [created] = await outboxFor(ticket.id, 'TICKET_CREATED');
      expect(created.body).toContain('We have logged your request');
      expect(created.body).toContain(ticket.displayId ?? '');
      // The old body carried `Priority: SEV3`, `Status: NEW` and the team name.
      expect(created.body).not.toContain('SEV3');
      expect(created.body).not.toContain('NEW');
      expect(created.body).not.toContain('IT Service Desk');
    });
  });

  describe('assignment, transfer and the other status changes', () => {
    it('send NO email, and still ring the bell', async () => {
      const ticket = await createTicket(`policy silent ${unique()}`);
      await request(server)
        .post(`/api/tickets/${ticket.id}/assign`)
        .set(authHeader(fixtureEmails.owner))
        .send({ assigneeId: fixtureUserIds.agent })
        .expect(201);
      await request(server)
        .post(`/api/tickets/${ticket.id}/transition`)
        .set(authHeader(fixtureEmails.agent))
        .send({ status: 'IN_PROGRESS' })
        .expect(201);
      await request(server)
        .post(`/api/tickets/${ticket.id}/transfer`)
        .set(authHeader(fixtureEmails.owner))
        .send({ newTeamId: fixtureTeamIds.hr })
        .expect(201);

      const silenced = await prisma.notificationOutbox.findMany({
        where: {
          ticketId: ticket.id,
          eventType: {
            in: [
              'TICKET_ASSIGNED',
              'TICKET_TRANSFERRED',
              'TICKET_STATUS_CHANGED',
            ],
          },
        },
      });
      expect(silenced).toHaveLength(0);

      // The other half. Assignment and transfer both had an in-app
      // notification before this card, which is exactly why deleting their
      // emails was safe.
      const assigned = await prisma.notification.findMany({
        where: { ticketId: ticket.id, type: 'TICKET_ASSIGNED' },
      });
      expect(assigned.length).toBeGreaterThan(0);
      const transferred = await prisma.notification.findMany({
        where: { ticketId: ticket.id, type: 'TICKET_TRANSFERRED' },
      });
      expect(transferred.length).toBeGreaterThan(0);
    });
  });

  describe('resolved', () => {
    it('emails the requester, only the requester, and asks all three things', async () => {
      const ticket = await createTicket(`policy resolved ${unique()}`);
      await request(server)
        .post(`/api/tickets/${ticket.id}/assign`)
        .set(authHeader(fixtureEmails.owner))
        .send({ assigneeId: fixtureUserIds.agent })
        .expect(201);
      await request(server)
        .post(`/api/tickets/${ticket.id}/followers`)
        .set(authHeader(fixtureEmails.owner))
        .send({ userId: fixtureUserIds.lead })
        .expect(201);
      await request(server)
        .post(`/api/tickets/${ticket.id}/transition`)
        .set(authHeader(fixtureEmails.agent))
        .send({ status: 'RESOLVED' })
        .expect(201);

      const resolved = await outboxFor(ticket.id, 'TICKET_STATUS_CHANGED');
      expect(resolved).toHaveLength(1);
      expect(resolved[0].toEmail).toBe(fixtureEmails.requester);

      const html = htmlOf(resolved[0].payload);
      // REWRITTEN BY CARD 1.44. This used to assert `?action=confirm`,
      // `?action=reopen` and the words "Rate it on the ticket" - three links
      // into the portal, each costing the requester a browser, a Microsoft
      // sign-in and then hunting for a rating widget in a sidebar. They are now
      // SEVEN one-click links: close, reopen, and one per star.
      const actionLinks = (html.match(/\/api\/email-actions\/[A-Za-z0-9_.-]+/g) ??
        []) as string[];
      expect(new Set(actionLinks).size).toBe(7);
      expect(html).toContain('Yes, close it');
      expect(html).toContain('Reopen it');
      // ⚠️ TEXT STARS, NEVER IMAGES. Most clients block remote images by
      // default, and a rating nobody can see is a rating nobody gives. U+2605
      // as an HTML entity renders with no download at all.
      expect(html).toContain('&#9733;');
      expect(html.split('&#9733;')).toHaveLength(6); // five stars
      expect(html).not.toContain('<img');
      expect(html).toContain('1 is poor, 5 is great');
      // The plain-text half carries the same links as full URLs, one labelled
      // line each - a plain-text reader cannot click a word.
      expect(resolved[0].body).toContain('How did we do?');
      expect(resolved[0].body).toContain('1 of 5:');
      expect(resolved[0].body).toContain('5 of 5:');
      expect(
        (resolved[0].body.match(/\/api\/email-actions\//g) ?? []).length,
      ).toBe(7);
      // The word, never the enum.
      expect(resolved[0].body).toContain('resolved');
      expect(resolved[0].body).not.toContain('RESOLVED');
    });

    it('rings the bell for the staff who no longer get the email', async () => {
      const ticket = await createTicket(`policy resolved bell ${unique()}`);
      await request(server)
        .post(`/api/tickets/${ticket.id}/assign`)
        .set(authHeader(fixtureEmails.owner))
        .send({ assigneeId: fixtureUserIds.agent })
        .expect(201);
      await request(server)
        .post(`/api/tickets/${ticket.id}/transition`)
        .set(authHeader(fixtureEmails.owner))
        .send({ status: 'RESOLVED' })
        .expect(201);
      const bells = await prisma.notification.findMany({
        where: { ticketId: ticket.id, type: 'TICKET_RESOLVED' },
      });
      expect(bells.length).toBeGreaterThan(0);
    });
  });

  describe('a public message', () => {
    it('is ONE email with To and Cc, and no staff on it', async () => {
      // Card 1.33's model must survive: one message, one outbox row, the
      // requester on To and the external CCs on Cc - never one row per person.
      const ticket = await createTicket(`policy reply ${unique()}`);
      const colleague = await prisma.user.create({
        data: {
          email: `cc.colleague.${unique()}@company.com`,
          displayName: 'Cc Colleague',
          role: 'EMPLOYEE',
        },
      });
      await prisma.ticketFollower.createMany({
        data: [
          { ticketId: ticket.id, userId: colleague.id },
          { ticketId: ticket.id, userId: fixtureUserIds.lead },
        ],
      });
      await request(server)
        .post(`/api/tickets/${ticket.id}/assign`)
        .set(authHeader(fixtureEmails.owner))
        .send({ assigneeId: fixtureUserIds.agent })
        .expect(201);

      await request(server)
        .post(`/api/tickets/${ticket.id}/messages`)
        .set(authHeader(fixtureEmails.agent))
        .send({ body: 'Here is the update you asked for.', type: 'PUBLIC' })
        .expect(201);

      const sent = await outboxFor(ticket.id, 'MESSAGE_ADDED');
      expect(sent).toHaveLength(1);
      expect(sent[0].toEmail).toBe(fixtureEmails.requester);

      expect(ccOf(sent[0].payload)).toEqual([colleague.email]);
      // The LEAD follower and the AGENT assignee are on this ticket and are
      // NOT on the email. That is the owner's call, made explicitly.
      expect(JSON.stringify(sent[0].payload)).not.toContain(fixtureEmails.lead);
      expect(JSON.stringify(sent[0].payload)).not.toContain(fixtureEmails.agent);

      // The in-app audience does NOT narrow - staff still get the bell.
      const bells = await prisma.notification.findMany({
        where: { ticketId: ticket.id, type: 'NEW_MESSAGE' },
        select: { userId: true },
      });
      const belled = bells.map((row) => row.userId);
      expect(belled).toContain(fixtureUserIds.lead);
      expect(belled).toContain(fixtureUserIds.requester);
    });

    it('queues nothing at all when only staff are left', async () => {
      // §1c: rather than an email with an empty To, send none.
      const ticket = await prisma.ticket.create({
        data: {
          requesterId: fixtureUserIds.requester,
          subject: `policy staff only ${unique()}`,
          description: 'No external audience.',
          assignedTeamId: fixtureTeamIds.it,
          assigneeId: fixtureUserIds.agent,
          displayId: `PL_20260904_${String(400 + seq).padStart(3, '0')}`,
        },
        select: { id: true },
      });
      await prisma.ticketFollower.create({
        data: { ticketId: ticket.id, userId: fixtureUserIds.lead },
      });
      // The REQUESTER writes it, so the only people left are staff.
      await request(server)
        .post(`/api/tickets/${ticket.id}/messages`)
        .set(authHeader(fixtureEmails.requester))
        .send({ body: 'Any news?', type: 'PUBLIC' })
        .expect(201);

      expect(await outboxFor(ticket.id, 'MESSAGE_ADDED')).toHaveLength(0);
      // ...and the staff still hear about it.
      const bells = await prisma.notification.findMany({
        where: { ticketId: ticket.id, type: 'NEW_MESSAGE' },
      });
      expect(bells.length).toBeGreaterThan(0);
    });
  });

  describe('an inbound email', () => {
    it('produces exactly ONE email back, not two (§3)', async () => {
      const messageId = `policy-inbound-${unique()}@mail.example`;
      const res = await request(server)
        .post('/api/tickets/inbound-email')
        .set(inboundSecretHeader)
        .send({
          fromEmail: fixtureEmails.requester,
          fromName: 'Requestor One',
          subject: `policy inbound ${unique()}`,
          body: 'My laptop will not start.',
          messageId,
        })
        .expect(201);
      const ticketId = (res.body as { ticket: { id: string } }).ticket.id;

      const all = await outboxFor(ticketId);
      // The acknowledgement is the better of the two, so the created-email is
      // the one suppressed.
      expect(all.map((entry) => entry.eventType)).toEqual([
        'INBOUND_EMAIL_ACKNOWLEDGED',
      ]);
    });

    it('rings NOBODY while it is unrouted, which is a real gap worth naming', async () => {
      // ⚠️ THIS TEST DOCUMENTS A CONSEQUENCE THE CARD DID NOT ANTICIPATE.
      //
      // The new-ticket bell goes to the ASSIGNED TEAM. An inbound ticket has no
      // team unless a routing rule matches it - `TicketsService.create` runs
      // routeTarget synchronously and leaves the team null when nothing
      // matches. So an unrouted inbound ticket now has no email AND no bell,
      // and is discoverable only from the Unassigned queue.
      //
      // Notifying nobody is still the right call over waking every team, but
      // it is the strongest argument yet for card 1.16's digest. Asserted as it
      // actually behaves rather than as anyone would like it to.
      const messageId = `policy-inbound-bell-${unique()}@mail.example`;
      const res = await request(server)
        .post('/api/tickets/inbound-email')
        .set(inboundSecretHeader)
        .send({
          fromEmail: fixtureEmails.requester,
          fromName: 'Requestor One',
          subject: `policy inbound bell ${unique()}`,
          body: 'The printer is jammed again.',
          messageId,
        })
        .expect(201);
      const ticketId = (res.body as { ticket: { id: string } }).ticket.id;
      const routed = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticketId },
        select: { assignedTeamId: true },
      });
      expect(routed.assignedTeamId).toBeNull();
      expect(
        await prisma.notification.findMany({
          where: { ticketId, type: 'TICKET_CREATED' },
        }),
      ).toHaveLength(0);

      // And once somebody routes it, the staff signal exists again - through
      // the assignment bell, which this card left alone.
      await request(server)
        .post(`/api/tickets/${ticketId}/transfer`)
        .set(authHeader(fixtureEmails.owner))
        .send({ newTeamId: fixtureTeamIds.it })
        .expect(201);
      const afterRouting = await prisma.notification.findMany({
        where: { ticketId, type: 'TICKET_TRANSFERRED' },
      });
      expect(afterRouting.length).toBeGreaterThan(0);
    });

    it('rings the team when a routed inbound ticket DOES have one', async () => {
      // The mechanism itself works; it is only the unrouted case above that
      // reaches nobody. Proven by creating the ticket with a team through the
      // portal path, which is the same notifyTeamOfNewTicket call.
      const ticket = await createTicket(`policy routed ${unique()}`);
      const bells = await prisma.notification.findMany({
        where: { ticketId: ticket.id, type: 'TICKET_CREATED' },
      });
      expect(bells.length).toBeGreaterThan(0);
    });
  });

  describe('the shape of every survivor (card 1.34)', () => {
    it('has a hidden preheader, no hero button and no sign-off', async () => {
      const ticket = await createTicket(`policy shape ${unique()}`);
      await request(server)
        .post(`/api/tickets/${ticket.id}/assign`)
        .set(authHeader(fixtureEmails.owner))
        .send({ assigneeId: fixtureUserIds.agent })
        .expect(201);
      await request(server)
        .post(`/api/tickets/${ticket.id}/transition`)
        .set(authHeader(fixtureEmails.owner))
        .send({ status: 'RESOLVED' })
        .expect(201);
      const rows = await outboxFor(ticket.id);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const html = htmlOf(row.payload);
        // Asserted on the style attribute, not on the words: a preheader that
        // is not actually hidden is a visible line of duplicate text.
        expect(html).toContain(
          'display:none;font-size:0;line-height:0;max-height:0;overflow:hidden;mso-hide:all;',
        );
        expect(html).not.toContain('View Ticket');
        expect(html).not.toContain('Best regards');
        expect(html).toContain('view online');
        // The quoted font stack: unquoted, 'Segoe UI' is invalid CSS and
        // strict clients drop the whole stack.
        expect(html).toContain(`font-family:'Segoe UI', Arial, sans-serif`);
      }
    });

    it('escapes a hostile display name, and keeps the preheader clean', async () => {
      // The attacker-controlled field in the acknowledgement is the SENDER'S
      // NAME: an unknown address is provisioned as a user with `fromName` as
      // its display name, and the greeting interpolates it.
      //
      // The subject is NOT in this body any more - card 1.42 removed the
      // "Ticket details" block that restated it - so a hostile subject has
      // nowhere to land here. That is worth knowing rather than asserting
      // against nothing, which is what the first version of this test did.
      const nasty = `<script>alert('x')</script>`;
      const res = await request(server)
        .post('/api/tickets/inbound-email')
        .set(inboundSecretHeader)
        .send({
          fromEmail: `hostile.${unique()}@company.com`,
          fromName: nasty,
          subject: `${nasty} ${unique()}`,
          body: 'Escaping check.',
          messageId: `policy-escape-${unique()}@mail.example`,
        })
        .expect(201);
      const ticketId = (res.body as { ticket: { id: string } }).ticket.id;
      const [ack] = await outboxFor(ticketId, 'INBOUND_EMAIL_ACKNOWLEDGED');
      const html = htmlOf(ack.payload);
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>');

      // The preheader is the easy one to forget precisely because it is
      // invisible. It carries the reference, so what is asserted is that the
      // hidden div holds no markup at all.
      const preheader = /mso-hide:all;">([^<]*)</.exec(html)?.[1] ?? '';
      expect(preheader.length).toBeGreaterThan(0);
      expect(preheader).not.toContain('<');
      expect(preheader).toContain('Your reference is');
    });

    it('no longer restates the subject at all in the acknowledgement', async () => {
      // §5: content first, no heading restating the subject. The old body had
      // a 24px "Request received" heading and a Ticket details block carrying
      // the subject and a status; all three are gone.
      const subject = `policy no restate ${unique()}`;
      const res = await request(server)
        .post('/api/tickets/inbound-email')
        .set(inboundSecretHeader)
        .send({
          fromEmail: fixtureEmails.requester,
          fromName: 'Requestor One',
          subject,
          body: 'Nothing to see.',
          messageId: `policy-restate-${unique()}@mail.example`,
        })
        .expect(201);
      const ticketId = (res.body as { ticket: { id: string } }).ticket.id;
      const [ack] = await outboxFor(ticketId, 'INBOUND_EMAIL_ACKNOWLEDGED');
      const html = htmlOf(ack.payload);
      expect(html).not.toContain(subject);
      expect(html).not.toContain('Request received');
      expect(html).not.toContain('What happens next');
      expect(html).not.toContain('Status:');
    });
  });

  describe('an automation rule that emails (§1b)', () => {
    async function createRule(token: string, to: string, address?: string) {
      seq += 1;
      const res = await request(server)
        .post('/api/automation-rules')
        .set(authHeader(fixtureEmails.owner))
        .send({
          name: `1.42 ${token}`,
          trigger: 'TICKET_CREATED',
          conditions: [{ field: 'subject', operator: 'contains', value: token }],
          actions: [
            {
              type: 'send_email',
              to,
              ...(address ? { address } : {}),
              subject: 'Rule says hello',
              body: 'A rule fired about {{ticket.displayId}}.',
            },
          ],
          teamId: fixtureTeamIds.it,
          isActive: true,
          priority: 300 + seq,
        })
        .expect(201);
      return (res.body as { id: string }).id;
    }

    async function waitForRule(ruleId: string, ticketId: string) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const row = await prisma.automationExecution.findFirst({
          where: { ruleId, ticketId },
        });
        if (row) return row;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(`rule ${ruleId} did not run for ${ticketId}`);
    }

    it('drops the email to a STAFF recipient and rings them instead', async () => {
      const token = `RULESTAFF${unique()}`;
      const ruleId = await createRule(token, 'assignee');
      const ticket = await createTicket(`${token} needs an agent`);
      await request(server)
        .post(`/api/tickets/${ticket.id}/assign`)
        .set(authHeader(fixtureEmails.owner))
        .send({ assigneeId: fixtureUserIds.agent })
        .expect(201);
      await waitForRule(ruleId, ticket.id);

      const rows = await outboxFor(ticket.id, 'AUTOMATION_EMAIL');
      expect(rows.filter((r) => r.toEmail === fixtureEmails.agent)).toHaveLength(
        0,
      );
    });

    it('still emails a requester, who is outside the system', async () => {
      const token = `RULEREQ${unique()}`;
      const ruleId = await createRule(token, 'requester');
      const ticket = await createTicket(`${token} for the requester`);
      await waitForRule(ruleId, ticket.id);
      const rows = await outboxFor(ticket.id, 'AUTOMATION_EMAIL');
      expect(rows.map((row) => row.toEmail)).toContain(
        fixtureEmails.requester,
      );
    });
  });
});
