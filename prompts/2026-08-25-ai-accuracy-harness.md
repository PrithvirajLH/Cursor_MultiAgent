# Implementation Prompt — AI Routing Accuracy Harness

**Date:** 2026-08-25
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Closes:** the unmeasured Phase 1 quality gate — AI routing accuracy ≥85%.

---

## 1. Goal

Make routing accuracy measurable two ways: continuously from real agent behaviour, and repeatably against a fixed corpus before a deploy. Today the number cannot be produced at all.

---

## 2. Context read

- `atm-qa-tester/references/testing-specs.md` — the `TestCase` / `AccuracyReport` shapes and the per-phase thresholds (85 / 92 / 95 / 97%).
- `atm-system-architect/references/architecture-decisions.md` — ADR-001 (pipeline exists *for* observability), ADR-002 (MCP tool boundary).
- `AGENTS.md` §11 (grounding, confidence gating), §13 (checks to run).
- `.cursorrules` — explicit types, no `any`, JSDoc on public methods, one export per file, kebab-case.

## 3. Facts established before designing

| Fact | Consequence |
|---|---|
| Foundry agent IDs are populated in `apps/api/.env` | a live benchmark is runnable, and costs real Azure OpenAI credits |
| No labeled corpus exists anywhere in the repo | the QA spec's "200+ champion cases" is an input we do not have |
| `recordCorrection` has **no caller** | added 2026-08-24 and left unwired; this is the linchpin and gets finished here |
| `Ticket` has no `aiConfidenceScore` / `sensitivityFlag` columns | AI provenance is established via `RoutingDecisionLog.ticketId`, not a ticket column |
| `applyTeamTransferInTx` is the shared helper behind `transfer` and `bulkTransfer` | one hook covers single and bulk department overrides |
| Pre-production: no live traffic | the instrument will read zero until traffic exists; that is expected, not a failure |

## 4. Decisions and assumptions

1. **A correction is only a correction if the AI routed the ticket.** `recordCorrection` self-guards: it writes only when a `RoutingDecisionLog` row exists for that ticket. Callers stay dumb; manually created tickets never pollute the corpus.
2. **Ground truth is the human override.** Accuracy = `1 − corrected ÷ decisions`. Known blind spot, documented in the report output: a misroute nobody noticed scores as correct, so this is an *upper bound* on error, not a complete measure.
3. **Reuse the existing report scoping.** The endpoint lives on `ReportsController`, so it inherits `LeadOrAdminGuard` and `scopeReportQuery` — a LEAD sees their team's accuracy, an OWNER sees platform-wide. No new authorization surface.
4. **The benchmark is opt-in, never automatic.** It spends money (each case is 4 agent calls). CI runs it only when `AI_BENCHMARK_ENABLED=true`.
5. **Starter corpus is synthetic and labeled as such.** ~40 cases across the six seeded departments, `source: 'synthetic'`. It is a regression gate, not a validity claim. Real champion cases and harvested corrections supersede it.
6. **Corrections feed the corpus.** The benchmark runner can load cases exported from `CorrectionLog`, so real traffic grows the corpus over time.
7. **Threshold is configuration.** `AI_ACCURACY_MIN`, default `0.85` (Phase 1).

---

## 5. The work

### Part 1 — Wire corrections (the missing linchpin)

Hook the three override paths, each fire-and-forget:

| Path | Field | Covers |
|---|---|---|
| `applyTeamTransferInTx` | `department` | `transfer` + `bulkTransfer` |
| `setCategory` | `category` | category overrides |
| `bulkPriority` (+ any single priority path) | `priority` | priority overrides |

`recordCorrection` gains the AI-provenance guard described in decision 1, and records `fromValue` / `toValue` as ids plus the acting user.

### Part 2 — Scoring service

`src/reports/ai-accuracy.service.ts`, computing over `RoutingDecisionLog` ⋈ `CorrectionLog`:

- `overall`: total decisions, accepted (auto-routed) vs triaged, corrected count, accuracy
- `byDepartment`: precision, recall, F1
  - TP = predicted D, not corrected away
  - FP = predicted D, corrected to something else
  - FN = corrected *to* D from another prediction
- `confusionMatrix`: predicted → actual
- `lowestConfidence`: bottom N accepted decisions by confidence — where to look first
- `thresholdMet`: accuracy ≥ `AI_ACCURACY_MIN`

