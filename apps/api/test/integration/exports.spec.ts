import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { disconnectPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type TicketResponse = { id: string; displayId: string | null; subject: string };
type TicketListResponse = { data: TicketResponse[]; meta: { total: number } };

/** supertest has no parser for text/csv, so the body arrives as a Buffer. */
function csvOf(res: request.Response): string {
  if (typeof res.text === 'string' && res.text.length > 0) {
    return res.text;
  }
  return Buffer.isBuffer(res.body)
    ? res.body.toString('utf8')
    : String(res.body);
}

function dataLines(csv: string): string[] {
  return csv
    .split('\n')
    .slice(1)
    .filter((line) => line.trim().length > 0 && !line.startsWith('#'));
}

describe('CSV exports (card 1.13)', () => {
  let app: INestApplication;
  let server: SupertestApp;

  async function createTicket(
    subject: string,
    email: string = fixtureEmails.requester,
    teamId: string = fixtureTeamIds.it,
  ): Promise<TicketResponse> {
    const res = await request(server)
      .post('/api/tickets')
      .set(authHeader(email))
      .send({
        subject,
        description: 'Export spec ticket',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: teamId,
      })
      .expect(201);
    return res.body as TicketResponse;
  }

  /** Walk a ticket to CLOSED along whatever transitions it actually offers. */
  async function driveToClosed(ticketId: string): Promise<void> {
    for (let step = 0; step < 8; step++) {
      const detail = await request(server)
        .get(`/api/tickets/${ticketId}`)
        .set(authHeader(fixtureEmails.admin))
        .expect(200);
      const body = detail.body as {
        status: string;
        allowedTransitions?: string[];
      };
      if (body.status === 'CLOSED') return;
      const allowed = body.allowedTransitions ?? [];
      const next =
        allowed.find((status) => status === 'CLOSED') ??
        allowed.find((status) => status === 'RESOLVED') ??
        allowed.find((status) => status === 'IN_PROGRESS') ??
        allowed[0];
      if (!next) throw new Error(`no transition out of ${body.status}`);
      await request(server)
        .post(`/api/tickets/${ticketId}/transition`)
        .set(authHeader(fixtureEmails.admin))
        .send({ status: next })
        .expect(201);
    }
    throw new Error('ticket never reached CLOSED');
  }

  async function exportTickets(email: string, query = '') {
    return request(server)
      .get(`/api/tickets/export.csv${query}`)
      .set(authHeader(email))
      .buffer(true)
      .expect(200);
  }

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  it('1: streams the ticket list a lead can see, with a header and one row per ticket', async () => {
    await createTicket(`Export baseline ${Date.now()}`);
    const res = await exportTickets(fixtureEmails.lead, '?statusGroup=all');
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toContain('tickets-');
    const csv = csvOf(res);
    const [header] = csv.split('\n');
    expect(header).toBe(
      'Ticket,Subject,Status,Priority,Department,Assignee,Requester,Requester email,Category,Channel,Tags,Created,Updated,Resolved,Closed,Close reason,First response due,Resolution due,SLA state',
    );
    const list = await request(server)
      .get('/api/tickets?statusGroup=all&pageSize=100')
      .set(authHeader(fixtureEmails.lead))
      .expect(200);
    const listBody = list.body as TicketListResponse;
    expect(dataLines(csv)).toHaveLength(listBody.meta.total);
  });

  it('2: honours the filters — statusGroup=open drops closed tickets', async () => {
    const closing = await createTicket(`Export closed ${Date.now()}`);
    await driveToClosed(closing.id);
    const all = dataLines(
      csvOf(await exportTickets(fixtureEmails.lead, '?statusGroup=all')),
    );
    const open = dataLines(
      csvOf(await exportTickets(fixtureEmails.lead, '?statusGroup=open')),
    );
    expect(open.length).toBeLessThan(all.length);
    expect(open.some((line) => line.includes('Closed'))).toBe(false);
    expect(
      all.some((line) => line.includes(closing.displayId ?? 'never')),
    ).toBe(true);
    expect(
      open.some((line) => line.includes(closing.displayId ?? 'never')),
    ).toBe(false);
  });

  it('3: never widens access — a requester exports only their own tickets', async () => {
    const mine = await createTicket(`Export mine ${Date.now()}`);
    const theirs = await createTicket(
      `Export theirs ${Date.now()}`,
      fixtureEmails.otherRequester,
    );
    const csv = csvOf(
      await exportTickets(fixtureEmails.requester, '?statusGroup=all'),
    );
    expect(csv).toContain(mine.displayId ?? 'missing');
    expect(csv).not.toContain(theirs.displayId ?? 'missing');
    const hrTicket = await createTicket(
      `Export hr only ${Date.now()}`,
      fixtureEmails.requester,
      fixtureTeamIds.hr,
    );
    const agentCsv = csvOf(
      await exportTickets(fixtureEmails.agent, '?statusGroup=all'),
    );
    expect(agentCsv).not.toContain(hrTicket.displayId ?? 'missing');
  });

  it('4: a soft-deleted ticket never appears', async () => {
    const doomed = await createTicket(`Export deleted ${Date.now()}`);
    await request(server)
      .delete(`/api/tickets/${doomed.id}`)
      .set(authHeader(fixtureEmails.owner))
      .send({ reason: 'export spec' })
      .expect(200);
    const csv = csvOf(
      await exportTickets(fixtureEmails.lead, '?statusGroup=all'),
    );
    expect(csv).not.toContain(doomed.displayId ?? 'missing');
  });

  it('5: quotes separators and defuses spreadsheet formulas', async () => {
    const quoted = await createTicket(`Broken, "urgent" ${Date.now()}`);
    const formula = await createTicket(`=SUM(A1) ${Date.now()}`);
    const csv = csvOf(
      await exportTickets(fixtureEmails.lead, '?statusGroup=all'),
    );
    const quotedLine = dataLines(csv).find((line) =>
      line.includes(quoted.displayId ?? 'missing'),
    );
    const formulaLine = dataLines(csv).find((line) =>
      line.includes(formula.displayId ?? 'missing'),
    );
    expect(quotedLine).toContain('"Broken, ""urgent""');
    // Defused with a leading apostrophe; no comma or quote inside, so no quoting.
    expect(formulaLine).toContain(",'=SUM(A1)");
  });

  it('6: report exports are guarded, validated and tabular', async () => {
    const ok = await request(server)
      .get('/api/reports/team-summary/export.csv')
      .set(authHeader(fixtureEmails.admin))
      .buffer(true)
      .expect(200);
    expect(ok.headers['content-type']).toMatch(/^text\/csv/);
    expect(ok.headers['content-disposition']).toContain('report-team-summary-');
    const csv = csvOf(ok);
    expect(csv.split('\n')[0]).toContain('Name');
    expect(dataLines(csv).length).toBeGreaterThan(0);

    const bad = await request(server)
      .get('/api/reports/nope/export.csv')
      .set(authHeader(fixtureEmails.admin))
      .expect(400);
    const message = (bad.body as { message: string }).message;
    expect(message).toContain('Unknown report "nope"');
    expect(message).toContain('team-summary');

    await request(server)
      .get('/api/reports/team-summary/export.csv')
      .set(authHeader(fixtureEmails.agent))
      .expect(403);
  });
});
