# Implementation Prompt — Quality Findings Remediation

**Date:** 2026-08-24
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Scope:** 8 of the 9 findings from the code review. Soft delete (finding 1) is explicitly deferred by the engineer.

---

## 1. Goal

Close eight verified quality findings without changing product behaviour that users depend on. Every fix is in the NestJS API or its tooling; no frontend work, no framework migration.

---

## 2. Skills and context read

- `AGENTS.md` (newticket) — all 14 sections; §7 ADR digest, §10 configuration-over-code, §11 AI intake behaviour, §12 gotchas, §13 checks.
- `.claude/skills/atm-qa-tester/SKILL.md` + `references/testing-specs.md` — code review checklist, test pyramid, RBAC matrix, SLA edge cases, quality gates.
- `.claude/skills/atm-system-architect/SKILL.md` + `references/architecture-decisions.md` (ADR-001…010) + `references/project-context.md`.
- This repo's `.cursorrules` — NestJS conventions: explicit types, no `any`, JSDoc on public methods, one export per file, kebab-case filenames, no blank lines inside functions.
- `node_modules/next/dist/docs/` — not relevant here (no frontend change).

## 3. Code inspected

`prisma/schema.prisma` (750 lines, 44 models, 47 migrations) · `src/ai/**` (ai.service.ts, prompts/, tools/, types/pipeline.types.ts) · `src/common/access-control.service.ts` + spec · `src/reports/reports.service.ts` + controller · `src/auth/*.guard.ts` · `src/mcp-server/server.ts` · `src/slas/**` · `src/common/env.validation.ts` · `scripts/reset-test-db.cjs` · `test/integration/**` (35 suites).

## 4. Verified baseline before any change

| Check | Result |
|---|---|
| `apps/api` typecheck (`tsc --noEmit`) | pass, exit 0 |
| `apps/web` typecheck | pass, exit 0 |
| API unit tests (`npx jest`) | **120/120 pass**, 18 suites |
| API integration (`npm run test:integration`) | **332/332 pass**, 35 suites, ~450s |

Test environment built for this work: PostgreSQL 16.15 in WSL Ubuntu 22.04, port 5433, `timezone = 'UTC'`, loopback `trust` auth (matches the passwordless URL in `.env.test` and the Docker compose default). Two initial failures (`tickets-misc` activity + status-breakdown) were caused by the server defaulting to `America/Chicago`; setting UTC resolved both. **Supabase is never touched** — `reset-test-db.cjs` host-pins to localhost and verifies `database="ticketing_test"` before every run.

---

## 5. Decisions and assumptions

1. **Finding 1 (soft delete) is out of scope** — engineer's call, on the basis that `prisma.ticket.delete` exists nowhere in the codebase so the risk is latent. Not revisited here.
2. **Confidence thresholds become configuration, not prompt prose.** `AI_CONFIDENCE_THRESHOLD` already exists in `.env.example` and is read nowhere; it becomes live. A per-team override column is added so a department can tighten its own gate without a deploy — this is what AGENTS.md §10 requires.
3. **The LLM keeps the clarifying question, loses the arithmetic.** Asking a model to compute a weighted average and compare it to a threshold is neither reliable nor auditable. Scoring and the pass/fail decision move to TypeScript; the model is still used to phrase the clarifying question, which is a genuine language task.
4. **Coverage threshold will be set to measured-current, not aspirational 80%.** A threshold that fails on day one gets disabled within a week. I will measure actual coverage, set the gate just below it, and document 80% as the ratchet target per the QA gates table.
5. **New SLA tests may fail.** If a DST or holiday test exposes a real defect, it is reported as a finding — not silently patched, and not weakened to pass. Application code is not modified to make a test green.
6. **MCP SSE transport gets authentication and a localhost default bind.** It is not removed, because that would be a behaviour change beyond the finding.
7. **Three batches, one approval.** Sequenced so each batch is independently verifiable and revertable.

---

## 6. The work

### Batch A — authorization hardening and tooling (no migration)

