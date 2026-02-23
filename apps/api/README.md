# Ticketing API (NestJS)

Backend service for the unified ticketing system.

## Stack
- NestJS 11
- Prisma + PostgreSQL
- Redis/BullMQ (notifications + automation jobs)

## Local setup
1. Install dependencies from repo root:
```bash
npm install
```
2. Create environment file:
```bash
copy .env.example .env
```
3. Apply migrations and seed:
```bash
npm run db:migrate
npm run db:seed
```
4. Run API:
```bash
npm run dev
```

API base URL: `http://localhost:3000/api`

## Useful scripts
- `npm run build`
- `npm run lint`
- `npm run format`
- `npm run test:integration`
- `npm run test:db:reset`
- `npm run db:migrate`
- `npm run db:migrate:dev`
- `npm run db:seed`

## Test environment
- Integration tests read `apps/api/.env.test`.
- Database reset is strict by default with `prisma migrate reset`.
- Override strategy only when needed:
  - `TEST_DB_RESET_STRATEGY=migrate` (default)
  - `TEST_DB_RESET_STRATEGY=push` (fallback/debug only)

## Attachment security behavior
- New attachments are stored with `scanStatus=PENDING`.
- Download is allowed only when `scanStatus=CLEAN`.
- `PENDING`, `INFECTED`, and `FAILED` attachments are blocked from download.
- Scanner callback endpoint:
  - `POST /api/attachments/:id/scan-status`
  - Header: `x-attachment-scan-secret: <ATTACHMENT_SCAN_WEBHOOK_SECRET>`

## Inbound email ingestion
- Webhook endpoint:
  - `POST /api/tickets/inbound-email`
  - Header: `x-inbound-email-secret: <INBOUND_EMAIL_WEBHOOK_SECRET>`
- Payload contract requires `messageId` for replay-safe deduplication.
- When a ticket display ID is present in subject, replies are threaded and closed/resolved tickets are reopened.

## Idempotency
- Mutating endpoints support `Idempotency-Key`.
- Reusing the same key + payload replays the original response.
- Reusing the same key with a different payload returns `409 Conflict`.
