# Repo landmines

Traps in this repo that are **invisible from reading the code**. Every one cost
real time to discover between 2026-08-24 and 2026-08-25. Read this before
running anything.

Conventions for this repo live in **`.cursorrules`** (explicit types, no `any`,
JSDoc on public methods, one export per file, kebab-case filenames, no blank
lines inside functions). Monorepo: `apps/api` (NestJS + Prisma), `apps/web`
(Vite + React).

---

## Database and checks

- **Local Postgres runs inside WSL Ubuntu-22.04 on port 5433** — not Docker, not
  Windows. Timezone UTC, loopback `trust` auth, so `apps/api/.env.test` uses a
  **passwordless** URL. That is correct; do not "fix" it by adding a password.
  Start it with:
  ```bash
  wsl -d Ubuntu-22.04 -- sudo pg_ctlcluster 16 main start
  ```
  Do **not** set the server timezone to anything but UTC — two `tickets-misc`
  date-window tests fail on a non-UTC server.

- **Baseline as of 2026-09-02 (card 1.35): 416 unit (43 suites), 457
  integration + 1 skipped, 70 web unit (18 vitest files)**, both typechecks clean. Anything below
  that is a regression. State these numbers in any plan so regressions are obvious.

- **Azure App Service writes `X-Forwarded-For` as `ip:port`, and the source port
  changes on every new TCP connection.** Never key anything on it — caching,
  rate limiting, or (as card 1.19 did) an idempotency scope. The intake endpoint
  shipped with a mandatory `Idempotency-Key` that never replayed in production
  because the scope digest included that header: two connections, two tickets
  (2026-08-28). Anonymous callers are now scoped by their shared secret
  (`common/idempotency.interceptor.ts`, `SECRET_SCOPE_HEADERS`), and the network
  fallback strips the port via `common/strip-port.util.ts`. Rotating a secret
  deliberately invalidates that integration's in-flight keys.

- **Automation rules use first-match semantics, and `subject contains` is a
  substring test.** In integration specs, give every rule a token no other
  rule's token is a prefix of (`ACT4` swallowed `ACT4B` on 2026-08-27 and the
  second rule never ran). Ticket creation enqueues `TICKET_CREATED`
  fire-and-forget after the POST returns, so specs must poll for the
  `AutomationExecution` row rather than assert straight after the request.

- **A background integration run that hits the harness's 10-minute wrapper limit
  is reported "killed" but jest keeps running.** The kill takes the in-flight
  `reset-test-db.cjs` child with it, so every later suite fails with
  `Command failed: node scripts/reset-test-db.cjs` (seen 2026-08-27: 30 green
  suites, then 13 red ones with no other cause). Kill the orphan jest, check
  `.env` is back, and re-run detached (e.g. PowerShell `Start-Process`) with a
  monitor on the log instead of a foreground/background wrapper with a timeout.

- **The consent variable is required for integration runs.** Every integration
  suite re-runs a database reset in its own `beforeAll`, so export it for the
  whole jest run, not just the first command:
  ```bash
  export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
  ```

- **The integration run finishes its tests but often never exits** (an open
  handle). Observed three times, with orphans surviving hours at flat CPU. If the
  command is piped through `grep`/`tail`, the pipe never closes and **the results
  are never printed** — it looks hung when it actually passed. Redirect straight
  to a file (`> out.txt 2>&1`), read the summary from there, then kill it.

- **Never edit source while an integration suite is running.** Each suite resets
  the database and reloads modules; a mid-run edit produced 81 phantom failures
  unrelated to the change. A full run takes about 6 minutes. Wait.

- **Never run two integration suites at once.** They share one test database;
  two concurrent `npm run test:integration` chains produced 111 and then 55
  phantom "500" failures on 2026-08-26. A background task the harness reports as
  "killed" can leave its npm chain alive — check for repo node processes
  (below) before starting a run, and kill the chain, not just the shell.

- **`scripts/reset-test-db.cjs` renames `apps/api/.env` → `.env.bak` around every
  suite reset** (lines ~179/205) so Prisma cannot pick up the dev URL. A run
  killed mid-reset strands the file as `.env.bak` — rename it back. While a suite
  is running, anything else that reads `.env` (a dev server, `migrate deploy`, a
  Prisma one-off) intermittently sees "no such file". Do not run those alongside
  the suite.

