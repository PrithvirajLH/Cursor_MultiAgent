import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import type { HealthService } from './health.service';
import type { ReadinessReport } from './readiness-report.type';

/**
 * ⚠️ REAL-SHAPED BUT NOT REAL. The values need the SHAPE of App Service
 * settings for the canary to be meaningful, and the passwords and keys here are
 * invented. The HOSTNAMES are deliberately `example-*` rather than the real
 * ones: two of this repo's remotes are public, and a genuine database hostname
 * is a location worth knowing even when the password beside it is fiction.
 */
const SECRETS = {
  blob: 'DefaultEndpointsProtocol=https;AccountName=examplestore;AccountKey=abc123XYZ==',
  pubsub: 'Endpoint=https://example-pubsub.webpubsub.azure.com;AccessKey=s3cr3tk3y=;Version=1.0;',
  foundry: 'https://example-foundry.openai.azure.com',
  foundryKey: 'fk-0000-abcdef',
  smtp: 'smtp-password-hunter2',
  db: 'postgresql://ticket:pa55w0rd@example-db.postgres.database.azure.com:5432/app',
};

/**
 * Card 1.114 — the readiness endpoint's token, and what its body may carry.
 *
 * ⚠️ BE ACCURATE ABOUT THE EXPOSURE, BECAUSE THE AUDIT WAS NOT.
 * `/api/health/ready` is NOT in the live Easy Auth `excludedPaths` list
 * (verified 2026-09-14), so Easy Auth already refuses anonymous callers at the
 * edge. The real exposure is any signed-in tenant account plus anything inside
 * the container — much smaller than "open to the internet".
 *
 * ⚠️ SETTING `HEALTH_READY_TOKEN` IS THE OWNER'S ACTION AND IS NOT DONE
 * HERE. The mechanism already exists and is already timing-safe; it needs a
 * value, not code. What this file adds is the guarantee that the body stays
 * safe to serve in the configuration that actually exists today.
 */
describe('GET /api/health/ready (card 1.114)', () => {
  const report: ReadinessReport = {
    status: 'ok',
    checkedAt: '2026-09-15T00:00:00.000Z',
    db: 'ok',
    redis: { emailQueue: 'connected', automationQueue: 'connected' },
    smtp: 'configured',
    webPubSub: 'configured',
    blobStorage: 'azure',
    attachmentScanner: 'configured',
    aiPipeline: 'configured',
    slaWorker: {
      enabled: true,
      lastRunAt: '2026-09-15T00:00:00.000Z',
      lastRunOk: true,
      lastSummary: null,
    },
    outbox: null,
  };

  const build = (token?: string) => {
    const health = { readiness: jest.fn().mockResolvedValue(report) };
    const config = {
      get: (key: string) =>
        key === 'HEALTH_READY_TOKEN'
          ? token
          : (SECRETS as Record<string, string>)[key],
    } as unknown as ConfigService;
    return new HealthController(
      health as unknown as HealthService,
      config,
    );
  };

  it('⚠️ with a token set, a wrong one is refused', async () => {
    const controller = build('the-real-token');
    await expect(controller.ready('not-the-token')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.ready(undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('with a token set, the right one passes', async () => {
    const controller = build('the-real-token');
    await expect(controller.ready('the-real-token')).resolves.toMatchObject({
      status: 'ok',
    });
  });

  it('⚠️ with NO token set, behaviour is completely unchanged', async () => {
    // NON-VACUITY, and it pins the decision NOT to thin the body: this is the
    // only configuration that exists today, and every monitor reads it.
    const controller = build(undefined);
    await expect(controller.ready(undefined)).resolves.toEqual(report);
  });

  it('⚠️ the body never contains a connection string, key or endpoint', async () => {
    // THE CANARY, asserted on the SERIALISED payload rather than field by
    // field - twice this month a field-level assertion passed while the data
    // still went out (card 1.96's follower route, card 1.91's AI canary).
    const controller = build(undefined);
    const body = JSON.stringify(await controller.ready(undefined));
    for (const secret of Object.values(SECRETS)) {
      expect(body).not.toContain(secret);
    }
    expect(body).not.toContain('AccountKey');
    expect(body).not.toContain('AccessKey');
    expect(body).not.toContain('postgresql://');
    expect(body).not.toContain('.azure.com');
  });
});
