# Implementation Prompt — 1.28 The agent can see who a message reaches

**Date:** 2026-09-02
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.28 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** an agent types into the composer and the message silently reaches
several people whose names appear nowhere on the screen.

**Cost:** none. API + web. **No schema, no migration, no Azure change.**

> **Sequencing: start after cards 1.33 and 1.34 are deployed.** Both are GREEN or
> in flight and both change what this card describes. Building against
> undeployed behaviour is how the card ends up describing something that no
> longer exists.

---

## 1. Why this stopped being a nicety

Three decisions, each sensible alone, have concentrated the audience into one
place:

| Decision | Effect |
|---|---|
| **1.33** — a public reply is **one email**, `To:` requester, `Cc:` the rest | The audience is now a list, not one person |
| **1.34** — "Also copied: …" removed from the body | The email no longer names them |
| **1.33** — an internal note sends no email | Two message types with completely different audiences, chosen in the composer |

So after 1.34 ships, **the compose screen is the only place anyone sees who a
message will reach.** An agent writes something candid on a termination ticket
and it goes to three people they would have to go hunting to identify.

That is the gap. It is a safety gap on payroll and HR tickets, not a convenience.

## 2. Facts established first (verified 2026-09-02)

| Fact | Consequence |
|---|---|
| `NotificationsService.buildRecipients` (`notifications.service.ts:438`) is the single function that decides who receives a message. It takes the ticket's requester, assignee and followers, then applies `excludeUserId` and `excludeEmployees`. | **The endpoint in Task 1 must call this exact function.** A second implementation would drift, and the screen would then confidently show the wrong audience — worse than showing none. |
| Card 1.23's `resolveOutboundRecipients` then drops out-of-domain and suppressed addresses, returning `refused` separately. 1.33 applies it at **compose** time. | The preview must run **both** stages, or it will promise delivery to an address the send will refuse. |
| Follower endpoints already exist: `GET/POST/:id/followers` and `DELETE /:id/followers/:userId` (`tickets.controller.ts:326-341`). | **Removal needs no new endpoint.** |
| `NotificationOutbox` rows carry `ticketId` **and** a `payload.messageId`. Since 1.33, a public message produces **one** row, with `to` and `cc` on it. | Per-message delivery facts are one query per ticket, grouped in memory — **not** one query per message. |
| An out-of-domain recipient produces an `EMAIL_RECIPIENT_REFUSED` ticket event carrying the refused addresses. | The per-message indicator can show refusals, which is the other half of "did this reach anyone". |
| `TicketDetailPage.tsx` holds the composer and already distinguishes public from internal. | One place to put the list. |

## 3. Goal

Before an agent sends, they can see exactly who will receive it and remove
anyone. After they send, each message says what actually happened to it.

## 4. Decisions and assumptions

1. **The list sits directly above the compose box.** Not in the sidebar, not
   behind a disclosure, not in settings. The whole point is that it is
   unavoidable at the moment of writing.
2. **It changes with the message type**, live. Switching to an internal note must
   visibly change the audience — that switch is the most consequential control on
   the screen and currently gives no feedback at all.
   - Public: "Goes to Bhavesh Patel, and 2 others"
   - Internal: "Internal note — staff only, no email sent"
3. **Removing someone unfollows them from the ticket.** Not a per-message
   exclusion. A per-message list is state nobody will understand in three months,
   and it silently varies the audience between messages in the same thread. If an
   agent does not want a person on this thread, the honest action is to take them
   off it — or to write an internal note instead. Use the existing
   `DELETE /:id/followers/:userId`.
4. **The requester cannot be removed**, and the control should not pretend
   otherwise. Show them as fixed. Removing the requester would leave a public
   reply with no `To:`.
5. **A preview endpoint, not a client-side guess.** The web must not assemble the
   audience from the ticket payload — the rules live in
   `buildRecipients` + `resolveOutboundRecipients` and belong on the server.
6. **Per-message, show what happened, not what was intended.** Read it from the
   outbox row, so a message that was queued but refused does not claim to have
   been emailed. Three states: `emailed to N`, `internal — not sent`,
   `N refused` (which can accompany the first).
7. **No new endpoint for delivery facts.** Fold them into the existing
   message/event payload the ticket page already fetches.

## 5. The work

Kill stray node processes; Postgres up; no other test run active. **Confirm 1.33
and 1.34 are deployed first.**

### Task 1 — The recipient preview endpoint

**Files:** Modify `apps/api/src/tickets/tickets.controller.ts`, `apps/api/src/notifications/notifications.service.ts`; create a response type

- [ ] `GET /api/tickets/:id/message-recipients?type=PUBLIC|INTERNAL`.
      Guarded like the rest of the ticket routes — anyone who can post a message
      on the ticket can ask who it would reach. Reuse the existing access check;
      do not invent one.
- [ ] Expose a **public** method on `NotificationsService` that runs
      `buildRecipients` with exactly the options `messageAdded` uses for that
      message type, then `resolveOutboundRecipients`. Return:
      `{ to: {id,name}|null, cc: {id,name,removable}[], refused: {address,reason}[], emails: boolean }`.
      `emails: false` for an internal note.
- [ ] **Names, never addresses**, in the response. This renders on a screen a
      requester may be shoulder-surfing, and card 1.34 already decided names read
      better than a header dump.
- [ ] `excludeUserId` must be the **calling agent** — the composer should not
      list the author as a recipient, because `messageAdded` excludes them.

### Task 2 — The list above the composer

**Files:** Modify `apps/web/src/pages/TicketDetailPage.tsx`; create `apps/web/src/components/ticket-detail/MessageAudience.tsx` + test

