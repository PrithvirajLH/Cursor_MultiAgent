# Implementation Prompt — 1.44 One click from the email

**Date:** 2026-09-04
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.44
**Closes:** the resolved email asks a requester to confirm, reopen or rate — and
each one costs them a browser, a Microsoft sign-in, and then hunting for a rating
widget in a sidebar. Most people will do none of it.

**Cost:** none. API + one small web page. **No migration** (§3). Size **S–M**.

> **Owner's requirement, 2026-09-04, verbatim in effect:** *one click closed, one
> click reopened, five stars and one click to rate.* **No mail app. No sign-in. No
> additional clicks.**

> ⚠️ This adds the product's **first unauthenticated write path** that is not
> protected by a shared secret. §2 is the whole reason this card is safe. Read it
> before writing anything.

> **This does NOT depend on card 1.24.** These are links to our own web app, not
> inbound email. **It works today.**

---

## 1. What the requester gets

The resolved email becomes:

```
We have marked your request as resolved.

Is it fixed?   [ Yes, close it ]        <- one click, done
Not fixed?     [ Reopen it ]            <- one click, done

How did we do?  ★ ★ ★ ★ ★               <- five links, one click, done

Reply to this email
view online
```

One click on any of them completes the action and shows a plain "Done" page. **No
sign-in, no second click, no mail app.**

## 2. ⚠️ The trap that would break this, and the design that avoids it

**Microsoft Defender Safe Links, antivirus gateways and link-preview bots fetch
URLs in email automatically, before a human ever reads the message.**

So a plain link that performs the action on `GET` would mean **every resolved
ticket gets auto-confirmed by the scanner**, and every rating set by whichever
star the scanner happened to fetch first. This is a well-known failure mode and it
would look exactly like the feature working.

**The design:**

- [ ] The link is a **`GET` that changes nothing.** It serves a small page.
- [ ] That page performs the action itself with a **`POST`**, on load.
- [ ] The page then shows the outcome: *"Thanks — we've closed this."*

**A scanner fetching the URL executes no page script and therefore changes
nothing. A human still clicks once.** That satisfies the owner's requirement
exactly; the extra step is invisible.

- [ ] ⚠️ **Do not** make the mutating request a `GET`, and **do not** put a
      confirmation button on the page. The first breaks under scanners, the second
      is the extra click the owner ruled out.

## 3. The token — and why no migration

Each link carries a **signed, single-action token**. Not a ticket id, and not a
reusable ticket token.

- [ ] **HMAC-sign** `{ ticketId, action, value, expiresAt }` with a server secret.
      Follow the existing pattern in `e2e/auth.ts` (`createHmac('sha256', …)`) or
      whatever the repo already uses — **find it before adding a dependency.**
- [ ] **One action per token.** A confirm token cannot reopen. A `rating=4` token
      cannot set 5. This is the difference between this card and the hazard card
      1.40 exists to prevent: that token would have let a stranger **post a
      message**; this one can only flip one narrow state on one ticket.
- [ ] **Expire it** — 30 days is ample for a resolved ticket. State what you chose.
- [ ] **No storage, therefore no migration**, because all three actions are already
      idempotent: `CsatService` **refuses a second rating** for a ticket
      (`csat.service.ts:35`), confirming an already-confirmed ticket is a no-op, and
      reopening an open ticket is a no-op. **Verify all three before relying on
      it** — if any is not idempotent, stop and report rather than adding a token
      table quietly.
- [ ] ⚠️ **The token must live in the URL path or query, never in a fragment** —
      fragments are not sent to the server.

### What the page must NOT do

- [ ] ⚠️ **Show nothing about the ticket.** No subject, no reference, no message
      body, no requester name. Anyone who can read or forward the email can reach
      this page, so it must reveal **only** that the action succeeded. Card 1.6
      established the same principle: a ticket reference names its department.
- [ ] **No login prompt**, and it must sit **outside Easy Auth** — like
      `/api/tickets/inbound-email` already does. That is a deploy-side exclusion:
      **name it in your report** so the deploy agent adds it, or the links return
      401 and the feature silently does nothing.