**Finding 5 — reports authorization fails open.**
`src/reports/reports.service.ts` `scopeReportQuery` handles TEAM_ADMIN, LEAD, OWNER then falls through to `return query;`, applying no team filter for AGENT and EMPLOYEE. Currently unreachable because `ReportsController` carries a class-level `@UseGuards(LeadOrAdminGuard)`, but it fails open by default and there is no service-layer backstop.
- Replace the fall-through with an explicit `throw new ForbiddenException(...)` for any role not handled.
- Add integration test: an AGENT and an EMPLOYEE each receive 403 from a reports endpoint.

**Finding 9 — dual access-control representations can drift.**
`AccessControlService` maintains `buildTicketAccessFilter` (Prisma) and `accessConditionSql` (raw SQL) as hand-synced twins. Divergence is a silent cross-team data leak.
- Add `test/integration/access-control.parity.spec.ts`: seed tickets across multiple teams with each of the 5 roles, then for every role assert the ticket ID set from the Prisma filter is **identical** to the set from the raw-SQL condition.
- This is the drift detector, and it must run in CI.

**Finding 6 — MCP server has no authentication.**
`src/mcp-server/server.ts` starts a bare `http.createServer` on port 3001 under `MCP_SERVER_TRANSPORT=sse`, with no auth, no TLS, and no origin check. Tools take `userId` / `requesterId` as parameters, so the caller asserts identity.
- Require `MCP_SERVER_TOKEN` when transport is `sse`; refuse to start without it.
- Validate `Authorization: Bearer <token>` on `/sse` and `/messages`; 401 otherwise.
- Default bind to `127.0.0.1` via `MCP_SERVER_HOST`.
- `stdio` transport unchanged.

**Finding 7 — no coverage threshold.**
- Run `npx jest --coverage` to establish the real number.
- Add `coverageThreshold` to the `jest` block in `apps/api/package.json` at measured-current (rounded down).
- Comment recording 80% as the target from the QA quality gates.

### Batch B — AI pipeline correctness (one migration)

**Finding 2 — no AI observability persistence.**
Today the entire pipeline trace is stuffed into a `TicketEvent` JSON payload (`ai.service.ts:335`), so routing accuracy, precision/recall and a confusion matrix cannot be computed. That makes the Phase 1 ≥85% routing-accuracy gate unmeasurable.
- New models: `AiInferenceLog` (step, agentName, model, latencyMs, status, rawOutput, parsed, error, correlationId, ticketId?), `RoutingDecisionLog` (ticketId, predictedTeamId, confidence, method, matchedRuleId?, alternatives, accepted), `CorrectionLog` (ticketId, field, fromValue, toValue, correctedByUserId, reason?).
- Indexed for the accuracy queries: `(createdAt)`, `(predictedTeamId, createdAt)`, `(ticketId)`.
- Writes are **fire-and-forget** and must never block or fail the request path (ADR / project-context: "asynchronously so it never blocks the user").
- `TicketEvent` payload writing stays as-is for backwards compatibility with `getAiAnalysis`.

**Finding 3 — confidence gate is an LLM prompt.**
- Schema: `Team.isSensitive Boolean @default(false)`, `Team.confidenceThreshold Float?`.
- New `src/ai/confidence-gate.service.ts` — pure, deterministic, unit-testable:
  - score = `dept*0.6 + cat*0.3 + prio*0.1`, or department confidence alone when there is no category;
  - threshold = `team.confidenceThreshold ?? (team.isSensitive ? AI_SENSITIVE_CONFIDENCE_THRESHOLD : AI_CONFIDENCE_THRESHOLD)`;
  - `isMultiDepartment` always fails the gate;
  - returns `{ passed, overallConfidence, thresholdUsed }`.
- `AI_CONFIDENCE_THRESHOLD` (already present, currently dead) becomes live; add `AI_SENSITIVE_CONFIDENCE_THRESHOLD` (default 0.85) to `.env.example` and env validation.
- `confidence-gate.ts` prompt is reduced to clarifying-question generation only.
- Unit tests: boundary at threshold, just under, just over, sensitive vs standard, per-team override, multi-department, missing category.

