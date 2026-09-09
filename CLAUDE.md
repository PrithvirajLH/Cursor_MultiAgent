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

**549 unit tests (54 suites), 699 integration + 1 skipped, 225 web unit tests (36 files)**, both typechecks clean.

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
cd apps/api && npx jest                       # 549, 54 suites
cd apps/web && npx vitest run                 # 225, 36 files

export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
cd apps/api && npm run test:integration       # 699 + 1 skipped, 69 of 70 suites, ~13 min
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

## Current state (2026-09-08)

- Branch `ui-redesign-and-api-hardening`. Remotes: `azure` (Azure DevOps, the
  deploy target), plus two **public** GitHub remotes.
- Production App Service `TicketTicket` runs commit `f48452b` (deployed
  2026-09-04 20:22 UTC, deployment `050a527c`; previous `d8811a7` 08-29,
  `2df679d` 08-28, `d1d57bc` 08-27, `c2ff777` 08-26). Live since that deploy:
  ticket links and merge (1.6), staff email removed so email now goes only to
  requesters and CC'd outsiders (1.42), macros with actions and placeholders
  (1.7 / 1.7b), and the intake acknowledgement fix. `POST /api/tickets/intake`
  is **live** (secret set, path excluded from Easy Auth). The retention job
  remains off. Two probe tickets (`PA_20260829_021`, `IT_20260829_022`) are
  awaiting deletion by the owner.
- **HEAD is ahead of production by seven code commits** — the six-card batch
  (1.43, 1.18, 1.17, 1.12, 1.11, 1.44), **GREEN 2026-09-08**, carrying
  **migration 58**. Deploy handoff:
  `prompts/2026-09-08-deploy-six-card-batch.md`. ⚠️ **It names three
  prerequisites and two of them are easy to miss** — this machine's IP is not on
  the production database firewall, so `migrate deploy` cannot connect; and
  production has **no email-action signing secret**, which would silently ship
  card 1.44 with none of its seven links. Read that handoff before deploying.
- Migration count: **58 in the tree**. Production was last verified at 54 on
  08-29 and should be at 57 now (55–57 went out with the 09-04 deploy), but
  **that was not re-confirmed** — the production database is unreachable from
  this machine. `npx prisma migrate status` at deploy time is the gate. The six
  trigram indexes were intact at the last check.
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
