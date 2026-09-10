# Card 1.24 — the go-live checklist

> ⚠️ **Address corrected 2026-09-10 by the planner: the mailbox is
> `glovebox@csnhc.com`, not `helpdesk@`.** Read live from the App Service, where
> `INBOUND_MAILBOX_ADDRESS`, `SMTP_FROM` and `SMTP_REPLY_TO` are all `glovebox@` —
> so the address people are told to reply to **is** the one the worker polls, which is
> the thing that had to be true. Every command below now names the real mailbox; running
> them against `helpdesk@` would have tested a mailbox that does not exist and reported
> a pass.


**Run this the minute the Graph permission lands.** Everything is already
built, tested and off. Nothing below needs the handoff open beside it.

**Order matters. Steps 1 and 2 are cheap and can invalidate the design.**

---

## Before you start: what to ask for, if it has not been granted yet

Three things, in **one** request — retrofitting any of them is harder than
asking now.

1. **`Mail.ReadWrite`, SCOPED to the single shared mailbox** via an
   **Application Access Policy**. Unscoped, the app registration can read
   **every mailbox in the tenant**. This is the security decision on this card.
   The policy command IT runs looks like:
   ```powershell
   New-ApplicationAccessPolicy -AppId <AZURE_CLIENT_ID> `
     -PolicyScopeGroupId glovebox@csnhc.com `
     -AccessRight RestrictAccess `
     -Description "Ticketing inbound worker - glovebox mailbox only"
   Test-ApplicationAccessPolicy -Identity glovebox@csnhc.com -AppId <AZURE_CLIENT_ID>
   ```
2. **The shared mailbox must exist and accept plus-addressing**
   (`glovebox+ticket-abc@…` must deliver to `glovebox@…`). That is card 1.25
   and an M365 task, not a code one. `Mail.ReadWrite` is useless without it.
3. **A directory-read scope** (`User.Read.All`), in the same request. Different
   permission from `Mail.ReadWrite`. It closes card 1.30 §5.1: somebody who has
   never signed in has no directory identity, so intake can still meet an
   unseen address. Ask once rather than twice.

---

## Settings

| Variable | Value for go-live | Notes |
|---|---|---|
| `INBOUND_MAILBOX_ENABLED` | `true` | **The switch. Off by default.** |
| `INBOUND_MAILBOX_ADDRESS` | `glovebox@csnhc.com` | Defaults to `SMTP_REPLY_TO` / `SMTP_FROM` if unset. |
| `INBOUND_MAILBOX_POLL_INTERVAL_MS` | leave unset | Default **30000** (30 s). |
| `INBOUND_MAILBOX_BATCH_SIZE` | leave unset | Default 50 messages per poll. |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | already set | Reused; no new secret. |

Set them without a restart loop:

```bash
az webapp config appsettings set --name TicketTicket --resource-group csnhc-ai \
  --settings INBOUND_MAILBOX_ENABLED=true INBOUND_MAILBOX_ADDRESS=glovebox@csnhc.com
