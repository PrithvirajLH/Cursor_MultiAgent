const { execSync } = require('child_process');
const path = require('path');

const apiRoot = path.join(__dirname, '..');

execSync('npx prisma migrate reset --force', {
  stdio: 'inherit',
  cwd: apiRoot,
  env: {
    ...process.env,
    SEED_MODE: 'minimal'
  }
});

execSync('npx ts-node prisma/seed.ts', {
  stdio: 'inherit',
  cwd: apiRoot,
  env: {
    ...process.env,
    SEED_MODE: 'minimal'
  }
});
