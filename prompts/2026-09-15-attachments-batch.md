> # ⚠️ SUPERSEDED — do not work from this file
>
> Replaced by **`prompts/2026-09-15-attachments-and-inbound-batch.md`**, which adds
> card 1.105 and the sequencing the owner’s 2026-09-15 decision requires.
>
> **The owner has decided against a virus scanner**; the download gate is being
> turned off instead. That makes card 1.83 a hard prerequisite rather than a
> priority — and makes card 1.105 part of the same piece of work.

# Implementation Prompt — 1.83 and 3.5: attachments, before the scanner is switched on

**Date:** 2026-09-15
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** **1.83** (internal-note attachments reach the requester) → **3.5**
(nobody records who downloaded a file)

**Two cards, two commits. One migration — the next free number, which is 67.**

> ## Why these two together, and why now
>
> **They are the same code path and the same question: who may see a file, and
> who saw it.** Doing them separately means touching attachment access twice.
>
> ⚠️ **AND THERE IS A DEADLINE ON 1.83 THAT IS NOT ABOUT TIME.** Today the
> production scan gate blocks every download, so the live leak is only the
> *listing*. **The download leak arms the moment card 0.7's virus scanner is
> wired up, or `ATTACHMENT_SCAN_ENABLED` is set to false.**
>
> **So this is a prerequisite for 0.7, not a parallel task.** Building the
> scanner first would turn a contained problem into a live one.

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Check the tree is yours before trusting any run:**
  `git status --porcelain | grep -v '^??'` — **anything modified under `apps/`
  that is not yours means STOP.** A full run was invalidated this way on
  2026-09-15, and a bisect cannot escape it.
- ⚠️ **Hold the WSL VM open** for every integration run:
  `wsl -d Ubuntu-22.04 -- sleep 2100` in the background.
- ⚠️ **A four-card batch (1.102, 1.103, 1.104, 1.101) may be running in another
  session.** It takes no migration. **This one takes 67 — confirm it is free
  rather than assuming.**
- **Baseline to beat:** unit **754 / 75**, web **385 / 56**, integration
  **947 + 1 skipped / 93 of 94**, both typechecks clean, migrations **66**.

---

## 1 — Commit one: card 1.83, a file in an internal note is not for the requester

### What is wrong

✅ **Verified at the schema level:** `model Attachment` has `ticketId` and **no
`messageId`**. Attachments belong to a *ticket*, not to a *message*.

- `tickets.service.ts:1352-1356` lists **every** attachment on the ticket.
- `ticket-attachment.service.ts:260-262` gates download on `canViewTicket`
  **alone**.
- `inline-attachment-ids.util.ts:8-12` already acknowledges the gap in a comment.

**So a screenshot pasted into an INTERNAL note is listed to the requester with
its filename, size and uploader** — and the audit confirmed at runtime that an
agent's upload was downloadable by the requester (200), while non-participants
got 403 and anonymous got 401.

⚠️ **On a healthcare desk the filename alone can be the disclosure** — the wrong
patient's chart, a colleague's payslip.

### The fix

- [ ] **Migration 67: add `Attachment.messageId`, nullable, with an index.**
      Additive, **zero `DROP`**, hand-written.
- [ ] ⚠️ **Nullable is not a compromise, it is correct.** Existing rows have no
      message, and files attached to the *ticket* rather than pasted into a
      message legitimately have none either. **A NOT NULL column would need a
      backfill that invents an answer.**
- [ ] **Populate it on upload** when the file is attached to a message.
- [ ] **Exclude attachments belonging to INTERNAL messages from a requester's
      listing AND download.**
- [ ] ⚠️ **Do not gate on role — gate on what the person may READ.** An EMPLOYEE
      who is the requester and an external CC are both "cannot see internal
      notes"; a peer agent is not. **The rule already exists for messages —
      `tickets.service.ts:1026`'s internal-note filter is the one to mirror, not
      to re-derive.** This is the fourteenth chance to write one rule twice.
- [ ] ⚠️ **Existing rows have a null `messageId` and must stay visible.** A
      migration that silently hides every file uploaded before today is worse
      than the bug.

### Tests

- [ ] ⚠️ **An agent uploads a file and references it in an INTERNAL note: the
      requester's `GET /tickets/:id` does not list it, and
      `GET /attachments/:id` is refused.** The assertion the card exists for.
- [ ] **The same file IS listed and downloadable for another agent.**
      Non-vacuity — a fix that hides it from everyone passes the first test.
- [ ] **A file on a PUBLIC message is still visible to the requester.**
- [ ] **A pre-existing attachment with a null `messageId` is still visible.**
- [ ] ⚠️ **Assert on the serialised listing, not on a field.** **Twice this month
      a field-level assertion passed while the data still went out** — card 1.96's
      follower route and the AI canary. **Assert on the payload.**

---

## 2 — Commit two: card 3.5, record who downloaded a file

**Nobody records attachment downloads.** On a desk handling PHI, *"who opened
that file"* currently has no answer.

- [ ] **In `tickets/attachments.controller.ts`'s `GET :id`, write a `TicketEvent`
      of type `ATTACHMENT_DOWNLOADED` with `{ attachmentId, fileName }`.**
- [ ] **Add it to the audit log's filter chips.**
- [ ] ⚠️ **Record the refusals too, or at least decide not to and say why.** A log
      that only shows successful downloads cannot answer *"did anyone try?"* —
      which is the question that matters after an incident.
- [ ] ⚠️ **Do not let the event write fail the download.** Follow card 1.95's
      `AdminAuditService.record()` shape: **rethrow inside a caller's transaction,
      log outside one.** That pattern is already in the codebase and is correct.
- [ ] ⚠️ **This must not become a performance problem on a hot path.** A download
      is not hot, but **a listing is** — do not record anything on the listing
      endpoint.
- [ ] **This is IT.pdf §6.8**, and it pairs with 1.83: one card decides who may
      see a file, the other records who did.

### Tests

- [ ] **A successful download writes exactly one event naming the file.**
- [ ] **A refused download does whatever you decided** — and the test says which.
- [ ] **The event appears in the audit log filtered by its type.**

---

## 3 — What to report back

1. **Two commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, **the migration count (67)**, and
   **`check-migrations.sh` clean, run AFTER committing.**
3. The answers:
   - **1.83 —** ⚠️ **how you decided who may see an internal-note file**, and
     confirmation you reused the existing internal-message rule rather than
     writing a second one.
   - **1.83 —** what happens to attachments that already exist with no
     `messageId`.
   - **3.5 —** whether you record refused downloads, and why.
4. **For each card, the assertion that would fail if it regressed — and confirm
   you watched each inversion actually fail.**
5. Anything that did not match. **This document is wrong somewhere.**

## 4 — Browser pass

- [ ] **1.83 —** as an agent, paste an image into an internal note. **Then open
      the same ticket as the requester: the file must not be in the list.**
      ⚠️ **Check the Attachments tab as well as the conversation** — that is where
      the audit found it.
- [ ] **1.83 —** as another agent, confirm the file IS there.
- [ ] **1.83 —** open a ticket with an older attachment and confirm it still
      shows.
- [ ] **3.5 —** download a file, then find the record in the audit log.

**Stop and report instead of improvising** if the internal-message rule cannot be
reused without a circular import, if populating `messageId` on upload turns out to
need a change to how the editor posts files, or if hiding internal-note
attachments would hide anything a requester can legitimately see today.
