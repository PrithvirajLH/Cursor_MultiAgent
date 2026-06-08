/**
 * Fail-fast environment validation, wired into ConfigModule.forRoot({ validate }).
 *
 * Throwing here aborts boot with a clear, actionable message instead of letting
 * the app start and then fail later with a cryptic error (e.g. Prisma's
 * "Environment variable not found: DATABASE_URL" on the first query, or — worse
 * — silently shipping the dev auth bypass to production).
 *
 * Keep this CONSERVATIVE: only assert what is genuinely required in every
 * environment, so it never blocks local dev or the test suite. Auth provider
 * vars (AZURE_*, AUTH_JWT_*) are intentionally NOT required here because dev and
 * test run with AUTH_ALLOW_INSECURE_HEADERS=true and have no Azure config.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];

  // Always required — the Prisma datasource reads env("DATABASE_URL").
  // In tests, test/setup-tests.ts derives it from TEST_DATABASE_URL before the
  // app module loads, so this still passes there.
  const dbUrl = config.DATABASE_URL;
  if (typeof dbUrl !== 'string' || dbUrl.trim() === '') {
    errors.push(
      'DATABASE_URL is required (the Postgres connection string).',
    );
  }

  const nodeEnv = config.NODE_ENV;
  if (
    nodeEnv != null &&
    !['development', 'test', 'production'].includes(String(nodeEnv))
  ) {
    errors.push(
      `NODE_ENV must be one of development | test | production (got "${String(nodeEnv)}").`,
    );
  }

  // Safety net: never let the development auth bypass run in production.
  const insecureAuth =
    String(config.AUTH_ALLOW_INSECURE_HEADERS ?? '').toLowerCase() === 'true';
  if (String(nodeEnv) === 'production' && insecureAuth) {
    errors.push(
      'AUTH_ALLOW_INSECURE_HEADERS must not be enabled when NODE_ENV=production — it bypasses authentication.',
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  - ${errors.join('\n  - ')}`,
    );
  }

  return config;
}
