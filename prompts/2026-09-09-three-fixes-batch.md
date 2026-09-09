# Implementation Prompt — three fixes, in order

**Date:** 2026-09-09
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** 1.54, 1.55, 1.56 — **in that order**

**One commit per card. Three commits.**

**Work straight through all three. Do not check in between cards, and do not ask
permission to proceed.** Then one browser pass, per §5.

> **Card 1.53 is deliberately NOT in this batch, and it is not an oversight.**
> Its design is decided and it is ready to build — but it needs **migration 59**,
> and there are currently **two GREEN batches sitting undeployed at migration 58**.
> Adding 59 now would silently invalidate
> `prompts/2026-09-08-deploy-six-card-batch.md`, whose gate says *"stop if anything
> other than migration 58 is pending."* **1.53 gets its own handoff the moment the
> deploy lands.** Do not start it, and **do not write migration 59.**

---

## 0. How to work through this

- **Read `CLAUDE.md` first.** Baselines: api `tsc` 0, unit **519 / 51**,
  integration **699 + 1 skipped, 69 of 70**, web `tsc` 0, vitest **212 / 32**.
  Migrations **58** in the tree, **57** applied in production.
- ⚠️ **NO card here needs a migration. The count must still be 58 when you
  finish.** If you think you need one, **stop and report** instead.
- ⚠️ **Before you start an integration run, check for surviving jest processes
  and kill them.** A harness reporting a run as killed is **not** evidence that
  it stopped — this cost most of a day on 2026-09-09, producing two failures that
  were pure phantoms:
  ```
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*jest*' }
  ```
  And **exit 127 with no summary is a spawn failure, not a test failure** — stale
  node processes exhaust handles and each suite's reset spawns `npx` two or three
  times. Both are now in `repo-landmines.md`. A clean run takes **~13 minutes**.
- ⚠️ **The Playwright MCP server is down** and does not recover without a session
  restart. If your browser pass needs it, restart first rather than skipping the
  pass silently.
- **Never edit source while an integration suite is running.**
- **Trust a live run over this document.** Handoffs from this planner have carried
  a wrong line number, a stale premise, an invented file reference, a claim that a
  card could not be browser-verified when it could, and — on card 1.55 below — a
  flatly wrong statement about how many callers a function has. **Say where this
  is wrong.**

---

## 1 — Card 1.54: an expired session says "Unable to load tickets" (S–M, no migration)

**This is the only card in this batch the owner is personally hitting, and they
called it "some serious bug". It is not a server bug. Read this section before
touching anything, because the diagnosis is already done and the obvious fix is
not the valuable one.**

### What was established from the production log, 2026-09-09

**Eleven `401`s in a single 70 ms burst at 13:36:30.954–31.021** — the ten sidebar
count queries plus
`/api/tickets?page=1&pageSize=50&scope=assigned&sort=updatedAt&order=desc&statusGroup=open`
**twice**, which is exactly *Assigned to Me + Open*, the screen in the owner's
screenshot.

Whole day: **1030 × 200, 227 × 304, 11 × 401, 5 × 201.** **Zero 5xx. Zero 429.**
`pid 1867` constant all day, so **no container restart** and no cold JWKS cache.
**Every request on the page failed at once**, and the cause is the token.

**Why it looks like only the list broke:** `useViewCounts` sets
`placeholderData: (prev) => prev` (`shell/use-view-count.ts`), so each badge keeps
its **last good number** when a refetch fails. The counts the owner saw were
**stale**. The list has no placeholder, so only it showed an error.

### 1a. The half that matters most: log why a token was rejected

- [ ] ⚠️ **`auth.guard.ts` has twenty distinct `UnauthorizedException` paths** —
      `Token expired`, `Token is not active yet`, `Invalid token issuer`,
      `Invalid token audience`, `Invalid token signature`,
      `Unsupported token algorithm`, `Token must include email claim`,
      `Unknown user`, `Bearer token is required`,
      `Invalid Azure JWKS configuration`, and more. **The log records only
      `statusCode: 401`. Nothing distinguishes them.**
- [ ] **That is why a bug the owner hits frequently cannot be diagnosed. Fix this
      first**, and it makes the rest of this card answerable instead of
      speculative.
