import { BadRequestException } from '@nestjs/common';
import { TicketStatus, UserRole } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TicketsService } from './tickets.service';

type Row = {
  id: string;
  displayName: string | null;
  email: string;
  role: UserRole;
  isActive: boolean;
};

const PEOPLE: Record<string, Row> = {
  agent: {
    id: 'agent',
    displayName: 'Ada Agent',
    email: 'ada@example.com',
    role: UserRole.AGENT,
    isActive: true,
  },
  employee: {
    id: 'employee',
    displayName: 'Eli Employee',
    email: 'eli@example.com',
    role: UserRole.EMPLOYEE,
    isActive: true,
  },
  gone: {
    id: 'gone',
    displayName: 'Gus Gone',
    email: 'gus@example.com',
    role: UserRole.AGENT,
    isActive: false,
  },
  owner: {
    id: 'owner',
    displayName: 'Ona Owner',
    email: 'ona@example.com',
    role: UserRole.OWNER,
    isActive: true,
  },
  away: {
    id: 'away',
    displayName: 'Ava Away',
    email: 'ava@example.com',
    role: UserRole.AGENT,
    isActive: true,
  },
};

/**
 * Card 1.110 — on a team-less ticket, assignment used to accept anybody.
 *
 * ⚠️ THE MEMBERSHIP CHECK IS REAL AND CORRECT, AND IT SITS INSIDE
 * `if (ticket.assignedTeamId && ...)`. When a ticket has no team there was no
 * check at all: any user id that existed was accepted — an EMPLOYEE, the
 * requester, somebody from another department. And team-less tickets are not a
 * corner case; they are exactly the ones in the Unassigned queue, where mail to
 * a bare address lands.
 *
 * ⚠️ AND NO PATH CHECKED `isActive`, WITH OR WITHOUT A TEAM. Card 1.89 fixed
 * precisely this at `addMember`, one method over, and the answer was never
 * carried across.
 */
describe('who a ticket can be assigned to (card 1.110)', () => {
  const build = (membership: { id: string } | null = { id: 'm1' }) => {
    const updates: Record<string, unknown>[] = [];
    const tx = {
      user: {
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(PEOPLE[where.id] ?? null),
      },
      teamMember: { findUnique: () => Promise.resolve(membership) },
      ticket: {
        update: (args: { data: Record<string, unknown> }) => {
          updates.push(args.data);
          return Promise.resolve({});
        },
      },
      ticketEvent: { create: () => Promise.resolve({}) },
      ticketFollower: { upsert: () => Promise.resolve({}) },
    };
    const service = Object.create(TicketsService.prototype) as TicketsService;
    return { service, tx, updates };
  };

  type Snapshot = {
    id: string;
    status: TicketStatus;
    assignedTeamId: string | null;
    assigneeId: string | null;
  };

  const teamless: Snapshot = {
    id: 't1',
    status: TicketStatus.NEW,
    assignedTeamId: null,
    assigneeId: null,
  };
  const teamed: Snapshot = { ...teamless, assignedTeamId: 'team-1' };

  const assign = (
    built: ReturnType<typeof build>,
    ticket: Snapshot,
    assigneeId: string,
  ) =>
    built.service.applyAssigneeInTx(
      built.tx as never,
      ticket as never,
      { assigneeId },
      'actor-1',
    );

  it('⚠️ a team-less ticket cannot be assigned to an EMPLOYEE', async () => {
    // THE REGRESSION ASSERTION. This was accepted outright before the card:
    // no team meant no check of any kind.
    const built = build(null);
    await expect(assign(built, teamless, 'employee')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(built.updates).toHaveLength(0);
  });

  it('⚠️ the refusal says why, and names the person', async () => {
    // The browser pass asks for this explicitly: a refusal an agent cannot act
    // on is barely better than the bug.
    const built = build(null);
    await expect(assign(built, teamless, 'employee')).rejects.toThrow(
      /Eli Employee is an employee and cannot be assigned tickets/,
    );
  });

  it('⚠️ a deactivated user is refused WITH a team', async () => {
    const built = build({ id: 'm1' });
    await expect(assign(built, teamed, 'gone')).rejects.toThrow(/is deactivated/);
  });

  it('⚠️ a deactivated user is refused WITHOUT a team', async () => {
    // The half that had no check whatsoever.
    const built = build(null);
    await expect(assign(built, teamless, 'gone')).rejects.toThrow(/is deactivated/);
  });

  it('⚠️ an OWNER can still self-assign a ticket on a team they do not belong to', async () => {
    // NON-VACUITY, AND THE ONE MOST LIKELY TO BREAK. The exemption at :2725 is
    // deliberate - an OWNER has global write access and holds no TeamMember
    // row - and it is easy to lose while tightening.
    const built = build(null);
    await assign(built, teamed, 'owner');
    expect(built.updates[0]).toMatchObject({ assigneeId: 'owner' });
  });

  it('a normal assignment to a team member is completely unaffected', async () => {
    const built = build({ id: 'm1' });
    await assign(built, teamed, 'agent');
    expect(built.updates[0]).toMatchObject({
      assigneeId: 'agent',
      status: TicketStatus.ASSIGNED,
    });
  });

  it('⚠️ an agent on leave CAN still be assigned by hand', async () => {
    // The deliberate gap, locked open by a test. Cards 2.2 and 1.94 are about
    // AUTOMATIC assignment; a lead queueing work for somebody back tomorrow is
    // a legitimate human override, and removing it would be a regression
    // dressed as a fix.
    const built = build({ id: 'm1' });
    await assign(built, teamed, 'away');
    expect(built.updates[0]).toMatchObject({ assigneeId: 'away' });
  });

  it('⚠️ no `isAvailable` check was smuggled in', () => {
    // Asserted from the source, because the test above passes whether or not
    // the field is even selected.
    const source = readFileSync(join(__dirname, 'tickets.service.ts'), 'utf8');
    const body = source.slice(
      source.indexOf('async applyAssigneeInTx('),
      source.indexOf('const assignStatusPromote'),
    );
    // Asserted on CODE, not prose: the comment above the check deliberately
    // says the words "no isAvailable check", and an earlier run of this very
    // test tripped on it.
    expect(body).not.toContain('availableUserFilter');
    expect(body).not.toMatch(/isAvailable\s*[:=]/);
  });

  it('⚠️ the isActive rule is the one card 1.89 wrote, not a second copy', () => {
    const source = readFileSync(join(__dirname, 'tickets.service.ts'), 'utf8');
    expect(source).toContain('assert-user-is-active.util');
    const teams = readFileSync(
      join(__dirname, '..', 'teams', 'teams.service.ts'),
      'utf8',
    );
    expect(teams).toContain('assert-user-is-active.util');
  });
});
