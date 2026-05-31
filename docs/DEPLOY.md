# NetMon Dashboard — Azure Deployment Runbook

First-time provision **and** ongoing deploys for the SBCSS production stack.
Everything is Infrastructure-as-Code (`infra/main.bicep`); this runbook is the
exact command sequence to stand it up and ship the app.

> **Network posture:** PostgreSQL is **private** (VNet-integrated, no public
> endpoint). The web app's login page is public; the database is not. Because
> the DB is unreachable from your workstation, **schema migrations and the admin
> seed run as an in-VNet Container Apps Job** (`w2-sbcss-netmon-migrate`), not
> from your laptop.

---

## 0. What gets created

One resource group contains: Log Analytics · VNet (CAE subnet + delegated
Postgres subnet) · private DNS zone for Postgres · 2 managed identities (app +
GitHub-OIDC deploy) · Key Vault (holds `AUTH-SECRET` + `DATABASE-URL`) · Storage
(blob landing zone) · ACR · VNet-injected Container Apps environment · the web
app (`w2-sbcss-netmon-web`, scale-to-zero) · the migrate Job
(`w2-sbcss-netmon-migrate`) · PostgreSQL Flexible Server B1ms (private).

| Thing | Value |
|---|---|
| Resource group | `W2-SBCSS-District-NetMon-Dashboard` |
| ACR | `w2sbcssnetmondashacr` |
| Web app | `w2-sbcss-netmon-web` |
| Migrate Job | `w2-sbcss-netmon-migrate` |
| Web image | `netmon-dashboard:latest` |
| Migrator image | `netmon-dashboard-migrator:latest` |
| GitHub repo (OIDC-trusted) | `adoty-sbcss/netmon-dashboard` (branch `main`) |

---

## 1. Prerequisites (one-time, on your workstation)

- **Azure CLI** (`az`) with the Bicep + containerapp extensions:
  ```powershell
  az version
  az bicep install
  az extension add --name containerapp --upgrade --only-show-errors
  ```
- **GitHub CLI** (`gh`) logged in: `gh auth status`
- **Contributor** on the resource group (or subscription). If Azure Lighthouse
  blocks the role-assignment writes, see the `assignRoles=false` note in step 4.
- The two secrets in hand:
  - **Postgres admin password** — a strong random string you keep in your
    private credentials file (NOT in the repo).
  - **AUTH_SECRET** — generate a **new** one for prod (do not reuse dev `.env`):
    ```powershell
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    ```

---

## 2. Log in and select the subscription

```powershell
az login
az account set --subscription "<your-subscription-id>"
# Sanity check — note tenantId + id for the GitHub variables later:
az account show --query "{sub:id, tenant:tenantId}" -o table
```

If the resource group doesn't exist yet:

```powershell
az group create -n W2-SBCSS-District-NetMon-Dashboard -l westus2
```

---

## 3. Supply the two secrets as environment variables

The Bicep reads these via `readEnvironmentVariable()` and writes them into Key
Vault — they never touch the repo.

```powershell
$env:PG_ADMIN_PASSWORD = '<the postgres admin password>'
$env:AUTH_SECRET       = '<the 64-hex AUTH_SECRET you generated in step 1>'
```

> Open a fresh shell later? Re-set these before any `az deployment` command.

---

## 4. Validate, then first deploy (with placeholder images)

The ACR starts empty, so the real images don't exist yet. First deploy points
the web app + Job at a public placeholder image just to provision everything;
step 6 swaps in the real images.

```powershell
# Offline compile check — catches Bicep errors before touching Azure.
az bicep build --file infra/main.bicep --stdout > $null; if ($?) { "bicep OK" }

# First deploy: provisions ACR/KV/VNet/Postgres/etc. with placeholder images.
az deployment group create `
  -g W2-SBCSS-District-NetMon-Dashboard `
  -n netmon-bootstrap `
  -f infra/main.bicep `
  -p infra/main.bicepparam `
  -p containerImage=mcr.microsoft.com/k8se/quickstart:latest `
     migratorImage=mcr.microsoft.com/k8se/quickstart:latest
```

