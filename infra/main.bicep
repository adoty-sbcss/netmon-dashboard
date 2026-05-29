// =============================================================================
// netmon-dashboard — full Azure stack as Infrastructure as Code.
//
// Recreates the entire environment in one deploy: Log Analytics, two managed
// identities (+ GitHub OIDC federated credential), Key Vault, Storage, ACR,
// Container Apps environment + web app, and PostgreSQL Flexible Server.
//
// Scope: resource group. Deploy with (PowerShell or bash):
//   az deployment group create \
//     -g W2-SBCSS-District-NetMon-Dashboard \
//     -f infra/main.bicep \
//     -p infra/main.bicepparam
//
// The Postgres admin password is a secure parameter — see main.bicepparam
// (read from the PG_ADMIN_PASSWORD environment variable, never committed).
//
// COLD-REBUILD ORDERING: on a from-scratch rebuild the ACR starts empty, so the
// container image won't exist yet. Either (a) set param `containerImage` to a
// public placeholder for the first deploy and let the GitHub Actions pipeline
// roll the real image, or (b) run `az acr build -r <acr> -t netmon-dashboard:latest .`
// once after ACR exists, then re-deploy. The default below points at the ACR
// image and assumes it has been built at least once.
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
param environmentName string = 'W2-SBCSS-NetMon-CAE'
param containerAppName string = 'w2-sbcss-netmon-web'
param postgresServerName string = 'w2-sbcss-netmon-psql'
param postgresDbName string = 'netmon'
param postgresAdminUser string = 'netmonadmin'

@secure()
@description('PostgreSQL administrator password. Supplied at deploy time, never stored in the repo.')
param postgresAdminPassword string

@description('GitHub repo (owner/name) trusted for OIDC deploys.')
param githubRepo string = 'adoty-sbcss/netmon-dashboard'

@description('Git branch allowed to deploy via the federated credential.')
param githubBranch string = 'main'

@description('Optional client IP allowed through the Postgres firewall (e.g. your workstation). Leave empty to skip.')
param clientIpAddress string = ''

@description('Allow other Azure services to reach Postgres (0.0.0.0 firewall rule). Needed once the app queries the DB.')
param allowAzureServicesToPostgres bool = false

@description('Container image the web app runs. Defaults to the ACR image; must exist before deploy (see header).')
param containerImage string = '${acrName}.azurecr.io/netmon-dashboard:latest'

param containerCpu string = '0.5'
param containerMemory string = '1.0Gi'

@description('Create the RBAC role assignments. Set false if Lighthouse blocks them and assign in the Portal instead.')
param assignRoles bool = true

// ---- Built-in role definition IDs ----
var roleIds = {
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
  kvSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  contributor: 'b24988ac-6180-42a0-ab88-20f7382dd24c'
}

// ---- Log Analytics ----
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
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

// ---- Container Apps environment (logs -> Log Analytics) ----
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
  }
}

// ---- Web Container App (scale-to-zero, pulls from ACR via app identity) ----
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
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
  dependsOn: assignRoles ? [ acrPullAssignment ] : []
}

// ---- PostgreSQL Flexible Server ----
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
    network: { publicNetworkAccess: 'Enabled' }
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
  }
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: postgres
  name: postgresDbName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource postgresClientFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = if (!empty(clientIpAddress)) {
  parent: postgres
  name: 'AllowClientIp'
  properties: {
    startIpAddress: clientIpAddress
    endIpAddress: clientIpAddress
  }
}

resource postgresAzureFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = if (allowAzureServicesToPostgres) {
  parent: postgres
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
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

// ---- Outputs (handy for wiring CI/CD and connection strings) ----
output containerAppFqdn string = containerApp.properties.configuration.ingress.fqdn
output acrLoginServer string = acr.properties.loginServer
output appIdentityClientId string = appIdentity.properties.clientId
output deployIdentityClientId string = deployIdentity.properties.clientId
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output keyVaultUri string = keyVault.properties.vaultUri
