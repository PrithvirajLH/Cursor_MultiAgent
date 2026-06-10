import { defineConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

type EnvMap = Record<string, string>;

function loadEnvFile(filePath: string): EnvMap {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const env: EnvMap = {};
  const contents = fs.readFileSync(filePath, 'utf8');
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) {
      env[key] = value;
    }
  }
  return env;
}

const testEnvPath = path.resolve(__dirname, 'apps', 'api', '.env.test');
const testEnv = loadEnvFile(testEnvPath);
const e2eAuthJwtSecret =
  process.env.E2E_AUTH_JWT_SECRET ?? 'e2e-local-auth-secret';
process.env.E2E_AUTH_JWT_SECRET = e2eAuthJwtSecret;
const serverEnv = {
  ...process.env,
  ...testEnv,
  // The API server reads DATABASE_URL/DIRECT_URL; point them at the test DB so the
  // E2E app hits the same database the reset/seed step prepared (otherwise it would
  // fall back to apps/api/.env, which need not be the test DB).
  DATABASE_URL: testEnv.TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL,
  DIRECT_URL:
    testEnv.TEST_DIRECT_URL ??
    testEnv.TEST_DATABASE_URL ??
    process.env.TEST_DIRECT_URL,
  NODE_ENV: 'test',
  SEED_MODE: 'test',
  TEST_DB_RESET_STRATEGY: 'migrate',
  ATTACHMENT_SCAN_WEBHOOK_SECRET:
    process.env.ATTACHMENT_SCAN_WEBHOOK_SECRET ?? 'e2e-scan-secret',
  INBOUND_EMAIL_WEBHOOK_SECRET:
    process.env.INBOUND_EMAIL_WEBHOOK_SECRET ?? 'e2e-inbound-secret',
  AUTH_ALLOW_INSECURE_HEADERS: 'true',
  AUTH_JWT_SECRET: e2eAuthJwtSecret,
  VITE_E2E_MODE: 'true',
  NOTIFICATIONS_QUEUE_ENABLED: 'false',
  SLA_BREACH_WORKER_ENABLED: 'true',
  SLA_BREACH_INTERVAL_MS: '1000',
  SLA_AT_RISK_ENABLED: 'true',
  SLA_AT_RISK_THRESHOLD_MINUTES: '120',
  // The full serial E2E suite fires many requests from a single client
  // (127.0.0.1) within the throttler's 60s window — well above the production
  // default (120/min) — which trips HTTP 429 (ThrottlerException) on whichever
  // spec happens to run when the window is saturated (seen on resolvePersonas).
  // Raise the global rate limit for the test servers only so throttling never
  // masquerades as a product/test failure. (Webhook/high-write route policies
  // are unaffected; this is the default bucket.)
  RATE_LIMIT_LIMIT: process.env.RATE_LIMIT_LIMIT ?? '100000',
  RATE_LIMIT_TTL_MS: process.env.RATE_LIMIT_TTL_MS ?? '60000'
};

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  // One retry everywhere (not just CI): the dev-server-backed API can be
  // momentarily unresponsive under load, producing transient ETIMEDOUT flakes
  // (e.g. realtime-chat typing). A single retry absorbs those without masking
  // deterministic failures (which still fail on the retry).
  retries: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'node apps/api/scripts/reset-test-db.cjs && npm run dev -w apps/api',
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: serverEnv
    },
    {
      command: 'npm run dev -w apps/web',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: serverEnv
    }
  ]
});
