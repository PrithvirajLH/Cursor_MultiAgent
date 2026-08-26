# Deployment — Ticketing System (how it's deployed, and every gotcha)

Runbook for deploying `apps/api` + `apps/web` to the **TicketTicket** App Service.
Written after the 2026-08-25 deploy, which was the first in ~3 months. Every
gotcha below cost real time on that run — none of it is theoretical.

For **one-time infrastructure creation** see `docs/azure-app-service-setup.md`.
This document is about deploying to infrastructure that already exists.

---

## TL;DR

```bash
# 0. from repo root, on the branch you intend to ship, working tree clean
#    NOTHING may be running from this repo — see Gotcha 2
# 1. check what production is missing, and KEEP this output
PROD=$(az webapp config appsettings list -g csnhc-ai -n TicketTicket \
  --query "[?name=='DIRECT_URL'].value | [0]" -o tsv)
cd apps/api && DATABASE_URL="$PROD" DIRECT_URL="$PROD" npx prisma migrate status

# 2. migrations FIRST (see "Why migrate first")
DATABASE_URL="$PROD" DIRECT_URL="$PROD" npx prisma migrate deploy && cd ../..

# 3. flags must be false before the package lands (see Gotcha 4)
az webapp config appsettings set -g csnhc-ai -n TicketTicket --settings \
  SCM_DO_BUILD_DURING_DEPLOYMENT=false ENABLE_ORYX_BUILD=false \
  DEPLOYED_COMMIT_SHA=$(git rev-parse HEAD)

# 4. build (~2 min) and deploy (~5 min)
pwsh -NoProfile -ExecutionPolicy Bypass -File ./create-deploy-zip.ps1   # pwsh 7, NOT powershell 5.1 — see Gotcha 9
az webapp deploy -g csnhc-ai -n TicketTicket --type zip --async true \
  --src-path Codex_Ticketing_System_deploy.zip

# 5. poll to completion, then verify (see "Verification")
```

**Do not run `./deploy-to-azure.ps1`.** It cannot deploy this package — Gotcha 1.

---

## Verified resources (subscription "Microsoft Azure (creativesnhc)")

| Thing | Value |
|---|---|
| App Service | **TicketTicket**, RG **csnhc-ai**, Linux, NODE 22-lts, `alwaysOn=true` |
| Hostname | `ticketticket-gmgwf9efe4h6bmfb.southcentralus-01.azurewebsites.net` |
| Startup command | `node dist/src/main.js` (already set, do not change) |
| Production DB | `csh-ticketing-db.postgres.database.azure.com:5432/ticketing` — Azure Postgres 16 |
| `DATABASE_URL` / `DIRECT_URL` | **identical**, both 5432, no pooler — either works for migrations |
| DB firewall | `AllowAllAzureServices` + an allowlisted dev laptop |
| Auth | **Easy Auth enabled**, `unauthenticatedClientAction: RedirectToLoginPage` |
| `httpsOnly` | `true` |

**`TicketingSystem` is a dormant predecessor** (last deploy Dec 2025, no
`DATABASE_URL`). Never deploy to it. `TicketTicket` is production.

---

## Why migrate first

Migrations run **before** the app, not after, and the migrations must be
**additive**. Both halves matter:

- Additive schema (add column/table/index, never drop or rename) is
  backward-compatible, so the **old** code keeps working against the **new**
  schema. That makes the window between step 2 and step 4 safe.
- Deploy the app first and it queries columns that do not exist yet. On
  2026-08-25 the new code required `SlaBusinessHoursSetting.teamId`; shipping
  the app first would have failed every SLA and ticket-creation path.

If a migration is **not** additive, this ordering is unsafe and the change needs
a proper expand/contract plan — that is a design task, not a deploy step.

---

## Runbook

### 1. Pre-flight

- Be on the branch you intend to ship, working tree clean, `git rev-parse HEAD`
  noted. The App Service records it as `DEPLOYED_COMMIT_SHA`.
- **Kill everything running from this repo** — see Gotcha 2.
- Run the checks. A deploy of code whose tests you have not run is a guess:
  ```bash
  cd apps/api && npx tsc --noEmit && cd ../web && npx tsc --noEmit && cd ..
  cd apps/api && npx jest                                    # expect 186
  export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
  npm run test:integration                                   # expect 360 + 1 skipped
  ```

### 2. Migrations

```bash
PROD=$(az webapp config appsettings list -g csnhc-ai -n TicketTicket \
  --query "[?name=='DIRECT_URL'].value | [0]" -o tsv)
cd apps/api
DATABASE_URL="$PROD" DIRECT_URL="$PROD" npx prisma migrate status   # KEEP this output
DATABASE_URL="$PROD" DIRECT_URL="$PROD" npx prisma migrate deploy
DATABASE_URL="$PROD" DIRECT_URL="$PROD" npx prisma migrate status   # "up to date!"
```

The **first** `migrate status` is your rollback reference: it is the only record
of which migrations were already applied before you touched anything. Save it.

Before applying anything, confirm each pending migration is additive:

```bash
grep -cE '^(DROP|ALTER TABLE .* DROP)' prisma/migrations/<name>/migration.sql   # must be 0
```

### 3. App settings

```bash
az webapp config appsettings set -g csnhc-ai -n TicketTicket --settings \
  SCM_DO_BUILD_DURING_DEPLOYMENT=false \
  ENABLE_ORYX_BUILD=false \
  DEPLOYED_COMMIT_SHA=$(git rev-parse HEAD)
```

This restarts the app. Do it before the package lands, not after.

### 4. Build

```bash
pwsh -NoProfile -ExecutionPolicy Bypass -File ./create-deploy-zip.ps1   # pwsh 7, NOT powershell 5.1 — see Gotcha 9
```

Produces `Codex_Ticketing_System_deploy.zip` (~169 MB: it bundles production
`node_modules` and a generated Prisma client, which is why Oryx must not rebuild
it). The script builds both apps, installs prod-only deps, runs
`prisma generate`, and copies the web build into `public/` so the API serves the
SPA same-origin.

### 5. Deploy

```bash
az webapp deploy -g csnhc-ai -n TicketTicket --type zip --async true \
  --src-path Codex_Ticketing_System_deploy.zip
```

As of 2026-08-26 the CLI **polls the deployment itself** and prints
`Building the app… → Build successful → Starting the site… → Site started
successfully → Deployment has completed successfully` (about 95 s for the 162 MB
package). If it returns before that, poll until `complete=true`:

```bash
az webapp log deployment list -g csnhc-ai -n TicketTicket \
  --query "[0].{id:id,status:status,complete:complete,active:active,progress:progress}" -o json
```

Expect progress to move through `Zipping node_modules...` →
`Express Node Deploy: Running rsync...` → `Running post deployment command(s)...`
→ `status=4, complete=true, active=true`. **`status=4` and `active=true` is
success.** Roughly 5 minutes.

---

## Verification (what actually proves it)

`curl` against the site returns **401 for every URL, including `/`** — that is
Easy Auth, not a broken deploy (Gotcha 3). So verify through Kudu, which uses
publishing credentials and bypasses Easy Auth:

```bash
CREDS=$(az webapp deployment list-publishing-credentials -g csnhc-ai -n TicketTicket \
  --query "{u:publishingUserName,p:publishingPassword}" -o tsv)
U=$(echo "$CREDS" | cut -f1); P=$(echo "$CREDS" | cut -f2)
SCM="https://ticketticket-gmgwf9efe4h6bmfb.scm.southcentralus-01.azurewebsites.net/api/vfs/site/wwwroot"

# the served SPA must reference the asset hashes you just built
curl -s -u "$U:$P" "$SCM/public/index.html" | grep -oE 'assets/[A-Za-z0-9._-]+\.js' | head -4
ls apps/web/dist/assets | grep -E '^index-.*\.js$'      # must match the above

# and the API bundle must contain the code you shipped
curl -s -o /dev/null -w '%{http_code}\n' -u "$U:$P" "$SCM/dist/src/main.js"
```

Matching asset hashes is the proof. "The deployment said success" is not —
a package can deploy successfully and still be the wrong package.

Also check that a file **new in this release** exists on the server, e.g.
(2026-08-26) `dist/src/health/health.controller.js`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -u "$U:$P" "$SCM/dist/src/health/health.controller.js"   # 200
```

**Two dead ends, so nobody repeats them (2026-08-26):**

- Kudu's command API (`POST …/api/command` with `curl http://localhost:8080/…`)
  **cannot reach the app** on Linux App Service — Kudu runs in its own container
  and only shares the filesystem. You get `ExitCode: 7` (connection refused).
- **Container logging is off** in production (`az webapp log show` →
  `applicationLogs.fileSystem.level: Off`, no `*_default_docker.log` under
  `/LogFiles`), so there is no startup log to read either. Turning it on is a
  config change (`az webapp log config -g csnhc-ai -n TicketTicket
  --docker-container-logging filesystem`) — worth doing once so future deploys
  can be verified from the log instead of a browser.

Until then the only functional check is a **signed-in browser**: open
`/api/health` and `/api/health/ready` (the readiness inventory added 2026-08-26)
and read the JSON.

Also confirm: `az webapp show -g csnhc-ai -n TicketTicket --query state` → `Running`.

Finally, log in through a browser as a real user and exercise the feature you
shipped. Nothing above proves the app *works*, only that the right bytes landed.

---

## ⚠ Gotchas (the part that actually cost time)

### 1. `deploy-to-azure.ps1` cannot deploy this package

It does a **synchronous** `Invoke-RestMethod` POST to Kudu `zipdeploy`. At
~169 MB that dies with **`502 Bad Gateway`** when the gateway times out, and
leaves a `temp-*` deployment stuck at `status=0, complete=false` forever.

**A 502 does not mean the deploy failed or succeeded — it means you do not know.**
Check `az webapp log deployment list` before doing anything else. On 2026-08-25
the 502 left production untouched on the May build.

