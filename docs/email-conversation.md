# Email conversation: safety rails and switching on

**Status after card 1.23: production CAN send, and every message goes to the
pilot list.** `EMAIL_TEST_RECIPIENTS` is set to the owner's address in the same
change that sets `SMTP_HOST`, so no requester can be reached. While that
variable holds an address, a real person outside the pilot list cannot receive
mail from this app — a property pinned by a test, not by this paragraph.

**Turning the pilot switch off is the moment this system starts emailing real
people.** Do it deliberately, with the domain allowlist checked and someone
watching the outbox, not as a tidy-up at the end of a deploy.

Before 1.23 the system sent nothing at all: `SMTP_HOST` was unset in production
(the setting was deliberately named `SMTP_HOST_DEV_DISABLED`) and `EmailService`
refused every send with `SMTP not configured`.

Everything here is cheap now and expensive after the first bad email reaches a
real person.

---

## The six guards

| Guard | Where it lives | What it prevents |
|---|---|---|
| Quote trimming | `notifications/quoted-reply.util.ts` | A reply arriving as an unreadable wall of quoted text. Display only — the full body is always stored. |
| Auto-reply detection | `tickets/auto-reply.util.ts` | An out-of-office and our acknowledgement emailing each other forever. |
| Inbound rate cap | `tickets/inbound-email.service.ts` | The same, for a sender that loops without saying it is automated. |
| Domain allowlist | `notifications/outbound-recipients.util.ts` | Mail leaving the organisation. |
| Internal-note refusal | `notifications/outbound-recipients.util.ts` | An internal note reaching the person who raised the ticket. |
| Pilot switch | `notifications/email.service.ts` | A test send reaching real people. |

### Quote trimming

`stripQuotedReply(body)` returns what the sender actually typed. It cuts at the
first confident marker: our own `----- Reply above this line -----`,
`-----Original Message-----`, an Outlook `From:`/`Sent:` header block, a Gmail
`On … wrote:` attribution (including the wrapped form), a `_____` rule, and the
RFC 3676 `-- ` signature delimiter.

Two rules matter more than the markers:

- **Nothing is guessed.** No "Sent from my iPhone", no corporate disclaimer
  sniffing. If no marker matches, the body is returned byte-identical.
- **Nothing is lost.** Trimming happens when a message is displayed, never
  before it is stored, and a body that is *entirely* quoted comes back whole
  rather than empty.

### Auto-reply detection and the rate cap

`isAutomatedEmail(headers)` is layer one, and reads only headers the sender set
deliberately: `Auto-Submitted` (anything but `no`), `X-Auto-Response-Suppress`,
`Precedence: bulk|junk|list`, any `List-Id`, and an empty `Return-Path` (`<>`,
the null reverse path a vacation responder uses precisely so nothing answers).

The inbound webhook accepts these as **optional** fields — `autoSubmitted`,
`autoResponseSuppress`, `precedence`, `listId`, `returnPath`. A receiver that
sends none of them behaves exactly as it did before this card.

Layer two is a rate cap: more than **5 messages from one sender on one ticket
within 5 minutes** and the sixth is recorded but answers nothing. It is counted
from `InboundEmailReceipt` rows, which already exist for every inbound message
and are unique on `messageId`, so no new table and no state of our own.

When either layer fires, the message is **still recorded** — an agent should see
the out-of-office arrived — and a `INBOUND_EMAIL_SUPPRESSED` event goes on the
ticket saying which layer fired and why. Nothing is ever bounced.

### Who may be emailed

`resolveOutboundRecipients` decides, and returns its refusals rather than
dropping them, so the caller can record on the ticket that a message did not
reach someone. It refuses an address that is outside `EMAIL_ALLOWED_DOMAINS`,
is a `no-reply`/`noreply`/`donotreply`/`mailer-daemon`/`postmaster` style
address, or has been suppressed after a bounce.

It **throws** — loudly, and nothing catches it — when an `INTERNAL` note is
addressed to the person who raised the ticket. The guard is on *who the
recipient is*, not on their role, and that is deliberate: `NotificationsService`
excludes `EMPLOYEE`s from internal notes, which does nothing at all when the
requester is an agent or a lead raising their own ticket. That case is normal in
a helpdesk and was live before this card.

### The pilot switch

While `EMAIL_TEST_RECIPIENTS` holds one or more addresses, every outbound
message goes to them **instead of** its intended recipients. Replaced, never
merged, never appended to, never fallen back on — there is no input for which an
intended recipient reaches the transport, and that is pinned by a test rather
than by this paragraph. The body gains one line naming who it would have gone
to, so a pilot read still shows the real audience.

The value is read on **every** send, not captured at startup: it is the switch
an operator flips when a test send is about to go somewhere it should not, and
one that needed a restart would be useless at exactly that moment.

---

## Settings

| Name | Default | Notes |
|---|---|---|
| `EMAIL_ALLOWED_DOMAINS` | `csnhc.com` | Comma-separated. Matched on the domain after the last `@`, case-insensitive. Relaxing it later is a setting change, not a deploy. |
| `EMAIL_TEST_RECIPIENTS` | empty | Comma-separated pilot list. **Set to the owner's address in production as of card 1.23.** Empty means real recipients receive mail. |
| `SMTP_HOST` | unset | `smtp.socketlabs.com`. Setting this is what makes the system able to send at all. |
| `SMTP_PORT` | `587` | STARTTLS. Not 465. |
| `SMTP_SECURE` | `false` | `false` + port 587 is STARTTLS. `true` means TLS from the first byte, which belongs to 465; setting it true on 587 hangs the handshake. |
| `SMTP_USER` / `SMTP_PASS` | unset | SocketLabs credentials. |
| `SMTP_FROM` | `no-reply@localhost` | The desk address. The display name lives in code, not here. |
| `SMTP_REPLY_TO` | falls back to `SMTP_FROM` | The helpdesk mailbox, so a reply is aimed correctly before card 1.24 exists. A per-message `+ticket-<token>` reply-to overrides it. |

