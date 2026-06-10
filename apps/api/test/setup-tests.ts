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

// ---------------------------------------------------------------------------
// Make the test environment hermetic against the dev `.env`.
//
// @prisma/client auto-loads the dev `.env` (the file next to the Prisma schema)
// into process.env the first time it is required. That normally happens
// transitively when AppModule is imported — i.e. AFTER this setup file runs but
// BEFORE ConfigModule.forRoot() snapshots the env into ConfigService — so the
// dev `.env` silently reconfigures the test run (e.g. ATTACHMENT_SCAN_ENABLED=
// false disables the AV download gate, RATE_LIMIT_LIMIT=120 overrides per-test
// throttle limits, real SMTP/secret values leak in). dotenv does NOT override
// keys already present in process.env, so once these land they win.
//
// Force that load HERE, while we still control the order, then re-assert the
// values the test suite must own. Keys that individual specs reconfigure at
// runtime (e.g. RATE_LIMIT_LIMIT in security.rate-limit.spec) are DELETED so
// they do not enter ConfigService's validated snapshot and instead fall through
// to the live process.env value the spec sets.
require('@prisma/client');

// Per-test-tunable throttle knobs must not be pinned by the dev `.env`, or
// ConfigService's import-time snapshot would shadow the per-spec override.
delete process.env.RATE_LIMIT_LIMIT;
delete process.env.RATE_LIMIT_TTL_MS;
delete process.env.RATE_LIMIT_WEBHOOK_LIMIT;
delete process.env.RATE_LIMIT_WEBHOOK_TTL_MS;
delete process.env.RATE_LIMIT_HIGH_WRITE_LIMIT;
delete process.env.RATE_LIMIT_HIGH_WRITE_TTL_MS;

// Attachment AV gating MUST be on so PENDING/INFECTED downloads are blocked
// (the dev `.env` sets ATTACHMENT_SCAN_ENABLED=false for local convenience).
process.env.ATTACHMENT_SCAN_ENABLED = 'true';
process.env.ATTACHMENT_SCAN_BYPASS = 'false';
process.env.ATTACHMENT_SCAN_WEBHOOK_SECRET = 'test-scan-secret';
// Pin the inbound-email webhook secret to the test value (the dev `.env` ships a
// real secret); specs authenticate the webhook with 'test-inbound-secret'.
process.env.INBOUND_EMAIL_WEBHOOK_SECRET = 'test-inbound-secret';
process.env.M365_INBOUND_WEBHOOK_SECRET = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;

jest.setTimeout(60000);
