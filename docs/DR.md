# Disaster recovery — database and attachments

**Status as of 2026-08-26.** Written from a live restore drill (section 6), not
from the portal's promises. Re-run the drill and update the numbers after any
tier, retention or storage change (section 7).

Production database: Azure Database for PostgreSQL Flexible Server
`csh-ticketing-db`, resource group `csnhc-ai`, South Central US, PostgreSQL 16,
SKU `Standard_B1ms` (Burstable), 32 GB storage. Production attachments: Azure
Blob container `ticket-attachments`.

---

## 1. What is backed up, by whom, how far back

| Item | Fact (verified with `az` on 2026-08-26) |
|---|---|
| Mechanism | Azure automated backups: one automatic **full** backup per day (~17:0x UTC) plus continuous WAL, giving point-in-time restore (PITR) to any second inside the retention window. Nobody runs a backup job; Azure does. |
| Retention | **7 days** (`backupRetentionDays: 7`). Earliest restore point at time of writing: **2026-08-20T17:01:51Z**. Anything older is gone. |
| Redundancy | **Locally redundant** (`geoRedundantBackup: Disabled`). A South Central US regional outage takes the backups with it. |
| High availability | **None** (`highAvailability: Disabled`). B-series does not support zone-redundant HA at all. |
| Restore target | PITR always creates a **new server** of the same SKU/storage. There is no in-place restore. |
| Attachments (Blob) | Storage account **`aiprojecttracker`** (RG `csnhc-ai`), container `ticket-attachments`. **Blob soft delete: enabled, 7 days. Container soft delete: enabled, 7 days. Versioning: not enabled.** A deleted blob can be undeleted for 7 days; an overwritten blob cannot be recovered (no versions). Blob data is *not* part of the database backup. |

Backups seen on 2026-08-26 (`az postgres flexible-server backup list`):
`2026-08-20` … `2026-08-26`, one `Full`/`Automatic` per day, the latest at
`2026-08-26T17:08:02Z`.

---

## 2. Recovery objectives as measured on 2026-08-26

| Objective | Value | How it was obtained |
|---|---|---|
| **RPO** (data you can lose) | Azure PITR granularity — restore to any point in time within retention; Azure documents WAL shipping at up to ~5 minutes, so plan on **≤ 5 min** of loss. | Azure documentation; not measurable from outside. |
| **RTO — provisioning** (T1 − T0) | **7 min 23 s** (±30 s) from `restore` issued to server `Ready`. | Drill, section 6. Polled every 30 s. |
| **RTO — first query, technical path** | **≈ 8.5 min** — T1 plus ~1 min for a firewall rule to take effect plus the first `prisma migrate status` (3 s). The restored server has **no firewall rules**, so a rule for the operator (and for the App Service, if cutting over) is a mandatory step, not an optional one. | Drill, section 6: rule created 18:18:33Z, port open by 18:19:36Z, query OK 18:19:45Z. |
| **RTO — first query, wall clock** (T2 − T0) | **34 min 20 s** in the drill, but ~25 min of that was waiting for the owner to approve the firewall rule (a gate the drill imposed on itself). In a real incident the operator adds the rule immediately. | Drill, section 6. |
| **RTO — human steps** (estimate) | Swap `DATABASE_URL`/`DIRECT_URL` on the App Service to the restored host and restart: **~5 min** if the operator is at a terminal with `az` logged in; `/api/health/ready` confirms `db: ok` within a minute of restart. **These are estimates, not measured.** | Not part of the drill (production settings were not touched). |

Today's database holds 3 tickets, 5 users and 0 attachments; the provisioning
time is dominated by Azure's fixed server build, not by data volume. Expect the
first-query and any data-verification times to grow with the database.

---

## 3. The restore procedure

All commands from Git Bash with `az` logged in to the `csnhc-ai` subscription.
**Never print a connection string.** Read it into a shell variable and derive the
new one by hostname swap.

### 3.1 Restore to a new server

```bash
DRILL="csh-ticketing-db-restore-$(date -u +%Y%m%d-%H%M)"            # pick any unused name
RESTORE_AT=$(date -u -d '-60 minutes' +%Y-%m-%dT%H:%M:%SZ)           # the moment to go back to
date -u                                                              # T0
az postgres flexible-server restore -g csnhc-ai --name "$DRILL" \
  --source-server csh-ticketing-db --restore-time "$RESTORE_AT" --yes --no-wait
# poll until Ready (5–15 min):
watch -n 30 az postgres flexible-server show -g csnhc-ai -n "$DRILL" --query state -o tsv
```

`--yes` is required in a non-interactive shell (the CLI prompts otherwise).
`--no-wait` returns immediately; without it the command blocks until `Ready`.
The restored server **inherits the admin login/password** of the source but
**NOT its firewall rules** — verified in the drill (section 6): the copy came up
with zero rules and refused every connection (`P1001`) until one was added.
Public network access is enabled on both. So, immediately after `Ready`:

