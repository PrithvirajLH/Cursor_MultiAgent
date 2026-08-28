# Implementation Prompt — 1.19 Integration intake endpoint (Power Automate)

**Date:** 2026-08-28
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.19 in `prompts/2026-08-26-restart-master-plan.md` — **new card**, requested by the owner on 2026-08-28 (Power Automate must be able to create a ticket in a named department).
**Closes:** the only endpoint an outside system can reach today is `POST /api/tickets/inbound-email`, which pretends the request is an email and gives the caller **no way to choose the department** — routing rules guess it. Everything else is behind the Microsoft login wall.

**Cost:** none in Azure resources. **One additive migration** (a new channel value) and **one Azure config change** (add the new path to the login-wall exclusion list) — owner's approval needed for that step, no charge.

---

## 1. Goal

`POST /api/tickets/intake`, authenticated by a shared secret header, that creates a ticket for a named person in a **named department**, is safe to retry, and reports itself honestly as channel `API`.

## 2. Context read

- `CLAUDE.md` — baselines **227 unit (28 suites), 401 integration + 1 skipped, 36 web (13 files)**.
- `docs/agent-context/repo-landmines.md` (all — hand-written migrations, never two suites at once, `.env`/`.env.bak`, dev DB lag, busy ports, automation first-match + fire-and-forget enqueue).
- `docs/agent-context/working-agreement.md` — commit discipline.
- `docs/azure-env-inventory.md` — what production has switched on (no SMTP; see §7).
- `apps/api/src/tickets/inbound-email.service.ts` — the existing public-webhook pattern: secret check, requester provisioning, `ticketsService.create(...)`. Copy its shape, not its email semantics.
- `.cursorrules`.

## 3. Facts established first (verified 2026-08-28 by the planning session)

