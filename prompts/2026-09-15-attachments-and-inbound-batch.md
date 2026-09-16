# Implementation Prompt — 1.83, 1.105 and 3.5: making attachments actually work

**Date:** 2026-09-15
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** **1.83** (internal-note files reach the requester) → **1.105** (one bad
attachment loses the whole email) → **3.5** (record who downloaded what)

**Three cards, three commits. One migration — the next free number, 67.**

⚠️ **This supersedes `prompts/2026-09-15-attachments-batch.md`**, which covered
only 1.83 and 3.5. **Work from this file.**

> ## The owner has made a decision, and it changes what this batch is for
>
> **2026-09-15: no virus scanner. The download gate gets turned off instead.**
> The reasoning is that attachments arrive through Microsoft 365, where Defender
> for Office 365 has already scanned them in transit.
>
> **So this batch is what has to be true BEFORE that flag is flipped.**
>
> ⚠️ **Right now the blocked download is the only thing hiding card 1.83.** Turn
> the gate off with 1.83 unfixed and a screenshot pasted into a private internal
> note becomes downloadable **by the person it is about**. On a healthcare desk
> that is the worst outcome in this batch.
>
> **Order matters and is not negotiable: 1.83 first.**

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Check the tree is yours:** `git status --porcelain | grep -v '^??'` —
  anything modified under `apps/` that is not yours means **STOP**.
- ⚠️ **Hold the WSL VM open** for every integration run:
  `wsl -d Ubuntu-22.04 -- sleep 2100` in the background.
- ⚠️ **Another batch (1.102, 1.103, 1.104, 1.101) may be running** and takes no
  migration. **This one takes 67 — confirm it is free rather than assuming.**
- **Baseline to beat:** unit **754 / 75**, web **385 / 56**, integration
  **947 + 1 skipped / 93 of 94**, both typechecks clean, migrations **66**.

---

## 1 — Commit one: card 1.83, a file in an internal note is not for the requester

✅ **Verified: `model Attachment` has `ticketId` and NO `messageId`.** Attachments
belong to a ticket, not a message. `tickets.service.ts:1352-1356` lists every
attachment on the ticket; `ticket-attachment.service.ts:260-262` gates download on
`canViewTicket` alone.

**So a screenshot pasted into an INTERNAL note is listed to the requester with its
filename, size and uploader.** The audit confirmed at runtime that an agent's
upload was downloadable by the requester.

- [ ] **Migration 67: add `Attachment.messageId`, nullable, indexed.** Additive,
      **zero `DROP`**, hand-written.
- [ ] ⚠️ **Nullable is correct, not a compromise.** Existing rows have no message,
      and a file attached to the *ticket* rather than pasted into a message
      legitimately has none. **NOT NULL would need a backfill that invents an
      answer.**
- [ ] **Populate it on upload** when the file belongs to a message.
- [ ] **Exclude INTERNAL-message attachments from a requester's listing AND
      download.**
- [ ] ⚠️ **Gate on what the person may READ, not on their role.** A requester and
      an external CC both cannot see internal notes; a peer agent can. **The rule
      already exists at `tickets.service.ts:1026` for messages — mirror it, do not
      re-derive it.** This is the fourteenth chance in this project to write one
      rule twice.
- [ ] ⚠️ **Attachments that already exist have a null `messageId` and MUST stay
      visible.** A change that silently hides every file uploaded before today is
      worse than the bug.

### Tests

- [ ] ⚠️ **An agent uploads a file, references it in an INTERNAL note: the
      requester's ticket does not list it and the download is refused.**
- [ ] **Another agent CAN still see and download it.** Non-vacuity — a fix that
      hides it from everybody passes the first test.
- [ ] **A file on a PUBLIC message is still visible to the requester.**
- [ ] **A pre-existing attachment with no `messageId` is still visible.**
- [ ] ⚠️ **Assert on the serialised listing, not on a field.** **Twice this month
      a field-level assertion passed while the data still went out** — card 1.96's
      follower route and the AI canary.

---

## 2 — Commit two: card 1.105, one bad attachment must not lose the email

✅ **Verified: `normalizeInboundEmailAttachments` is the FIRST call in the try
block** (`inbound-email.service.ts:163-166`), ahead of the requester, the thread
target and the ticket. **So exceeding a limit throws before anything is
persisted, and the whole email — the person's words included — is lost.**

**On the mailbox path the message then stays in the Inbox and is re-offered every
thirty seconds, failing identically each time, with only a counter as the
signal.**

**Limits measured in production:** `INBOUND_EMAIL_MAX_ATTACHMENTS` unset → **10
files**; `ATTACHMENTS_MAX_MB` unset → **10 MB each**.

