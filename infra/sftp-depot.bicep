// Dedicated SFTP depot for the NetMon project (roadmap item 9).
//
// A PROJECT-ONLY Azure Storage account with SFTP enabled: sensors push their
// hourly bundle ZIPs here, the dashboard ingest job pulls from here. Isolated
// from the dashboard's own storage account so its access/keys/lifecycle are
// scoped to this one job. All NEW resources — touches nothing existing, so the
// `what-if` is purely additive and cannot disturb netmon.sbcss.net.
//
//   az deployment group what-if -g W2-SBCSS-District-NetMon-Dashboard -f infra/sftp-depot.bicep
//   az deployment group create   -g W2-SBCSS-District-NetMon-Dashboard -f infra/sftp-depot.bicep
//
// After deploy, the local user's SSH PASSWORD is generated out-of-band (never in
// bicep/git):
//   az storage account local-user regenerate-password \
//     -n netmon --account-name w2sbcssnetmondepot -g W2-SBCSS-District-NetMon-Dashboard \
//     --query sshPassword -o tsv
// Then store it for ingest (KV) + push it to the fleet via the dashboard SFTP
// rotation (bulkSetSftpAction) when ready to cut over.

@description('Azure region. Defaults to the RG location.')
param location string = resourceGroup().location

@description('Globally-unique depot storage account name (3-24 lowercase alphanumerics).')
param depotAccountName string = 'w2sbcssnetmondepot'

@description('Container that holds the bundle tree.')
param containerName string = 'bundles'

@description('SFTP local user. Sensors/ingest authenticate as "<account>.<localUser>".')
param localUserName string = 'netmon'

// Home = the CONTAINER ROOT. The sensors keep their existing
// /upload/<district>/<school>/<device> paths, which then land at
// bundles/upload/... HNS dirs must pre-exist, but the container root always
// does and the uploader creates the rest recursively.
@description('Home directory for the SFTP local user (container root).')
param homeDirectory string = 'bundles'

resource depot 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: depotAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    // SFTP on Azure Storage requires hierarchical namespace (Data Lake Gen2).
    isHnsEnabled: true
    isSftpEnabled: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    // Shared-key stays on for now (the local user is its own SFTP credential);
    // ingest/admin reach it over SFTP, not the blob REST keys.
    allowSharedKeyAccess: true
    publicNetworkAccess: 'Enabled'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: depot
  name: 'default'
}

resource bundlesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}

resource localUser 'Microsoft.Storage/storageAccounts/localUsers@2023-05-01' = {
  parent: depot
  name: localUserName
  properties: {
    // Password auth (matches the collector's existing sftp_password model). The
    // password value is generated post-deploy via the CLI above, never here.
    hasSshPassword: true
    hasSshKey: false
    homeDirectory: homeDirectory
    permissionScopes: [
      {
        // read, create, write, delete, list — sensors push + overwrite; ingest lists + reads.
        permissions: 'rcwdl'
        service: 'blob'
        resourceName: containerName
      }
    ]
  }
}

output sftpHost string = '${depotAccountName}.blob.core.windows.net'
output sftpUser string = '${depotAccountName}.${localUserName}'
output homeDir string = homeDirectory
