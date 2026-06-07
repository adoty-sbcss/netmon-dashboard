// Surgical, standalone deployment of the NetMon tunnel-broker Container App.
//
// References the EXISTING Container Apps environment / ACR / app identity by
// name (never touches the drifted main.bicep). The broker reuses the web app's
// user-assigned identity (already holds AcrPull) ONLY to pull its image — so
// this adds exactly ONE resource (the broker Container App) and no role
// assignments. Deploy ONLY after `az deployment group what-if`.
//
//   az deployment group what-if -g W2-SBCSS-District-NetMon-Dashboard -f infra/broker.bicep
//   az deployment group create   -g W2-SBCSS-District-NetMon-Dashboard -f infra/broker.bicep
//
// The broker carries the on-demand WebSocket tunnel for the remote console. It
// is a ZERO-SECRET, ZERO-DB stateless relay: for every connection it asks the
// dashboard (DASHBOARD_URL) to verify an opaque one-time session token, then
// bridges the operator's browser to the sensor. No KV secret, no DATABASE_URL.

param location string = resourceGroup().location

// --- existing stack (must already exist; not created here) ---
param environmentName string = 'W2-SBCSS-NetMon-CAE'
param appIdentityName string = 'W2-SBCSS-NetMon-Dash-Identity'
param acrName string = 'w2sbcssnetmondashacr'

// --- broker ---
param brokerAppName string = 'w2-sbcss-netmon-broker'
param brokerImage string = '${acrName}.azurecr.io/netmon-broker:latest'
param brokerPort int = 8080
param brokerCpu string = '0.25'
param brokerMemory string = '0.5Gi'

@description('Dashboard origin the broker calls to validate sessions + record transcripts.')
param dashboardUrl string = 'https://netmon.sbcss.net'

resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: appIdentityName
}
resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: environmentName
}

resource broker 'Microsoft.App/containerApps@2024-03-01' = {
  name: brokerAppName
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
        targetPort: brokerPort
        transport: 'Auto' // carries WebSocket upgrades over 443
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
          name: 'broker'
          image: brokerImage
          resources: {
            cpu: json(brokerCpu)
            memory: brokerMemory
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'BROKER_PORT', value: string(brokerPort) }
            { name: 'DASHBOARD_URL', value: dashboardUrl }
          ]
        }
      ]
      // Warm (min 1) so a session opens instantly; tiny headroom for concurrent sessions.
      scale: {
        minReplicas: 1
        maxReplicas: 2
      }
    }
  }
}

output brokerFqdn string = broker.properties.configuration.ingress.fqdn
