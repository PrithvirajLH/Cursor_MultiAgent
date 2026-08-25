# Implementation Prompt — Per-department Business Hours

**Date:** 2026-08-25
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Closes:** the ADR-008 gap — business hours, timezone and holidays are a single global singleton.

---

## 1. Goal

Let each department keep its own business-hours calendar, timezone and holidays, falling back to an organisation default. Today a 24/7 nursing team would share Finance's 09:00–17:00 calendar, so its escalations pause overnight.

---

## 2. Context read

- `atm-system-architect/references/architecture-decisions.md` — ADR-008: *"Business hours calendar per department… Holiday and timezone aware."*
- `AGENTS.md` §7 — *"business-hours and timezone aware per department"*; §12 — *"Naive elapsed-time math will page people at 3 a.m. for tickets that are not breached."*
- `.cursorrules` — explicit types, no `any`, JSDoc on public methods, kebab-case files.

## 3. Facts established first

| Fact | Consequence |
|---|---|
| `SlaBusinessHoursSetting` has `id String @id @default("global")` and no `teamId` | one calendar for the whole organisation |
| The lookup hardcodes `where: { id: 'global' }` | nothing is team-aware today |
| `getBusinessHoursSettings` caches into a **single slot** with a TTL | once this is per-team, that cache would serve one team's calendar to another. This is the sharpest trap in the change. |
| `addSlaHours` / `subtractSlaHours` take no team; **11 call sites** in `tickets.service.ts` | miss one and it silently uses the wrong calendar — wrong due dates, no error |
| `getSlaConfig(priority, teamId)` already takes a team | the threading pattern already exists to copy |
| The transfer path computes `oldSla` against the old team and `newSla` against the new one | **subtract must use the OLD team's calendar, add must use the NEW team's** — anything else silently mis-dates every cross-team transfer |
| Admin endpoints `GET`/`PATCH /api/slas/business-hours` take no team | needs a team parameter and role scoping |

## 4. Decisions and assumptions

1. **`teamId` is nullable and unique; null is the organisation default.** The existing `global` row keeps `teamId = null` and becomes the fallback. Additive migration, no data moves, no behaviour change until a team row is created.
2. **Resolution order: team row → global row → hardcoded UTC default.** Three levels, so a missing global row can never break SLA maths.
3. **The cache becomes a `Map` keyed by team id.** Not an afterthought — a single-slot cache is a correctness bug the moment calendars differ, and it would present as intermittently wrong due dates, which is close to undiagnosable in production.
4. **Transfer keeps both calendars.** Unwinding the elapsed SLA uses the source team's calendar; the new deadline uses the destination's. Asserted by test, because it is the case most likely to be got wrong and least likely to be noticed.
5. **Role scoping mirrors reports.** OWNER may read and write any team's calendar and the global default; TEAM_ADMIN and LEAD only their own team. Fails closed for anything else, same as `scopeReportQuery`.
6. **No UI.** API and engine only. The admin screen is a separate piece of work.

---

## 5. The work

### Part 1 — Schema

- `SlaBusinessHoursSetting.teamId String? @unique`, relation to `Team`, `onDelete: Cascade` (a deleted team's calendar has no meaning).
- Migration is additive only. Hand-check the generated SQL: `prisma migrate dev` on this repo also emits `DROP INDEX` for six trigram GIN indexes it cannot model, which would destroy ticket and KB search performance. Strip them, as the previous migration documents.

### Part 2 — Resolution and cache

- `getBusinessHoursSettings(teamId: string | null, tx?)` — team row, else global, else UTC default.
- Replace the single-slot cache with `Map<string, CachedSettings>` keyed by `teamId ?? '__global__'`, same TTL.
- Invalidate the affected key when a calendar is written.

### Part 3 — Thread the team through

- `addSlaHours(startAt, hours, businessHoursOnly, teamId, tx?)` and the same for `subtractSlaHours`.
- Update all 11 call sites. In the transfer path, pass the **old** team to `subtractSlaHours` and the **new** team to `addSlaHours`.

### Part 4 — Admin API

- `GET /api/slas/business-hours?teamId=` — omitted means the organisation default.
- `PATCH` the same, creating the team row on first write.
- Role scoping per decision 5, enforced in the service and not only in a guard.

### Part 5 — Tests

Unit, no database:
- team calendar wins over global
- falls back to global when the team has none
- falls back to UTC when neither exists
- **cache isolation** — two teams with different timezones must not see each other's, in either order
- a ticket transferred from a 24/7 team to a 09:00–17:00 team gets a due date computed on the destination calendar
- DST and holiday cases still pass with a team calendar (extend the existing 15)

Integration:
- a LEAD cannot read or write another team's calendar
- an AGENT gets 403

---

## 6. Files expected to change

```
prisma/schema.prisma                                  (teamId on SlaBusinessHoursSetting)
prisma/migrations/<new>/migration.sql                 (generated, hand-checked)
src/tickets/ticket-sla-calculation.service.ts         (resolution, cache, signatures)
src/tickets/ticket-sla-calculation.business-hours.spec.ts   (extend)
src/tickets/tickets.service.ts                        (11 call sites)
src/slas/slas.service.ts                              (team-scoped read/write)
src/slas/slas.controller.ts                           (teamId param)
src/slas/dto/sla-business-hours.dto.ts                (optional teamId)
test/integration/slas.business-hours.spec.ts          (extend)
```

## 7. Security considerations

- Calendar reads and writes are scoped by role **in the service**, so the endpoint does not depend on a guard staying attached — the same failure mode found in `scopeReportQuery`.
- A LEAD writing another team's calendar could shift that team's SLA deadlines, so this is an integrity control, not a convenience.
- No PHI. No new secrets.

## 8. Acceptance criteria

1. `tsc --noEmit` clean in both apps.
2. Unit ≥174 passing, integration ≥349 passing, none broken.
3. A team with its own calendar gets deadlines from it; a team without gets the global default; neither present falls back to UTC.
4. Two teams with different timezones never see each other's calendar, regardless of access order.
5. A ticket transferred between teams with different calendars is unwound on the source calendar and re-dated on the destination.
6. A LEAD receives 403 for another team's calendar; an AGENT receives 403 for any.
7. The generated migration contains **zero** `DROP` statements.
8. All 11 call sites pass a team — verified by the absence of any `addSlaHours`/`subtractSlaHours` call without one.

## 9. Checks to run

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
cd apps/api && npx jest
cd apps/api && npm run test:integration
cd apps/api && npx jest --coverage
```

## 10. Manual test steps

1. Set the global calendar to 09:00–17:00 UTC; create a 24/7 calendar for one team.
2. Raise a SEV2 on that team at 20:00 UTC — the due date must advance immediately, not wait for 09:00.
3. Raise the same on a team with no calendar — it must wait for 09:00.
4. Transfer a ticket from the 24/7 team to the 09:00–17:00 team; confirm the new due date lands inside business hours.
5. As a LEAD of team A, `PATCH` team B's calendar — expect 403.

## 11. Out of scope

Admin UI · Key Vault · email intake · load tests · the coverage floor raise · security scan and WCAG.
