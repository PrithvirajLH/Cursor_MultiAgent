import { OutboxStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_EMAIL_OUTBOX_ATTEMPTS, OutboxService } from './outbox.service';

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
    findUnique: jest.Mock;
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
        findUnique: jest.fn(),
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

  it('keeps a failed row PENDING while delivery attempts remain (so the queue can retry)', async () => {
    prisma.notificationOutbox.findUnique.mockResolvedValue({ attempts: 1 });

    await service.markFailed('outbox-1', 'SMTP timeout');

    expect(prisma.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: {
        status: OutboxStatus.PENDING,
        lastError: 'SMTP timeout',
      },
    });
  });

  it('marks a failed row FAILED once the attempt budget is exhausted', async () => {
    prisma.notificationOutbox.findUnique.mockResolvedValue({
      attempts: MAX_EMAIL_OUTBOX_ATTEMPTS,
    });

    await service.markFailed('outbox-1', 'SMTP timeout');

    expect(prisma.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: {
        status: OutboxStatus.FAILED,
        lastError: 'SMTP timeout',
      },
    });
  });

  it('marks non-retryable failures FAILED immediately without checking attempts', async () => {
    await service.markFailed('outbox-1', 'SMTP not configured', false);

    expect(prisma.notificationOutbox.findUnique).not.toHaveBeenCalled();
    expect(prisma.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: {
        status: OutboxStatus.FAILED,
        lastError: 'SMTP not configured',
      },
    });
  });
});
