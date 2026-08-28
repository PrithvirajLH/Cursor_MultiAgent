import { ConfigService } from '@nestjs/config';
import { TicketPriority, TicketStatus, UserRole } from '@prisma/client';
import { IntakeService } from './intake.service';
import type { CreateIntakeTicketDto } from './dto/create-intake-ticket.dto';

/**
 * Unit tests for the integration intake service (card 1.19): secret handling,
 * department resolution and what reaches TicketsService.create. No database —
 * Prisma and TicketsService are stubbed.
 */

const REQUESTER = {
  id: 'user-1',
  email: 'pa.test@csnhc.com',
  displayName: 'PA Test',
  role: UserRole.EMPLOYEE,
  primaryTeamId: null,
};

const TICKET_ROW = {
  id: 'ticket-1',
  number: 42,
  displayId: 'IS_20260828_042',
  status: TicketStatus.NEW,
  priority: TicketPriority.SEV3,
  channel: 'API',
  assignedTeam: { id: 'team-hr', name: 'HR', slug: 'hr' },
  category: null,
  requester: {
    id: REQUESTER.id,
    email: REQUESTER.email,
    displayName: 'PA Test',
  },
};

type PrismaStub = {
  team: { findFirst: jest.Mock; findMany: jest.Mock };
  category: { findFirst: jest.Mock; findMany: jest.Mock };
  user: { findUnique: jest.Mock; create: jest.Mock };
  ticket: { findUnique: jest.Mock };
  ticketEvent: { create: jest.Mock };
};

function makePrisma(): PrismaStub {
  return {
    team: {
      findFirst: jest.fn().mockResolvedValue({ id: 'team-hr' }),
      findMany: jest
        .fn()
        .mockResolvedValue([{ slug: 'hr' }, { slug: 'it-service-desk' }]),
    },
    category: {
      findFirst: jest.fn().mockResolvedValue({ id: 'category-1' }),
      findMany: jest.fn().mockResolvedValue([{ slug: 'access-identity' }]),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(REQUESTER),
      create: jest.fn().mockResolvedValue(REQUESTER),
    },
    ticket: { findUnique: jest.fn().mockResolvedValue(TICKET_ROW) },
    ticketEvent: { create: jest.fn().mockResolvedValue({}) },
  };
}

function makeService(
  env: Record<string, string> = { INTAKE_API_SECRET: 'right-secret' },
) {
  const prisma = makePrisma();
  const create = jest.fn().mockResolvedValue({ id: 'ticket-1' });
  const service = new IntakeService(prisma as never, new ConfigService(env), {
    create,
  } as never);
  return { service, prisma, create };
}

const BASE_PAYLOAD: CreateIntakeTicketDto = {
  requesterEmail: 'PA.Test@csnhc.com',
  requesterName: 'PA Test',
  subject: 'Printer jam on 2nd floor',
  description: 'Submitted from a Power Automate flow.',
};

describe('IntakeService.assertIntakeSecret', () => {
  it('refuses when INTAKE_API_SECRET is not configured', () => {
    const { service } = makeService({});
    expect(() => service.assertIntakeSecret('anything')).toThrow(
      'Intake API secret is not configured',
    );
  });

  it('refuses a missing header', () => {
    const { service } = makeService();
    expect(() => service.assertIntakeSecret(undefined)).toThrow(
      'Missing intake API secret',
    );
  });

  it('refuses a wrong secret, including one of a different length', () => {
    const { service } = makeService();
    expect(() => service.assertIntakeSecret('wrong-secret')).toThrow(
      'Invalid intake API secret',
    );
    expect(() => service.assertIntakeSecret('right-secret-plus')).toThrow(
      'Invalid intake API secret',
    );
  });

  it('accepts the configured secret', () => {
    const { service } = makeService();
    expect(() => service.assertIntakeSecret('right-secret')).not.toThrow();
  });
});

describe('IntakeService.createTicket', () => {
  it('creates on channel API with the resolved department and the default priority', async () => {
    const { service, create, prisma } = makeService();
    const response = await service.createTicket(
      { ...BASE_PAYLOAD, department: 'hr', sourceRef: 'run-1' },
      'right-secret',
    );
    expect(create).toHaveBeenCalledTimes(1);
    const args = create.mock.calls[0] as unknown[];
    expect(args[0]).toMatchObject({
      subject: BASE_PAYLOAD.subject,
      description: BASE_PAYLOAD.description,
      priority: TicketPriority.SEV3,
      channel: 'API',
      requesterId: REQUESTER.id,
      assignedTeamId: 'team-hr',
    });
    expect(args[1]).toMatchObject({
      id: REQUESTER.id,
      role: UserRole.EMPLOYEE,
    });
    const eventArgs = prisma.ticketEvent.create.mock.calls[0] as unknown[];
    expect(eventArgs[0]).toMatchObject({
      data: {
        type: 'TICKET_CREATED_VIA_INTAKE',
        payload: { sourceRef: 'run-1', department: 'hr', byIntegration: true },
      },
    });
    expect(response).toEqual(TICKET_ROW);
  });

  it('passes no team when department is omitted, so routing rules still decide', async () => {
    const { service, create, prisma } = makeService();
    await service.createTicket({ ...BASE_PAYLOAD }, 'right-secret');
    expect(prisma.team.findFirst).not.toHaveBeenCalled();
    const args = create.mock.calls[0] as unknown[];
    expect(args[0]).toMatchObject({ assignedTeamId: undefined });
  });

  it('keeps an explicit priority', async () => {
    const { service, create } = makeService();
    await service.createTicket(
      { ...BASE_PAYLOAD, priority: TicketPriority.SEV1 },
      'right-secret',
    );
    const args = create.mock.calls[0] as unknown[];
    expect(args[0]).toMatchObject({ priority: TicketPriority.SEV1 });
  });

  it('rejects an unknown department and lists the valid slugs', async () => {
    const { service, prisma, create } = makeService();
    prisma.team.findFirst.mockResolvedValue(null);
    await expect(
      service.createTicket(
        { ...BASE_PAYLOAD, department: 'nope' },
        'right-secret',
      ),
    ).rejects.toThrow('Unknown department "nope". Valid: hr, it-service-desk');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an unknown category and lists the valid slugs', async () => {
    const { service, prisma } = makeService();
    prisma.category.findFirst.mockResolvedValue(null);
    await expect(
      service.createTicket(
        { ...BASE_PAYLOAD, category: 'nope' },
        'right-secret',
      ),
    ).rejects.toThrow('Unknown category "nope". Valid: access-identity');
  });

  it('creates an EMPLOYEE for an unknown address, lowercasing the email', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(null);
    await service.createTicket({ ...BASE_PAYLOAD }, 'right-secret');
    const args = prisma.user.create.mock.calls[0] as unknown[];
    expect(args[0]).toMatchObject({
      data: {
        email: 'pa.test@csnhc.com',
        displayName: 'PA Test',
        role: UserRole.EMPLOYEE,
      },
    });
  });

  it('never creates a ticket when the secret is wrong', async () => {
    const { service, create } = makeService();
    await expect(
      service.createTicket({ ...BASE_PAYLOAD }, 'wrong'),
    ).rejects.toThrow('Invalid intake API secret');
    expect(create).not.toHaveBeenCalled();
  });
});
