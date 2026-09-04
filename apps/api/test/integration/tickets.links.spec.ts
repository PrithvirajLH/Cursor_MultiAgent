import { INestApplication } from '@nestjs/common';
import { TicketLinkType } from '@prisma/client';
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

/**
 * Card 1.6 — link related tickets.
 *
 * The security-relevant rule is that you must be able to see BOTH tickets.
 * Listing a linked ticket's subject from a ticket you can open would leak the
 * subject of one you cannot, and HR and payroll subjects carry people's names.
 * The fixture seed puts the AGENT in the IT team only, so an HR ticket is
 * genuinely invisible to them — that is what the access cases lean on.
 */
describe('Ticket links', () => {
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

  function authHeader(email: string) {
    return { 'x-user-email': email };
  }

  async function makeTicket(overrides: Record<string, unknown> = {}) {
    seq += 1;
    return prisma.ticket.create({
      data: {
        requesterId: fixtureUserIds.requester,
        subject: `Link fixture ${seq}`,
        description: 'Fixture for ticket links.',
        assignedTeamId: fixtureTeamIds.it,
        assigneeId: fixtureUserIds.agent,
        displayId: `LK_20260903_${String(100 + seq).padStart(3, '0')}`,
        ...overrides,
      },
      select: { id: true, displayId: true, subject: true },
    });
  }

  function link(
    ticketId: string,
    toTicketId: string,
    type: TicketLinkType,
    email: string = fixtureEmails.agent,
  ) {
    return request(server)
      .post(`/api/tickets/${ticketId}/links`)
      .set(authHeader(email))
      .send({ toTicketId, type });
  }

  function getTicket(id: string, email: string) {
    return request(server).get(`/api/tickets/${id}`).set(authHeader(email));
  }

  const eventTypes = (ticketId: string) =>
    prisma.ticketEvent.findMany({
      where: { ticketId },
      select: { type: true, payload: true },
    });

  describe('creating a link', () => {
    it('stores exactly ONE row, not one per direction', async () => {
      // The whole design rests on this. Two rows could disagree with each
      // other and nothing would say which was right.
      const [a, b] = [await makeTicket(), await makeTicket()];
      const res = await link(a.id, b.id, TicketLinkType.RELATED);
      expect(res.status).toBe(201);
      const rows = await prisma.ticketLink.findMany({
        where: {
          OR: [
            { fromTicketId: a.id, toTicketId: b.id },
            { fromTicketId: b.id, toTicketId: a.id },
          ],
        },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].fromTicketId).toBe(a.id);
      expect(rows[0].createdById).toBe(fixtureUserIds.agent);
    });

    it('refuses the same pair and type twice', async () => {
      const [a, b] = [await makeTicket(), await makeTicket()];
      expect((await link(a.id, b.id, TicketLinkType.RELATED)).status).toBe(201);
      const second = await link(a.id, b.id, TicketLinkType.RELATED);
      expect(second.status).toBe(400);
      expect(
        await prisma.ticketLink.count({ where: { fromTicketId: a.id } }),
      ).toBe(1);
    });

    it('allows the same pair with a DIFFERENT type', async () => {
      // "A duplicates B" and "A is related to B" are different statements and
      // the composite unique deliberately includes the type.
      const [a, b] = [await makeTicket(), await makeTicket()];
      expect((await link(a.id, b.id, TicketLinkType.RELATED)).status).toBe(201);
      expect(
        (await link(a.id, b.id, TicketLinkType.DUPLICATE_OF)).status,
      ).toBe(201);
      expect(
        await prisma.ticketLink.count({ where: { fromTicketId: a.id } }),
      ).toBe(2);
    });

    it('refuses a self-link', async () => {
      const a = await makeTicket();
      const res = await link(a.id, a.id, TicketLinkType.RELATED);
      expect(res.status).toBe(400);
      expect(await prisma.ticketLink.count({ where: { fromTicketId: a.id } })).toBe(
        0,
      );
    });

    it('refuses a caller who cannot WRITE the source ticket', async () => {
      const [a, b] = [await makeTicket(), await makeTicket()];
      const res = await link(
        a.id,
        b.id,
        TicketLinkType.RELATED,
        fixtureEmails.otherRequester,
      );
      expect(res.status).toBe(403);
      expect(await prisma.ticketLink.count({ where: { fromTicketId: a.id } })).toBe(
        0,
      );
    });

    it('refuses linking TO a ticket the caller cannot see, as 404 not 403', async () => {
      // 404 on purpose: a 403 would confirm the id belongs to a real ticket.
      const a = await makeTicket();
      const hidden = await makeTicket({
        assignedTeamId: fixtureTeamIds.hr,
        assigneeId: null,
        requesterId: fixtureUserIds.otherRequester,
      });
      const res = await link(a.id, hidden.id, TicketLinkType.RELATED);
      expect(res.status).toBe(404);
      expect(await prisma.ticketLink.count({ where: { fromTicketId: a.id } })).toBe(
        0,
      );
    });
  });

  describe('reading links', () => {
    it('shows a RELATED link on BOTH tickets, with the direction derived', async () => {
      const [a, b] = [await makeTicket(), await makeTicket()];
      await link(a.id, b.id, TicketLinkType.RELATED);

      const fromA = await getTicket(a.id, fixtureEmails.agent);
      expect(fromA.status).toBe(200);
      const aLinks = (fromA.body as { links: Record<string, unknown>[] }).links;
      expect(aLinks).toHaveLength(1);
      expect(aLinks[0].direction).toBe('outgoing');
      expect(
        (aLinks[0].otherTicket as { id: string }).id,
      ).toBe(b.id);

      const fromB = await getTicket(b.id, fixtureEmails.agent);
      const bLinks = (fromB.body as { links: Record<string, unknown>[] }).links;
      expect(bLinks).toHaveLength(1);
      expect(bLinks[0].direction).toBe('incoming');
      expect((bLinks[0].otherTicket as { id: string }).id).toBe(a.id);
    });

    it('lists the child on the parent and the parent on the child', async () => {
      const [parent, child] = [await makeTicket(), await makeTicket()];
      await link(parent.id, child.id, TicketLinkType.PARENT_OF);

      const onParent = await getTicket(parent.id, fixtureEmails.agent);
      const parentLinks = (onParent.body as { links: Record<string, unknown>[] })
        .links;
      expect(parentLinks[0].type).toBe(TicketLinkType.PARENT_OF);
      expect(parentLinks[0].direction).toBe('outgoing');
      expect((parentLinks[0].otherTicket as { id: string }).id).toBe(child.id);

      const onChild = await getTicket(child.id, fixtureEmails.agent);
      const childLinks = (onChild.body as { links: Record<string, unknown>[] })
        .links;
      expect(childLinks[0].direction).toBe('incoming');
      expect((childLinks[0].otherTicket as { id: string }).id).toBe(parent.id);
    });

    it('does NOT expose the subject of a linked ticket the reader cannot open', async () => {
      // THE case this card exists to get right. The OWNER can see both, so the
      // OWNER makes the link; the AGENT can see only the IT ticket.
      const secret = 'PAYROLL - Dana Whitfield garnishment';
      const visible = await makeTicket();
      const hidden = await makeTicket({
        assignedTeamId: fixtureTeamIds.hr,
        assigneeId: null,
        requesterId: fixtureUserIds.otherRequester,
        subject: secret,
      });
      const created = await link(
        visible.id,
        hidden.id,
        TicketLinkType.RELATED,
        fixtureEmails.owner,
      );
      expect(created.status).toBe(201);

      const asAgent = await getTicket(visible.id, fixtureEmails.agent);
      expect(asAgent.status).toBe(200);
      // The whole response body, not just the field — a leak anywhere counts.
      expect(JSON.stringify(asAgent.body)).not.toContain(secret);

      const links = (asAgent.body as { links: Record<string, unknown>[] }).links;
      // The link is still LISTED. Hiding it would leave an agent unable to see
      // the ticket was linked at all; that is a different failure, not a fix.
      expect(links).toHaveLength(1);
      const other = links[0].otherTicket as Record<string, unknown>;
      expect(other.visible).toBe(false);
      expect(other.subject).toBeNull();
      expect(other.status).toBeNull();
      // displayId encodes the owning department, so it is withheld too; the
      // bare number is what remains.
      expect(other.displayId).toBeNull();
      expect(typeof other.number).toBe('number');
    });

    it('gives the OWNER, who can see both, the full detail', async () => {
      const secret = 'PAYROLL - visible to the owner';
      const visible = await makeTicket();
      const hidden = await makeTicket({
        assignedTeamId: fixtureTeamIds.hr,
        assigneeId: null,
        requesterId: fixtureUserIds.otherRequester,
        subject: secret,
      });
      await link(visible.id, hidden.id, TicketLinkType.RELATED, fixtureEmails.owner);
      const asOwner = await getTicket(visible.id, fixtureEmails.owner);
      const other = (
        asOwner.body as { links: { otherTicket: Record<string, unknown> }[] }
      ).links[0].otherTicket;
      expect(other.visible).toBe(true);
      expect(other.subject).toBe(secret);
    });
  });

  describe('cycles', () => {
    it('refuses making two tickets parents of each other', async () => {
      const [a, b] = [await makeTicket(), await makeTicket()];
      expect((await link(a.id, b.id, TicketLinkType.PARENT_OF)).status).toBe(201);
      const back = await link(b.id, a.id, TicketLinkType.PARENT_OF);
      expect(back.status).toBe(400);
    });

    it('refuses a loop one level further out', async () => {
      const [a, b, c] = [
        await makeTicket(),
        await makeTicket(),
        await makeTicket(),
      ];
      await link(a.id, b.id, TicketLinkType.PARENT_OF);
      await link(b.id, c.id, TicketLinkType.PARENT_OF);
      const loop = await link(c.id, a.id, TicketLinkType.PARENT_OF);
      expect(loop.status).toBe(400);
    });

    it('still allows a plain RELATED link in both directions', async () => {
      // The cycle rule is about PARENT_OF only; RELATED cannot form a hierarchy.
      const [a, b] = [await makeTicket(), await makeTicket()];
      expect((await link(a.id, b.id, TicketLinkType.RELATED)).status).toBe(201);
      expect((await link(b.id, a.id, TicketLinkType.RELATED)).status).toBe(201);
    });
  });

  describe('events', () => {
    it('records TICKET_LINKED on BOTH tickets', async () => {
      const [a, b] = [await makeTicket(), await makeTicket()];
      await link(a.id, b.id, TicketLinkType.RELATED);
      const onA = (await eventTypes(a.id)).filter(
        (e) => e.type === 'TICKET_LINKED',
      );
      const onB = (await eventTypes(b.id)).filter(
        (e) => e.type === 'TICKET_LINKED',
      );
      expect(onA).toHaveLength(1);
      expect(onB).toHaveLength(1);
      expect(onA[0].payload).toMatchObject({ otherTicketId: b.id });
      expect(onB[0].payload).toMatchObject({ otherTicketId: a.id });
    });

    it('never puts the other ticket subject in the payload', async () => {
      // A timeline entry is readable by anyone who can read the ticket it sits
      // on, so a subject here would reopen the leak the view rules close.
      const secret = 'PAYROLL - must not reach a timeline';
      const visible = await makeTicket();
      const hidden = await makeTicket({
        assignedTeamId: fixtureTeamIds.hr,
        assigneeId: null,
        requesterId: fixtureUserIds.otherRequester,
        subject: secret,
      });
      await link(visible.id, hidden.id, TicketLinkType.RELATED, fixtureEmails.owner);
      const events = await eventTypes(visible.id);
      expect(JSON.stringify(events)).not.toContain(secret);
    });

    it('records TICKET_UNLINKED on both tickets', async () => {
      const [a, b] = [await makeTicket(), await makeTicket()];
      const created = await link(a.id, b.id, TicketLinkType.RELATED);
      const linkId = (created.body as { data: { id: string }[] }).data[0].id;
      const res = await request(server)
        .delete(`/api/tickets/${a.id}/links/${linkId}`)
        .set(authHeader(fixtureEmails.agent));
      expect(res.status).toBe(200);
      expect(await prisma.ticketLink.count({ where: { id: linkId } })).toBe(0);
      for (const ticketId of [a.id, b.id]) {
        const unlinked = (await eventTypes(ticketId)).filter(
          (e) => e.type === 'TICKET_UNLINKED',
        );
        expect(unlinked).toHaveLength(1);
      }
    });
  });

  describe('unlinking', () => {
    it('works from the other end of the link', async () => {
      const [a, b] = [await makeTicket(), await makeTicket()];
      const created = await link(a.id, b.id, TicketLinkType.RELATED);
      const linkId = (created.body as { data: { id: string }[] }).data[0].id;
      const res = await request(server)
        .delete(`/api/tickets/${b.id}/links/${linkId}`)
        .set(authHeader(fixtureEmails.agent));
      expect(res.status).toBe(200);
      expect(await prisma.ticketLink.count({ where: { id: linkId } })).toBe(0);
    });

    it('refuses a link id that does not touch the ticket in the path', async () => {
      // Without this check a link between two other tickets could be deleted
      // through a ticket the caller happens to own.
      const [a, b, unrelated] = [
        await makeTicket(),
        await makeTicket(),
        await makeTicket(),
      ];
      const created = await link(a.id, b.id, TicketLinkType.RELATED);
      const linkId = (created.body as { data: { id: string }[] }).data[0].id;
      const res = await request(server)
        .delete(`/api/tickets/${unrelated.id}/links/${linkId}`)
        .set(authHeader(fixtureEmails.agent));
      expect(res.status).toBe(404);
      expect(await prisma.ticketLink.count({ where: { id: linkId } })).toBe(1);
    });
  });
});
