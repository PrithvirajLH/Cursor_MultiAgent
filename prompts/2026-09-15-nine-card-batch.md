# Implementation Prompt — the nine ready-to-build cards

**Date:** 2026-09-15
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** 1.97 · 1.99 · 1.96 · 1.82 · 1.84 · 1.95 · 1.100 · 1.92 · 1.101

**Nine cards, in four groups, ~10 commits. One migration (67).**

> ## ⚠️ Read this before starting: the size, and what to do about it
>
> **This is roughly three times the largest batch this project has run**, and the
> owner asked for all nine together. **It is written to be stopped between
> groups**, and the groups are ordered so that each is independently shippable.
>
> **If you take one thing from this box: do NOT save the browser pass for the
> end.** Four of the last four batches had a bug that only a browser found, and
> **two of the cards here exist precisely because that keeps happening.**
>
> **Group A is the important one.** If the batch runs long, stop after it and say
> so — A is worth more than B, C and D combined.

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Card 2.6 may be running in another session** and reserves **migration 65**;
  **card 1.83 reserves 66.** **This batch takes 67 and only 67.**
- ⚠️ **Two sessions cannot share the test database.** If 2.6 is live, point one
  session's `TEST_DATABASE_URL` at `ticketing_browser` — **it exists but was
  created at schema 61, so bring it up to date before running a suite.**
- ⚠️ **Hold the WSL VM open** for every integration run: background a blocking
  `wsl -d Ubuntu-22.04 -- sleep 1800`. **If a run comes back broadly red, grep for
  `P1001|P1017|57P01` before believing it.**
- **Baseline to beat:** unit **698 / 71**, web **377 / 55**, integration
  **914 + 1 skipped / 89 of 90**, both typechecks clean, migrations **64**.

---

# GROUP A — the web layer (three commits, no migration)

**Why first: this is the group that stops the bug class.** Four consecutive
batches had a defect that every API test passed through and only a browser
caught — the announcements banner, the wrong timeline renderer, the
`resolvedFrom` filter, and the AI canary. **Two of these three cards are the
shared causes.**

## A1 — Card 1.97: `apiFetch` hands a caller someone else's cancelled request

`client.ts:805-808`:

```ts
const inflight = apiGetInflight.get(cacheKey);
if (inflight) return inflight as Promise<T>;
```

**The second caller gets the first caller's promise — built with the first
caller's `requestInit`, and therefore the first caller's signal. The second
caller's signal is discarded and it never issues a request.**

Two symptoms, both already in this codebase:

- **Card 1.65** — a caller passing NO signal inherits another's abort and shows
  *"Unable to load"* for a request that was fine. Worked around with
  `isAbortError`.
- **Card 2.7** — a caller passing a signal gets a promise already rejecting, so
  **it never loads and shows nothing**. Worked around with a `cancelled` flag.

⚠️ **Two workarounds for one behaviour, and neither fixes it.**

- [ ] **Pick one and write down why.** **(a)** share only when neither caller
      passed a signal; **(b)** ref-count, so the underlying request aborts only
      when every joiner has abandoned it; **(c)** stop sharing across callers with
      signals. **The planner's recommendation is (b)** — it keeps the
      de-duplication benefit, which is real on the sidebar, while making a
      caller's cleanup affect only that caller.
- [ ] ⚠️ **Card 1.65's `shared-inflight-abort.test.ts` PINS THE CURRENT
      BEHAVIOUR** — it asserts that aborting one caller rejects the other. **That
      test must be deliberately rewritten, not deleted**, and the new one should
      assert the opposite with a comment saying the behaviour changed and why.
- [ ] ⚠️ **Then check whether the two workarounds are still needed.** If (b)
      lands, `AnnouncementBanner`'s `cancelled` flag and the `isAbortError` guard
      in `TeamPage` may become belt-and-braces. **Leaving them is fine; say which
      you kept and why** — do not silently remove a guard that documents a real
      past failure.

### Tests

- [ ] ⚠️ **Two concurrent callers of one path: aborting the one with the signal
      does NOT reject the other.** The inversion of today's behaviour.
- [ ] **One request still serves both** — the de-duplication must survive, or the
      fix is a regression on the sidebar.
- [ ] **A caller that aborts still gets its own abort.**

## A2 — Card 1.99: a filter must be spelled in three places or it vanishes

`useFilters.ts` carries **three** hand-maintained lists of the same names: the URL
parser (**22** `searchParams.get`), the URL writer (**24** `params.set`), and the
API forwarder (`apiParams`, `:187-217`).

⚠️ **A name missing from any one of them does not error — it disappears, and it
fails in the WIDENING direction.** Card 1.88 pointed a saved view at
`resolvedFrom`; the parser did not know it, so the date window was not narrowed,
**it was removed**, and the list returned every resolved ticket ever. Badge 4,
list 5.

