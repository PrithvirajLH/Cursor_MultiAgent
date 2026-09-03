# Deploy Handoff — the four-card batch (1.36, 1.38, 1.37, 1.28)

**Date:** 2026-09-03
**For:** the deploy-agent session
**Repo:** `Ticketing System Quality Review`, branch `ui-redesign-and-api-hardening`
**Ship:** branch **HEAD** = **`147a972`**. Last code commit is **`c2b8584`**;
everything after it is documentation.

**Planner verdict: GREEN on all four cards**, every check re-run independently
(§3).

---

## 1. The one-line summary

**A plain deploy. No migration, no dependency change, no Azure configuration
change.** Schema stays at **52**.

**This supersedes the email-pipeline deploy handoff**
(`2026-09-02-deploy-email-pipeline-batch.md`). HEAD contains that batch **and**
these four cards, so shipping HEAD ships everything either way. **Report what
production was on before you push** — that tells us whether the 2026-09-02
attempt landed, which nobody has confirmed.

### ⚠️ You must rebuild the zip

`Codex_Ticketing_System_deploy.zip` on disk is **15:48 on 09-02** and predates
all four cards. The previous handoff told you *not* to rebuild because an
implementer was mid-edit; **that no longer applies.** The tree is clean (only the
intentional untracked `e2e/`) and everything is committed, so a rebuild from this
tree is correct and safe.

## 2. What is shipping

Four fixes to one theme: **the app decided what someone could see, send and know
about a message from their rank, never from their relationship to the ticket.**

| Card | Change |
|---|---|
| **1.36** | A staff member can now **see a ticket they raised** into a team they are not on — and **cannot** read the internal notes written about them on it. Rank still governs everything else: a lead still sees internal notes on a colleague's ticket. |
| **1.38** | An agent is no longer offered **"Public"** on a ticket nobody is assigned to, because the server would silently store it as private. They are told to assign it to themselves instead. |
| **1.37** | An agent's **own** internal notes now look internal — an amber ring on the sent bubble, and a marker on **every** message in a run, not just the first. |
| **1.28** | Above the composer, an agent now sees **exactly who a message will reach**, can remove a follower, and is told **before sending** if an address cannot be emailed. Internal notes read "staff only, no email sent". |
| — | The client now believes the **server** about what it stored. If a reply is downgraded to private, the toast says **"Saved as an internal note — the requester was not emailed"** instead of "Reply sent". |

**Context worth having:** production has exactly **one** AGENT account and it is
the **owner's own** (`phulgur@csnhc.com`, active), with **75** unassigned
tickets. So 1.38's change is immediately visible to the owner and to nobody else.
It was live before this fix but **cost nothing** — a read-only check found **zero**
replies that had been silently kept private.

### Nothing to add or change

No new routes requiring settings, no new environment variables, no Azure change.

## 3. Verification the planner already did

| Check | Result |
|---|---|
| `apps/api` `tsc --noEmit` | exit 0 |
| `apps/api` unit | **443 passed, 44 suites** |
| Full integration | **475 passed + 1 skipped, 53 of 54 suites** |
| `apps/web` `tsc --noEmit` | exit 0 |
| `apps/web` vitest | **100 passed, 21 files** |
| Migrations added | **none** (52 total) |
| Lockfile / dependency change | **none** |

Also verified by reading, not just by counts: the recipient preview and the send
path now share one options function so they cannot drift; the follower-removal
rule in the preview matches what the unfollow endpoint actually enforces; and the
"emails nobody" assertion is not vacuous. All three browser screenshots read.

## 4. Deploy

Follow `docs/DEPLOYMENT.md`. Read **Gotcha 0** first — writing to Azure needs a
Conditional Access token and the failure does not say so.

1. **Kill stray node processes** before building. Use the **repo-scoped** filter in
   `repo-landmines.md` — and note the warning added there on 2026-09-02: that
   filter **misses a dev server started with a relative path**, so also check the
   listening ports. A broad `node.exe` filter took down an unrelated dev server.
