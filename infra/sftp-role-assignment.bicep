// Grant the dashboard app identity the scoped custom role on the SFTP depot ONLY,
// so the dashboard can auto-mint per-district SFTP local users at runtime (SFTP-2b).
// Deployed via `az deployment group create` (the `az role assignment` CLI hits a
// MissingSubscription quirk in this environment; the deployment API is reliable).
//
//   az deployment group what-if -g W2-SBCSS-District-NetMon-Dashboard -f infra/sftp-role-assignment.bicep
//   az deployment group create   -g W2-SBCSS-District-NetMon-Dashboard -f infra/sftp-role-assignment.bicep

@description('Depot storage account (existing).')
param depotAccountName string = 'w2sbcssnetmondepot'

@description('Principal id (object id) of the dashboard app user-assigned identity.')
param principalId string = 'a85f32f1-ccc1-4a03-b44c-c3e1f9ebc431'

@description('GUID of the custom "NetMon SFTP Local User Manager" role definition.')
param roleDefinitionGuid string = '23e23399-f47c-44d5-a3ce-03f6a3588d75'

resource depot 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: depotAccountName
}

// Idempotent name (deterministic GUID from scope+principal+role) so re-deploys are no-ops.
resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(depot.id, principalId, roleDefinitionGuid)
  scope: depot
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleDefinitionGuid)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

// Storage Blob Data Contributor (built-in) scoped to the depot ONLY. Lets the
// dashboard create each district's home DIRECTORY (bundles/upload/<slug>) over
// HTTPS/443 via the Data Lake API — VNet-injected Container Apps can't reliably
// open outbound port-22 SFTP, so directory creation can't go over SFTP.
var blobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
resource blobContribAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(depot.id, principalId, blobDataContributorRoleId)
  scope: depot
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      blobDataContributorRoleId
    )
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
