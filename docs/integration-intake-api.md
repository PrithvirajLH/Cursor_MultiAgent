# Integration intake API — `POST /api/tickets/intake`

How an outside system (Power Automate, a Form handler, a script) creates a
ticket **in a named department** on behalf of a named person. Added by card 1.19.

Everything you need to build the flow is on this page; you should not have to
read any code.

---

## 1. The endpoint

```
POST https://<your-app>.azurewebsites.net/api/tickets/intake
```

Locally: `POST http://localhost:3077/api/tickets/intake` (whatever `PORT` the dev
API runs on).

### Required headers

| Header | Value | Why |
|---|---|---|
| `Content-Type` | `application/json` | Body is JSON. |
| `x-intake-secret` | the shared secret | The only gate on this endpoint. Ask the owner; it lives in Key Vault (`TicketTicket-intake-secret`). Never put it in a document, a chat message or a flow's plain-text note — use a secure input or an environment variable. |
| `Idempotency-Key` | a value that is stable per logical submission | **Required.** Send the flow run id. If the flow retries with the same key, the first ticket is returned again instead of a duplicate being created. Max 128 characters. |

There is no user login on this path — the secret is the whole authentication
story, so treat it as a password.

---

## 2. Body

```jsonc
{
  "requesterEmail": "jane.doe@csnhc.com",   // required
  "requesterName": "Jane Doe",              // optional
  "subject": "Printer jam on 2nd floor",     // required
  "description": "The big printer ...",      // required
  "department": "it-service-desk",           // optional — see §3
  "category": "hardware-devices",            // optional — see §3
  "priority": "SEV3",                        // optional, default SEV3
  "tags": ["power-automate"],                // optional
  "sourceRef": "form-response-4821"          // optional
}
```

| Field | Required | Type / limits | Notes |
|---|---|---|---|
| `requesterEmail` | yes | valid email address | The person the ticket is **for**. If the address is unknown, a new user is created automatically (role `EMPLOYEE`), exactly as the inbound-email path does. The address is lower-cased. |
| `requesterName` | no | text, ≤ 160 chars | Only used when that new user is created. Ignored for an existing account. |
| `subject` | yes | text, 1–200 chars | Shown in every queue and list. |
| `description` | yes | text, 1–5000 chars | The ticket body. |
| `department` | no | slug, ≤ 60 chars, `a-z0-9-` | Sends the ticket straight to that department and **skips the routing rules**. Omit it to let the routing rules and AI decide, exactly as the web portal does. Unknown or inactive slug ⇒ 400 that lists the valid ones. |
| `category` | no | slug, ≤ 60 chars, `a-z0-9-` | Same validation as `department`. |
| `priority` | no | `SEV1` \| `SEV2` \| `SEV3` \| `SEV4` | Defaults to `SEV3`. Anything else ⇒ 400. |
| `tags` | no | up to 10 names, each ≤ 40 chars | Tag names are normalised (trimmed, lower-cased). |
| `sourceRef` | no | text, ≤ 120 chars | Your own reference — a Form response id, a flow run id. Stored on the ticket's timeline entry, not on the ticket itself, so you can trace a ticket back to the submission. |

Attachments are **not supported yet** — see §7.

---

## 3. Department and category slugs

`department` and `category` are **slugs**, not ids, so a flow never has to carry
internal GUIDs. They come from `Team.slug` and `Category.slug` in the database.

The list is environment-specific and can change when an owner adds a department,
so treat one of these as authoritative rather than hard-coding a list from a doc:

- Send a deliberately wrong slug once (`"department": "nope"`). The 400 response
  lists every valid, active slug — see §5.
- Or ask an owner to read them from **Admin → Teams**.

**Do not copy a slug list out of a document — environments genuinely differ.**
The dev seed defines five departments (`it-service-desk`, `hr`, `ai`,
`medicaid-pending`, `white-gloves`), but the live dev database on 2026-08-28 has
only **two**: `it-service-desk` and `hr-operations` — note that HR's slug there
is *not* `hr`. Categories in the same database: `access-identity`,
`hardware-devices`. Verify against the environment you are pointing at before
you ship a flow.

Only **active** departments and categories are accepted; a deactivated one is
treated as unknown.

---

## 4. Success response — 201

```json
{
  "id": "0f5e6d1b-1f9a-4a3c-9a51-1f6ea0a53b0e",
  "number": 412,
  "displayId": "IS_20260828_412",
  "status": "NEW",
  "priority": "SEV3",
  "channel": "API",
  "assignedTeam": { "id": "1111...", "name": "IT Service Desk", "slug": "it-service-desk" },
  "category": { "id": "c111...", "name": "Hardware & Devices", "slug": "hardware-devices" },
  "requester": { "id": "aaaa...", "email": "jane.doe@csnhc.com", "displayName": "Jane Doe" }
}
```

`displayId` is the human reference (`IS_20260828_412`) — that is what a flow
should show the submitter or write back into a Form response. `assignedTeam` and
`category` are `null` when nothing was resolved. `channel` is always `API`, which
is how these tickets are told apart from portal and email tickets in reporting
(Reports → Channel → **Integration**).

