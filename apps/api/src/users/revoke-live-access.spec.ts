import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeService } from '../realtime/realtime.service';
import { UsersService } from './users.service';

const OWNER: AuthUser = {
  id: 'owner-1',
  email: 'owner@example.com',
  displayName: 'Owner',
  role: UserRole.OWNER,
};

/**
 * Card 1.109 — a switched-off account loses its live feed now, not in an hour.
 *
 * ⚠️ CARD 1.78 CLOSED THE HTTP DOOR AND IT WORKS. `auth.guard.ts` refuses a
 * deactivated person before any write. But `negotiateForUser` mints a Web PubSub
 * token with the user's groups BAKED IN, living for
 * `AZURE_WEB_PUBSUB_TOKEN_LIFETIME_MINUTES` — default 60, and set in production
 * — and nothing anywhere closed a connection or dropped a group. So for up to an
 * hour an offboarded account kept receiving ticket subjects and requester names.
 *
 * ⚠️ THE DEMOTION CASE IS QUIETER AND WORSE. A LEAD demoted to AGENT kept the
 * lead group's events until their token expired, and nobody would have noticed.
 */
describe('a revoked user loses the live feed immediately (card 1.109)', () => {
  /** A deactivation that succeeds, with the realtime call under our control. */
  const build = (revoke: jest.Mock) => {
    const updates: { where: { id: string }; data: Record<string, unknown> }[] = [];
    const tx = {
      ticket: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      routingRule: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      teamMember: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        update: jest.fn((args: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push(args);
          return Promise.resolve({});
        }),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'victim',
          isActive: true,
          role: UserRole.AGENT,
          email: 'victim@example.com',
          displayName: 'Victim',
          primaryTeamId: null,
        }),
        update: jest.fn().mockResolvedValue({ id: 'victim' }),
        count: jest.fn().mockResolvedValue(5),
      },
      team: { findUnique: jest.fn().mockResolvedValue({ id: 'team-1' }) },
      $transaction: jest.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const service = new UsersService(
      prisma as unknown as PrismaService,
      { revokeLiveAccess: revoke } as unknown as RealtimeService,
    );
    return { service, prisma, updates };
  };

  it('⚠️ deactivating closes the connection and drops the groups', async () => {
    // THE REGRESSION ASSERTION. Before this card nothing in the codebase called
    // either operation — `grep -rn "closeConnection\|removeUserFromAllGroups"`
    // returned nothing at all.
    const revoke = jest.fn().mockResolvedValue(undefined);
    const { service } = build(revoke);
    await service.deactivate('victim', OWNER);
    expect(revoke).toHaveBeenCalledWith('victim', expect.stringMatching(/deactivated/i));
  });

  it('⚠️ a demoted LEAD loses the lead group', async () => {
    const revoke = jest.fn().mockResolvedValue(undefined);
    const { service, prisma } = build(revoke);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'lead-1',
      isActive: true,
      role: UserRole.LEAD,
      email: 'lead@example.com',
      displayName: 'Lead',
      primaryTeamId: 'team-1',
    });
    await service.updateRole('lead-1', { role: UserRole.AGENT }, OWNER);
    expect(revoke).toHaveBeenCalledWith('lead-1', expect.stringMatching(/LEAD to AGENT/));
  });

  it('⚠️ the deactivation still succeeds when the realtime call throws', async () => {
    // NON-VACUITY, AND THE IMPORTANT ONE. A user who cannot be switched off
    // because Azure was unreachable is a worse bug than the one being fixed
    // here, so this asserts the row was actually written.
    const revoke = jest.fn().mockRejectedValue(new Error('Web PubSub unreachable'));
    const { service, updates } = build(revoke);
    await expect(service.deactivate('victim', OWNER)).resolves.toMatchObject({ ok: true });
    const deactivation = updates.find((u) => u.data.isActive === false);
    expect(deactivation).toBeDefined();
    expect(deactivation?.where.id).toBe('victim');
  });

  it('nobody else is disconnected by somebody else\'s deactivation', async () => {
    const revoke = jest.fn().mockResolvedValue(undefined);
    const { service } = build(revoke);
    await service.deactivate('victim', OWNER);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke.mock.calls[0][0]).toBe('victim');
  });

  it('⚠️ a role change to the same role does not disconnect anybody', async () => {
    // NON-VACUITY. Revoking on every write would make each save cost every open
    // tab a reconnect, and no group can have changed when the role has not.
    const revoke = jest.fn().mockResolvedValue(undefined);
    const { service, prisma } = build(revoke);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'agent-1',
      isActive: true,
      role: UserRole.AGENT,
      email: 'agent@example.com',
      displayName: 'Agent',
      primaryTeamId: null,
    });
    await service.updateRole('agent-1', { role: UserRole.AGENT }, OWNER);
    expect(revoke).not.toHaveBeenCalled();
  });
});