- [ ] ⚠️ **The parser and writer counts already differ by two. Find out which
      names are in one list and not the other, and REPORT THEM** — that is a
      standing bug report, not a tidy-up.
- [ ] **Derive all three from one declaration of the filter set.** Name, parse,
      serialise, forward — adding a filter should be one edit.
- [ ] **If one declaration is too large a change, the cheap version is a test that
      the three lists agree** — it would have caught card 1.88's miss. **Say which
      you did.**

### Tests

- [ ] ⚠️ **Every filter the parser knows is forwarded to the API**, driven from
      the declaration rather than a hand-written list — otherwise the test is a
      fourth place to forget.
- [ ] **A round trip: set a filter, read the URL, parse it back, and the API
      params contain it.**

## A3 — Card 1.96: ticket detail hands back more than it needs to

`getById` uses `include: { requester: true, assignee: true, assignedTeam: true, … }`.
**In Prisma `include: { x: true }` returns every column**, so a requester opening
their own ticket receives the agent's `entraObjectId`, `graphProfile`,
`department`, `location` and availability, plus the team's `isSensitive`,
`confidenceThreshold`, `hiddenPresetIds` and `assignmentStrategy`.

- [ ] **Replace the `include: true` shorthands with explicit `select` blocks**
      naming the fields the UI renders.
- [ ] ⚠️ **Check the web app's types first.** A screen may be reading a field
      nobody realised was arriving. **The typecheck is your friend here — run it
      before you trust the narrowing.**
- [ ] **Not an authorization hole** — the person may see the ticket. This is
      over-fetching, so **do not turn it into a permissions change.**

### ⚠️ Checkpoint after Group A

**Run everything and report before starting Group B.** A1 changes shared request
behaviour across the whole app; **if it is going to break something, you want to
know that before five more cards are sitting on top of it.**

---

# GROUP B — API correctness (two commits, no migration)

## B1 — Card 1.82: automations compute SLA deadlines in clock hours

`rule-engine.service.ts:1138` is `new Date(date.getTime() + hours*60*60*1000)` —
**raw milliseconds** — used at `:666`, `:672`, `:675`, `:679` to recompute
`firstResponseDueAt` and `dueAt` when a rule or macro changes priority.

**The same change made through `POST /tickets/bulk/priority` uses
`TicketSlaCalculationService` with `businessHoursOnly`.** So the deadline depends
on which path made the change, and **the error compounds, because the wrong value
is written back to `SlaInstance`.**

- [ ] **Call the SLA calculator with the policy flags and share one derivation
      with `bulkPriority`.** ⚠️ **One derivation, not two that agree today** —
      this is the thirteenth instance of that shape in this project.
- [ ] **Regression test: a macro and a bulk priority change on identical
      Friday-afternoon tickets produce equal `dueAt`.** ⚠️ **Friday afternoon
      specifically** — that is when business hours and wall-clock diverge most, and
      a Tuesday-morning fixture would pass while broken.

## B2 — Card 1.84: an interrupted inbound email blocks itself forever

`inbound-email.service.ts:1107-1145` reserves by inserting an
`InboundEmailReceipt` with a null `ticketId`, and **throws `ConflictException`
whenever it finds an existing row whose `ticketId` is still null — no age check,
no reclaim.** The row is released only in the `catch`.

**A process exit between the INSERT and completion leaves a reservation nothing
clears. The Graph worker re-offers that message every 30 seconds and every attempt
conflicts. Recovery today is editing the database by hand.**

- [ ] ✅ **The pattern already exists in this codebase:** `outbox.service.ts:155-181`
      reclaims stale rows for outbound mail. **Follow it rather than inventing
      one.**
- [ ] **Reclaim reservations with a null `ticketId` older than a cutoff**, inside
      the reservation itself.
- [ ] ⚠️ **Choose the cutoff deliberately and say why.** Too short and you
      double-process a message that is merely slow; too long and a wedged message
      stays stuck. **Ingestion latency is the input to that number.**

### Tests

- [ ] **A stale null-`ticketId` row is reclaimed; a fresh one still conflicts.**
      Both halves — the second is what stops double-processing.

---

# GROUP C — the audit trail (one commit)

## C1 — Card 1.95: most admin changes leave no trace

✅ **`AdminAuditEvent` already exists and SIX services write it** — `audit`,
`automation`, `duplicate-account`, `custom-fields`, `retention`, `tickets`,
`users`. **So this card is not "build auditing". It is "use what is there in five
more places."**

**The five that write nothing: `teams`, `routing`, `slas`, `kb`, `tags`.**

- [ ] **Add audit writes for: team create/edit/delete and membership changes,
      routing rule changes, SLA policy changes, KB publish/edit/delete, tag
      management.**