A **replayed** response (same `Idempotency-Key`, see §1) is byte-identical and
carries the header `Idempotency-Replayed: true`.

---

## 5. Errors

| Status | When | What the flow should do |
|---|---|---|
| **400** | A field is missing, too long, or the wrong type. Body: `{"message": ["subject should not be empty"], "error":"Bad Request", "statusCode":400}` | Fix the flow. Do not retry unchanged. |
| **400** | `Idempotency-Key header is required (use the flow run id)` | Add the header. |
| **400** | `Unknown department "nope". Valid: hr-operations, it-service-desk` (the list is whatever that environment has active; same shape for `Unknown category`) | Use one of the listed slugs. |
| **403** | `Missing intake API secret` / `Invalid intake API secret` / `Intake API secret is not configured` | The header is absent, wrong, or the app has no secret set. Do not retry until it is fixed; check with the owner. |
| **429** | More than **30 requests per 60 seconds from one IP** (`RATE_LIMIT_WEBHOOK_LIMIT`). | Back off and retry later. If a flow legitimately bulk-loads, ask the owner to raise the limit rather than hammering it. |
| **401** | Only if the path was not added to the Easy Auth exclusion list. The Microsoft login wall answered, not the app. | Ask the owner to add `/api/tickets/intake` to the app's excluded paths. |
| **500** | Unexpected. | Retry **with the same `Idempotency-Key`** — that is exactly what it is for. |

---

## 6. Copy-pasteable examples

### curl

```bash
curl -i -X POST https://<your-app>.azurewebsites.net/api/tickets/intake \
  -H "Content-Type: application/json" \
  -H "x-intake-secret: $INTAKE_SECRET" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "requesterEmail": "jane.doe@csnhc.com",
    "requesterName": "Jane Doe",
    "subject": "Printer jam on 2nd floor",
    "description": "The big printer by the kitchen is jammed and shows error 51.",
    "department": "it-service-desk",
    "priority": "SEV3",
    "tags": ["power-automate"],
    "sourceRef": "form-response-4821"
  }'
```

### Power Automate — HTTP action

| Field | Value |
|---|---|
| **Method** | `POST` |
| **URI** | `https://<your-app>.azurewebsites.net/api/tickets/intake` |
| **Headers** | `Content-Type`: `application/json`<br>`x-intake-secret`: *(secure input / environment variable — never a literal in the flow definition)*<br>`Idempotency-Key`: `@{workflow()['run']['name']}` |
| **Body** | see below |

```json
{
  "requesterEmail": "@{triggerOutputs()?['body/responder']}",
  "requesterName": "@{triggerOutputs()?['body/responderName']}",
  "subject": "@{triggerOutputs()?['body/r1']}",
  "description": "@{triggerOutputs()?['body/r2']}",
  "department": "it-service-desk",
  "priority": "SEV3",
  "sourceRef": "@{triggerOutputs()?['body/responseId']}"
}
```

`@{workflow()['run']['name']}` is the run id: it stays the same across Power
Automate's own retries of that run, which is exactly the behaviour the
`Idempotency-Key` needs. Use the run id, **not** `guid()` — a fresh guid on every
attempt would create duplicate tickets.

Read `displayId` out of the response with
`@{body('HTTP')?['displayId']}` to tell the submitter their ticket number.

---

## 7. Two things this endpoint does **not** do

1. **It sends no acknowledgement email.** Production has no SMTP configured, so
   nothing is emailed to the requester when a ticket arrives this way. They do
   get the normal in-app notification. **If the submitter should receive a
   confirmation, the flow must send it** (a "Send an email (V2)" action after the
   HTTP action, quoting `displayId`).
2. **It accepts no attachments.** Files on a Form response cannot be passed
   through yet; mention them in the description or attach them in the ticket
   afterwards. A later card may add this.

---

## 8. Security notes

- The shared secret is the **only** gate. Anyone holding it can create a ticket
  for **any** email address in **any** department — requester spoofing is
  possible by design. That is the same trust level as the existing inbound-email
  webhook, and it is acceptable only because the secret stays inside the tenant.
  Never expose it to a third party or a client-side app.
- Rotate the secret if a flow is decommissioned or the value may have leaked
  (owner: `INTAKE_API_SECRET` app setting + Key Vault, then update the flow).
- A typo'd `requesterEmail` creates a stray `EMPLOYEE` user. Harmless, but worth
  validating the address in the flow before calling.
- The endpoint is rate-limited per IP; a `429` is the correct answer to a runaway
  flow, not something to work around.

---

## 9. Owner setup checklist (once per environment)

1. Set `INTAKE_API_SECRET` on the App Service (and store the value in Key Vault).
2. Add `/api/tickets/intake` to Easy Auth's **excluded paths** — otherwise the
   login wall answers `401` before the app ever sees the request. The exclusion
   is path-exact and exposes nothing else.
3. Verify anonymously: `POST` to the path with no secret should return **403**
   (the app answering), not 401 (the front door). `/` must still redirect to the
   Microsoft login.
4. Hand the secret to the flow builder out of band — a Key Vault link, not chat.
