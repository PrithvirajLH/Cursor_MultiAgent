import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttachmentScanStatus, Prisma } from '@prisma/client';
import { BlobServiceClient } from '@azure/storage-blob';
import { randomUUID, timingSafeEqual } from 'crypto';
import type { Express } from 'express';
import { createReadStream, promises as fs } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { AuthUser } from '../auth/current-user.decorator';
import { AccessControlService } from '../common/access-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { TicketRealtimeService } from './ticket-realtime.service';
import { UpdateAttachmentScanDto } from './dto/update-attachment-scan.dto';
import { parsePositiveInt } from '../common/config.utils';

@Injectable()
export class TicketAttachmentService {
  private readonly logger = new Logger(TicketAttachmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly accessControl: AccessControlService,
    private readonly ticketRealtime: TicketRealtimeService,
  ) {}

  // ——— File upload security ———

  /** Allowed file extensions for attachments. */
  private static readonly ALLOWED_EXTENSIONS = new Set([
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.txt',
    '.csv',
    '.rtf',
    '.odt',
    '.ods',
    '.odp',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.bmp',
    '.webp',
    '.ico',
    '.zip',
    '.rar',
    '.7z',
    '.tar',
    '.gz',
    '.eml',
    '.msg',
    '.json',
    '.xml',
    '.yaml',
    '.yml',
    '.mp4',
    '.mp3',
    '.wav',
    '.avi',
    '.mov',
    '.webm',
    '.log',
  ]);

  /** Map common MIME types to their expected file extensions. */
  private static readonly MIME_TO_EXTENSIONS: Record<string, string[]> = {
    'application/pdf': ['.pdf'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
      '.docx',
    ],
    'application/vnd.ms-excel': ['.xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
      '.xlsx',
    ],
    'application/vnd.ms-powerpoint': ['.ppt'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      ['.pptx'],
    'text/plain': ['.txt', '.csv', '.log', '.yaml', '.yml'],
    'text/csv': ['.csv'],
    'text/xml': ['.xml'],
    'application/json': ['.json'],
    'application/xml': ['.xml'],
    'image/png': ['.png'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/gif': ['.gif'],
    'image/bmp': ['.bmp'],
    'image/webp': ['.webp'],
    'image/x-icon': ['.ico'],
    'application/zip': ['.zip'],
    'application/x-rar-compressed': ['.rar'],
    'application/x-7z-compressed': ['.7z'],
    'application/gzip': ['.gz'],
    'application/x-tar': ['.tar'],
    'audio/mpeg': ['.mp3'],
    'audio/wav': ['.wav'],
    'video/mp4': ['.mp4'],
    'video/x-msvideo': ['.avi'],
    'video/quicktime': ['.mov'],
    'video/webm': ['.webm'],
    'message/rfc822': ['.eml'],
    'application/vnd.ms-outlook': ['.msg'],
    'application/rtf': ['.rtf'],
    'application/vnd.oasis.opendocument.text': ['.odt'],
    'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
    'application/vnd.oasis.opendocument.presentation': ['.odp'],
  };

  async addAttachment(
    ticketId: string,
    file: Express.Multer.File | undefined,
    user: AuthUser,
  ) {
    if (!file) {
      throw new BadRequestException('Attachment file is required');
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { accessGrants: true },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (!this.accessControl.canWriteTicket(user, ticket)) {
      throw new ForbiddenException('No write access to this ticket');
    }

    const attachment = await this.createTicketAttachmentFromBuffer(
      ticketId,
      {
        originalName: file.originalname,
        contentType: file.mimetype,
        buffer: file.buffer,
      },
      user.id,
    );
    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId,
        reason: 'attachment_added',
        actorId: user.id,
      }),
    );

    return attachment;
  }

