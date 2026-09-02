# Deploy Handoff — email pipeline batch (1.31, 1.32, 1.33, 1.34, **1.35**)

**Date:** 2026-09-02
**For:** the deploy-agent session
**Repo:** `Ticketing System Quality Review`, branch `ui-redesign-and-api-hardening`
**Ship:** branch **HEAD**. Last shippable commit is **`9638a64`** (card 1.35);
anything after it is documentation.

> **Updated 2026-09-02 15:30.** This handoff first said `4f38dfe` and covered four
> cards. **Card 1.35 has since been committed (`9638a64`) and verified GREEN**, so it
> ships too. If you built a zip before 14:31 it does **not** contain 1.35 — rebuild
> from a checkout of `9638a64`. Changed below: the title, §2's table, §3's unit count,
> §5 check 5 and §6's first bullet.
**Production is currently on:** `61a6853` (deployed 2026-09-02 14:06 UTC, deployment `590e9d03`)

**Planner verdict: GREEN on all four cards**, each verified by re-running the
full suite independently.

---

## 1. The one-line summary

**A plain deploy. No migration, no dependency change, no Azure configuration
change.** Schema stays at **52**.

21 commits, **five of which touch code** — and the web side is two files that
came along with card 1.32's outbox counts. Everything else is API.

**Email is already switched on in production.** This deploy changes *what* gets
sent and *how it threads*, not whether. `EMAIL_TEST_RECIPIENTS` is set to the
owner, so every message still goes only to the owner's inbox — **leave it that
way through this deploy.**

## 2. What is shipping

| Card | Change |
|---|---|
| **1.32** | The outbox retry ladder actually runs. Before this, an email was processed **once** at queue time; a transient failure lost it silently. Adds a sweeper (a fourth job on `Admin → Operations`) and pending/failed counts on `/api/health/ready` and the Operations page. |
| **1.31** | The From line names the agent — `Vi Le (CSNHC Helpdesk) <helpdesk@csnhc.com>` — except for teams listed in `EMAIL_GENERIC_IDENTITY_TEAMS` (default `hr,payroll`), which keep the generic identity. |
| **1.33** | **One ticket, one email conversation.** A public reply is now **one** email — `To:` requester, `Cc:` everyone else — and every message on a ticket carries a stable root so it threads for all of them. **An internal note now sends no email at all.** |
| **1.34** | The reply email rewritten: a quoted block with the writer's name, one line — "Reply to this email" — and a `view online` link. Plus a hidden preheader so the inbox preview carries the question. The status enum, the heading, the filler line, the details block and the sign-off are gone. |
| **1.35** | **The reply-above marker moved inside the document**, after the hidden preheader. It used to be prepended to the whole document, producing `<p>marker</p><!DOCTYPE html>` — an invalid page that drops clients into quirks mode, with the marker eating ~33 of the ~90 preview characters. The **inbox preview now opens with the agent's question.** |
| — | The label's timestamp removed (`4f38dfe`): it read `17:07 UTC` on an email received at noon in Texas, and every client already shows the arrival time in the reader's own zone. |

### No new routes, no new settings required

Nothing to add. Two settings exist and both have working defaults — **do not set
either in this deploy**: `EMAIL_GENERIC_IDENTITY_TEAMS` (defaults to
`hr,payroll`, which is what the owner chose) and `EMAIL_OUTBOX_SWEEP_ENABLED` /
`_INTERVAL_MS` (default on, 60 s).

## 3. Verification the planner already did

| Check | Result |
|---|---|
| `apps/api` `tsc --noEmit` | exit 0 |
| `apps/api` unit | **416 passed, 43 suites** (405 before 1.35) |
| Full integration | **457 passed + 1 skipped, 52 of 53 suites** |
| `apps/web` `tsc --noEmit` | exit 0 |
| `apps/web` vitest | **70 passed, 18 files** |
| Migrations added | **none** |
| Lockfile / dependency change | **none** |

Also verified by reading, not just by test count: the composed threading headers
on real rows (stable ticket root in `References`, `lastOutboundMessageId` null so
nothing records on intent, no `@localhost`, `References` growing once a real
inbound exists); and the composed email bodies against the design.

**Production outbox measured before this deploy:** 22 SENT, 45 FAILED, **0
PENDING, 0 abandoned PROCESSING**. So **1.32's sweeper is a no-op on its first
tick** — it needs no supervision.

## 4. Deploy

Follow `docs/DEPLOYMENT.md`. Read **Gotcha 0** before you start — writing to
Azure needs a Conditional Access token and the failure does not say so.

