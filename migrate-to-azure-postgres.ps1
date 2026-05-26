<#
.SYNOPSIS
  Migrate the Codex Ticketing System backend from Supabase Postgres to Azure Database
  for PostgreSQL Flexible Server. Provisions, migrates, seeds, rewires App Service.

.DESCRIPTION
  See docs/superpowers/specs/2026-05-01-azure-postgres-migration-design.md
  Run from the repo root.
#>

[CmdletBinding()]
param(
  [string] $SubscriptionId  = "de674ee2-d249-4240-8392-810c935b8c33",
  [string] $ResourceGroup   = "csnhc-ai",
  [string] $Location        = "southcentralus",
  [string] $ServerName      = "csh-ticketing-db",
  [string] $DatabaseName    = "ticketing",
  [string] $AdminUser       = "pgadmin",
  [string] $AppServiceName  = "TicketTicket",
  [string] $PgVersion       = "16",
  [string] $Sku             = "Standard_B1ms",
  [string] $Tier            = "Burstable",
  [int]    $StorageGb       = 32,
  [string] $AdminPassword    = "",
  [switch] $WhatIf
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok  ([string]$msg) { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }

function New-RandomPassword {
  # ~144 bits of entropy from 24 CSPRNG bytes → base64 (URL-unsafe chars stripped).
  # 4-digit CSPRNG suffix ensures Azure Postgres complexity (digit class always present).
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $b64 = [Convert]::ToBase64String($bytes)
  $digitBytes = New-Object byte[] 2
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($digitBytes)
  $digits = ([System.BitConverter]::ToUInt16($digitBytes, 0) % 10000).ToString("D4")
  return ($b64 -replace '[+/=]', '') + $digits
}

# --- Pre-flight checks --------------------------------------------------------
Write-Step "Pre-flight checks"

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  throw "Azure CLI (az) is not on PATH. Install it: https://aka.ms/installazurecli"
}
Write-Ok "az CLI found"

$ctx = az account show 2>$null
if ($LASTEXITCODE -ne 0 -or -not $ctx) { throw "Not logged in. Run: az login" }
$ctx = $ctx | ConvertFrom-Json
if ($ctx.id -ne $SubscriptionId) {
  Write-Warn "Current subscription is $($ctx.id), expected $SubscriptionId. Switching."
  az account set --subscription $SubscriptionId | Out-Null
}
Write-Ok "Subscription: $SubscriptionId"

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw "npx not found. Install Node.js 20+."
}
Write-Ok "Node tooling found"

if (-not (Test-Path "apps/api/prisma/schema.prisma")) {
  throw "Run this script from the repo root (where apps/api exists)."
}
Write-Ok "Repo root confirmed"

if ($WhatIf) {
  Write-Host ""
  Write-Host "WhatIf mode — would perform:" -ForegroundColor Magenta
  Write-Host "  1. Create Postgres Flex server '$ServerName' ($Sku, PG $PgVersion, ${StorageGb}GB) in $ResourceGroup/$Location"
  Write-Host "  2. Create database '$DatabaseName'"
  Write-Host "  3. Add firewall rules (Azure services + your laptop IP)"
  Write-Host "  4. Enable PgBouncer"
  Write-Host "  5. Run prisma migrate deploy + generate + db:seed against the new server"
  Write-Host "  6. Capture old TicketTicket DATABASE_URL/DIRECT_URL into rollback.ps1"
  Write-Host "  7. Update TicketTicket DATABASE_URL/DIRECT_URL to the new server"
  Write-Host "  8. Restart TicketTicket"
  Write-Host ""
  exit 0
}

# --- Provision Flexible Server -----------------------------------------------
Write-Step "Provision Postgres Flexible Server"

