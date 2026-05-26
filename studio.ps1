<#
.SYNOPSIS
  Launch Prisma Studio against the Azure Postgres database.

.DESCRIPTION
  Reads the admin password from .azure-pg-password (gitignored), builds the
  connection string, and starts Prisma Studio on http://localhost:5555.

  Run from the repo root:  .\studio.ps1

  Press Ctrl+C in the terminal to exit. Env vars are cleared on exit.
#>

[CmdletBinding()]
param(
  [string] $PasswordFile = ".azure-pg-password",
  [string] $Host_       = "csh-ticketing-db.postgres.database.azure.com",
  [string] $Database    = "ticketing",
  [string] $User        = "pgadmin",
  [int]    $Port        = 5555
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Test-Path "apps/api/prisma/schema.prisma")) {
  throw "Run from the repo root (where apps/api exists)."
}
if (-not (Test-Path $PasswordFile)) {
  throw "Password file not found: $PasswordFile. Run migrate-to-azure-postgres.ps1 first or restore the file from your password manager."
}

$adminPwd = (Get-Content $PasswordFile -Raw).Trim()
$encUser  = [uri]::EscapeDataString($User)
$encPwd   = [uri]::EscapeDataString($adminPwd)
$url      = "postgresql://${encUser}:${encPwd}@${Host_}:5432/${Database}?sslmode=require"

Write-Host "Starting Prisma Studio against $Host_/$Database on http://localhost:$Port" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to exit." -ForegroundColor Yellow
Write-Host ""

Push-Location apps/api
try {
  $env:DATABASE_URL = $url
  $env:DIRECT_URL   = $url
  npx prisma studio --port $Port
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:DIRECT_URL   -ErrorAction SilentlyContinue
  Pop-Location
}
