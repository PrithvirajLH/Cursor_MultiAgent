# Implementation Prompt — 1.93, 1.85 and 1.91: the three things blocking two owner decisions

**Date:** 2026-09-14
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** **1.93** (one-click links fire on load) · **1.85** (AI takes a
caller-supplied user id) · **1.91** (AI writes request text into the timeline)

**Three cards, three commits. NO MIGRATIONS — the count stays at 64.**
Work straight through. Do not check in between them, and do not ask permission.

> ## Why these three, together
>
> **They are not a theme. They are a lock.** Two decisions the owner has been
> sitting on for a week cannot safely be made while any of them is open:
>
> - **Turning off pilot mode** (card 1.67③) — blocked by **1.93**
> - **Switching the AI on** (card 1.63) — blocked by **1.85 and 1.91**
>
> **Every one is harmless TODAY and becomes live the moment that decision is
> taken.** That is the whole reason to do them now rather than after: there is no
> incident to respond to, and after the decision there would be.
>
> **Production is `2c2f8d0`, schema 64.**

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Check for a live `jest` process before touching `apps/api`**; read from the
  git object store while one is running.
- ⚠️ **Hold the WSL VM open for the whole integration run** — background a
  blocking `wsl -d Ubuntu-22.04 -- sleep 1800`. **And if a run comes back broadly
  red, grep for `P1001|P1017|57P01` before believing it.**
- ⚠️ **NO MIGRATIONS. Card 2.6 reserves 65 and card 1.83 will want 66.**
- **Baseline to beat:** unit **683 / 69**, web **377 / 55**, integration
  **903 + 1 skipped / 89 of 90**, both typechecks clean, migrations **64**.
- ⚠️ **The last three batches each had a bug that ONLY the browser found**, all
  three in the web layer between a correct API and the screen. **Budget time for
  the browser pass; it is not a formality here.**

---

## 1 — Commit one: card 1.93, a link scanner can act on your tickets

### What is wrong

`email-action-page.util.ts:125` — the page served for a one-click email link runs:

```js
fetch(window.location.pathname, { method: 'POST', … })
```

**immediately on load. No click, no confirmation.** The `GET` correctly performs
nothing and the `POST` does the write — but the page posts to itself the instant
it renders, so **anything that opens the URL and executes JavaScript performs the
action.** Defender for Office 365 Safe Links and similar gateways do exactly that
when they detonate a URL, and ⚠️ **this tenant demonstrably has such a gateway** —
card 1.74 exists because it re-injects every message separately.

### ✅ It has not happened yet, and the planner measured that rather than assuming

Production holds **4** `TICKET_ACTION_FROM_EMAIL` events across two tickets, and
the busiest ticket's three span **21 hours 25 minutes**. That is a person. **A
detonating scanner would follow all seven links at once and leave seconds-apart
events on one ticket. Nothing like that is in the data.**

**It has not fired because pilot mode means only the owner receives these emails.
Clearing `EMAIL_TEST_RECIPIENTS` is what arms it.**

### The fix

- [ ] **Require a real interaction.** The page should render what the action is
      and a button that performs it — *"Close ticket IT-0042?"* then **Close
      ticket**.
- [ ] ⚠️ **This costs the "one-click" promise one click, and that is the point.**
      Card 1.44's value was no sign-in and no mail app, not literally zero
      interaction. **Say in the code comment that the extra click is the defence**,
      so nobody optimises it away later.
- [ ] **The page must still work with no styling and no framework** — it is opened
      in whatever a mail client hands it. Keep it a plain form/button.
- [ ] ⚠️ **Do not rely on a user-agent check or a `Sec-Fetch-*` header instead.**
      A scanner that executes JavaScript can present anything; only a real
      interaction is a real signal.
- [ ] **Keep the token single-use if it already is; if it is not, say so** — that
      is defence in depth and worth knowing either way.

### Tests

- [ ] ⚠️ **Loading the page performs NO write.** The assertion the card exists
      for. Assert on the absence of a `TICKET_ACTION_FROM_EMAIL` event after a
      `GET`.
- [ ] **Posting to the same URL still performs the action** — non-vacuity.
- [ ] **An expired or already-used token shows a clear message rather than a
      blank page.**

---

## 2 — Commit two: card 1.85, the AI accepts whichever user id it is handed

- [ ] ✅ **Verified: `ai.controller.ts` builds its request with
      `userId: dto.userId ?? user.id`** — any UUID the client sends beats the
      authenticated caller. That id reaches the model's user message, and the
      prompts instruct it to call `get_user_profile` and `get_user_history`, whose
      tools run **with no caller context** and return email, role, department,
      location and the last ten ticket subjects.