- **The dev (Supabase) database silently falls behind production.** On 2026-08-26
  it was two migrations behind since 08-24 and the dev app was failing on missing
  columns. Every deploy that carries a migration must also run
  `npx prisma migrate deploy` from `apps/api` with the normal `.env` (Prisma uses
  `DIRECT_URL`, port 5432, for migrations) — dev first, then production.

- **Ports 3000 and 3001 are often taken by other local projects** (an "lms" API
  and an "LRS Console" dev server were seen). Manual API checks may need
  `PORT=3077` or similar; the web dev server proxy target must match.

---

## Prisma

- **`prisma migrate dev` emits destructive drift.** Every run generates
  `DROP INDEX` for six trigram GIN indexes (created by
  `20260220150000_add_ticket_search_trigram_indexes` and
  `20260528_add_knowledge_base`) plus several `ALTER COLUMN … DROP DEFAULT`.
  Prisma cannot express `USING GIN (col gin_trgm_ops)` in `schema.prisma`, so it
  sees them as drift forever. Applying one unedited **destroys ticket and KB
  search performance** against a stated sub-500ms requirement.

  Hand-strip every generated migration to additive statements only, with a header
  comment explaining why. Pattern:
  `prisma/migrations/20260824211443_ai_observability_and_department_confidence/migration.sql`.
  Verify:
  ```bash
  grep -cE '^(DROP|ALTER TABLE .* DROP)' <migration>.sql   # must be 0
  ```
  CI runs this as `scripts/check-migrations.sh` on every new migration; an
  intentional drop needs a first-line `-- allow-drop: <reason>` (first use:
  `20260826180000_soft_delete_and_fk_restrict`, an FK action change). The
  migration count is **52** as of 2026-09-01
  (`20260901180000_email_suppression`, card 1.23, one new table); `prisma
  migrate status` against any environment should report exactly that. That 52nd
  was hand-written from `prisma migrate diff`, which emitted **twelve**
  destructive statements, all removed: the six trigram DROP INDEXes plus six
  `ALTER COLUMN ... DROP DEFAULT`. An `ALTER TYPE … ADD VALUE` migration
  applies cleanly through `migrate deploy` on PostgreSQL 16 — but the new value
  cannot be *used* in the same transaction that adds it, so never combine one
  with a backfill in a single migration file.

- **`scripts/check-migrations.sh` only sees migrations that are already
  committed**, so running it before you commit tells you nothing. Line 39 is
  `git diff --name-only --diff-filter=A "$base...HEAD"` — files added *in
  commits*. An uncommitted migration is not in that list, so the script exits 0
  having checked nothing, which reads exactly like a pass. Found by the 1.23
  implementer, whose file was invisible to it on the first run.

  So the order is: commit the migration, **then** run the checker. If it prints
  no `ok <path>` line naming your file, it did not look at it.

- **`prisma migrate dev` cannot run non-interactively at all** — it aborts with
  "Prisma Migrate has detected that the environment is non-interactive", even with
  `--create-only`, because a warning needs a prompt. Working recipe: use
  `prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma
  --script` to see the SQL, hand-write the migration folder (timestamp must sort
  after the last one), then apply with `prisma migrate deploy`.

- **Never generate migrations against `.env`.** Its `DATABASE_URL` points at
  **Supabase**, through the pgBouncer transaction pooler on **6543**, which cannot
  run migrations at all. Read `TEST_DATABASE_URL` from `.env.test` and set both
  `DATABASE_URL` and `DIRECT_URL` to it for the command.

- **The test harness reads `TEST_DATABASE_URL`, not `DATABASE_URL`.** Both
  `test/setup-tests.ts:35` and `scripts/reset-test-db.cjs:88` require it with **no
  fallback**. Writing `DATABASE_URL` into `.env.test` fails with
  "TEST_DATABASE_URL not found in .env.test" before anything else happens. This
  bug sat in the CI spec for three months.