- [ ] Log the **reason** — the exception message, and the offending claim value
      where it is safe (`aud`, `iss`, `exp`) — plus the request id already in the
      log line.
- [ ] ⚠️ **Never log the token, and never log a whole decoded payload.** An
      id_token is a credential and the log ships to Kudu. Log the claim you
      checked, not the bearer.
- [ ] It must be greppable. Someone reading a 2 MB container log at 3 a.m. needs
      one distinctive string per cause.

### 1b. An auth failure must not be dressed as a data-loading failure

- [ ] *"Unable to load tickets"* with a **Retry** button is the wrong surface.
      **Retry cannot fix an expired session** — the owner clicks it, it fails
      again, and that is exactly what "frequently" feels like from the outside.
- [ ] Say the session expired, and re-authenticate. **A silent redirect is
      acceptable; a dead panel is not.**
- [ ] ⚠️ **Do not make the sidebar counts show stale numbers next to an auth
      error.** Whatever you do here, a page whose requests are all 401ing must not
      display figures that look live. That contradiction is what made the owner
      think one query had broken.

### 1c. Two leads — **unverified**. Confirm before changing either.

The client already refreshes, retries once, then calls `fireAuthFailure()` →
`loginRedirect` (`client.ts:578-620`, `useAuthSession.ts:575-597`). Two things
look wrong and **neither is established**:

- [ ] **The two list 401s are 46 ms apart.** That is far too fast for the network
      round trip `acquireTokenSilent({ forceRefresh: true })` needs, so that retry
      is **most likely TanStack Query's own** and the silent refresh failed
      instantly. **Check what `tokenRefresher` actually returns on an expired
      session** before assuming the refresh path works at all.
- [ ] **`fireAuthFailure` is latched.** A module-level `authFailureFired` flag is
      reset only by `setOnAuthFailure`, so **after the first auth failure in a page
      session the re-login redirect may never fire again** — which would leave
      exactly the dead panel the owner photographed. **Verify against a real
      expired session.** If it is real, the fix is a latch that resets on a
      successful request, not removing it — the latch exists to stop a redirect
      storm.

### Tests

- [ ] ⚠️ **A 401 for each distinct reason logs a distinguishable line** — table-
      driven is fine. Assert the reason string, and **assert the token does not
      appear in the log output.** That second assertion is the one that stops a
      future "just log the payload" change.
- [ ] The web surface for a 401 is the session-expired path, not the generic
      loading error.
- [ ] Existing auth tests pass untouched. **`security.auth.spec.ts` sets
      `AUTH_JWT_SECRET` in-process** — do not disturb that.

---

## 2 — Card 1.55: the roster warning cries wolf 186 times a day (S, no migration)

`AccessControlService.operationalTeamIds` (`access-control.service.ts:30-43`) logs
**"User X has team scope on team Y with no TeamMember row … Add the roster row"**
— **186 times on 2026-09-09 alone**, 62 each for three Payroll accounts, still
firing at 14:03.

**All three have correct `TeamMember` rows**, created 2026-09-02 and 2026-09-08 —
**before** the warnings. Verified per account against production, not by an
aggregate. **So the premise is false and the instruction is to add a row that
already exists.**

### Already ruled out — do not spend time here

- **Version skew.** Production `f48452b` contains **both** the warning and the
  guard's `memberTeamIds` population (`auth.guard.ts:142-158`).
- **Bad data.** Checked per user. Zero accounts hold a `primaryTeamId` with no
  matching roster row.
- **A synthesised `AuthUser`.** Every call site passes the request user through.

### What this actually needs

- [ ] ⚠️ **Log the array.** `user.memberTeamIds` is empty at that point while the
      rows exist. **One request with the value logged answers it**; more reading
      will not. Start there.
- [ ] ⚠️ **My earlier note on this card said "the only caller is
      `canAssignTicket`". That was wrong** — a grep of mine filtered out the
      file's own self-references. There are **six**, and five are inside
      `access-control.service.ts`: **`roleFilter:85`**,
      **`roleConditionSql:159`**, `canViewTicket:225`, `isPeerAgent:264`,
      `canWriteTicket:360`, plus `canAssignTicket` at `tickets.service.ts:3993`.
