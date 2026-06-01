// =============================================================================
// netmon-dashboard — full Azure stack as Infrastructure as Code.
//
// Recreates the entire environment in one deploy: Log Analytics, VNet (with a
// subnet for the Container Apps environment and a delegated subnet for
// PostgreSQL), private DNS for Postgres, two managed identities (+ GitHub OIDC
// federated credential), Key Vault (with the app's runtime secrets), Storage,
// ACR, a VNet-injected Container Apps environment, the web app, a manual
// migrate/seed Job, and a PRIVATE PostgreSQL Flexible Server.
//
// Scope: resource group. Deploy with (PowerShell or bash):
//   az deployment group create \
//     -g W2-SBCSS-District-NetMon-Dashboard \
//     -f infra/main.bicep \
//     -p infra/main.bicepparam
//
// Two secrets are supplied at deploy time and never committed (see
// main.bicepparam): the Postgres admin password (PG_ADMIN_PASSWORD) and the
// session-signing key (AUTH_SECRET). Both are written into Key Vault and the
// app/job read them at runtime via managed identity — they are never baked
// into the image.
//
// NETWORK POSTURE: Postgres has NO public endpoint. It lives in a delegated
// subnet and is reachable only from inside the VNet. The Container Apps
// environment is VNet-injected, so the web app and the migrate Job can reach
// the database; nothing on the public internet can. The web app's ingress is
// still public (district users log in from anywhere) — only the DB is private.
// Because the DB is private, schema migrations + admin seeding run as an
// in-VNet Container Apps Job (see migrateJob), NOT from a workstation.
//
// COLD-REBUILD ORDERING: on a from-scratch rebuild the ACR starts empty, so the
// container images won't exist yet. Either (a) set params `containerImage` /
// `migratorImage` to a public placeholder for the first deploy and let the
// GitHub Actions pipeline + `az acr build` roll the real images, or (b) run
// `az acr build` for both targets once after ACR exists, then re-deploy.
//
// LIGHTHOUSE NOTE: this subscription is Azure Lighthouse-managed, which can block
// role-assignment writes through some paths. If the deploy fails ONLY on the
// roleAssignment resources, set `assignRoles = false` and create those four
// grants in the Portal (AcrPull/KV Secrets User/Storage Blob Data Contributor on
// the app identity; Contributor on the RG for the deploy identity).
// =============================================================================

targetScope = 'resourceGroup'

// ---- Parameters (defaults reproduce the current SBCSS stack exactly) ----
@description('Azure region for all resources.')
param location string = resourceGroup().location

param logAnalyticsName string = 'W2-SBCSS-NetMon-Dash-Logs'
param appIdentityName string = 'W2-SBCSS-NetMon-Dash-Identity'
param deployIdentityName string = 'W2-SBCSS-NetMon-GHA-Deploy'
param keyVaultName string = 'W2-SBCSS-NetMon-KV'
param storageName string = 'w2sbcssnetmondash'
param acrName string = 'w2sbcssnetmondashacr'
param vnetName string = 'W2-SBCSS-NetMon-VNet'
param environmentName string = 'W2-SBCSS-NetMon-CAE'
param containerAppName string = 'w2-sbcss-netmon-web'
param migrateJobName string = 'w2-sbcss-netmon-migrate'
param postgresServerName string = 'w2-sbcss-netmon-psql'
param postgresDbName string = 'netmon'
param postgresAdminUser string = 'netmonadmin'

@secure()
@description('PostgreSQL administrator password. Supplied at deploy time, never stored in the repo.')
param postgresAdminPassword string

@secure()
@description('Session-signing key (HMAC-SHA256), 32+ random bytes hex. Supplied at deploy time, written to Key Vault, never stored in the repo. Generate a NEW one for prod — do not reuse the dev value.')
param authSecret string

@description('GitHub repo (owner/name) trusted for OIDC deploys.')
param githubRepo string = 'adoty-sbcss/netmon-dashboard'

