using './main.bicep'

// Two secrets, never hard-coded — set them as environment variables before
// deploying. PowerShell:
//   $env:PG_ADMIN_PASSWORD = '<the postgres admin password>'
//   $env:AUTH_SECRET       = '<32+ byte random hex — generate a NEW one for prod>'
// bash:
//   export PG_ADMIN_PASSWORD='<the postgres admin password>'
//   export AUTH_SECRET='<32+ byte random hex — generate a NEW one for prod>'
//
// Generate a fresh AUTH_SECRET (do NOT reuse the dev .env value):
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
param postgresAdminPassword = readEnvironmentVariable('PG_ADMIN_PASSWORD')
param authSecret = readEnvironmentVariable('AUTH_SECRET')

// Postgres is private (VNet-integrated) — there is no firewall to open, so no
// client-IP parameter. The migrate/seed Job runs inside the VNet to reach it.

// ---- Ingestion (SFTP sync) Job. The SFTP connection is now configured IN-APP
// (Settings → SFTP ingestion) and stored ENCRYPTED in the DB — no SFTP creds at
// deploy time (the sftp* params were removed from main.bicep). Set
// ENABLE_INGEST_JOB=true to provision the scheduled Job.
param enableIngestJob = bool(readEnvironmentVariable('ENABLE_INGEST_JOB', 'true'))

// All other parameters default to the current SBCSS stack names in main.bicep.
// Override here only when replicating for a different organization.
