# Implementation Prompt — card 1.130: an agent's pasted image reaches the requester as an image

**Date:** 2026-09-16
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** **1.130** — the half of card 1.129 fault C that was deliberately left out
**Raised by:** the owner, 2026-09-16, asking *"so if agent sends an image that will be
displayed on requester email?"* — to which the honest answer today is **no**.

> # ⚠️ WHAT CARD 1.129 DID AND DID NOT DO
>
> **1.129 fixed the embarrassment, not the capability.** Before it, a requester
> received `IT BOT <img data-temp-id="6bdd3f50-…" alt="image.png" class=""
> data-attachment-id="324e680b-…">see the img` as literal text, in the readable
> part, in the HTML part **and in the inbox preview line**. After it they receive
> a readable sentence with `[image: screenshot.png]` where the picture sits, and
> an agent's bold/lists/links survive as real formatting.
>
> **The picture itself still never leaves the platform.** ⚠️ **Measured
> 2026-09-16: `EmailService.sendEmail` accepts no attachments at all.** Its
> whole payload is `to`, `subject`, `agentDisplayName`, `cc`, `text`, `html`,
> `replyTo`, `messageId`, `inReplyTo`, `references`, `threadTopic`,
> `threadIndex`. There is no attachment path anywhere in the outbound chain, so
> the requester cannot see the image by any route in the email — only by opening
> the ticket in the portal.

---

> # ⚠️ CORRECTION, 2026-09-17 - THIS PLAN WAS WRONG ABOUT THE HARD PART
>
> **Step 2 below prescribes an abstract `AttachmentBytesReader` in `common/`,
> bound by `TicketsModule`, with `TicketsModule` made `@Global` so a `@Global`
> consumer can see the binding. That is not necessary and was not done.**
>
> ✅ **`CommonModule` IS ALREADY `@Global`, so the whole thing lives there and
> `TicketsModule` IS UNTOUCHED.** `InlineEmailImagesService` sits beside the
> moved `AttachmentStorageService` in `common/`, takes Prisma and the storage
> directly, and `EmailProcessorService` injects it with no module edits at all.
> No abstract class, no binding, no module made global.
>
> **Everything else in this plan held**, including the security rules, the
> ceilings and the never-fatal principle. **Three things it did not predict,
> all found while building:**
>
> - ⚠️ **`outbox.service.ts:415` HAND-COPIES THE CONTENT SHAPE** and carried
>   only `html`, so the image ids were dropped between the service and the row.
>   Card 1.127's bug, one file over, and only the integration test caught it.
> - ⚠️ **The size ceiling checked the DECLARED size and accumulated the
>   ACTUAL bytes read**, so two 800-byte files both passed a 1000-byte budget.
> - ⚠️ **`reply-email-body.spec.ts` had been passing a dead fourth argument**
>   (`sentAt`, removed by card 1.68) for months. Harmless until a real fourth
>   parameter existed, at which point a `Date` arrived as `inlineImages` and
>   every test in the file failed at once.

---

## Goal

An image an agent pastes into a public reply **displays inside the email the
requester opens**, as a `cid:` inline part, with the rest of card 1.129's
rendering unchanged.

---

## Context read

- `prompts/2026-09-16-card-1-129-inline-images-both-directions.md` — the parent
  card; fault C's checklist says *"The HTML part must carry the actual image, as
  a `cid:` inline part or a signed URL. ⚠️ **Prefer `cid:`** — a URL to an
  attachment endpoint will be blocked by most mail clients and needs
  authentication the recipient does not have."*
- `docs/agent-context/repo-landmines.md` — the module-cycle and Windows-process
  traps below.
- `docs/email-conversation.md` — the outbound email's design history.

---

## Facts established (measured 2026-09-16, not inferred)

1. **The outbound chain is:** `NotificationsService.messageAdded` →
   `createAndEnqueueEmail` → a `NotificationOutbox` row →
   `EmailQueueService` (BullMQ) **or** `EmailOutboxSweeperService` (production
   has no Redis, so the **sweeper** delivers, on a 60-second interval) →
   `EmailProcessorService.process` → `EmailService.sendEmail`.
2. **The transport is nodemailer**, so a `cid:` inline part is natively
   supported: `attachments: [{ filename, content, cid }]`. No new dependency.
3. **The outbox payload is JSON.** `EmailProcessorService.getEmailMetadata`
   reads `payload.email.{replyTo,inReplyTo,references,cc}`,
   `payload.content.html` and `payload.event.agentDisplayName`. Adding a key is
   additive and every existing row keeps working.
