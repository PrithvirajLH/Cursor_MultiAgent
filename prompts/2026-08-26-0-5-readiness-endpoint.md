# Implementation Prompt — 0.5 Readiness endpoint

**Date:** 2026-08-26
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`, HEAD `d6cc683`)
**Card:** 0.5 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** nobody can say which optional integrations (Redis, SMTP, Web PubSub, Blob storage, attachment scanner, AI) are switched on in production. Cards 0.4 (alerts) and 0.7 (virus scanning) both need that answer.

---

## 1. Goal

Add `GET /api/health/ready` that reports, without exposing any secret, the live state of every optional integration plus the database and the SLA worker. Then, after it is deployed, capture production's answer and the *names* of its app settings in `docs/azure-env-inventory.md`.

The existing `GET /api/health` stays exactly as it is — it is the liveness probe; this is the readiness/inventory probe.

## 2. Context read (do this first)

- `CLAUDE.md` — five rules; baseline is now **186 unit, 360 integration + 1 skipped, 36 web unit (13 files)**.
- `docs/agent-context/repo-landmines.md` — "Database and checks" (consent variable, redirect integration output to a file, never edit source mid-run) and "Windows process hygiene".
- `docs/DEPLOYMENT.md` — only if you do Part B (production capture). Read "401 on every URL is correct" first.
- `.cursorrules` — explicit types, no `any`, JSDoc on public methods, **one export per file**, kebab-case filenames, no blank lines inside functions.

## 3. Facts established first (verified 2026-08-26)

| Fact | Consequence |
|---|---|
| `src/app.controller.ts` has `@Get('health')` `@Public()` returning `{ status: 'ok', timestamp }`, no constructor dependencies; `src/app.controller.spec.ts` builds it with `controllers: [AppController]` only. | Leave both untouched. Put the new route in a new `health/` module so the unit spec keeps compiling. A `@Controller('health')` with `@Get('ready')` yields `/api/health/ready` and does not collide with the root controller's `health`. |
| `AuthGuard` honours `@Public()` (`src/auth/public.decorator.ts`); `RouteThrottlerGuard` is the global `APP_GUARD` (`app.module.ts:117`) and applies to public routes too. | Mark the route `@Public()`. Default throttle is 120/min per IP — fine for a monitor polling once a minute. |
| Every integration has an in-code signal already: `EmailService.isConfigured()` (`notifications/email.service.ts:32`); `EmailQueueService.enabled` + `connection.status` (`email-queue.service.ts:21,116`) — both **private**; `AutomationQueueService.enabled`/`connection` (`common/automation-queue.service.ts:31-32`) — private; `RealtimeService.isEnabled()` (`realtime/realtime.service.ts:124`); `TicketAttachmentService.isAzureBlobStorageEnabled()` (`tickets/ticket-attachment.service.ts:346`); `SlaBreachService.enabled` (`slas/sla-breach.service.ts:45`) — private, no last-run timestamp; `PrismaService extends PrismaClient` (`prisma/prisma.service.ts`). | Read state from the services, not by re-parsing env, except where no service holds it (scanner, AI). Three services need a small public accessor. |
| Module exports today: `NotificationsModule` exports `NotificationsService, InAppNotificationsService, TicketEmailThreadService` (**not** `EmailService`/`EmailQueueService`); `TicketsModule` exports `TicketsService, TicketSlaCalculationService` (**not** `TicketAttachmentService`); `SlasModule` exports `SlaEngineService, BusinessHoursCacheService` (**not** `SlaBreachService`); `RealtimeModule` exports `RealtimeService`; `PrismaModule` exports `PrismaService`; `CommonModule` is `@Global()` and exports `AutomationQueueService`. | Four export-list additions; nothing else in module wiring. |
| Attachment scan default (`ticket-attachment.service.ts:584-593`): `ATTACHMENT_SCAN_BYPASS === 'true'` → new uploads are `CLEAN`; otherwise `PENDING` until a scanner posts to `POST /api/attachments/:id/scan-status` with `x-attachment-scan-secret` = `ATTACHMENT_SCAN_WEBHOOK_SECRET` (`:510-526`). Downloads are refused unless `CLEAN`. | Scanner state is a three-way: `bypass` / `configured` (secret present, a scanner *could* call back) / `blocked` (neither — every upload is stuck). |
| The AI client reads `AZURE_AI_FOUNDRY_ENDPOINT` and `AZURE_AI_FOUNDRY_API_KEY` with `getOrThrow` (`ai/foundry-client.service.ts:105-106`). `AI_PIPELINE_ENABLED` appears in `.env.example` but **nowhere in `src/`** — it is dead documentation. | AI state = both vars present → `configured`, else `disabled`. Do not read `AI_PIPELINE_ENABLED`. (Logged as doc drift in the master plan.) |
| `.env.test` sets no `NOTIFICATIONS_QUEUE_ENABLED`, `AUTOMATION_QUEUE_ENABLED`, `SMTP_*`, `AZURE_*`, `ATTACHMENT_SCAN_*` or AI vars; `ATTACHMENTS_DIR=tmp/test-uploads`. Queue services default to enabled and try `localhost:6379`, then fall back to inline when Redis is absent. | In the integration test the expected answers are: db `ok`, smtp `missing`, webPubSub `disabled`, blobStorage `local-disk`, attachmentScanner `blocked`, aiPipeline `disabled`, slaWorker.enabled `true`; Redis state is timing-dependent (`connecting` → `inline-fallback`), so assert it is one of the allowed values, not a specific one. |
| Integration harness: `test/utils/test-app.ts` `createTestApp()` boots the whole `AppModule`; specs call `resetTestDb()` in `beforeAll`; auth is `x-user-email` headers (`AUTH_ALLOW_INSECURE_HEADERS` in test). `jest.integration.json` matches `test/integration/*.spec.ts`. | Add `test/integration/health.spec.ts` following `csat.spec.ts`. No auth header needed for a `@Public()` route. |
| Production: Easy Auth is on with `RedirectToLoginPage`, so anonymous `curl` gets 401 on every URL (`docs/DEPLOYMENT.md:223-228`). | Part B captures the readiness JSON from a **signed-in browser tab**, not curl. Do not change Easy Auth in this card — 0.4 decides whether to exclude the path for a monitor. |
| Adding tests changes the baselines: unit 186 → 186 + (new unit tests), integration 360 → 360 + (new integration tests). | Record the real numbers in `CLAUDE.md` and `repo-landmines.md` after the full runs. |

## 4. Decisions and assumptions

1. **New `src/health/` module** (`health.module.ts`, `health.controller.ts`, `health.service.ts`, `health.service.spec.ts`) — one export per file, and it keeps `AppController`'s zero-dependency spec intact.
2. **Read live state from services; env only for scanner and AI.** A readiness probe that re-derives everything from env would say "Redis configured" while the connection is dead. The queue services already know whether they fell back to inline.
3. **Three tiny public accessors, no behaviour change:** `EmailQueueService.getStatus()`, `AutomationQueueService.getStatus()`, `SlaBreachService.getWorkerState()`. The SLA one records `lastRunAt`/`lastRunOk` in a `finally` inside the existing `checkBreaches()` so a hung worker becomes visible (card 0.4 alerts on it).
4. **Optional shared token.** If `HEALTH_READY_TOKEN` is set, the route requires header `x-health-token` (constant-time compare) and returns 403 otherwise. Unset → open. Production is behind Easy Auth anyway; the token exists so 0.4 can exclude the path from Easy Auth for a monitor without exposing the JSON to the world. Nothing in the JSON is secret either way — states and timestamps only, never values.
5. **`status` is `ok` unless the database check fails** (→ `degraded`, HTTP still 200 so monitors read the body). Everything else is informational; a missing SMTP is a fact, not a failure.
6. **DB check is `SELECT 1` with a 2-second race timeout** so a hung pool answers `error` instead of hanging the probe.
7. **Part B (production capture) is a separate task after the GREEN + deploy**, and records **names only** for app settings — never values.

## 5. The work

Kill stray node processes first (`CLAUDE.md` rule 3). Work in `apps/api`.

### Task 1 — Public accessors on three services

**Files:** Modify `src/notifications/email-queue.service.ts`, `src/common/automation-queue.service.ts`, `src/slas/sla-breach.service.ts`

- [ ] **Step 1 — write the failing unit tests first.** Add to the existing `src/notifications/outbox.service.spec.ts`? No — those test `OutboxService`. Create `src/notifications/email-queue.service.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { EmailQueueService } from './email-queue.service';
import type { EmailProcessorService } from './email-processor.service';

describe('EmailQueueService.getStatus', () => {
  it('reports disabled when NOTIFICATIONS_QUEUE_ENABLED=false', () => {
    const config = new ConfigService({ NOTIFICATIONS_QUEUE_ENABLED: 'false' });
    const processor = {} as EmailProcessorService;
    const service = new EmailQueueService(config, processor);
    service.onModuleInit();
    expect(service.getStatus()).toBe('disabled');
  });
});
```

      Run: `npx jest src/notifications/email-queue.service.spec.ts` → FAIL (`getStatus is not a function`).

- [ ] **Step 2 — implement in `email-queue.service.ts`** (public method, JSDoc, placed after `onModuleInit`):

```ts
  /**
   * Live state of the BullMQ/Redis connection for the readiness probe.
   * `inline-fallback` means Redis was configured but unreachable and the
   * service is now sending emails synchronously.
   */
  getStatus(): QueueStatus {
    if (!this.enabled && this.connection === null) {
      return 'disabled';
    }
    if (!this.enabled) {
      return 'inline-fallback';
    }
    if (this.connection?.status === 'ready') {
      return 'connected';
    }
    return 'connecting';
  }