@description('Git branch allowed to deploy via the federated credential.')
param githubBranch string = 'main'

@description('VNet address space (CIDR). Carved into the CAE + Postgres subnets below.')
param vnetAddressPrefix string = '10.40.0.0/16'

@description('Subnet for the Container Apps environment. Consumption envs require /23 or larger.')
param caeSubnetPrefix string = '10.40.0.0/23'

@description('Delegated subnet for PostgreSQL Flexible Server (private access).')
param postgresSubnetPrefix string = '10.40.4.0/28'

@description('Container image the web app runs. Defaults to the ACR image; must exist before deploy (see header).')
param containerImage string = '${acrName}.azurecr.io/netmon-dashboard:latest'

@description('Image the migrate/seed Job runs (full repo + drizzle-kit + tsx). Built from the Dockerfile "migrator" target.')
param migratorImage string = '${acrName}.azurecr.io/netmon-dashboard-migrator:latest'

param containerCpu string = '0.5'
param containerMemory string = '1.0Gi'

// ---- Ingestion (SFTP sync) Job ----
// The SFTP connection is now configured in-app (Settings → SFTP ingestion) and
// stored ENCRYPTED in the DB, decrypted at run time with AUTH_SECRET. The Job
// therefore needs only DATABASE_URL + AUTH_SECRET — no SFTP creds at deploy
// time. Safe to leave enabled: the sync no-ops until an admin saves a config
// and flips the in-app "enabled" switch.
@description('Provision the scheduled SFTP ingestion cron Job (config comes from the in-app settings).')
param enableIngestJob bool = true

@description('Image the ingest Job runs. Built from the Dockerfile "ingest" target.')
param ingestImage string = '${acrName}.azurecr.io/netmon-dashboard-ingest:latest'

@description('Cron (UTC) for the ingest Job wake-up. Default: hourly. The job then pulls only when the per-cadence interval (set in /settings/ingestion) has elapsed, so it stays near one real pass per chosen frequency.')
param ingestCron string = '0 * * * *'

// ---- AI analysis Job (docs/DESIGN.md §10) ----
// Daily model-driven review per district. Reuses the migrator image (full source
// + tsx) and overrides the command to `npm run ai:analyze`. No-ops cleanly while
// no model key is set, so it's safe to leave enabled. The same model env is wired
// into the web app so the on-demand "Run AI analysis" button works there too.
@description('Provision the daily AI analysis cron Job. No-ops until a model key is set.')
param enableAiJob bool = true

@description('Cron (UTC) for the daily AI analysis run. Default 02:00 UTC (~end of school day, US Pacific).')
param aiCron string = '0 2 * * *'

@description('Azure OpenAI endpoint, e.g. https://<resource>.openai.azure.com. Empty = GPT column stays "not configured".')
param azureOpenAiEndpoint string = ''

@description('Azure OpenAI deployment name, e.g. gpt-4o.')
param azureOpenAiDeployment string = ''

@description('Azure OpenAI API version.')
param azureOpenAiApiVersion string = '2024-10-21'

@description('Azure OpenAI API key. Empty keeps the GPT column disabled until set.')
@secure()
param azureOpenAiApiKey string = ''

@description('Anthropic (Claude) API key. Empty keeps the Claude column "not configured" until added.')
@secure()
param anthropicApiKey string = ''

@description('Anthropic model id.')
param anthropicModel string = 'claude-opus-4-8'

@description('Create the RBAC role assignments. Set false if Lighthouse blocks them and assign in the Portal instead.')
param assignRoles bool = true

// ---- Built-in role definition IDs ----
var roleIds = {
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
  kvSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  contributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c'
}

// Private DNS zone for the Flexible Server. The name must end with
// `.private.postgres.database.azure.com`; the server registers its A record here.
var postgresPrivateDnsZoneName = '${postgresServerName}.private.postgres.database.azure.com'