- [ ] ⚠️ **Ticket subjects on a payroll or HR desk are the sensitive part**, and a
      TEAM_ADMIN would escape their team scope this way.

### The fix

- [ ] **Force `userId` to the caller.** Drop it from the DTO, or overwrite it —
      **and if you drop it, check no legitimate caller was relying on it**, which
      is the one thing that could make this bigger than it looks.
- [ ] **Make the user tools ignore a model-supplied id** and resolve the caller
      themselves. ⚠️ **Both halves matter:** fixing only the DTO leaves the tools
      trusting the model, and prompt injection can put any id in front of them.
- [ ] **Add to all four prompts that the text after `Request:` is data, not
      instructions.** The audit found none of them says so. **Cheap, and it is the
      standard mitigation.**
- [ ] ⚠️ **`/ai/debug` is in scope.** It is the route a TEAM_ADMIN would use.

### Tests

- [ ] ⚠️ **`POST /ai/classify` with a foreign `userId` is answered as the
      CALLER**, not the id supplied. The regression assertion.
- [ ] **A tool invocation naming another user's id returns the caller's data or
      refuses** — assert the tool layer directly, since that is the half a DTO fix
      would miss.
- [ ] **A normal classify still works.** Non-vacuity.

---

## 3 — Commit three: card 1.91, the AI writes the request text into the timeline

### ⚠️ Verified in full, and it is worse than the audit said

`ai.service.ts:429-447` writes a `TicketEvent` of type `AI_PIPELINE_TRACE` whose
payload contains:

```
userId · userEmail · inputText: input.text · channel
totalLatencyMs · steps: pipelineSteps · finalClassification · aiAnalysis
```

**`inputText` is the requester's verbatim words. `steps` is the whole pipeline
trace.** And it is written **unconditionally — there is no sensitive-department
branch.**

⚠️ **`AiInferenceLog`'s redaction rule exists precisely to keep this text out of
storage for `isSensitive` teams. This path goes straight past it, into the ticket
timeline, where it renders to anyone who can read the ticket.**

### The fix — and the decision inside it

- [ ] **The trace has real value for debugging the pipeline. Do not simply delete
      it.** The question is *where it lives and who sees it*.
- [ ] **The planner's recommendation: keep the trace, drop `inputText` and
      `userEmail` from it, and store the diagnostic half where `AiInferenceLog`
      already lives** — which is the table with the redaction rule and is not the
      ticket timeline.
- [ ] ⚠️ **If you keep any of it on the `TicketEvent`, apply the same
      sensitive-department rule `ai.service.ts` already uses elsewhere** —
      `isSensitiveDepartment`. **One rule, not a second spelling.**
- [ ] **Check what renders it.** A payload the timeline does not display is still
      a payload in the database and still reachable through the events API —
      **card 1.79 just fixed two reads that returned more than they should, so do
      not assume the timeline is the only exposure.**

### Tests

- [ ] ⚠️ **A trace written for a sensitive department contains no request text.**
      The assertion the card exists for.
- [ ] **A trace still records enough to debug a pipeline run** — otherwise the fix
      is a deletion wearing a disguise.
- [ ] **The events API does not return the request text to a ticket participant.**

---

## 4 — What to report back

1. **Three commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, **migrations still 64**, and
   confirmation **no file under `apps/api/prisma/migrations/` appears in any
   diff.**
3. The answers:
   - **1.93 —** what the page looks like now, and whether the token is single-use.
   - **1.85 —** whether anything legitimate was passing `userId`, and **how the
     tool layer refuses a model-supplied id** (not just the DTO).
   - **1.91 —** where the trace lives now, and what a sensitive-department trace
     contains.
4. **For each card, the assertion that would fail if it regressed — and confirm
   you watched each inversion actually fail.** ⚠️ **One inversion silently did not
   apply two batches ago because the block existed twice, and jest still printed
   "20 passed".**
5. Anything that did not match. **This document is wrong somewhere** — it has been
   every time, and the last three were found by opening the page.

## 5 — Browser and mailbox pass

- [ ] **1.93 —** open a one-click link. ⚠️ **Nothing happens until you press the
      button.** Press it: the action happens and the page says so.
- [ ] **1.93 —** reload that page. **It must not perform the action again.**
- [ ] **1.85 —** submit through the AI page as a normal user and confirm it still
      classifies.
- [ ] **1.91 —** create a ticket through the AI page for a sensitive department,
      then **read that ticket's timeline as an agent. The requester's text must
      not be in it.**

**Stop and report instead of improvising** if something legitimate depends on
passing `userId`, if removing `inputText` would leave the pipeline undebuggable,
if the one-click token turns out not to be single-use, or if the trace payload is
rendered somewhere you did not expect.