| Fact | Consequence |
|---|---|
| Production Easy Auth (`authsettingsV2`): `enabled: true`, `requireAuthentication: true`, `unauthenticatedClientAction: RedirectToLoginPage`, **`excludedPaths: ["/api/tickets/inbound-email"]`**. An anonymous `POST` to that path returned **403** (the app's own bad-secret answer), proving the exclusion works and the app is reachable. | The new path **must be added to `excludedPaths`** or Power Automate gets 401 from the front door. That is Task 6 (owner / deploy agent). |
| `TicketChannel` enum in the database is `PORTAL | EMAIL` only — but the **web already declares** `export type TicketChannel = "PORTAL" \| "EMAIL" \| "API" \| "AGENT_PORTAL"` (`apps/web/src/api/client.ts:224`), and `ReportsPage.tsx:125-126` lists only Portal/Email as filter options. | Add `API` to the enum (additive `ALTER TYPE … ADD VALUE`). The web type needs no change; add the report filter label. |
| `TicketsService.create(payload, actor)`: `requesterId = payload.requesterId ?? actor.id`; an `EMPLOYEE` actor may only create for themselves; **when `payload.assignedTeamId` is set the routing rules are skipped** (`routedTarget = payload.assignedTeamId ? { teamId, assigneeId: null } : <routing>`); otherwise rules/AI decide. | Explicit department = pass `assignedTeamId`. Omitting it keeps today's rule-based behaviour — make the field **optional**. |
| `inbound-email.service.ts`: `assertInboundEmailWebhookSecret()` (`:522`) does a `timingSafeEqual` compare and throws `ForbiddenException` when the secret is unset or wrong; `findOrCreateInboundRequester(email, name)` (`~:560`) creates an `EMPLOYEE` user when the address is unknown; `toInboundRequesterAuthUser(...)` builds the `AuthUser` passed to `create()`. | Reuse all three ideas with an intake-specific secret. Put the new code in its own service — do **not** grow `inbound-email.service.ts`. |
| The generic `IdempotencyInterceptor` already covers every `POST` when the caller sends an `Idempotency-Key` header: it scopes by key + method + route + actor, replays the stored response with an `Idempotency-Replayed: true` header, and TTLs by `IDEMPOTENCY_TTL_MS` (default 24 h). For public routes the actor is `anonymous:<sha256 of ip + x-forwarded-for + user-agent + x-attachment-scan-secret + x-inbound-email-secret>` (`common/idempotency.interceptor.ts:165-180`). | **Reuse it** — no new receipt table. Two changes: add `x-intake-secret` to that seed list so two integrations with different secrets never share a scope, and **require** the header on this route (the interceptor is opt-in and silently skips when it is absent). |
| `Team` has `slug @unique` and `isActive`; `Category` has `slug @unique` and `isActive`. Nothing currently looks a team up by slug. | Accept `department` and optional `category` as slugs so the flow never handles internal IDs. |
| `@ThrottlePolicy('webhook')` = `RATE_LIMIT_WEBHOOK_LIMIT` (default **30 per 60 s** per IP). | Same policy for intake. Note it in the docs; it is configurable if a flow ever bulk-loads. |
| Attachments on the inbound endpoint fetch remote URLs and carry an SSRF allowlist landmine. | **Attachments are out of scope for this card.** State it in the response docs; a later card can add them. |

## 4. Decisions and assumptions

1. **New route `POST /api/tickets/intake`**, `@Public()`, `@ThrottlePolicy('webhook')`, header `x-intake-secret`, new setting **`INTAKE_API_SECRET`** — separate from the email secret so either can be rotated alone. Missing/unset/wrong → 403, same messages style as the inbound path.
2. **`Idempotency-Key` header is required** on this route: absent → 400 `'Idempotency-Key header is required (use the flow run id)'`. Present → the existing interceptor handles replay. This is the one deviation from "reuse as-is" and it exists because a flow that retries without a key would create duplicates.
3. **Body (all validated):**
   - `requesterEmail` — required, `@IsEmail`. Unknown address ⇒ a new `EMPLOYEE` user is created (same as inbound email).
   - `requesterName` — optional, ≤ 160, used only when creating that user.
   - `subject` — required, 1–200.
   - `description` — required, 1–5000 (matches `CreateTicketDto`, **not** the 20 000 of the email path).
   - `department` — **optional** slug, ≤ 60. Unknown or inactive ⇒ 400 listing the valid slugs. Omitted ⇒ routing rules decide, exactly as today.
   - `category` — optional slug, ≤ 60, same validation.
   - `priority` — optional `SEV1..SEV4`, default `SEV3`.
   - `tags` — optional, ≤ 10 names, ≤ 40 chars each.
   - `sourceRef` — optional, ≤ 120: the caller's own reference (a Form response id, a flow run id). Stored on the creation event for traceability, not on the ticket.
4. **Channel `API`.** Additive enum value; the channel-breakdown report then tells the truth about where tickets come from.
5. **Response 201** `{ id, number, displayId, status, priority, channel, assignedTeam: { id, name, slug } | null, category: { id, name, slug } | null, requester: { id, email, displayName } }` — enough for the flow to reply "your ticket is IS_2026xxxx".
6. **No new module.** `IntakeService` lives in `apps/api/src/tickets/` and is provided by `TicketsModule` (it needs `TicketsService`, `PrismaService`, `ConfigService`, `TagsService` — all already reachable there).
7. **Creation event:** `TicketEvent` type `TICKET_CREATED_VIA_INTAKE` with `{ sourceRef, department, byIntegration: true }` so the timeline shows how the ticket arrived.
8. **No acknowledgement email** is sent by this card — production has no SMTP. The requester gets the normal in-app notification. The flow should tell the user itself. Documented in §7 and the docs file.
9. **The owner's unanswered question** ("what starts the flow") does not block: `requesterEmail` covers both a real person from a Form and a service mailbox, and `department` covers both a form field and a per-flow constant.

## 5. The work

Kill stray node processes; Postgres up; no other test run active; `.env` present.

### Task 1 — Schema and migration

**Files:** Modify `apps/api/prisma/schema.prisma`; Create `apps/api/prisma/migrations/20260828120000_ticket_channel_api/migration.sql`

- [ ] `enum TicketChannel { PORTAL EMAIL API }`.
- [ ] Migration:

```sql
-- Tickets created by an integration (Power Automate and friends) through
-- POST /api/tickets/intake — card 1.19. Additive: one new enum value.
-- HAND-WRITTEN — `prisma migrate diff` also emits the six trigram DROP INDEX and
-- DROP DEFAULT drift statements (repo-landmines.md, Prisma); omitted.
ALTER TYPE "TicketChannel" ADD VALUE 'API';
```

- [ ] `bash scripts/check-migrations.sh origin/main` → `ok`. Apply to the **test** DB (`prisma migrate deploy` with `TEST_DATABASE_URL` as both URLs), `prisma generate`, `tsc` → 0.
- [ ] Commit: `feat(db): API ticket channel for integration intake`.

### Task 2 — DTO and service

**Files:** Create `apps/api/src/tickets/dto/create-intake-ticket.dto.ts`, `apps/api/src/tickets/intake.service.ts`, `apps/api/src/tickets/intake.service.spec.ts`; Modify `apps/api/src/tickets/tickets.module.ts`

- [ ] DTO exactly per §4.3 (one export per file; `@IsIn` for priority via `IsEnum(TicketPriority)`; slugs `@Matches(/^[a-z0-9-]+$/)`).
- [ ] `IntakeService`:
  - `assertIntakeSecret(secret?: string): void` — reads `INTAKE_API_SECRET`; unset → 403 `'Intake API secret is not configured'`; missing → 403 `'Missing intake API secret'`; mismatch → 403 `'Invalid intake API secret'`. Constant-time compare with a length guard (copy `assertInboundEmailWebhookSecret`).
  - `createTicket(payload, secret): Promise<IntakeTicketResponse>`:
    1. `assertIntakeSecret(secret)`.
    2. Resolve department: if `payload.department`, `team.findFirst({ where: { slug, isActive: true } })`; not found → `BadRequestException` listing active slugs (`'Unknown department "x". Valid: it-service-desk, hr, …'`).
    3. Resolve category the same way when provided.
    4. Find-or-create the requester by lowercased email (own private method, modelled on `findOrCreateInboundRequester`; role `EMPLOYEE`, `displayName = requesterName?.trim() || email`).
    5. Build the requester `AuthUser` (copy `toInboundRequesterAuthUser`) and call `ticketsService.create({ subject, description, priority: payload.priority ?? SEV3, channel: TicketChannel.API, requesterId, assignedTeamId: team?.id, categoryId: category?.id, tags: payload.tags }, requesterAuth)`.
    6. Write the `TICKET_CREATED_VIA_INTAKE` event (§4.7) — non-blocking `catch` + log, like the other observability writes.
    7. Return the §4.5 shape.
  - Type `IntakeTicketResponse` in its own file `intake-ticket-response.type.ts`.
- [ ] `TicketsModule.providers` += `IntakeService`.
- [ ] Unit spec: secret unset / missing / wrong / right (mock `ConfigService`); unknown department message includes the valid slugs; default priority `SEV3`; `create` is called with `channel: 'API'` and the resolved `assignedTeamId` (mock `TicketsService`).

### Task 3 — Controller and required idempotency key

**Files:** Modify `apps/api/src/tickets/tickets.controller.ts`, `apps/api/src/common/idempotency.interceptor.ts`

- [ ] Route, next to `inbound-email`:

```ts
  @Post('intake')
  @Public()
  @ThrottlePolicy('webhook')
  async intake(
    @Body() payload: CreateIntakeTicketDto,
    @Headers('x-intake-secret') intakeSecret: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException(
        'Idempotency-Key header is required (use the flow run id)',
      );
    }
    return this.intakeService.createTicket(payload, intakeSecret);
  }
```

      Inject `IntakeService`; import `BadRequestException` if not already imported.
- [ ] `idempotency.interceptor.ts`: add `this.readHeaderValue(request.headers['x-intake-secret'])` to the anonymous-actor `seed` array (§3 row 5). One line; keep the order stable and note in the comment that changing the seed invalidates in-flight keys.

### Task 4 — Integration tests

**Files:** Create `apps/api/test/integration/tickets.intake.spec.ts`

- [ ] `test/setup-tests.ts` pins secrets for the suite — add `process.env.INTAKE_API_SECRET = 'test-intake-secret'` beside the inbound one (that file is in scope for this card).
- [ ] Cases:
  1. No secret header → 403; wrong secret → 403.
  2. Valid secret, no `Idempotency-Key` → 400 with the required-header message.
  3. Happy path with `department: 'hr'` → 201; response has `displayId`, `channel: 'API'`, `assignedTeam.slug === 'hr'`; the ticket in the database has that team **even though a routing rule points elsewhere** — create an active routing rule matching the subject and targeting IT first, to prove the explicit department wins.
  4. Same call repeated with the **same** `Idempotency-Key` → same ticket id, response header `Idempotency-Replayed: true`, and only one ticket exists.
  5. Unknown department `'nope'` → 400 and the message lists valid slugs.
  6. Unknown requester email → a new `EMPLOYEE` user exists with that email; a second intake for the same address reuses it (no duplicate user).
  7. Omitted `department` → routing rules decide (assert the ticket landed on the rule's team).
  8. Validation: empty subject → 400; 201-char subject → 400; `priority: 'SEV9'` → 400; 11 tags → 400.
  9. Timeline: `GET /api/tickets/:id/events` contains `TICKET_CREATED_VIA_INTAKE` with the `sourceRef`.
- [ ] Run the spec alone, then the **full** suite to a file. Expect **401 + 9 = 410 passed, 1 skipped** — the real number wins.

### Task 5 — Docs and web report label

**Files:** Create `docs/integration-intake-api.md`; Modify `apps/api/.env.example`, `docs/azure-env-settings.md`, `apps/web/src/pages/ReportsPage.tsx`, `CLAUDE.md`, `docs/agent-context/repo-landmines.md`

- [ ] `docs/integration-intake-api.md` — the page you would hand to whoever builds the flow: the URL, the two required headers, the full body with every field and its limits, the exact valid department slugs (list the five current ones and say they come from Team.slug), a copy-pasteable `curl`, a Power Automate **HTTP action** example (method, URI, headers, body with `@{workflow()['run']['name']}` as the Idempotency-Key), every error code with its meaning (400 validation / 400 missing key / 403 bad secret / 429 rate limit / 201 success), the 30-requests-per-minute limit, and two plain warnings: **no acknowledgement email is sent** (no SMTP in production — the flow must tell the user) and **attachments are not supported yet**.
- [ ] `.env.example`: `INTAKE_API_SECRET=` under a new `# ── Integration intake` header with a one-line comment.
- [ ] `docs/azure-env-settings.md`: the same variable in a short "Integration intake" group, plus one sentence that the path must be in Easy Auth's excluded paths.
- [ ] `ReportsPage.tsx:125-126`: add `{ value: "API", label: "Integration" }` to the channel filter list.
- [ ] Baselines in `CLAUDE.md` and `repo-landmines.md` (real numbers; migration count becomes **51**).
- [ ] Commit by explicit path (read `git status --short` first).

### Task 6 — Production enablement (owner / deploy agent — NOT the implementer)

Listed here so it is not forgotten; **do not run it in the implementer session.**

1. Set the secret (one call, value never printed):
   ```bash
   TOKEN=$(openssl rand -hex 24)
   az webapp config appsettings set -g csnhc-ai -n TicketTicket --settings INTAKE_API_SECRET="$TOKEN" --query "[].name" -o tsv
   az keyvault secret set --vault-name CSNHC-WebApps --name TicketTicket-intake-secret --value "$TOKEN" --query name -o tsv
   ```
2. Add the path to the login-wall exclusions (currently only the inbound-email path):
   ```bash
   az webapp auth update -g csnhc-ai -n TicketTicket \
     --excluded-paths "/api/tickets/inbound-email" "/api/tickets/intake"
   ```
   Verify: anonymous `curl -s -o /dev/null -w '%{http_code}' -X POST …/api/tickets/intake` → **403** (app answering), not 401 (front door). `/` must still redirect to login.
3. Hand the secret to whoever builds the flow **out of band** (Key Vault link, not chat).

## 6. Files expected to change

`prisma/schema.prisma` · `migrations/20260828120000_ticket_channel_api/migration.sql` (new) · `tickets/dto/create-intake-ticket.dto.ts` (new) · `tickets/intake.service.ts` (new) · `tickets/intake-ticket-response.type.ts` (new) · `tickets/intake.service.spec.ts` (new) · `tickets/tickets.controller.ts` · `tickets/tickets.module.ts` · `common/idempotency.interceptor.ts` · `test/setup-tests.ts` · `test/integration/tickets.intake.spec.ts` (new) · `.env.example` · `docs/integration-intake-api.md` (new) · `docs/azure-env-settings.md` · `apps/web/src/pages/ReportsPage.tsx` · `CLAUDE.md` · `docs/agent-context/repo-landmines.md`. Nothing else — if `tickets.service.ts` needs a change, stop and report (it should not: `create()` already accepts everything needed).

## 7. Security considerations

- **A shared secret is the only gate.** Anyone holding it can create tickets for any email address, in any department. That is the same trust level as the existing inbound-email webhook. Keep it in Key Vault, rotate it if a flow is decommissioned, and never put it in a doc or chat. Consider a second secret per integration later (card 2.6's API keys).
- **Requester spoofing is possible by design** (the caller names the requester). Acceptable for an internal Power Automate flow inside the tenant; note it in the docs so nobody exposes the secret outside.
- The endpoint creates users. A typo'd address creates a stray `EMPLOYEE` user — harmless, and card 0.8's retention/soft-delete work covers cleanup.
- No attachments ⇒ no SSRF surface (unlike the inbound-email path).
- Rate-limited at 30/min per IP; a `429` is the correct answer to a runaway flow.
- The `Idempotency-Key` requirement prevents a retrying flow from filling the queue with duplicates.
- Easy Auth exclusion is **path-exact** — adding `/api/tickets/intake` does not expose anything else.

## 8. Acceptance criteria

1. Nine integration cases pass; full suite = 401 + 9, 1 skipped; unit 227 + new; both `tsc` clean; vitest 36; migration `ok`; test DB at 51 migrations with six trigram indexes intact.
2. In dev: `curl` with the secret, an `Idempotency-Key` and `"department": "hr"` returns 201 with `channel: "API"` and the HR team; repeating the exact call returns the same ticket with `Idempotency-Replayed: true`; the ticket appears in the HR queue in the UI with the timeline line showing it arrived via integration.
3. Without the secret → 403; without the key → 400; unknown department → 400 listing valid slugs.
4. `docs/integration-intake-api.md` is complete enough that someone can build the flow from it without reading code.
5. Baselines updated.

## 9. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review"
bash scripts/check-migrations.sh origin/main
cd apps/api && npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npx jest --config ./test/jest.integration.json test/integration/tickets.intake.spec.ts > ../../it-intake.txt 2>&1; grep Tests: ../../it-intake.txt
npx jest --config ./test/jest.integration.json test/integration/security.idempotency.spec.ts test/integration/tickets.inbound-email.spec.ts > ../../it-idem.txt 2>&1; grep Tests: ../../it-idem.txt
npm run test:integration > ../../int-full.txt 2>&1; grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

(The second command matters: the interceptor seed change must not break the existing idempotency or inbound-email specs.)

## 10. Manual test steps

Dev DB first: `npx prisma migrate deploy` from `apps/api` with the normal `.env` (Datasource must show port **5432**; expect exactly 1 pending → 51). Start the dev API with `INTAKE_API_SECRET=devintake PORT=3077` (process env, do not edit `.env`).

```bash
curl -i -X POST http://localhost:3077/api/tickets/intake \
  -H "Content-Type: application/json" \
  -H "x-intake-secret: devintake" \
  -H "Idempotency-Key: manual-test-1" \
  -d '{"requesterEmail":"pa.test@csnhc.com","requesterName":"PA Test",
       "subject":"[1.19 manual] Printer jam on 2nd floor",
       "description":"Submitted from a Power Automate flow test.",
       "department":"hr","priority":"SEV3","tags":["power-automate"],
       "sourceRef":"manual-run-1"}'
```

Expect 201 with the HR team. Repeat verbatim → same ticket, `Idempotency-Replayed: true`. Then: wrong secret → 403; drop the key → 400; `"department":"nope"` → 400 with the slug list. Open the ticket in the web UI (HR queue) and confirm the timeline shows the integration line. Delete the probe ticket and the `pa.test@csnhc.com` user afterwards; stop the server; zero repo node processes.

## 11. Handoff notes — what to report back

1. Commit SHA(s). 2. Guard line for the migration; test-DB migration and trigram counts. 3. `Tests:` lines (unit, intake spec, the idempotency + inbound-email specs, full suite), vitest, both `tsc`. 4. `git diff --stat <pre-card sha> HEAD`. 5. Dev-DB `migrate status` before/after. 6. The manual `curl` outputs (headers + body, secret redacted). 7. Anything that did not match — especially whether the interceptor seed change disturbed any existing spec, and whether `ticketsService.create` accepted `channel: 'API'` and `tags` without modification.