- **`reset-test-db.cjs` refuses non-test targets.** The database name or schema
  must match `/(^|[-_])(test|tests|testing|ci|spec)([-_]|$)/`. Database
  `postgres` + schema `public` is rejected. `TEST_DB_RESET_ACK_HOST` is an escape
  hatch for managed databases that cannot be renamed — do not use it to silence a
  guard you can satisfy by naming the database `ticketing_test`.

- **The test database seeds only 2 teams** (`it-service-desk`, `hr`), not the 5
  from `seedDev`. Anything needing the full department set must run the dev seed
  and then restore fixtures:
  ```bash
  NODE_ENV=development SEED_MODE=dev npx ts-node prisma/seed.ts
  npm run test:db:reset   # restores fixtures
  ```

- **`Ticket.assignedTeam` and `Ticket.category` are `onDelete: Restrict`** (since
  `20260826180000_soft_delete_and_fk_restrict`): deleting a Team or Category
  that still has tickets is refused by the database, and `DELETE
  /api/categories/:id` answers 400 "Deactivate it instead". Before that
  migration both relations defaulted to `SetNull` and silently un-assigned /
  un-classified tickets. **Soft delete exists for two models only:**
  `Ticket.deletedAt`/`deletedById` and `KbArticle.deletedAt`. The ticket filter
  lives in `AccessControlService` (`buildTicketAccessFilter` /
  `accessConditionSql` add `deletedAt IS NULL` unless an OWNER passes
  `includeDeleted`); any new ticket query that bypasses the chokepoint must add
  `deletedAt: null` itself. Purging is the `RetentionService` job, off and
  dry-run by default.

- **`prisma generate` fails with `EPERM`** whenever a node process holds
  `query_engine-windows.dll.node` — a dev server, or an orphaned jest run. See
  "Windows process hygiene" below.

---

## A status transition can lose inbound mail

Found 2026-09-03 while building card 1.29, and it was in a planner handoff as an
unconditional instruction.

**`IN_PROGRESS` requires an assignee** (`transitionRequiresAssignee`, enforced at
`tickets.service.ts:2607`) **and it is the only non-pause transition out of
`WAITING_ON_REQUESTER`.** So a waiting ticket with no assignee has nowhere legal
to go.

That state is reachable, not theoretical: `normalizeStatusAfterTransfer` demotes
**only** `ASSIGNED` and `IN_PROGRESS` when a team transfer clears the assignee, so
**transferring a waiting ticket leaves it waiting *and* unassigned.**

The trap is what a throw costs in the inbound path. `InboundEmailService` sets
`persistedMutation` only once `addMessage` has run; before that, its `catch` calls
`releaseInboundEmailReceipt` and rethrows (`inbound-email.service.ts:338-348`). So
a status transition attempted **before** the message is stored turns into:

1. `BadRequestException` -> 5xx to the sender,
2. the idempotency reservation **released**, so the retry is treated as fresh,
3. the retry hits the identical state and throws again - forever,
4. **the requester's reply is never stored.** Lost mail, not delayed mail.

**A second way the same shape bites, found 2026-09-03.** `TicketsService.addMessage`
**refuses a reply from anyone who is not the ticket's requester**, and an inbound
sender is provisioned as an `EMPLOYEE` — so a looped-in third party's reply
answers **403**. With a status transition running *before* `addMessage`, that 403
left the ticket already moved on the strength of a message that was then thrown
away: the queue said somebody had answered when the answer had been refused. The
`REOPENED` path had the same shape before card 1.29 existed, so a refused reply to
a `RESOLVED` ticket reopened it and then failed.

**Store the message first, then derive status from it.** A status derived from a
message must not outlive the message.

**And note where the safety net sits.** `persistedMutation` is assigned *after*
the transition block and after `recordInboundSuppression`, not immediately after
`addMessage`. So a throw in either still releases the idempotency reservation
while the message is already stored — and the retry adds a **duplicate** copy.
If you touch this path, set `persistedMutation` the moment the message is durable.

