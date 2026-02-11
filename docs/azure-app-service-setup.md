# Step-by-Step: Create Azure App Service for Ticketing System

This guide creates a **single App Service** that runs the API (and optionally serves the web app). You need a **database** (PostgreSQL) and the **App Service** itself.

---

## Prerequisites

- Azure subscription
- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed (optional; you can use the Portal instead)
- Node.js 18+ locally (for building)

---

## Part 1: Create resources (choose Portal or CLI)

### Option A: Azure Portal

#### Step 1: Create a resource group

1. Go to [Azure Portal](https://portal.azure.com) → **Resource groups** → **Create**.
2. **Subscription**: your subscription  
3. **Resource group**: e.g. `rg-ticketing-prod`  
4. **Region**: e.g. East US (or your preferred region)  
5. **Review + create** → **Create**

#### Step 2: Create PostgreSQL database (Azure Database for PostgreSQL – Flexible Server)

1. Portal → **Create a resource** → search **Azure Database for PostgreSQL**.
2. Choose **Flexible server** → **Create**.
3. **Basics**:
   - **Subscription**: same as above  
   - **Resource group**: `rg-ticketing-prod`  
   - **Server name**: e.g. `ticketing-db-<your-unique>` (must be globally unique)  
   - **Region**: same as resource group  
   - **PostgreSQL version**: 15 or 16  
   - **Workload type**: Development (or Production if you prefer)  
   - **Compute + storage**: Burstable B1ms (or higher for production)  
4. **Authentication**:
   - **Admin username**: e.g. `pgadmin`  
   - **Password**: set a strong password and **save it**; you need it for `DATABASE_URL`.  
5. **Networking**:
   - **Connectivity method**: Public access (or Private if you use VNet)  
   - **Firewall rules**: Add rule **Allow public access from any Azure service within Azure** (or restrict to your App Service outbound IPs later).  
6. **Review + create** → **Create**.  
7. After deployment, go to the server → **Settings** → **Connection strings**. Copy the **ADO.NET**-style URL and convert it to a Prisma-style URL, e.g.:

   ```
   postgresql://pgadmin:YOUR_PASSWORD@ticketing-db-xxx.postgres.database.azure.com:5432/postgres?sslmode=require
   ```

   For Prisma Flexible Server you often need both:

   - **DATABASE_URL**: same URL, sometimes with `?sslmode=require` or `?pgbouncer=true` if you use PgBouncer.  
   - **DIRECT_URL**: same host but **without** `?pgbouncer=true` (direct to PostgreSQL for migrations).

   Use the same URL for both if you're not using connection pooling. Example:

   ```
   DATABASE_URL="postgresql://pgadmin:PASSWORD@ticketing-db-xxx.postgres.database.azure.com:5432/postgres?sslmode=require"
   DIRECT_URL="postgresql://pgadmin:PASSWORD@ticketing-db-xxx.postgres.database.azure.com:5432/postgres?sslmode=require"
   ```

#### Step 3: Create the App Service (Web App)

1. Portal → **Create a resource** → search **Web App**.
2. **Basics**:
   - **Subscription**: same  
   - **Resource group**: `rg-ticketing-prod`  
   - **Name**: e.g. `ticketing-app-<your-unique>` (used in `https://ticketing-app-xxx.azurewebsites.net`)  
   - **Publish**: Code  
   - **Runtime stack**: **Node 20 LTS** (or 18 LTS)  
   - **Operating System**: Linux (recommended) or Windows  
   - **Region**: same as resource group  
3. **App Service Plan**:
   - Create new: e.g. `plan-ticketing-prod`  
   - **Pricing tier**: B1 (or F1 for free tier; B1 recommended for production)  
4. **Review + create** → **Create**.

#### Step 4: Configure the Web App

1. Go to your **Web App** → **Settings** → **Configuration** → **Application settings**.
2. Click **+ New application setting** and add (adjust values to match your DB and URLs):

   | Name | Value |
   |------|--------|
   | `DATABASE_URL` | `postgresql://pgadmin:YOUR_PASSWORD@ticketing-db-xxx.postgres.database.azure.com:5432/postgres?sslmode=require` |
   | `DIRECT_URL` | Same as `DATABASE_URL` (or without pgbouncer if you use it) |
   | `PORT` | `8080` (Azure injects PORT; 8080 is default for Node on App Service) |
   | `NODE_ENV` | `production` |
   | `CORS_ORIGIN` | `https://ticketing-app-xxx.azurewebsites.net` (your app URL; or `*` only for quick test) |
   | `WEB_APP_URL` | `https://ticketing-app-xxx.azurewebsites.net` |

   Optional (if you use them):

   - `REDIS_URL` or `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (e.g. Azure Cache for Redis)
   - `NOTIFICATIONS_QUEUE_ENABLED` = `false` if you don’t use Redis/queue yet
   - `ATTACHMENTS_DIR` = `uploads` (default; ensure persistent storage if needed)
   - SMTP / Azure AD / M365 vars if you use email or SSO

3. **Save** (top of Configuration).

#### Step 5: Set startup command

1. **Configuration** → **General settings**.
2. **Startup Command**:  
   `node dist/src/main.js`  
   (or `npm run start:prod` if you prefer; ensure `start:prod` runs `node dist/src/main.js`).
3. **Save**.

#### Step 6: Allow App Service to reach PostgreSQL

1. In **Azure Database for PostgreSQL** → **Settings** → **Networking** (or **Firewall**).
2. Add a firewall rule that allows your App Service outbound IPs, or use **Allow public access from any Azure service within Azure** for simplicity (tighten later with VNet if needed).

---

### Option B: Azure CLI

Run these in PowerShell or Bash (replace placeholders and ensure you're logged in: `az login`).

```bash
# Variables - replace with your values
$subscriptionId = "your-subscription-id"
$rg = "rg-ticketing-prod"
$location = "eastus"
$appName = "ticketing-app-unique123"   # globally unique
$planName = "plan-ticketing-prod"
$pgServerName = "ticketing-db-unique123"  # globally unique
$pgAdminUser = "pgadmin"
$pgAdminPass = "YourStrongPassword123!"   # change this

az account set --subscription $subscriptionId

# 1. Resource group
az group create --name $rg --location $location

# 2. PostgreSQL Flexible Server
az postgres flexible-server create \
  --resource-group $rg \
  --name $pgServerName \
  --location $location \
  --admin-user $pgAdminUser \
  --admin-password $pgAdminPass \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 16 \
  --storage-size 32 \
  --public-access 0.0.0.0

# Create database (optional; flexible server has 'postgres' by default)
# az postgres flexible-server db create --resource-group $rg --server-name $pgServerName --database-name ticketing

# 3. App Service Plan
az appservice plan create --resource-group $rg --name $planName --location $location --sku B1 --is-linux

# 4. Web App (Node 20)
az webapp create --resource-group $rg --name $appName --plan $planName --runtime "NODE:20-lts"

# 5. Get PostgreSQL host (for connection string)
$pgHost = "$pgServerName.postgres.database.azure.com"
$connectionUrl = "postgresql://${pgAdminUser}:${pgAdminPass}@${pgHost}:5432/postgres?sslmode=require"

# 6. Application settings
az webapp config appsettings set --resource-group $rg --name $appName --settings \
  DATABASE_URL="$connectionUrl" \
  DIRECT_URL="$connectionUrl" \
  PORT=8080 \
  NODE_ENV=production \
  CORS_ORIGIN="https://${appName}.azurewebsites.net" \
  WEB_APP_URL="https://${appName}.azurewebsites.net" \
  NOTIFICATIONS_QUEUE_ENABLED=false

# 7. Startup command
az webapp config set --resource-group $rg --name $appName --startup-file "node dist/src/main.js"
```

Then in Azure Portal, open **PostgreSQL** → **Networking** and allow access from Azure services (or add your App Service outbound IPs).

---

## Part 2: Build and deploy your app

### 1. Build the API (and optionally the web app)

From the **repository root**:

```powershell
cd "C:\Users\PHulgur\Downloads\Codex_Ticketing System"

# Build API
npm run build -w apps/api

# Optional: build web app (if you serve it from the API as a single app)
npm run build -w apps/web
```

### 2. Create the deployment package (ZIP)

Create a folder that will become the **root** of the App Service (so `node dist/src/main.js` runs from this root).

**API-only deploy** (no SPA in this zip):

```powershell
$deployDir = ".\deploy"
Remove-Item $deployDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $deployDir | Out-Null

Copy-Item -Path ".\apps\api\dist" -Destination "$deployDir\dist" -Recurse
Copy-Item -Path ".\apps\api\package.json" -Destination "$deployDir\"
Copy-Item -Path ".\apps\api\prisma" -Destination "$deployDir\prisma" -Recurse

# If apps/api has its own package-lock.json or node_modules, copy if you use them
# Copy-Item -Path ".\apps\api\package-lock.json" -Destination "$deployDir\" -ErrorAction SilentlyContinue

Compress-Archive -Path "$deployDir\*" -DestinationPath ".\ticketing-deploy.zip" -Force
```

**Single-app deploy** (API + SPA): only after you’ve added static serving in the API (e.g. NestJS serving `apps/web/dist`). Then also copy `apps/web/dist` into a folder the API serves (e.g. `$deployDir\public`) and ensure startup command is still `node dist/src/main.js`.

### 3. Deploy the ZIP (Kudu)

Use your existing script (replace `$app`, `$rg`, and `$zip`):

```powershell
$rg = "rg-ticketing-prod"
$app = "ticketing-app-unique123"
$zip = ".\ticketing-deploy.zip"

# Get publishing creds
$xml = [xml](Get-AzWebAppPublishingProfile -Name $app -ResourceGroupName $rg -OutputFile $null)
$pp  = $xml.publishData.publishProfile | Where-Object { $_.publishMethod -eq "MSDeploy" }
$user = $pp.userName
$pass = $pp.userPWD

$pair = "{0}:{1}" -f $user, $pass
$b64  = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$hdrs = @{ Authorization = "Basic $b64" }

$kuduHost = $pp.publishUrl.Split(':')[0]
$kudu     = "https://$kuduHost/api/zipdeploy"
Invoke-RestMethod -Uri $kudu -Method POST -InFile $zip -ContentType "application/zip" -Headers $hdrs
```

### 4. Run Prisma migrations on the server

App Service runs `npm install` when it sees `package.json`; it does **not** run Prisma generate or migrate by default. Options:

- **Option A (recommended):** Run migrations from your machine once, pointing at the production DB:

  ```powershell
  cd apps\api
  $env:DATABASE_URL = "postgresql://pgadmin:PASSWORD@ticketing-db-xxx.postgres.database.azure.com:5432/postgres?sslmode=require"
  $env:DIRECT_URL = $env:DATABASE_URL
  npx prisma migrate deploy
  npx prisma generate
  ```

  Then deploy the zip (with `prisma` folder and generated client in `node_modules` from a local `npm install` in `apps/api`, or ensure the deploy zip triggers install and you run generate in a startup script).

- **Option B:** Add a custom startup script that runs `npx prisma generate && npx prisma migrate deploy && node dist/src/main.js`, and ensure `prisma` CLI is in `apps/api` dependencies. Then set **Startup Command** to that script.

**Prisma binary targets:** The schema uses `binaryTargets = ["native", "debian-openssl-3.0.x"]`, which is correct for Azure App Service (Linux) and Debian with OpenSSL 3. If you deploy to **Windows** App Service or a different Linux base, either add that target in `apps/api/prisma/schema.prisma` or generate the client on the target machine so Prisma runs correctly at runtime.

After the first deploy, open:  
`https://ticketing-app-xxx.azurewebsites.net/api`  
(or a known route like `/api/health` if you add one). You should get a response from the API.

---

## Part 3: Checklist

- [ ] Resource group created  
- [ ] PostgreSQL Flexible Server created; firewall allows App Service (or Azure services)  
- [ ] App Service (Web App) created; Runtime = Node 20 (or 18)  
- [ ] Application settings: `DATABASE_URL`, `DIRECT_URL`, `PORT`, `NODE_ENV`, `CORS_ORIGIN`, `WEB_APP_URL`  
- [ ] Startup command: `node dist/src/main.js`  
- [ ] Prisma migrations run against production DB  
- [ ] Build and zip created from repo root  
- [ ] ZIP deployed via Kudu; site loads and API responds  

---

## Troubleshooting

- **502 / App not loading:** Check **Monitoring** → **Log stream** and **Diagnose and solve problems**. Ensure startup command is `node dist/src/main.js` (or npm start) and that `dist/src/main.js` exists in the zip.  
- **DB connection errors:** Check `DATABASE_URL`/`DIRECT_URL`, SSL (`?sslmode=require`), and PostgreSQL firewall.  
- **CORS errors:** Set `CORS_ORIGIN` to your app URL (e.g. `https://ticketing-app-xxx.azurewebsites.net`).

For a **single-app** setup (API + SPA from one URL), you’ll need to add static file serving in the NestJS API and include the web build in the deploy zip; see the earlier recommendation in the repo.
