# Implementation Prompt — 1.68 the email footer, and 1.67's Reply-To name

**Date:** 2026-09-10
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** **1.68** (remove the footer) and **1.67 item ①** (give `Reply-To` a
display name) — **in that order**

**One commit per card. Two commits.** Work straight through. Do not check in
between them, and do not ask permission.

**Both are owner requests, both are small, and neither needs a migration.**

> ⚠️ **Check `git status` first.** Cards 1.62 and 1.65 may still be sitting
> uncommitted from two other sessions. If they are, **commit them separately with
> the explicit paths in `prompts/2026-09-10-deploy-1-62-1-65.md` §0 before you
> start.** **Never `git add -A` in this repo.**

---

## 0. Before anything

- **Read `CLAUDE.md`.** Its baseline block says which numbers came from which
  uncommitted workstream — **re-measure rather than trusting it.**
- ⚠️ **Kill surviving jest processes before any integration run.** A harness
  reporting a run as killed is not evidence it stopped, and exit 127 with no
  summary is a spawn failure. `repo-landmines.md`.
- **No migrations.** Count stays at **60**.
- **Trust a live run over this document.**

---

## 1 — Card 1.68: remove the email footer (S, no migration)

The owner wants this gone, from a screenshot of a real email:

```
Reply to this email
────────────────────────────────
view online
```

### ⚠️ This reverses a recorded decision, deliberately

`notifications.service.ts:25-30` carries the note:

> *"The one instruction in a reply email. The owner's exact wording — an earlier
> draft read 'Reply to this email and your answer goes onto the ticket' and the
> shorter line is the decision. **Do not lengthen it.**"*

That was **card 1.34**, and card 1.44's spec repeated *"keep `view online` and
`Reply to this email`."* **The owner has now asked for both to go.** That is their
call — **but update the comment rather than leaving it contradicting the code**,
because a doc comment describing a decision that no longer holds is exactly what
has cost this project days elsewhere.

### Every site — four emails, two halves each

| Email | text | HTML |
|---|---|---|
| Resolved | `:142` | `:606`, `:608` |
| Public reply | `:1138` | `:1208`, `:1210` |
| Inbound acknowledgement | `:1266` | `:1308`, `:1310` |
| Default notification | `:548` | `:1363` |

- [ ] **Remove the reply instruction and the `view online` link from all four**,
      in both the text and the HTML half. **Also remove the horizontal rule** above
      them — it exists to separate the footer from the body, so with the footer
      gone it is a line to nowhere. **The owner's screenshot shows the rule as part
      of what they mean.**
- [ ] **Delete `REPLY_INSTRUCTION` and its doc comment** once nothing references
      it. **Do not leave an unused constant** — `.cursorrules` and this repo's
      history both punish that (card 1.62's whole fault B was a util nobody
      called).
- [ ] ⚠️ **Do NOT touch card 1.44's seven one-click links.** They are in the
      resolved email and they are not the footer: close, reopen, and five rating
      stars. **They stay.** If you find yourself editing
      `buildResolvedEmailLinks`, stop — you are in the wrong place.
- [ ] ⚠️ **Keep the hidden preheader.** Card 1.34's preheader is what makes the
      inbox preview readable, and it is not part of the footer. Removing it would
      make the thing card 1.35 fixed come back.
- [ ] **Check whether the plain-text part still ends sensibly.** With the last two
      lines gone, make sure there is no trailing separator, no double blank line,
      and nothing that reads as truncated. **Read one composed body end to end
      rather than trusting the diff.**

### Tests — eleven assertions across four files pin this text

`email.service.spec.ts` (1), `reply-email-body.spec.ts` (4),
`notifications.email-policy.spec.ts` (1), `tickets.inbound-email.spec.ts` (5).

- [ ] ⚠️ **Do not just delete those assertions.** Where one exists only to prove
      the footer was present, **invert it** — assert the footer is **absent**. That
      keeps the decision visible and stops a later change quietly putting it back.
- [ ] ⚠️ **Read each one before changing it.** Some may be asserting something
      else and merely mentioning the string in passing — for example a test about
      the marker's position relative to other content. **Say which you inverted,
      which you deleted, and which you left alone.**
- [ ] **Add one assertion that the seven resolved-email links survive**, since
      that is the thing most at risk from editing this file.

---

## 2 — Card 1.67 item ①: give `Reply-To` a display name (XS, no migration)

**The owner's Sent folder is a list of
`glovebox+ticket-efda930ef729d376003…@csnhc.com`.**

**Cause, verified:** `From` goes out through `buildFromIdentity`
(`from-identity.util.ts:46-58`), which returns `"CSNHC Helpdesk" <address>` —
which is why the **inbox** shows a name. **`Reply-To` does not.**
`email.service.ts:206` passes:

```ts
replyTo: payload.replyTo ?? this.replyToAddress,
```

A bare address, so the client has nothing to show but the token.

- [ ] **Wrap it the same way `From` already is, and reuse that formatter** rather
      than writing a second one — **one rule in two places is the drift behind cards
      1.36, 1.38, 1.47, 1.50, 1.55 and 1.66.**
- [ ] ⚠️ **But note what you CANNOT reuse directly.** `HELPDESK_IDENTITY` (`:7`),
      `FALLBACK_ADDRESS` (`:10`), `SPECIALS` (`:13`) and `encodeDisplayName` (`:28`) in
      `from-identity.util.ts` are all **private**, and `.cursorrules:13` says **one
      export per file** — so exporting a second function from there is against the
      house style. **The planner's suggestion: extend `buildFromIdentity`'s existing
      input object** with something like a desk-only flag, since it already takes
      `FromIdentityInput`. That reuses the formatter, adds no export, and keeps the
      RFC-quoting rules in exactly one place. **If you prefer a different shape, say
      which and why** — the constraint is no second formatter and no second export,
      not the specific mechanism.
- [ ] ⚠️ **Do not hand-roll the quoting.** `encodeDisplayName` exists because a
      display name containing `( ) < > [ ] : ; @ \ , . "` has to be quoted per RFC
      5322, and `CSNHC Helpdesk` happens to be safe today. A formatter that works only
      for the current string is a trap for whoever renames the desk.
- [ ] ⚠️ **The display name must NOT vary per agent here.** `From` uses
      `Sarah Chen (CSNHC Helpdesk)` because the reply comes *from* a person. The
      **reply-to address is the desk**, and every ticket's is different — so a
      per-agent name on it would be wrong twice over. **Use the desk identity
      alone.**
- [ ] ⚠️ **The address must not change**, only its presentation. If the bytes
      after `<` differ by even a character the reply lands nowhere, and
      `ticket-email-thread.service.ts:259` is what parses it back. **Assert the
      address is byte-identical to what `buildReplyToAddress` returned.**
- [ ] **Then the token length stops mattering.** Card 1.67 item ② — shortening
      `randomBytes(18).toString('hex')` (36 chars) to
      `randomBytes(12).toString('base64url')` (16 chars) — is **NOT part of this
      card.** Nobody sees the token once it has a name in front of it, and
      existing threads keep their long tokens regardless. **Do not do it here.**

### Tests

- [ ] The `Reply-To` header is `"CSNHC Helpdesk" <glovebox+ticket-…@csnhc.com>`,
      and **the address inside the angle brackets is unchanged.** That second half
      is the regression assertion — a formatting change that breaks the address
      breaks inbound threading, which is the one thing that just started working.
- [ ] A round trip: the address from a formatted `Reply-To` still parses back to
      the same ticket through `resolveByReplyToken`, or whatever
      `ticket-email-thread.service.ts:259`'s matcher is reached by. **Prove the
      loop closes** rather than testing the string alone.

---

## 3 — What to report back

1. **Two commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, and **the migration count, which must
   still be 60.**
3. The answers:
   - **1.68 —** of the eleven footer assertions, **which you inverted, which you
     deleted, and which you left alone, with a reason for each.**
   - **1.68 —** confirmation that the hidden preheader and card 1.44's seven links
     both survive.
   - **1.67 —** the exact `Reply-To` header you now emit, and proof the address
     inside it is byte-identical.
4. **For each card, the specific assertion that would fail if it came back.**
5. ⚠️ **Whether you had to commit anyone else's work to get a clean tree**, and
   exactly what.
6. Anything that did not match. **This document is wrong somewhere.**

## 4 — Browser / mailbox pass

**This one genuinely needs a mailbox, not a browser** — the whole point is what a
mail client shows.

- [ ] **1.68** — trigger one of each of the four emails and read them in Outlook.
      Confirm the footer and its rule are gone, the body still ends cleanly, and
      **the resolved email still shows its seven links.**
- [ ] **1.67** — reply to one of those emails and look at **your own Sent folder.**
      It should read **"CSNHC Helpdesk"**, not a token.
- [ ] ⚠️ **Then confirm the reply still landed on the ticket.** That is the check
      that matters more than the cosmetics: a malformed `Reply-To` would make the
      reply vanish, and the inbound worker only started working today.

**Stop and report instead of improvising** if removing the footer would mean
touching `buildResolvedEmailLinks` or the preheader, if any footer assertion turns
out to be testing something else, if the `Reply-To` address changes by so much as a
character, or if a reply stops landing on its ticket.
