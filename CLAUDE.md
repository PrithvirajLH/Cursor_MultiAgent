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

**405 unit tests (43 suites), 457 integration + 1 skipped, 70 web unit tests (18 files)**, both typechecks clean.

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
cd apps/api && npx jest                       # 405, 43 suites
cd apps/web && npx vitest run                 # 70, 18 files

export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
cd apps/api && npm run test:integration       # 457 + 1 skipped, takes ~6-10 min
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

## Current state (2026-08-25)

- Branch `ui-redesign-and-api-hardening`. Remotes: `azure` (Azure DevOps, the
  deploy target), plus two **public** GitHub remotes.
- Production App Service `TicketTicket` runs commit `d8811a7` (deployed
  2026-08-29 02:48 UTC, deployment `5d0d116a`; previous `2df679d` 08-28, `d1d57bc` 08-27,
  `c2ff777` 08-26, `458543a` before that). Schema is up to date at **51**
  migrations; the six trigram indexes are intact. `main` and
  `ui-redesign-and-api-hardening` are both at `d8811a7` — exactly what shipped. Live since this deploy: ticket editing, requester
  confirm/reopen/cancel, timed automations (scheduler on, no timed rules yet),
  the extra automation actions, and `POST /api/tickets/intake`, which is **live**
  (secret set, path excluded from Easy Auth) and, since card 1.20, replays
  retries correctly across connections and accepts required custom fields by
  name. The retention job remains off. Two probe tickets
  (`PA_20260829_021`, `IT_20260829_022`) are awaiting deletion by the owner.
- `azure-pipelines.yml` exists but **cannot run** — the Azure DevOps org has no
  hosted parallelism grant. **Nothing currently gates a deploy except running the
  checks above by hand.**
- `scripts/merge-hr-teams.sql` has not been run; it is a deliberate one-time
  manual step.
- `docs/security-audit-2026-08.md` describes live weaknesses in a running system,
  and two remotes are public. Think before pushing it outward.
- `e2e/` contains an accessibility spec that is uncommitted on purpose.
- `.claude/` is gitignored, so the `atm-*` skills there are local-only.
