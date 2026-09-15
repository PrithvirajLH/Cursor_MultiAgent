import { readFileSync } from 'fs';
import { join } from 'path';
import { Writable } from 'stream';
import pino from 'pino';
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

/**
 * Card 2.6 — `x-api-key` is a new credential in a header, so it must not reach
 * the log.
 *
 * ⚠️ THIS RUNS THE REAL REDACTION RATHER THAN READING THE LIST. The card is
 * explicit that the list is not the proof, and card 1.57 is why: the constant
 * above was correct for months while 2,064 bearer tokens went into the log,
 * because nothing checked that pino was actually applying it. Here a logger is
 * built with the same `redact` options app.module.ts passes, a request carrying
 * a key is logged, and the output is searched for the secret.
 */
describe('a presented API key never reaches the log (card 2.6)', () => {
  const KEY = 'tk_SUPER_SECRET_VALUE_THAT_MUST_NOT_APPEAR';

  /** Log one request through pino and hand back exactly what was written. */
  function logRequestWithKey(): string {
    let written = '';
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        written += String(chunk);
        callback();
      },
    });
    const logger = pino(
      {
        redact: { paths: [...LOG_REDACTION_PATHS], censor: '[redacted]' },
      },
      sink,
    );
    logger.info({
      req: {
        method: 'GET',
        url: '/api/tickets',
        headers: {
          host: 'localhost',
          'x-api-key': KEY,
          authorization: 'Bearer some.jwt.value',
        },
      },
    });
    return written;
  }

  it('⚠️ the key does not appear in the written log line', () => {
    // THE REGRESSION ASSERTION. Removing 'req.headers["x-api-key"]' from the
    // list makes this fail with the secret visible in the output.
    const output = logRequestWithKey();
    expect(output).not.toContain(KEY);
    expect(output).toContain('[redacted]');
  });

  it('the line is still written, so redaction did not silence the log', () => {
    // The non-vacuity half: a logger that wrote nothing would pass the test
    // above and destroy the request log.
    const output = logRequestWithKey();
    expect(output).toContain('/api/tickets');
    expect(output).toContain('x-api-key');
  });

  it('and the bearer token is still covered beside it', () => {
    expect(logRequestWithKey()).not.toContain('some.jwt.value');
  });
});