  async createTicketAttachmentFromBuffer(
    ticketId: string,
    file: {
      originalName: string;
      contentType: string;
      buffer: Buffer;
    },
    actorId: string,
  ) {
    const mimeType = file.contentType.trim().toLowerCase();
    const sizeBytes = file.buffer.length;
    const uploadCandidate = {
      originalname: file.originalName,
      mimetype: mimeType,
      size: sizeBytes,
      buffer: file.buffer,
    } as Express.Multer.File;

    this.validateFileUpload(uploadCandidate);
    this.assertAttachmentWithinSizeLimit(sizeBytes);

    const attachmentId = randomUUID();
    const safeName = this.sanitizeFileName(file.originalName);
    const storageKey = path.posix.join(ticketId, `${attachmentId}-${safeName}`);
    await this.saveAttachmentFile(storageKey, file.buffer, mimeType);

    const { scanStatus, scanCheckedAt } = this.getDefaultAttachmentScanState();
    const attachment = await this.prisma.$transaction(async (tx) => {
      const createdAttachment = await tx.attachment.create({
        data: {
          id: attachmentId,
          ticketId,
          uploadedById: actorId,
          fileName: file.originalName,
          contentType: mimeType,
          sizeBytes,
          storageKey,
          scanStatus,
          scanCheckedAt,
        },
        include: { uploadedBy: true },
      });

      await tx.ticketEvent.create({
        data: {
          ticketId,
          type: 'ATTACHMENT_ADDED',
          payload: {
            attachmentId: createdAttachment.id,
            fileName: createdAttachment.fileName,
            sizeBytes: createdAttachment.sizeBytes,
            contentType: createdAttachment.contentType,
          },
          createdById: actorId,
        },
      });

      return createdAttachment;
    });

    return attachment;
  }

