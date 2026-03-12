import fs from 'fs';
import path from 'path';

function loadEnv(envPath: string) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const contents = fs.readFileSync(envPath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) {
      continue;
    }
    const idx = line.indexOf('=');
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      process.env[key] = value;
    }
  }
}

const envPath = path.join(__dirname, '..', '.env.test');
loadEnv(envPath);
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL not found in apps/api/.env.test');
}
process.env.DATABASE_URL = testDatabaseUrl;
process.env.DIRECT_URL = process.env.TEST_DIRECT_URL?.trim() || testDatabaseUrl;
process.env.NODE_ENV = 'test';
process.env.NOTIFICATIONS_QUEUE_ENABLED = 'false';
process.env.SLA_BREACH_WORKER_ENABLED = 'false';
process.env.AUTH_ALLOW_INSECURE_HEADERS = 'true';
process.env.TEST_DB_RESET_STRATEGY = 'migrate';
process.env.ATTACHMENT_SCAN_WEBHOOK_SECRET =
  process.env.ATTACHMENT_SCAN_WEBHOOK_SECRET ?? 'test-scan-secret';
process.env.INBOUND_EMAIL_WEBHOOK_SECRET =
  process.env.INBOUND_EMAIL_WEBHOOK_SECRET ?? 'test-inbound-secret';
process.env.M365_INBOUND_WEBHOOK_SECRET =
  process.env.M365_INBOUND_WEBHOOK_SECRET ??
  process.env.INBOUND_EMAIL_WEBHOOK_SECRET;

jest.setTimeout(60000);