- [ ] ⚠️ **`roleFilter` and `roleConditionSql` back every ticket list and every
      count.** That is why it fires 62 times per account per day — **this is the
      hottest read path in the product.** It also means all three expressions of
      the visibility rule that `access-control.parity.spec.ts` keeps in step run
      through this function, so **run that spec and expect it to matter.**
- [ ] ⚠️ **Do not narrow the permission behaviour to silence the log.** The
      fallback to `[user.teamId]` is deliberate: card 1.36's comment explains that
      narrowing a permissions chokepoint on a live system would silently lock out
      any account in that state. **Fix the condition that decides whether to warn,
      not what the function returns** — unless you can show the return is wrong,
      in which case **stop and report** rather than changing it.
- [ ] **Rate-limit the warning to once per account per process.** The code comment
      already claims it warns *"the first time such an account is used"*, which is
      not what it does. Make the comment true.
- [ ] **Why this is worth doing rather than tolerating:** card 1.36 added the
      warning so a *real* mismatch would announce itself. Firing constantly on
      healthy data trains everyone to ignore the one time it means something — and
      it is the noise the planner had to read past to diagnose card 1.54. **A
      warning that is usually wrong is worse than no warning.**

### Tests

- [ ] An account **with** a roster row produces **no** warning. That is the
      regression assertion.
- [ ] An account genuinely in the mismatched state still warns — **once**, not per
      call.
- [ ] `access-control.parity.spec.ts` stays green.

---

## 3 — Card 1.56: the macro editor's tag field eats commas too (XS, no migration)

The same round-trip bug card 1.50 just fixed, in a second control.
`CannedResponsePicker.tsx:545`: `value={(action.tags ?? []).join(", ")}` with an
`onChange` that splits on comma and `filter(Boolean)`, so the empty segment
created the instant you press `,` is dropped and React writes the comma back out.

**Its placeholder is `"password, vpn"` — a two-tag example the control makes
impossible to type.**

- [ ] ✅ **The hard part is done.** Card 1.50 extracted
      `apps/web/src/utils/parseTagList.ts`; the tickets filter and `useFilters`
      already go through it. **Switch this third call site onto it.**
- [ ] ⚠️ **Checked and NOT affected — do not touch:**
      `AutomationRulesPage.tsx:71` and `NewAutomationRulePage.tsx:60` each define
      a local `parseTagList`, but they keep the **raw string** in state
      (`action.val`) and parse only on submit — `:1004` joins for display, `:1073`
      parses to send. **That is the correct shape**, so there is no bug there.
- [ ] ⚠️ **Collapsing those two onto the shared util is NOT part of this card and
      would change behaviour**: the shared util lowercases and de-duplicates; the
      local ones cap at `MAX_TAGS_PER_ACTION` and preserve case. Three functions
      now share the name `parseTagList` across three files — **read before you
      assume.**
- [ ] Test that typing two tags yields two tags, the way 1.50's test does.

---

## 4 — What to report back

1. **Three commit SHAs**, one per card, and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, and **the migration count, which must
   still be 58.**
3. The answers this batch exists to produce:
   - **1.54 — which of the twenty 401 reasons actually fired**, now that you can
     see it. That is the real deliverable.
   - 1.54 — whether either §1c lead was real, and what you did.
   - **1.55 — what `memberTeamIds` contained**, and therefore why the warning
     fired on healthy data.
   - 1.56 — nothing to decide; just say it is done.
4. **For each card, the specific assertion that would now fail if the bug came
   back.** Not the count.
5. Anything that did not match. **This document is wrong somewhere.**

## 5 — The browser pass

- [ ] **1.54** — the one that matters: get a genuinely expired session (leave a tab
      idle past the token lifetime, or clear the MSAL cache) and confirm the screen
      says the session expired and recovers, **and that the sidebar counts do not
      sit there looking live.** Then read the log line and confirm it names the
      reason.
- [ ] **1.55** — load the tickets list as a Payroll account and confirm the log is
      quiet.
- [ ] **1.56** — type `password, vpn` into a macro's tag field and confirm you get
      two tags.

**Stop and report instead of improvising** if 1.54's fix seems to need a change to
what `auth.guard.ts` accepts, if 1.55 seems to need `operationalTeamIds` to return
something different, if either seems to need a migration, or if
`access-control.parity.spec.ts` goes red.
