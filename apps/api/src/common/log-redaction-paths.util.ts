/**
 * Request/response fields the HTTP logger must never write out (card 1.54).
 *
 * ⚠️ FOUND BY THE BROWSER PASS FOR CARD 1.54, AND OLDER THAN THAT CARD.
 * `pinoHttp` was configured with a level and a transport and nothing else, so
 * pino's default request serializer logged **every** request header. That put a
 * live `Authorization: Bearer <id_token>` on every authenticated request in a
 * log that ships to Kudu:
 *
 *     AUTH_REJECT reason="Token expired" … {"req":{…,"headers":{…,
 *       "authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXV…
 *
 * The irony is exact: card 1.54 forbids the auth guard from logging the token,
 * and the guard does not — the line beside it did.
 *
 * The three `x-*-secret` headers are the shared secrets from
 * `idempotency.interceptor.ts`'s `SECRET_SCOPE_HEADERS`. `POST /api/tickets/intake`
 * is live in production with a secret set, so every Power Automate call was
 * printing it. ⚠️ **Keep this list in step with that one** — a new anonymous
 * integration header is a new credential in the log.
 *
 * `censor` is a fixed string rather than removal so the log still shows that a
 * credential was present, which is what tells you an unauthenticated caller
 * differed from one whose secret was wrong.
 */
export const LOG_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-intake-secret"]',
  'req.headers["x-inbound-email-secret"]',
  'req.headers["x-attachment-scan-secret"]',
  'res.headers["set-cookie"]',
] as const;