  async getAttachmentFile(attachmentId: string, user: AuthUser) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: {
        ticket: {
          include: { accessGrants: true },
        },
      },
    });

    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    if (!this.accessControl.canViewTicket(user, attachment.ticket)) {
      throw new ForbiddenException('No access to this attachment');
    }

    this.assertAttachmentDownloadAllowed(attachment.scanStatus);

    const stream = await this.getAttachmentReadStream(attachment.storageKey);
    return { attachment, stream };
  }

  async updateAttachmentScanStatus(
    attachmentId: string,
    payload: UpdateAttachmentScanDto,
    scannerSecret: string | undefined,
  ) {
    this.assertAttachmentScannerSecret(scannerSecret);

    if (payload.status === AttachmentScanStatus.PENDING) {
      throw new BadRequestException(
        'Scanner callback must set attachment status to CLEAN, INFECTED, or FAILED',
      );
    }

    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, ticketId: true },
    });
    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    const scanCheckedAt = new Date();
    const scanError =
      payload.status === AttachmentScanStatus.CLEAN
        ? null
        : payload.error?.trim() ||
          (payload.status === AttachmentScanStatus.INFECTED
            ? 'Attachment marked as infected'
            : 'Attachment scan failed');

    const updatedAttachment = await this.prisma.$transaction(async (tx) => {
      const updatedAttachment = await tx.attachment.update({
        where: { id: attachmentId },
        data: {
          scanStatus: payload.status,
          scanCheckedAt,
          scanError,
        },
      });

      await tx.ticketEvent.create({
        data: {
          ticketId: attachment.ticketId,
          type: 'ATTACHMENT_SCAN_STATUS_CHANGED',
          payload: {
            attachmentId: attachment.id,
            status: payload.status,
            error: scanError,
            scannedAt: scanCheckedAt.toISOString(),
          },
          createdById: null,
        },
      });

      return updatedAttachment;
    });
    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId: attachment.ticketId,
        reason: 'attachment_scan_status_changed',
        actorId: null,
      }),
    );

    return updatedAttachment;
  }

  // ——— Storage ———

  resolveAttachmentPath(storageKey: string) {
    const baseDir =
      this.config.get<string>('ATTACHMENTS_DIR') ??
      path.join(process.cwd(), 'uploads');
    return path.join(baseDir, storageKey);
  }

  isAzureBlobStorageEnabled(): boolean {
    const connectionString = this.config.get<string>(
      'AZURE_STORAGE_CONNECTION_STRING',
    );
    const containerName = this.config.get<string>('AZURE_STORAGE_CONTAINER');
    return Boolean(connectionString && containerName);
  }

  async saveAttachmentFile(
    storageKey: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    if (this.isAzureBlobStorageEnabled()) {
      await this.saveAttachmentFileToAzureBlob(storageKey, buffer, contentType);
      return;
    }

    const filePath = this.resolveAttachmentPath(storageKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
  }

  async getAttachmentReadStream(storageKey: string): Promise<Readable> {
    if (this.isAzureBlobStorageEnabled()) {
      return this.getAttachmentReadStreamFromAzureBlob(storageKey);
    }

    const filePath = this.resolveAttachmentPath(storageKey);
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('Attachment file missing');
    }
    return createReadStream(filePath);
  }

  async saveAttachmentFileToAzureBlob(
    storageKey: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const connectionString = this.config.get<string>(
      'AZURE_STORAGE_CONNECTION_STRING',
    );
    const containerName = this.config.get<string>('AZURE_STORAGE_CONTAINER');
    if (!connectionString || !containerName) {
      throw new Error('Azure Blob Storage is not configured');
    }

    const blobServiceClient =
      BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();
    const blockBlobClient = containerClient.getBlockBlobClient(storageKey);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
  }

  async getAttachmentReadStreamFromAzureBlob(
    storageKey: string,
  ): Promise<Readable> {
    const connectionString = this.config.get<string>(
      'AZURE_STORAGE_CONNECTION_STRING',
    );
    const containerName = this.config.get<string>('AZURE_STORAGE_CONTAINER');
    if (!connectionString || !containerName) {
      throw new Error('Azure Blob Storage is not configured');
    }

    const blobServiceClient =
      BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlobClient(storageKey);
    const exists = await blobClient.exists();
    if (!exists) {
      throw new NotFoundException('Attachment file missing');
    }
    const response = await blobClient.download();
    const responseBody = response.readableStreamBody;
    if (!responseBody) {
      throw new NotFoundException('Attachment file missing');
    }

    if (this.isNodeReadableStream(responseBody)) {
      return responseBody;
    }

    if (this.isWebReadableStream(responseBody)) {
      return Readable.fromWeb(responseBody);
    }

    throw new Error('Unsupported Azure Blob response stream type');
  }

  isNodeReadableStream(value: unknown): value is Readable {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as NodeJS.ReadableStream).pipe === 'function'
    );
  }

  isWebReadableStream(
    value: unknown,
  ): value is import('stream/web').ReadableStream {
    return (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as import('stream/web').ReadableStream).getReader ===
        'function'
    );
  }

  // ——— Security & Validation ———

  assertAttachmentScannerSecret(scannerSecret: string | undefined) {
    const configuredSecret = this.config.get<string>(
      'ATTACHMENT_SCAN_WEBHOOK_SECRET',
    );

    if (!configuredSecret) {
      throw new ForbiddenException(
        'Attachment scanner webhook secret is not configured',
      );
    }

    if (!scannerSecret) {
      throw new ForbiddenException('Missing attachment scanner webhook secret');
    }

    const expected = Buffer.from(configuredSecret, 'utf8');
    const received = Buffer.from(scannerSecret, 'utf8');
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new ForbiddenException('Invalid attachment scanner webhook secret');
    }
  }

  assertAttachmentDownloadAllowed(scanStatus: AttachmentScanStatus) {
    if (scanStatus === AttachmentScanStatus.CLEAN) {
      return;
    }

    if (scanStatus === AttachmentScanStatus.PENDING) {
      throw new ForbiddenException(
        'Attachment scan is still pending; download is blocked',
      );
    }

    if (scanStatus === AttachmentScanStatus.INFECTED) {
      throw new ForbiddenException(
        'Attachment was flagged as infected and cannot be downloaded',
      );
    }

    throw new ForbiddenException(
      'Attachment scan failed; download is blocked until the file is rescanned',
    );
  }

  getAttachmentMaxBytes() {
    const maxMb = parsePositiveInt(
      this.config.get<string>('ATTACHMENTS_MAX_MB'),
      10,
    );
    return maxMb * 1024 * 1024;
  }

  assertAttachmentWithinSizeLimit(sizeBytes: number) {
    const maxBytes = this.getAttachmentMaxBytes();
    if (sizeBytes > maxBytes) {
      const maxMb = Math.floor(maxBytes / (1024 * 1024));
      throw new BadRequestException(`Attachment exceeds ${maxMb}MB limit`);
    }
  }

  getDefaultAttachmentScanState() {
    const bypassAttachmentScan =
      this.config.get<string>('ATTACHMENT_SCAN_BYPASS') === 'true';
    return {
      scanStatus: bypassAttachmentScan
        ? AttachmentScanStatus.CLEAN
        : AttachmentScanStatus.PENDING,
      scanCheckedAt: bypassAttachmentScan ? new Date() : null,
    };
  }

  sanitizeFileName(fileName: string) {
    return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  /**
   * Validate the uploaded file's extension against the whitelist and ensure
   * the claimed MIME type is consistent with the file extension.
   * Throws BadRequestException on any mismatch.
   */
  validateFileUpload(file: Express.Multer.File): void {
    const ext = path.extname(file.originalname).toLowerCase();

    // 1. Extension whitelist
    if (!ext || !TicketAttachmentService.ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException(
        `File type "${ext || '(none)'}" is not allowed. Accepted extensions: ${[...TicketAttachmentService.ALLOWED_EXTENSIONS].join(', ')}`,
      );
    }

    // 2. MIME ↔ extension consistency
    const mime = (file.mimetype ?? '').toLowerCase();
    const allowed = TicketAttachmentService.MIME_TO_EXTENSIONS[mime];
    if (allowed && allowed.length > 0 && !allowed.includes(ext)) {
      throw new BadRequestException(
        `MIME type "${mime}" does not match file extension "${ext}". Possible extension mismatch or spoofed file.`,
      );
    }

    this.assertFileSignatureMatchesExtension(file, ext);

    // 3. Block dangerous MIME types regardless of extension
    const blockedMimes = [
      'application/x-msdownload',
      'application/x-executable',
      'application/x-dosexec',
      'application/x-msdos-program',
    ];
    if (blockedMimes.includes(mime)) {
      throw new BadRequestException(
        `Files with MIME type "${mime}" are not allowed.`,
      );
    }
  }

  assertFileSignatureMatchesExtension(
    file: Express.Multer.File,
    extension: string,
  ) {
    const signatureMap: Record<string, number[][]> = {
      '.pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
      '.png': [[0x89, 0x50, 0x4e, 0x47]],
      '.jpg': [[0xff, 0xd8, 0xff]],
      '.jpeg': [[0xff, 0xd8, 0xff]],
      '.gif': [[0x47, 0x49, 0x46, 0x38]],
      '.zip': [
        [0x50, 0x4b, 0x03, 0x04],
        [0x50, 0x4b, 0x05, 0x06],
        [0x50, 0x4b, 0x07, 0x08],
      ],
      '.docx': [
        [0x50, 0x4b, 0x03, 0x04],
        [0x50, 0x4b, 0x05, 0x06],
        [0x50, 0x4b, 0x07, 0x08],
      ],
      '.xlsx': [
        [0x50, 0x4b, 0x03, 0x04],
        [0x50, 0x4b, 0x05, 0x06],
        [0x50, 0x4b, 0x07, 0x08],
      ],
      '.pptx': [
        [0x50, 0x4b, 0x03, 0x04],
        [0x50, 0x4b, 0x05, 0x06],
        [0x50, 0x4b, 0x07, 0x08],
      ],
      '.odt': [
        [0x50, 0x4b, 0x03, 0x04],
        [0x50, 0x4b, 0x05, 0x06],
        [0x50, 0x4b, 0x07, 0x08],
      ],
      '.ods': [
        [0x50, 0x4b, 0x03, 0x04],
        [0x50, 0x4b, 0x05, 0x06],
        [0x50, 0x4b, 0x07, 0x08],
      ],
      '.odp': [
        [0x50, 0x4b, 0x03, 0x04],
        [0x50, 0x4b, 0x05, 0x06],
        [0x50, 0x4b, 0x07, 0x08],
      ],
    };
    const signatures = signatureMap[extension];
    if (!signatures) {
      return;
    }

    const header = file.buffer?.subarray(0, 8);
    if (!header || header.length < 4) {
      throw new BadRequestException('Unable to validate attachment signature');
    }

    const isMatch = signatures.some((signature) =>
      signature.every((byte, index) => header[index] === byte),
    );
    if (!isMatch) {
      throw new BadRequestException(
        `File content signature does not match extension "${extension}"`,
      );
    }
  }
}
