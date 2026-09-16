import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';

/**
 * Card 1.102 — the application can actually be constructed.
 *
 * ⚠️ THIS EXISTS BECAUSE THE APP DID NOT BOOT AND EVERY FAST CHECK PASSED.
 * On 2026-09-15 `Nest cannot create the TicketsModule instance … index [1] …
 * is undefined` sat in the tree while two `tsc` runs, 738 unit tests,
 * `check-migrations.sh` and a full `nest build` all reported success. It was
 * found by opening a browser, twenty minutes later.
 *
 * ⚠️ THE INTEGRATION SUITE WAS NOT BLIND — `test/utils/test-app.ts` boots the
 * real AppModule, so it would have caught this. The gap is that the FAST tier
 * was blind, and every session here reasons from the fast tier first: a minute
 * of green checks reads as "safe to continue".
 *
 * ⚠️ NO DATABASE IS REQUIRED, AND THAT IS WHAT KEEPS THIS IN THE UNIT TIER.
 * `compile()` builds and instantiates the module graph but does NOT run
 * lifecycle hooks, and `PrismaService` connects in `onModuleInit` rather than
 * its constructor. A boot test that needed Postgres would belong in the
 * integration tier and would not close this gap at all.
 *
 * ⚠️ It has SEEN the failure it exists for: moving the three module imports back
 * to the top of `app.module.ts` makes this test fail with the real
 * UndefinedModuleException. A boot test that has never failed is decoration.
 */
describe('the application module graph can be constructed (card 1.102)', () => {
  // Constructing every provider in the app is slower than an ordinary unit
  // test, and far faster than discovering the same thing from a browser.
  jest.setTimeout(60_000);

  let AppModule: Type<unknown>;

  beforeAll(() => {
    // ⚠️ THIS TEST USED TO PASS OR FAIL ON THE CALLER'S SHELL, WHICH IS THE
    // one failure mode a boot test must not have. Jest sets NODE_ENV=test, so
    // `app.module.ts` loads `.env.test` - and `.env.test` deliberately defines
    // TEST_DATABASE_URL, never DATABASE_URL, because the integration tier must
    // not be able to point at the developer's real database by accident. So
    // `validateEnv` failed at import time with "DATABASE_URL is required"
    // unless the person running jest happened to have it exported. It passed
    // for five full runs on 2026-09-15 for exactly that reason, and failed on
    // 2026-09-16 in a shell without it, with no code change in between.
    //
    // ⚠️ SUPPLIED HERE RATHER THAN IN `.env.test`, DELIBERATELY. Adding
    // DATABASE_URL to that file would hand every integration suite a second,
    // higher-priority connection string, and `TEST_DATABASE_URL` vs
    // `DATABASE_URL` is already a documented landmine in this repo. This value
    // is never connected to: `compile()` builds the graph without running
    // lifecycle hooks, and `PrismaService` connects in `onModuleInit`.
    //
    // `??=` so a real environment still wins, and the import is dynamic so the
    // assignment happens BEFORE `ConfigModule.forRoot` evaluates - a top-level
    // `import` would be hoisted above it and change nothing.
    process.env.DATABASE_URL ??=
      'postgresql://boot-test:unused@127.0.0.1:5432/boot_test_never_connected';
    // `require`, not `await import`: this tsconfig is `module: nodenext`,
    // where a dynamic import needs an explicit .js extension. The package is
    // CommonJS, so this resolves exactly as the static imports around it do.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ AppModule } = require('./app.module') as { AppModule: Type<unknown> });
  });

  it('⚠️ AppModule compiles', async () => {
    // THE ASSERTION THAT WOULD HAVE CAUGHT IT. A circular import, a missing
    // provider, a module that resolves to `undefined` - all of them throw here
    // and none of them throw in `tsc` or `nest build`.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