- [ ] One line above the compose box, quiet by default:
      **"Goes to Bhavesh Patel · Greg Weitzer, Dana Whitfield"** — requester
      first, then the Cc names.
- [ ] Expands to a small list with an **×** per removable person. Confirm before
      unfollowing (`ConfirmDialog` exists in `components/ui/`).
- [ ] **Switching to an internal note replaces it with**
      "Internal note — staff only, no email sent." Refetch on type change, or
      fetch both once and swap — either is fine, say which.
- [ ] Show refusals inline when present: *"1 address cannot be emailed"* with the
      reason on hover. An agent should not discover that after sending.
- [ ] It must not shift the composer's layout when it appears or expands.
- [ ] States: loading (render nothing, not a spinner — this is secondary
      furniture), error (fall back to a plain
      "Couldn't check who this reaches" — **never** silently show nothing, since
      absence would read as "nobody").

### Task 3 — What actually happened, per message

**Files:** Modify `apps/api/src/tickets/tickets.service.ts`, `apps/web/src/components/ticket-detail/*`

- [ ] Where the ticket's messages are loaded, fetch the ticket's outbox rows in
      **one** query and attach `{ emailed: number, refused: number, internal: boolean }`
      to each message by `payload.messageId`.
- [ ] Render it as a small muted label on each message: `emailed to 3`,
      `internal — not sent`, `emailed to 2 · 1 refused`.
- [ ] **Do not** query per message.

### Task 4 — Tests

- [ ] API unit: the preview for `PUBLIC` matches what `messageAdded` would
      actually use — assert against the same `buildRecipients` call, so the two
      cannot drift; `INTERNAL` excludes the requester and reports
      `emails: false`; an out-of-domain follower appears in `refused`, not `cc`;
      the calling agent never appears.
- [ ] API integration: `GET /message-recipients` as an agent → 200; as a
      requester on someone else's ticket → 403.
- [ ] Web: the component renders the requester first, marks them
      non-removable, swaps wholly for the internal-note wording, and renders the
      error fallback rather than nothing. Follow `renderToStaticMarkup` as the
      existing web tests do.
- [ ] Targeted, then the **full** suite. **Do not edit source while it runs.**

### Task 5 — Docs, baselines, commit

- [ ] `docs/email-conversation.md`: that removal unfollows rather than excluding
      per message, and why.
- [ ] `CLAUDE.md` + `repo-landmines.md` baselines, real numbers.
- [ ] Commit by explicit path. `e2e/` is untracked on purpose.

## 6. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npm run test:integration > ../../int-full.txt 2>&1; grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

Baselines: read `CLAUDE.md`, do not assume — three cards have moved them since
this was written. Delete the log file afterwards.

## 7. Security considerations

- **The preview must not become an information leak.** It answers "who would
  receive a message I am allowed to post", so it is gated by the same check as
  posting. A user who cannot post on the ticket must get 403, and one who can
  must not learn anything they could not already see in the followers list.
- **Names, not addresses** (§5 Task 1). Nothing here needs an address, and the
  screen is visible in a shared office.
- **Removal is a real mutation.** It unfollows someone from a ticket, which
  changes who receives everything afterwards. Confirm first, and let the existing
  follower endpoint apply its own permission rules rather than adding a bypass.
- **The indicator must report the outbox, not the intent** (§4.6). A label saying
  "emailed to 3" when the send was refused is worse than no label, because an
  agent would stop chasing.

## 8. Acceptance criteria

1. With the composer open on a public reply, the agent sees the requester and
   every Cc'd name before typing.
2. Switching to an internal note visibly changes it to the staff-only wording.
3. Removing a Cc'd person asks for confirmation, unfollows them, and the list
   updates.
4. The requester is shown and cannot be removed.
5. An out-of-domain follower shows as refused **before** the message is sent.
6. Each sent message shows what happened to it, from the outbox.
7. The endpoint returns 403 to someone who cannot post on the ticket.
8. Both `tsc` clean; unit, integration and vitest at or above baseline.

## 9. Manual test steps

Dev API on `PORT=3077` (`AUTH_ALLOW_INSECURE_HEADERS=true`,
`NODE_ENV=development`) + web with `VITE_API_BASE_URL=http://localhost:3077/api`
and `VITE_E2E_MODE=true`. Persona via
`localStorage.setItem("demoUserEmail", "lead@company.com")`.

Add two followers to a ticket. Open the composer: confirm all three names.
Switch to internal: confirm the wording changes. Remove one follower: confirm
the dialog, then the list. Add a follower whose address is outside
`EMAIL_ALLOWED_DOMAINS` and confirm they show as refused rather than as a
recipient. Post a public reply and an internal note, then read the labels on
both.

**The API runs from `dist`** — if a change appears to have no effect, suspect the
build (`repo-landmines.md`).

## 10. What to report back

1. Commit SHA(s). 2. Every `Tests:` line, both `tsc`, vitest. 3. `git diff --stat`.
4. Manual steps, and **a screenshot of the composer with the list expanded** —
   this card is a piece of UI and the planner has been caught before approving UI
   from types and tests alone.
5. Anything that did not match, in particular: whether exposing a public method
   on `NotificationsService` was the right seam or whether the recipient logic
   wanted extracting somewhere shared; whether attaching delivery facts to
   messages fitted the existing query or needed restructuring; and whether the
   `payload.messageId` lookup performed acceptably on a long ticket.

**Stop and report instead of improvising** if this appears to need a schema
change, a migration, a per-message exclusion list, or a second copy of the
recipient rules. None should be necessary.
