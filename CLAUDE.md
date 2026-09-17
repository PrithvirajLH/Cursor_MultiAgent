# CLAUDE.md

Session bootstrap for this repo. Read the two starred files before running
anything — they contain things you cannot infer from the code and that have each
already cost a day.

## What this is

A universal ticketing platform for a healthcare organisation — an existing,
working implementation. **npm workspace monorepo:**

- `apps/api` — NestJS + Prisma over PostgreSQL
- `apps/web` — Vite + React + Tailwind

Conventions live in **`.cursorrules`**: explicit types, no `any`, JSDoc on public
methods, one export per file, kebab-case filenames, no blank lines inside
functions. There is no AGENTS.md here; `.cursorrules` is it.

## Read these first

| File | Why |
|---|---|
| ⭐ **[`docs/agent-context/repo-landmines.md`](docs/agent-context/repo-landmines.md)** | The traps. WSL Postgres on 5433, the Prisma migration drift that silently destroys search performance, the consent env var, orphaned jest processes that break builds, `TEST_DATABASE_URL` vs `DATABASE_URL`. **Read before running tests or migrations.** |
| ⭐ **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** | The deploy runbook. `deploy-to-azure.ps1` **cannot** deploy the current package — read this before touching production. |
| [`docs/agent-context/working-agreement.md`](docs/agent-context/working-agreement.md) | Planning session vs implementer session, and what a plan must contain. |
| [`docs/agent-context/skills-and-references.md`](docs/agent-context/skills-and-references.md) | Where the `atm-*` skills came from, which ADRs the plans cite, and what was deliberately *not* copied here. |

## Baseline — do not regress these

**916 unit tests (94 suites), 1003 integration + 1 skipped (100 of 101 suites), 480 web unit tests (67 files)** — **68 migrations.**

✅ **Measured 2026-09-17 on a clean tree**, after cards 1.132, 1.137 and 1.139. ⚠️ **Check the tree is yours before trusting any run:** `git status --porcelain | grep -v '^??'`. A full run was invalidated on 2026-09-15 by another session's uncommitted `main.ts`.

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
cd apps/api && npx jest                       # 916, 94 suites
cd apps/web && npx vitest run                 # 480, 67 files

