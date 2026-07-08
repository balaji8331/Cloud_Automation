# Azure Cost & Billing Portal

A self-hosted, multi-tenant Azure cost monitoring portal. Connects to multiple Azure tenants via service principals, shows unified billing dashboards, tracks resource inventory, and sends budget/anomaly alerts.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS |
| Backend | Next.js API Routes |
| Database | PostgreSQL via Prisma ORM |
| Charts | Recharts |
| Auth | NextAuth v4 — credentials + JWT, role-based |
| Azure | `@azure/identity` (ClientSecretCredential) |
| Cost API | Azure Cost Management Query API |
| Resource API | Azure Resource Graph API (ARM fallback) |
| Terminal | WebSocket + Node-PTY + xterm.js (Local process) |
| Email | Resend |
| Scheduling | node-cron (daily at 02:00 UTC) |
| Worker | Unified background worker (WebSockets, Cron, Job Queues) |

---

## Quick Start

### 1. Prerequisites

- Node.js 18+
- PostgreSQL database
- Azure service principals with **Cost Management Reader** role on each subscription

### 2. Clone and install

```bash
git clone <repo>
cd azure-cost-portal
npm install
```

### 3. Environment setup

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Description | How to get |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | Your Postgres instance |
| `NEXTAUTH_SECRET` | Random 32+ char string | `openssl rand -base64 32` |
| `SECRET_ENCRYPTION_KEY` | 64-char hex key (AES-256) | `openssl rand -hex 32` |
| `RESEND_API_KEY` | Email sending API key | [resend.com](https://resend.com) |
| `ALERT_FROM_EMAIL` | Sender email address | Your verified domain |
| `ALERT_TO_EMAIL` | Alert recipient email | Your finance/ops email |
| `DEFAULT_ANOMALY_THRESHOLD` | % spike that triggers anomaly alert | Default: `50` |

### 4. Database setup

```bash
# Create the database
sudo -u postgres psql -c "CREATE DATABASE azure_cost_portal;"
sudo -u postgres psql -d azure_cost_portal -c "GRANT ALL ON SCHEMA public TO <your_db_user>;"

# Run migrations
npm run db:migrate
# (type a migration name like "init" when prompted)

# Create the default admin user
npm run db:seed
# Default: admin@example.com / Admin1234!
```

### 5. Run

Start the Next.js dev server:
```bash
npm run dev
```

In a **separate terminal**, start the unified background worker (handles cron jobs, automation queues, and the Web Terminal WebSocket server):
```bash
npm run worker
```

Open [http://localhost:3000](http://localhost:3000) — redirects to login.

---

## Project Structure

```
azure-cost-portal/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/     NextAuth handler
│   │   ├── tenants/                Tenant CRUD + test-connection + sync
│   │   ├── dashboard/              Overview + drilldown data APIs
│   │   ├── budgets/                Budget CRUD
│   │   ├── resources/              Resource inventory + groups + sync
│   │   ├── reports/                CSV / PDF export
│   │   ├── users/                  User management
│   │   └── jobs/ingest/            Manual full-ingest trigger
│   ├── dashboard/                  Overview page (KPIs + charts)
│   ├── tenants/                    Tenant management (Admin)
│   ├── resources/                  Resource inventory browser
│   ├── budgets/                    Budget tracking + progress bars
│   ├── reports/                    Reports + export (Finance+)
│   └── users/                      User management (Admin)
├── lib/
│   ├── azure/
│   │   ├── auth.ts                 ClientSecretCredential token helper
│   │   ├── costManagement.ts       Cost Management Query API (with retry/backoff)
│   │   ├── budgets.ts              Azure Budgets API
│   │   └── resourceGraph.ts        Resource Graph API (ARM fallback)
│   ├── db/
│   │   ├── index.ts                Prisma singleton
│   │   ├── tenants.ts              Tenant CRUD + credential decryption
│   │   ├── costs.ts                Cost record queries
│   │   ├── budgets.ts              Budget queries + spend calculation
│   │   └── audit.ts                Audit log writer
│   ├── crypto/index.ts             AES-256 encrypt/decrypt for secrets
│   ├── email/index.ts              Resend email + HTML templates
│   ├── auth/
│   │   ├── config.ts               NextAuth config
│   │   └── guards.ts               requireRole() API guards
│   └── utils.ts                    formatCurrency, getDateRange, linearForecast
├── jobs/
│   ├── ingest.ts                   Per-tenant + all-tenants cost ingestion
│   ├── syncResources.ts            Resource inventory sync (upsert + stale marking)
│   ├── anomaly.ts                  Anomaly detection + email alerts
│   ├── budgetAlerts.ts             Budget threshold email alerts
│   └── scheduler.ts                node-cron daily schedule
├── components/
│   ├── ui/                         Button, Card, Badge, Input, Dialog, Progress, Toast, Select
│   ├── charts/                     CostTrendChart, TenantBreakdownChart, ServiceCostChart
│   ├── tables/                     TenantsTable, BudgetTable
│   └── layout/                     Sidebar, Header
└── prisma/
    ├── schema.prisma               Full DB schema
    └── seed.ts                     Admin user seed
```

---

## Database Schema

| Table | Purpose |
|---|---|
| `users` | Portal users with roles |
| `accounts` / `sessions` | NextAuth OAuth tables |
| `tenants` | Azure tenant configs (secrets AES-256 encrypted) |
| `subscriptions` | Per-tenant Azure subscription IDs |
| `cost_records` | Ingested daily cost data |
| `budgets` | Budget configs with alert thresholds |
| `resource_groups` | Azure resource groups per subscription |
| `resources` | Full Azure resource inventory with ARM metadata |
| `anomaly_configs` | Per-tenant or global spike % threshold |
| `email_alerts` | Alert send history (deduplication) |
| `audit_log` | Every billing/resource data access by user |

---

## Features

### Cost Dashboards
- Combined spend across all tenants with KPI cards
- Date range: Last 7d / 30d / 90d / 1m / 3m / 6m / 1y / **custom date picker**
- Cost trend area chart with 14-day linear forecast (labeled as estimate)
- Tenant breakdown — bar or pie chart toggle
- Top services — horizontal bar chart
- Drill-down: Tenant → Subscription → Resource Group → Service

### Resource Inventory
- Syncs all resources via Azure Resource Graph API
- Falls back to ARM REST API if Resource Graph access is unavailable
- Tree navigation: Tenant → Resource Group → Resource list
- Resource Group cards show type breakdown (e.g. "12 VMs, 4 Storage, 2 VNets") + MTD cost
- Resource table: Name, Type, Location, Provisioning State, MTD Cost, Tags
- Search by name/type/location, filter by resource type
- **Orphaned resource flag** — resources with no cost activity in 30+ days highlighted
- Stale resources (deleted in Azure) marked inactive, not hard-deleted

### Budget Tracking
- Budget configs with monthly/quarterly/annual grain
- Live spend % with color-coded progress bars (green/yellow/red)
- Email alert when spend crosses configured threshold (default 80%)

### Anomaly Detection
- Flags subscriptions where today's spend is X% above the 7-day trailing average
- Configurable threshold per tenant or globally
- Email alert with spike details, deduped per subscription per day

### Reports & Export
- Filter by tenant + date range (including custom)
- Export current view as **CSV** (server-side) or **PDF** (client-side via jsPDF)

### Access Control

| Feature | Super Admin | Admin | Finance | Read-only |
|---|---|---|---|---|
| View dashboards | ✅ | ✅ | ✅ | ✅ |
| View resources | ✅ | ✅ | ✅ | ✅ |
| View budgets | ✅ | ✅ | ✅ | ✅ |
| Export CSV/PDF | ✅ | ✅ | ✅ | ❌ |
| Trigger syncs | ✅ | ✅ | ❌ | ❌ |
| Manage tenants | ✅ | ✅ | ❌ | ❌ |
| Manage users | ✅ | ✅ | ❌ | ❌ |
| Manage budgets | ✅ | ✅ | ❌ | ❌ |
| Web Terminal | ✅ | ❌ | ❌ | ❌ |

Every data access is logged to the `audit_log` table (user, action, timestamp).
The `SUPER_ADMIN` role cannot be assigned directly on user creation; it must be explicitly granted by an existing Super Admin via the UI.

---

## Adding an Azure Tenant

1. Go to **Tenants** page (Admin only)
2. Click **Add Tenant**
3. Fill in: Tenant Name, Azure Tenant ID, Client ID, Client Secret, Subscription IDs

### Creating the service principal

```bash
# Create app registration
az ad sp create-for-rbac --name "cost-portal-sp" --role "Cost Management Reader" \
  --scopes /subscriptions/<subscription-id>
```

This outputs `appId` (Client ID), `password` (Client Secret), `tenant` (Tenant ID).

### Assigning roles in the portal

1. Azure Portal → **Subscriptions** → your subscription
2. **Access control (IAM)** → **Add role assignment**
3. Role: **Cost Management Reader**
4. Assign to: your app registration

For Resource Graph access (optional, improves resource sync speed):

```bash
az role assignment create \
  --assignee <client-id> \
  --role "Reader" \
  --scope /subscriptions/<subscription-id>
```

### Test + Sync

- Click **Test** — verifies auth and Cost Management API access
- Click **Sync** — pulls last 7 days of cost data (retries on 429 rate limits)
- Click **Resources** — syncs full resource inventory

---

## Scheduled Jobs & Automation

The unified worker (`npm run worker`) processes several background tasks:

1. **Daily Cron (02:00 UTC)**:
   - Cost ingestion — last 30 days for all connected tenants
   - Budget threshold alerts
   - Anomaly detection
   - Resource inventory sync
2. **Automation Queue**:
   - Polling checks for pending resource tasks (e.g. orphan cleanup).
3. **Web Terminal Server**:
   - Hosts a secure WebSocket server on port 3001 for live Super Admin interactive shells.

Manual triggers available via UI buttons on the Tenants page.

---

## Swapping Secrets to Azure Key Vault

All secret encryption/decryption goes through `lib/crypto/index.ts`. Replace the two exported functions (`encrypt` / `decrypt`) with Azure Key Vault calls — no other code changes needed.

---

## Email Alerts

Powered by [Resend](https://resend.com). Set `RESEND_API_KEY` and `ALERT_FROM_EMAIL` in `.env`.

To switch to SMTP, replace the `sendEmail()` function body in `lib/email/index.ts` — callers are unchanged.

---

## npm Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run worker` | Start background worker (cron, WebSockets, queues) |
| `npm run build` | Production build |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:push` | Push schema without migration history |
| `npm run db:seed` | Create default admin user |
| `npm run db:studio` | Open Prisma Studio (DB browser) |
| `npm run db:generate` | Regenerate Prisma client |