2. **Build** with `create-deploy-zip.ps1`. **Rebuild is required** — see §1.
3. **Push** with:

   ```bash
   az webapp deploy -g csnhc-ai -n TicketTicket --type zip --async true --src-path <zip>
   ```

   **Do NOT run `deploy-to-azure.ps1`** — `docs/DEPLOYMENT.md:38` forbids it; the
   package is ~170 MB and its Kudu zipdeploy 502s, which tells you nothing.
   **Never push to the `azure` git remote.**

**No migration step.** Schema is already 52.

## 5. Post-deploy checks

The owner's account is the only AGENT, so checks 3-5 must be done **as the
owner**.

1. **Commit landed.** Deployed asset hash matches the package you built. **Record
   what production was on beforehand** (§1).
2. **Schema untouched.** `prisma migrate status` → **52**, and the **six trigram
   GIN indexes still present**.
3. **1.38 — the important one.** Open a ticket with **no assignee**. The composer
   must show **"Internal note only"** and offer **no Public option**, with wording
   telling you to assign it to yourself. Click **Me** in the sidebar, then confirm
   **Public** appears.
4. **1.37.** Post **two internal notes in a row**. Both must carry a visible
   internal marker — not just the first — and both must look different from a
   public reply.
5. **1.28.** With the composer open on a public reply, a line above it names the
   requester and anyone else it reaches. Expand it: the requester cannot be
   removed. Switch to an internal note: it must change to **"staff only, no email
   sent"**.
6. **1.36.** Raise a ticket into a department you are **not** on. Confirm you can
   see it in your list and open it. Then have nothing to do with it — the internal
   half needs a second person, so **hand check 6b to the owner**: someone else
   adds an internal note on it, and the owner must **not** see that note.
7. **Nothing regressed on email.** Post a public reply on an assigned ticket and
   confirm one email still arrives, threaded into the same conversation. Post an
   internal note and confirm **no email at all**. If one arrives, **stop and
   report** — that is the highest-consequence failure in this subsystem.
8. **Container log** after a few minutes: no repeating error, nothing new from the
   sweeper.

**Leave `EMAIL_TEST_RECIPIENTS` alone.** Clearing it is the owner's deliberate
step, not part of this deploy — though note their own precondition for it (after
cards 1.35 **and** 1.28) is met once this ships.

## 6. Known and deliberate — do not "fix" these

- **A staff requester `@mentioned` in an internal note still gets a "You were
  mentioned" notification** for a message they cannot open. Known, recorded as a
  residual on the board. **Not a leak** — the notification carries only the ticket
  subject, never the note body.
- **The follower-management rule is written in two places** and they agree today.
  Recorded; will be unified.
- **A required custom field can still swallow an inbound email** —
  `it-service-desk` requires `Asset Tag`. Latent; the owner has been asked to set
  it not-required in the admin UI.
- **`e2e/` is untracked on purpose.** Leave it out of the package.
- Five operator scripts sit in `apps/api/` (`paf-fields`, `make-payroll-lead`,
  `outbox-counts`, `agent-role-check`, `silent-internal-check`). Records of
  production checks; the app never executes them. The last two are read-only.

## 7. What to report back

1. Deployment id, timestamp, the SHA shipped, **and the SHA production was on
   before**.
2. Migration count and the trigram index check.
3. Each of the eight §5 checks, pass or fail. **Say explicitly** what checks 3
   (no Public on an unassigned ticket) and 7 (internal note sends no email) did.
4. **Do not include** any credential, any recipient address beyond the owner's
   own, or a customer message body. Both GitHub remotes are public.
5. Anything that did not match. Handoffs of mine have carried a wrong command, a
   stale premise, a self-contradiction, an invented file reference and a wrong
   line number; say so plainly if this one is wrong too.
