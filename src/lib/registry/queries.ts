/**
 * Server-only data access for the equipment registry. Reads registry_devices
 * and resolves each device's lifecycle (EOL/EOS/firmware) by (vendor, model)
 * against lifecycle_models.
 */
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { registryDevices, lifecycleModels } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto/secret-box";

export interface RegistryDeviceRow {
  id: number;
  districtId: number;
  schoolId: number | null;
  name: string;
  deviceType: string;
  deviceTypeOther: string | null;
  ip: string | null;
  mac: string | null;
  vendor: string | null;
  model: string | null;
  building: string | null;
  room: string | null;
  monitorType: string;
  hasSnmpCommunity: boolean;
  firmwareCurrent: string | null;
  status: string;
  notes: string | null;
  linkedHostId: number | null;
  linkedSwitchId: number | null;
  retiredReason: string | null;
  retiredAt: Date | null;
  source: string;
  updatedAt: Date | null;
  // Resolved from lifecycle_models by (vendor, model):
  eolDate: string | null;
  endOfSaleDate: string | null;
  eosDate: string | null;
  latestFirmware: string | null;
}

function lifecycleKey(vendor: string | null, model: string | null): string | null {
  if (!vendor || !model) return null;
  return `${vendor.trim().toLowerCase()}|${model.trim().toLowerCase()}`;
}

/** Fetch lifecycle rows for the vendors present, keyed by `${vendor}|${model}`. */
async function resolveLifecycle(
  devices: { vendor: string | null; model: string | null }[],
): Promise<Map<string, typeof lifecycleModels.$inferSelect>> {
  const vendors = [
    ...new Set(
      devices
        .map((d) => d.vendor?.trim().toLowerCase())
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const out = new Map<string, typeof lifecycleModels.$inferSelect>();
  if (vendors.length === 0) return out;
  const rows = await db
    .select()
    .from(lifecycleModels)
    .where(inArray(lifecycleModels.vendor, vendors));
  for (const r of rows) {
    out.set(`${r.vendor.toLowerCase()}|${r.model.toLowerCase()}`, r);
  }
  return out;
}

function shape(
  d: typeof registryDevices.$inferSelect,
  life: Map<string, typeof lifecycleModels.$inferSelect>,
): RegistryDeviceRow {
  const key = lifecycleKey(d.vendor, d.model);
  const lc = key ? life.get(key) : undefined;
  return {
    id: d.id,
    districtId: d.districtId,
    schoolId: d.schoolId,
    name: d.name,
    deviceType: d.deviceType,
    deviceTypeOther: d.deviceTypeOther,
    ip: d.ip,
    mac: d.mac,
    vendor: d.vendor,
    model: d.model,
    building: d.building,
    room: d.room,
    monitorType: d.monitorType,
    hasSnmpCommunity: Boolean(d.snmpCommunityEnc),
    firmwareCurrent: d.firmwareCurrent,
    status: d.status,
    notes: d.notes,
    linkedHostId: d.linkedHostId,
    linkedSwitchId: d.linkedSwitchId,
    retiredReason: d.retiredReason,
    retiredAt: d.retiredAt,
    source: d.source,
    updatedAt: d.updatedAt,
    eolDate: lc?.eolDate ?? null,
    endOfSaleDate: lc?.endOfSaleDate ?? null,
    eosDate: lc?.eosDate ?? null,
    latestFirmware: lc?.latestFirmware ?? null,
  };
}

export async function listRegistryDevices(opts: {
  districtId?: number;
  schoolId?: number;
  includeRetired?: boolean;
}): Promise<RegistryDeviceRow[]> {
  const conds = [];
  if (opts.schoolId != null) conds.push(eq(registryDevices.schoolId, opts.schoolId));
  else if (opts.districtId != null)
    conds.push(eq(registryDevices.districtId, opts.districtId));
  if (!opts.includeRetired) conds.push(eq(registryDevices.status, "active"));

  const rows = await db
    .select()
    .from(registryDevices)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(registryDevices.updatedAt));

  const life = await resolveLifecycle(rows);
  return rows.map((d) => shape(d, life));
}

/** Same as listRegistryDevices but returns ALL statuses (incl. retired). */
export function listAllRegistryDevices(opts: {
  districtId?: number;
  schoolId?: number;
}): Promise<RegistryDeviceRow[]> {
  return listRegistryDevices({ ...opts, includeRetired: true });
}

export async function getRegistryDevice(
  id: number,
): Promise<RegistryDeviceRow | null> {
  const [d] = await db
    .select()
    .from(registryDevices)
    .where(eq(registryDevices.id, id))
    .limit(1);
  if (!d) return null;
  const life = await resolveLifecycle([d]);
  return shape(d, life);
}

/**
 * Decrypt a device's stored SNMP community for the edit form (superadmin only —
 * caller must enforce). Returns null if none set or decryption fails.
 */
export async function getRegistrySnmpCommunity(id: number): Promise<string | null> {
  const [d] = await db
    .select({ enc: registryDevices.snmpCommunityEnc })
    .from(registryDevices)
    .where(eq(registryDevices.id, id))
    .limit(1);
  if (!d?.enc) return null;
  try {
    return decryptSecret(d.enc);
  } catch {
    return null;
  }
}

export async function countRegistryDevices(districtId: number): Promise<number> {
  const rows = await db
    .select({ id: registryDevices.id })
    .from(registryDevices)
    .where(
      and(
        eq(registryDevices.districtId, districtId),
        eq(registryDevices.status, "active"),
      ),
    );
  return rows.length;
}