```

      Add the shared type in a new file `src/common/queue-status.type.ts` (one export per file):

```ts
/** Shared readiness vocabulary for the BullMQ-backed queues. */
export type QueueStatus =
  | 'disabled'
  | 'connecting'
  | 'connected'
  | 'inline-fallback';
```

      Check the branch logic against the existing code: `onModuleInit` sets `enabled = false` and returns **before** creating a connection when the env is `'false'` (so `connection` stays `null`); `fallbackToInline()` sets `enabled = false` **after** a connection existed. If `fallbackToInline()` also nulls the connection (read lines 135-150), keep a separate `private fellBack = false` flag set there and use it instead of the `connection === null` test.

- [ ] **Step 3 — same for `automation-queue.service.ts`**: identical `getStatus(): QueueStatus` using its own `enabled`/`connection` (and `fellBack` if needed). Unit test `src/common/automation-queue.service.spec.ts` with `AUTOMATION_QUEUE_ENABLED: 'false'` and `{} as RuleEngineService`.

- [ ] **Step 4 — `sla-breach.service.ts`:** add fields and accessor:

```ts
  private lastRunAt: Date | null = null;
  private lastRunOk: boolean | null = null;

  /** Worker state for the readiness probe; `lastRunAt` is null until the first tick completes. */
  getWorkerState(): SlaWorkerState {
    return {
      enabled: this.enabled,
      lastRunAt: this.lastRunAt ? this.lastRunAt.toISOString() : null,
      lastRunOk: this.lastRunOk,
    };
  }
