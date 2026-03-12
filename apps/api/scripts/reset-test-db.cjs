const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function loadEnv(envPath, env = process.env) {
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      env[key] = value;
    }
  }
}

function redactDatabaseUrl(databaseUrl) {
  return databaseUrl.replace(/:[^:@]+@/, ':***@');
}

function looksLikeTestTarget(value) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return /(^|[-_])(test|tests|testing|ci|spec)([-_]|$)/.test(normalized);
}

function parseDatabaseTarget(databaseUrl, label) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL.`);
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
    .trim()
    .toLowerCase();
  const schemaName = (parsed.searchParams.get('schema') ?? '')
    .trim()
    .toLowerCase();

  return {
    host: parsed.hostname.trim().toLowerCase(),
    databaseName,
    schemaName,
  };
}

function assertSafeTestTarget(databaseUrl, label) {
  const target = parseDatabaseTarget(databaseUrl, label);
  if (
    !looksLikeTestTarget(target.databaseName) &&
    !looksLikeTestTarget(target.schemaName)
  ) {
    throw new Error(
      `${label} must target a dedicated test database or schema. Use a database name like "*_test" or schema "test".`,
    );
  }
  return target;
}

function resolveTestDatabaseConfig(env = process.env) {
  const databaseUrl = env.TEST_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL not found in .env.test');
  }

  const directUrl = env.TEST_DIRECT_URL?.trim() || databaseUrl;
  const databaseTarget = assertSafeTestTarget(databaseUrl, 'TEST_DATABASE_URL');
  const directTarget = assertSafeTestTarget(directUrl, 'TEST_DIRECT_URL');
  const databaseSchema = databaseTarget.schemaName || 'public';
  const directSchema = directTarget.schemaName || 'public';

  if (
    databaseTarget.databaseName !== directTarget.databaseName ||
    databaseSchema !== directSchema
  ) {
    throw new Error(
      'TEST_DATABASE_URL and TEST_DIRECT_URL must point to the same database and schema.',
    );
  }

  return {
    databaseUrl,
    directUrl,
    databaseTarget,
  };
}

function getResetStrategy(env = process.env) {
  const strategy = env.TEST_DB_RESET_STRATEGY?.trim().toLowerCase();
  if (strategy === 'migrate' || strategy === 'push') {
    return strategy;
  }
  throw new Error(
    'TEST_DB_RESET_STRATEGY must be set to "migrate" or "push".',
  );
}

function run(command, root, env = process.env) {
  execSync(command, {
    cwd: root,
    stdio: 'inherit',
    env,
  });
}

function resetDb(root, env = process.env) {
  const strategy = getResetStrategy(env);
  if (strategy === 'migrate') {
    run('npx prisma migrate reset --force --skip-generate', root, env);
    return;
  }

  console.warn(
    'Using prisma db push --force-reset for test DB reset. This bypasses migration history checks.',
  );
  run('npx prisma db push --force-reset --skip-generate', root, env);
}

function main() {
  const root = path.resolve(__dirname, '..');
  const envPath = path.join(root, '.env.test');

  if (!fs.existsSync(envPath)) {
    throw new Error('Missing .env.test in apps/api');
  }

  loadEnv(envPath);
  process.env.NODE_ENV = 'test';
  process.env.SEED_MODE = 'test';

  const { databaseUrl, directUrl, databaseTarget } =
    resolveTestDatabaseConfig(process.env);
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = directUrl;

  console.log('Resetting test database...');
  console.log('Using TEST_DATABASE_URL:', redactDatabaseUrl(databaseUrl));
  if (directUrl !== databaseUrl) {
    console.log('Using TEST_DIRECT_URL:', redactDatabaseUrl(directUrl));
  }
  if (databaseTarget.host) {
    console.log(
      `Verified test target: database="${databaseTarget.databaseName}" schema="${databaseTarget.schemaName || 'public'}" host="${databaseTarget.host}"`,
    );
  }

  const mainEnvPath = path.join(root, '.env');
  const tempEnvPath = path.join(root, '.env.bak');
  let envRenamed = false;

  if (fs.existsSync(mainEnvPath)) {
    fs.renameSync(mainEnvPath, tempEnvPath);
    envRenamed = true;
  }

  try {
    resetDb(root, process.env);

    run('npx ts-node prisma/seed.ts', root, process.env);

    const clientPath = path.join(
      root,
      '..',
      '..',
      'node_modules',
      '.prisma',
      'client',
    );
    if (!fs.existsSync(clientPath)) {
      run('npx prisma generate', root, process.env);
    } else {
      console.log('Prisma client already exists, skipping generate.');
    }

    console.log('Test database reset complete.');
  } finally {
    if (envRenamed && fs.existsSync(tempEnvPath)) {
      fs.renameSync(tempEnvPath, mainEnvPath);
    }
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  assertSafeTestTarget,
  getResetStrategy,
  loadEnv,
  looksLikeTestTarget,
  main,
  parseDatabaseTarget,
  redactDatabaseUrl,
  resolveTestDatabaseConfig,
  resetDb,
};
