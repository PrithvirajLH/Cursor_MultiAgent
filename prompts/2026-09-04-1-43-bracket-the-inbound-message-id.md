# Implementation Prompt — 1.43 Bracket the inbound message id

**Date:** 2026-09-04
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.43 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** the acknowledgement email — the **first** thing a requester who emails
in ever receives — can emit an unbracketed `In-Reply-To`, which a strict client may
fail to match. If it fails to match, **their reply does not thread onto the
ticket.**

**Cost:** none. **One normalisation, used twice.** No schema, no migration.
Size **XS**.

> **Pre-existing**, not caused by card 1.42. Found by 1.42's implementer, who
> flagged it rather than fixing it because that card said not to touch threading
> headers and to stop and report. That was the right call — this is the one
> subsystem where a wrong guess loses mail.

---

## 1. The defect, verified 2026-09-04

`apps/api/src/notifications/ticket-email-thread.service.ts`

The file already knows bare ids arrive. Line 125-130:

```ts
/** Inbound ids arrive from other people's clients; bracket them if they are bare. */
private normalizeMessageId(messageId: string | null | undefined) {
  const raw = messageId?.trim() ?? '';
  if (!raw) return '';
  return raw.startsWith('<') ? raw : `<${raw}>`;
}
```

It is applied to the ancestry (`:117`) and at `:330`. **It is not applied to
`preferredInReplyTo`**, which is used raw in **two** places:

| Line | Use |
|---|---|
| `:51` | `const inReplyTo = params.preferredInReplyTo?.trim() \|\| this.pickInReplyTo(thread, root)` |
| `:58` | `params.preferredInReplyTo ?? undefined` inside the `References` array |

And the value comes straight from the requester's own mail client —
`notifications.service.ts:576`:

```ts
preferredInReplyTo: details.inboundMessageId,
```

So an inbound `Message-ID` that arrives without angle brackets is emitted without
them, into both headers, on the acknowledgement. **RFC 5322 requires the brackets**
(`msg-id = "<" id-left "@" id-right ">"`).

**Why it matters more than it looks:** this is the requester's *first* exchange.
Whether their reply lands on the ticket or arrives as a brand-new ticket is decided
by whether their client matched these headers. The whole point of cards 1.33 and
1.35 was one ticket, one conversation.

## 2. The fix

- [ ] Normalise **once**, at the top of `buildOutboundEmailContext`, and use the
      normalised value for both `:51` and `:58`. Do **not** normalise twice at the
      two call sites — one of them would later be missed, which is how this
      happened.
- [ ] Use the **existing** `normalizeMessageId`. Do not write a second bracketing
      helper.
- [ ] An empty or whitespace-only value must stay empty and must not become `<>` —
      `normalizeMessageId` already returns `''` for that, so route through it rather
      than around it.
- [ ] `isUnroutableMessageId` filtering on `References` must still apply **after**
      normalisation, not before — a bare `abc@localhost` should still be dropped.
      Check the order and say what you found.

## 3. Tests

- [ ] A bare inbound `Message-ID` produces a **bracketed** `In-Reply-To` and a
      bracketed entry in `References`.
- [ ] An already-bracketed id is **not** double-bracketed (`<<id>>`).
- [ ] An empty `preferredInReplyTo` falls through to `pickInReplyTo` exactly as it
      does today, and emits no empty brackets.
- [ ] A bare **unroutable** id (`@localhost`) is still filtered out of `References`
      after normalisation.
- [ ] ⚠️ **There is an existing test asserting the current, unbracketed behaviour**
      — 1.42's implementer added it deliberately so the fix would be a visible
      change. **Update it, do not delete it**, and say which test it was.
- [ ] Every existing threading test in `email-threading.spec.ts` must still pass.
      **If one goes red, stop** — threading is the subsystem where a wrong guess
      loses mail.
- [ ] Targeted, then the **full** suite. **Do not edit source while it runs.**

## 4. Verification

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npm run test:integration > ../../int-full.txt 2>&1
grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

**Baselines** — read `CLAUDE.md`, and do not trust an older number: card 1.42
moved them again. At the time of writing: api `tsc` 0, unit **470 / 47**,
integration **576 + 1 skipped, 60 of 61**, web `tsc` 0, vitest **143 / 25**,
migrations **56**.

## 5. Acceptance criteria

1. A bare inbound id is bracketed in both `In-Reply-To` and `References`.
2. An already-bracketed id is unchanged.
3. Unroutable ids are still filtered.
4. Normalisation happens in **one** place.
5. Every existing threading test passes, and the test that pinned the old
   behaviour was updated rather than removed.
6. Both `tsc` clean; unit, integration and vitest at or above §4.

## 6. What to report back

1. Commit SHA and `git diff --stat`.
2. Every `Tests:` line, both `tsc`, vitest.
3. **Which test pinned the old behaviour**, and what it says now.
4. What you found about the `isUnroutableMessageId` ordering (§2).
5. Anything that did not match. Handoffs from this planner have carried a wrong
   line number, a stale premise, an invented file reference, an unconditional
   status transition that would have lost inbound mail, and an instruction that
   would have leaked the existence of deleted tickets. **Say so plainly.**

**Stop and report instead of improvising** if this appears to need a change to
`References` ordering, to the root id, or to how `pickInReplyTo` chooses — none
should be necessary.