```

      `src/slas/sla-worker-state.type.ts`:

```ts
/** Snapshot of the SLA breach worker for the readiness probe. */
export type SlaWorkerState = {
  enabled: boolean;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
};
```

      In `checkBreaches()` (the method the interval calls; find its body below line 75), wrap the existing body so that a `finally` sets `this.lastRunAt = new Date()` and a `catch` sets `this.lastRunOk = false` before re-throwing, with `this.lastRunOk = true` at the end of the success path. Do not change what the method does otherwise. Unit test in a new `src/slas/sla-breach.service.spec.ts` is awkward (six constructor deps) — cover `getWorkerState()` through the integration test in Task 4 instead, and unit-test only the two queue accessors.

- [ ] **Step 5:** `npx jest src/notifications src/common` → new tests pass; `npx tsc --noEmit` → 0.

### Task 2 — Export the services

**Files:** Modify `src/notifications/notifications.module.ts:25-29`, `src/tickets/tickets.module.ts:31`, `src/slas/slas.module.ts:20`

- [ ] `NotificationsModule.exports` += `EmailService, EmailQueueService`.
- [ ] `TicketsModule.exports` += `TicketAttachmentService`.
- [ ] `SlasModule.exports` += `SlaBreachService`.
- [ ] `npx tsc --noEmit` → 0.

### Task 3 — The health module

**Files:** Create `src/health/health.module.ts`, `src/health/health.controller.ts`, `src/health/health.service.ts`, `src/health/readiness-report.type.ts`, `src/health/health.service.spec.ts`; Modify `src/app.module.ts` (import `HealthModule`).

- [ ] **Step 1 — the response type**, `readiness-report.type.ts`:

```ts
import type { QueueStatus } from '../common/queue-status.type';
import type { SlaWorkerState } from '../slas/sla-worker-state.type';

