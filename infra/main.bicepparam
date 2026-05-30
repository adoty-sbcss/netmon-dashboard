using './main.bicep'

// Secret: never hard-code. Set before deploying, e.g. (PowerShell):
//   $env:PG_ADMIN_PASSWORD = '<the postgres admin password>'
// or (bash):  export PG_ADMIN_PASSWORD='<the postgres admin password>'
param postgresAdminPassword = readEnvironmentVariable('PG_ADMIN_PASSWORD')

// Optional: your workstation's public IP, to open the Postgres firewall for it.
//   export CLIENT_IP='<your-workstation-public-ip>'
param clientIpAddress = readEnvironmentVariable('CLIENT_IP', '')

// All other parameters default to the current SBCSS stack names in main.bicep.
// Override here only when replicating for a different organization.