- [ ] ⚠️ **One shared helper called from five places, not five implementations.**
- [ ] ⚠️ **The audit notes that existing audit writes are SWALLOWED.** Check
      whether a failed audit write is silently discarded, and **say what you
      found.** An audit trail that fails quietly is worse than none, because it is
      trusted. **If it is swallowed, that is its own finding — report it rather
      than fixing it inside this card.**
- [ ] **`audit.service.ts:73` has `adminAuditEventTableExists`** — a runtime
      existence check. **Understand why before adding writers**; it suggests the
      table was once optional.

### Tests

- [ ] **One assertion per newly-audited area**, so the five are visible in the
      suite rather than only in the report.
- [ ] ⚠️ **A change that fails does NOT write an audit row saying it succeeded.**

---

# GROUP D — hardening (three commits, one migration)

## D1 — Card 1.100: the one-click token can be replayed (migration 67)

✅ **Verified: there is no consumption record anywhere in `src/email-actions/`.**
Replay is bounded only by ticket state and the 30-day TTL.

**Card 1.93 removed the urgent half** — a scanner can no longer act, because the
page waits for a click. **What remains is a human replaying a link they still
have.**

- [ ] ⚠️ **The rating is the part that matters.** Closing a closed ticket is a
      no-op; **submitting a satisfaction score repeatedly is not, and CSAT is a
      number the desk is judged on.**
- [ ] **Migration 67**, additive, **zero `DROP`.** Consume the token on first
      successful use.
- [ ] **A replay should show the same friendly page, not an error** — the person
      did nothing wrong.

## D2 — Card 1.92: dependency advisories

`npm audit --omit=dev` in `apps/api`: **23 advisories — 14 high, 9 moderate, 0
critical.** ⚠️ **The audit report's headline of 44 counts dev dependencies that
never ship; 23 is the number that matters.**

- [ ] ⚠️ **Its own commit, with nothing else in it.** A bump that breaks the build
      or the deploy package must be revertible alone, and **this repo has no
      staging.**
- [ ] **Start with `multer`** — it is on the file-upload path, the only route that
      accepts arbitrary bytes from a person.
- [ ] **Report what you did NOT take and why.** A major-version bump is not
      automatically worth it.

## D3 — Card 1.101: the MCP server — report, do not change

⚠️ **This card asks you to investigate and report. Do not change the behaviour.**

`src/mcp-server/server.ts` takes a client-supplied `userId` and calls
`executeTool('get_user_profile', {}, mcpContext(userId))` with no session — and
**that is deliberate and documented at `:36-37`**: a separate process, bound to
`127.0.0.1`, gated by `MCP_SERVER_TOKEN`.

- [ ] **Answer three questions for the owner:** is the localhost bind actually
      true in the deployed container; does `MCP_SERVER_TOKEN` have a rotation
      story; and is this path still used at all.
- [ ] **Confirm the reported latent bug:** `create_ticket` on that server has
      always failed because no user was ever set. **If true, that tells you how
      used the path is.**
- [ ] ⚠️ **Card 1.85 just closed the HTTP route to this data. This is now the only
      remaining one** — which is what makes it worth a conscious decision rather
      than an inherited one. **The decision is the owner's, not yours.**

---

## What to report back

1. **A SHA per commit**, grouped A–D, and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, **migration count (65 after D1 — or 67
   if cards 2.6 and 1.83 have landed; CONFIRM rather than assume)**, and
   `check-migrations.sh` clean, run **after** committing.
3. The answers:
   - **1.97 —** which option, why, and **what you did with card 1.65's test.**
   - **1.99 —** ⚠️ **which filter names are in one list and not another.**
   - **1.82 —** the Friday-afternoon fixture's numbers.
   - **1.84 —** the cutoff you chose and why.
   - **1.95 —** whether failed audit writes are swallowed.
   - **1.101 —** the three answers, and whether `create_ticket` is really dead.
4. **For each card, the assertion that would fail if it regressed — and confirm
   you watched each inversion actually fail.**
5. Anything that did not match. **This document is wrong somewhere.**

## Browser pass — do it per group, not at the end

- [ ] **After A1:** open the app and click around hard — the ticket list, a
      ticket, the sidebar, the command palette while a page loads. ⚠️ **A1 changes
      how every shared GET behaves; this is the highest-risk change in the batch.**
- [ ] **After A2:** apply a filter, reload the page, and confirm it survives the
      round trip.
- [ ] **After A3:** open a ticket as a requester and as an agent; nothing missing.
- [ ] **After B1:** change a priority by macro and by bulk action, and compare the
      two due dates **on screen**.
- [ ] **After D1:** use a one-click link twice.

**Stop and report instead of improvising** if card 1.97's change breaks the
sidebar's de-duplication, if narrowing the ticket payload breaks a screen the
typecheck did not catch, if the audit-write path turns out to swallow failures, or
if a dependency bump changes how the deploy package builds.