/** Shape of GET /api/health/ready. States only — never configuration values. */
export type ReadinessReport = {
  status: 'ok' | 'degraded';
  checkedAt: string;
  db: 'ok' | 'error';
  redis: { emailQueue: QueueStatus; automationQueue: QueueStatus };
  smtp: 'configured' | 'missing';
  webPubSub: 'configured' | 'disabled';
  blobStorage: 'azure' | 'local-disk';
  attachmentScanner: 'configured' | 'bypass' | 'blocked';
  aiPipeline: 'configured' | 'disabled';
  slaWorker: SlaWorkerState;
};
```

- [ ] **Step 2 — failing unit test** `health.service.spec.ts` (mock every dependency as a plain object; no Nest testing module needed):

```ts
import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';

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
    realtime: { isEnabled: () => Boolean(env.AZURE_WEB_PUBSUB_CONNECTION_STRING) },
    attachments: { isAzureBlobStorageEnabled: () => Boolean(env.AZURE_STORAGE_CONNECTION_STRING) },
    slaBreach: { getWorkerState: () => ({ enabled: true, lastRunAt: null, lastRunOk: null }) },
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
    const report = await build({ SMTP_HOST: 'smtp.example.test', AZURE_STORAGE_CONNECTION_STRING: 'SECRET' }).readiness();
    expect(JSON.stringify(report)).not.toContain('smtp.example.test');
    expect(JSON.stringify(report)).not.toContain('SECRET');
  });
});
```

      Run: `npx jest src/health` → FAIL (module not found).

- [ ] **Step 3 — `health.service.ts`:**

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AutomationQueueService } from '../common/automation-queue.service';
import { EmailQueueService } from '../notifications/email-queue.service';
import { EmailService } from '../notifications/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SlaBreachService } from '../slas/sla-breach.service';
import { TicketAttachmentService } from '../tickets/ticket-attachment.service';
import type { ReadinessReport } from './readiness-report.type';

const DB_CHECK_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly emailQueue: EmailQueueService,
    private readonly automationQueue: AutomationQueueService,
    private readonly realtime: RealtimeService,
    private readonly attachments: TicketAttachmentService,
    private readonly slaBreach: SlaBreachService,
  ) {}

  /** Live state of every optional integration. States only, never values. */
  async readiness(): Promise<ReadinessReport> {
    const db = await this.checkDatabase();
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      checkedAt: new Date().toISOString(),
      db,
      redis: {
        emailQueue: this.emailQueue.getStatus(),
        automationQueue: this.automationQueue.getStatus(),
      },
      smtp: this.email.isConfigured() ? 'configured' : 'missing',
      webPubSub: this.realtime.isEnabled() ? 'configured' : 'disabled',
      blobStorage: this.attachments.isAzureBlobStorageEnabled() ? 'azure' : 'local-disk',
      attachmentScanner: this.scannerState(),
      aiPipeline: this.aiState(),
      slaWorker: this.slaBreach.getWorkerState(),
    };
  }

  private async checkDatabase(): Promise<'ok' | 'error'> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('db check timed out')), DB_CHECK_TIMEOUT_MS),
    );
    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
      return 'ok';
    } catch {
      return 'error';
    }
  }

  private scannerState(): ReadinessReport['attachmentScanner'] {
    if (this.config.get<string>('ATTACHMENT_SCAN_BYPASS') === 'true') {
      return 'bypass';
    }
    return this.hasValue('ATTACHMENT_SCAN_WEBHOOK_SECRET') ? 'configured' : 'blocked';
  }

  private aiState(): ReadinessReport['aiPipeline'] {
    return this.hasValue('AZURE_AI_FOUNDRY_ENDPOINT') && this.hasValue('AZURE_AI_FOUNDRY_API_KEY')
      ? 'configured'
      : 'disabled';
  }

  private hasValue(key: string): boolean {
    return Boolean(this.config.get<string>(key)?.trim());
  }
}
```

      Mind `.cursorrules`: no blank lines inside functions — reformat if Prettier inserts any. The `setTimeout` in the race is never cleared on success; wrap it so the timer is cleared (`const timer = setTimeout(...)` … `clearTimeout(timer)` in a `finally`) so jest does not report an open handle.

- [ ] **Step 4 — `health.controller.ts`:**

```ts
import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Public } from '../auth/public.decorator';
import { HealthService } from './health.service';
import type { ReadinessReport } from './readiness-report.type';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * GET /api/health/ready — integration inventory for operators and monitors.
   * Open unless HEALTH_READY_TOKEN is set, in which case x-health-token must match.
   */
  @Get('ready')
  @Public()
  async ready(
    @Headers('x-health-token') token: string | undefined,
  ): Promise<ReadinessReport> {
    this.assertToken(token);
    return this.health.readiness();
  }

  private assertToken(received: string | undefined) {
    const expected = this.config.get<string>('HEALTH_READY_TOKEN')?.trim();
    if (!expected) {
      return;
    }
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(received ?? '', 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Invalid health token');
    }
  }
}
```

