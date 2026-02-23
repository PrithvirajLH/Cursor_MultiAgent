import { execSync } from 'child_process';
import path from 'path';

export function resetTestDb() {
  execSync('node scripts/reset-test-db.cjs', {
    cwd: path.join(__dirname, '..', '..'),
    stdio: 'inherit',
    env: process.env,
  });
}
