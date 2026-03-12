import { OutboxStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService } from './outbox.service';

type MockTx = {
  notificationOutbox: {
    updateMany: jest.Mock;
    findUnique: jest.Mock;
  };
};

type MockPrisma = {
  $transaction: jest.Mock;
  notificationOutbox: {
    create: jest.Mock;
    update: jest.Mock;
  };
};

describe('OutboxService', () => {
  let service: OutboxService;
  let prisma: MockPrisma;
  let tx: MockTx;

  beforeEach(() => {
    tx = {
      notificationOutbox: {
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    prisma = {
      $transaction: jest.fn((callback: (client: MockTx) => unknown) =>
        callback(tx),
      ),
      notificationOutbox: {
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    service = new OutboxService(prisma as unknown as PrismaService);
  });

  it('claims a pending outbox row atomically before reading it back', async () => {
    const claimedRecord = {
      id: 'outbox-1',
      status: OutboxStatus.PROCESSING,
      attempts: 1,
    };
    tx.notificationOutbox.updateMany.mockResolvedValue({ count: 1 });
    tx.notificationOutbox.findUnique.mockResolvedValue(claimedRecord);

    const result = await service.claimPending('outbox-1');

    expect(tx.notificationOutbox.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'outbox-1',
        status: OutboxStatus.PENDING,
      },
      data: {
        status: OutboxStatus.PROCESSING,
        attempts: { increment: 1 },
      },
    });
    expect(tx.notificationOutbox.findUnique).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
    });
    expect(result).toBe(claimedRecord);
  });

  it('returns null when the row is no longer pending', async () => {
    tx.notificationOutbox.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.claimPending('outbox-1');

    expect(result).toBeNull();
    expect(tx.notificationOutbox.findUnique).not.toHaveBeenCalled();
  });
});
