# NetMon Dashboard

A cloud-hosted (Azure) dashboard for [**NetMon**](https://github.com/adoty-sbcss/net_mon),
the plug-in network collector. District staff sign in with Google or Microsoft and
see their own network: districts → schools → IDFs/switches, host inventory, DHCP
health, spanning-tree events, DNS health, findings, and interactive network maps.
Superadmins additionally get admin consoles for ingestion, data cleanup, and users.

This app is the **reader/presenter + control plane**. It does **not** probe any
network — the NetMon collectors do that on-prem and ship hourly ZIP bundles to an
SFTP drop; this app pulls and ingests them. There is **no inbound connectivity to
the sensors**.

```
 NetMon sensor (on-prem)  ──hourly ZIP──►  SFTP drop  ──pull──►  NetMon Dashboard (Azure)
   arp / nmap / LLDP / SNMP                                       ingest → Postgres → UI
   tshark (DHCP/STP) / DNS                                        Google/Microsoft sign-in
```

---

## What you get

**Network visibility (per school)**
- **Host inventory** — IP, hostname, MAC, **manufacturer** (full IEEE OUI registry,
  ~39k vendors), **device type** (printer / phone / computer / AP / camera / switch /
  …), switch port, last seen. Filter by type; click into a host.
  - Device type & manufacturer are derived automatically from OUI + **DHCP
    fingerprint** (option 60/55) + SNMP + hostname — endpoints that never speak SNMP
    still get named and classified. Randomized/private MACs are labeled as such.
- **DHCP** — consolidated by scope (subnet): servers, lease counts, and an
  **issues** panel (NAKs, no-offer clients, multiple servers on a scope), plus a
  per-client lease story (DISCOVER → OFFER → REQUEST → ACK).
- **STP** — spanning-tree BPDU events, topology-change count, multiple-root-bridge
  warning.
- **DNS health** — per-resolver reachability, latency, NXDOMAIN-rewrite detection.
- **Switches** — LLDP/CDP-discovered, SNMP attributes, neighbor sightings.
- **Network maps** — interactive physical (LLDP/CDP) and logical (subnet/gateway)
  topology with device icons, hover details, click-through to a device, and
  drag-to-arrange with a Save button (superadmin).

**Admin (superadmin)**
- **SFTP ingestion** (`/settings/ingestion`) — connection settings (secrets
  encrypted at rest), Test connection, Sync now, and a scheduled-pull toggle with a
  cadence (hourly / 6h / 12h / daily).
- **Data management** (`/settings/data`) — rename districts/schools/IDFs (slug stays
  the mapping key, so incoming data keeps landing automatically), delete with cascade,
  and purge collected scans by date range per sensor.
- **Users** (`/settings/users`) — grant access by email and district; see below.

---

## Access model

- **Sign-in:** Google or Microsoft (OIDC). Whoever proves a listed email — via
  *either* provider — is let in. There is also a local **break-glass admin**
  (`adaministrator`) for bootstrap/emergency.
- **Authorization:** every user has a role + **grants**.
  - `superadmin` → sees everything + the admin consoles.
  - `user` → sees only the **districts** they're granted.
- **Rule:** authority is assigned per-email by an admin. **Authority is never
  derived from email domain** (the shared `@sbcss.net` domain is not a free pass).

Add a user on **Users → Add a user**: enter their email, pick a role, and (for a
regular user) check the districts they may see. They can then sign in with Google or
Microsoft using that email.

---

## Stack

- **Web:** Next.js 16 (App Router, TypeScript, standalone output) on **Azure
  Container Apps** (scale-to-zero)
- **Ingestion / migrations:** Azure Container Apps **Jobs** (cron + manual)
- **DB:** Azure Database for **PostgreSQL** Flexible Server (private VNet), Drizzle ORM
- **Secrets:** **Key Vault** + Managed Identity (no stored cloud creds)
- **Registry/CI:** **ACR** + GitHub Actions (OIDC federation; push → build → roll)
- **IaC:** Bicep

Full design + data model: [`docs/DESIGN.md`](docs/DESIGN.md).
Full deploy runbook: [`docs/DEPLOY.md`](docs/DEPLOY.md).

---

## Local development

```bash
npm install
cp .env.example .env.local        # set DATABASE_URL + AUTH_SECRET (see comments)
npm run db:migrate                # apply migrations to your local Postgres
npm run auth:seed                 # create the break-glass admin
npm run dev                       # http://localhost:3000
```

Useful scripts:

| Script | What |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev / production build / serve |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run auth:seed` | Create/update the break-glass admin |
| `npm run enrich` | Backfill manufacturer + device-type + DHCP hostnames |
| `npm run ingest:sync` | Pull new SFTP bundles and ingest (respects the schedule) |

---

## Deploy to Azure (summary)

The authoritative, step-by-step runbook is [`docs/DEPLOY.md`](docs/DEPLOY.md). In short:

1. **Provision** the stack from Bicep (RG-scoped). Supply `postgresAdminPassword`
   and `authSecret` as secure params:
   ```bash
   az deployment group create -g <RG> -f infra/main.bicep \
     -p postgresAdminPassword=<pw> authSecret=<64-hex> assignRoles=true
   ```
2. **Build the images** in ACR (server-side; no local Docker):
   ```bash
   az acr build -r <ACR> -t netmon-dashboard:latest .                              # web (last stage)
   az acr build -r <ACR> -t netmon-dashboard-migrator:latest --target migrator .   # migrate + seed + enrich
   az acr build -r <ACR> -t netmon-dashboard-ingest:latest   --target ingest   .   # SFTP sync (cron)
   ```
3. **Migrate** (also seeds the admin and backfills enrichment):
   ```bash
   az containerapp job start -g <RG> -n <migrate-job>
   ```
4. **Roll the web app / deploy** so it picks up `:latest`.
5. **Sign in** as `adaministrator`, then configure **SFTP ingestion** and add **users**.

CI/CD: pushing to `main` triggers GitHub Actions, which builds the **web** image
and rolls the app (via Azure OIDC federation). Migrator/ingest images are built
manually when their code or a migration changes.

> **Why three images?** They share one multi-stage `Dockerfile`. The **runner**
> (web) stage MUST be last — `az acr build` with no `--target` builds the final
> stage. The `migrator` and `ingest` stages are built with `--target`.

---

## Enabling Google / Microsoft sign-in (OIDC)

Sign-in buttons appear automatically once a provider's env vars are present on the
web app. Set the redirect/callback URIs to:

```
https://<your-app-host>/api/auth/oidc/google/callback
https://<your-app-host>/api/auth/oidc/microsoft/callback
```

**Microsoft (Entra ID):** register an app → Web platform → add the callback URI →
create a client secret → note the **Application (client) ID**, **secret**, and
**Directory (tenant) ID**.

**Google:** Cloud Console → OAuth client (Web application) → add the callback URI →
note the **Client ID** and **secret**.

Then set these on the web Container App (store secrets in Key Vault and reference
them; `APP_ORIGIN` pins the redirect base so it never drifts):

```
APP_ORIGIN=https://<your-app-host>
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...                       # Key Vault secret ref
AUTH_MICROSOFT_ENTRA_ID_ID=...
AUTH_MICROSOFT_ENTRA_ID_SECRET=...           # Key Vault secret ref
AUTH_MICROSOFT_ENTRA_ID_TENANT=<tenant-id>   # or "common"
```

See [`docs/DEPLOY.md`](docs/DEPLOY.md) for the exact `az` commands. Until these are
set, the local break-glass login still works.

---

## Security notes

- Secrets live in **Key Vault**, pulled via **Managed Identity** — no cloud
  credentials in the repo or images.
- SFTP credentials are stored **AES-256-GCM encrypted at rest** (keyed off
  `AUTH_SECRET`), editable from the admin UI.
- The Postgres password, `.env*`, and any private credentials file are **never**
  committed. This repo is public — no secrets or tenant IDs in tracked files.
- Sessions are signed (HMAC) httpOnly cookies; OAuth uses a state cookie for CSRF
  and trusts the id_token over the TLS back-channel.
