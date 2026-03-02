/**
 * One-time migration: upload existing local attachment files to Azure Blob Storage.
 * Uses the same storageKey as in the DB so existing metadata continues to work.
 * Run from api root: npx ts-node scripts/migrate-attachments-to-azure.ts
 * Requires: AZURE_STORAGE_CONNECTION_STRING, AZURE_STORAGE_CONTAINER, DATABASE_URL in .env
 */

import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { BlobServiceClient } from '@azure/storage-blob';

config({ path: path.join(process.cwd(), '.env') });

const prisma = new PrismaClient();

function getAttachmentsBaseDir(): string {
  return (
    process.env.ATTACHMENTS_DIR ?? path.join(process.cwd(), 'uploads')
  );
}

function resolveLocalPath(storageKey: string): string {
  return path.join(getAttachmentsBaseDir(), storageKey);
}

async function main() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = process.env.AZURE_STORAGE_CONTAINER;

  if (!connectionString || !containerName) {
    console.error(
      'Missing AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_CONTAINER. Set them in .env and run again.',
    );
    process.exit(1);
  }

  const baseDir = getAttachmentsBaseDir();
  console.log('Local attachments base dir:', baseDir);
  console.log('Azure container:', containerName);

  const blobServiceClient =
    BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);
  await containerClient.createIfNotExists();

  const attachments = await prisma.attachment.findMany({
    select: { id: true, storageKey: true, contentType: true, fileName: true },
  });

  console.log(`Found ${attachments.length} attachment(s) in database.`);

  let uploaded = 0;
  let skipped = 0;
  let missing = 0;
  let errors = 0;

  for (const att of attachments) {
    const localPath = resolveLocalPath(att.storageKey);
    try {
      await fs.access(localPath);
    } catch {
      missing++;
      console.warn(`  [MISSING] ${att.storageKey} (${att.fileName})`);
      continue;
    }

    const blockBlobClient = containerClient.getBlockBlobClient(att.storageKey);
    const exists = await blockBlobClient.exists();
    if (exists) {
      skipped++;
      continue;
    }

    try {
      const buffer = await fs.readFile(localPath);
      await blockBlobClient.uploadData(buffer, {
        blobHTTPHeaders: { blobContentType: att.contentType },
      });
      uploaded++;
      console.log(`  [UPLOADED] ${att.storageKey} (${att.fileName})`);
    } catch (err) {
      errors++;
      console.error(`  [ERROR] ${att.storageKey}:`, err);
    }
  }

  console.log('');
  console.log('Done:', { uploaded, skipped, missing, errors });
  if (errors > 0) {
    process.exit(1);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
