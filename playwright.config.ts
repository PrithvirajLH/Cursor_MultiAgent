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
  NODE_ENV: 'test',
  SEED_MODE: 'test',
  TEST_DB_RESET_STRATEGY: 'push',
  AUTH_ALLOW_INSECURE_HEADERS: 'true',
  AUTH_JWT_SECRET: e2eAuthJwtSecret,
  VITE_E2E_MODE: 'true',
  NOTIFICATIONS_QUEUE_ENABLED: 'false',
  SLA_BREACH_WORKER_ENABLED: 'true',
  SLA_BREACH_INTERVAL_MS: '1000',
  SLA_AT_RISK_ENABLED: 'true',
  SLA_AT_RISK_THRESHOLD_MINUTES: '120'
};

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
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
