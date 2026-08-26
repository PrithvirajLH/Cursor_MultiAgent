# Implementation Prompt — 0.12 Backup and restore drill

**Date:** 2026-08-26
**Repo:** `Ticketing System Quality Review`
**Card:** 0.12 in `prompts/2026-08-26-restart-master-plan.md`
**For:** the deploy-agent session (this is Azure work, not code). No files under `apps/` change.
**Closes:** Azure keeps database backups by default, but nobody has written down how far back you can go, how long a restore takes, or tried one. The first time you learn that is not allowed to be during an outage.

---

## 1. Goal

Restore production's database to a scratch server as of one hour ago, prove the copy is intact, delete the scratch server, and write `docs/DR.md` with the measured recovery time, the backup policy as it actually is, and the decisions the owner still has to make about it.

## 2. Context read

- `docs/DEPLOYMENT.md` — "Rollback" section (there is no automated rollback; this drill is the database half of it).
- `docs/agent-context/repo-landmines.md` — "Never generate migrations against `.env`"; the same discipline applies here: the production URL comes from App Service settings, never from a local file.
- `docs/azure-env-inventory.md` — what production has (Blob storage for attachments — that is the *other* half of DR).

## 3. Facts established first (verified 2026-08-26 with `az`)

| Fact | Consequence |
|---|---|
| `csh-ticketing-db` (RG `csnhc-ai`): PostgreSQL **16**, SKU **Standard_B1ms** (Burstable), **32 GB** storage, state Ready. | A point-in-time restore creates a **new server of the same size**; while it exists it bills like production (~US$0.02/h for B1ms + storage). Delete it the same day. |
| Backup: **`backupRetentionDays: 7`**, `geoRedundantBackup: Disabled`, `highAvailability: Disabled`, earliest restore point 2026-08-20. | You can only go back one week. A regional outage takes backups with it. These are policy facts for the owner, not things this drill changes. |
| The App Service holds `DATABASE_URL` / `DIRECT_URL` (identical, port 5432, no pooler) as app settings. The admin login is embedded in that URL; the restored server keeps the same admin credentials. | Read the URL into a shell variable with `az … -o tsv`, never print it; derive the restored server's URL by swapping the hostname. |
| Attachments live in Azure Blob (`AZURE_STORAGE_*` set); no blob lifecycle or soft-delete policy has been recorded. | Check `az storage account blob-service-properties show` for soft delete / versioning and record the answer — the drill does not change it. |
| `prisma migrate status` against production reports "Database schema is up to date!" with 48 migrations (2026-08-26). | The same command against the restored copy is the integrity check, plus row counts. |
| Production contents today: 3 tickets, 5 users, 0 attachments. | The drill is cheap and safe *now*; the timing you measure will grow with data — say so in the doc. |

## 4. Decisions and assumptions

1. **Restore to a new server, never in place.** Name `csh-ticketing-db-drill-YYYYMMDD`, same RG and region, restore time = now − 60 min. Production is untouched throughout.
2. **Measure, don't estimate:** wall-clock from `restore` command to `state: Ready`, and to first successful query. Those two numbers are the RTO for the doc.
3. **Verify three things on the copy:** `prisma migrate status` = up to date; row counts for `User`, `Team`, `Ticket`, `TicketMessage`, `Attachment` equal production's from an hour earlier (with 3 tickets, they will match exactly); one `SELECT` of a known ticket by `displayId`.
4. **Delete the drill server before ending the session**, and confirm it is gone. Leaving it is the only way this drill costs real money.
5. **The doc records decisions for the owner, not defaults chosen by the agent:** retention 7 → 35 days? geo-redundant backup (roughly doubles backup storage cost)? zone-redundant HA (roughly doubles compute)? blob soft-delete? Present each with the `az` command and the price direction; the owner decides.
6. Every command that creates or deletes an Azure resource is read aloud to the owner first (what / effect / blast radius / reversibility / cost) and gets a yes. The restore creates a resource; the delete removes one; nothing here touches production.

## 5. The work

### Task 1 — Baseline (read-only)

