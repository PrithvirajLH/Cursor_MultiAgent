import type { ConfigService } from '@nestjs/config';
import { AttachmentScanStatus, MessageType } from '@prisma/client';
import { Readable } from 'stream';
import type { PrismaService } from '../prisma/prisma.service';
import type { AttachmentStorageService } from './attachment-storage.service';
import { InlineEmailImagesService } from './inline-email-images.service';

/**
 * Card 1.130 — the bytes behind a `cid:` image in an outbound email.
 *
 * ⚠️ EVERY REFUSAL HERE IS A SECURITY RULE, NOT TIDINESS, because these bytes
 * are sent to the REQUESTER. The internal-note case is card 1.83's rule
 * reaching a second exit from the building, and it has only ever been exercised
 * on the download route.
 */
describe('InlineEmailImagesService (card 1.130)', () => {
  const TICKET = 'ticket-1';
  const ROW = {
    id: 'att-1',
    fileName: 'screenshot.png',
    contentType: 'image/png',
    sizeBytes: 1024,
    storageKey: 'key-1',
    scanStatus: AttachmentScanStatus.CLEAN as AttachmentScanStatus,
    message: null as { type: MessageType } | null,
  };

  /** A service with the row(s) the test wants and a storage stub. */
  function build(
    rows: (typeof ROW)[],
    env: Record<string, string | undefined> = {},
    readStream: () => Promise<Readable> = () =>
      Promise.resolve(Readable.from([Buffer.from('PNGDATA')])),
  ) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const service = new InlineEmailImagesService(
      { attachment: { findMany } } as unknown as PrismaService,
      {
        getAttachmentReadStream: jest.fn(readStream),
      } as unknown as AttachmentStorageService,
      { get: (key: string) => env[key] } as unknown as ConfigService,
    );
    return { service, findMany };
  }

  const wanted = [{ attachmentId: 'att-1', cid: 'att-1@csnhc.com' }];

  it('reads the file and hands back the bytes with its cid', async () => {
    const { service } = build([ROW]);

    const images = await service.readInlineImages(TICKET, wanted);

    expect(images).toHaveLength(1);
    expect(images[0].cid).toBe('att-1@csnhc.com');
    expect(images[0].filename).toBe('screenshot.png');
    expect(images[0].content.toString()).toBe('PNGDATA');
  });

  it('⚠️ never embeds a file from an INTERNAL note', async () => {
    // Card 1.83, at a second exit. An agent's private screenshot must not leave
    // in an email any more than it may be downloaded.
    const { service } = build([
      { ...ROW, message: { type: MessageType.INTERNAL } },
    ]);

    expect(await service.readInlineImages(TICKET, wanted)).toEqual([]);
  });

  it('a file on a PUBLIC message is fine', async () => {
    // NON-VACUITY: a rule that refused everything would pass the test above.
    const { service } = build([
      { ...ROW, message: { type: MessageType.PUBLIC } },
    ]);

    expect(await service.readInlineImages(TICKET, wanted)).toHaveLength(1);
  });

  it('⚠️ looks the file up by id AND ticket together', async () => {
    // So a body an agent authored cannot pull a file off another ticket.
    const { service, findMany } = build([ROW]);

    await service.readInlineImages(TICKET, wanted);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['att-1'] }, ticketId: TICKET },
      }),
    );
  });

  it('⚠️ honours the AV gate exactly as a download does', async () => {
    const { service } = build([
      { ...ROW, scanStatus: AttachmentScanStatus.INFECTED },
    ]);

    expect(await service.readInlineImages(TICKET, wanted)).toEqual([]);
  });

  it('a PENDING file is refused while scanning is on, and allowed when it is off', async () => {
    const pending = { ...ROW, scanStatus: AttachmentScanStatus.PENDING };
    const on = build([pending], { ATTACHMENT_SCAN_ENABLED: 'true' });
    const off = build([pending], { ATTACHMENT_SCAN_ENABLED: 'false' });

    expect(await on.service.readInlineImages(TICKET, wanted)).toEqual([]);
    expect(await off.service.readInlineImages(TICKET, wanted)).toHaveLength(1);
  });

  it('leaves out anything over the per-image ceiling', async () => {
    // Base64 inflates ~33% and clients cap between 10 and 25 MB, so a huge
    // paste is named rather than bouncing the whole reply.
    const { service } = build([{ ...ROW, sizeBytes: 9_000_000 }], {
      EMAIL_INLINE_IMAGE_MAX_BYTES: '1000',
    });

    expect(await service.readInlineImages(TICKET, wanted)).toEqual([]);
  });

  it('stops at the total ceiling for one email', async () => {
    const two = [
      { ...ROW, id: 'att-1', storageKey: 'k1', sizeBytes: 800 },
      { ...ROW, id: 'att-2', storageKey: 'k2', sizeBytes: 800 },
    ];
    const { service } = build(two, {
      EMAIL_INLINE_IMAGES_MAX_TOTAL_BYTES: '1000',
    });

    const images = await service.readInlineImages(TICKET, [
      { attachmentId: 'att-1', cid: 'a@x' },
      { attachmentId: 'att-2', cid: 'b@x' },
    ]);
    expect(images.map((image) => image.attachmentId)).toEqual(['att-1']);
  });

  it('⚠️ an unreadable file is left out and NOTHING throws', async () => {
    // THE ONE THAT MATTERS MOST. Card 1.105's principle: a reply that cannot be
    // sent because a picture is missing is worse than a reply without it.
    const { service } = build([ROW], {}, () =>
      Promise.reject(new Error('blob is gone')),
    );

    await expect(service.readInlineImages(TICKET, wanted)).resolves.toEqual([]);
  });

  it('asks the database nothing when there is nothing to carry', async () => {
    const { service, findMany } = build([]);

    expect(await service.readInlineImages(TICKET, [])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
