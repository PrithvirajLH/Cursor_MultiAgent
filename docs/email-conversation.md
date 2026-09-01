# Email safety rails

**Status: sending is OFF.** This document describes guards, not a feature. After
card 1.22 the system still sends no email at all — `SMTP_HOST` is unset in
production (the setting is deliberately named `SMTP_HOST_DEV_DISABLED`), so
`EmailService` refuses every send with `SMTP not configured` and
`GET /api/health/ready` continues to report SMTP as not configured. Card 1.23
turns sending on, and must not be started until this is deployed.

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
| `EMAIL_TEST_RECIPIENTS` | empty | Comma-separated pilot list. Empty means normal addressing. **Leave empty in production.** |

Both are read at send time. Neither can make the system send anything while
`SMTP_HOST` is unset.

---

## Known gaps, deliberately left

- **Bounce suppression has no durable store.** `resolveOutboundRecipients` takes
  the suppressed list as a parameter and there is nowhere yet to keep it. A real
  version needs a table keyed on address with the bounce type (hard vs soft), a
  count, first and last seen, and an operator way to clear one — an additive
  migration that belongs to the card that actually starts sending.
- **The From-line formatter is built but not wired.** `buildFromIdentity`
  produces `"Sarah Chen (CSNHC Helpdesk)" <helpdesk@csnhc.com>`, correctly quoted
  for a display name containing a comma or a quote. Nothing calls it yet, because
  card 1.22 sends nothing; 1.23 wires it where the agent's name is known.
- **The guards are not yet applied at the composing end.** `EmailService` applies
  the recipient guard immediately above the transport, so nothing can reach
  `sendMail` unguarded. Recording refusals *on the ticket* needs the queueing
  path, which is 1.23's work.