// KV secret names (hyphens, not underscores — KV secret names can't contain `_`).
var authSecretName = 'AUTH-SECRET'
var databaseUrlSecretName = 'DATABASE-URL'

// Constructed at deploy time from the private FQDN + admin creds. Lives only in
// Key Vault; the app/job pull it via managed identity.
var databaseUrlValue = 'postgresql://${postgresAdminUser}:${postgresAdminPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/${postgresDbName}?sslmode=require'

// AI model credentials. App-level secrets (not KV) so an UNSET key is simply an
// absent array entry — Key Vault rejects empty secret values, and these are
// optional/empty by default. Each provider's adapter treats a missing key as
// "not configured", so the AI Job and the web button no-op until a key lands.
var aiSecrets = concat(
  empty(azureOpenAiApiKey) ? [] : [ { name: 'azure-openai-api-key', value: azureOpenAiApiKey } ],
  empty(anthropicApiKey) ? [] : [ { name: 'anthropic-api-key', value: anthropicApiKey } ]
)
var aiEnv = concat(
  empty(azureOpenAiEndpoint) ? [] : [
    { name: 'AZURE_OPENAI_ENDPOINT', value: azureOpenAiEndpoint }
    { name: 'AZURE_OPENAI_DEPLOYMENT', value: azureOpenAiDeployment }
    { name: 'AZURE_OPENAI_API_VERSION', value: azureOpenAiApiVersion }
  ],
  empty(azureOpenAiApiKey) ? [] : [ { name: 'AZURE_OPENAI_API_KEY', secretRef: 'azure-openai-api-key' } ],
  empty(anthropicApiKey) ? [] : [
    { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
    { name: 'ANTHROPIC_MODEL', value: anthropicModel }
  ]
)

// ---- Log Analytics ----
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ---- Networking: VNet with a CAE subnet + a delegated Postgres subnet ----
resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: { addressPrefixes: [ vnetAddressPrefix ] }
    subnets: [
      {
        // Container Apps environment infrastructure subnet (/23+). A VNet-injected
        // environment REQUIRES this subnet delegated to 'Microsoft.App/environments'
        // — true for Consumption and workload-profile envs alike on the current
        // platform. (Azure rejects env creation with ManagedEnvironmentSubnetDelegationError
        // if this delegation is missing.)
        name: 'snet-cae'
        properties: {
          addressPrefix: caeSubnetPrefix
          delegations: [
            {
              name: 'cae-delegation'
              properties: { serviceName: 'Microsoft.App/environments' }
            }
          ]
        }
      }
      {
        // Delegated to Postgres Flexible Server for private (VNet) access.
        name: 'snet-postgres'
        properties: {
          addressPrefix: postgresSubnetPrefix
          delegations: [
            {
              name: 'pg-flexible'
              properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' }
            }
          ]
        }
      }
    ]
  }
}

var caeSubnetId = '${vnet.id}/subnets/snet-cae'
var postgresSubnetId = '${vnet.id}/subnets/snet-postgres'

// ---- Private DNS for Postgres (so the private FQDN resolves inside the VNet) ----
resource postgresPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: postgresPrivateDnsZoneName
  location: 'global'
}

resource postgresDnsVnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: postgresPrivateDnsZone
  name: 'link-to-vnet'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

// ---- Managed identities ----
resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: appIdentityName
  location: location
}

resource deployIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: deployIdentityName
  location: location
}

// GitHub Actions OIDC federation: only the named repo + branch can assume this identity.
resource deployFederation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: deployIdentity
  name: 'github-main'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubRepo}:ref:refs/heads/${githubBranch}'
    audiences: [ 'api://AzureADTokenExchange' ]
  }
}

// ---- Key Vault (RBAC auth model, purge protection on) ----
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

