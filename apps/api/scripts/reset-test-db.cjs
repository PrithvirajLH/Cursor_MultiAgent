const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function loadEnv(envPath) {
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
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) {
      process.env[key] = value;
    }
  }
}

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env.test');

if (!fs.existsSync(envPath)) {
  console.error('Missing .env.test in apps/api');
  process.exit(1);
}

loadEnv(envPath);
process.env.NODE_ENV = 'test';
process.env.SEED_MODE = 'test';

// Verify DATABASE_URL is loaded
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not found in .env.test');
  process.exit(1);
}

console.log('Resetting test database...');
console.log('Using DATABASE_URL:', process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@'));

// Temporarily rename .env to prevent Prisma from auto-loading it
const mainEnvPath = path.join(root, '.env');
const tempEnvPath = path.join(root, '.env.bak');
let envRenamed = false;

if (fs.existsSync(mainEnvPath)) {
  fs.renameSync(mainEnvPath, tempEnvPath);
  envRenamed = true;
}

function run(command) {
  execSync(command, {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
}

function getResetStrategy() {
  const strategy = (process.env.TEST_DB_RESET_STRATEGY || 'auto').trim().toLowerCase();
  if (strategy === 'migrate' || strategy === 'push') {
    return strategy;
  }
  return 'auto';
}

function resetDb() {
  const strategy = getResetStrategy();
  if (strategy === 'migrate') {
    run('npx prisma migrate reset --force --skip-generate');
    return;
  }
  if (strategy === 'push') {
    run('npx prisma db push --force-reset --skip-generate');
    return;
  }

  try {
    run('npx prisma migrate reset --force --skip-generate');
  } catch {
    console.warn(
      'prisma migrate reset failed for test DB; falling back to prisma db push --force-reset.',
    );
    run('npx prisma db push --force-reset --skip-generate');
  }
}

try {
  resetDb();

  run('npx ts-node prisma/seed.ts');

  // Only regenerate if client doesn't exist (skip if dev server has it locked)
  const clientPath = path.join(root, '..', '..', 'node_modules', '.prisma', 'client');
  if (!fs.existsSync(clientPath)) {
    run('npx prisma generate');
  } else {
    console.log('Prisma client already exists, skipping generate.');
  }

  console.log('Test database reset complete.');
} finally {
  // Restore .env
  if (envRenamed && fs.existsSync(tempEnvPath)) {
    fs.renameSync(tempEnvPath, mainEnvPath);
  }
}