- [ ] **Step 5 — `health.module.ts`:**

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SlasModule } from '../slas/slas.module';
import { TicketsModule } from '../tickets/tickets.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [ConfigModule, PrismaModule, NotificationsModule, RealtimeModule, SlasModule, TicketsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
```

      `AutomationQueueService` comes from the `@Global()` `CommonModule` — no import needed. Add `HealthModule` to `AppModule.imports` (alphabetically after `CustomFieldsModule`).

- [ ] **Step 6:** `npx jest src/health` → 5 pass. `npx tsc --noEmit` → 0. `npx jest --silent` → 186 + 7 = **193** (5 health + 1 email-queue + 1 automation-queue). If your count differs, the real number wins — record it.

### Task 4 — Integration test

**Files:** Create `test/integration/health.spec.ts`

- [ ] **Step 1 — write it:**

```ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

type ReadyBody = {
  status: string;
  db: string;
  redis: { emailQueue: string; automationQueue: string };
  smtp: string;
  webPubSub: string;
  blobStorage: string;
  attachmentScanner: string;
  aiPipeline: string;
  slaWorker: { enabled: boolean; lastRunAt: string | null; lastRunOk: boolean | null };
};

const QUEUE_STATES = ['disabled', 'connecting', 'connected', 'inline-fallback'];

describe('GET /api/health/ready', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers without authentication and reports the test environment truthfully', async () => {
    const res = await request(server).get('/api/health/ready').expect(200);
    const body = res.body as ReadyBody;
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(QUEUE_STATES).toContain(body.redis.emailQueue);
    expect(QUEUE_STATES).toContain(body.redis.automationQueue);
    expect(body.smtp).toBe('missing');
    expect(body.webPubSub).toBe('disabled');
    expect(body.blobStorage).toBe('local-disk');
    expect(body.attachmentScanner).toBe('blocked');
    expect(body.aiPipeline).toBe('disabled');
    expect(body.slaWorker.enabled).toBe(true);
  });

  it('leaves the liveness probe unchanged', async () => {
    const res = await request(server).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
  });
});
```

- [ ] **Step 2 — run only this spec first** (fast, ~30 s):
      `export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"` (bash) — Postgres must be up: `wsl -d Ubuntu-22.04 -- sudo pg_ctlcluster 16 main start`.
      `npx jest --config ./test/jest.integration.json test/integration/health.spec.ts > ../../health-int.txt 2>&1; tail -20 ../../health-int.txt` → 2 passed.
      If `attachmentScanner` comes back `bypass`, your local `.env.test` differs from the checked facts — report it rather than editing the test.

- [ ] **Step 3 — full integration run** (≈6 min, do not touch source while it runs):
      `npm run test:integration > ../../int-full.txt 2>&1` then read the summary from the file (the process may not exit on its own — see landmines; kill it after the summary prints). Expected: **362 passed, 1 skipped** (360 + 2). Record the real number.

### Task 5 — Docs and commit

- [ ] `CLAUDE.md` baseline line → `**193 unit tests, 362 integration + 1 skipped, 36 web unit tests (13 files)**` (use your real numbers) and the `# 186` / `# 360 + 1 skipped` comments in the code block. Same edit in `docs/agent-context/repo-landmines.md` baseline bullet (date 2026-08-26).
- [ ] `apps/api/.env.example`: under "Attachments" add `HEALTH_READY_TOKEN=` with the comment `# Optional. When set, GET /api/health/ready requires header x-health-token.`; and change the `AI_PIPELINE_ENABLED=false` line's comment to `# Not read by the code — AI is on when AZURE_AI_FOUNDRY_ENDPOINT and _API_KEY are set. Kept for backward compatibility of existing .env files.`
- [ ] `docs/azure-env-settings.md`: add a short "Readiness" row group: `HEALTH_READY_TOKEN` optional; and one sentence pointing operators at `GET /api/health/ready`.
- [ ] Commit (do not push):

