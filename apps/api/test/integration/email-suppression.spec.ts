import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EmailSuppressionService } from '../../src/notifications/email-suppression.service';
import { resolveOutboundRecipients } from '../../src/notifications/outbound-recipients.util';
import { fixtureEmails } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

const BOUNCED = 'bounced@csnhc.com';
const SOFT_FAILED = 'mailbox-full@csnhc.com';

type SuppressionListResponse = {
  data: Array<{
    address: string;
    kind: string;
    failureCount: number;
    lastReason: string | null;
  }>;
};

describe('Email suppression', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let prisma: PrismaService;
  let suppression: EmailSuppressionService;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    prisma = app.get(PrismaService);
    suppression = app.get(EmailSuppressionService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.emailSuppression.deleteMany({});
  });

  it('refuses a hard-failed address, with the reason readable', async () => {
    await suppression.recordFailure(BOUNCED, 'HARD', '550 5.1.1 no such mailbox');
    expect(await suppression.isSuppressed(BOUNCED)).toBe(true);
    // The guard the send path actually consults.
    const resolved = resolveOutboundRecipients({
      recipients: [{ address: BOUNCED }],
      allowedDomains: 'csnhc.com',
      suppressed: [BOUNCED],
    });
    expect(resolved.allowed).toEqual([]);
    expect(resolved.refused).toEqual([
      { address: BOUNCED, reason: 'suppressed after a bounce' },
    ]);
  });

  it('keeps the suppression in the database, not in memory', async () => {
    await suppression.recordFailure(BOUNCED, 'HARD', '550 5.1.1 no such mailbox');
    // Read the row directly: this is the difference from card 1.22's stub, and
    // it is what survives a restart.
    const row = await prisma.emailSuppression.findUnique({
      where: { address: BOUNCED },
    });
    expect(row?.kind).toBe('HARD');
    expect(row?.failureCount).toBe(1);
    expect(row?.lastReason).toContain('550');
  });

  it('needs five soft failures before it stops sending', async () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await suppression.recordFailure(SOFT_FAILED, 'SOFT', '452 mailbox full');
    }
    expect(await suppression.isSuppressed(SOFT_FAILED)).toBe(false);
    await suppression.recordFailure(SOFT_FAILED, 'SOFT', '452 mailbox full');
    expect(await suppression.isSuppressed(SOFT_FAILED)).toBe(true);
  });

  it('sends again once an owner clears the address', async () => {
    await suppression.recordFailure(BOUNCED, 'HARD', '550');
    expect(await suppression.isSuppressed(BOUNCED)).toBe(true);

    await request(server)
      .post('/api/operations/email-suppressions/clear')
      .set(authHeader(fixtureEmails.owner))
      .send({ address: BOUNCED })
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({ cleared: true });
      });

    expect(await suppression.isSuppressed(BOUNCED)).toBe(false);
    const resolved = resolveOutboundRecipients({
      recipients: [{ address: BOUNCED }],
      allowedDomains: 'csnhc.com',
      suppressed: [],
    });
    expect(resolved.allowed).toEqual([BOUNCED]);
  });

  it('lists what is suppressed for the owner', async () => {
    await suppression.recordFailure(BOUNCED, 'HARD', '550 5.1.1 no such mailbox');
    const response = await request(server)
      .get('/api/operations/email-suppressions')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const body = response.body as SuppressionListResponse;
    const entry = body.data.find((row) => row.address === BOUNCED);
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe('HARD');
    expect(entry?.lastReason).toContain('550');
  });

  it('reports honestly when there was nothing to clear', async () => {
    await request(server)
      .post('/api/operations/email-suppressions/clear')
      .set(authHeader(fixtureEmails.owner))
      .send({ address: 'never-failed@csnhc.com' })
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual({ cleared: false });
      });
  });

  it('refuses anything that is not an address', async () => {
    await request(server)
      .post('/api/operations/email-suppressions/clear')
      .set(authHeader(fixtureEmails.owner))
      .send({ address: 'not-an-address' })
      .expect(400);
  });

  it('is owner-only: a team admin and a lead are both refused', async () => {
    for (const email of [fixtureEmails.admin, fixtureEmails.lead]) {
      await request(server)
        .get('/api/operations/email-suppressions')
        .set(authHeader(email))
        .expect(403);
      await request(server)
        .post('/api/operations/email-suppressions/clear')
        .set(authHeader(email))
        .send({ address: BOUNCED })
        .expect(403);
    }
  });

  it('is owner-only: an agent is refused too', async () => {
    await request(server)
      .get('/api/operations/email-suppressions')
      .set(authHeader(fixtureEmails.agent))
      .expect(403);
  });
});