**Finding 4 — departments hardcoded in prompts.**
19 hardcoded department references across `prompts/department-classifier.ts` and `prompts/confidence-gate.ts`. Onboarding a department currently needs a prompt edit and a deploy, which contradicts AGENTS.md §10 and the configuration-over-code ADR.
- `Team.description` already exists and `getDepartments()` already returns it — build the department block at runtime from that tool's output.
- Seed `description` and `isSensitive` for the seven existing teams, moving today's prompt text into data.
- No department name may remain in any file under `src/ai/prompts/`.

### Batch C — SLA edge cases (tests only)

**Finding 8 — SLA edge cases untested.**
2,546 lines of SLA logic; `slas.business-hours.spec.ts` has 2 tests and there is no DST test anywhere. Add the cases `references/testing-specs.md` names:
- DST transition inside an SLA window (both directions);
- consecutive holidays / long weekend;
- SEV1 raised at 16:55 with business hours ending at 17:00;
- department-specific timezone;
- pause/resume across a business-hours boundary.

---

## 7. Files expected to change

```
prisma/schema.prisma                                   (Team +2 cols, 3 new models)
prisma/migrations/<new>/migration.sql                  (generated)
prisma/seed.ts                                         (team description + isSensitive)
src/ai/ai.service.ts                                   (deterministic gate, observability writes)
src/ai/confidence-gate.service.ts                      (new)
src/ai/confidence-gate.service.spec.ts                 (new)
src/ai/ai.module.ts                                    (provider wiring)
src/ai/prompts/confidence-gate.ts                      (reduced to question generation)
src/ai/prompts/department-classifier.ts                (dynamic department block)
src/reports/reports.service.ts                         (fail-closed)
src/mcp-server/server.ts                               (SSE auth + localhost bind)
src/common/env.validation.ts                           (new AI + MCP vars)
.env.example                                           (document new vars)
package.json (apps/api)                                (coverageThreshold)
test/integration/access-control.parity.spec.ts         (new)
test/integration/reports.authz.spec.ts                 (new or extended)
test/integration/slas.business-hours.spec.ts           (extended)
```

## 8. Security considerations

- Reports change is **fail-closed**: an unhandled role must be denied, never silently unscoped.
- The parity test is a security control, not a nicety — it is what catches an access-control drift that would leak another team's tickets.
- MCP token compared with a constant-time comparison; never logged; absent token means the SSE server refuses to boot rather than starting open.
- AI observability logs must not persist PHI. `rawOutput` may contain requester free text, so DON and Medicaid Pending traffic must be redacted before write, per AGENTS.md §12. **If redaction cannot be done cleanly, log a reference and not the payload.**
- No secrets in code; all new config via env, documented in `.env.example`.
- No change to the `AUTH_ALLOW_INSECURE_HEADERS` production guard.

## 9. Acceptance criteria

1. `tsc --noEmit` clean in `apps/api` and `apps/web`.
2. API unit tests ≥ 120 passing, none broken.
3. API integration tests **332 passing plus the new ones**, zero regressions.
4. AGENT and EMPLOYEE receive 403 from every reports endpoint, asserted by test.
5. Access-control parity test passes for all 5 roles.
6. `grep -riE 'DON|Medicaid|White Gloves' src/ai/prompts/` returns nothing.
7. Confidence pass/fail is computed in TypeScript; changing `AI_CONFIDENCE_THRESHOLD` changes behaviour with no prompt edit.
8. A pipeline run writes rows to `AiInferenceLog` and `RoutingDecisionLog`.
9. MCP SSE refuses to start without `MCP_SERVER_TOKEN`, and returns 401 for a bad token.
10. `coverageThreshold` present and passing.
11. Any SLA defect discovered is **reported**, not patched around.

