import "server-only";

/**
 * SFTP-2b: per-district scoped SFTP user provisioning on the bundle depot.
 *
 * On district create, the dashboard's managed identity (via the scoped custom
 * role "NetMon SFTP Local User Manager") creates a local SFTP user chroot'd to
 * `bundles/upload/<slug>`, so a leaked sensor credential only exposes that one
 * district's folder. The chroot home must pre-exist, so we first `mkdir` it over
 * SFTP as the depot admin user (no extra Azure data-plane grant needed). The
 * password is stored encrypted and decrypted only to render the deploy installer.
 *
 * Best-effort by design: callers tolerate failure (the district is still created
 * and the deploy card falls back to the shared fleet SFTP).
 */
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { districtSftp } from "@/db/schema/management";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secret-box";

const DEPOT_ACCOUNT = process.env.DEPOT_SFTP_ACCOUNT ?? "w2sbcssnetmondepot";
const DEPOT_RG = process.env.DEPOT_SFTP_RG ?? "W2-SBCSS-District-NetMon-Dashboard";
const DEPOT_CONTAINER = "bundles";
const DEPOT_HOST = `${DEPOT_ACCOUNT}.blob.core.windows.net`;

export interface DistrictSftpCreds {
  username: string;
  password: string;
  host: string;
  port: number;
  remotePath: string;
}

/** Managed-identity credential for ARM + Data Lake (the UAMI assigned to the web app). */
async function credential() {
  const { ManagedIdentityCredential } = await import("@azure/identity");
  return new ManagedIdentityCredential({ clientId: process.env.AZURE_MANAGED_IDENTITY_CLIENT_ID! });
}

/** True when the env needed to talk to Azure (ARM + Data Lake) is present. */
export function sftpProvisioningConfigured(): boolean {
  return Boolean(process.env.AZURE_SUBSCRIPTION_ID && process.env.AZURE_MANAGED_IDENTITY_CLIENT_ID);
}

/**
 * Create the per-district chroot home over HTTPS/443 via the Data Lake API (the
 * new local user can't create its own chroot root). Uses the managed identity +
 * Storage Blob Data Contributor on the depot. NOT over SFTP: a VNet-injected
 * Container App can't reliably make outbound port-22 connections.
 */
async function ensureHomeDir(slug: string): Promise<void> {
  const { DataLakeServiceClient } = await import("@azure/storage-file-datalake");
  const svc = new DataLakeServiceClient(`https://${DEPOT_ACCOUNT}.dfs.core.windows.net`, await credential());
  const fs = svc.getFileSystemClient(DEPOT_CONTAINER);
  await fs.getDirectoryClient(`upload/${slug}`).createIfNotExists();
}

/**
 * Idempotently mint (or refresh) a district's scoped SFTP user and store its
 * creds encrypted. Returns the live creds. Throws if not configured or Azure
 * rejects — callers treat it as best-effort.
 */
export async function ensureDistrictSftpUser(
  districtId: number,
  slug: string,
): Promise<DistrictSftpCreds> {
  if (!sftpProvisioningConfigured()) {
    throw new Error("SFTP provisioning not configured (AZURE_SUBSCRIPTION_ID / AZURE_MANAGED_IDENTITY_CLIENT_ID)");
  }
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!;
  const homeDir = `${DEPOT_CONTAINER}/upload/${slug}`;
  // Azure SFTP local-user NAMES allow lowercase letters + digits ONLY (no dashes),
  // 3–64 chars, unique per account. Derive a valid, deterministic, unique name
  // from the slug (dash-free) + the districtId (guarantees uniqueness). The folder
  // (homeDir) keeps the readable dashed slug — dashes are fine in blob paths.
  const localName = (`nm${slug.replace(/[^a-z0-9]/g, "")}`).slice(0, 60) + String(districtId);

  // 1. chroot home must exist before the user can write to it (HTTPS/443).
  await ensureHomeDir(slug);

  // 2. Create/refresh the local user (management plane) via the scoped role.
  const { StorageManagementClient } = await import("@azure/arm-storage");
  const client = new StorageManagementClient(await credential(), subscriptionId);

  await client.localUsers.createOrUpdate(DEPOT_RG, DEPOT_ACCOUNT, localName, {
    hasSshPassword: true,
    hasSshKey: false,
    homeDirectory: homeDir,
    permissionScopes: [{ permissions: "rcwdl", service: "blob", resourceName: DEPOT_CONTAINER }],
  });

  // 3. Generate the password (returned once).
  const result = await client.localUsers.regeneratePassword(DEPOT_RG, DEPOT_ACCOUNT, localName);
  const password = result.sshPassword;
  if (!password) throw new Error("Azure did not return an SFTP password");

  const username = `${DEPOT_ACCOUNT}.${localName}`;
  await db
    .insert(districtSftp)
    .values({ districtId, username, passwordEnc: encryptSecret(password), homeDir })
    .onConflictDoUpdate({
      target: districtSftp.districtId,
      set: { username, passwordEnc: encryptSecret(password), homeDir, updatedAt: new Date() },
    });

  return { username, password, host: DEPOT_HOST, port: 22, remotePath: "/" };
}

/**
 * Read a district's stored scoped SFTP creds (decrypted), or null if not minted.
 * The sensor is chroot'd to its district folder; remotePath stays "/" and the
 * collector appends its own <district>/<school>/<device> beneath it. (Ingest
 * derives identity from scan.json, not the path, so the nesting is cosmetic.)
 */
export async function getDistrictSftpCreds(districtId: number): Promise<DistrictSftpCreds | null> {
  const [row] = await db
    .select()
    .from(districtSftp)
    .where(eq(districtSftp.districtId, districtId))
    .limit(1);
  if (!row) return null;
  let password: string;
  try {
    password = decryptSecret(row.passwordEnc);
  } catch {
    return null;
  }
  return { username: row.username, password, host: DEPOT_HOST, port: 22, remotePath: "/" };
}