```bash
git add apps/api/src/health apps/api/src/common/queue-status.type.ts apps/api/src/slas/sla-worker-state.type.ts \
  apps/api/src/notifications/email-queue.service.ts apps/api/src/notifications/email-queue.service.spec.ts \
  apps/api/src/common/automation-queue.service.ts apps/api/src/common/automation-queue.service.spec.ts \
  apps/api/src/slas/sla-breach.service.ts apps/api/src/notifications/notifications.module.ts \
  apps/api/src/tickets/tickets.module.ts apps/api/src/slas/slas.module.ts apps/api/src/app.module.ts \
  apps/api/test/integration/health.spec.ts apps/api/.env.example CLAUDE.md docs/agent-context/repo-landmines.md docs/azure-env-settings.md
git commit -m "feat(api): add GET /api/health/ready integration inventory

- reports db, redis queues, smtp, web pubsub, blob storage, attachment scanner, AI and SLA worker state
- states only, never configuration values; optional HEALTH_READY_TOKEN gate
- public accessors on EmailQueueService, AutomationQueueService, SlaBreachService
- unit + integration coverage; baselines updated"
```

### Task 6 — Part B: capture production (only after the planning session says GREEN and the build is deployed per `docs/DEPLOYMENT.md`)

- [ ] In a browser where you are signed in to `https://ticketticket-gmgwf9efe4h6bmfb.southcentralus-01.azurewebsites.net`, open `/api/health/ready`. Copy the JSON.
- [ ] `az webapp config appsettings list -g csnhc-ai -n TicketTicket --query "[].name" -o tsv | sort` — **names only**. Never run this without `--query "[].name"`; values are secrets.
- [ ] Write `docs/azure-env-inventory.md`: date, deployed commit SHA (`DEPLOYED_COMMIT_SHA` is one of the names), the readiness JSON verbatim, the sorted setting names, and a one-line interpretation per integration ("SMTP: missing → no email leaves production today"). Commit it.

## 6. Files expected to change

| File | Change |
|---|---|
| `apps/api/src/health/health.module.ts` · `health.controller.ts` · `health.service.ts` · `readiness-report.type.ts` · `health.service.spec.ts` | new |
| `apps/api/src/common/queue-status.type.ts` · `apps/api/src/slas/sla-worker-state.type.ts` | new |
| `apps/api/src/notifications/email-queue.service.ts` (+ `.spec.ts` new) | `getStatus()` |
| `apps/api/src/common/automation-queue.service.ts` (+ `.spec.ts` new) | `getStatus()` |
| `apps/api/src/slas/sla-breach.service.ts` | `lastRunAt`/`lastRunOk` + `getWorkerState()` |
| `apps/api/src/notifications/notifications.module.ts` · `tickets/tickets.module.ts` · `slas/slas.module.ts` | export additions |
| `apps/api/src/app.module.ts` | import `HealthModule` |
| `apps/api/test/integration/health.spec.ts` | new |
| `apps/api/.env.example` · `docs/azure-env-settings.md` · `CLAUDE.md` · `docs/agent-context/repo-landmines.md` | docs |
| *(Part B)* `docs/azure-env-inventory.md` | new |

No Prisma schema change, no migration, no web change, no new dependency. Anything else is a red flag — stop and report.

## 7. Security considerations

- The report must contain **states, never values**: no hostnames, connection strings, container names, endpoints. The last unit test asserts this for two sample values; keep it.
- `@Public()` route: it reveals which integrations exist. Acceptable behind Easy Auth; the token gate exists for when 0.4 excludes the path for a monitor. Constant-time comparison, 403 on mismatch, no hint in the message.
- The DB check runs an unparameterised constant `SELECT 1` only.
- Part B: app setting **names** only in the repo. If a value ever lands in a doc, treat it as a leak — rotate and scrub history.

## 8. Acceptance criteria

1. `GET /api/health/ready` returns 200 with the exact `ReadinessReport` shape, no auth, in dev and test.
2. With `HEALTH_READY_TOKEN` set locally, a request without the header → 403; with the right header → 200 (manual step 3).
3. `GET /api/health` unchanged; `src/app.controller.spec.ts` untouched and passing.
4. `npx jest` → 186 + new unit tests (expected 193); `npm run test:integration` → 360 + 2 (expected 362) + 1 skipped; both `tsc --noEmit` clean; `npx vitest run` in web still 36/13.
5. Baselines updated in `CLAUDE.md` and `repo-landmines.md` with the real numbers.
6. No values from configuration appear in any response or doc.
7. After deploy: `docs/azure-env-inventory.md` exists with the production JSON and setting names.

