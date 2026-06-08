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