## 10. Checks to run

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
cd apps/api && npx jest                       # unit, expect >= 120 pass
cd apps/api && npm run test:integration       # expect 332+ pass
cd apps/api && npx jest --coverage            # threshold gate
```

## 11. Manual test steps

1. `wsl -d Ubuntu-22.04 -- sudo pg_ctlcluster 16 main start` (if not running), confirm `localhost:5433` reachable.
2. Set `AI_CONFIDENCE_THRESHOLD=0.99` in `apps/api/.env`, restart the API, submit a clear IT request through the AI intake — it must return `needs_clarification` rather than creating a ticket. Reset to `0.75`, resubmit, confirm the ticket is created. **This proves the gate is configuration, not prose.**
3. `SELECT step, "agentName", "latencyMs", status FROM "AiInferenceLog" ORDER BY "createdAt" DESC LIMIT 10;` — confirm one row per pipeline step.
4. In the admin UI, add a new team with a description; submit an intake request matching it and confirm it routes there **with no code change**.
5. Sign in as an AGENT, call `GET /api/v1/reports/summary` — expect 403.
6. `MCP_SERVER_TRANSPORT=sse npm run mcp-server` with no `MCP_SERVER_TOKEN` — expect a refusal to start. With a token, `curl http://127.0.0.1:3001/sse` without a header — expect 401.

---

## 12. Out of scope

Soft deletes (finding 1, deferred) · any frontend change · the Next.js question · ADR amendments for Postgres/NestJS (raised separately) · the `Codex_Ticketing_System_deploy.zip` (167MB) sitting in the working tree.

---

# Addendum — discovered during implementation (2026-08-24)

## A. Finding 4 was mischaracterised in the review

`src/ai/prompts/*.ts` are **not runtime code**. Nothing in `src/` imports them —
the pipeline calls Azure AI Foundry agents by id (`DEPARTMENT_CLASSIFIER_AGENT_ID`,
`CONFIDENCE_GATE_AGENT_ID`, …). Those files are a hand-maintained source-of-record
copy of prompts that live in Azure.

The review claimed onboarding a department required a prompt edit and redeploy.
That was wrong: the deployed prompt already instructs the model to call
`get_departments`, so runtime grounding comes from the database. The real defect
is a stale duplicate that silently drifts from what is deployed — lower severity,
different fix.

What was done instead: removed the static department block, added a header to both
files stating they are not runtime code and that the authoritative copy is in
Foundry, and enriched `getDepartments()` to return `isSensitive` so sensitivity is
data. Seed now carries each department's scope text in `Team.description`.
**The deployed Foundry prompts still need to be updated by hand** — that cannot be
done from this repo.

## B. New finding — `prisma migrate dev` emits destructive drift

`prisma migrate dev` generated, unprompted, alongside the intended change:

- `DROP INDEX` for all six trigram GIN indexes created by
  `20260220150000_add_ticket_search_trigram_indexes` and `20260528_add_knowledge_base`
- `ALTER COLUMN … DROP DEFAULT` on `AutomationExecution.trigger` and the
  `updatedAt` columns of four SLA tables plus `TicketEmailThread`

Cause: `USING GIN (col gin_trgm_ops)` cannot be expressed in `schema.prisma`, so
Prisma treats those indexes as drift on every run. Applying it would silently
destroy ticket and KB search performance — against a stated <500ms search NFR.

The generated migration was hand-edited down to only the additive statements, with
a header explaining why. **This will recur on every future `migrate dev`.** Worth a
follow-up: either declare the indexes via a Prisma preview feature that supports
them, or add a CI check that fails when a generated migration contains `DROP INDEX`.

## C. Behaviour change — `adjustedClassification` removed

The old LLM confidence gate could return an `adjustedClassification` that silently
replaced the classifier's output. With a deterministic gate that is gone:
`finalClassification` is now always the classifier's result. Rationale — a second
model rewriting the first one's output was not auditable, and `RoutingDecisionLog`
needs one authoritative prediction to score accuracy against.

Also: the LLM is now called for step 3 **only when the gate has already decided to
ask a question**, so a confident intake makes one fewer model call.

## D. Not done

- `env.validation.ts` was left unchanged. The new AI threshold vars have safe
  fallbacks with warnings, and `MCP_SERVER_TOKEN` is enforced at MCP startup where
  it belongs — adding either as a hard boot requirement would break existing API
  deployments for no safety gain.
- Batch C (SLA edge-case tests, finding 8) not yet started.