1. **Kill stray node processes** before building, or the Prisma query engine
   stays held and the build dies with `EPERM`. Use the **repo-scoped** filter in
   `repo-landmines.md` — a broad `node.exe` filter took down an unrelated dev
   server on 2026-09-02.
2. **Build** with `create-deploy-zip.ps1`.
3. **Push** with:

   ```bash
   az webapp deploy -g csnhc-ai -n TicketTicket --type zip --async true --src-path <zip>
   ```

   **Do NOT run `deploy-to-azure.ps1`** — `docs/DEPLOYMENT.md:38` forbids it; the
   package is ~169 MB and its Kudu zipdeploy 502s, and a 502 tells you nothing.
   **Never push to the `azure` git remote.**

**No migration step.** Nothing to apply; schema is already 52.

## 5. Post-deploy checks

1. **Commit landed.** Deployed asset hash matches the package you built.
2. **Schema untouched.** `prisma migrate status` → **52**, and the **six trigram
   GIN indexes still present**.
3. **`/api/health/ready`** from a signed-in tab. Expect `smtp: "configured"`
   (unchanged), and **new**: an `outbox` block with counts. Pending and
   processing should be at or near zero.
4. **`Admin → Operations`** as the owner: a **fourth** job row, "email outbox".
   Click **Run now** — expect it to report reclaiming and retrying nothing, since
   the queue is empty. That is success, not a failure.
5. **The real test — send yourself one.** On a real ticket, post a **public
   reply**. Then check the email that arrives in the owner's inbox:
   - **One** email, not one per recipient.
   - From reads `<Agent Name> (CSNHC Helpdesk)` — unless the ticket is HR or
     Payroll, which keep the generic identity by design.
   - The body is a quoted block with the writer's **name and no timestamp**, then
     "Reply to this email", then `view online`. **No** status, heading, details
     block or sign-off.
   - The inbox **preview** shows the start of the message **and no longer leads with
     the reply-above marker** — card 1.35 is in this deploy. If the preview still
     opens with `----- Reply above this line -----`, 1.35 did not ship: you built the
     zip from a pre-14:31 checkout. Rebuild from `9638a64`.
6. **Post a second public reply on the same ticket.** It must arrive **in the
   same conversation** as the first. This is the whole of card 1.33 and the one
   check worth doing carefully.
7. **Post an internal note.** **No email at all**, to anybody. If one arrives,
   **stop and report** — that is the highest-consequence failure in this
   subsystem.
   - ⚠️ **Worth doing on a ticket whose requester is staff** (e.g. raised by
     `phulgur@` or `gweitzer@`). The earlier check used an EMPLOYEE requester,
     whom the pre-existing filter already excluded, so it passed on code that
     predates the fix. A staff requester is the case card 1.22 actually closed.
8. **Container log** after a few minutes: no repeating SMTP error, no retry loop,
   no error from the new sweeper.

**Leave `EMAIL_TEST_RECIPIENTS` set.** Clearing it is a separate, deliberate step
and the owner should do it only after reading a real email. (Card 1.35 is no longer a
precondition — it ships here.)

## 6. Known and deliberate — do not "fix" these

- ~~The reply-above marker leads the inbox preview~~ — **fixed by card 1.35, in this
  deploy.** The marker is still present and must stay: `stripQuotedReply` matches on
  it. It now sits *after* the opening `<body>` and *below* the preheader.
- **The agent cannot see who a reply will reach.** 1.33 made it a `Cc` list and
  1.34 removed "Also copied" from the body, so the audience is currently visible
  nowhere. That is **card 1.28**, next after this deploy.
- **A required custom field can still swallow an inbound email** —
  `it-service-desk` requires `Asset Tag`. Latent; the owner has been asked to set
  it not-required in the admin UI. Not part of this deploy.
- **`e2e/` is untracked on purpose.** Leave it out of the package.
- Two operator scripts (`paf-fields.mjs`, `make-payroll-lead.mjs`,
  `outbox-counts.mjs`) are committed under `apps/api/`. Records of production
  changes; the app never executes them.

## 7. What to report back

1. Deployment id, timestamp, the SHA shipped.
2. Migration count and the trigram index check.
3. Each of the eight §5 checks, pass or fail. **Say explicitly** what check 6
   (same conversation) and check 7 (internal note, staff requester) did.
4. The **From line, subject and body** of the real email from check 5, verbatim —
   and, if you can see it, what the inbox preview read.
5. **Do not include** any credential, any recipient address beyond the owner's
   own, or a customer message body. Both GitHub remotes are public.
6. Anything that did not match. Handoffs of mine have carried a wrong command, a
   stale premise and a self-contradiction; say so plainly if this one is wrong
   too.