> This deploy provisions Postgres in a delegated subnet — that step alone can
> take ~10–15 minutes. The placeholder web replica will be unhealthy (wrong
> port); that's expected and fixed in step 6.

**Lighthouse fallback:** if the deploy fails *only* on `roleAssignments`, re-run
adding `-p assignRoles=false`, then create these four grants in the Portal:
AcrPull / Key Vault Secrets User / Storage Blob Data Contributor on the **app**
identity (`W2-SBCSS-NetMon-Dash-Identity`), and Contributor on the RG for the
**deploy** identity (`W2-SBCSS-NetMon-GHA-Deploy`).

---

## 5. Build the real images into ACR

Now that ACR exists, build both images server-side (no local Docker needed):

```powershell
# Web app image (the standalone runtime).
az acr build --registry w2sbcssnetmondashacr `
  --image netmon-dashboard:latest .

# Migrator image (full deps + drizzle-kit + tsx + drizzle/ SQL).
az acr build --registry w2sbcssnetmondashacr `
  --target migrator `
  --image netmon-dashboard-migrator:latest .
```

---

## 6. Re-deploy with the real images

Re-run the deployment **without** the placeholder overrides. The image params
now default to the ACR images, so this rolls the web app + Job onto them.
Idempotent — only the image fields change.

```powershell
az deployment group create `
  -g W2-SBCSS-District-NetMon-Dashboard `
  -n netmon-main `
  -f infra/main.bicep `
  -p infra/main.bicepparam
```

Capture the outputs you'll need next:

```powershell
az deployment group show -g W2-SBCSS-District-NetMon-Dashboard -n netmon-main `
  --query properties.outputs -o json
```

You'll use `containerAppFqdn`, `deployIdentityClientId`, and the
`postgresHost` from here.

---

## 7. Create the schema + seed the admin (in-VNet Job)

The migrate Job applies all `drizzle/` migrations from scratch (0000→0003 build
the full schema) **and** seeds the break-glass admin. Both steps are idempotent.

```powershell
# Kick it off…
az containerapp job start -g W2-SBCSS-District-NetMon-Dashboard -n w2-sbcss-netmon-migrate

# …find the execution name…
az containerapp job execution list `
  -g W2-SBCSS-District-NetMon-Dashboard -n w2-sbcss-netmon-migrate `
  --query "[0].{name:name, status:properties.status}" -o table

# …and read its logs (replace <exec> with the name above):
az containerapp job logs show `
  -g W2-SBCSS-District-NetMon-Dashboard -n w2-sbcss-netmon-migrate `
  --execution <exec> --container migrate
```

Expect: drizzle applying 4 migrations, then `Created admin adaministrator` (or
`admin already exists` on a re-run). Status should reach **Succeeded**.

---

## 8. Wire GitHub Actions for ongoing deploys

`.github/workflows/deploy.yml` authenticates to Azure with OIDC (no stored
secrets). Set these three repo **variables** (not secrets) from step 2 + 6:

```powershell
gh variable set AZURE_CLIENT_ID       -R adoty-sbcss/netmon-dashboard -b "<deployIdentityClientId>"
gh variable set AZURE_TENANT_ID       -R adoty-sbcss/netmon-dashboard -b "<tenantId>"
gh variable set AZURE_SUBSCRIPTION_ID -R adoty-sbcss/netmon-dashboard -b "<subscriptionId>"
```