## 9. Checks to run (in this order)

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit
npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npx jest --config ./test/jest.integration.json test/integration/health.spec.ts > ../../health-int.txt 2>&1; tail -20 ../../health-int.txt
npm run test:integration > ../../int-full.txt 2>&1        # ~6 min; read the file; kill the orphan afterwards
grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
cd ../.. && git status --short && git diff --stat HEAD~1
```

## 10. Manual test steps

1. `npm run dev -w apps/api` (Postgres up). `curl -s localhost:3000/api/health/ready | jq` → `db: "ok"`, `smtp` reflects your `.env`, `slaWorker.lastRunAt` becomes non-null within one interval (default 60 s).
2. `curl -s localhost:3000/api/health` → unchanged `{ status: "ok", timestamp }`.
3. Add `HEALTH_READY_TOKEN=devtoken` to `apps/api/.env`, restart: `curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/health/ready` → 403; with `-H "x-health-token: devtoken"` → 200. Remove the variable afterwards.
4. Stop the dev server (rule 3).

## 11. Handoff notes — what to report back

1. Commit SHA.
2. `Tests:` line from `npx jest --silent` and from the full integration run (paste the summary block), plus the health spec's own run.
3. `tsc --noEmit` exit codes (api, web) and the vitest summary.
4. `git diff --stat HEAD~1`.
5. Output of manual steps 1–3 (the JSON, and the two HTTP codes).
6. Anything that did not match this prompt — especially: the real behaviour of `fallbackToInline()` vs the `getStatus()` branch logic in Task 1 step 2; the shape of `checkBreaches()` if the `finally` did not fit cleanly; the true test counts.
7. Part B is **not** part of this report — it happens after GREEN and deploy.

---

## 12. Decision after the stop-and-report (planning session, 2026-08-26)

The implementer stopped at Task 4 because §3's integration expectations were wrong. Verified by the planning session against `test/setup-tests.ts` and the dev `.env` key names: the harness pins `NOTIFICATIONS_QUEUE_ENABLED=false`, `SLA_BREACH_WORKER_ENABLED=false`, `ATTACHMENT_SCAN_ENABLED=true`, `ATTACHMENT_SCAN_BYPASS=false`, `ATTACHMENT_SCAN_WEBHOOK_SECRET=test-scan-secret`; it does **not** pin `AUTOMATION_QUEUE_ENABLED`; and its deliberate `require('@prisma/client')` loads the dev `.env`, whose `AZURE_WEB_PUBSUB_*`, `AZURE_STORAGE_*`, `AZURE_AI_FOUNDRY_*` and `SMTP_*` keys then leak into every integration run on this machine (so today's attachment and realtime specs hit the real Blob container and Web PubSub here, and behave differently in CI). §3 rows 7 and 9 were wrong; so was the landmines sentence they leaned on.

**Decision: option 2 — make the harness hermetic, then assert exact values.** Plus three small additions found in the report.

### 12.1 `test/setup-tests.ts` (now in scope)

After the existing `require('@prisma/client');` block and its `delete process.env.RATE_LIMIT_*` lines, add:

```ts
// Optional integrations must be OFF in the test environment regardless of what
// the dev `.env` contains, so the suite behaves identically here and in CI
// (CI has no `.env` at all). Without this, attachment specs write to the real
// Blob container and realtime specs publish to the real Web PubSub hub.
for (const key of [
  'AZURE_WEB_PUBSUB_CONNECTION_STRING',
  'AZURE_WEB_PUBSUB_HUB',
  'AZURE_WEB_PUBSUB_TOKEN_LIFETIME_MINUTES',
  'AZURE_STORAGE_CONNECTION_STRING',
  'AZURE_STORAGE_CONTAINER',
  'AZURE_AI_FOUNDRY_ENDPOINT',
  'AZURE_AI_FOUNDRY_API_KEY',
  'AZURE_AI_FOUNDRY_MODEL',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'HEALTH_READY_TOKEN',
]) {
  delete process.env[key];
}
process.env.AUTOMATION_QUEUE_ENABLED = 'false';
```

`ai-intake-live.spec.ts` (the 1 skipped) loads credentials from `.env` itself when `AI_LIVE_TEST_ENABLED=true`; dotenv does not override existing keys, so deleting them here lets that opt-in path still work — confirm by reading how that spec loads them, and report if it does anything else.

### 12.2 Integration spec — exact expectations

Replace the first test's assertions with exact values (keep the shape type):

```ts
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(body.redis.emailQueue).toBe('disabled');
    expect(body.redis.automationQueue).toBe('disabled');
    expect(body.smtp).toBe('missing');
    expect(body.webPubSub).toBe('disabled');
    expect(body.blobStorage).toBe('local-disk');
    expect(body.attachmentScanner).toBe('configured');
    expect(body.aiPipeline).toBe('disabled');
    expect(body.slaWorker).toEqual({ enabled: false, lastRunAt: null, lastRunOk: null });
