# NetMon Dashboard — Design

**Status:** Design locked, pre-implementation. Azure not yet provisioned.
**Last updated:** 2026-05-29

---

## 1. Purpose

A cloud-hosted, public (but authenticated) web application that gives school
district staff self-service visibility into the network data collected by their
on-prem **NetMon** sensors, and gives SBCSS top-level admins a **central
management console** for the whole sensor fleet.

This app is the **reader/presenter + control plane** for NetMon. It does **not**
collect network data itself — the NetMon collectors do that. This app consumes
their output and (later) manages their configuration.

Companion repo: the collector lives at `github.com/adoty-sbcss/net_mon`.

### Two faces of the app
1. **District dashboard** — district users log in and see *their own* network:
   drill-down (district → school → IDF/switch), physical + logical network maps,
   findings, and (later) AI health analysis.
2. **Management console** — SBCSS super-admins manage the sensor fleet: push
   config, request log collection, run commands — all without inbound
   connectivity to the sensors.

---

## 2. Relationship to NetMon (the collector)

NetMon today:
- Writes scan data to a local Postgres (`scan_runs`, `devices`, `neighbors`,
  `arp_entries`, `dhcp_observations`, `stp_events`, `traffic_stats`,
  `snmp_polls`, `findings`).
- Builds hourly ZIP **bundles** and **pushes** them outbound over **SFTP** into a
  hierarchical path: `<base>/<district>/<school>/<device>/<device>_YYYY_MM_DD_HH.zip`.
- Each bundle contains: `summary.md`, `findings.json`, `topology.json`
  (nodes/edges), `devices.csv`, `metrics.json`, `timeline.json`, and `raw/*.json`.
- Every `scan_run` carries `district_slug`, `school_slug`, `device_slug` — these
  are the navigation + permission keys for this app.

**Design rule:** this app is read-only over NetMon's bundle output. Never
duplicate collection logic. The only write-path back to sensors is the
management plane (Section 8), which is additive collector work.

---

## 3. Architecture (Azure)

- **IaC:** Bicep. **Environment:** prod-only to start. **Region:** US (e.g. West US 2),
  all data kept in-region.
- **Web app:** Next.js (App Router, TypeScript) container on **Azure Container
  Apps**, **scale-to-zero** (cold-start at login accepted).
- **Ingestion / map-build:** **Azure Container Apps Job** on a nightly cron.
  Spins up, does one SFTP pull → parse → upsert → rebuild entities/topology,
  then exits. Pay-per-run.
- **Database:** Azure Database for **PostgreSQL Flexible Server, Burstable B1ms**,
  **private** (VNet / private endpoint — not public + firewall).
- **Object storage:** **Azure Blob** for raw ZIPs (short-lived) and exports.
- **Email:** **Azure Communication Services (Email)** for MFA codes (and future
  alerts).
- **Secrets:** **Azure Key Vault**; the web app and job authenticate to Blob /
  DB / Vault via **Managed Identity** — no stored cloud credentials.
- **CI/CD:** GitHub Actions (private repo) builds the container → pushes to
  **Azure Container Registry (ACR)** → deploys, authenticating via
  **GitHub → Azure OIDC federation** (no long-lived secrets in GitHub).

```
 NetMon sensors ──(outbound SFTP push, existing)──▶  SFTP endpoint
                                                          │
                                       nightly pull (one session, all-unseen)
                                                          ▼
   Container Apps Job ──parse──▶ Postgres (hot, 30d) + Blob (raw) + entities/topology
                                                          │
   District users ──OIDC──▶ Next.js web (Container Apps, scale-to-zero) ──reads──┘
   SBCSS admins  ──────────▶ Management console ──desired-state/commands──▶ (sensors poll)
```

---

## 4. Data ingestion

- **Cadence:** nightly cron Job to start. Data is intentionally ~1 day behind —
  this app is for analysis, not real-time ops.
