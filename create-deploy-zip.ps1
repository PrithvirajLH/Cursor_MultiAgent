# Create deployment ZIP for Codex Ticketing System
# Run from repo root: .\create-deploy-zip.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$deployDir = Join-Path $root "deploy"
$zipName = "Codex_Ticketing_System_deploy.zip"
$zipPath = Join-Path $root $zipName

Write-Host "Building API..." -ForegroundColor Cyan
Set-Location $root
& npm run build -w apps/api 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "API build failed." }

Write-Host "Building Web..." -ForegroundColor Cyan
& npm run build -w apps/web
if ($LASTEXITCODE -ne 0) { throw "Web build failed. Fix errors above and run the script again." }

Write-Host "Preparing deploy folder..." -ForegroundColor Cyan
if (Test-Path $deployDir) { Remove-Item $deployDir -Recurse -Force }
New-Item -ItemType Directory -Path $deployDir | Out-Null

# API (App Service root: dist, prisma, package.json)
Copy-Item -Path (Join-Path $root "apps\api\dist") -Destination (Join-Path $deployDir "dist") -Recurse
Copy-Item -Path (Join-Path $root "apps\api\prisma") -Destination (Join-Path $deployDir "prisma") -Recurse
Copy-Item -Path (Join-Path $root "apps\api\package.json") -Destination $deployDir
if (Test-Path (Join-Path $root "apps\api\package-lock.json")) {
  Copy-Item -Path (Join-Path $root "apps\api\package-lock.json") -Destination $deployDir -ErrorAction SilentlyContinue
}
Copy-Item -Path (Join-Path $root "apps\api\.env.example") -Destination (Join-Path $deployDir ".env.example") -ErrorAction SilentlyContinue

# Install production dependencies and generate Prisma client so the zip is self-contained (Azure zip deploy does not run npm install).
Write-Host "Installing production dependencies in deploy folder..." -ForegroundColor Cyan
Push-Location $deployDir
try {
  & npm install --omit=dev 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  Write-Host "Generating Prisma client..." -ForegroundColor Cyan
  & npx prisma generate 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "prisma generate failed." }
} finally {
  Pop-Location
}

# Web app build: copy to "public" so the API serves the SPA from the same URL (single-app deploy).
$webDist = Join-Path $root "apps\web\dist"
if (Test-Path $webDist) {
  New-Item -ItemType Directory -Path (Join-Path $deployDir "public") -Force | Out-Null
  Copy-Item -Path "$webDist\*" -Destination (Join-Path $deployDir "public") -Recurse
  Write-Host "Included frontend in zip (API will serve from /)." -ForegroundColor Green
}

# Deploy instructions
$readme = @"
CODEX TICKETING SYSTEM - DEPLOY PACKAGE
========================================

API (Node.js) - This zip includes node_modules and a generated Prisma client.
-------------
1. Set environment variables (see .env.example). Required: DATABASE_URL, DIRECT_URL, PORT, NODE_ENV, CORS_ORIGIN, WEB_APP_URL.
2. If you deploy from source (e.g. git) instead of this zip: run "npm install --omit=dev", then "npx prisma generate", then "npx prisma migrate deploy". Prisma is a production dependency so install includes the CLI.
3. Run migrations (once): from your machine against production DB, or set startup to: npx prisma migrate deploy && node dist/src/main.js
4. Start: node dist/src/main.js  (or npm start)

Startup command (e.g. Azure): node dist/src/main.js  (or npm start)
With migrations on each start: npx prisma migrate deploy && node dist/src/main.js

Web app (single-app)
--------------------
The 'public' folder contains the built SPA. The API serves it from the same origin (GET / shows the app; /api/* is the API). Build the web app with VITE_API_BASE_URL=/api so it calls the same host.

Docs: see repo docs/azure-app-service-setup.md and docs/azure-env-settings.md
"@
Set-Content -Path (Join-Path $deployDir "README-DEPLOY.txt") -Value $readme -Encoding UTF8

Write-Host "Creating ZIP: $zipName" -ForegroundColor Cyan
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $deployDir "*") -DestinationPath $zipPath -Force

Remove-Item $deployDir -Recurse -Force
Write-Host "Done. Deployment package: $zipPath" -ForegroundColor Green
