import { ConfigService } from '@nestjs/config';
import { AttachmentScanStatus } from '@prisma/client';
import { AccessControlService } from '../common/access-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { TicketAttachmentService } from './ticket-attachment.service';
import { TicketRealtimeService } from './ticket-realtime.service';

type MockPrisma = {
  $transaction: jest.Mock;
};

describe('TicketAttachmentService — orphan cleanup (BUG-02)', () => {
  let service: TicketAttachmentService;
  let prisma: MockPrisma;
  let config: { get: jest.Mock };

  const ticketId = 'ticket-1';
  const actorId = 'user-1';
  // A valid PNG header so signature validation passes; .png is whitelisted.
  const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(),
    };
    config = {
      // Local-disk storage (no Azure connection string) keeps the test off the
      // network; ATTACHMENT_SCAN_BYPASS unset -> PENDING default state.
      get: jest.fn().mockReturnValue(undefined),
    };

    service = new TicketAttachmentService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      new AccessControlService(),
      {} as unknown as TicketRealtimeService,
    );
  });

  it('deletes the just-written file when the DB transaction throws, then re-throws', async () => {
    const saveSpy = jest
      .spyOn(service, 'saveAttachmentFile')
      .mockResolvedValue(undefined);
    const deleteSpy = jest
      .spyOn(service, 'deleteAttachmentFile')
      .mockResolvedValue(undefined);

    const txError = new Error('tx failed');
    prisma.$transaction.mockRejectedValueOnce(txError);

    await expect(
      service.createTicketAttachmentFromBuffer(
        ticketId,
        {
          originalName: 'photo.png',
          contentType: 'image/png',
          buffer: pngBuffer,
        },
        actorId,
      ),
    ).rejects.toBe(txError);

    expect(saveSpy).toHaveBeenCalledTimes(1);
    const storageKey = saveSpy.mock.calls[0][0];
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    // The orphaned file removed is exactly the one that was written.
    expect(deleteSpy).toHaveBeenCalledWith(storageKey);
  });

  it('does not delete the file on the success path', async () => {
    const saveSpy = jest
      .spyOn(service, 'saveAttachmentFile')
      .mockResolvedValue(undefined);
    const deleteSpy = jest
      .spyOn(service, 'deleteAttachmentFile')
      .mockResolvedValue(undefined);

    const createdAttachment = {
      id: 'att-1',
      ticketId,
      fileName: 'photo.png',
      contentType: 'image/png',
      sizeBytes: pngBuffer.length,
      scanStatus: AttachmentScanStatus.PENDING,
    };
    // The service passes a callback to $transaction; emulate it resolving.
    prisma.$transaction.mockImplementation(async () => createdAttachment);

    const result = await service.createTicketAttachmentFromBuffer(
      ticketId,
      {
        originalName: 'photo.png',
        contentType: 'image/png',
        buffer: pngBuffer,
      },
      actorId,
    );

    expect(result).toBe(createdAttachment);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