// Runtime secrets. The app + migrate Job read these via the app identity's
// "Key Vault Secrets User" grant (see kvSecretsUserAssignment).
resource kvAuthSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: authSecretName
  properties: { value: authSecret }
}

resource kvDatabaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: databaseUrlSecretName
  properties: { value: databaseUrlValue }
}

// ---- Storage (Blob landing zone for SFTP ZIPs) ----
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

// ---- Container Registry ----
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

// ---- Container Apps environment (VNet-injected; logs -> Log Analytics) ----
resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      // Inject into the VNet so egress can reach the private Postgres.
      // internal:false keeps the web app's ingress publicly reachable.
      infrastructureSubnetId: caeSubnetId
      internal: false
    }
  }
}

// ---- Web Container App (scale-to-zero, pulls from ACR + reads KV secrets) ----
resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'Auto'
        allowInsecure: false
      }
      registries: [
        {
          server: '${acrName}.azurecr.io'
          identity: appIdentity.id
        }
      ]
      // Pull runtime secrets from Key Vault via the app identity (versionless
      // URIs auto-pick the latest version on each revision).
      secrets: concat([
        {
          name: 'auth-secret'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/${authSecretName}'
          identity: appIdentity.id
        }
        {
          name: 'database-url'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/${databaseUrlSecretName}'
          identity: appIdentity.id
        }
      ], aiSecrets)
    }
    template: {
      containers: [
        {
          name: 'web'
          image: containerImage
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: concat([
            { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'NODE_ENV', value: 'production' }
          ], aiEnv)
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
  // KV secret refs are validated at create time using the app identity, so the
  // role grant + the secrets must exist first.
  dependsOn: assignRoles
    ? [ kvAuthSecret, kvDatabaseUrl, acrPullAssignment, kvSecretsUserAssignment ]
    : [ kvAuthSecret, kvDatabaseUrl ]
}

// ---- Migrate/seed Job (manual trigger; runs drizzle migrate + admin seed) ----
// Runs INSIDE the VNet so it can reach the private Postgres. Image is the
// Dockerfile "migrator" target (full deps + source + drizzle/). Start it with:
//   az containerapp job start -g <rg> -n w2-sbcss-netmon-migrate
resource migrateJob 'Microsoft.App/jobs@2024-03-01' = {
  name: migrateJobName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentity.id}': {}
    }
  }
  properties: {
    environmentId: containerEnv.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 1
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: '${acrName}.azurecr.io'
          identity: appIdentity.id
        }
      ]
      secrets: [
        {
          name: 'auth-secret'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/${authSecretName}'
          identity: appIdentity.id
        }
        {
          name: 'database-url'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/${databaseUrlSecretName}'
          identity: appIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: migratorImage
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: [
            { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'NODE_ENV', value: 'production' }
          ]
        }
      ]
    }
  }
  dependsOn: assignRoles
    ? [ kvAuthSecret, kvDatabaseUrl, acrPullAssignment, kvSecretsUserAssignment ]
    : [ kvAuthSecret, kvDatabaseUrl ]
}

// ---- Ingestion Job (cron; SFTP pull → parse → upsert) ----
// Runs inside the VNet to reach the private Postgres. DATABASE_URL + AUTH_SECRET
// come from Key Vault; the SFTP connection is read from the DB (ingest_settings)
// and decrypted with AUTH_SECRET. Tenancy is derived from each bundle's
// scan.json, not the SFTP path.
resource ingestJob 'Microsoft.App/jobs@2024-03-01' = if (enableIngestJob) {
  name: 'w2-sbcss-netmon-ingest'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentity.id}': {}
    }
  }
  properties: {
    environmentId: containerEnv.id
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 3600
      replicaRetryLimit: 1
      scheduleTriggerConfig: {
        cronExpression: ingestCron
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: '${acrName}.azurecr.io'
          identity: appIdentity.id
        }
      ]
      secrets: [
        {
          name: 'auth-secret'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/${authSecretName}'
          identity: appIdentity.id
        }
        {
          name: 'database-url'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/${databaseUrlSecretName}'
          identity: appIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'ingest'
          image: ingestImage
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: [
            { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'NODE_ENV', value: 'production' }
          ]
        }
      ]
    }
  }
  dependsOn: assignRoles
    ? [ kvDatabaseUrl, acrPullAssignment, kvSecretsUserAssignment ]
    : [ kvDatabaseUrl ]
}

