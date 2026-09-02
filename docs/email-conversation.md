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

## One ticket, one conversation

Every email about a ticket references the same synthetic root id:

    <ticket.{replyToken}@{sending domain}>

It is **derived, never stored** - from the `replyToken` the thread row already
has. That is the whole trick, and it is worth understanding why, because four
separate faults were fixed by it rather than by tracking the anchor more
carefully.

**What was wrong.** The thread pointer (`lastOutboundMessageId`) was written
when an email was *queued*, not when it was *delivered*. A message queued while
SMTP was off still advanced the pointer, so every later email quoted a message
that existed in nobody's mailbox. Worse, each recipient used to get their own
outbox row and therefore their own `Message-ID`, while the pointer was a single
shared field - so it usually named somebody else's copy, and with two
recipients at least one of them could never thread. An internal note moved the
same pointer, so a requester's next email referenced a note they were never
sent. And `References` was composed from a fixed set rather than accumulating,
so there was no fallback ancestry to survive any of it.

**What holds now:**

- **A derived root cannot go stale.** Nothing records it, so a failed send
  cannot poison it, and an internal note cannot move it.
- **`References` accumulates**, root first so the 20-item cap can never drop
  it, then the real ancestry - rebuilt from inbound receipts and outbox rows
  that are actually `SENT`. A queued-but-never-delivered message cannot get in.
  A client matching on any one id in the list still threads.
- **`In-Reply-To` names something the recipient actually holds**: their own last
  inbound message, else the root. Never a shared outbound id.
- **No `@localhost` id is ever emitted or persisted.** When no reply domain is
  configured the id is recognised as unroutable and skipped, rather than being
  written into a header that is quoted forever.

**One caveat, stated plainly:** the root's domain comes from the configured
reply address, so if the sending domain ever changes, threads break at that
boundary. Rare, acceptable, and softened by the accumulating `References`.

Existing `@localhost` values from before this fix are left in the table. They
simply stop being used as anchors; there is no cleanup script, because the data
no longer matters.

## A public reply is one email

`To:` the requester, `CC:` everyone else who should see it - followers, the
assignee, looped-in colleagues. Not one email each. This is how a person sends
mail, and it removes the per-recipient `Message-ID` divergence at the root.

Three things follow:

- **CC is public.** Every recipient sees every other address. Recipients are
  internal-only (`EMAIL_ALLOWED_DOMAINS`), which is what makes that acceptable -
  but it is worth knowing before anyone widens that list.
- **Suppressed and out-of-domain addresses are dropped before the message is
  composed**, not at the transport, and the refusal is recorded on the ticket as
  an `EMAIL_RECIPIENT_REFUSED` event. One bad colleague address must not stop
  the requester hearing back. A consequence: if the *whole* recipient list is
  out of domain, no email is queued at all - previously a row was queued and
  then refused at send.
- **Bounce attribution is fuzzier.** A bounce for a message with four
  recipients no longer names one person. The suppression row still records the
  address the server rejected when it names one; where it does not, we know the
  message bounced but not for whom.

## An internal note sends no email

Staff read it in the ticket, and it raises an in-app notification with a
realtime push and a poll fallback. Email added nothing and cost the thread
pointer.

The trade-off, accepted: an agent who is not logged in learns of an internal
note when they next open the app. That is right for a colleague-to-colleague
note on a ticket someone is already working, and it is consistent with mentions,
which have never queued email either.

Card 1.22's refusal to address an internal note to the requester **stays in
place**, tests and all. Nothing composes one as an email any more, so the guard
is now structural rather than defensive - but it is what would catch a future
card wiring this back up.

---

## Who the email comes from

A reply from an agent goes out as:

    "Sarah Chen (CSNHC Helpdesk)" <helpdesk@csnhc.com>

A name gets replies; a faceless desk address gets ignored. The display name is
built in code (`from-identity.util.ts`) and only the address is configuration,
so a typo in an env var cannot brand the mail wrong. A name containing a comma
or a quote is RFC-quoted, because `Chen, Sarah` unquoted reads as two
recipients.

**Two things get the generic `CSNHC Helpdesk` identity instead**, and both work
the same way — by simply not putting a name on the queued row, which makes
`buildFromIdentity` fall back on its own:

1. **Teams listed in `EMAIL_GENERIC_IDENTITY_TEAMS`** (slugs, default
   `hr,payroll`). The owner named HR and Payroll because of termination work,
   where the person handling it should not be the visible sender. It is
   configuration because that policy will change, and changing it should not
   need a deploy.
2. **Everything not written by a person.** Ticket created, assigned,
   transferred, status changed, inbound acknowledged — five of the six places
   email is queued are worker- or system-raised. Only a reply has an author, so
   only a reply carries a name.

An **internal** note does carry the writer's name: card 1.22 already refuses to
address one to the requester, and staff may as well see who wrote it.

`agentDisplayName` becomes visible to requesters. That is the owner's decision,
and `EMAIL_GENERIC_IDENTITY_TEAMS` is the escape hatch.

| Name | Default | Notes |
|---|---|---|
| `EMAIL_GENERIC_IDENTITY_TEAMS` | `hr,payroll` | Team slugs, comma-separated. Read at send time. Empty means every team names its agent. |

---

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
- ~~The From line is the generic desk identity on every message.~~ **Closed by
  card 1.31** — see "Who the email comes from" above.
- **Refusals are still not recorded on the ticket.** `EmailService` applies the
  recipient guard immediately above the transport, so nothing reaches `sendMail`
  unguarded and a refusal is counted in the log. Showing an agent that their
  message did not reach someone needs the queueing path to carry the refusal
  back, which is still owed.