$existing = az postgres flexible-server show -g $ResourceGroup -n $ServerName 2>$null
if ($LASTEXITCODE -eq 0 -and $existing) {
  $existing = $existing | ConvertFrom-Json
  Write-Ok "Server '$ServerName' already exists ($($existing.fullyQualifiedDomainName))"
  if ($AdminPassword) {
    $adminPasswordPlain = $AdminPassword
    Write-Ok "Using -AdminPassword param value"
  } else {
    $adminPassword = Read-Host -AsSecureString "Existing server detected. Enter the admin password"
    $adminPasswordPlain = [System.Net.NetworkCredential]::new("", $adminPassword).Password
  }
} else {
  $adminPasswordPlain = New-RandomPassword
  Write-Ok "Generated admin password (will be shown at end of run)"

  Write-Host "  Creating server (this takes 3-5 minutes)..."
  az postgres flexible-server create `
    --resource-group $ResourceGroup `
    --name $ServerName `
    --location $Location `
    --admin-user $AdminUser `
    --admin-password $adminPasswordPlain `
    --sku-name $Sku `
    --tier $Tier `
    --version $PgVersion `
    --storage-size $StorageGb `
    --public-access 0.0.0.0 `
    --yes | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "az postgres flexible-server create failed (exit $LASTEXITCODE)" }
  Write-Ok "Server created"
}

$serverInfo = az postgres flexible-server show -g $ResourceGroup -n $ServerName
if ($LASTEXITCODE -ne 0) { throw "Could not fetch server info (exit $LASTEXITCODE)" }
$serverInfo = $serverInfo | ConvertFrom-Json
$pgHost = $serverInfo.fullyQualifiedDomainName
Write-Ok "Server FQDN: $pgHost"

# --- Create database ----------------------------------------------------------
Write-Step "Create database '$DatabaseName'"
$dbExists = az postgres flexible-server db show -g $ResourceGroup --server-name $ServerName -d $DatabaseName 2>$null
if ($LASTEXITCODE -eq 0 -and $dbExists) {
  Write-Ok "Database '$DatabaseName' already exists"
} else {
  az postgres flexible-server db create -g $ResourceGroup --server-name $ServerName -d $DatabaseName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "az postgres flexible-server db create failed (exit $LASTEXITCODE)" }
  Write-Ok "Database '$DatabaseName' created"
}

# --- Firewall rules -----------------------------------------------------------
Write-Step "Configure firewall"

# Allow other Azure services (App Service, etc.)
$existingAzureRule = az postgres flexible-server firewall-rule show `
  -g $ResourceGroup --name $ServerName --rule-name AllowAllAzureServices 2>$null
if ($LASTEXITCODE -eq 0 -and $existingAzureRule) {
  Write-Ok "Firewall rule already exists: AllowAllAzureServices"
} else {
  az postgres flexible-server firewall-rule create `
    -g $ResourceGroup --name $ServerName `
    --rule-name AllowAllAzureServices `
    --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to create AllowAllAzureServices firewall rule (exit $LASTEXITCODE)" }
  Write-Ok "Firewall rule: AllowAllAzureServices"
}

# Allow the operator's current public IP for prisma migrate
# Try multiple IP-echo services for resilience
$myIp = $null
foreach ($ipSvc in @("https://api.ipify.org","https://ifconfig.me/ip","https://checkip.amazonaws.com")) {
  try {
    $result = (Invoke-RestMethod -Uri $ipSvc -TimeoutSec 5).Trim()
    if ($result -match '^\d+\.\d+\.\d+\.\d+$') {
      $myIp = $result
      break
    }
    if ($result -match ':') {
      throw "IP echo returned IPv6 address ($result). Azure Postgres firewall rules require IPv4. Set a manual rule."
    }
  } catch {
    Write-Warn "IP service $ipSvc unreachable, trying next..."
  }
}
if (-not $myIp) {
  throw "Could not detect public IPv4 address from any service. Add a firewall rule manually for your IP."
}
$ruleName = "dev-laptop-" + (Get-Date -Format "yyyyMMdd")

$existingDevRule = az postgres flexible-server firewall-rule show `
  -g $ResourceGroup --name $ServerName --rule-name $ruleName 2>$null
if ($LASTEXITCODE -eq 0 -and $existingDevRule) {
  $existingRuleObj = $existingDevRule | ConvertFrom-Json
  if ($existingRuleObj.startIpAddress -eq $myIp) {
    Write-Ok "Firewall rule already exists: $ruleName ($myIp)"
  } else {
    Write-Warn "Rule $ruleName exists for $($existingRuleObj.startIpAddress); updating to current IP $myIp"
    az postgres flexible-server firewall-rule update `
      -g $ResourceGroup --name $ServerName `
      --rule-name $ruleName `
      --start-ip-address $myIp --end-ip-address $myIp | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to update $ruleName firewall rule (exit $LASTEXITCODE)" }
    Write-Ok "Firewall rule updated: $ruleName for $myIp"
  }
} else {
  az postgres flexible-server firewall-rule create `
    -g $ResourceGroup --name $ServerName `
    --rule-name $ruleName `
    --start-ip-address $myIp --end-ip-address $myIp | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Failed to create $ruleName firewall rule (exit $LASTEXITCODE)" }
  Write-Ok "Firewall rule: $ruleName for $myIp"
}

# --- Try to enable PgBouncer (optional) --------------------------------------
# PgBouncer is not supported on Burstable B1ms tier in some Azure regions.
# If we can't enable it, fall back to direct connections on port 5432 for both URLs.
Write-Step "Try to enable PgBouncer on the server (optional)"

$pgbouncerEnabled = $false
$pgbState = az postgres flexible-server parameter show `
  -g $ResourceGroup --server-name $ServerName --name pgbouncer.enabled `
  --query value -o tsv 2>$null
if ($LASTEXITCODE -eq 0 -and $pgbState -eq "true") {
  Write-Ok "PgBouncer already enabled"
  $pgbouncerEnabled = $true
} else {
  $pgbOutput = az postgres flexible-server parameter set `
    -g $ResourceGroup --server-name $ServerName `
    --name pgbouncer.enabled --value true 2>&1
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "PgBouncer enabled (port 6432)"
    $pgbouncerEnabled = $true
  } else {
    Write-Warn "PgBouncer not available on this tier/region — using direct connections only."
    Write-Warn "(Detail: $pgbOutput)"
  }
}

# --- Build connection strings -------------------------------------------------
$encodedUser = [uri]::EscapeDataString($AdminUser)
$encodedPwd  = [uri]::EscapeDataString($adminPasswordPlain)

if ($pgbouncerEnabled) {
  $pooledUrl = "postgresql://${encodedUser}:${encodedPwd}@${pgHost}:6432/${DatabaseName}?sslmode=require&pgbouncer=true"
} else {
  # Fall back to direct connection for "pooled" URL too
  $pooledUrl = "postgresql://${encodedUser}:${encodedPwd}@${pgHost}:5432/${DatabaseName}?sslmode=require"
}
$directUrl = "postgresql://${encodedUser}:${encodedPwd}@${pgHost}:5432/${DatabaseName}?sslmode=require"

# --- Run Prisma migrate + generate + seed ------------------------------------
Write-Step "Apply Prisma schema to Azure (migrate deploy)"

Push-Location apps/api
try {
  # IMPORTANT: env vars scoped to this Push-Location only; never written to .env
  # Use DIRECT_URL (port 5432, no PgBouncer) for both because PgBouncer
  # transaction-mode pooling breaks Prisma's session-scoped migration locks.
  $env:DATABASE_URL = $directUrl
  $env:DIRECT_URL   = $directUrl

  Write-Host "  Running prisma migrate deploy..."
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy failed (exit $LASTEXITCODE)" }
  Write-Ok "Migrations applied"

  Write-Host "  Running prisma generate..."
  npx prisma generate
  if ($LASTEXITCODE -ne 0) { throw "prisma generate failed (exit $LASTEXITCODE)" }
  Write-Ok "Prisma client generated"

  Write-Host "  Running db:seed..."
  npm run db:seed
  if ($LASTEXITCODE -ne 0) { throw "db:seed failed (exit $LASTEXITCODE)" }
  Write-Ok "Seed completed"
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:DIRECT_URL   -ErrorAction SilentlyContinue
  Pop-Location
}

# --- Capture old App Service settings into rollback.ps1 ----------------------
Write-Step "Capture pre-cutover App Service settings"

$current = az webapp config appsettings list -g $ResourceGroup -n $AppServiceName
if ($LASTEXITCODE -ne 0) { throw "Could not read App Service settings (exit $LASTEXITCODE)" }
$current = $current | ConvertFrom-Json
$dbSetting     = $current | Where-Object { $_.name -eq 'DATABASE_URL' }
$directSetting = $current | Where-Object { $_.name -eq 'DIRECT_URL'   }

if (-not $dbSetting -or -not $directSetting) {
  throw "Could not read DATABASE_URL/DIRECT_URL from App Service '$AppServiceName' — aborting before any change."
}
$oldDb     = $dbSetting.value
$oldDirect = $directSetting.value
Write-Ok "Captured pre-cutover URLs"

# Write rollback.ps1 (gitignored). Single-quoted here-string so PowerShell doesn't
# expand $ inside; we manually interpolate via -f operator below.
$rollbackTemplate = @'
# Auto-generated by migrate-to-azure-postgres.ps1 on {0}
# Restores {1} to the pre-cutover Supabase database.
# DO NOT COMMIT — contains the old Supabase credentials.

$ErrorActionPreference = "Stop"

az webapp config appsettings set -g {2} -n {1} --settings `
  "DATABASE_URL={3}" `
  "DIRECT_URL={4}" | Out-Null
if ($LASTEXITCODE -ne 0) {{ throw "Failed to restore App Service settings (exit $LASTEXITCODE)" }}

az webapp restart -g {2} -n {1} | Out-Null
if ($LASTEXITCODE -ne 0) {{ throw "Failed to restart App Service (exit $LASTEXITCODE)" }}

Write-Host "Rolled back '{1}' to pre-cutover database." -ForegroundColor Green
'@

$rollbackContent = $rollbackTemplate -f `
  (Get-Date -Format o), $AppServiceName, $ResourceGroup, $oldDb, $oldDirect

$rollbackContent | Set-Content -Path "rollback.ps1" -Encoding UTF8
Write-Ok "Wrote rollback.ps1 (gitignored)"

# --- Update App Service settings ---------------------------------------------
Write-Step "Update '$AppServiceName' DATABASE_URL / DIRECT_URL"

az webapp config appsettings set `
  -g $ResourceGroup -n $AppServiceName `
  --settings "DATABASE_URL=$pooledUrl" "DIRECT_URL=$directUrl" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to update App Service settings (exit $LASTEXITCODE)" }
Write-Ok "App Service settings updated"

Write-Step "Restart '$AppServiceName'"
az webapp restart -g $ResourceGroup -n $AppServiceName | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to restart App Service (exit $LASTEXITCODE)" }
Write-Ok "Restart issued"

# --- Final summary ------------------------------------------------------------
Write-Host ""
Write-Host "=== CUTOVER COMPLETE ===" -ForegroundColor Green
Write-Host "  Server:    $pgHost"
Write-Host "  Database:  $DatabaseName"
Write-Host "  Admin:     $AdminUser"
Write-Host "  Password:  $adminPasswordPlain"
Write-Host ""
Write-Host "Save the password to your password manager NOW. It will not be shown again." -ForegroundColor Yellow
Write-Host "Note: the password also appeared as a process argument; clear shell history if needed." -ForegroundColor Yellow
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Smoke test: curl https://`$(az webapp show -g $ResourceGroup -n $AppServiceName --query defaultHostName -o tsv)/api/health"
Write-Host "  2. If broken:  .\rollback.ps1"
Write-Host "  3. If green:   update apps/api/.env locally, then pause Supabase project"
Write-Host ""