Division-by-zero is explicit: with no data every rate is `null`, never `0` or `NaN`. A report that says "no data" must not look like a report that says "0% accurate".

### Part 3 — Endpoint

`GET /api/reports/ai-accuracy?from&to&teamId` on the existing reports controller, scoped by the existing role rules.

### Part 4 — Offline benchmark

- `test/ai/corpus/starter-corpus.json` — ~40 labeled cases, six departments, `source: 'synthetic'`
- `scripts/run-accuracy-benchmark.ts` — loads a corpus, runs each case through `classifyAndCreateTicket` in a dry-run mode that does **not** persist tickets, scores with the same code as Part 2, prints the report, exits non-zero below threshold
- Reuses the Part 2 scoring functions so the two paths can never disagree

### Part 5 — Tests

- Unit: the scoring math (precision, recall, F1, confusion matrix, empty-data behaviour) against fabricated rows — no DB, no LLM
- Integration: transferring an AI-routed ticket writes a `CorrectionLog` row; transferring a manually created ticket writes none

---

## 6. Files expected to change

```
src/ai/ai-observability.service.ts          (provenance guard on recordCorrection)
src/tickets/tickets.service.ts              (3 hook points)
src/tickets/tickets.module.ts               (provider wiring if needed)
src/reports/ai-accuracy.service.ts          (new)
src/reports/ai-accuracy.service.spec.ts     (new)
src/reports/reports.controller.ts           (one endpoint)
src/reports/reports.module.ts               (provider)
scripts/run-accuracy-benchmark.ts           (new)
test/ai/corpus/starter-corpus.json          (new)
test/integration/ai-corrections.spec.ts     (new)
.env.example                                (AI_ACCURACY_MIN, AI_BENCHMARK_ENABLED)
```

## 7. Security considerations

- The endpoint inherits `LeadOrAdminGuard`; a LEAD must not see another team's accuracy — asserted by test.
- `CorrectionLog` stores ids and the acting user, never free text from the ticket.
- `lowestConfidence` returns ticket ids and confidences, **not** ticket subjects or bodies — the report must be safe to screenshot.
- The benchmark runner must not persist tickets or write to `AiInferenceLog`; dry-run only.
- No new secrets. `AI_ACCURACY_MIN` and `AI_BENCHMARK_ENABLED` are non-sensitive.

## 8. Acceptance criteria

1. `tsc --noEmit` clean in both apps.
2. Unit suite ≥151 passing, none broken.
3. Integration suite ≥345 passing, none broken.
4. Transferring an AI-routed ticket writes exactly one `CorrectionLog` row; transferring a manually created ticket writes none.
5. `GET /api/reports/ai-accuracy` returns a well-formed report; with no data it returns `null` rates and `thresholdMet: false`, not `NaN`.
6. A LEAD receives only their team's figures; an AGENT receives 403.
7. Scoring math verified against a hand-computed fixture (known confusion matrix in, known precision/recall/F1 out).
8. The benchmark runner executes end-to-end against the starter corpus **only when explicitly enabled**, and creates no tickets.

## 9. Checks to run

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
cd apps/api && npx jest                    # unit
cd apps/api && npm run test:integration    # integration
cd apps/api && npx jest --coverage         # threshold gate
```

## 10. Manual test steps

1. Start the API against the local WSL Postgres.
2. Create a ticket through `POST /api/ai/classify`, note the routed team.
3. As a LEAD, transfer it to a different team.
4. `SELECT * FROM "CorrectionLog" ORDER BY "createdAt" DESC LIMIT 1;` — one row, field `department`, from/to matching.
5. Create a ticket manually via `POST /api/tickets`, transfer it, confirm **no** new `CorrectionLog` row.
6. `GET /api/reports/ai-accuracy` as OWNER — accuracy reflects step 3 (one decision, one correction → 0%).
7. `GET /api/reports/ai-accuracy` as AGENT — expect 403.
8. `AI_BENCHMARK_ENABLED=true npx ts-node scripts/run-accuracy-benchmark.ts` — prints a report, creates no tickets.

## 11. Out of scope

PHI detection (deferred — PHI departments not being onboarded) · email intake into the AI pipeline (not built; separate gap) · Key Vault · per-department business hours · replacing the synthetic corpus with champion-authored cases.
