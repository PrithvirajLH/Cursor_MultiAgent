import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';

// Keys HealthService reads through ConfigService. Importing PrismaService pulls
// in @prisma/client, which loads the dev apps/api/.env into process.env, and
// ConfigService.get() falls through to process.env for keys the spec did not
// set — so a populated dev .env would make the "bare" cases lie. Scrub them.
const CONFIG_KEYS = [
  'ATTACHMENT_SCAN_ENABLED',
  'ATTACHMENT_SCAN_BYPASS',
  'ATTACHMENT_SCAN_WEBHOOK_SECRET',
  'AZURE_AI_FOUNDRY_ENDPOINT',
  'AZURE_AI_FOUNDRY_API_KEY',
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of CONFIG_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of CONFIG_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

function build(env: Record<string, string>, dbOk = true) {
  const prisma = {
    $queryRaw: dbOk
      ? jest.fn().mockResolvedValue([{ '?column?': 1 }])
      : jest.fn().mockRejectedValue(new Error('down')),
  };
  const deps = {
    email: { isConfigured: () => Boolean(env.SMTP_HOST) },
    emailQueue: { getStatus: () => 'disabled' as const },
    automationQueue: { getStatus: () => 'disabled' as const },
    realtime: {
      isEnabled: () => Boolean(env.AZURE_WEB_PUBSUB_CONNECTION_STRING),
    },
    attachments: {
      isAzureBlobStorageEnabled: () =>
        Boolean(env.AZURE_STORAGE_CONNECTION_STRING),
    },
    slaBreach: {
      getWorkerState: () => ({
        enabled: true,
        lastRunAt: null,
        lastRunOk: null,
      }),
    },
    // Card 1.32: readiness now reports outbox depth.
    outbox: {
      counts: () =>
        Promise.resolve({ pending: 0, processing: 0, sent: 0, failed: 0 }),
    },
  };
  return new HealthService(
    new ConfigService(env),
    prisma as never,
    deps.email as never,
    deps.emailQueue as never,
    deps.automationQueue as never,
    deps.realtime as never,
    deps.attachments as never,
    deps.slaBreach as never,
    deps.outbox as never,
  );
}

describe('HealthService.readiness', () => {
  it('reports a bare environment as blocked/missing/disabled but ok', async () => {
    const report = await build({}).readiness();
    expect(report.status).toBe('ok');
    expect(report.db).toBe('ok');
    expect(report.smtp).toBe('missing');
    expect(report.webPubSub).toBe('disabled');
    expect(report.blobStorage).toBe('local-disk');
    expect(report.attachmentScanner).toBe('blocked');
    expect(report.aiPipeline).toBe('disabled');
  });

  it('reports bypass when ATTACHMENT_SCAN_BYPASS=true even if a secret exists', async () => {
    const report = await build({
      ATTACHMENT_SCAN_BYPASS: 'true',
      ATTACHMENT_SCAN_WEBHOOK_SECRET: 'x',
    }).readiness();
    expect(report.attachmentScanner).toBe('bypass');
  });

  it('reports gate-off when ATTACHMENT_SCAN_ENABLED=false even if a secret exists', async () => {
    const report = await build({
      ATTACHMENT_SCAN_ENABLED: 'false',
      ATTACHMENT_SCAN_WEBHOOK_SECRET: 'x',
    }).readiness();
    expect(report.attachmentScanner).toBe('gate-off');
  });

  it('reports configured scanner and AI when their settings exist', async () => {
    const report = await build({
      ATTACHMENT_SCAN_WEBHOOK_SECRET: 'x',
      AZURE_AI_FOUNDRY_ENDPOINT: 'https://e',
      AZURE_AI_FOUNDRY_API_KEY: 'k',
    }).readiness();
    expect(report.attachmentScanner).toBe('configured');
    expect(report.aiPipeline).toBe('configured');
  });

  it('marks status degraded when the database check fails', async () => {
    const report = await build({}, false).readiness();
    expect(report.db).toBe('error');
    expect(report.status).toBe('degraded');
  });

  it('never includes configuration values in the report', async () => {
    const report = await build({
      SMTP_HOST: 'smtp.example.test',
      AZURE_STORAGE_CONNECTION_STRING: 'SECRET',
    }).readiness();
    expect(JSON.stringify(report)).not.toContain('smtp.example.test');
    expect(JSON.stringify(report)).not.toContain('SECRET');
  });
});
