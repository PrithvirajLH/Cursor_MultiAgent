import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from './realtime.service';

/**
 * Card 1.109, the transport half — what `revokeLiveAccess` actually does.
 *
 * ⚠️ ORDER IS THE POINT. Groups are dropped BEFORE the socket is closed, so a
 * message published in the gap between the two calls cannot reach them. Closing
 * first would leave a window where the connection is gone but the group
 * membership is not, and the client reconnects with the token it already holds.
 */
describe('revokeLiveAccess (card 1.109)', () => {
  const build = (client: Record<string, unknown> | null) => {
    const service = Object.create(RealtimeService.prototype) as RealtimeService;
    Object.assign(service, {
      client,
      config: { get: () => undefined } as unknown as ConfigService,
      prisma: {} as unknown as PrismaService,
      logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn(), debug: jest.fn() },
    });
    return service;
  };

  it('⚠️ drops every group, then closes the connections', async () => {
    const order: string[] = [];
    const removeUserFromAllGroups = jest.fn(() => {
      order.push('groups');
      return Promise.resolve();
    });
    const closeUserConnections = jest.fn(() => {
      order.push('close');
      return Promise.resolve();
    });
    const service = build({ removeUserFromAllGroups, closeUserConnections });

    await service.revokeLiveAccess('u1', 'Account deactivated');

    expect(removeUserFromAllGroups).toHaveBeenCalledWith('u1');
    expect(closeUserConnections).toHaveBeenCalledWith('u1', {
      reason: 'Account deactivated',
    });
    expect(order).toEqual(['groups', 'close']);
  });

  it('⚠️ never throws, whichever call fails', async () => {
    // Both halves, because the second is the one that would be missed.
    const failing = build({
      removeUserFromAllGroups: jest.fn().mockRejectedValue(new Error('boom')),
      closeUserConnections: jest.fn().mockResolvedValue(undefined),
    });
    await expect(failing.revokeLiveAccess('u1', 'x')).resolves.toBeUndefined();

    const failingClose = build({
      removeUserFromAllGroups: jest.fn().mockResolvedValue(undefined),
      closeUserConnections: jest.fn().mockRejectedValue(new Error('boom')),
    });
    await expect(failingClose.revokeLiveAccess('u1', 'x')).resolves.toBeUndefined();
  });

  it('is a silent no-op when realtime is not configured', async () => {
    // Local development and the test environment both run without a connection
    // string; this must not become a per-deactivation error in the log.
    const service = build(null);
    await expect(service.revokeLiveAccess('u1', 'x')).resolves.toBeUndefined();
  });
});
