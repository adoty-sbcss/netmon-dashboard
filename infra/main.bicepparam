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

// ---- Ingestion (SFTP sync) Job — off until the SFTP endpoint is confirmed.
// To turn it on, set these env vars before deploying and redeploy:
//   $env:ENABLE_INGEST_JOB = 'true'
//   $env:SFTP_HOST = '<host>'; $env:SFTP_USER = '<user>'
//   $env:SFTP_PASSWORD = '<password>'           # secret, never committed
//   $env:SFTP_BASE_DIR = '/<base path>'         # optional, default '/'
param enableIngestJob = bool(readEnvironmentVariable('ENABLE_INGEST_JOB', 'false'))
param sftpHost = readEnvironmentVariable('SFTP_HOST', '')
param sftpUser = readEnvironmentVariable('SFTP_USER', '')
param sftpPassword = readEnvironmentVariable('SFTP_PASSWORD', '')
param sftpBaseDir = readEnvironmentVariable('SFTP_BASE_DIR', '/')

// All other parameters default to the current SBCSS stack names in main.bicep.
// Override here only when replicating for a different organization.
