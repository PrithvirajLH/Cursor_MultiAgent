# Unified Ticketing System

Enterprise ticketing platform for multi-department operations (IT, HR, AI, Medicaid Pending, White Gloves). This repo ships a NestJS API and a modern React UI that can scale into a production-grade workflow.

## Stack
- API: NestJS + Prisma + Postgres
- Web: React (Vite) + TypeScript
- Infra: Docker (Postgres + Redis)

## Quick start
1) Install dependencies
```
npm install
```

2) Start local infrastructure
```
docker compose up -d
```

3) Configure API environment
```
copy apps\api\.env.example apps\api\.env
```
If you’re using Supabase, update `DATABASE_URL` and `DIRECT_URL` in `apps\api\.env` with your project connection strings.

Optional: configure the web app API base URL
```
copy apps\web\.env.example apps\web\.env
```
Edit `apps\web\.env` to set `VITE_DEMO_USER_EMAIL` to a seeded user if you want the UI to hit the API directly.

4) Create schema + seed sample data
```
npm run db:migrate -w apps/api
npm run db:seed -w apps/api
```

5) Run the full stack
```
npm run dev
```

- API: http://localhost:3000/api
- API health: http://localhost:3000/api/health
- Web: http://localhost:5173

## Tests
Reset and seed the test database:
```
npm run test:db:reset
```

Run API integration tests:
```
npm test
```

Run end-to-end tests:
```
npm run e2e
```

Test DB config lives in `apps\api\.env.test`. Update it to your Supabase test database connection string (use a dedicated test project).

## Auth modes
Protected API routes accept:
- `Authorization: Bearer <token>` (preferred; Azure AD/Entra or HS256 depending on env)
- Dev/test fallback headers when `AUTH_ALLOW_INSECURE_HEADERS=true`:
  - `x-user-id: <user-id>`
  - `x-user-email: <user-email>`

Seeded users (from `apps/api/prisma/seed.ts`) include:
- `jane.doe@company.com` (Employee)
- `alex.park@company.com` (Agent)
- `maria.chen@company.com` (Lead)
- `sam.rivera@company.com` (Team Admin)
- `olivia.king@company.com` (Owner)

## API reliability and attachment scanning
- Mutating endpoints (`POST`/`PATCH`/`PUT`/`DELETE`) support `Idempotency-Key` for safe retries.
- Attachment downloads are blocked unless `scanStatus=CLEAN`.
- Scanner integrations can update status through:
  - `POST /api/attachments/:id/scan-status`
  - Header: `x-attachment-scan-secret: <ATTACHMENT_SCAN_WEBHOOK_SECRET>`
- Inbound email integrations can ingest and thread messages through:
  - `POST /api/tickets/inbound-email`
  - Header: `x-inbound-email-secret: <INBOUND_EMAIL_WEBHOOK_SECRET>`
  - Payload must include a unique `messageId` for replay-safe deduplication.

## Next steps
- Wire Azure AD (Entra ID) SSO
- Add provider-specific inbound adapters (Microsoft Graph/Gmail) on top of the webhook contract
- Implement SLA engine + routing rules UI
- Add audit log viewer + compliance retention policies