- **What it pulls:** **everything not yet ingested** (NOT scoped to "today's
  files"). This naturally picks up boxes that were offline and backfilled, and
  sidesteps per-box timezone ambiguity in the `_YYYY_MM_DD_HH` filenames.
- **One SFTP session per run.** Open once, list the `district/school/device`
  tree once, download only new files, close. Idempotency via an
  `ingested_bundles` table keyed by unique filename (mirrors NetMon's own
  `bundle_uploads` pattern).
- **Decoupled parse.** SFTP pull and parsing are separate stages. A parse failure
  never costs another SFTP hit, and re-parsing from Blob is free.
- **Door left open for near-real-time:** cadence is a config knob. Moving to
  hourly, or to a Blob-event / webhook trigger, is a trigger change — not a
  rearchitecture. Keep the pull idempotent and the parse stage independent.

> Confirm what the SFTP endpoint actually is. If it's Azure Blob's SFTP, the
> dominant cost is the always-on "SFTP enabled" hourly fee; per-pull list/get
> ops are cheap, so cadence barely affects cost.

### 4a. Bundle format (validated against a real sample)

Verified against `northidf_2026_05_28_15.zip` (hourly rollup, 2 scans):
```
HOURLY_SUMMARY.md
README.md
scans/scan_<id>/
  summary.md  findings.json  metrics.json  timeline.json  topology.json  devices.csv
  raw/  scan.json  lldp-neighbors.json  arp-table.json  dhcp-observed.json
        stp-events.json  traffic-stats.json  snmp-polls.json
```
- **Bundles are self-identifying.** `raw/scan.json` carries `district_slug`,
  `school_slug`, `device_slug` (+ gateway/cidr/is_primary). Ingestion derives
  tenancy from the bundle, NOT the SFTP path — so a manually dropped ZIP ingests
  correctly with no path context. On ingest, upsert the district → school →
  sensor rows from these slugs.
- Field shapes match `schema/netmon.ts` exactly.
- **SNMP is large (~4,471 rows / ~1 MB per scan) and mostly noise.** See §5.
- `findings.json` may be empty; DHCP is often sparse (INFORM-only).

### 4b. Data-source configuration (in-app)

The SFTP connection is **configured in the deployed app by a superadmin**, not
hard-coded:
- A `data_sources` table holds host / port / username / base path; the password
  / key is stored in **Key Vault** (the table holds only a secret reference).
- Superadmin Settings UI to edit + **"Test connection"** (one-shot list).
- A **manual upload path** ("drop a ZIP") for testing and backfill, which runs
  the exact same parse pipeline as the SFTP pull. This is how we validate
  ingestion locally before any SFTP/Azure wiring exists.

---

## 5. Data model

Two layers, deliberately separated so the maps survive data aging (Section 7).

### 5a. Time-series (hot, expires at 30 days)
Mirrors NetMon's read-relevant tables, keyed by `district/school/device` slugs +
ingest timestamp:
- `scan_runs`, `devices`, `neighbors`, `traffic_stats`, `snmp_polls`,
  `dhcp_observations`, `stp_events`, `findings`.

**SNMP ingestion is curated, not bulk** (decision 2026-05-29). Raw SNMP is
~4,471 rows/scan and mostly redundant, so the parser extracts only the useful
subset — switch identity (model/name/firmware) into `entities_switch.attributes`,
and a small set of curated `snmp_polls` rows — rather than the full firehose.
The complete raw SNMP always remains in the Blob ZIP, so **additional fields can
be back-extracted later without re-pulling SFTP** (there is probably more in
there worth surfacing in the UI; the curated set will grow). A future
`switch_ports` table is the natural home if port/FDB data is brought in.

### 5b. Canonical entities (current-state, kept long-term)
Built at ingestion time by deduplicating across bundles and scans:
- `entities_switch` — deduped on `chassis_id`. Current state of each switch.
- `entities_host` — deduped on `mac`. Current state of each device.
- `topology_physical` — latest stitched physical graph (nodes/edges) per scope.
- `topology_logical` — latest VLAN / gateway / subnet graph per scope.
- `health_rollup_daily` — small per-district/school daily metrics summary
  (broadcast %, error/drop rates, device counts, finding counts).

### 5c. App-owned tables (as built — `schema/app.ts` + `schema/management.ts`)
- `districts(id, slug, name)` — first-class tenant rows.
- `schools(id, district_id, slug, name)`.
- `sensors(id, school_id, slug, name, last_checkin_at, reported_config_version,
  agent_version)` — the NetMon box at an IDF; navigation leaf AND management target.
- `users(id, email, role, is_break_glass, password_hash?, disabled, …)`.
- `grants(user_id, scope_type, scope_id)` — scope_type ∈ {global, district,
  school, sensor}; scope_id null for global.
- `break_glass_mfa_emails(email)` — recipients of the break-glass login code.
- `ingested_bundles(filename UNIQUE, slugs, blob_path, parse_status, …)`.
- `audit_log(actor_type, actor, action, target, detail, at)`.
- `data_sources(...)` — **TODO (M2):** SFTP host/port/user/base path + Key Vault
  secret reference; superadmin-editable (§4b).
- **Management-plane** (§8): `desired_config`, `command_queue`,
  `command_results`, `sensor_enrollments`.

---

## 6. Auth & permissions

### Identity
- **OIDC** via **Microsoft** and **Google**. Plus a **break-glass local admin**
  (non-federated) for first-admin bootstrap and emergency access:
  - Password hashed (argon2/bcrypt), seeded once on first boot.
  - **Email-code MFA** sent to multiple configured addresses (keep the list
    tight — any of those inboxes can complete login).
  - Rate-limited login, every action audit-logged, clearly marked non-federated,
    not a daily driver.

### Authorization (the critical rule)
- On login, trust the **IdP-verified email claim** — never a user-typed value.
- Match the email to the app's `users` table; load `grants`; filter every query.
  No grant = no data.
- **Roles are assigned explicitly per email — NEVER derived from email domain.**
  SBCSS is itself a district, and SBCSS district users share the `@sbcss.net`
  domain with top-level super-admins. Domain-matching would wrongly promote
  every SBCSS viewer to global admin.
- **Super-admin** = global / wildcard scope (sees all districts, runs the
  management console). **District user** = grant scoped to one district
  (room to narrow to school/switch later).
- Onboarding is **admin-invite only** (no self-signup).

---

## 7. Network maps

Two views, both built at ingestion time and served read-only (no always-on graph
compute):

- **Physical map** — from LLDP/CDP neighbor data (`neighbors`: `local_port`,
  `port_id`, `chassis_id`, `system_name`). Switch-to-switch and device-to-switch
  links. *Accuracy is bounded by LLDP/CDP coverage* — unmanaged switches/APs
  that don't speak LLDP will float or be missing. Set that expectation in the UI.
- **Logical map** — VLANs, gateways, subnets from `neighbors.vlan_id`,
  `dhcp_observations`, and `scan_runs.gateway_ip` / `interface_cidr`.
  VLAN-to-VLAN routing is partly inferred.

**Stitching (the hard part):** "one complete map" requires merging the same
entity seen by multiple sensors and across nightly scans. Join keys:
`chassis_id` (switches), `mac` (hosts). This is what the canonical entities
layer (5b) is for — the per-scan `topology.json` alone won't stitch.

**Validated topology reality (from the real sample):** each bundle's
`topology.json` is **sensor-centric / star-shaped** — every node links back to
`self` (the NetMon box). One scan = 1 scanner → 1 gateway, → 1 uplink switch
(LLDP neighbor, carrying `chassis_id` + remote port e.g. `4/1/33`), → N hosts
(121 here) connected via `l3_seen`. Consequences:
- A single bundle does NOT reveal which switch port each host is on — only
  "this sensor saw these IPs and uplinks to switch X port Y."
- The district/school physical map is therefore built by **stitching each IDF's
  sensor star together** at the switch level via `chassis_id`/LLDP.
- True per-host → switch-port mapping would require the SNMP bridge/FDB
  (`dot1dTpFdb`) table. **Deferred** — not in MVP scope.

**Interaction:** rendered with React Flow (or Cytoscape.js). Click a switch node
→ side drawer with its neighbors, ports, SNMP, recent traffic.

---

## 8. Sensor management plane (control plane)

**Goal:** SBCSS super-admins push config, collect logs, and run commands on
sensors — **with no inbound connectivity to the sensor.**

**Model — outbound poll / desired-state ("phone-home"):**
- The sensor always initiates **outbound HTTPS (443)**. The console never
  connects to the sensor. Same trust direction NetMon already uses for SFTP.
- Sensor periodically checks in: *"here's my identity + current config version;
  any commands?"*
- Console returns **desired state** (target config) + a **command queue**
  (collect-logs, run-scan, restart, update).
- Sensor reconciles to desired state, reports results, and **uploads logs
  outbound** (reuse SFTP, or a short-lived Blob SAS URL).
- Latency = poll interval (e.g. ~5 min). Fine for management; not interactive.

**Safety & security (this is a control plane — treat it as high-risk):**
- Per-sensor authentication (enrollment token / client cert); commands signed;
  least-privilege; **every command audit-logged**; destructive actions gated
  behind approval.
- Config pushes must be **reversible**. NetMon already ships `rollback.sh`,
  `config-backup`, a `watchdog`, and auto-update — a bad push can auto-roll-back
  via the existing watchdog, which de-risks this substantially.

**NetMon impact:** additive collector code — a new outbound agent/poll loop that
slots into the existing scheduler/identity/settings patterns. No redesign.

**Phasing:** later milestone — must NOT block the read-only dashboard MVP. But
the **seam is baked into the design now**: sensor identity, a check-in endpoint
stub, and the `desired_config` / `command_queue` tables.

**Scale door left open:** if near-real-time push or interactive control is ever
needed at fleet scale, the Azure-native upgrade is **Azure IoT Hub** (device
twins = desired/reported config, direct methods, all device-initiated). The
desired-state model above is shaped so that's an implementation swap, not a
redesign. Do NOT start there.

---

## 9. Retention

User stance: less worried about old data; keep what matters, purge the rest.

- **Keep long-term:** canonical entities (5b), latest physical + logical
  topology, findings history, daily health/metrics rollups.
- **Purge after 30 days:** full per-scan time-series rows (5a) + raw ZIPs in Blob
  (keep ZIPs a short grace window until parse is validated).
- **Accepted tradeoff:** once raw is purged, new metrics can't be re-derived from
  old data.
- **Invariant:** canonical entities / latest topology must NOT expire at 30 days,
  or a switch that went quiet would vanish from the map.

---

## 10. AI analysis

Implemented as a provider-agnostic seam in `src/lib/ai/` (calling layer; the
analyst instruction set in `instructions.ts` is provisional and refined in a
follow-up). Key decisions:

- **Multi-model, side-by-side.** One run fans out to every *active* provider
  (enabled + configured) and writes **one `ai_analyses` row per model** (shared
  `runId`), rendered as comparison columns. A provider with no key/disabled shows
  as "not configured" — no code change to enable it later.
  - **Azure OpenAI (in-tenant)** — GPT on the county's Azure credits; data stays
    in-tenant (respects the air-gap-leaning preference).
  - **OpenAI (direct)** — GPT via the org's platform API credits; same family,
    different account/billing, data goes to OpenAI rather than the Azure tenant.
  - **Anthropic (Claude)** — `console.anthropic.com` key (separate from a Claude
    subscription).
  - Add a model = one adapter + one line in `providers/registry.ts`.
- **Configurable at runtime, no redeploy.** `/settings/ai` (superadmin) edits
  per-provider enable/model/key + the daily schedule, output-token bound, and an
  advisory monthly spend target. Keys are stored **AES-256-GCM encrypted**
  (`ai_provider_settings`, secret-box keyed off `AUTH_SECRET`) — same posture as
  the SFTP creds; env vars are a fallback. A per-provider **Test connection**
  validates credentials with a tiny live call. `settings.ts` resolves DB→env into
  a connect-ready config the adapters consume (they no longer read env directly).
- **Usage tracking.** Each row records token counts + an estimated cost
  (`pricing.ts`, approximate $/token table); `/settings/ai` shows per-model
  runs/tokens/cost for the month against the advisory target. (Caps are tracked +
  displayed, not yet enforced.)
- **Compact context, not raw dumps.** `context.ts` composes the existing query
  helpers to feed the model the same deduped rollups the dashboard renders
  (resolver health, DHCP scopes+issues, STP summary, switch inventory, host-type
  breakdown, recent findings, the 30-day health trend). Raw `raw/` SNMP stays in
  Blob; a future "drill into scan N" hook can pull it on demand.
- **Structured output.** Both providers answer through one JSON contract
  (`output-schema.ts`): a prose `summary` + `findings[]` (severity, confidence,
  title, detail, evidence citation, recommendation). OpenAI via `json_schema`
  strict mode; Anthropic via a forced tool. Anthropic gets a cached system block.
- **Two triggers, one path.** A daily **Azure Container Apps Job** (`aiJob`,
  `npm run ai:analyze`, default 02:00 UTC) runs every district; the on-demand
  **"Run AI analysis"** button (per district) uses write-row-then-poll —
  inserts `running` rows, finishes the work in `next/server` `after()` (keeps the
  scale-to-zero web app alive), and the page polls `getRunStatus`.
- **Cached results.** Every run is stored in `ai_analyses` (durable tier, beside
  `health_rollup_daily`); the dashboard reads stored rows — the model is only
  called by the daily Job or an explicit button press, never on page load.

---

## 11. Build milestones

1. **Foundation** — repo, Next.js + TypeScript scaffold, Drizzle config,
   Postgres schema (time-series + entities + app-owned + management tables).
2. **Ingestion** — bundle parser (upsert tenancy from `scan.json` slugs, load
   time-series, curated SNMP extract, build canonical entities + topology
   snapshots), driven by either a **manual ZIP upload** (build/test first) or the
   nightly **SFTP pull** (all-unseen, idempotent) → Blob. Includes the
   superadmin `data_sources` SFTP config + "Test connection" (§4b).
3. **Auth & permissions** — Microsoft + Google OIDC, break-glass local admin
   with email-code MFA, users/grants, per-query scope filtering, admin invites.
4. **Dashboard** — district → school → IDF/switch drill-down; physical +
   logical network maps with clickable switch detail; findings views.
5. **Retention** — 30-day purge of time-series + raw ZIPs; long-term keep of
   entities/topology/findings/rollups.
6. **Management plane** — sensor enrollment + check-in endpoint, desired-config
   + command queue, log collection; collector-side outbound agent loop.
7. **AI analysis** — provider-agnostic seam (Azure OpenAI + Anthropic), daily
   Job + on-demand button, side-by-side model comparison, cached in `ai_analyses`.
   *(Calling layer done; analyst instruction set being refined.)*
8. **Deploy** — Bicep for all Azure resources; GitHub Actions → ACR → Container
   Apps via OIDC federation.

---

## 12. Open items / to confirm
- What exactly is the SFTP endpoint (Azure Blob SFTP vs third-party)? Affects
  cost reasoning for pull cadence.
- Entra External ID vs Auth.js (NextAuth) for handling both Microsoft + Google.
- Exact "keep long-term" metric set in `health_rollup_daily`.
- Custom domain + managed TLS cert for the public app.
