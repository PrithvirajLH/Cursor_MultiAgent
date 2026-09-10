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

**598 unit tests (59 suites), 735 integration + 1 skipped, 239 web unit tests (38 files)**
⚠️ **These figures include card 1.24's work, which is in the working tree and NOT
COMMITTED as of 2026-09-10.** Committed `HEAD` is **560 / 725 / 239**. If the tree is
discarded, revert this line too., both typechecks clean.

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
cd apps/api && npx jest                       # 598, 59 suites
cd apps/web && npx vitest run                 # 239, 38 files

export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
cd apps/api && npm run test:integration       # 735 + 1 skipped, 72 of 73 suites, ~15 min
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
- Production App Service `TicketTicket` runs commit `79e49e9` (deployed
  2026-09-10; previous `2d637f2` 09-09, `f48452b` 09-04, `d8811a7` 08-29).
  Schema is at **59** migrations — confirmed by reading `_prisma_migrations`,
  with **0 blocking rows** and all **6 trigram indexes** present.
  `EMAIL_ACTION_SECRET` is set, so card 1.44's seven email links are live.
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