```bash
# operator's own IP (production already allows it as dev-laptop-20260501):
az postgres flexible-server firewall-rule create -g csnhc-ai -n "$DRILL" \
  -r operator --start-ip-address <your-ip> --end-ip-address <your-ip>
# if the App Service will use this server, re-create production's Azure-services rule too:
az postgres flexible-server firewall-rule create -g csnhc-ai -n "$DRILL" \
  -r AllowAllAzureServices --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
```

Rules take about a minute to become effective.

### 3.2 Verify the copy before pointing anything at it

```bash
PROD=$(az webapp config appsettings list -g csnhc-ai -n TicketTicket \
  --query "[?name=='DIRECT_URL'].value | [0]" -o tsv)                 # never echo
PROD_HOST=$(az postgres flexible-server show -g csnhc-ai -n csh-ticketing-db --query fullyQualifiedDomainName -o tsv)
NEW_HOST=$(az postgres flexible-server show -g csnhc-ai -n "$DRILL" --query fullyQualifiedDomainName -o tsv)
NEW_URL="${PROD/$PROD_HOST/$NEW_HOST}"                                # same credentials, new host — never echo
cd apps/api
DATABASE_URL="$NEW_URL" DIRECT_URL="$NEW_URL" npx prisma migrate status | grep -v 'postgresql://'
#   expect: "Database schema is up to date!" and the current migration count
DATABASE_URL="$NEW_URL" DIRECT_URL="$NEW_URL" node -e '
const { PrismaClient } = require("@prisma/client"); const p = new PrismaClient();
(async () => { for (const t of ["User","Team","Ticket","TicketMessage","Attachment","AdminAuditEvent"]) {
  const [{n}] = await p.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}"`); console.log(t, n); }
  await p.$disconnect(); })();'
```

Compare the counts with what production had at `RESTORE_AT` (or with the last
known numbers in `docs/azure-env-inventory.md`).

### 3.3 Cut production over to the restored server

Only after 3.2 passes. This changes production settings — say what/effect/blast
radius/cost aloud and get a yes.

```bash
# never put the values in a doc or a ticket; they come from $NEW_URL in the shell
az webapp config appsettings set -g csnhc-ai -n TicketTicket \
  --settings DATABASE_URL="$NEW_URL" DIRECT_URL="$NEW_URL" >/dev/null