```

⚠️ **Deploy migration 60 first** (`20260910120000_inbound_mailbox_cursor`).
The worker cannot persist its cursor without it.

---

## 1. Confirm the permission is SCOPED

```powershell
Test-ApplicationAccessPolicy -Identity glovebox@csnhc.com -AppId <AZURE_CLIENT_ID>   # expect: AccessCheckResult = Granted
Test-ApplicationAccessPolicy -Identity <any-other-mailbox>@csnhc.com -AppId <AZURE_CLIENT_ID>  # expect: Denied
```

- [ ] The second command says **Denied**.

⚠️ **If the second says Granted, the permission is UNSCOPED. Stop and tell the
owner before pointing the worker at anything.**

## 2. Confirm the mailbox accepts plus-addressing

- [ ] From an **external** account, send to `glovebox+test@csnhc.com`.
- [ ] It arrives in `glovebox@csnhc.com`.

⚠️ **If the tenant strips or rejects it, stop.** The fallback order is a
catch-all subdomain (`anything@tickets.csnhc.com`), then one mailbox per
department — **that changes the design, not a constant.**

## 3. Run the worker once

- [ ] Open **`/admin/operations`** (note: `/admin/operations`, *not*
      `/operations`) as an owner.
- [ ] The **Inbound mailbox worker** row shows **On** and names the mailbox.
- [ ] Click **Run now**.
- [ ] The result shows `ingested` > 0 and `movedToProcessed` equal to it.
- [ ] Each consumed message is now in the mailbox's **Processed** folder.

If it shows an error instead, that is deliberate — the worker fails loudly
rather than no-opping. The message names the cause; a `403` here is what a
missing or wrongly-scoped Application Access Policy looks like.

## 4. A real reply lands on the right ticket

- [ ] Reply from a real mailbox to a ticket notification.
- [ ] Within a minute it appears on that ticket, **under the sender's own name**.

## 5. Nothing is lost across a restart

- [ ] Stop the API. Send mail. Wait two minutes. Start it again.
- [ ] The next poll ingests everything that arrived while it was down.

**This is the reason the card chose polling over a webhook** — prove it.

## 6. Ingest the same message twice

- [ ] Move a message back out of Processed into the Inbox.
- [ ] Run now.
- [ ] **One** ticket message, not two.

---

## Then the six items other cards parked here

## 7. Card 1.29's two checks — **the most important in the list**

- [ ] A **genuine reply** clears *Waiting on requester*, the ticket leaves
      "Awaiting reply", and a **REPLIED** marker appears and survives a reload.
- [ ] ⚠️ **An out-of-office auto-reply does NOT move the status.**

⚠️ **This second one matters more than anything else here.** That failure
*looks like progress*: the ticket quietly leaves the chase list and nobody
looks at it again. Card 1.29 shipped on 2026-09-03 and has never been
exercised against real mail.

To test it, send a reply with an out-of-office header set:
```
Auto-Submitted: auto-replied
```
The ticket's status must be **unchanged** afterwards.

## 8. Card 1.40 — a looped-in colleague

- [ ] A colleague we CC'd replies: it **lands on the ticket** under their name.
- [ ] A **stranger's** reply is recorded as an attempt with the **body
      discarded** — visible on the timeline, not stored as a message.

## 9. Card 1.43 — threading, not a new ticket

- [ ] A real requester's reply **threads onto the existing ticket** rather than
      opening a new one. Shipped 2026-09-09; this is the moment it stops being
      dormant.
- [ ] Edit the subject line before replying. It **still** lands correctly —
      that is the reply token doing its job rather than the subject matcher.

## 10. An unrouted inbound ticket — **owner decision**

- [ ] Send to bare `glovebox@csnhc.com` with no matching routing rule.
- [ ] It gets **no team**, so **no email and no bell** — discoverable only from
      the Unassigned queue.

⚠️ **Decide now: a fallback department, or rely on card 1.16's digest.**
The planner's view and mine agree: **a fallback**. It is small, and it means
nothing can arrive with no owner. Department addressing
(`glovebox+payroll@`) covers the normal case, so this is only about bare
`glovebox@`.

## 11. Email redirection

- [ ] `EMAIL_TEST_RECIPIENTS` still redirects everything to the owner's inbox.
      **Clear it only after 4–9 pass.**
- [ ] `EMAIL_ALLOWED_DOMAINS` still covers the domain real requesters are on
      (production: `csnhc.com`).

## 12. `Asset Tag` — nothing to do

✅ **Already closed** (owner, 2026-09-04): production has **zero** required
custom fields. Listed only so nobody re-checks it. The code half
(`skipRequiredCustomFields` on the inbound path) shipped with this card as
defence in depth against the next required field anybody adds.

---

## If something goes wrong

- **The worker reports an error on the console.** That is by design; read it.
  There is no "pretend it worked" mode.
- **Mail is ingested but stays in the Inbox.** Harmless. The message stored
  successfully and only the move failed; the next poll re-offers it and the
  existing receipt makes it a replay rather than a duplicate.
- **Mail is in Processed but no ticket exists.** This should be impossible —
  the worker stores before it moves. If you see it, say so loudly: it means the
  order was reversed somewhere.
- **Turn it off instantly:** set `INBOUND_MAILBOX_ENABLED=false`. The timer
  stops on the next restart, and `Run now` refuses immediately.
