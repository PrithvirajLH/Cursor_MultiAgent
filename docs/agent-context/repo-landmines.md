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

- **Baseline as of 2026-08-26: 196 unit (25 suites), 362 integration + 1 skipped,
  36 web unit (13 vitest files)**, both typechecks clean. Anything below that is a
  regression. State these numbers in any plan so regressions are obvious.

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

- **`Ticket.assignedTeam` is an optional relation with no explicit `onDelete`,**
  so Prisma defaults to `SetNull`: deleting a Team silently unassigns every ticket
  that referenced it, with no error. This schema has no soft delete anywhere.

- **`prisma generate` fails with `EPERM`** whenever a node process holds
  `query_engine-windows.dll.node` — a dev server, or an orphaned jest run. See
  "Windows process hygiene" below.

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

To tell a live run from an orphan, compare CPU-seconds a few seconds apart: a
real run burns CPU, an orphan is flat.

---

## Tests and AI configuration

- **`test/setup-tests.ts` deletes every `AZURE_*`, `SMTP_*` and `HEALTH_READY_TOKEN`
  key after forcing the dev `.env` load, so integration runs are hermetic on every
  machine; only `ai-intake-live.spec` (opt-in via `AI_LIVE_TEST_ENABLED`) reloads
  real credentials.** The AI pipeline throws on the first agent call and returns
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
