# Implementation Prompt — 1.102, 1.103, 1.104, 1.101: four things that fail without telling you

**Date:** 2026-09-15
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** **1.102** (boot test) → **1.103** (the circular import) → **1.104**
(the audit probe) → **1.101** (the MCP server)

**Four cards, four commits. NO MIGRATIONS — the count stays at 66.**
Work straight through. Do not check in between them, and do not ask permission.

> ## One theme, and it is the one that has cost this project most
>
> **Every card here is something that breaks and says nothing.** The app that
> would not boot while every fast check passed. A circular import that bites the
> next person by position. An audit log that goes blank after one database blip.
> A server that has never worked.
>
> **Three of the four came out of card 2.6's own implementer reporting things
> they were not asked to fix.** That is the behaviour to keep.
>
> ⚠️ **Order matters: 1.102 first.** Without a boot test, 1.103 cannot be
> verified — you would be moving imports around with no way to know if you had
> broken or fixed anything.

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **NEW LANDMINE, READ IT:** two sessions share this **working tree**, not just
  the database. **Before trusting any red run:**
  `git status --porcelain | grep -v '^??'` — **if anything under `apps/` is
  modified and it is not yours, stop.** A full run was invalidated this way on
  2026-09-15, and a bisect cannot escape it because uncommitted changes survive
  `git checkout`.
- ⚠️ **Hold the WSL VM open** for every integration run:
  `wsl -d Ubuntu-22.04 -- sleep 2100` in the background.
- **NO MIGRATIONS.** Card 1.83 will take the next number.
- **Baseline to beat:** unit **754 / 75**, web **385 / 56**, integration
  **~947 + 1 skipped**, both typechecks clean, migrations **66**.

---

## 1 — Commit one: card 1.102, a boot test in the fast tier

**The app did not start, and `tsc` ×2, 738 unit tests, `check-migrations.sh` and
a full `nest build` all passed on top of it.**

✅ **Scope correction from the planner, and it makes this card smaller and
sharper:** the **integration suite DOES boot the real `AppModule`**
(`test/utils/test-app.ts:18`), so the suite was not blind. **The gap is that the
FAST tier is.** One minute of checks says "fine"; the thing that would have said
otherwise takes twenty, and every session here reasons from the fast tier first.

- [ ] **Add ONE unit-tier test that compiles `AppModule` and asserts it
      instantiates.** No database, no HTTP listener — `Test.createTestingModule({
      imports: [AppModule] }).compile()` is enough to catch a broken module graph.
- [ ] ⚠️ **If it needs a database connection to compile, say so and stop.** A
      boot test that needs Postgres belongs in the integration tier and does not
      close this gap. **Report what you found rather than forcing it.**
- [ ] ⚠️ **PROVE IT CATCHES THE REAL THING.** Move the three module imports back
      to the top of `app.module.ts`, watch the new test fail with the real error,
      then move them back. **A boot test that has never seen the failure it exists
      for is decoration.**

---

## 2 — Commit two: card 1.103, break the cycle

**ES modules evaluate in the order their `import` statements appear, not in the
order of the `imports` array.** Adding three modules near the top of
`app.module.ts` changed when `notifications.module.ts` began evaluating and
exposed a circular import that had been harmless only because of the previous
ordering.

✅ **Three hypotheses were already disproved for you** — removing the
tickets→webhooks edge, removing `ApiKeysService` from `auth.guard`, and removing
`NotificationsModule` from `WebhooksModule` all failed to fix it. **Do not
re-test those.**

- [ ] **Find the actual cycle.** `npx madge --circular --extensions ts apps/api/src`
      names it in seconds; the TypeScript compiler's own graph will too.
- [ ] **Break it properly** — usually by moving a shared type or constant into a
      leaf module that both sides import, rather than by reordering anything.
- [ ] ⚠️ **`forwardRef` is not a fix, it is the symptom's painkiller.** This
      codebase already has several (`TicketsService` alone has two). **If you add
      another, explain why the cycle cannot be broken instead.**