az webapp restart -g csnhc-ai -n TicketTicket
# then, in a signed-in browser tab (Easy Auth returns 401 to curl):
#   https://<app>/api/health/ready  →  "db": "ok"
```

Afterwards decide, and record here, one of:

- **Keep the new host** in the app settings (simplest; the old server stays as
  evidence until you delete it), or
- **Rename** — delete/rename the old server and rename the restored one to
  `csh-ticketing-db` so every document stays true. Renaming a Flexible Server is
  not supported in place; it means another restore or a dump/restore. Prefer
  "keep the new host" unless the name matters to something else.

### 3.4 Clean up

Delete whichever server is no longer wanted the same day; a forgotten restored
server bills like production.

```bash
az postgres flexible-server delete -g csnhc-ai -n "<server>" --yes
az postgres flexible-server list -g csnhc-ai --query "[].name" -o tsv
```

---

## 4. Attachments (Blob) — the other half

The database restore does **not** bring attachments back; it restores the
`Attachment` rows, which point at blob names in `ticket-attachments` on storage
account `aiprojecttracker`.

- **Deleted blob, within 7 days:** recoverable. `az storage blob undelete
  --account-name aiprojecttracker -c ticket-attachments -n <blobName>
  --auth-mode login`. After 7 days it is gone.
- **Overwritten blob:** not recoverable — versioning is off.
- **Deleted container, within 7 days:** recoverable (`az storage container
  restore`). After 7 days it is gone.
- **Region lost:** the account is **`Standard_RAGRS`** (read-access
  geo-redundant) in **Central US** — note, a *different region* from the
  database (South Central US). Blobs survive a regional outage and are readable
  from the paired secondary; the database does not (section 1). So today the
  attachments are better protected than the rows that point at them.
- **Storage account deleted:** recoverable for 14 days by Azure support
  (`az storage account restore` is not self-service); after that it is gone.
- Today production has **0 attachments**, so the exposure is nil right now; it
  grows with use.

Also worth knowing: `aiprojecttracker` is not a ticketing-specific account (its
name belongs to another project). A dedicated account is a decision for the
owner (section 5), not something the drill changed.

---

## 5. Decisions for the owner

The drill changed nothing. Each row is a policy choice with its command and the
direction of the cost. Owner column deliberately blank.

| # | Decision | Command | Cost direction | Recommendation | Owner |
|---|---|---|---|---|---|
| 1 | Backup retention **7 → 35 days** | `az postgres flexible-server update -g csnhc-ai -n csh-ticketing-db --backup-retention 35` | Backup storage up to 100 % of provisioned storage (32 GB) is free; beyond that is billed per GB-month. With today's tiny database the extra is close to zero. | **Yes.** Ticket data is the system of record; a week is too short to notice a bad bulk edit. | |
| 2 | **Geo-redundant backup** | Cannot be toggled on an existing server — geo-redundancy is chosen at create time, so it means a new server (restore into one created with `--geo-redundant-backup Enabled`) and a cut-over as in 3.3. | Roughly **2× backup storage** cost. | **Later.** Do it together with any planned tier change; not urgent for a single-region, internal tool. | |
| 3 | **Zone-redundant HA** | Needs a **General Purpose** or higher tier first (`Standard_B1ms` cannot do HA): `az postgres flexible-server update … --tier GeneralPurpose --sku-name Standard_D2ds_v4`, then enable HA (`--high-availability ZoneRedundant` is deprecated in CLI 2.84 — check `az postgres flexible-server update --help` for the current flag). | Roughly **2× compute**, plus the tier upgrade itself (GP D2 is several times B1ms). | **No for now.** RTO of ~15 min via PITR is acceptable for this workload today; revisit when the app becomes clinically time-critical. | |
| 4 | Blob soft delete **7 → 14 days** (already enabled at 7) | `az storage account blob-service-properties update -g csnhc-ai -n aiprojecttracker --enable-delete-retention true --delete-retention-days 14` | Near zero (soft-deleted bytes are billed as normal storage for the extra 7 days). | **Yes.** | |
| 5 | Blob **versioning** on | `az storage account blob-service-properties update -g csnhc-ai -n aiprojecttracker --enable-versioning true` | Every overwrite keeps the old bytes; negligible for attachments, which are never overwritten by the app. | **Yes**, cheap insurance against accidental overwrite. | |
| 6 | **Dedicated storage account** for ticketing | `az storage account create …` then migrate blobs and change `AZURE_STORAGE_*` on the App Service. | One more account (no fixed fee; per-GB pricing unchanged). | **When convenient.** Sharing an account named for another project is a blast-radius and ownership problem, not a cost one. | |
| 7 | Quarterly drill | This document, section 7. | An hour of operator time; cents of Azure. | **Yes.** | |

---

## 6. Drill log — 2026-08-26

| Field | Value |
|---|---|
| Operator | Prithviraj Hulgur (owner approval at each gate); commands run by the deploy-agent session |
| Source | `csh-ticketing-db` (production) — read-only source, never modified |
| Target | `csh-ticketing-db-drill-20260826`, RG `csnhc-ai`, same SKU/storage |
| Restore point (`RESTORE_AT`) | `2026-08-26T16:45:23Z` (60 min before T0; before that day's 17:08Z full backup, so rebuilt from the 2026-08-25 full + WAL) |
| **T0** — `restore --no-wait` issued | `2026-08-26T17:45:25Z` (accepted 17:45:27Z) |
| **T1** — first `Ready` observed (30 s polling) | `2026-08-26T17:52:48Z` |
| First connection attempt | `17:53:22Z` → **`P1001` can't reach server** — no firewall rules on the copy |
| Firewall rule `drill-laptop` (4.7.213.210) created / port open | `18:18:33Z` (after owner approval) / `18:19:36Z` |
| **T2** — first successful query (`prisma migrate status`) | `2026-08-26T18:19:45Z` |
| Provisioning time (T1 − T0) | **7 min 23 s** (±30 s) |
| Time to first query, technical path (T1 + firewall + query) | **≈ 8 min 30 s** |
| Time to first query, wall clock (T2 − T0) | 34 min 20 s (≈ 25 min of it waiting for the firewall approval gate) |
| `prisma migrate status` on the copy | production's **48 migrations applied**; the only "pending" entry was a migration that existed in the local working tree but not yet in production (`20260826180000_soft_delete_and_fk_restrict`, card 0.8) — expected |
| Row counts — production at 17:2x UTC (before) | User 5 · Team 6 · Ticket 3 · TicketMessage 6 · Attachment 0 · AdminAuditEvent 1 |
| Row counts — restored copy (after, 18:19 UTC) | User 5 · Team 6 · Ticket 3 · TicketMessage 6 · Attachment 0 · AdminAuditEvent 1 — **identical** |
| Known-ticket check (`SELECT … WHERE "displayId" = …`) | `AI_20260512_014` (number 14, `RESOLVED`) found by `displayId` |
| Firewall / credentials inherited by the copy? | Credentials **yes** (production's admin login worked unchanged). Firewall **no** — the copy had 0 rules (production has 3). |
| Drill server deleted at | `delete --yes` issued `19:10:12Z`, `ResourceNotFound` by `19:11:16Z`; `flexible-server list` → `csh-ticketing-db` only. Server lifetime ≈ 86 min (≈ US$0.03). |
| Production app settings changed? | **No.** |
| Data exported from the copy? | **No** — counts and one `displayId`/`status` row only. |

---

## 7. Next drill

- **Quarterly** (next: 2026-11), and **after any change** to tier, retention,
  geo-redundancy, HA, or the storage account.
- Repeat sections 3.1–3.2 and 3.4 exactly; update the table in section 6 (keep
  the old rows as history), and re-check the facts in section 1 with the same
  `az … show` commands.
- If the database has grown, also time a full `pg_dump` of the copy so the doc
  has a "logical backup" number, not only PITR.
