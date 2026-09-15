import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

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
