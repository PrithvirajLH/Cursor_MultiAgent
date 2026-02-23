import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesService } from './categories.service';

type MockPrisma = {
  category: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
    delete: jest.Mock;
  };
};

function ownerUser() {
  return {
    id: 'owner-1',
    email: 'owner@company.com',
    displayName: 'Owner',
    role: UserRole.OWNER,
    primaryTeamId: null,
  } satisfies AuthUser;
}

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = {
      category: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new CategoriesService(prisma as unknown as PrismaService);
  });

  it('creates category with parent validation', async () => {
    prisma.category.findUnique.mockResolvedValueOnce({
      id: 'parent-1',
      parentId: null,
    });
    prisma.category.create.mockResolvedValueOnce({
      id: 'cat-1',
      name: 'Billing',
      slug: 'billing',
      description: null,
      parentId: 'parent-1',
      isActive: true,
    });

    const result = await service.create(
      {
        name: 'Billing',
        parentId: 'parent-1',
      },
      ownerUser(),
    );

    expect(prisma.category.create).toHaveBeenCalledTimes(1);
    const createCalls = prisma.category.create.mock.calls as Array<[unknown]>;
    expect(createCalls[0]?.[0]).toMatchObject({
      data: {
        name: 'Billing',
        slug: 'billing',
        parentId: 'parent-1',
        isActive: true,
      },
    });
    expect(result.id).toBe('cat-1');
  });

  it('updates category and clears parent and description when null provided', async () => {
    prisma.category.findUnique.mockResolvedValueOnce({ id: 'cat-1' });
    prisma.category.update.mockResolvedValueOnce({
      id: 'cat-1',
      name: 'Ops',
      slug: 'ops',
      description: null,
      parentId: null,
      isActive: true,
    });

    const result = await service.update(
      'cat-1',
      {
        description: null,
        parentId: null,
      },
      ownerUser(),
    );

    expect(prisma.category.update).toHaveBeenCalledTimes(1);
    const updateCalls = prisma.category.update.mock.calls as Array<[unknown]>;
    expect(updateCalls[0]?.[0]).toMatchObject({
      where: { id: 'cat-1' },
      data: {
        description: null,
        parentId: null,
      },
    });
    expect(result.parentId).toBeNull();
    expect(result.description).toBeNull();
  });

  it('rejects making category its own parent', async () => {
    prisma.category.findUnique.mockResolvedValueOnce({ id: 'cat-1' });

    await expect(
      service.update(
        'cat-1',
        {
          parentId: 'cat-1',
        },
        ownerUser(),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it('rejects cyclic hierarchy updates', async () => {
    prisma.category.findUnique
      .mockResolvedValueOnce({ id: 'cat-1' }) // update target exists
      .mockResolvedValueOnce({ id: 'parent-1', parentId: 'ancestor-1' }) // ensureCategory(parentId)
      .mockResolvedValueOnce({ id: 'ancestor-1', parentId: 'cat-1' }); // walk chain -> cycle

    await expect(
      service.update(
        'cat-1',
        {
          parentId: 'parent-1',
        },
        ownerUser(),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it('blocks delete when category has children', async () => {
    prisma.category.findUnique.mockResolvedValueOnce({ id: 'cat-1' });
    prisma.category.count.mockResolvedValueOnce(2);

    await expect(service.remove('cat-1', ownerUser())).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.category.delete).not.toHaveBeenCalled();
  });

  it('deletes category when it has no children', async () => {
    prisma.category.findUnique.mockResolvedValueOnce({ id: 'cat-1' });
    prisma.category.count.mockResolvedValueOnce(0);
    prisma.category.delete.mockResolvedValueOnce({ id: 'cat-1' });

    const result = await service.remove('cat-1', ownerUser());
    expect(prisma.category.delete).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
    });
    expect(result).toEqual({ id: 'cat-1' });
  });

  it('throws not found when updating unknown category', async () => {
    prisma.category.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.update('missing', { name: 'Any' }, ownerUser()),
    ).rejects.toThrow(NotFoundException);
  });
});