⚠️ **Ten is lower than it sounds: Outlook signature images count.** A corporate
signature with a logo and social icons is routinely three to five inline images.
**A requester replying with six screenshots is over the limit before they have
attached anything unusual**, and one modern phone photo can exceed 10 MB alone.

### The fix — store first, then attach

- [ ] ⚠️ **Create the ticket or the message FIRST. An attachment problem must
      never discard the sender's words.** That is the entire card.
- [ ] **Attach what can be attached; skip what cannot.**
- [ ] ⚠️ **Record a visible event on the ticket saying something was dropped, and
      why** — *"3 of 12 attachments were not saved (over the 10 MB limit)"*. **An
      agent must be able to see that a file is missing and ask for it again.
      Silently dropping is barely better than losing the email.**
- [ ] **Truncate an over-long subject rather than failing on it** (Prisma `P2000`
      on a 200-character column).
- [ ] ⚠️ **Do NOT simply raise the limits.** A bigger number moves the cliff; it
      does not remove it. **Raising them is a separate, reasonable thing to do
      afterwards — say what you would suggest.**
- [ ] **A message that still cannot be ingested at all needs somewhere to go and
      somebody told.** If a dead-letter path is more than this card can carry,
      **say so and report** rather than half-building one.

### Tests

- [ ] ⚠️ **An email with 12 attachments creates the ticket, saves what fits, and
      records what did not.** The assertion the card exists for.
- [ ] **An email with one 12 MB file still creates the ticket.**
- [ ] **A 250-character subject creates the ticket with a truncated subject.**
- [ ] **A normal email with two small attachments is completely unaffected.**
      Non-vacuity.

---

## 3 — Commit three: card 3.5, record who downloaded what

⚠️ **This card matters more now than when it was written.** With the scan gate
off, every file becomes downloadable by anyone entitled to the ticket — so
*"who opened that file"* stops being a nice-to-have.

- [ ] **In `attachments.controller.ts`'s `GET :id`, write a `TicketEvent` of type
      `ATTACHMENT_DOWNLOADED` with `{ attachmentId, fileName }`.**
- [ ] **Add it to the audit log's filter chips.**
- [ ] ⚠️ **Record refusals too, or decide not to and say why.** After an incident
      the question is often *"did anyone try?"*
- [ ] ⚠️ **The event must never fail the download.** Follow card 1.95's
      `AdminAuditService.record()` shape — rethrow inside a caller's transaction,
      log outside one. **That pattern is already in the codebase and is correct.**
- [ ] **Record nothing on the listing endpoint** — that one is hot.

---

## 4 — ⚠️ The flag is the owner's, and it comes AFTER this batch

**Do not set `ATTACHMENT_SCAN_ENABLED=false` as part of this work.**

- [ ] **Say in your report that the batch is ready for the flag**, and what you
      verified.
- [ ] ✅ **`INFECTED` still blocks unconditionally even with the gate off** —
      confirm that is still true after your changes. **If a scanner is ever added
      later, nothing needs rebuilding.**

---

## 5 — What to report back

1. **Three commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, **migration count (67)**, and
   `check-migrations.sh` clean, run **after** committing.
3. The answers:
   - **1.83 —** how you decided who may see an internal-note file, and
     confirmation you **reused** the existing internal-message rule.
   - **1.83 —** what happens to attachments that already exist.
   - **1.105 —** what an agent sees when a file was dropped, and whether you built
     a dead-letter path or reported it as too big.
   - **1.105 —** what limits you would suggest, separately from this fix.
   - **3.5 —** whether refusals are recorded.
4. **For each card, the assertion that would fail if it regressed — and confirm
   you watched each inversion actually fail.**
5. Anything that did not match. **This document is wrong somewhere.**

## 6 — Browser pass

- [ ] **1.83 —** as an agent, paste an image into an internal note. Open the
      ticket **as the requester**: the file must not be listed. ⚠️ **Check the
      Attachments tab as well as the conversation** — that is where the audit
      found it.
- [ ] **1.83 —** as another agent, confirm it IS there. Open an older ticket and
      confirm its existing attachments still show.
- [ ] **1.105 —** send an inbound email with twelve attachments. **The ticket is
      created, the message is there, and the ticket says some files were not
      saved.**
- [ ] **3.5 —** download a file and find the record in the audit log.

**Stop and report instead of improvising** if the internal-message rule cannot be
reused without a circular import, if storing before attaching would need the
ingestion path restructured more than this card allows, or if hiding
internal-note attachments would hide anything a requester can legitimately see
today.
