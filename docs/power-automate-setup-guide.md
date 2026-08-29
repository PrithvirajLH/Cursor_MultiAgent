# Creating tickets from Power Automate — setup guide

**For:** whoever builds the flow. No coding needed.
**Time:** about 20 minutes.
**Companion:** [`integration-intake-api.md`](integration-intake-api.md) is the technical reference — every field, every error. This page is the click-by-click walkthrough.

---

## What you are building

Someone fills in a Microsoft Form (or an email arrives, or a Teams message is posted) → Power Automate sends it to the ticketing system → a ticket appears in the right department's queue → the person is told their ticket number.

The example below uses **Microsoft Forms** and the **Payroll** department. Any trigger works the same way; only step 2 changes.

---

## Before you start

You need three things.

| What | Where to get it |
|---|---|
| **The secret** | Ask the system owner (Prithviraj). It is a long random string. Treat it like a password — anyone holding it can create tickets. |
| **The department name** | One of: `ai`, `hr`, `it-service-desk`, `medicaid-pending`, `payroll`, `white-gloves`. Use the exact spelling — `it-service-desk`, not `IT`. |
| **A form (or other trigger)** | Whatever starts the flow. For this example, a Microsoft Form asking for the person's name, email, a short subject and a description. |

> **One warning before you begin.** The ticketing system does **not** send email. Nobody gets a "we received your request" message unless your flow sends it. Step 4 covers this — do not skip it.

---

## Step 1 — Create the flow

1. Go to **make.powerautomate.com** and sign in.
2. **Create** → **Automated cloud flow**.
3. Name it something obvious: `Payroll requests → Ticketing`.
4. Choose the trigger **"When a new response is submitted"** (Microsoft Forms).
5. Select your form. Click **Create**.

---

## Step 2 — Get the form answers

Forms gives you only a response ID at first, so you need one more step to read the answers.

1. **+ New step** → search **Forms** → choose **"Get response details"**.
2. **Form Id:** pick the same form.
3. **Response Id:** click the box, then pick **Response Id** from the dynamic content panel.

You can now use each question's answer in later steps.

---

## Step 3 — Send it to the ticketing system

This is the important step.

1. **+ New step** → search **HTTP** → choose the plain **HTTP** action (the one with a globe icon, not "HTTP with Azure AD").
2. Fill it in exactly as below.

### Method
```
POST
```

### URI
```
https://ticketticket-gmgwf9efe4h6bmfb.southcentralus-01.azurewebsites.net/api/tickets/intake
```

### Headers

Click **Add new parameter → Headers**, then add three rows:

| Key | Value |
|---|---|
| `Content-Type` | `application/json` |
| `x-intake-secret` | *paste the secret here* |
| `Idempotency-Key` | `@{workflow()['run']['name']}` |

**About `Idempotency-Key`:** it is a unique ID for this run. `@{workflow()['run']['name']}` is Power Automate's way of saying "this run's ID". If the call times out and Power Automate retries, the retry sends the same ID, and the system returns the **same ticket** instead of creating a second one.

- Paste the expression exactly, including `@{` and `}`.
- If the box rejects it, click the **Expression** tab and enter it without the outer braces: `workflow()['run']['name']`
- Never type a fixed word here. Every run would reuse it and you would keep getting the first ticket back.
- Never leave it out. The request fails.

### Body

Click in the Body box and paste this, then replace each `@{...}` by clicking the box and picking the matching answer from the dynamic content panel:

```json
{
  "requesterEmail": "@{outputs('Get_response_details')?['body/responder']}",
  "requesterName": "@{outputs('Get_response_details')?['body/r1']}",
  "subject": "@{outputs('Get_response_details')?['body/r2']}",
  "description": "@{outputs('Get_response_details')?['body/r3']}",
  "department": "payroll",
  "priority": "SEV3",
  "sourceRef": "@{workflow()['run']['name']}"
}
```

> The `r1`, `r2`, `r3` names are placeholders — Microsoft Forms uses its own IDs. Do not type them by hand; click into the value and choose the question from the dynamic content list.

### What each field does