export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
cd apps/api && npm run test:integration -- --workerIdleMemoryLimit=1G
# 1003 + 1 skipped, 100 of 101 suites. ⚠️ 19-30 MINUTES, and the spread is real:
# two runs on 2026-09-17 took 1153s and 1771s on the same tree.
# ⚠️ Without --workerIdleMemoryLimit=1G the run is OOM-killed part way through.
# ⚠️ Exceeds the 10-minute Bash cap - it CANNOT be run in the foreground. Background it.
# ⚠️ And touch NOTHING in apps/api while it runs, reads included: each suite's reset
#    renames .env, and an open handle on Windows blocks that rename and fails the suite.
```

The consent variable is mandatory — every integration suite resets the database
in its own `beforeAll`. Export it for the whole run.

Postgres must be up first:

```bash
wsl -d Ubuntu-22.04 -- sudo pg_ctlcluster 16 main start
```

## Five rules that are easy to get wrong

1. **Never edit source while an integration suite is running.** It resets the
   database and reloads modules; a mid-run edit once produced 81 phantom
   failures. Wait the ~6 minutes.
2. **Hand-check every generated Prisma migration to zero `DROP` statements.**
   `prisma migrate dev` emits `DROP INDEX` for six trigram GIN indexes it cannot
   model. Applying one unedited destroys ticket and KB search performance against
   a stated sub-500ms requirement.
3. **Kill stray node processes before building.** A dev server or an orphaned
   jest run holds the Prisma query engine and the build dies with `EPERM`.
4. **`npm run lint` runs eslint with `--fix`** — it repairs ~269 violations and
   exits 0. It passing proves very little.
5. **Trust a live run over any document, including these.** Several written plans
   in `prompts/` turned out to contain factual errors that only surfaced on
   execution. Verify, then say so when a document is wrong.

## Current state (2026-09-09)

- Branch `ui-redesign-and-api-hardening`. Remotes: `azure` (Azure DevOps, the
  deploy target), plus two **public** GitHub remotes.
- ⚠️ **A DEPLOY IS HALF DONE. Production runs OLD CODE against a NEWER SCHEMA.**
  Measured 2026-09-15: App Service `TicketTicket` runs commit **`2c2f8d0`**;
  **schema is at 66 applied, 0 blocking.** Migrations 65 and 66 landed; the code
  half never ran and `DEPLOYED_COMMIT_SHA` was never moved. **This is safe and
  deliberate** — old code never reads `ApiKey`, `WebhookSubscription` or
  `EmailActionUse` and never writes `WEBHOOK` — and it is why migrations go
  first. **6 trigram indexes intact** after both. **Local `HEAD` is `410da33`,
  29 commits ahead, with migration 67 the only one still to apply.** The deploy
  handoff is `prompts/2026-09-15-deploy-twenty-nine.md`.
- ⚠️ **NEVER `git checkout <sha>` in this working tree to build a deploy.** Two
  sessions share it, so a detached HEAD lands under whoever else is working —
  which happened **twice** on 2026-09-15, both times caused by a planner
  instruction. **Use `git worktree add ../deploy-<sha> <sha>` and remove it
  afterwards.**
- ✅ **Three deploys in a row shipped exactly the commits their handoff named**,
  because each pinned the commit instead of taking HEAD.
- ⚠️ **Card 2.1 is deployed but OFF.** `LEAST_LOADED` is a per-team setting and
  no team has been switched to it. **Check before assuming least-loaded
  assignment is in use:** `select name, "assignmentStrategy" from "Team";`
- ✅ **Easy Auth `excludedPaths` verified live 2026-09-14** (`az rest` on
  `authsettingsV2`): `/api/tickets/inbound-email`, `/api/tickets/intake`,
  **`/api/email-actions` AND `/api/email-actions/*`**. ⚠️ **This DISPROVES the
  2026-09-13 audit's F-052 worry that card 1.44's one-click email links may be
  dead in production — they are reachable.** The audit was right to mark it
  *Suspected*; it lacked Azure access. **The scanner callback is genuinely not
  excluded**, but no scanner exists (card 0.7 is an open owner decision), so that
  half is true and moot. **Do not re-raise F-052 as a defect.**
- **A deep audit was run 2026-09-13** — `audit-output/TICKETING_SYSTEM_AUDIT.md`,
  115 findings, 0 Critical / 10 High. **Nine were re-verified true by the planner
  on 2026-09-14 and are cards 1.78–1.86.** ⚠️ **The Medium and Low findings
  (105 of them) have NOT been verified one by one** — treat any of them as a
  claim to check, not a fact, exactly as with the older `BUgs.txt` audit.
- ⚠️ **FIVE audit findings were checked and found FALSE or materially
  overstated. Do not re-raise them.** **F-052** — `/api/email-actions` IS in the
  live Easy Auth exclusion list. **F-016** — the SLA breach worker DOES filter
  `deletedAt` (`sla-breach.service.ts:263`), as does the agent profile
  (`agents-admin.service.ts:84,211,224`). **F-050** — FAILED outbox rows not
  being retried is a DELIBERATE documented decision (`outbox.service.ts:124`),
  not a defect. **F-058** — “no rate control on the AI routes” is wrong; the
  global throttler from card 1.69 covers them. **F-041** — keying the rate limit
  on an unverified token claim is card 1.69's deliberate design, documented in
  `throttle-tracker.util.ts` as bucketing-only and explicitly not authorization.
- **Verified TRUE from the Medium set → cards 1.87–1.92**, and the rest of the
  Mediums → cards 1.93–1.105.
- **The 54 LOW findings were opened 2026-09-15.** Ten verified TRUE against the
  code at `410da33` → **cards 1.106–1.115**, handoffs
  `prompts/2026-09-15-ai-gate-batch.md` and
  `prompts/2026-09-15-access-and-assignment-batch.md`. ⚠️ **The remaining ~44
  Lows are still unverified** — treat each as a claim to check, not a fact.
- ⚠️ **THREE MORE audit findings were checked and found FALSE or materially
  overstated (2026-09-15). Do not re-raise them.**
  **F-112** — *“attachment contentType is client-declared and served back”* is
  technically true and practically wrong: uploads pass an **extension
  whitelist**, a **MIME↔extension consistency check**, **magic-byte signature
  matching** and a **blocked-MIME list** (`ticket-attachment.service.ts:678-740`);
  `.svg`, `.html` and `.htm` are **not** in the whitelist; downloads set
  **`Content-Disposition: attachment`** (`attachments.controller.ts:27-29`) and
  helmet supplies `nosniff`. **F-098** — the CORS localhost fallback is real in
  code but **`CORS_ORIGIN` IS SET in production** (measured, 73 characters), so
  it never applies there; a fail-open default worth tightening one day, not a
  live defect. **F-105** — KB HTML is sanitised with **DOMPurify in the browser
  before render** (`apps/web/src/utils/articleMarkdown.ts:73-88`); the residual
  is only for non-browser consumers, which card 2.6's public API newly creates.
- ✅ **Production settings measured read-only 2026-09-15** (`value!=''`/`length`,
  never `value`): **SET** — `AI_PIPELINE_ENABLED` (len 4), `CORS_ORIGIN` (len 73),
  `AZURE_WEB_PUBSUB_TOKEN_LIFETIME_MINUTES` (len 2). **NOT SET** —
  `AUTH_BOOTSTRAP_OWNER_EMAILS`, `HEALTH_READY_TOKEN`, `LEAD_DIGEST_ENABLED`,
  `ATTACHMENT_SCAN_ENABLED`. ⚠️ **`ATTACHMENT_SCAN_ENABLED` unset means the gate
  is ON** — `ticket-attachment.service.ts:615` defaults it to `'true'`, so the
  owner's card 0.7 decision needs the variable **created**, not changed.
- ⚠️ **`az webapp log download` returns a PARTIAL window, not a day.** A
  download on 2026-09-11 covered roughly twenty minutes and reported **0 × 429 and
  0 × 5xx across 891 responses** — but the same query returns 0 for 09-09 and
  09-10, the days card 1.69 measured **288** refusals. **Do not use it for a
  before-and-after claim.** Whether the rate-limit fix worked is still unproven.
- **The 2026-09-10 deploy shipped the five-card batch** — 1.58, 1.53, 0.9,
  1.16, 0.10 — including **migration 59** (`Team.hiddenPresetIds`). So
  team-managed saved views and preset hiding are **live**, and the owner found
  a gap in them within the hour: **card 1.61**, the four sidebar rows that come
  from a second list and cannot be hidden. The leads' digest (1.16) is live but
  **switched off** (`LEAD_DIGEST_ENABLED`), and email is the owner's settled
  choice of transport for it.
- **Live since the 2026-09-09 deploy — sixteen cards in three batches.** The
  headline ones: one-click close/reopen/rate from the resolved email (1.44),
  redaction of a sent message including its pasted images and any copy not yet
  sent (1.11, 1.47, 1.48), three new desk reports (1.17), bulk tags and macros
  (1.12), an expired session that says so instead of *"Unable to load tickets"*
  (1.54), and **the API no longer writing bearer tokens or shared secrets into
  the log (1.57)**.
- ⚠️ **Card 1.57 is only half closed.** The code stopped leaking, but the
  logs already written still hold **2,064 full bearer tokens and 252 copies of
  the intake shared secret** (measured across 09-07 to 09-09). Tokens expire in
  about an hour so the historical ones are dead. **The intake secret does not
  expire** — rotation is **deferred by the owner**, tracked as **card 1.59**,
  which also records why deferring is defensible: that secret opens one route
  whose only capability is creating a ticket. **Do not rotate it as a side
  effect of anything, and do not re-raise it unprompted.**
- The retention job remains off. Two probe tickets (`PA_20260829_021`,
  `IT_20260829_022`) are still awaiting deletion — now part of card 0.10.
- **In flight:** `prompts/2026-09-09-five-cards-batch.md` — 1.58, 1.53, 0.9,
  1.16, 0.10. **Card 1.53 adds migration 59**, the only schema change in that
  batch. Two of those five are not ordinary code work: 0.9 may produce no
  production code, and 0.10's production half is run by the owner.
- ⚠️ **Reports have never excluded soft-deleted tickets** (card 1.45). 20 of the
  23 raw-SQL reports in `reports.service.ts` have no `deletedAt` filter, and the
  comment at `:200` wrongly says they get one from `accessConditionSql` — which
  reports never call. Found 2026-09-08.
- `azure-pipelines.yml` exists but **cannot run** — the Azure DevOps org has no
  hosted parallelism grant. **Nothing currently gates a deploy except running the
  checks above by hand.**
- `scripts/merge-hr-teams.sql` has not been run; it is a deliberate one-time
  manual step.
- `docs/security-audit-2026-08.md` describes live weaknesses in a running system,
  and two remotes are public. Think before pushing it outward.
- `e2e/` holds **eight** Playwright specs (~82 KB, oldest March 2026, newest
  touched 2026-09-03 by card 1.9) that are **untracked**, so they exist only on
  this machine. Note `.gitignore:49-51` says the opposite — *"# Keep Playwright
  specs"* with two negation rules — so the intent recorded there is that they
  **should** be tracked. Owner reviewed 2026-09-04 and chose to leave both as
  they are. Scanned for credentials: clean, bar a local dev fallback in
  `e2e/auth.ts`. **Leave them out of any deploy package.**
- `.claude/` is gitignored, so the `atm-*` skills there are local-only.
