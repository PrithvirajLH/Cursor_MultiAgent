import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { Readable } from 'stream';

/**
 * Where an attachment's bytes live, and how to get them back.
 *
 * ⚠️ MOVED HERE VERBATIM BY CARD 1.130, FROM `TicketAttachmentService`. Not
 * copied - **moved**. That service still owns every rule about attachments
 * (who may see one, what a safe file is, how big is too big) and now delegates
 * the bytes to this. Two spellings of one storage path is the failure this
 * project keeps paying for.
 *
 * ⚠️ IT LIVES IN `common/` FOR ONE REASON: an email can now carry a file out of
 * the building, and `EmailProcessorService` sits in `NotificationsModule` -
 * which `TicketsModule` **imports**. Reaching the storage from there would have
 * closed a cycle. `CommonModule` is `@Global`, so putting the low-level piece
 * here makes the arrow point the right way, exactly as card 1.103 did with
 * `AutomationRunner`.
 *
 * ⚠️ NOTHING ABOUT BEHAVIOUR CHANGED. Same Azure client caching, same
 * one-shot container creation, same local-disk fallback, same exceptions.
 */
@Injectable()
export class AttachmentStorageService {
  private readonly logger = new Logger(AttachmentStorageService.name);

  /**
   * Cached Azure Blob container client + a one-shot promise that ensures the
   * container is created exactly once for the lifetime of this service. The
   * client and connection string are expensive/redundant to rebuild on every
   * upload/download, so we lazily construct and reuse them (PERF-01).
   */
  private azureContainerClient: ContainerClient | null = null;
  private azureContainerEnsured: Promise<void> | null = null;

  constructor(private readonly config: ConfigService) {}

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

  /**
   * Best-effort delete of a stored attachment blob/file. Used as a
   * compensating action when a stored file must be rolled back (e.g. the DB
   * transaction that records the attachment fails after the file was written).
   * Never throws — a failed cleanup is logged, not propagated, so it cannot
   * mask the original error.
   */
  async deleteAttachmentFile(storageKey: string): Promise<void> {
    try {
      if (this.isAzureBlobStorageEnabled()) {
        const containerClient = this.getAzureContainerClient();
        await containerClient.getBlockBlobClient(storageKey).deleteIfExists();
        return;
      }

      const filePath = this.resolveAttachmentPath(storageKey);
      await fs.rm(filePath, { force: true });
    } catch (err) {
      this.logger.error(
        `Failed to delete orphaned attachment file "${storageKey}"`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Lazily build and cache the Azure Blob container client. The
   * BlobServiceClient/ContainerClient are reused across calls and the
   * container is created at most once via a cached one-shot promise (PERF-01).
   */
  private getAzureContainerClient(): ContainerClient {
    if (this.azureContainerClient) {
      return this.azureContainerClient;
    }

    const connectionString = this.config.get<string>(
      'AZURE_STORAGE_CONNECTION_STRING',
    );
    const containerName = this.config.get<string>('AZURE_STORAGE_CONTAINER');
    if (!connectionString || !containerName) {
      throw new Error('Azure Blob Storage is not configured');
    }

    const blobServiceClient =
      BlobServiceClient.fromConnectionString(connectionString);
    this.azureContainerClient =
      blobServiceClient.getContainerClient(containerName);
    return this.azureContainerClient;
  }

  /** Ensure the Azure container exists exactly once for this service instance. */
  private async ensureAzureContainer(
    containerClient: ContainerClient,
  ): Promise<void> {
    if (!this.azureContainerEnsured) {
      this.azureContainerEnsured = containerClient
        .createIfNotExists()
        .then(() => undefined)
        .catch((err) => {
          // Reset so a transient failure can be retried on the next upload.
          this.azureContainerEnsured = null;
          throw err;
        });
    }
    await this.azureContainerEnsured;
  }

  async saveAttachmentFileToAzureBlob(
    storageKey: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const containerClient = this.getAzureContainerClient();
    await this.ensureAzureContainer(containerClient);
    const blockBlobClient = containerClient.getBlockBlobClient(storageKey);
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
  }

  async getAttachmentReadStreamFromAzureBlob(
    storageKey: string,
  ): Promise<Readable> {
    const containerClient = this.getAzureContainerClient();
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
}
