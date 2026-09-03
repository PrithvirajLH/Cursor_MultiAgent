import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { AuthGuard } from '../../src/auth/auth.guard';
import {
  DuplicateAccountService,
  PROBABLE_DUPLICATE_ACCOUNT_EVENT,
} from '../../src/common/duplicate-account.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { fixtureTeamIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

const inboundSecretHeader = { 'x-inbound-email-secret': 'test-inbound-secret' };
const intakeSecretHeader = { 'x-intake-secret': 'test-intake-secret' };

/**
 * Card 1.30. One human becomes two accounts because all three provisioning
 * paths match addresses as an exact string.
 *
 * The rule these tests defend is that flagging is inert: it must record the
 * suspicion and change nothing else. Refusing to provision would drop an
 * inbound email or reject an intake form, and a lost message is a worse failure
 * than a duplicate row.
 */
describe('Probable duplicate accounts', () => {
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

  /**
   * Provision the way a real login does.
   *
   * The insecure `x-user-email` header deliberately sets
   * `provisionIfMissing: false` (auth.guard.ts) - the dev header path looks
   * users up and 401s on an unknown one, so it CANNOT create an account and
   * cannot exercise this path over HTTP. Only a bearer token provisions. So
   * this drives the guard's own method with the app's real dependencies, which
   * is the same code a token would reach.
   */
  async function provisionByLogin(email: string, displayName: string) {
    const guard = new AuthGuard(
      app.get(PrismaService),
      new Reflector(),
      app.get(ConfigService),
      app.get(DuplicateAccountService),
    );
    return (
      guard as unknown as {
        findOrProvisionUser(identity: {
          userId: string | null;
          email: string;
          displayName: string | null;
          department: string | null;
          location: string | null;
          provisionIfMissing: boolean;
        }): Promise<{ id: string; email: string }>;
      }
    ).findOrProvisionUser({
      userId: null,
      email,
      displayName,
      department: null,
      location: null,
      provisionIfMissing: true,
    });
  }

  let seq = 0;
  const unique = () => {
    seq += 1;
    return `${Date.now()}${seq}`;
  };

  async function flagsFor(email: string) {
    return prisma.adminAuditEvent.findMany({
      where: { type: PROBABLE_DUPLICATE_ACCOUNT_EVENT, actorEmail: email },
      select: { payload: true },
    });
  }

  /** Seeds the short form so the long form arriving later looks like a duplicate. */
  async function seedShortForm(surname: string) {
    const email = `p${surname}@company.com`;
    await prisma.user.create({
      data: { email, displayName: `P ${surname}`, role: 'AGENT' },
    });
    return email;
  }

  describe('the inbound email path', () => {
    it('still creates the ticket and the user, and records the flag', async () => {
      const surname = `inbound${unique()}`;
      const short = await seedShortForm(surname);
      const long = `prithviraj_${surname}@company.com`;

      const res = await request(server)
        .post('/api/tickets/inbound-email')
        .set(inboundSecretHeader)
        .send({
          fromEmail: long,
          fromName: 'Long Form',
          subject: `Duplicate probe ${surname}`,
          body: 'THIS MESSAGE MUST NOT BE DROPPED.',
          messageId: `dup-${surname}@mail.example`,
        })
        .expect(201);

      const ticketId = (res.body as { ticket: { id: string } }).ticket.id;
      // The body itself, not just the response: flagging must never be able to
      // lose mail. A NEW inbound ticket carries the body as its description -
      // addMessage only runs on the threaded path - so that is where to look.
      const ticket = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticketId },
        select: { description: true },
      });
      expect(ticket.description).toContain('THIS MESSAGE MUST NOT BE DROPPED.');

      const created = await prisma.user.findUnique({ where: { email: long } });
      expect(created).not.toBeNull();

      const flags = await flagsFor(long);
      expect(flags).toHaveLength(1);
      expect(flags[0].payload).toMatchObject({ verdict: 'probable' });
      expect(JSON.stringify(flags[0].payload)).toContain(short);
    });

    it('creates a ticket for a brand-new unrelated address with no flag', async () => {
      const address = `stranger${unique()}@company.com`;
      const res = await request(server)
        .post('/api/tickets/inbound-email')
        .set(inboundSecretHeader)
        .send({
          fromEmail: address,
          fromName: 'Stranger',
          subject: 'A first-time sender',
          body: 'ALSO MUST NOT BE DROPPED.',
          messageId: `stranger-${unique()}@mail.example`,
        })
        .expect(201);
      const ticketId = (res.body as { ticket: { id: string } }).ticket.id;
      const ticket = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticketId },
        select: { description: true },
      });
      expect(ticket.description).toContain('ALSO MUST NOT BE DROPPED.');
      expect(await flagsFor(address)).toHaveLength(0);
    });
  });

  describe('the intake path', () => {
    it('still creates the ticket and records the flag', async () => {
      const surname = `intake${unique()}`;
      const short = await seedShortForm(surname);
      const long = `prithviraj_${surname}@company.com`;

      await request(server)
        .post('/api/tickets/intake')
        .set(intakeSecretHeader)
        // The endpoint requires the flow run id as an idempotency key.
        .set({ 'Idempotency-Key': `dup-intake-${surname}` })
        .send({
          requesterEmail: long,
          requesterName: 'Long Form',
          subject: `Intake duplicate probe ${surname}`,
          description: 'Raised through the intake endpoint.',
        })
        .expect(201);

      expect(
        await prisma.user.findUnique({ where: { email: long } }),
      ).not.toBeNull();
      const flags = await flagsFor(long);
      expect(flags).toHaveLength(1);
      expect(JSON.stringify(flags[0].payload)).toContain(short);
    });
  });

  describe('the login path', () => {
    it('provisions the user on first request and records the flag', async () => {
      const surname = `login${unique()}`;
      const short = await seedShortForm(surname);
      const long = `prithviraj_${surname}@company.com`;

      await provisionByLogin(long, 'Long Form');

      const created = await prisma.user.findUnique({ where: { email: long } });
      expect(created).not.toBeNull();
      const flags = await flagsFor(long);
      expect(flags).toHaveLength(1);
      expect(JSON.stringify(flags[0].payload)).toContain(short);
    });

    it('records nothing on the second request, because nothing is created', async () => {
      const surname = `repeat${unique()}`;
      await seedShortForm(surname);
      const long = `prithviraj_${surname}@company.com`;
      for (let i = 0; i < 3; i += 1) {
        await provisionByLogin(long, 'Long Form');
      }
      // Flagged at creation, not on every login — otherwise the audit log
      // fills with the same finding forever.
      expect(await flagsFor(long)).toHaveLength(1);
    });
  });

  describe('two different people who share a short form', () => {
    it('is recorded as ambiguous, and neither account is touched', async () => {
      const surname = `smith${unique()}`;
      await prisma.user.create({
        data: {
          email: `john_${surname}@company.com`,
          displayName: 'John',
          role: 'EMPLOYEE',
        },
      });
      await prisma.user.create({
        data: {
          email: `j${surname}@company.com`,
          displayName: 'J',
          role: 'AGENT',
        },
      });
      const arriving = `jane_${surname}@company.com`;

      await provisionByLogin(arriving, 'Jane');

      const flags = await flagsFor(arriving);
      expect(flags).toHaveLength(1);
      expect(flags[0].payload).toMatchObject({ verdict: 'ambiguous' });

      // All three rows still exist and are untouched. Nothing merges itself.
      for (const email of [
        `john_${surname}@company.com`,
        `j${surname}@company.com`,
        arriving,
      ]) {
        const row = await prisma.user.findUnique({ where: { email } });
        expect(row).not.toBeNull();
        expect(row!.isActive).toBe(true);
      }
    });
  });

  describe('when the check itself fails', () => {
    it('does not stop a ticket being created', async () => {
      // The flag is best-effort by construction: DuplicateAccountService
      // swallows its own errors. Simulated by making the audit write fail.
      const spy = jest
        .spyOn(prisma.adminAuditEvent, 'create')
        .mockRejectedValue(new Error('audit table unavailable'));
      try {
        const surname = `broken${unique()}`;
        await seedShortForm(surname);
        const long = `prithviraj_${surname}@company.com`;
        const res = await request(server)
          .post('/api/tickets/inbound-email')
          .set(inboundSecretHeader)
          .send({
            fromEmail: long,
            fromName: 'Long Form',
            subject: `Broken audit probe ${surname}`,
            body: 'STILL MUST NOT BE DROPPED.',
            messageId: `broken-${surname}@mail.example`,
          })
          .expect(201);
        const ticketId = (res.body as { ticket: { id: string } }).ticket.id;
        const ticket = await prisma.ticket.findUniqueOrThrow({
          where: { id: ticketId },
          select: { description: true },
        });
        expect(ticket.description).toContain('STILL MUST NOT BE DROPPED.');
        expect(
          await prisma.user.findUnique({ where: { email: long } }),
        ).not.toBeNull();
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('leaves the fixture teams alone', async () => {
    // Guards against a flag write accidentally scribbling on team rows.
    const teams = await prisma.team.count({
      where: { id: { in: [fixtureTeamIds.it, fixtureTeamIds.hr] } },
    });
    expect(teams).toBe(2);
  });
});
