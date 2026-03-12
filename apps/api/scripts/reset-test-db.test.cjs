const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getResetStrategy,
  resolveTestDatabaseConfig,
} = require('./reset-test-db.cjs');

test('resolveTestDatabaseConfig requires TEST_DATABASE_URL', () => {
  assert.throws(
    () =>
      resolveTestDatabaseConfig({
        DATABASE_URL:
          'postgresql://postgres:secret@localhost:5432/ticketing_test?schema=test',
      }),
    /TEST_DATABASE_URL not found/,
  );
});

test('resolveTestDatabaseConfig rejects non-test database targets', () => {
  assert.throws(
    () =>
      resolveTestDatabaseConfig({
        TEST_DATABASE_URL:
          'postgresql://postgres:secret@db.example.com:5432/postgres?schema=public',
        TEST_DIRECT_URL:
          'postgresql://postgres:secret@db.example.com:5432/postgres?schema=public',
      }),
    /dedicated test database or schema/,
  );
});

test('resolveTestDatabaseConfig accepts dedicated test URLs and falls back TEST_DIRECT_URL', () => {
  const config = resolveTestDatabaseConfig({
    TEST_DATABASE_URL:
      'postgresql://postgres:secret@db.example.com:5432/ticketing_test?schema=test',
  });

  assert.equal(
    config.databaseUrl,
    'postgresql://postgres:secret@db.example.com:5432/ticketing_test?schema=test',
  );
  assert.equal(config.directUrl, config.databaseUrl);
  assert.equal(config.databaseTarget.databaseName, 'ticketing_test');
  assert.equal(config.databaseTarget.schemaName, 'test');
});

test('getResetStrategy requires an explicit valid value', () => {
  assert.throws(() => getResetStrategy({}), /TEST_DB_RESET_STRATEGY/);
  assert.equal(getResetStrategy({ TEST_DB_RESET_STRATEGY: 'migrate' }), 'migrate');
  assert.equal(getResetStrategy({ TEST_DB_RESET_STRATEGY: 'push' }), 'push');
  assert.throws(
    () => getResetStrategy({ TEST_DB_RESET_STRATEGY: 'drop' }),
    /must be set to "migrate" or "push"/,
  );
});
