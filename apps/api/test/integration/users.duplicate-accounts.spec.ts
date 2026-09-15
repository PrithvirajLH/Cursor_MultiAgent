import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { ApiKeysService } from '../../src/api-keys/api-keys.service';
import { AuthGuard } from '../../src/auth/auth.guard';
import {
  DuplicateAccountService,
  PROBABLE_DUPLICATE_ACCOUNT_EVENT,
} from '../../src/common/duplicate-account.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { UserIdentityService } from '../../src/common/user-identity.service';
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
  async function provisionByLogin(
    email: string,
    displayName: string,
    extra?: {
      entraObjectId?: string | null;
      directoryAddresses?: { email: string; source: string }[];
    },
  ) {
    const guard = new AuthGuard(
      app.get(PrismaService),
      new Reflector(),
      app.get(ConfigService),
      app.get(DuplicateAccountService),
      app.get(UserIdentityService),
      app.get(ApiKeysService),
    );
    return (
      guard as unknown as {
        findOrProvisionUser(
          identity: Record<string, unknown>,
        ): Promise<{ id: string; email: string }>;
      }
    ).findOrProvisionUser({
      userId: null,
      email,
      displayName,
      department: null,
      location: null,
      provisionIfMissing: true,
      ...(extra ?? {}),
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
  /**
   * Card 1.30, PREVENT. The real duplicate was NOT made by a login: Entra gives
   * this tenant `userPrincipalName = phulgur@` and `mail = Prithviraj_Hulgur@`,
   * and the login resolves the UPN, so it lands on the right row. The twin came
   * from intake or inbound email, which only ever see the `mail` form.
   *
   * Confirmed against real stored Graph profiles in the dev database on
   * 2026-09-03: one account has mail !== userPrincipalName, and a GUID object id.
   */
  describe('PREVENT - keying on the directory object', () => {
    const OID = () => `oid-${unique()}`;

    it('stamps an existing email-matched row instead of creating a second one', async () => {
      const address = `stamp${unique()}@company.com`;
      const before = await prisma.user.create({
        data: { email: address, displayName: 'Already Here', role: 'EMPLOYEE' },
      });
      expect(before.entraObjectId).toBeNull();

      const oid = OID();
      await provisionByLogin(address, 'Already Here', {
        entraObjectId: oid,
        directoryAddresses: [{ email: address, source: 'preferred_username' }],
      });

      const after = await prisma.user.findUniqueOrThrow({
        where: { email: address },
      });
      expect(after.id).toBe(before.id);
      expect(after.entraObjectId).toBe(oid);
      expect(await prisma.user.count({ where: { entraObjectId: oid } })).toBe(1);
    });

    it('resolves the SAME row when the next token carries a different address', async () => {
      // The case that produced the production duplicate, arriving by login.
      const upn = `upn${unique()}@company.com`;
      const mail = `long_form${unique()}@company.com`;
      const oid = OID();

      const first = await provisionByLogin(upn, 'Two Addresses', {
        entraObjectId: oid,
        directoryAddresses: [{ email: upn, source: 'preferred_username' }],
      });
      const usersBefore = await prisma.user.count();

      const second = await provisionByLogin(mail, 'Two Addresses', {
        entraObjectId: oid,
        directoryAddresses: [
          { email: mail, source: 'email' },
          { email: upn, source: 'upn' },
        ],
      });

      expect(second.id).toBe(first.id);
      expect(await prisma.user.count()).toBe(usersBefore);
      // The stored address is NOT overwritten - the row is the human, the
      // address is one of their labels.
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: first.id },
      });
      expect(row.email).toBe(upn);
    });

    it('behaves exactly as before for a token with no oid', async () => {
      const address = `nooid${unique()}@company.com`;
      const created = await provisionByLogin(address, 'No Oid');
      const row = await prisma.user.findUniqueOrThrow({
        where: { email: address },
      });
      expect(row.id).toBe(created.id);
      expect(row.entraObjectId).toBeNull();
      // A second login still resolves by address, creating nothing.
      const again = await provisionByLogin(address, 'No Oid');
      expect(again.id).toBe(created.id);
    });

    it('records every address the token presented, deduplicated', async () => {
      const upn = `rec${unique()}@company.com`;
      const mail = `rec_long${unique()}@company.com`;
      const user = await provisionByLogin(upn, 'Recorded', {
        entraObjectId: OID(),
        directoryAddresses: [
          { email: upn, source: 'preferred_username' },
          { email: upn, source: 'upn' },
          { email: mail, source: 'email' },
        ],
      });
      const aliases = await prisma.userEmailAlias.findMany({
        where: { userId: user.id },
        select: { email: true },
      });
      expect(aliases.map((a) => a.email).sort()).toEqual([mail, upn].sort());
    });

    it('does not steal an address already recorded against someone else', async () => {
      const shared = `shared${unique()}@company.com`;
      const first = await provisionByLogin(`one${unique()}@company.com`, 'One', {
        entraObjectId: OID(),
        directoryAddresses: [{ email: shared, source: 'email' }],
      });
      await provisionByLogin(`two${unique()}@company.com`, 'Two', {
        entraObjectId: OID(),
        directoryAddresses: [{ email: shared, source: 'email' }],
      });
      const owner = await prisma.userEmailAlias.findUniqueOrThrow({
        where: { email: shared },
      });
      expect(owner.userId).toBe(first.id);
    });
  });

  describe('PREVENT - the other two paths resolve by a recorded address', () => {
    /** A human who has logged in, with a second address the directory gave us. */
    async function humanWithAlias() {
      const upn = `staff${unique()}@company.com`;
      const mail = `staff_long${unique()}@company.com`;
      const user = await provisionByLogin(upn, 'Staff Member', {
        entraObjectId: `oid-${unique()}`,
        directoryAddresses: [
          { email: upn, source: 'preferred_username' },
          { email: mail, source: 'email' },
        ],
      });
      return { userId: user.id, upn, mail };
    }

    it('inbound email lands on the existing human, not a new account', async () => {
      const { userId, mail } = await humanWithAlias();
      const usersBefore = await prisma.user.count();

      const res = await request(server)
        .post('/api/tickets/inbound-email')
        .set(inboundSecretHeader)
        .send({
          fromEmail: mail,
          fromName: 'Staff Member',
          subject: `Alias resolve ${unique()}`,
          body: 'RESOLVED BY ALIAS.',
          messageId: `alias-${unique()}@mail.example`,
        })
        .expect(201);

      const ticketId = (res.body as { ticket: { id: string } }).ticket.id;
      const ticket = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticketId },
        select: { requesterId: true, description: true },
      });
      expect(ticket.requesterId).toBe(userId);
      expect(ticket.description).toContain('RESOLVED BY ALIAS.');
      expect(await prisma.user.count()).toBe(usersBefore);
    });

    it('intake lands on the existing human too', async () => {
      const { userId, mail } = await humanWithAlias();
      const usersBefore = await prisma.user.count();

      const res = await request(server)
        .post('/api/tickets/intake')
        .set(intakeSecretHeader)
        .set({ 'Idempotency-Key': `alias-intake-${unique()}` })
        .send({
          requesterEmail: mail,
          requesterName: 'Staff Member',
          subject: `Alias intake ${unique()}`,
          description: 'Submitted with the mail form of the address.',
        })
        .expect(201);

      const body = res.body as { id?: string; ticket?: { id: string } };
      const ticketId = body.id ?? body.ticket!.id;
      const ticket = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticketId },
        select: { requesterId: true },
      });
      expect(ticket.requesterId).toBe(userId);
      expect(await prisma.user.count()).toBe(usersBefore);
    });

    it('an unrecognised address still provisions and still lands the message', async () => {
      // Resolution must never be able to block provisioning. Asserting the
      // stored body, not just the response - card 1.29's test asserted the
      // wrong thing and passed on a real bug.
      const stranger = `unknown${unique()}@company.com`;
      const res = await request(server)
        .post('/api/tickets/inbound-email')
        .set(inboundSecretHeader)
        .send({
          fromEmail: stranger,
          fromName: 'Stranger',
          subject: `Unrecognised ${unique()}`,
          body: 'STILL LANDS.',
          messageId: `unknown-${unique()}@mail.example`,
        })
        .expect(201);
      const ticketId = (res.body as { ticket: { id: string } }).ticket.id;
      const ticket = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticketId },
        select: { description: true },
      });
      expect(ticket.description).toContain('STILL LANDS.');
      expect(
        await prisma.user.findUnique({ where: { email: stranger } }),
      ).not.toBeNull();
    });
  });
});