- [ ] Handle the unhappy paths plainly, and **never** with a stack trace: an
      expired token, a token for a deleted ticket, a ticket somebody already
      reopened, a second rating. Each gets a calm sentence.

## 4. What each action does

- [ ] **Yes, close it** — the existing requester-confirm path from card 1.2. Do not
      write a second one.
- [ ] **Reopen it** — the existing requester-reopen path from card 1.2.
- [ ] **★ 1–5** — `CsatService.submit`, which today requires `@CurrentUser`. It
      needs a path that accepts the token's ticket and the **requester as the
      actor**. ⚠️ **Do not loosen the authenticated endpoint** — add the token path
      beside it, so a signed-in rating is unchanged.
- [ ] Every action writes its normal ticket event, so the timeline shows the
      requester did it. **Say where the event records that it came from an email
      link** rather than from the app — an agent should be able to tell.

## 5. The email

- [ ] Replace the three text links with the shape in §1. Keep card 1.34's rules:
      hidden preheader, content first, no hero button, no sign-off, no raw status
      enum.
- [ ] **The stars must survive image blocking.** Use text characters (★ ☆) or
      styled table cells, **not images** — most clients block remote images by
      default, and a rating nobody can see is a rating nobody gives.
- [ ] Keep **`view online`** and **`Reply to this email`**. Someone at a desk may
      still prefer the ticket, and the reply line is card 1.34's decision.
- [ ] Plain-text part gets the same links as URLs, one per line, labelled.

## 6. Tests

- [ ] A valid token performs its action **once** and reports success.
- [ ] ⚠️ **A `GET` of the link changes nothing** — assert the ticket's state and
      the rating are untouched after a bare fetch. **This is the scanner test and
      it is the most important one in this card.**
- [ ] A confirm token cannot reopen; a `rating=4` token cannot write 5. Assert the
      **stored** value.
- [ ] A tampered or truncated token is refused.
- [ ] An expired token is refused, with no state change.
- [ ] A second use is harmless: no duplicate rating, no double transition.
- [ ] ⚠️ **The page body contains no ticket subject, reference or requester name.**
      Assert the absence.
- [ ] The authenticated `POST /api/csat` is **unchanged** — its existing tests pass
      untouched.
- [ ] Targeted, then the **full** suite. **Do not edit source while it runs.**

## 7. Verification

Baselines: **read `CLAUDE.md`.** At the time of writing: api `tsc` 0, unit
**480 / 48**, integration **617 + 1 skipped, 62 of 63**, web `tsc` 0, vitest
**158 / 26**, migrations **57**.

**Read the composed email off a real outbox row** and paste it into a browser.
Then click each of the seven links against the live dev API and confirm the
outcome page and the stored state.

## 8. Acceptance criteria

1. One click closes it. One click reopens it. One click on a star rates it.
2. **No sign-in, no mail app, no second click.**
3. A bare `GET` of any link changes nothing.
4. A token does exactly one thing to exactly one ticket, and expires.
5. The outcome page reveals nothing about the ticket.
6. The stars are visible with images blocked.
7. The authenticated rating path is untouched.
8. Both `tsc` clean; unit, integration and vitest at or above §7.

## 9. What to report back

1. Commit SHA and `git diff --stat`.
2. Every `Tests:` line, both `tsc`, vitest.
3. **The Easy Auth exclusion path the deploy agent must add** — without it every
   link returns 401 and the feature does nothing.
4. Your token expiry, and confirmation that all three actions are genuinely
   idempotent (§3) — or what you did instead.
5. **A screenshot of the email with images blocked**, showing the stars are still
   visible.
6. Where the ticket event records that the action came from an email link.
7. Anything that did not match. Handoffs from this planner have carried a wrong
   line number, a stale premise, an invented file reference, an unconditional
   status transition that would have lost inbound mail, and an instruction that
   would have leaked the existence of deleted tickets. **Say so plainly.**

**Stop and report instead of improvising** if any of the three actions turns out
not to be idempotent, if the token seems to need storing, or if you find yourself
loosening the authenticated CSAT endpoint rather than adding a path beside it.
