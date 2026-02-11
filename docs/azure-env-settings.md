# Azure App Service – Environment variables (.env)

Set these in **Azure Portal** → your **Web App** → **Configuration** → **Application settings** (or via Azure CLI). Names are case-sensitive.

---

## Required (API must have these)

| Name | Example value | Notes |
|------|----------------|-------|
| **DATABASE_URL** | `postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require` | PostgreSQL connection string (Azure Database for PostgreSQL). Use your server host, user, and password. |
| **DIRECT_URL** | Same as `DATABASE_URL` | Used by Prisma for migrations. Same value unless you use a connection pooler (e.g. PgBouncer) with a different URL. |
| **PORT** | `8080` | Azure injects `PORT`; Node apps usually use `8080` on App Service. Your code uses `process.env.PORT ?? 3000`. |
| **NODE_ENV** | `production` | So the app runs in production mode. |
| **CORS_ORIGIN** | `https://your-app-name.azurewebsites.net` | Allowed origin for API requests. Use your App Service URL (or `*` only for quick tests). |
| **WEB_APP_URL** | `https://your-app-name.azurewebsites.net` | Base URL of the frontend; used for links in emails and notifications. |

---

## Optional but recommended

| Name | Example value | Notes |
|------|----------------|-------|
| **ATTACHMENTS_DIR** | `uploads` | Directory for uploaded files. Default `uploads`. On App Service, consider Azure Blob or a persistent volume if you need files to survive restarts. |
| **ATTACHMENTS_MAX_MB** | `10` | Max attachment size in MB. Default `10`. |

---

## Optional – Notifications / queue (Redis)

If you **don’t** use Redis for notifications/queue, set:

| Name | Value |
|------|--------|
| **NOTIFICATIONS_QUEUE_ENABLED** | `false` |

If you **do** use Redis (e.g. Azure Cache for Redis):

| Name | Example value |
|------|----------------|
| **NOTIFICATIONS_QUEUE_ENABLED** | `true` |
| **REDIS_URL** | `redis://:PASSWORD@HOST:6380?tls=true` (Azure Cache for Redis) |
| or **REDIS_HOST** | Your Redis host |
| **REDIS_PORT** | `6379` or `6380` (TLS) |
| **REDIS_PASSWORD** | Redis access key (if required) |

---

## Optional – Email (SMTP)

Only if the app sends email (notifications, etc.):

| Name | Example value |
|------|----------------|
| **SMTP_HOST** | e.g. `smtp.office365.com` |
| **SMTP_PORT** | `587` |
| **SMTP_USER** | SMTP username |
| **SMTP_PASS** | SMTP password |
| **SMTP_SECURE** | `false` or `true` (TLS) |
| **SMTP_FROM** | e.g. `no-reply@yourdomain.com` |

---

## Optional – SLA workers

If you run SLA breach / at-risk workers on the same App Service:

| Name | Example value |
|------|----------------|
| **SLA_BREACH_WORKER_ENABLED** | `true` |
| **SLA_BREACH_INTERVAL_MS** | `60000` |
| **SLA_AT_RISK_ENABLED** | `true` |
| **SLA_AT_RISK_THRESHOLD_MINUTES** | `120` |
| **WEB_APP_URL** | (same as above; used in links) |

Leave unset or `false` if you don’t run these workers.

---

## Optional – Azure AD / M365

Only if you use Azure AD (Entra) SSO or Microsoft 365 integration:

| Name |
|------|
| **AZURE_TENANT_ID**, **AZURE_CLIENT_ID**, **AZURE_CLIENT_SECRET** |
| **M365_TENANT_ID**, **M365_CLIENT_ID**, **M365_CLIENT_SECRET**, **M365_INBOUND_WEBHOOK_SECRET** |

---

## Minimal set for a simple deploy

For a basic deploy (API only, no Redis, no email, no SSO):

```
DATABASE_URL     = postgresql://USER:PASSWORD@YOUR-PG-SERVER.postgres.database.azure.com:5432/postgres?sslmode=require
DIRECT_URL       = (same as DATABASE_URL)
PORT             = 8080
NODE_ENV         = production
CORS_ORIGIN      = https://YOUR-APP-NAME.azurewebsites.net
WEB_APP_URL      = https://YOUR-APP-NAME.azurewebsites.net
NOTIFICATIONS_QUEUE_ENABLED = false
```

Replace `YOUR-APP-NAME` and the PostgreSQL placeholders with your real values.

---

## Web app (frontend) – VITE_API_BASE_URL

The **web** app uses **VITE_API_BASE_URL** (e.g. in `apps/web/.env`). That value is **baked in at build time** by Vite, not read at runtime.

- **Single app (API serves SPA):** Build the web app with the API on the same origin, e.g.  
  `VITE_API_BASE_URL=/api`  
  so the frontend calls the same host (e.g. `https://your-app.azurewebsites.net/api`).
- **Two apps (API and web separate):** Build with your API URL, e.g.  
  `VITE_API_BASE_URL=https://your-api.azurewebsites.net/api`

You do **not** set `VITE_API_BASE_URL` in Azure App Service for the **API**; you set it in the **web** project’s env when you run `npm run build -w apps/web`, or in your build pipeline.