4. ⚠️ **Blob reading lives in exactly one place and it is on the wrong side of
   the module graph.** `ticket-attachment.service.ts` owns
   `getAttachmentReadStream` / `saveAttachmentFile` / `deleteAttachmentFile` and
   the cached `BlobServiceClient`, and it is provided by **`TicketsModule`** —
   which **imports `NotificationsModule`**. So the email processor cannot reach
   it without closing a cycle.
5. ✅ **THE REPO HAS ALREADY SOLVED THIS EXACT SHAPE ONCE.** Card 1.103 hit
   `common -> automation -> notifications -> common` and fixed it by declaring
   an **abstract `AutomationRunner` in `common/`**, bound by `AutomationModule`
   with `{ provide: AutomationRunner, useExisting: RuleEngineService }`.
   `CommonModule` is `@Global`, which is what makes the binding visible without
   an import. See the comment at `common/common.module.ts:17`, which says in
   terms: *"`common` NO LONGER IMPORTS `automation`, AND MUST NOT AGAIN."*
6. **`renderMessageBodyEmailHtml` already owns the decision** about what an
   `<img>` becomes (`notifications/message-body-email-html.util.ts`,
   `renderImage`). Its doc comment already records why the image is named rather
   than drawn, and names this card as the reason.
7. **Which files are inline is already knowable, twice over:** the body carries
   `data-attachment-id` markers (`common/inline-attachment-ids.util.ts` parses
   them server-side and `redaction-caveat.ts` counts them), and since card 1.121
   `Attachment.messageId` links a file to the message it belongs to.
8. **Card 1.129 fault A already returns a message's attachments** from
   `listMessages` (`tickets.service.ts`), selected rather than included whole so
   `storageKey` never leaves the server.

---

## Decisions (made; do not re-litigate)

- **`cid:`, not a signed URL.** A URL to `/api/attachments/:id` is behind Easy
  Auth and the app's own guard; the requester has neither. Most clients also
  block remote images by default, so even a public URL would show a grey box.
- **Ids in the outbox payload, bytes at send time.** A 2.8 MB screenshot is
  ~3.8 MB of base64; putting that in a JSON column once per recipient is the
  wrong thing. The payload carries `content.inlineImages: [{ attachmentId, cid,
  fileName, contentType }]` and the processor reads the files.
- **Move the storage layer into `common/`, do not copy it.** Two spellings of
  one storage path is this project's recurring failure. `TicketAttachmentService`
  keeps its public methods and delegates.
- **A size ceiling, and it is not fatal.** Over the ceiling the image stays
  `[image: name]` exactly as card 1.129 leaves it. Mail systems cap between 10
  and 25 MB, so default the ceiling to **5 MB per image and 10 MB per email**,
  overridable by `EMAIL_INLINE_IMAGE_MAX_BYTES` /
  `EMAIL_INLINE_IMAGES_MAX_TOTAL_BYTES`.
- **A failure to read a file never fails the email.** Card 1.105's principle:
  the message goes out with the name in place of the picture. A reply that
  cannot be sent because a picture is missing is strictly worse than a reply
  without the picture.

---

## The work

### 1. `apps/api/src/common/attachment-storage.service.ts` (new)

Move, verbatim, from `tickets/ticket-attachment.service.ts`:
`resolveAttachmentPath`, `isAzureBlobStorageEnabled`, `saveAttachmentFile`,
`getAttachmentReadStream`, `deleteAttachmentFile`,
`saveAttachmentFileToAzureBlob`, `getAttachmentReadStreamFromAzureBlob`,
`getAzureContainerClient`, `ensureAzureContainer` and the cached client fields.

- Register it in `CommonModule`'s `providers` **and** `exports`.
- `TicketAttachmentService` injects it and **delegates** — its public method
  names and signatures do not change, so nothing that calls it moves.
- ⚠️ **Nothing about behaviour changes here.** If a test needs editing, stop and
  work out why before editing it.

### 2. `apps/api/src/common/attachment-bytes-reader.ts` (new)

An abstract class, the card 1.103 pattern:

```ts
export abstract class AttachmentBytesReader {
  abstract readInlineImages(
    ticketId: string,
    attachmentIds: string[],
  ): Promise<InlineEmailImage[]>;
}
```

Bound in `TicketsModule` with
`{ provide: AttachmentBytesReader, useExisting: TicketAttachmentService }`.
⚠️ **`TicketsModule` must be `@Global` for a `@Global` consumer to see the
binding**, exactly as `AutomationModule` had to be — read the comment at
`automation/automation.module.ts:14` before choosing anything else.

The implementation on `TicketAttachmentService`:

- loads the rows **by id AND ticketId** (never id alone),
- ⚠️ **refuses any attachment whose `message.type` is `INTERNAL`** — card 1.83's
  rule, called rather than restated, because this path sends the bytes to the
  requester,
- refuses anything whose `scanStatus` the download gate would refuse
  (`assertAttachmentDownloadAllowed`),
- refuses anything over the per-image ceiling,
- returns `{ attachmentId, fileName, contentType, content: Buffer }`.

### 3. `apps/api/src/notifications/notifications.service.ts`

In the public-reply path, resolve the body's inline ids and put them on the
payload:

- parse with the existing `common/inline-attachment-ids.util.ts`,
- keep only ids that are attachments **of that message**,
- mint a stable `cid` per attachment (the attachment id is already unique and
  URL-safe — use `${attachmentId}@csnhc.com`, and derive the domain from the
  reply address rather than hardcoding it),
- write `emailContent.inlineImages`.

`renderMessageBodyEmailHtml` takes the map and emits
`<img src="cid:…" alt="…" style="max-width:100%;height:auto;">` for an entry it
has, and keeps `[image: name]` for one it does not.

⚠️ **The text part does not change.** It keeps saying `[image: name]`, because a
text part cannot show a picture and a `cid:` reference in it is noise.

### 4. `apps/api/src/notifications/email-processor.service.ts`

Read `content.inlineImages` from the payload, call `AttachmentBytesReader`, pass
the result to `sendEmail`. Drop anything that fails to read, log it at `warn`,
and send anyway.

### 5. `apps/api/src/notifications/email.service.ts`

`sendEmail` gains `attachments?: { filename: string; content: Buffer; cid: string }[]`
and passes them to nodemailer untouched.

⚠️ **The pilot-mode rewrite in `decorateHtmlBody` must not be disturbed** — it
inserts a notice after the preheader, and the `cid:` images sit inside the body
it is editing.

---

## Security

- **The requester receives these bytes.** An attachment on an INTERNAL note must
  never be embedded — assert it in a test, because card 1.83's rule has only
  ever been exercised on the download route.
- Files are looked up **by id and ticket together**, so a crafted body cannot
  pull a file off another ticket.
- The AV gate's refusal states apply here exactly as they do to a download.
- No new public endpoint, no new secret, no change to Easy Auth.

---

## Acceptance

1. An agent pastes an image into a public reply; the requester's email **shows
   the image**, inline, where the sentence put it.
2. The text part still reads `[image: screenshot.png]`.
3. No `data-attachment-id`, no `data-temp-id`, no `<img` visible as text
   anywhere — card 1.129's guarantees still hold.
4. An image over the ceiling is named, not embedded, and the email still sends.
5. A file that cannot be read is named, not embedded, and the email still sends.
6. ⚠️ An attachment on an INTERNAL note is **never** embedded.
7. Card 1.44's seven one-click links still work from a resolved email.
8. Upload, download and delete of attachments are unchanged — the storage move
   is invisible.

---

## Checks

```
api tsc 0 · web tsc 0
unit          872 / 92 suites          (the card 1.129 baseline)
web           434 / 63 files
integration   970 + 1 skipped, 96 of 97 suites
migrations    67 — this card adds NONE
```

⚠️ **The attachment integration specs are the check that matters** for step 1:
`attachments.spec.ts`, `internal-note-attachments.spec.ts`,
`inbound-attachment-resilience.spec.ts`. Run them first, before the full suite.

---

## Manual steps

⚠️ **THIS CARD CANNOT BE VERIFIED IN A BROWSER, and that is not a gap in the
plan.** The thing to check happens inside a MIME message, not on a page. Verify
it by asserting the payload handed to nodemailer — a test double on
`sendEmail` that captures `attachments` and checks the `cid` matches the
`src="cid:…"` in the HTML part. That is stronger than a screenshot anyway.

⚠️ **`apps/api/.env` is missing on this machine** (the tree was re-checked out
2026-09-16 at 14:12 and took every gitignored file with it). The integration
suite does not need it — `test/setup-tests.ts` pins what it needs and notes that
CI has no `.env` at all — but **the dev API cannot start without it**, so a
browser pass needs it restored first.

---

## Handoff notes

- **No migration.** Nothing about the schema changes.
- **Deploy:** ordinary. No settings to add unless the owner wants a ceiling
  other than the default, in which case `EMAIL_INLINE_IMAGE_MAX_BYTES` /
  `EMAIL_INLINE_IMAGES_MAX_TOTAL_BYTES` are **created**, not changed.
- **Sequence:** after card 1.129 is merged. It builds directly on
  `message-body-email-html.util.ts`, which 1.129 introduces.