- [ ] **Then move the three imports back to the top of `app.module.ts`** where
      they naturally belong, and **delete the comment card 2.6 left at the import
      site** — it documents a constraint that should no longer exist.
- [ ] ⚠️ **Card 1.102's test is your verification.** If it does not fail before
      and pass after, you have not proved anything.

---

## 3 — Commit three: card 1.104, an audit log that goes blank quietly

`audit.service.ts:714` probes for the `AdminAuditEvent` table and **memoises the
answer in a field checked with `!== null` — computed exactly once per process —
and its `catch` sets it to `false`.**

**So one transient database error on the first probe turns the admin audit log
off for the life of the process, silently.** The three readers at `:269`, `:600`
and `:662` then behave as though the table does not exist: the page renders
empty, and nothing says why.

⚠️ **Card 1.95 made this worse by succeeding.** Five more services now write
audit rows, so a reader that silently reports none is a far bigger lie than when
only two did.

- [ ] **Do not cache a failure.** Cache `true` permanently; treat an error as
      *unknown* and retry on the next call.
- [ ] ⚠️ **Log it.** **An empty audit log and a broken audit log must not look the
      same** — that is the whole defect.
- [ ] ✅ **Consider deleting the probe entirely.** `AdminAuditEvent` has existed
      since migration `20260212163000`; the runtime check is legacy from when the
      table was optional. **If you delete it, say so** — it is the better fix and
      removes three call sites.
- [ ] ✅ **The WRITE side is already correct — do not touch it.** Card 1.95's
      `record()` rethrows inside a caller's transaction and logs outside one. That
      is right, and it is documented in the code.

### Tests

- [ ] **A probe failure does not permanently disable the reader** — the next call
      tries again.
- [ ] **A working table still reads normally.** Non-vacuity.

---

## 4 — Commit four: card 1.101, the MCP server

**Card 2.6's implementer reported that this is dead code in production:
`ts-node` is not shipped, and `create_ticket` there has never worked because no
user was ever set.**

- [ ] ⚠️ **Verify both claims before acting on either.** *"It cannot start in
      production"* is a strong statement and the fix depends on it. **Check
      whether anything in the deploy package can run it.**
- [ ] **If it is genuinely dead in production, the choice is the owner's** and
      there are two reasonable answers: **delete it**, or **keep it as local
      developer tooling and make that explicit** — move it out of `src/`, or gate
      it so it cannot be started by accident.
- [ ] ⚠️ **DO NOT silently delete it.** It takes a client-supplied `userId` with
      no session, which card 1.85 has just closed everywhere else — **so whichever
      way this goes, it should be a recorded decision, not a tidy-up.**
- [ ] **Fix or remove `create_ticket` either way.** A tool that has never worked
      is a lie in the tool list.

---

## 5 — What to report back

1. **Four commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, **migrations still 66**, and
   confirmation that **no file under `apps/api/prisma/migrations/` appears in any
   diff.**
3. The answers:
   - **1.102 —** ⚠️ **confirmation you watched the boot test FAIL on the real
     cycle**, and whether it needed a database.
   - **1.103 —** what the cycle actually was, and whether you had to add a
     `forwardRef`.
   - **1.104 —** whether you kept the probe or deleted it.
   - **1.101 —** whether it really cannot run in production, and what you
     recommend.
4. **For each card, the assertion that would fail if it regressed.**
5. Anything that did not match. **This document is wrong somewhere.**

## 6 — Browser pass

- [ ] **After 1.103:** open the app. ⚠️ **This card moves module imports around —
      the failure mode is the app not starting at all, which is exactly what the
      last one looked like.**
- [ ] **After 1.104:** open the audit log page and confirm it shows rows,
      including ones from the five services card 1.95 added.

**Stop and report instead of improvising** if the boot test needs a database, if
breaking the cycle would need a `forwardRef` you cannot justify, if deleting the
audit probe changes what the audit page shows, or if the MCP server turns out to
be reachable in production after all.
