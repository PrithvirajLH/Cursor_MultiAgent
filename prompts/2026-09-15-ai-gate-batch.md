# Implementation Prompt — 1.106, 1.107, 1.108: what has to be true before the AI is switched on

**Date:** 2026-09-15
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** **1.106** (there is no kill switch) → **1.107** (raw error text goes to
whoever asked) → **1.108** (a cast is not a check)

**Three cards, three commits. No migration.**

> ## Why these three, and why now
>
> **Card 1.63 is an open question on the owner's desk: should an inbound email
> with no department be classified by the AI?** Three blockers for that decision
> shipped in the last deploy — 1.85, 1.91 and 1.79.
>
> ⚠️ **These are the three that are left, and they only matter the day the answer
> is yes.** Today the AI runs on exactly one page that almost nobody uses, so all
> three are latent. **The moment it sits in front of inbound email, all three are
> live at once.**
>
> **Building them now means the owner's answer can be "yes" without a second
> round of work.**

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Check the tree is yours:** `git status --porcelain | grep -v '^??'` —
  anything modified under `apps/` that is not yours means **STOP**.
- ⚠️ **Hold the WSL VM open** for every integration run:
  `wsl -d Ubuntu-22.04 -- sleep 2100` in the background.
- **Baseline to beat:** unit **765 / 78**, web **385 / 56**, integration
  **963 + 1 skipped / 96 of 97**, both typechecks clean, migrations **67**.
- ⚠️ **A deploy of `410da33` may be running.** This batch takes **no migration**;
  confirm that is still true rather than assuming.

---

## 1 — Commit one: card 1.106, `AI_PIPELINE_ENABLED` is a switch wired to nothing

### What is wrong

✅ **Measured against production 2026-09-15, not inferred:**
`AI_PIPELINE_ENABLED` **is set on the App Service** (value length 4 — it is
`true`). ✅ **And it is read by nothing:** `grep -rn AI_PIPELINE_ENABLED
apps/api/src apps/web/src` returns **zero hits**. It appears only in
`.env.example`, `docs/azure-env-inventory.md` and planning documents.

⚠️ **This is worse than dead documentation, which is how it has been filed
twice before** (master plan `:293`, `docs/azure-env-inventory.md:82`). **It is a
control that looks live.** Somebody reading the App Service settings today would
reasonably conclude the AI can be turned off from there. **It cannot.**

**The only way to stop the pipeline today is to blank
`AZURE_AI_FOUNDRY_ENDPOINT` or `AZURE_AI_FOUNDRY_API_KEY`**, because
`foundry-client.service.ts:105-106` reads them with `getOrThrow`. That is a
destructive, fiddly action taken under pressure — and it also flips
`/api/health/ready` to `aiPipeline: disabled`, so **the kill switch and the
health signal are the same lever.** You cannot turn the AI off without making
the readiness report claim it is misconfigured.

### The fix

- [ ] **Read `AI_PIPELINE_ENABLED` in `ai.service.ts` and refuse early when it is
      not `true`.** Default to **enabled when unset**, so no existing environment
      changes behaviour on deploy.
- [ ] ⚠️ **Refuse BEFORE any model call and before any row is written.** A kill
      switch that still burns a Foundry call is not a kill switch.
- [ ] **Return the pipeline's existing shape, not a new one.** There is already a
      `{ status: 'error', step, error }` envelope; a disabled pipeline should be
      distinguishable from a broken one — **`status: 'disabled'` or equivalent, and
      say which you chose and why.**
- [ ] ⚠️ **Separate the kill switch from the health signal.**
      `health.service.ts:93-98` reports `aiPipeline` on credential presence alone.
      **It should report "configured but switched off" distinctly from "not
      configured".** Those are different operational facts and today they collapse.
- [ ] **Fix `.env.example`'s comment**, which currently says the opposite —
      `prompts/2026-08-26-0-5-readiness-endpoint.md:486` deliberately wrote *"Not
      read by the code"* there, and that instruction is now obsolete. **Update
      `docs/azure-env-inventory.md:82` too.**
- [ ] ⚠️ **Do NOT also implement `AI_PIPELINE_TIMEOUT_MS`** (audit F-057). It is
      the same class of dead setting and it is a separate decision. **Say you left
      it, don't quietly do it.**

### Tests

- [ ] **`AI_PIPELINE_ENABLED=false`: `POST /api/ai/classify` creates no ticket, no
      `AiInferenceLog` row, and makes no Foundry call.** The assertion the card
      exists for — **assert the client was not called**, not just that the response
      was an error.
- [ ] **Unset: behaves exactly as today.** Non-vacuity — a fix that disables the
      pipeline for everyone passes the first test.
- [ ] **`=true`: behaves exactly as today.**
- [ ] **Readiness distinguishes switched-off from not-configured.**

---

## 2 — Commit two: card 1.107, the raw error goes to whoever asked

### What is wrong

✅ **Verified at `ai.service.ts:216-220, 244-248, 295-299, 416-420`** — four
sites, all the same shape:

```ts
return {
  status: 'error',
  error: `Intent extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
  step: 'intent_extraction',
};
```

**`POST /api/ai/classify` has no role guard** — `ai.controller.ts:24-40` takes
`@CurrentUser()` and nothing else — so **any EMPLOYEE can call it and read
whatever the Azure SDK put in `.message`**: endpoint hostnames, deployment and
model names, region, request ids, quota and billing states, and sometimes a
fragment of the request that failed.

⚠️ **This is card 1.57 in the other direction.** That card stopped credentials
being written into the log. **This one hands infrastructure detail straight back
over HTTP to the least privileged role in the system.** The log at least needed
Azure access to read.

### The fix

- [ ] **Log the full error server-side** — `this.logger.error` already does, keep
      it — **and return a stable, generic message to the caller.**
- [ ] ⚠️ **Keep the `step` field.** It is useful, it is not sensitive, and the web
      page uses it. **Do not flatten the envelope while you are in here.**
- [ ] **Give the caller a correlation id** so a person reporting *"the AI failed"*
      can be matched to the logged error. `correlationIdMiddleware` already exists
      (`main.ts:23`) — **reuse it rather than inventing a second id.**
- [ ] ⚠️ **`AiDebugPage` is the one place detail is legitimately wanted.** Decide
      deliberately whether the full text stays available to an OWNER there, **and
      say which you chose.** If it does, it must be gated on role at the API, not
      by which page called.
- [ ] **All four sites, not the first one.** ⚠️ **This is the fifteenth time this
      project has had one rule answered in several places.** Consider one helper.

### Tests

- [ ] **An EMPLOYEE gets the generic message, and the response body does not
      contain the raw error text.** ⚠️ **Assert on the serialised payload, not on a
      field** — twice this month a field-level assertion passed while the data
      still went out (card 1.96's follower route, the AI canary).
- [ ] **The full text IS in the log.** Non-vacuity — a fix that throws the detail
      away entirely passes the first test and is worse.
- [ ] **One test per site, or one parameterised test naming all four.**

---

## 3 — Commit three: card 1.108, a cast is not a check

### What is wrong

✅ **Verified at `ai/tools/ticket-tools.service.ts:44`:**

```ts
priority: input.draft.priority as 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4',
```

⚠️ **That is a TypeScript cast. It is erased at runtime and checks nothing.**
The model can return any string and it reaches `ticketsService.create`, which
✅ **was verified not to validate either** — `:1836-1846` passes `subject`,
`priority` and `categoryId` straight through to the database.

**Four values arrive from the model with no runtime check:**

| | |
|---|---|
| `priority` | a cast only |
| `subject` | no length check against a **`VarChar(200)`** column |
| `categoryId` | existence not checked |
| `assignedTeamId` | existence only (`resolveTeamId:726-731`) |

⚠️ **AND THE DTO LAYER DOES NOT COVER THIS PATH, WHICH IS THE POINT.**
`create-ticket.dto.ts` has `@MaxLength(200)` and a priority enum validator, and
**they never run here**, because `create` is called **in-process** rather than
over HTTP. **The DTO guards the front door and this path comes in through the
side.** That is exactly the shape card 1.105 just fixed on the inbound-email
side, one caller over.

**So a model that returns a 400-character subject produces a `P2000` that
discards the request** — the same failure card 1.105 exists to prevent, arriving
by a different road.

### The fix

- [ ] ⚠️ **Validate at the service, not by adding a DTO.** A DTO would not run.
      **Say where you put it and why that place covers every caller.**
- [ ] **`priority`: a real runtime check against the enum**, falling back to a
      documented default rather than throwing. **An unroutable ticket is better
      than a lost one** — card 1.105's principle, same reasoning.
- [ ] **`subject`: truncate, do not throw.** ✅ **`truncateInboundSubject` in
      `inbound-email.service.ts` already does exactly this, including the ellipsis
      and the 200 limit.** ⚠️ **Reuse it. Do not write a second one** — this is the
      sixteenth chance to write one rule twice, and the first fifteen are on the
      board.
- [ ] **`categoryId`: verify it exists and is active before use**, drop it
      otherwise. `resolveTeamId:736` already requires `isActive` for the name
      fallback — **follow that precedent.**
- [ ] ⚠️ **Record when a model value was rejected or coerced.** A silently
      corrected value is invisible; card 1.105's dropped-attachment event is the
      pattern. **Without it nobody can ever tell how often the model is wrong**,
      which is the number that decides whether the confidence threshold is right.

### Tests

- [ ] **A model returning `priority: 'URGENT'` still creates a ticket, at the
      documented default, and records that it was coerced.**
- [ ] **A 400-character model subject creates a ticket with a 200-character one.**
- [ ] **A model returning a `categoryId` that does not exist still creates a
      ticket.**
- [ ] **A well-formed model response is completely unaffected.** Non-vacuity.

---

## 4 — What to report back

1. **Three commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, the migration count (**67,
   unchanged**), and `check-migrations.sh`.
3. The answers:
   - **1.106 —** what a disabled pipeline returns, and how readiness now
     distinguishes switched-off from not-configured.
   - **1.107 —** whether an OWNER can still see the raw text, and where you put
     the single helper.
   - **1.108 —** where the validation lives and why that covers every caller;
     and **confirmation you reused `truncateInboundSubject` rather than writing a
     second truncator.**
4. **For each card, the assertion that would fail if it regressed — and confirm
   you watched each inversion actually fail.**
5. Anything that did not match. **This document is wrong somewhere.**

## 5 — Browser pass

- [ ] **1.106 —** with the flag off, submit through `/submit`. **The page says
      something sensible rather than showing a stack trace or hanging.**
- [ ] **1.107 —** force a failure (blank the Foundry key locally) and submit as an
      EMPLOYEE. **The screen must not show an Azure endpoint or deployment name.**
- [ ] **1.106 —** `/api/health/ready` reports the switched-off state distinctly.

**Stop and report instead of improvising** if the kill switch cannot be placed
before the first model call without restructuring the pipeline, if
`truncateInboundSubject` cannot be reused without a circular import (card 1.103
spent a batch on exactly that), or if separating the readiness signal from the
credential check would change what `/api/health/ready` returns for any
configuration that exists today.
