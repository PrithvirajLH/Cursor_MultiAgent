import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UsersService } from './users.service';

type PrismaMock = {
  user: {
    findUnique: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  team: {
    findUnique: jest.Mock;
  };
};

function buildPrismaMock(): PrismaMock {
  return {
    user: {
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    team: {
      findUnique: jest.fn(),
    },
  };
}

const ownerActor: AuthUser = {
  id: 'owner-1',
  email: 'owner1@example.com',
  displayName: 'Owner One',
  role: UserRole.OWNER,
};

describe('UsersService.updateRole — owner lockout guards', () => {
  let prisma: PrismaMock;
  let service: UsersService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new UsersService(prisma as unknown as PrismaService);
  });

  it('refuses to demote the last active OWNER', async () => {
    // Target is an OWNER being demoted; only one active owner exists.
    prisma.user.findUnique.mockResolvedValue({
      id: 'owner-2',
      role: UserRole.OWNER,
      primaryTeamId: null,
    });
    prisma.user.count.mockResolvedValue(1);

    const payload: UpdateUserRoleDto = { role: UserRole.AGENT };

    await expect(
      service.updateRole('owner-2', payload, ownerActor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses self-demotion away from OWNER', async () => {
    // Actor is demoting themselves; even with multiple owners this is blocked.
    prisma.user.findUnique.mockResolvedValue({
      id: ownerActor.id,
      role: UserRole.OWNER,
      primaryTeamId: null,
    });
    prisma.user.count.mockResolvedValue(3);

    const payload: UpdateUserRoleDto = { role: UserRole.TEAM_ADMIN };

    await expect(
      service.updateRole(ownerActor.id, payload, ownerActor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows demoting an OWNER when other active owners remain', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'owner-2',
      role: UserRole.OWNER,
      primaryTeamId: null,
    });
    prisma.user.count.mockResolvedValue(2);
    prisma.user.update.mockResolvedValue({ id: 'owner-2', role: UserRole.LEAD });

    const payload: UpdateUserRoleDto = { role: UserRole.LEAD };

    await service.updateRole('owner-2', payload, ownerActor);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'owner-2' },
      data: { role: UserRole.LEAD, primaryTeamId: null },
    });
  });
});
