import { readFileSync } from 'fs';
import { join } from 'path';
import { LOG_REDACTION_PATHS } from './log-redaction-paths.util';

/**
 * Card 1.54 — the HTTP logger printed every request header, credentials included.
 */
describe('LOG_REDACTION_PATHS', () => {
  it('⚠️ covers the bearer token', () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. An id_token is a
    // credential and this log ships to Kudu. It was being written in full on
    // every authenticated request.
    expect(LOG_REDACTION_PATHS).toContain('req.headers.authorization');
    expect(LOG_REDACTION_PATHS).toContain('req.headers.cookie');
  });

  it('⚠️ covers every shared secret the idempotency interceptor scopes by', () => {
    // These are read straight off the request as anonymous credentials, and
    // `POST /api/tickets/intake` is LIVE in production with one set - so every
    // Power Automate call was printing it. If a new integration header is added
    // to SECRET_SCOPE_HEADERS and not here, this fails.
    const interceptor = readFileSync(
      join(__dirname, 'idempotency.interceptor.ts'),
      'utf8',
    );
    const block = interceptor.slice(
      interceptor.indexOf('const SECRET_SCOPE_HEADERS'),
    );
    const declared = [
      ...block.slice(0, block.indexOf(']')).matchAll(/'([^']+)'/g),
    ].map((match) => match[1]);
    expect(declared.length).toBeGreaterThan(0);
    for (const header of declared) {
      expect(LOG_REDACTION_PATHS).toContain(`req.headers["${header}"]`);
    }
  });

  it('is wired into the logger rather than merely declared', () => {
    // A constant nobody passes to pino redacts nothing.
    const appModule = readFileSync(join(__dirname, '..', 'app.module.ts'), 'utf8');
    expect(appModule).toContain('LOG_REDACTION_PATHS');
    expect(appModule).toContain('redact:');
  });
});