```

Drop the `QUEUE_STATES` membership check — nothing is timing-dependent any more.

### 12.3 Scanner state gains a fourth value (production code, `health.service.ts` + type + unit spec)

`ATTACHMENT_SCAN_ENABLED=false` (read at `ticket-attachment.service.ts:541`) switches the download gate **off** — files are served regardless of scan status. That is a different, worse state than `bypass` (which marks new uploads `CLEAN`). Report it:

- `ReadinessReport['attachmentScanner']` → `'configured' | 'bypass' | 'gate-off' | 'blocked'`.
- `scannerState()`: first `if ((config.get('ATTACHMENT_SCAN_ENABLED') ?? 'true') !== 'true') return 'gate-off';` then the existing bypass / configured / blocked chain.
- Unit test: `ATTACHMENT_SCAN_ENABLED: 'false'` with a secret present → `'gate-off'`. Add `ATTACHMENT_SCAN_ENABLED` to the keys the spec's `beforeEach` snapshots and deletes.

### 12.4 `fellBack` flag (both queue services)

Accepted from item 6C. Add `private fellBack = false;`, set it in `fallbackToInline()`, and make `getStatus()` return `'inline-fallback'` when `!this.enabled && this.fellBack`, `'disabled'` when `!this.enabled` otherwise. The existing unit tests still pass; add one that calls `fallbackToInline()` via the constructor-throw path only if it can be done without a real Redis — otherwise leave it to the JSDoc.

### 12.5 Docs and baselines

- `docs/agent-context/repo-landmines.md` line ~128: replace *"`.env.test` deliberately has no Azure Foundry config."* with: *"`test/setup-tests.ts` deletes every `AZURE_*`, `SMTP_*` and `HEALTH_READY_TOKEN` key after forcing the dev `.env` load, so integration runs are hermetic on every machine; only `ai-intake-live.spec` (opt-in via `AI_LIVE_TEST_ENABLED`) reloads real credentials."* Keep the rest of that bullet.
- Baselines: **193 unit (25 suites), 362 integration + 1 skipped, 36 web (13 files)** — in `CLAUDE.md` and the landmines baseline bullet (date 2026-08-26). If the full run says otherwise after 12.1, the real number wins and is a report-back item.
- The 0.11 note about `PROJECT_DOCUMENTATION.md`/`sprint.md` being gitignored is acknowledged; no action here.

### 12.6 Commit and report

Run §9 in full (the whole integration suite again — 12.1 changes the environment for every spec, so all 39 files must be re-run, not just health). Then the Task 5 commit with these extra paths added: `apps/api/test/setup-tests.ts`, `apps/api/src/health/readiness-report.type.ts` (already listed), and the two queue services. Report items 1–6 of §11 again, plus: (a) confirmation that `tickets.attachments.spec.ts` and the realtime-related specs still pass with the Azure keys scrubbed, (b) how `ai-intake-live.spec.ts` obtains its credentials.

---

## 13. Post-implementation record (planning session, 2026-08-26)

**Verdict: GREEN.** Commit `7ce9516`. Planner independently re-ran: `jest` 196/196 (25 suites); full `test:integration` 362 passed + 1 skipped, 0 failures, 269 s, no orphan; `tsc --noEmit` clean in api and web; vitest 13 files / 36 tests; `git diff --stat HEAD~1` = the §6 list plus `test/setup-tests.ts` (authorised in §12.1); no `package*.json`, schema or migration change. Source read: constant-time token compare, DB race timer cleared, `lastRunAt`/`lastRunOk` set in `try`/`catch`/`finally`, `fellBack` flag correct in both queue services. Approved to **merge and deploy** (migration status must show nothing pending — this card has no migration).

**Corrections accepted from the implementer:**
- §12.1 said `delete process.env[key]`; that does not work because `new PrismaClient()` re-reads the dev `.env` inside Nest DI and re-fills undefined keys. Blank (`''`) is correct. Landmines doc wording fixed by the planner.
- §12.5 predicted 193 unit tests; the real number is 196 (three extra tests requested in §12.3/12.4). Real numbers recorded.
- §12.1's rationale about dotenv "not overriding existing keys" was not the mechanism that keeps `ai-intake-live.spec` working — that spec parses `.env` itself and assigns unconditionally. Conclusion unchanged.

**Next:** deploy `main` per `docs/DEPLOYMENT.md` (deploy agent), then Task 6 / Part B — capture production's `/api/health/ready` JSON and the app-setting *names* into `docs/azure-env-inventory.md`.