**Rules.** Attempt a status transition in the inbound path only after checking the
target is legal for that ticket's shape, and prefer **skipping the transition and
keeping the message** over attempting it. Derive queue signals from **messages**
rather than status where you can - card 1.29's "awaiting reply" marker is derived
exactly so that it stays truthful on the tickets whose status cannot move.

---

## Windows process hygiene

Orphaned `node` processes from this repo have broken builds and test runs
repeatedly. Before building or deploying:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*Ticketing System Quality Review*' } |
  Select-Object ProcessId, CommandLine
# then Stop-Process -Id <each> -Force
```

**This filter silently misses a process started with a relative path.** A dev
server launched from inside the repo as `node dist/src/main.js` has exactly that
as its `CommandLine` — the repo path never appears in it, so the filter returns
nothing and the process looks absent while it still holds the Prisma engine DLL
and the port. It cost an implementer a chase on 2026-09-02. **Kill by listening
port when you know the port**, and treat an empty result from the filter above as
"maybe", never as "clear":

```powershell
# What is actually holding the port, regardless of how it was launched
foreach ($p in 3000, 3077, 5173) {
  Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Get-Process -Id $_.OwningProcess } |
    Select-Object Id, ProcessName, Path
}
```

The inverse mistake is worse: a **broad** `node.exe` filter with no scoping took
down an unrelated dev server on 2026-09-02. Scope by port, or by the repo path
*and* the port — never by `node.exe` alone.

To tell a live run from an orphan, compare CPU-seconds a few seconds apart: a
real run burns CPU, an orphan is flat.

---

## Running the stack by hand for a browser pass

Both of these cost an implementer time on 2026-09-03, and neither is guessable.

- **The API needs `AUTH_ALLOW_INSECURE_HEADERS=true`** or every request answers
  **401 `Bearer token is required`**. The dev persona works by sending
  `x-user-email` (`apps/web/src/api/client.ts:558`), and the guard refuses that
  header unless this is set. Nothing in the failure names the missing variable.

- **Vite may not pick `VITE_E2E_MODE` up from the shell.** It was passed as
  `VITE_E2E_MODE=true npx vite` and did not reach `import.meta.env`; an
  `apps/web/.env.local` worked. Vite normally does expose `VITE_`-prefixed process
  env, so the likely culprit is the npx shim under Git Bash on Windows rather than
  Vite itself — but the fix is the file. **`apps/web/.env.local` is gitignored**
  (`apps/web/.gitignore:13`, `*.local`), so it is safe to create and easy to leave
  behind. Delete it when you are done.

  Note the persona itself does **not** need E2E mode: `localStorage.demoUserEmail`
  plus the `x-user-email` header is enough for most passes, which is why this can
  go unnoticed until something reads `import.meta.env.VITE_E2E_MODE`.

- **Setting `localStorage.demoUserEmail` directly bypasses `setDemoUserEmail`**,
  which is what clears the API GET cache and the search cache on a persona change
  (`client.ts:487-494`). Set it, then **reload** — otherwise the page serves the
  previous persona's data and you chase a bug that is not there.

---

## The API runs from `dist`, the web runs from source

**A manual pass can verify code that is not running.** Found by the 1.27
implementer on 2026-09-01, who tested against a stale build and had three
acceptance criteria fail for that reason alone.

Vite serves `apps/web` **from source** — save a file, the browser has it. The API
does not. Every script runs the compiled output:

| Script | What it runs | Picks up a source edit? |
|---|---|---|
| `npm run dev` / `start:dev` | `nest start --watch` → compiles to `dist`, runs `dist` | **Only while the watcher is alive** |
| `npm start` / `start:prod` | `node dist/src/main.js` | **Never** |

So the trap is not "the API ignores edits" — a healthy watcher recompiles fine.
The trap is that **nothing tells you when the watcher has stopped**, and it
stops more often than you would expect: after a compile error it can wedge, and
it does not survive a branch switch or a `git checkout` cleanly.

Before trusting a manual pass against the API:

1. Watch the API log for the recompile line after your edit. No line, no rebuild.
2. If in doubt, stop it and run `npx nest build` (or restart `npm run dev`) and
   wait for it to finish before testing.
3. If a change you are certain about appears to have no effect, **suspect the
   build before you suspect the code.**

Jest and the integration suite compile from source through `ts-jest`, so they are
**not** affected — a green test run says nothing about whether the dev server is
current.

---

## Tests and AI configuration

- **`test/setup-tests.ts` blanks (sets to `''`, not `delete`) every `AZURE_*`,
  `SMTP_*` and `HEALTH_READY_TOKEN` key after forcing the dev `.env` load, so
  integration runs are hermetic on every machine; only `ai-intake-live.spec`
  (opt-in via `AI_LIVE_TEST_ENABLED`) reloads real credentials.** Blank, not
  delete, because `new PrismaClient()` — which runs inside Nest DI, *after* the
  setup file — re-reads the dev `.env` and re-fills any key that is `undefined`
  at that moment, but leaves a present-but-empty key alone. Before this
  (2026-08-26) attachment and realtime specs on a developer machine silently hit
  the real Blob container and Web PubSub hub. The AI pipeline throws on the first agent call and returns
  an error envelope rather than a 5xx; existing AI tests assert only the HTTP
  contract. Tests needing a live model load credentials from `.env` and are gated
  behind `AI_LIVE_TEST_ENABLED` / `AI_BENCHMARK_ENABLED`, neither of which runs
  in CI.

- **`AI_INLINE_PROMPTS` defaults to true:** prompts and tool definitions come from
  `src/ai/prompts/*.ts` in-repo, not from Azure Foundry agents. Those files were
  orphaned before and are now live code. The `*_AGENT_ID` env vars are unused
  unless `AI_INLINE_PROMPTS=false`.

- **`npm run lint` runs eslint with `--fix`.** It repairs roughly 269
  auto-fixable violations and exits 0, so it is a formatter, not a gate. A lint
  step that passes proves very little here.

---

## Playwright / E2E

- **Playwright needs `VITE_E2E_MODE=true`, which only its own webServer sets.**
  `reuseExistingServer` is on outside CI, so a dev server left running from
  `npm run dev -w apps/web` gets reused, `isE2EMode` is false, the `demoUserEmail`
  persona path is skipped, and every authenticated spec fails on auth. Free port
  5173 first.

- The Playwright webServer also runs `prisma migrate reset`, so
  `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` must be exported for
  `npx playwright test` too, not just jest.

- **Playwright and the integration suite both own the test database.** Never run
  them concurrently.

- **Do not read focus styles immediately after `page.keyboard.press('Tab')`.** The
  app animates over ~150ms, so `outline-width` reads 0–1px mid-transition and
  looks like a missing focus ring. Wait ~350ms before reading computed styles, or
  you will report a defect that does not exist. This nearly produced a false
  finding in the accessibility audit.

---

## Repo layout and tooling

- **`.gitignore` history matters.** `docs/`, `.github/`, `e2e/` and `update/` were
  excluded wholesale by commit `7f221d2` (May 2026) and re-included on
  2026-08-25. While excluded, **CI could not exist** — `.github/workflows/ci.yml`
  had never run, which is why it contained three fatal defects nobody found.
  `.claude/` is still gitignored, so anything placed there is local-only.

- **`npm audit` cannot separate production from dev dependencies here, and
  neither can `npm query`.** `npm audit --omit=dev` returns an identical count
  (the flag is inert under workspace hoisting). `npm query ".prod"` is closer but
  counts a satisfied `peerDependencies` edge as production, which drags
  devDependency `tailwindcss`/`postcss`/`autoprefixer` in via
  `tailwindcss-animate`. The only correct method is traversing
  `package-lock.json` from the `dependencies` of `apps/api` and `apps/web`,
  following only `dependencies`/`optionalDependencies`. Validated by the
  Dockerfile, which runs `npm prune --omit=dev`. See
  `docs/security-audit-2026-08.md`.

- **`npm audit fix` without `--force` still crosses major boundaries
  transitively** — it moved `msgpackr` 1.11.5 → 2.0.5 under bullmq and downgraded
  `cluster-key-slot`. "No `--force`" constrains declared ranges, not transitive
  resolution.

- **The MCP SDK ships but never loads.** `@modelcontextprotocol/sdk` is a
  production dependency, but the container's `CMD` is `node dist/src/main.js`, the
  MCP server is a separate `ts-node` script, and `ts-node` is pruned. Advisories
  reachable only through it are in the image but not in the running process.

- **No `postinstall` hook, and `@prisma/client` cannot find
  `apps/api/prisma/schema.prisma` from the hoisted root** — so `npm ci` leaves the
  Prisma client ungenerated while the tests import from it. Any CI job must run
  `npm run -w apps/api db:generate` explicitly after `npm ci`.

---

## Deployment and production

**Deployment has its own runbook: [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md).** Read
it rather than rediscovering. The highlights:

- **`deploy-to-azure.ps1` cannot deploy the current ~169 MB package.** Its
  synchronous Kudu POST returns `502 Bad Gateway` and leaves a permanently
  incomplete deployment record. **A 502 means "you don't know", not "it failed".**
  Check `az webapp log deployment list` before doing anything else. Use
  `az webapp deploy --async` instead.

- **Every URL on production returns 401** because Easy Auth is enabled with
  `RedirectToLoginPage`. That is true before and after a deploy; it is not a
  deployment signal. Verify deploys through the Kudu VFS API, which bypasses Easy
  Auth, by matching served asset hashes against the local build.

- **Migrations run before the app**, and only stay safe while they are additive
  (old code ignores new columns).

- **Production state as of 2026-08-25:** App Service `TicketTicket` (RG
  `csnhc-ai`) runs commit `458543a`. Both
  `20260824211443_ai_observability_and_department_confidence` and
  `20260825120000_per_department_business_hours` are applied.
  `SCM_DO_BUILD_DURING_DEPLOYMENT` and `ENABLE_ORYX_BUILD` are now explicitly
  `false`, and `DEPLOYED_COMMIT_SHA` records what is running.

- **`scripts/merge-hr-teams.sql` has still not been run.** It is a one-time data
  migration, deliberately manual, and needs a dry run first.

- **Azure Pipelines cannot run.** `azure-pipelines.yml` exists (phase 1: verify +
  integration) but the Azure DevOps org has **no hosted parallelism grant**, which
  needs a purchase or a support request. Until then nothing gates a deploy except
  running the checks by hand. The fixed `.github/workflows/ci.yml` can run on the
  public GitHub remotes if automated checks are wanted sooner — but note those
  remotes are **public**, and `docs/security-audit-2026-08.md` describes live
  weaknesses.

## A killed integration run can leave `apps/api/.env` renamed

`scripts/reset-test-db.cjs:174-182` renames **`apps/api/.env` → `apps/api/.env.bak`**
for the duration of the database reset, so the reset cannot pick up the dev
`DATABASE_URL` by accident. It renames it back in a `finally`.

That `finally` does not run if the process is **hard-killed** — which is exactly
what happens when a background integration run is stopped mid-flight, something
this repo's own notes record happening more than once. The result is a working
tree with **no `apps/api/.env` at all**: the dev API then starts with no
database, no Azure credentials and no secrets, and every symptom points
somewhere other than the real cause.

- **If the API suddenly cannot find anything, look for `apps/api/.env.bak` first.**
  Renaming it back to `.env` is the whole fix.
- `.env.bak` is the **live config**, not a stale copy — do not delete it, and do
  not commit it.
- Verified 2026-09-08: a completed run restores the file (3241 bytes, and
  `.env.bak` gone). The hazard is only the killed run.

## Report queries do not all exclude soft-deleted tickets

`reports.service.ts:199-201` carries this comment:

```
// Soft-deleted tickets never count in reports (the raw-SQL reports get
// this from accessConditionSql; the groupBy reports come through here).
```

**The first half is false.** `AccessControlService.accessConditionSql` does add
`deletedAt IS NULL` (`access-control.service.ts:130-134`) — but
`reports.service.ts` **never calls it.** Reports scope through
`scopeReportQuery` behind `LeadOrAdminGuard` instead, and only the Prisma
`where` path (`:201`) filters `deletedAt`.

Of the file's 23 `$queryRaw` reports, exactly **three** filter it — the three
added by card 1.17 (`:1614`, `:1669`, `:1733`). **The rest have counted deleted
tickets since they were written.** Found by the card 1.17 implementer, 2026-09-08.

- The practical impact tracks how many tickets have ever been soft-deleted, so
  it is small today and grows quietly.
- **Do not "fix" this by pointing reports at `accessConditionSql`** — that
  fragment also applies role/team visibility, which `scopeReportQuery` already
  does differently, and layering the two would silently change who sees what.
  Add the `deletedAt` clause to each raw report.

## Production carries one permanently "failed" migration row. Leave it alone.

`_prisma_migrations` in **production** has a row for
`20260220150000_add_ticket_search_trigram_indexes` with:

```
finished_at         NULL
rolled_back_at      2026-05-01T16:06:49Z
applied_steps_count 0
logs                "A migration failed to apply..."  Database error code: 0A000
```

**This is settled state, not a pending failure.** Someone resolved it in May with
`prisma migrate resolve --rolled-back`, and Prisma treats a row with
`rolled_back_at` set as dealt with — which is why migrations 51 through 57 have
all deployed cleanly since. **All six trigram indexes exist** (verified
2026-09-08); they are simply not owned by that migration any more.

- ⚠️ **Never run `prisma migrate resolve --applied` on it.** That would assert a
  migration ran which did not, and the next `migrate dev` would diff against a
  false baseline.
- ⚠️ **Do not report it as a deploy blocker.** Only a row with **neither**
  `finished_at` **nor** `rolled_back_at` triggers P3009 and stops
  `migrate deploy`. A check that filters on `finished_at IS NULL` alone will cry
  wolf every single time — the planner did exactly that on 2026-09-08.
- `apps/api/prod-migration-count.mjs` (read-only) reports the count, the genuinely
  blocking rows, this known row separately, and the trigram index count. Run it
  from `apps/api` so `@prisma/client` resolves. It needs the current IP on the
  database firewall.

## A "killed" background integration run is often still running

Discovered the hard way on 2026-09-09, after two runs reported failures that
were not real.

When a background integration run is stopped — a tool timeout, a harness
`killed` status, an interrupt — **the jest child processes frequently survive.**
The wrapper reports the task as stopped; `jest` keeps going, keeps resetting the
test database in each suite's `beforeAll`, and keeps holding connections.

Start a second run on top of that and the two fight over one database. On
2026-09-09 that produced `security.rate-limit.spec.ts` failing after **150 s**
and `tickets.inbound-email.spec.ts` failing — **both phantoms.** A clean run
straight afterwards was 699 passed + 1 skipped, 69 of 70, with neither failing.
This is the same hazard as the "81 phantom failures" note above, reached by a
different route.

- **Before starting any integration run, check for surviving jest processes** and
  kill them. A harness saying the task is dead is not evidence:
  ```
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*jest*' }
  ```
- **Never trust a failure from a run that overlapped another.** Re-run clean
  before believing, and never report such a failure as real.
- A full clean run is now about **13 minutes** (69 suites), up from ~6–10.

## Stale node processes make each suite's reset fail with exit 127

Same day, and the cause of three truncated runs before the overlap was noticed.

Every integration suite resets the database in its own `beforeAll`, and each
reset **spawns `npx` two or three times**. With enough stale node processes
holding handles, those spawns start failing and `jest` exits **127** — after a
variable number of suites (0, 24, then 21), with **no error message and no
summary line**, which reads like a hang rather than a failure.

On 2026-09-09 the machine had **eighteen node processes a week old** (from
09-02, mostly abandoned MCP servers) plus a stray API server. Clearing anything
created before today fixed it immediately.

- **Exit 127 with no summary means spawn failure, not a test failure.** Do not
  go looking for a broken test.
- ⚠️ **Killing week-old node processes can take MCP servers with it** — the
  Playwright MCP server went down that way, and it does not come back without
  restarting the session. Check what you are killing if browser tooling matters
  for the next step.
- The repo-scoped filter misses a server started with a **relative** path
  (`dist/src/main.js`), which is the trap already recorded above.
