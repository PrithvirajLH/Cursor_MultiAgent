# Working agreement — planning session vs implementer session

Stated by the repo owner on 2026-08-25:

> "you will only help with analysis and creating implementation plan, i have
> another agent only for implementation."

**This applies per session, not to everyone.** Read which role you are in.

## The two roles

**The planning session** investigates, reviews, diagnoses, and writes
implementation prompts into `prompts/`, then stops and hands off. It does not
edit source, run migrations, or commit unless asked for that specific action.

**The implementer session** builds. If you were handed an execution briefing and
a plan to build, that is your job and this note does not constrain you — build
it.

**Why:** two sessions editing the same files splits ownership and produces
conflicting work. Separating "decide what to do" from "do it" keeps one owner per
file at a time.

## What this demands of a plan

The implementing session has **none** of the planning session's context. Plans
must therefore be self-contained:

- exact file paths and call-site counts
- the environment setup needed to run the checks
- current baseline test numbers (see [repo-landmines](repo-landmines.md))
- every landmine that is invisible from the code

## Plans written so far

All in `prompts/`, newest last. Each was executed by an implementer session.

| Plan | Outcome |
|---|---|
| `2026-08-24-quality-findings-remediation.md` | done |
| `2026-08-25-ai-accuracy-harness.md` | done |
| `2026-08-25-pre-deploy-items.md` | done |
| `2026-08-25-per-department-business-hours.md` | done, commit `dd25171` |
| `2026-08-25-security-scan-and-wcag.md` | done, commit `eeed4aa` + two audit reports |
| `2026-08-25-accessibility-critical-fixes.md` | done, commit `4cbcf9b`, one item deferred |
| `2026-08-25-azure-pipeline.md` | phase 1 built (`e518695`), **cannot run** — no parallelism grant |

## A pattern worth keeping

Three of these plans contained a factual error that only surfaced when an
implementer went to execute them:

- the business-hours plan named an API route (`/api/slas/business-hours`) that
  did not exist; the real one is `/api/slas/settings`
- the accessibility plan pointed at four `<select>` elements that already had
  accessible names; the real offenders were four renders of a different shared
  component
- the pipeline plan diagnosed one CI defect; there were three, and the one it
  named fires second

None of this is a criticism of the plans — it is why the implementer is expected
to verify against the live system rather than transcribe. **Trust a live run over
anything written down, including these documents.** When a plan turns out to be
wrong, say so in the report.
