# Implementation Prompt — Pre-deploy Items

**Date:** 2026-08-25
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Scope:** the three things blocking a confident deploy.

---

## 1. Goal

Prove the real AI intake path works end to end, get the pending schema migration ready to apply safely, and produce a data migration that merges the two HR teams without losing or corrupting anything.

---

## 2. Correction to the earlier report

I said "two migrations unapplied". **There is one**:
`20260824211443_ai_observability_and_department_confidence`. Verified via `prisma migrate status` — 47 migrations found, local test DB up to date.

---

## 3. Facts established first

| Fact | Consequence |
|---|---|
| Everything measured so far went through `debugPipeline`, a dry run | `POST /api/ai/classify` creating a real ticket has never executed, in any environment |
| The `RoutingDecisionLog` row in `ai-corrections.spec.ts` is written by the test itself | the pipeline's own observability writes are unproven on the real path |
| 11 places reference a team: 9 via `teamId`, plus `Ticket.assignedTeamId` and `User.primaryTeamId` | all must move, or rows orphan |
| `TeamMember @@unique([teamId,userId])`, `TicketAccess @@unique([ticketId,teamId])`, `SlaPolicyAssignment @@unique([teamId])` | a naive `UPDATE ... SET teamId` fails on constraint violation |
| `Ticket.assignedTeam` is an optional relation with no explicit `onDelete` | Prisma defaults to SetNull — deleting a team silently unassigns its tickets |

---

## 4. Decisions and assumptions

1. **The live intake test is opt-in, never in CI.** It calls real Azure OpenAI (~2 cents a run). Guarded by `AI_LIVE_TEST_ENABLED=true`, same pattern as the benchmark. CI must stay free and deterministic.
2. **It asserts observability, not just the ticket.** The valuable part is proving the pipeline writes `AiInferenceLog` and `RoutingDecisionLog` on the real path — the thing the dry run can never show.
3. **I do not touch Supabase.** The schema migration and the HR merge are both delivered as reviewed artifacts plus an exact command. Applying them to a live database is the engineer's action, not mine.
4. **Deactivate, never delete.** The HR merge sets `isActive = false` on the old team. With no soft delete anywhere in this schema, deleting is unrecoverable and would SetNull every ticket that referenced it.
5. **Collisions resolve in favour of the surviving team.** Where a unique constraint would break (a user in both teams, a ticket granted to both, both holding an SLA assignment), the `hr-operations` row is dropped rather than moved. The `hr` row already expresses the same fact.
6. **The script is idempotent and transactional.** Safe to run twice; either all of it lands or none of it does.
7. **Dry run first.** The script reports what it would change before changing anything, so the counts can be eyeballed against expectations.

---

## 5. The work

### Part 1 — Live intake test

`test/integration/ai-intake-live.spec.ts`, skipped unless `AI_LIVE_TEST_ENABLED=true`:

- `POST /api/ai/classify` as a requester with a clear IT request
- Assert a ticket row actually exists, with `assignedTeamId` pointing at a **real** team
- Assert `AiInferenceLog` has rows for that run, correlated
- Assert `RoutingDecisionLog` has one row with a sane confidence and `thresholdUsed`
- Assert the tools were called — an empty `toolsCalled` is the signature of the ungrounded failure we just fixed

### Part 2 — Schema migration readiness

- Confirm the migration applies cleanly from scratch (already true: `migrate reset` applies all 47)
- Re-read the hand-edited SQL and confirm it is still additive only
- Produce the exact `prisma migrate deploy` command and the pre-flight checks (direct connection, not the pooler)

### Part 3 — HR merge script

`scripts/merge-hr-teams.sql`, a reviewed SQL script:

1. Resolve both team ids by slug; abort if either is missing
2. **Dry run**: report row counts per affected table
3. Inside one transaction:
   - Delete colliding `TeamMember`, `TicketAccess`, `SlaPolicyAssignment` rows belonging to `hr-operations` where the equivalent `hr` row already exists
   - Move the survivors across all 11 references
   - Copy the detailed description onto `hr`
   - Set `hr-operations.isActive = false`
4. Verify: zero remaining references to the old team, and it is inactive

---

## 6. Files expected to change

```
test/integration/ai-intake-live.spec.ts   (new, opt-in)
scripts/merge-hr-teams.sql                (new)
.env.example                              (AI_LIVE_TEST_ENABLED)
```

No application code changes. Nothing that alters running behaviour.

## 7. Security considerations

- The live test uses the existing test-fixture identity; it creates a ticket in the local test DB only.
- The HR script contains no credentials; the connection is supplied by whoever runs it.
- The script must be run against the **direct** connection (port 5432), not the pooler (6543) — Prisma and multi-statement transactions do not work reliably through pgBouncer in transaction mode.
- No PHI is read or written by either artifact.

## 8. Acceptance criteria

1. `tsc --noEmit` clean in both apps.
2. Unit ≥174 passing, integration ≥349 passing, none broken.
3. The live intake test is **skipped** by default and does not run in CI.
4. With the flag on, it creates a real ticket assigned to a real team, and `AiInferenceLog` + `RoutingDecisionLog` both have rows.
5. The HR script's dry run reports counts without modifying anything.
6. Applied to a copy of dev data, the HR script leaves zero references to `hr-operations` and marks it inactive, with all tickets still assigned to a team.
7. Re-running the HR script is a no-op.

## 9. Checks to run

```bash
cd apps/api && npx tsc --noEmit
cd apps/api && npx jest                                     # unit
cd apps/api && npm run test:integration                     # integration, live test skipped
AI_LIVE_TEST_ENABLED=true npx jest --config ./test/jest.integration.json test/integration/ai-intake-live.spec.ts
```

## 10. Manual test steps

1. Seed dev data locally, run the HR script's dry run, eyeball the counts.
2. Run the script for real against the local DB; confirm zero orphans and the team inactive.
3. Run it a second time; confirm it changes nothing.
4. Run the live intake test with the flag on; confirm a ticket exists and both log tables have rows.
5. For production: take a backup, run the dry run against a restored copy, then apply.

## 11. Out of scope

Applying anything to Supabase or Azure · Key Vault · email intake · deleting the Foundry agents.