From now on, **push to `main`** → the workflow runs `az acr build` for the web
image and rolls `w2-sbcss-netmon-web` to it. (Infra/docs/markdown changes are
path-ignored and won't trigger a deploy.)

---

## 9. Smoke test

```powershell
"https://<containerAppFqdn>/login"   # open in a browser
```

1. Cold start (~10–30s on first hit — scale-to-zero).
2. Sign in: **`adaministrator`** / **`password`**.
3. You're forced to **/account/change-password** — set a new password (≥12 chars).
4. Land on the dashboard. Sign out via the account menu (top-right).

If login spins or 500s, check the web app logs:

```powershell
az containerapp logs show -g W2-SBCSS-District-NetMon-Dashboard -n w2-sbcss-netmon-web --follow
```

Most likely cause if it fails immediately: the app couldn't read a Key Vault
secret → confirm the app identity has **Key Vault Secrets User** on the vault.

---

## 10. Day-2 operations

- **App code change:** push to `main`. Done.
- **Schema change (new migration):** generate it (`npm run db:generate`), commit,
  then rebuild + re-run the migrator:
  ```powershell
  az acr build --registry w2sbcssnetmondashacr --target migrator `
    --image netmon-dashboard-migrator:latest .
  az containerapp job start -g W2-SBCSS-District-NetMon-Dashboard -n w2-sbcss-netmon-migrate
  ```
- **Rotate AUTH_SECRET / DB password:** update the Key Vault secret
  (`az keyvault secret set --vault-name W2-SBCSS-NetMon-KV --name AUTH-SECRET ...`),
  then restart the web app's revision. (Rotating AUTH_SECRET invalidates all
  active sessions — everyone re-logs in.)
- **Manual one-off ingest:** load a single extracted bundle with
  `npm run ingest -- --path <extracted-bundle-dir>` against a DB you can reach.

---

## 11. Enable the nightly SFTP ingestion Job (when the endpoint is confirmed)

The SFTP sync code is built (`src/ingest/sync.ts`, Dockerfile `ingest` target)
and the cron Job exists in Bicep, **off by default** (`enableIngestJob=false`)
until the SFTP endpoint + credentials are confirmed. To turn it on:

```powershell
# Build the ingest image into ACR.
az acr build --registry w2sbcssnetmondashacr --target ingest `
  --image netmon-dashboard-ingest:latest .

# Supply SFTP config (password is a secret — set it only in the shell).
$env:ENABLE_INGEST_JOB = 'true'
$env:SFTP_HOST = '<sftp host>'
$env:SFTP_USER = '<sftp user>'
$env:SFTP_PASSWORD = '<sftp password>'
$env:SFTP_BASE_DIR = '/<base path to district tree>'   # optional, default '/'
# (PG_ADMIN_PASSWORD + AUTH_SECRET must still be set — see step 3.)

# Redeploy: provisions w2-sbcss-netmon-ingest on the nightly cron (08:00 UTC).
az deployment group create `
  -g W2-SBCSS-District-NetMon-Dashboard -n netmon-ingest `
  -f infra/main.bicep -p infra/main.bicepparam
```

Test it immediately without waiting for the cron, and watch the logs:

```powershell
az containerapp job start -g W2-SBCSS-District-NetMon-Dashboard -n w2-sbcss-netmon-ingest
az containerapp job execution list `
  -g W2-SBCSS-District-NetMon-Dashboard -n w2-sbcss-netmon-ingest `
  --query "[0].{name:name,status:properties.status}" -o table
```

The sync is idempotent (keyed on the ZIP filename via `ingested_bundles`), so it
only ingests genuinely new bundles — including boxes that were offline and
backfilled. It supports `--dry-run`, `--force`, and `--limit N`; for a cautious
first run you can run `npm run ingest:sync -- --dry-run` from inside the VNet, or
temporarily set the Job's command. Key-based auth is supported by the code
(`SFTP_PRIVATE_KEY`); the Bicep Job wires password auth — add a key secret if you
prefer keys.

> **Open item:** confirm what the SFTP endpoint actually is (a standalone SFTP
> server vs. Azure Blob's SFTP). If it's Blob SFTP, cadence barely affects cost
> (the hourly "SFTP enabled" fee dominates); see `docs/DESIGN.md §4`.

---

## Not yet wired (tracked, out of scope for this runbook)

- **OIDC sign-in** — Microsoft Entra + Google buttons (the login UI has disabled
  placeholders today).
- **Azure Communication Services (Email)** — for MFA codes.
- **Custom domain + managed TLS** on the Container App.
