import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageType } from '@prisma/client';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { AttachmentStorageService } from './attachment-storage.service';
import { decideAttachmentDownload } from './attachment-download-gate.util';
import { parsePositiveInt } from './config.utils';

/** One image, ready to hand to nodemailer as an inline part. */
export type InlineEmailImage = {
  attachmentId: string;
  /** What the HTML's `src="cid:…"` refers to. */
  cid: string;
  filename: string;
  contentType: string;
  content: Buffer;
};

/** 5 MB per image. Base64 inflates ~33%, and clients cap between 10 and 25 MB. */
const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 10 MB of images on one email, whatever the per-image limit allows. */
const DEFAULT_MAX_TOTAL_BYTES = 10 * 1024 * 1024;

/**
 * The bytes behind the `cid:` images in an outbound email (card 1.130).
 *
 * ⚠️ IT LIVES IN `common/` BECAUSE THE MODULE ARROW POINTS THE OTHER WAY.
 * `EmailProcessorService` is in `NotificationsModule`, which `TicketsModule`
 * imports - so the email path cannot reach into the tickets domain without
 * closing a cycle. `CommonModule` is `@Global`, which is the same answer card
 * 1.103 reached for `AutomationRunner`.
 *
 * ⚠️ **THESE BYTES GO TO THE REQUESTER.** That is what makes the refusals below
 * security rules rather than tidiness:
 * - a file on an **INTERNAL note is never embedded**, which is card 1.83's rule
 *   reaching a second exit from the building;
 * - a file is looked up by **id AND ticket together**, so a crafted body cannot
 *   pull one off another ticket;
 * - the **AV gate** applies exactly as it does to a download, through the same
 *   shared decision.
 *
 * ⚠️ IT NEVER THROWS. A reply that cannot be sent because a picture is missing
 * is strictly worse than a reply without the picture - card 1.105's principle.
 * Anything refused or unreadable is simply left out, and the renderer falls
 * back to naming the file.
 */
@Injectable()
export class InlineEmailImagesService {
  private readonly logger = new Logger(InlineEmailImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AttachmentStorageService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Read the files an outbound email wants to show inline.
   *
   * @param ticketId The ticket the email belongs to.
   * @param requested The attachment ids the body referenced, with their cids.
   * @returns Only the images that may be sent and could be read.
   */
  async readInlineImages(
    ticketId: string,
    requested: { attachmentId: string; cid: string }[],
  ): Promise<InlineEmailImage[]> {
    if (requested.length === 0) {
      return [];
    }
    const cidById = new Map(
      requested.map((item) => [item.attachmentId, item.cid]),
    );
    const rows = await this.prisma.attachment.findMany({
      where: { id: { in: [...cidById.keys()] }, ticketId },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        storageKey: true,
        scanStatus: true,
        message: { select: { type: true } },
      },
    });
    const maxImageBytes = parsePositiveInt(
      this.config.get<string>('EMAIL_INLINE_IMAGE_MAX_BYTES'),
      DEFAULT_MAX_IMAGE_BYTES,
    );
    const maxTotalBytes = parsePositiveInt(
      this.config.get<string>('EMAIL_INLINE_IMAGES_MAX_TOTAL_BYTES'),
      DEFAULT_MAX_TOTAL_BYTES,
    );
    const scanEnabled =
      (this.config.get<string>('ATTACHMENT_SCAN_ENABLED') ?? 'true') === 'true';
    const out: InlineEmailImage[] = [];
    let totalBytes = 0;
    for (const row of rows) {
      const refusal = this.refuse(row, scanEnabled, maxImageBytes);
      if (refusal) {
        this.logger.warn(
          `Not embedding "${row.fileName}" in an email: ${refusal}`,
        );
        continue;
      }
      if (totalBytes + row.sizeBytes > maxTotalBytes) {
        this.logger.warn(
          `Not embedding "${row.fileName}": the email's inline images would exceed ${maxTotalBytes} bytes`,
        );
        continue;
      }
      try {
        const content = await this.readAll(
          await this.storage.getAttachmentReadStream(row.storageKey),
        );
        // ⚠️ THE DECLARED SIZE, THE SAME NUMBER THE CHECK ABOVE USED. Counting
        // the bytes actually read here while testing the declared size there
        // made the total ceiling unenforceable: two 800-byte files both passed
        // a 1000-byte budget, because the running total was only ever growing
        // by what had already been read. `sizeBytes` is written from the
        // buffer length at upload, so it is the honest figure either way.
        totalBytes += row.sizeBytes;
        out.push({
          attachmentId: row.id,
          cid: cidById.get(row.id) as string,
          filename: row.fileName,
          contentType: row.contentType,
          content,
        });
      } catch (error) {
        // ⚠️ THE EMAIL STILL GOES. The renderer names the file instead.
        this.logger.warn(
          `Could not read "${row.fileName}" for an email; sending without it: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    }
    return out;
  }

  /** Why this file may not be embedded, or null when it may. */
  private refuse(
    row: {
      sizeBytes: number;
      scanStatus: Parameters<typeof decideAttachmentDownload>[0];
      message: { type: MessageType } | null;
    },
    scanEnabled: boolean,
    maxImageBytes: number,
  ): string | null {
    // ⚠️ CARD 1.83, AT A SECOND EXIT. An agent's private screenshot must not
    // leave in an email any more than it may be downloaded.
    if (row.message?.type === MessageType.INTERNAL) {
      return 'it belongs to an internal note';
    }
    const decision = decideAttachmentDownload(row.scanStatus, scanEnabled);
    if (!decision.allowed) {
      return decision.reason;
    }
    if (row.sizeBytes > maxImageBytes) {
      return `it is larger than ${maxImageBytes} bytes`;
    }
    return null;
  }

  /** A stream to a Buffer, because nodemailer wants the content in hand. */
  private async readAll(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    return Buffer.concat(chunks);
  }
}