The pilot list and the allowlist are read on every send. The transport settings
are read when the module loads, so changing those needs a restart.

**STARTTLS is mandatory.** The transport sets `requireTLS: !secure`. Without it
nodemailer falls back to plaintext when STARTTLS negotiation fails, which would
put the SMTP password on the wire.

---

## Bounce suppression

An address that fails to accept mail stops receiving it, and stays stopped
across restarts — the `EmailSuppression` table, added by the 52nd migration.

- A **HARD** failure (a 5xx reply: no such mailbox) suppresses immediately.
- A **SOFT** failure (a 4xx reply: mailbox full, greylisted) only counts. Five
  of them suppress. Suppressing a full mailbox permanently on one failure would
  lose real mail from someone who is merely away.
- A failure we cannot read is treated as SOFT. Guessing HARD would silence an
  address on one unrecognised error.
- A hard failure upgrades an address that had only failed softly. A soft one
  never downgrades a hard one.

**Listing and clearing.** Owner only; a team admin or a lead gets 403.

    curl -s https://<host>/api/operations/email-suppressions

    curl -s -X POST https://<host>/api/operations/email-suppressions/clear \
      -H "content-type: application/json" \
      -d "{\"address\":\"someone@csnhc.com\"}"

The address goes in the body rather than the path because an email address in a
URL segment is an encoding trap. Clearing deletes the row outright rather than
zeroing a counter, so a fresh failure starts from scratch.

## The outbox sweeper

Queued email lives in `NotificationOutbox`. It is attempted once, when it is
queued, and `markFailed` puts the row back to `PENDING` for a retry — but the
only things that call the processor are the BullMQ worker and that one inline
call, and **Redis is off in production**. So before card 1.32 the retry ladder
was fully written and never climbed: a transient failure left a row sitting at
`PENDING` forever and nobody was told.

The sweeper is the thing that climbs it. Every 60 seconds it:

1. **Reclaims abandoned rows.** `claimPending` moves a row to `PROCESSING`; a
   process that dies before finishing leaves it there in a status nothing looks
   at. Anything `PROCESSING` for more than 10 minutes goes back to `PENDING` —
   or to `FAILED` if it has already used its five attempts, rather than looping.
2. **Retries up to 20 `PENDING` rows** that have attempts left, oldest first, by
   calling the same processor the queue calls. It does not reimplement sending.

**It never touches a `FAILED` row.** A row reaches `FAILED` either by exhausting
its attempts or because the failure was terminal — `SMTP not configured`, or a
suppressed address. Retrying those would send mail somebody decided should not
be sent.

The summary it reports (`reclaimed`, `exhausted`, `retried`, `sent`, `failed`,
`stillPending`) is read from the rows afterwards, not from what the processor
returned: the processor returns normally in cases where nothing was actually
sent, so counting its return values would report sends that never happened.

**Where to look.** `Admin → Operations` shows outbox depth — waiting, in flight,
sent, given up — and lists the sweeper as a fourth job with **Run now**. The same
counts are on `GET /api/health/ready` as `outbox`. Numbers only: no address, no
subject, no body.

One thing worth remembering: the sweeper runs while the pilot switch is on, so
anything it retries goes to the pilot list. It is also the thing that will send
the accumulated backlog the moment `EMAIL_TEST_RECIPIENTS` is cleared.

| Name | Default | Notes |
|---|---|---|
| `EMAIL_OUTBOX_SWEEP_ENABLED` | `true` | Only the literal `false` turns it off. |
| `EMAIL_OUTBOX_SWEEP_INTERVAL_MS` | `60000` | |
| `EMAIL_OUTBOX_SWEEP_BATCH` | `20` | Rows per tick. |

---

## Known gaps, deliberately left

- **Bounces are only learned synchronously.** A suppression row is written when
  the SMTP conversation itself rejects a recipient. An asynchronous bounce —
  accepted now, rejected minutes later, which is the common case — needs
  SocketLabs to POST to us: a new public endpoint, an Easy Auth exclusion and a
  shared secret, the same shape as the intake endpoint. **That webhook is still
  owed** and is its own card.
- **The From line is the generic desk identity on every message.**
  `EmailService` builds it through `buildFromIdentity`, so mail goes out as
  `CSNHC Helpdesk <helpdesk@csnhc.com>` rather than a bare address, and the
  parameter for an agent's name exists. Nothing supplies one yet: the outbox row
  carries only the message id and the reply headers, so neither the actor nor
  the ticket's team reaches the transport. Naming the agent — and using the
  generic identity for HR and Payroll specifically — needs those to travel with
  the outbox record, which is a change to what gets queued, not to what sends.
- **Refusals are still not recorded on the ticket.** `EmailService` applies the
  recipient guard immediately above the transport, so nothing reaches `sendMail`
  unguarded and a refusal is counted in the log. Showing an agent that their
  message did not reach someone needs the queueing path to carry the refusal
  back, which is still owed.
