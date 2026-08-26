# Implementation Prompt — 0.3 Migration DROP guard in CI

**Date:** 2026-08-26
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 0.3 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** the single most expensive trap in this repo is a written warning, not an automated check. `prisma migrate dev` emits `DROP INDEX` for six trigram GIN indexes it cannot model; one unedited migration destroys ticket and KB search performance. Today only a human reading `repo-landmines.md` prevents it.

**Touches:** one new script, two CI files. No app code, no tests to run, no deploy. Disjoint from 0.5 and 0.11 — can run in parallel.

---

## 1. Goal

A script that fails when a migration **added on the branch** contains a destructive statement, wired into both CI definitions, with an explicit, greppable opt-out for the rare intentional drop (card 0.8 will need one for a foreign-key change).

## 2. Context read

- `docs/agent-context/repo-landmines.md` — "Prisma" section (the drift, the hand-strip pattern, the `grep -cE` check this card automates).
- `apps/api/prisma/migrations/20260824211443_ai_observability_and_department_confidence/migration.sql` — the model of a hand-stripped migration with a header comment.
- `.github/workflows/ci.yml` and `azure-pipelines.yml` — where the step goes.

## 3. Facts established first (verified 2026-08-26)

| Fact | Consequence |
|---|---|
| `.github/workflows/ci.yml` `lint-build` job: `actions/checkout@v4` with default depth (shallow, 1 commit), then setup-node, `npm ci`, prisma generate, lint, unit tests, build. Triggers: `pull_request`, and `push` to `main` and `ui-redesign-and-api-hardening`. | A shallow checkout cannot diff against `main`. The checkout step needs `fetch-depth: 0`, and the script must fetch `main` explicitly when running on a push. |
| `azure-pipelines.yml` `verify` stage: NodeTool, `npm ci`, prisma generate, lint, a non-blocking "lint made no changes" script, unit tests, build. It **cannot run** today (no parallelism grant — card 0.2). | Add the step anyway so it is there when 0.2 lands; it costs nothing. Azure's default checkout is also shallow — add `fetchDepth: 0` on a `checkout: self` step. |
| Branch vs `main` today adds three migration folders: `20260608_add_user_primary_team_id_index`, `20260824211443_ai_observability_and_department_confidence`, `20260825120000_per_department_business_hours`. All three are already applied in production. | The script must pass on the current branch. Run it locally against `main` before wiring it in; if any of the three trips it, that is a **fact to report**, not something to silence. |
| The landmines check is `grep -cE '^(DROP\|ALTER TABLE .* DROP)' <migration>.sql` must be 0. | Same regex, plus leading-whitespace tolerance. |
| Card 0.8 will legitimately need `ALTER TABLE "Ticket" DROP CONSTRAINT … ; ADD CONSTRAINT … ON DELETE RESTRICT` (a foreign-key action change; no data or index is dropped). | The opt-out is a first-line comment `-- allow-drop: <reason>`; the script prints the reason so a reviewer sees it. |
| CI runs on `ubuntu-latest`; developers run Git Bash on Windows. | Plain bash, no GNU-only flags beyond `grep -E`, no `mapfile` (older Git Bash lacks it in some setups — use a `while read` loop). |

## 4. Decisions and assumptions

1. **Scope = migrations added on the branch**, i.e. `git diff --name-only --diff-filter=A <base>...HEAD -- 'apps/api/prisma/migrations/*/migration.sql'`. Old migrations are history; only new ones can hurt.
2. **Base ref:** on a pull request, `origin/<target branch>`; on a push, `origin/main`. The script takes the base as `$1` and defaults to `origin/main`.
3. **Opt-out is loud.** `-- allow-drop:` must be the very first line, and the script echoes it. A reviewer reading CI output sees every intentional drop.
4. **Fail with a GitHub annotation** (`::error file=…::`) so the offending file is clickable in the PR; the same text is plain on Azure.
5. **Not a lint of SQL.** It does not parse; it pattern-matches the two shapes that have actually hurt this repo. Keep it that way.

## 5. The work

### Task 1 — The script

**Files:** Create `scripts/check-migrations.sh` (root `scripts/` already exists with `perf/`).

- [ ] **Step 1 — write it:**

```bash
#!/usr/bin/env bash
# Fails when a Prisma migration ADDED relative to the base ref contains a
# destructive statement. Background: apps/api/prisma/migrations must stay
# additive — `prisma migrate dev` emits DROP INDEX for six trigram GIN indexes
# it cannot model, and applying one destroys search performance.
# See docs/agent-context/repo-landmines.md ("Prisma").
#
# Usage: scripts/check-migrations.sh [base-ref]   (default: origin/main)
# Opt-out for an intentional drop: make the FIRST line of the migration
#   -- allow-drop: <reason>
set -u
base="${1:-origin/main}"
if ! git rev-parse --verify --quiet "$base" >/dev/null; then
  remote="${base%%/*}"
  branch="${base#*/}"
  git fetch --no-tags "$remote" "$branch:refs/remotes/$base" >/dev/null 2>&1 || {
    echo "check-migrations: cannot resolve base ref '$base'" >&2
    exit 2
  }
fi
status=0
count=0
while IFS= read -r file; do
  [ -n "$file" ] || continue
  count=$((count + 1))
  first_line="$(head -n 1 "$file")"
  case "$first_line" in
    "-- allow-drop:"*)
      echo "check-migrations: ALLOWED  $file  ($first_line)"
      continue
      ;;
  esac
  if grep -nE '^[[:space:]]*(DROP|ALTER TABLE .* DROP)' "$file"; then
    echo "::error file=$file::destructive statement in a new migration — hand-strip it or add a first-line '-- allow-drop: <reason>' (repo-landmines.md, Prisma)"
    status=1
  else
    echo "check-migrations: ok       $file"
  fi
done < <(git diff --name-only --diff-filter=A "$base...HEAD" -- 'apps/api/prisma/migrations/*/migration.sql')
echo "check-migrations: $count new migration file(s) checked against $base"
exit $status
```

