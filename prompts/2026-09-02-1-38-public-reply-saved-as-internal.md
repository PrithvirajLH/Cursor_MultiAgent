# Implementation Prompt — 1.38 A public reply is silently saved as an internal note

**Date:** 2026-09-02
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.38 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** on an **unassigned** ticket, an AGENT composes a public reply, the
composer says `Public`, the app confirms **"Reply sent"** — and the server stores
the message as `INTERNAL`, emails nobody, and the requester never hears back.

**Cost:** none. Web + one decision on the API. **No schema, no migration.**

> ⚠️ Same handling as `docs/security-audit-2026-08.md` — this describes a live
> weakness in a running system and both GitHub remotes are public.

---

## 1. Found in the browser, not by reading

Found while doing the browser pass for card 1.37 on 2026-09-02, on dev ticket
`IS_20260609_002` (unassigned, IT Service Desk) as `agent@company.com` (AGENT,
on that team's roster).

Four messages were posted through the real composer. The **first** was typed with
the toggle plainly reading `Public`. Database truth afterwards:

```
20:14:50  INTERNAL  agent@company.com   Public reply from the agent - this one shoul…
20:15:22  INTERNAL  agent@company.com   Internal note one - this must NOT reach the …
20:15:30  INTERNAL  agent@company.com   now ?
20:15:38  INTERNAL  agent@company.com   Test 4
```

`outbox rows for this ticket: 0`.

Then, bypassing the UI entirely to remove all doubt:

```bash
curl -X POST .../messages -H 'x-user-email: agent@company.com' \
     -d '{"body":"…","type":"PUBLIC"}'
→ {"type":"INTERNAL", …}
```

**Sent `PUBLIC`, stored `INTERNAL`, returned 201.** Not a UI state bug — the
server overrides and reports success.

## 2. The cause — two files hold opposite beliefs about one case

| Layer | Code | On an **unassigned** ticket |
|---|---|---|
| **API** `access-control.service.ts:215` | `if (ticket.assigneeId === user.id) return false;` | `null !== user.id`, so it falls through → **is a peer agent** |
| **Web** `TicketDetailPage.tsx:383` | `if (!ticket.assignee) return false;` — comment: *"unassigned tickets are open to any agent"* | → **not a peer agent** |

The API then acts on its answer, at `tickets.service.ts:1524-1529`:

```ts
// Peer agents (same team, not the assignee) can only leave INTERNAL notes.
// We override silently regardless of what the client sent — the UI also
// hides the toggle, but defense-in-depth.
const effectiveType = isPeerAgent ? MessageType.INTERNAL
                                  : (payload.type ?? MessageType.PUBLIC);
```

**That comment is wrong in exactly this case.** The web hides the toggle when
*its* `isPeerAgent` is true — and on an unassigned ticket it is false, so the
toggle is shown, defaults to `PUBLIC`, and the "defense-in-depth" override
becomes the only thing deciding the outcome. Because `assigneeId` is `null` and
never equals a user id, **every AGENT on the team is a peer agent on every
unassigned ticket.**

Net effect: **an AGENT cannot post a public reply to an unassigned ticket at
all**, and is not told.

## 3. Why the screen keeps lying afterwards

`TicketDetailPage.tsx` has the true type in hand and uses it in one place out of
three:

| Line | What it does |
|---|---|
| `:1432` | optimistic bubble built with local `messageType` |
| `:1452` | on success, maps **only** `localStatus: "sent"` — **never** replaces `type` with `serverMessage.type` |
| `:1460` | realtime event payload **does** use `serverMessage.type` ✅ |
| `:1467` | toast keys off local `messageType` → **"Reply sent"** |

So the bubble keeps the wrong type until something refetches, and the
confirmation actively asserts the false outcome. Combined with card 1.37 (an
author's own internal note renders in the ordinary blue "sent" style and only the
first of a run carries the `Internal` badge) there is **no signal anywhere on the
screen** that the message stayed private.

## 4. What this does and does not explain

**Be careful here — do not repeat the planner's mistake of reframing a card on an
unverified premise.**

Card 1.37 attributes the 2026-09-02 production incident to its display faults:
the owner switched the toggle to Internal and could not tell. This card could
instead explain it — *if* the account was role `AGENT` and the ticket was
unassigned.

**It probably does not.** 1.37 and 1.36 both label `phulgur@` as `AGENT`, but
production says **TEAM_ADMIN** (verified 2026-09-02, and already recorded as a
correction on 1.36's board row). `isPeerAgent` returns `false` immediately for
any role that is not `AGENT`, so the override cannot have applied to a
TEAM_ADMIN. **1.37's explanation of the incident stands; this is a second,
independent fault.**

**The decisive check, for whoever picks this up:** does production have any
account with role `AGENT`? If yes, this is live on all 53 unassigned tickets. If
no, it is latent — and becomes live the day an agent is onboarded, which is the
normal growth path for this system. Verify; do not assume either way.

## 5. The decision the owner has to make

The two layers disagree, so one comment has to lose. **This is a product
decision, not a refactor.**

> **Should an AGENT be able to publicly reply to a ticket that is unassigned?**

**Recommendation: yes — change the API to match the web.** The rule's stated
intent is to stop an agent talking to a requester on *someone else's* ticket. An
unassigned ticket is nobody's, so there is no one to protect, and the opposite
rule makes the queue unworkable: the first agent to pick up a new ticket cannot
answer it without assigning it to themselves first. The web's comment
("unassigned tickets are open to any agent") is the better rule.

The one-line API change:

```ts
if (ticket.assigneeId === null) return false;   // unassigned: open to any agent
if (ticket.assigneeId === user.id) return false;
```

If the owner instead wants assignment to be required before a public reply, then
the **web** must hide the toggle on unassigned tickets and say why — but do not
ship that without the §6 honesty fix, because silence is what caused this.

## 6. The work

Kill stray node processes; Postgres up; no other test run active.

### Task 1 — Stop the screen asserting a false outcome (do this first)

**Files:** `apps/web/src/pages/TicketDetailPage.tsx`

Independent of §5, and worth landing on its own: the client must believe the
server, not its own intent.

- [ ] `:1452` — on success, replace the optimistic message's `type` with
      `serverMessage.type` as well as `localStatus`.
- [ ] `:1467` — key the toast off `serverMessage.type`. When it differs from what
      was requested, say so plainly rather than "Reply sent": e.g.
      **"Saved as an internal note — the requester was not emailed."**
- [ ] Do **not** silently swap the wording with no explanation; the point is that
      the agent learns the outcome.

### Task 2 — Settle the disagreement

**Files:** `apps/api/src/common/access-control.service.ts` (per §5 recommendation)

- [ ] Apply the owner's decision from §5 in **one** place, and make the two
      comments agree with each other and with the code.
- [ ] Delete the "the UI also hides the toggle" claim from
      `tickets.service.ts:1524` or make it true. A comment that is wrong about
      another layer is how this survived.

### Task 3 — Tests

- [ ] **API unit:** `isPeerAgent` on an unassigned ticket — the case with no
      coverage today. Assert the chosen semantics explicitly, both roles.
- [ ] **API integration:** an AGENT posts `type: PUBLIC` to an unassigned ticket
      on their team → assert the **stored** type, and that the outbox row exists
      (or does not) to match. This is the assertion whose absence let a
      "defense-in-depth" override run unobserved.
- [ ] **Web:** the composer shows the requested type only until the server
      answers, then reflects `serverMessage.type`; the toast reports the server's
      type, not the request's.
- [ ] Targeted, then the **full** suite. **Do not edit source while it runs.**

### Task 4 — Docs, baselines, commit

- [ ] `docs/agent-context/repo-landmines.md`: the web and the API each compute
      `isPeerAgent` and disagreed on unassigned tickets — the second instance of
      this shape after 1.36's Fault C. Worth stating as a pattern: **a permission
      question answered independently in two layers will drift, and the UI's
      answer is the one the user sees.**
- [ ] `CLAUDE.md` baselines, real numbers. Current: API **416 unit / 43 suites**,
      **457 integration + 1 skipped**, web **70 / 18 files**.
- [ ] Commit by explicit path. `e2e/` is untracked on purpose.

## 7. Acceptance criteria

1. An AGENT posting to an unassigned team ticket gets the outcome the owner chose
   in §5 — and either way **the screen states what actually happened.**
2. Sending `type: PUBLIC` and having it stored `INTERNAL` is impossible without
   the agent being told, in the toast and on the bubble.
3. `isPeerAgent` has one definition, and the two layers' comments agree with it.
4. An integration test asserts the **stored** type for the unassigned + AGENT
   case.
5. Both `tsc` clean; unit, integration and vitest at or above baseline.

## 8. What to report back

1. Commit SHA. 2. Every `Tests:` line, both `tsc`, vitest. 3. `git diff --stat`.
4. The §4 decisive check: **does production have any account with role `AGENT`?**
   State the answer and how you got it.
5. A screenshot of the toast when the server's type differs from the request.
6. Anything that did not match. Handoffs from the planner have carried a wrong
   command, a stale premise and a self-contradiction; say so plainly.

**Stop and report instead of improvising** if this appears to need a schema
change or a migration. Neither should be necessary.