```bash
az postgres flexible-server show -g csnhc-ai -n csh-ticketing-db --query "{sku:sku.name,storageGb:storage.storageSizeGb,retention:backup.backupRetentionDays,geo:backup.geoRedundantBackup,ha:highAvailability.mode,earliest:backup.earliestRestoreDate}" -o json
PROD=$(az webapp config appsettings list -g csnhc-ai -n TicketTicket --query "[?name=='DIRECT_URL'].value | [0]" -o tsv)   # never echo
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
DATABASE_URL="$PROD" DIRECT_URL="$PROD" node -e '
const { PrismaClient } = require("@prisma/client"); const p = new PrismaClient();
(async () => { for (const t of ["User","Team","Ticket","TicketMessage","Attachment","AdminAuditEvent"]) { const [{n}] = await p.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}"`); console.log(t, n); } await p.$disconnect(); })();'
STORAGE=$(az webapp config appsettings list -g csnhc-ai -n TicketTicket --query "[?name=='AZURE_STORAGE_CONTAINER'].value | [0]" -o tsv); echo "container name: $STORAGE"
# storage account name is inside the connection string; find the account another way:
az storage account list -g csnhc-ai --query "[].name" -o tsv
az storage account blob-service-properties show -g csnhc-ai -n <account> --query "{softDelete:deleteRetentionPolicy,versioning:isVersioningEnabled}" -o json
```

Write the counts and the blob-policy answer down; they go into the doc.

### Task 2 — Restore (creates a billable server; owner's yes)

```bash
DRILL="csh-ticketing-db-drill-$(date -u +%Y%m%d)"
RESTORE_AT=$(date -u -d '-60 minutes' +%Y-%m-%dT%H:%M:%SZ)      # Git Bash: date -u -d works
echo "restoring to $DRILL at $RESTORE_AT"; date -u +%H:%M:%S
az postgres flexible-server restore -g csnhc-ai --name "$DRILL" --source-server csh-ticketing-db --restore-time "$RESTORE_AT"
date -u +%H:%M:%S   # T1: command returned
az postgres flexible-server show -g csnhc-ai -n "$DRILL" --query "{state:state,host:fullyQualifiedDomainName}" -o json
```

Note: `restore` blocks until the server is provisioned (typically 5–15 min). If it returns early, poll `show … --query state` every 60 s until `Ready`.

### Task 3 — Verify the copy

```bash
DRILL_HOST=$(az postgres flexible-server show -g csnhc-ai -n "$DRILL" --query fullyQualifiedDomainName -o tsv)
PROD_HOST=$(az postgres flexible-server show -g csnhc-ai -n csh-ticketing-db --query fullyQualifiedDomainName -o tsv)
DRILL_URL="${PROD/$PROD_HOST/$DRILL_HOST}"                        # same credentials, new host — never echo
# the restored server copies the firewall rules; if the connection is refused, add your IP:
# az postgres flexible-server firewall-rule create -g csnhc-ai -n "$DRILL" -r drill-laptop --start-ip-address <ip> --end-ip-address <ip>
date -u +%H:%M:%S
DATABASE_URL="$DRILL_URL" DIRECT_URL="$DRILL_URL" npx prisma migrate status | grep -vE "postgresql://"     # expect "up to date", 48 migrations
date -u +%H:%M:%S   # T2: first successful query
DATABASE_URL="$DRILL_URL" DIRECT_URL="$DRILL_URL" node -e '<the same row-count script as Task 1>'
```

Counts must equal Task 1's (or differ only by rows created in the last hour — with today's traffic, none).

### Task 4 — Delete the drill server (owner's yes) and confirm

```bash
az postgres flexible-server delete -g csnhc-ai -n "$DRILL" --yes
az postgres flexible-server list -g csnhc-ai --query "[].name" -o tsv     # must list only csh-ticketing-db
```

### Task 5 — Write `docs/DR.md`

Sections, in this order, all with the measured values:

1. **What is backed up, by whom, how far back** — Azure automated backups, PITR, 7 days, LRS (not geo-redundant), no HA; earliest restore date at time of writing. Blob: soft-delete/versioning state from Task 1.
2. **Recovery objectives as measured on 2026-08-26** — RPO: Azure PITR granularity (state the documented figure, ~5 min); RTO: T1−T0 (provisioning) and T2−T0 (first query), plus the human steps (swap `DATABASE_URL`/`DIRECT_URL` on the App Service to the restored host, restart) — estimate those and say they are estimates.
3. **The restore procedure** — the exact commands from Tasks 2–3, then the cut-over: `az webapp config appsettings set … DATABASE_URL=… DIRECT_URL=…` (never in the doc with values), `az webapp restart`, verify `/api/health/ready` `db: ok`, then decide whether to rename the restored server to the old name or leave the new host in settings.
4. **Attachments** — Blob is not covered by the database restore; state the blob soft-delete / versioning status and what a restore of a deleted blob would take.
5. **Decisions for the owner** — a table: retention 7 → 35 days (`az postgres flexible-server update … --backup-retention 35`, cost: backup storage beyond 100% of provisioned size is billed); geo-redundant backup (requires server recreate on some tiers — check; roughly 2× backup storage); zone-redundant HA (≈2× compute; B-series does **not** support HA — an upgrade to General Purpose would be needed first); blob soft-delete 14 days (near-zero cost). Recommendation column, owner column left blank.
6. **Drill log** — date, operator, T0/T1/T2, counts before/after, server deleted at HH:MM (confirmed).
7. **Next drill** — propose quarterly, and after any tier change.

Commit `docs/DR.md` on `ui-redesign-and-api-hardening` (do not push); the planning session verifies and merges.

## 6. Files expected to change

`docs/DR.md` (new). Nothing else in the repo. Azure: one server created and deleted; no production resource modified.

## 7. Security considerations

- Connection strings only ever live in shell variables in this session; nothing is echoed, logged, or written to a file. If you must add a firewall rule for your laptop, delete it with the server.
- The restored server contains production data (PHI-adjacent). It exists for under an hour and is deleted; confirm deletion before finishing. Do not export data from it.

## 8. Acceptance criteria

1. Drill server reached `Ready`, `prisma migrate status` on it said up to date, counts matched.
2. Drill server deleted; `flexible-server list` shows only production.
3. `docs/DR.md` exists with measured T0/T1/T2, the policy facts, the cut-over procedure, and the owner decision table.
4. No app setting on production was changed.

## 9. Handoff notes — what to report back

1. Commit SHA of `docs/DR.md`.
2. T0, T1, T2 timestamps and the two derived durations.
3. Row counts before/after.
4. Confirmation line from the `flexible-server list` after deletion.
5. Blob soft-delete / versioning status found.
6. Anything that did not match §3 — especially if the restored server did not inherit firewall rules or credentials as assumed, or if `restore` returned before `Ready`.