- [ ] **Step 2 — make it executable and CRLF-safe:** `git add --chmod=+x scripts/check-migrations.sh` and ensure the file is saved with LF line endings (add `scripts/*.sh text eol=lf` to `.gitattributes`, creating the file if absent).

- [ ] **Step 3 — prove it passes on the branch:**
      `bash scripts/check-migrations.sh origin/main` → three `ok` lines, `3 new migration file(s) checked`, exit 0. If `origin/main` is stale locally, `git fetch origin main` first. Any non-zero exit here is a report-back item.

- [ ] **Step 4 — prove it fails on a bad migration (throwaway, do not commit):**

```bash
mkdir -p apps/api/prisma/migrations/99999999999999_guard_probe
printf 'DROP INDEX "Ticket_subject_trgm_idx";\n' > apps/api/prisma/migrations/99999999999999_guard_probe/migration.sql
git add apps/api/prisma/migrations/99999999999999_guard_probe
git commit -qm "probe" && bash scripts/check-migrations.sh origin/main; echo "exit=$?"
# expect the ::error line and exit=1, then undo:
git reset -q --hard HEAD~1
```

- [ ] **Step 5 — prove the opt-out works** (same probe with first line `-- allow-drop: guard probe`): expect `ALLOWED` and exit 0; reset as above. Confirm `git status --short` shows no probe remnants.

### Task 2 — GitHub Actions

**Files:** Modify `.github/workflows/ci.yml` (`lint-build` job)

- [ ] Change the checkout step to:

```yaml
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
```

- [ ] Insert immediately after it (before Setup Node — no Node needed):

```yaml
      - name: Migrations are additive (no DROP in new migration files)
        run: bash scripts/check-migrations.sh "origin/${{ github.base_ref || 'main' }}"
```

      `github.base_ref` is set on `pull_request` (the target branch) and empty on `push`, so pushes compare against `main`.

### Task 3 — Azure Pipelines

**Files:** Modify `azure-pipelines.yml` (`verify` stage, `verify` job)

- [ ] Add as the first step of the job, before `NodeTool@0`:

```yaml
          - checkout: self
            fetchDepth: 0
            displayName: "Checkout (full history for migration diff)"
          - bash: bash scripts/check-migrations.sh origin/main
            displayName: "Migrations are additive (no DROP in new migration files)"
```

      If the job already has an explicit `checkout` step, edit that one instead of adding a second.

### Task 4 — Document and commit

- [ ] In `docs/agent-context/repo-landmines.md`, Prisma section, after the sentence that gives the `grep -cE` verify command, add: `CI runs this as \`scripts/check-migrations.sh\` on every new migration; an intentional drop needs a first-line \`-- allow-drop: <reason>\`.` (Card 0.5 also edits this file — if you see its baseline edit already there, that is expected; only add your sentence.)
- [ ] Commit (do not push):

```bash
git add scripts/check-migrations.sh .gitattributes .github/workflows/ci.yml azure-pipelines.yml docs/agent-context/repo-landmines.md
git commit -m "ci: fail on destructive statements in new Prisma migrations

- scripts/check-migrations.sh diffs added migration files against the base ref
- first-line '-- allow-drop: <reason>' is the loud, reviewable opt-out
- wired into GitHub Actions and Azure Pipelines with full-depth checkout"
```

## 6. Files expected to change

`scripts/check-migrations.sh` (new, +x) · `.gitattributes` (new or one line) · `.github/workflows/ci.yml` · `azure-pipelines.yml` · `docs/agent-context/repo-landmines.md` (one sentence). Five files. Nothing under `apps/`.

## 7. Security considerations

The script runs `git` and `grep` on repo files only; no network beyond `git fetch` of the base branch; no secrets. Review that the `::error` message cannot inject workflow commands (it contains only the file path, which is repo-controlled).

## 8. Acceptance criteria

1. `bash scripts/check-migrations.sh origin/main` exits 0 on the branch and lists the three current migration folders as `ok`.
2. The throwaway probe (Task 1 step 4) exits 1 with an `::error file=` line; the allow-drop probe exits 0 with `ALLOWED`.
3. `ci.yml` checkout has `fetch-depth: 0` and the new step precedes Setup Node; `azure-pipelines.yml` verify job has the full-depth checkout and the step.
4. `git diff --stat HEAD~1` = the five files in §6; no probe folder remains.

## 9. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review"
git fetch origin main
bash scripts/check-migrations.sh origin/main; echo "exit=$?"
git status --short
git diff --stat HEAD~1
```

## 10. Manual test steps

If the GitHub remote is used (see 0.2), push the branch to a **private** fork or wait for 0.2 — do not push to the public remotes to test this. Otherwise the local probes in Task 1 are the test.

## 11. Handoff notes — what to report back

1. Commit SHA.
2. Output of `bash scripts/check-migrations.sh origin/main` (all lines) and its exit code.
3. Exit codes from the two probes (bad migration → 1, allow-drop → 0).
4. `git diff --stat HEAD~1`.
5. Anything that did not match — in particular if one of the three existing branch migrations trips the check.