Use `az webapp deploy --async` instead. The PowerShell script is kept because it
documents the packaging logic and the publishing-profile path, but it is not a
working deploy route at this package size.

### 2. The build fails with `EPERM` if anything from this repo is running

```
EPERM: operation not permitted, rename 'node_modules\.prisma\client\query_engine-windows.dll.node.tmp…'
```

`prisma generate` cannot replace the query engine while a node process holds it.
Culprits: a `nest start --watch` dev server, a vite dev server, or — repeatedly —
**orphaned jest processes**, which in this repo finish their tests but never
exit and can sit for hours at flat CPU.

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*Ticketing System Quality Review*' } |
  Select-Object ProcessId, CommandLine
# then Stop-Process -Id <each> -Force
```

Compare CPU-seconds over a few seconds to tell a live run from an orphan: a real
run burns CPU, an orphan is flat.

### 3. 401 on every URL is correct

Easy Auth is enabled with `unauthenticatedClientAction: RedirectToLoginPage`, so
anonymous requests get 401 with an empty body — including `/` and
`/api/health`. This is true **before and after** a deploy. Do not chase it as a
deployment failure. Verify through Kudu instead.

### 4. Oryx must not rebuild the package

`SCM_DO_BUILD_DURING_DEPLOYMENT` and `ENABLE_ORYX_BUILD` must both be `false`.
The zip already contains production `node_modules` and a generated Prisma
client; letting Oryx rebuild replaces them with something built for the wrong
assumptions. Both were **unset** before 2026-08-25 (Oryx defaults applied) — they
are now explicitly `false`. Verify they are still false before each deploy.

### 5. The `.env` on a dev machine is not production

`apps/api/.env` points at a **Supabase dev** database, through a pgBouncer
pooler on **6543**, which cannot run migrations at all. Never run
`migrate deploy` against it and never assume it is production. Always read the
production URL from App Service settings as shown above.

### 6. Every generated Prisma migration must be hand-checked

`prisma migrate dev` emits `DROP INDEX` for six trigram GIN indexes it cannot
model in `schema.prisma`, plus assorted `ALTER COLUMN … DROP DEFAULT`. Applying
one unedited destroys ticket and KB search performance against a stated
sub-500ms requirement. Strip every destructive statement, add a header comment
explaining why, and confirm:

```bash
grep -cE '^(DROP|ALTER TABLE .* DROP)' prisma/migrations/<name>/migration.sql   # 0
```

`prisma migrate dev` also **cannot run non-interactively**. To author a
migration: `prisma migrate diff` to see the SQL, hand-write the migration folder,
then `prisma migrate deploy`.

### 7. `scripts/merge-hr-teams.sql` is manual and one-time

It is a data migration, not a schema migration. It is **not** part of this
runbook and is not automated. Dry-run it, then run it once, deliberately. As of
2026-08-25 it has **not** been run against production.

### 8. CI does not gate this deploy

Nothing in this runbook is gated by a pipeline. `azure-pipelines.yml` exists
(phase 1: verify + integration) but **cannot run**: the Azure DevOps org has no
hosted parallelism grant, which needs a purchase or a support request. Until
that is resolved, the test commands in step 1 are the only gate, and they are
manual. The fixed `.github/workflows/ci.yml` can run on the public GitHub
remotes if you want automated checks sooner.

### 9. `create-deploy-zip.ps1` fails under Windows PowerShell 5.1

The script sets `$ErrorActionPreference = "Stop"` and runs `npm … 2>&1`. Under
`powershell.exe` (5.1) any line npm writes to stderr — including the harmless
`npm warn config production Use --omit=dev instead` that this repo's `.npmrc`
provokes on every command — becomes a terminating `NativeCommandError`, and the
build dies at "Building API…" with exit 1 and no zip. Under `pwsh` (7.x) stderr
is not promoted to an error and the script completes. Always invoke it with
`pwsh`. (Root cause of the warning: `.npmrc` sets the deprecated key
`production = false`; deleting that line silences it.)

---

## Rollback

There is no automated rollback. In order of preference:

1. **Redeploy the previous good commit.** Check out the SHA that was in
   `DEPLOYED_COMMIT_SHA` before your deploy, rebuild, redeploy. This is why that
   setting exists.
2. **App Service deployment history.** `az webapp log deployment list` shows
   prior successful deployments; the portal's Deployment Center can redeploy one.
3. **Schema.** Additive migrations do not need reverting — old code ignores new
   columns. If you applied something non-additive, you need a written
   down-migration, and you should have had one before applying it.

---

## Post-deploy checklist

- [ ] `migrate status` reports up to date
- [ ] Deployment `status=4`, `complete=true`, `active=true`
- [ ] `az webapp show … --query state` is `Running`
- [ ] Kudu asset hashes match the local build
- [ ] `DEPLOYED_COMMIT_SHA` equals the shipped commit
- [ ] Signed in through a browser and exercised the shipped feature
- [ ] The pre-deploy `migrate status` output is saved somewhere durable
