# Implementation Prompt — 1.109 → 1.115: access that outlives its revocation, and work given to nobody

**Date:** 2026-09-15
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** **1.109** (a switched-off account keeps its live feed) · **1.110**
(assignment on a team-less ticket accepts anybody) · **1.111** (unassign leaves
work in progress with nobody on it) · **1.112** (round-robin restarts when
somebody is away) · **1.113** (a bootstrap owner cannot be demoted) · **1.114**
(the readiness endpoint has no token) · **1.115** (the lead digest can send
twice)

**Seven cards. No migration.** Group them into commits as you see fit, but
**1.109 and 1.110 are the two that matter** — do those first and separately.

> ## Where these came from
>
> **All seven are from the 2026-09-13 audit's 54 Low findings, which had never
> been checked one by one.** The planner verified each against the code at
> `410da33` and **measured production for the three that depend on an
> environment variable**, because two of them turned out to be latent rather
> than live and that changes what they are worth.
>
> ⚠️ **Three other Low findings were checked and found FALSE or materially
> overstated. They are recorded on the board and must not be re-raised.**

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Check the tree is yours:** `git status --porcelain | grep -v '^??'` —
  anything modified under `apps/` that is not yours means **STOP**.
- ⚠️ **Hold the WSL VM open** for every integration run:
  `wsl -d Ubuntu-22.04 -- sleep 2100` in the background.
- **Baseline to beat:** unit **765 / 78**, web **385 / 56**, integration
  **963 + 1 skipped / 96 of 97**, both typechecks clean, migrations **67**.
- ⚠️ **An AI-gate batch (1.106, 1.107, 1.108) may be running in another
  session** and takes no migration either. **Neither batch needs one — confirm
  rather than assume.**

---

## 1 — Card 1.109 ⚠️ A switched-off account keeps its live feed for an hour

### What is wrong

**Card 1.78 closed the HTTP door and it works.** `auth.guard.ts:458` calls
`assertActive` before any write, so a deactivated person is refused immediately.

⚠️ **The realtime door was not closed, and nothing closes it.**

✅ **Verified:** `realtime.service.ts:137-160` mints a Web PubSub client token
carrying the user's **groups baked in at negotiate time**, with a lifetime from
`AZURE_WEB_PUBSUB_TOKEN_LIFETIME_MINUTES` — **default 60, and it is set in
production.** ✅ **And `grep -rn "closeConnection\|removeUserFromAllGroups\|
closeAllConnections" apps/api/src` returns nothing.** No code path anywhere
closes a connection or strips group membership.

**So for up to an hour after they are switched off, a deactivated person keeps
receiving live ticket events, notification pushes and team-group traffic** —
they simply cannot act on them. **On a healthcare desk that is a stream of
ticket subjects and requester names going to somebody who was offboarded.**

⚠️ **The same hole applies to a DEMOTION, and that case is quieter.** Groups are
resolved once at negotiate (`:254-264`): OWNER group, team-admin group, lead
group. **A LEAD demoted to AGENT keeps receiving the lead group's events until
their token expires**, and nobody involved would ever notice.

### The fix

- [ ] **Close the connections and drop the groups when a user is deactivated or
      their role changes.** The Web PubSub service client has the operations;
      **`RealtimeService` is the right home** so the knowledge stays in one file.
- [ ] ⚠️ **It must never fail the deactivation.** Use `safeRealtime`, which
      already exists and is used everywhere else in this service. **A user who
      cannot be switched off because the realtime call failed is a worse bug than
      the one you are fixing.**
- [ ] ⚠️ **Consider shortening the token lifetime as well, but do NOT do only
      that.** Sixty minutes is a long time and a shorter one is cheap, but it is a
      mitigation, not a fix — **and it has a cost in negotiate traffic. Say what
      you would suggest rather than changing it silently.**
- [ ] **Role change and deactivation are two callers of one rule.** ⚠️ **Write it
      once.** The board has fifteen instances of this going the other way.

### Tests

- [ ] **Deactivate a user who holds a live token: their connection is closed and
      their groups are dropped.** The assertion the card exists for.