// ---- AI analysis Job (cron; per-district model review → ai_analyses) ----
// Reuses the migrator image (full source + tsx) and overrides the command to run
// `npm run ai:analyze`. Reads DATABASE_URL/AUTH_SECRET from Key Vault and the
// model keys from the app-level aiSecrets. No-ops while no model key is present.
resource aiJob 'Microsoft.App/jobs@2024-03-01' = if (enableAiJob) {
  name: 'w2-sbcss-netmon-ai'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentity.id}': {}
    }
  }
  properties: {
    environmentId: containerEnv.id
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 3600
      replicaRetryLimit: 1
      scheduleTriggerConfig: {
        cronExpression: aiCron
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: '${acrName}.azurecr.io'
          identity: appIdentity.id
        }
      ]
      secrets: concat([
        {
          name: 'auth-secret'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/${authSecretName}'
          identity: appIdentity.id
        }
        {
          name: 'database-url'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/${databaseUrlSecretName}'
          identity: appIdentity.id
        }
      ], aiSecrets)
    }
    template: {
      containers: [
        {
          name: 'ai'
          image: migratorImage
          command: [ 'npm' ]
          args: [ 'run', 'ai:analyze' ]
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: concat([
            { name: 'AUTH_SECRET', secretRef: 'auth-secret' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'NODE_ENV', value: 'production' }
          ], aiEnv)
        }
      ]
    }
  }
  dependsOn: assignRoles
    ? [ kvDatabaseUrl, acrPullAssignment, kvSecretsUserAssignment ]
    : [ kvDatabaseUrl ]
}

// ---- PostgreSQL Flexible Server (PRIVATE access — no public endpoint) ----
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: postgresServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdminUser
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: {
      // Private access: bound to the delegated subnet, resolved via the private
      // DNS zone. publicNetworkAccess is implicitly Disabled in this mode (and
      // firewall rules are not allowed alongside a delegated subnet).
      delegatedSubnetResourceId: postgresSubnetId
      privateDnsZoneArmResourceId: postgresPrivateDnsZone.id
    }
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
  }
  // The DNS zone must be linked to the VNet before the server registers in it.
  dependsOn: [ postgresDnsVnetLink ]
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: postgres
  name: postgresDbName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// ---- Role assignments (toggle with assignRoles; see Lighthouse note in header) ----
resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignRoles) {
  name: guid(acr.id, appIdentity.id, roleIds.acrPull)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.acrPull)
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource kvSecretsUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignRoles) {
  name: guid(keyVault.id, appIdentity.id, roleIds.kvSecretsUser)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.kvSecretsUser)
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource storageBlobAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignRoles) {
  name: guid(storage.id, appIdentity.id, roleIds.storageBlobDataContributor)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.storageBlobDataContributor)
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Deploy identity needs Contributor on the resource group to build in ACR + roll the app.
resource deployContributorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignRoles) {
  name: guid(resourceGroup().id, deployIdentity.id, roleIds.contributor)
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.contributor)
    principalId: deployIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---- Outputs (handy for wiring CI/CD and running the runbook) ----
output containerAppFqdn string = containerApp.properties.configuration.ingress.fqdn
output acrLoginServer string = acr.properties.loginServer
output appIdentityClientId string = appIdentity.properties.clientId
output deployIdentityClientId string = deployIdentity.properties.clientId
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output keyVaultUri string = keyVault.properties.vaultUri
output migrateJobNameOut string = migrateJob.name