| Field | Needed? | Notes |
|---|---|---|
| `requesterEmail` | **yes** | Who the ticket is for. If the address is unknown, that person is created automatically. `responder` is the signed-in person's email. |
| `subject` | **yes** | The ticket title. Up to 200 characters. |
| `description` | **yes** | The details. Up to 5,000 characters. |
| `department` | recommended | `payroll` here. Leave it out and the system's routing rules guess the team. |
| `requesterName` | optional | Only used the first time that email is seen. |
| `priority` | optional | `SEV1` (critical) to `SEV4` (low). Defaults to `SEV3`. |
| `tags` | optional | Up to 10 labels, e.g. `["from-form"]`. |
| `sourceRef` | optional | Your own reference. Shows in the ticket history — handy when tracing a problem back to a flow run. |

### Retry policy

Click the **…** on the HTTP action → **Settings** → leave **Retry Policy** on **Default**. Retries are safe because of the `Idempotency-Key`.

---

## Step 4 — Tell the person their ticket number

**Do not skip this.** The ticketing system sends no email.

1. **+ New step** → **Office 365 Outlook** → **Send an email (V2)**.
2. **To:** the responder's email (dynamic content, same as `requesterEmail` above).
3. **Subject:**
   ```
   We received your request — @{body('HTTP')?['displayId']}
   ```
4. **Body:**
   ```
   Thanks — your request has been logged as @{body('HTTP')?['displayId']}.
   The Payroll team will be in touch.
   ```

`body('HTTP')?['displayId']` is the ticket number the system just sent back, e.g. `PA_20260829_023`. If your HTTP action is named something other than "HTTP", use that name instead.

---

## Step 5 — Test it

1. **Save**, then **Test** → **Manually** → submit a real response to your form.
2. Open the run history. The HTTP step should show **201**.
3. Open the ticketing system and check the Payroll queue — your ticket should be there, marked as channel **Integration**.
4. Check that the confirmation email arrived.

---

## When something goes wrong

The HTTP step's output tells you exactly what. Open the failed run, click the HTTP action, read the **Body** of the response.

| Code | What it means | What to do |
|---|---|---|
| **201** | Success — the ticket was created. | Nothing. |
| **400** | Something in the body is wrong. The message says what, e.g. `subject must be shorter than or equal to 200 characters`. | Fix that field. |
| **400** `Idempotency-Key header is required` | The header is missing or empty. | Add it — see step 3. |
| **400** `Unknown department "payrol"` | Misspelled department. The message lists the valid ones. | Fix the spelling. |
| **400** `Department "it-service-desk" requires: Asset Tag` | That department needs an extra field. | See "IT tickets" below. |
| **403** | The secret is missing or wrong. | Check the `x-intake-secret` header. Ask the owner for the current value. |
| **429** | More than 30 requests in a minute. | Slow the flow down, or ask the owner to raise the limit. |
| **401** | The request never reached the app. | Tell the owner — the endpoint's exemption may have been changed. |

---

## IT tickets need one extra field

IT requires an asset tag. Add `customFields` to the body:

```json
{
  "requesterEmail": "...",
  "subject": "...",
  "description": "...",
  "department": "it-service-desk",
  "customFields": {
    "Asset Tag": "@{outputs('Get_response_details')?['body/r4']}"
  }
}
```

Get the name wrong and the error tells you the valid ones. The other five departments need nothing extra today — but if that ever changes, the same error will tell you.

---

## Departments

| Use this exactly | Team |
|---|---|
| `ai` | AI |
| `hr` | HR |
| `it-service-desk` | IT |
| `medicaid-pending` | Medicaid Pending |
| `payroll` | Payroll |
| `white-gloves` | White Gloves |

`hr-operations` exists but is **switched off** — do not use it.

---

## Rules of thumb

- **One flow per department** is simplest. If a single form serves several teams, add a **Condition** (or **Switch**) before the HTTP step and set `department` from the answer.
- **Never put the secret in the flow's name, a comment, or an email.** If it leaks, ask the owner to rotate it — the flow then needs the new value.
- **The system does not send email.** Every "we got it", "it's resolved" message your users expect must come from your flow, or from someone in the app.
- Attachments are **not** supported yet. If your form collects files, the ticket will not have them — mention the file location in the description for now.