- [ ] **Demote a LEAD: the lead group is dropped.**
- [ ] **A deactivation still succeeds when the realtime call throws.**
      ⚠️ **Non-vacuity, and it is the important one** — assert the user row is
      `isActive: false` afterwards.
- [ ] **An ordinary user's connection is untouched by somebody else's
      deactivation.**

---

## 2 — Card 1.110 ⚠️ On a team-less ticket, assignment accepts anybody

### What is wrong

✅ **Verified at `applyAssigneeInTx`, `tickets.service.ts:2703-2740`.** The
membership check is real and correct — **but it is inside
`if (ticket.assignedTeamId && …)`**.

**When a ticket has no team, there is no check at all.** Any user id that exists
is accepted: an EMPLOYEE, the requester themselves, somebody from another
department. **And team-less tickets are not a corner case — they are exactly the
ones sitting in the Unassigned queue**, which is where mail to a bare address
lands (card 1.63 documents this, and card 1.24's checklist item 10 names it).

⚠️ **AND NO PATH CHECKS `isActive`, WITH OR WITHOUT A TEAM.** Card 1.89 fixed
precisely this at `addMember` — a deactivated person could be put straight back
onto a team. **The same question is answered at `addMember` and not answered
here**, one method over. **That is the recurring failure of this project in its
plainest form.**

### The fix

- [ ] **Require the assignee to be active, on every path.** ⚠️ **Find how card
      1.89 phrased it at `addMember` and reuse that**, rather than writing a second
      answer to the same question.
- [ ] **On a team-less ticket, require the assignee to be somebody who can
      actually work tickets** — decide the rule, state it, and put it in one place.
- [ ] ✅ **The OWNER exemption at `:2725` is deliberate and correct** — an OWNER
      has global write access and holds no `TeamMember` row. **Keep it, and keep
      its comment.**
- [ ] ⚠️ **DO NOT add an `isAvailable` check here.** Cards 2.2 and 1.94 are about
      **auto**-assignment. **A human deliberately assigning to a colleague on leave
      is a legitimate override** — a lead queueing work for someone returning
      tomorrow. **Removing that would be a regression dressed as a fix.**

### Tests

- [ ] **A team-less ticket cannot be assigned to an EMPLOYEE.**
- [ ] **No ticket can be assigned to a deactivated user, with or without a team.**
- [ ] **An OWNER can still self-assign a ticket on a team they do not belong
      to.** ⚠️ **Non-vacuity, and the one most likely to break** — the exemption is
      easy to lose while tightening.
- [ ] **A normal assignment to a team member is completely unaffected.**
- [ ] **An agent on leave CAN still be assigned by hand**, so the deliberate gap
      is locked down by a test.

---

## 3 — Card 1.111 Unassign leaves work in progress with nobody on it

✅ **Verified at `tickets.service.ts:2652-2700`:** `unassign` writes
`{ assigneeId: null }` and **never touches status**.

**So an `IN_PROGRESS` ticket becomes an `IN_PROGRESS` ticket with no assignee.**
The queue says somebody is working on it; nobody is.

⚠️ **The asymmetry is the tell.** `applyAssigneeInTx:2743-2748` **does** move
status on the way in — `NEW`, `TRIAGED` and `REOPENED` all promote to `ASSIGNED`.
**The journey out has no equivalent.**

- [ ] **Decide what status an unassigned in-flight ticket should have and apply
      it**, mirroring the promote list rather than inventing a second table.
- [ ] **`bulkUnassign` (`:3915`) is the same code path's sibling — check it too.**
- [ ] ⚠️ **Write a `TICKET_STATUS_CHANGED` event when you change status**, exactly
      as the assign path does at `:2772-2783`. **A status that changes with no
      event is invisible in the history and card 1.95 just spent a whole card on
      that principle.**
- [ ] ⚠️ **Do not touch a finished ticket.** Unassigning a RESOLVED or CLOSED
      ticket must not reopen it — **that is card 1.80's bug in a new dress.**

**Tests:** IN_PROGRESS unassign lands on the chosen status and writes an event ·
a RESOLVED ticket's status is untouched · bulk unassign behaves identically ·
an already-unassigned ticket is a no-op.

---

## 4 — Card 1.112 Round-robin restarts at the first member whenever the pointer holder is away

✅ **Verified at `tickets.service.ts:5121-5131`:** the rotation does
`findIndex(member => member.userId === team.lastAssignedUserId)` against the
**available** member list. **When the pointer holder is unavailable or has left
the team, `findIndex` returns -1 and `nextMember` stays `members[0]`.**

⚠️ **Be honest about the size of this: it is small.** The pointer is rewritten
immediately afterwards, so the rotation self-corrects on the very next ticket.
**The cost is one extra ticket to `members[0]` per away-event, not a permanent
pin** — the audit's wording implies worse. **It is worth fixing because it is
four lines and the fairness of round-robin is the entire point of round-robin,
not because it is urgent.**

- [ ] **Fall back to a position, not to zero** — remember where the pointer holder
      *was* in the full member list and resume after it.
- [ ] ✅ **The comment at `:5137-5141` explaining why the pointer is written in
      BOTH modes is correct and load-bearing. Do not remove it.**
- [ ] ⚠️ **`leastLoadedMember` uses `lastAssignedUserId` as its tie-break.**
      Whatever you change must not alter LEAST_LOADED's behaviour. **Card 2.1 is
      deployed but switched off, so no test in production will catch it if you do.**

**Tests:** a five-member team whose pointer holder goes away does not hand two
consecutive tickets to the same person · LEAST_LOADED tie-breaking is unchanged
(non-vacuity) · an empty available list still returns null.

---

## 5 — Card 1.113 A bootstrap owner cannot be demoted, and the list is cached until restart

✅ **Verified at `auth.guard.ts:541-543`:** on **every** login, if the address is
in `AUTH_BOOTSTRAP_OWNER_EMAILS`, `updateData.role = UserRole.OWNER`. **So an
admin who demotes that person sees it succeed, and their next sign-in silently
puts them back.** The demotion is audited; the re-promotion is not.

✅ **Verified at `:583-596`:** the set is memoised with
`if (this.bootstrapOwnerEmails) return …`, **so removing somebody from the
variable needs an App Service restart.** ⚠️ **That is card 1.104's bug, in a
different file, three days later** — that card deleted three memoised probes for
exactly this reason.

⚠️ **AND IT IS KEYED ON AN EMAIL ADDRESS**, which card 1.30 established is a
*label* on a person, not the person. **Healthcare re-issues role mailboxes.** A
departing owner's address given to a new starter makes that new starter an OWNER
on first login.

✅ **MEASURED: `AUTH_BOOTSTRAP_OWNER_EMAILS` is NOT SET in production.** **So
none of this can happen today.** It is a trap armed for whoever sets it — most
likely during a disaster, which is the worst moment to discover a role cannot be
taken back.

- [ ] **Stop re-promoting an existing user.** Bootstrap should provision the
      **first** owner, not enforce ownership forever. **Keep the provisioning half
      at `:473-475`; drop the enforcement half at `:541-543`** — or gate it so an
      explicit demotion wins. **Say which you chose and why.**
- [ ] **Do not cache the set for the life of the process**, or make it explicitly
      reloadable. ⚠️ **Follow card 1.104's shape.**
- [ ] ⚠️ **If you keep any promotion, write an audit row.** `AdminAuditService`
      exists (card 1.95). **A role change with no record is exactly what this card
      is about.**

**Tests:** a bootstrap address demoted to AGENT stays AGENT across a login · a
brand-new bootstrap address still provisions as OWNER (non-vacuity) · a change to
the variable takes effect without a restart · any promotion is audited.

---

## 6 — Card 1.114 The readiness endpoint has no token and fans out to everything

✅ **Verified at `health.controller.ts:34-53`:** `GET /api/health/ready` is
`@Public()`, and `assertToken` **returns immediately when `HEALTH_READY_TOKEN` is
blank**. ✅ **MEASURED: it is not set in production** — the code's own comment
says so, and it is right.

**The endpoint reaches out to every configured integration**, which the same
comment correctly calls *"a free amplifier"*.

⚠️ **BUT BE ACCURATE ABOUT THE EXPOSURE, BECAUSE THE AUDIT WAS NOT.**
`/api/health/ready` is **not** in the live Easy Auth `excludedPaths` list —
verified 2026-09-14, which contains only `/api/tickets/inbound-email`,
`/api/tickets/intake`, `/api/email-actions` and `/api/email-actions/*`. **So
Easy Auth already refuses anonymous callers at the edge.** The real exposure is
**any signed-in tenant account**, plus anything inside the container. **That is
much smaller than "open to the internet", and the card should be sized to it.**

- [ ] ⚠️ **The cheapest correct fix is probably to set `HEALTH_READY_TOKEN` — and
      that is the OWNER'S action, not yours.** **Say so in your report and do not
      set it.**
- [ ] **In code: decide whether the body should be thinner for an unauthenticated
      caller.** It names which integrations exist and their state — useful
      reconnaissance, no secrets.
- [ ] ✅ **The rate limit on it is deliberate** (`health.controller.ts:25-33`).
      **Do not remove it while tidying.**

**Tests:** with a token set, a wrong token is refused and the right one passes ·
with no token set, behaviour is unchanged (non-vacuity) · the body never
contains a connection string or key.

---

## 7 — Card 1.115 The lead digest can send twice

✅ **Verified: `lead-digest.service.ts` has no lock, no running flag, no advisory
lock** — `grep -n "running\|lock\|isRunning\|advisory\|inFlight"` returns
nothing. ✅ **And `operations.service.ts:119` exposes `runOnce()` to the
Operations console**, so **two clicks send every lead two digests.** The
scheduled path can overlap with itself the same way if a run outlasts its
interval.

✅ **MEASURED: `LEAD_DIGEST_ENABLED` is NOT SET in production, so the digest is
off** — matching `CLAUDE.md`. **This is latent and arms the day the owner turns
it on**, which is the same shape as card 1.83 arming with the scan flag.

- [ ] **Add a guard so a second concurrent run is refused, not queued.**
- [ ] ⚠️ **Refuse visibly.** The Operations console is a person clicking a button;
      *"already running"* is a useful answer and silence is not.
- [ ] ⚠️ **An in-process flag does not survive two App Service instances.** **Say
      whether you built an in-process guard or a database one, and what that does
      and does not cover.** An honest in-process guard with its limit written down
      is fine; one that implies more than it delivers is not.
- [ ] **A crashed run must not leave the digest permanently locked.**

**Tests:** two overlapping `runOnce()` calls send one digest, not two · the
second returns a clear "already running" · a throwing run releases the guard ·
a normal single run is unaffected (non-vacuity).

---

## 8 — What to report back

1. **Commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, the migration count (**67,
   unchanged**), and `check-migrations.sh`.
3. The answers:
   - **1.109 —** whether you shortened the token lifetime, and what a failed
     realtime call does to a deactivation.
   - **1.110 —** the rule you chose for a team-less ticket, and **confirmation you
     reused card 1.89's `isActive` phrasing rather than writing a second one.**
   - **1.111 —** which status an unassigned in-flight ticket lands on, and why.
   - **1.113 —** whether you dropped the re-promotion or gated it.
   - **1.115 —** in-process guard or database guard, and what it does not cover.
4. **For each card, the assertion that would fail if it regressed — and confirm
   you watched each inversion actually fail.**
5. Anything that did not match. **This document is wrong somewhere — the last
   four handoffs each had at least one thing wrong that only running found.**

## 9 — Browser pass

- [ ] **1.109 —** sign in as an agent in a second browser, deactivate them from
      the first, and confirm their live feed stops **without waiting an hour**.
- [ ] **1.110 —** try to assign an Unassigned-queue ticket to an EMPLOYEE. It must
      be refused, and **the message must say why.**
- [ ] **1.111 —** take an IN_PROGRESS ticket, unassign it, and confirm the queue
      no longer claims it is being worked on.
- [ ] **1.115 —** click "Run now" on the digest twice in the Operations console.

**Stop and report instead of improvising** if closing a realtime connection
needs a Web PubSub capability the current SDK version does not expose, if
requiring an active assignee would break any existing integration test in a way
that looks legitimate, or if the unassign status change cannot be made without
touching the transition map (`TICKET_STATUS_TRANSITIONS`) — **that override is
audit F-079 and a separate decision.**
