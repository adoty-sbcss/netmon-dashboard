"use server";

/**
 * Operator controls for SNMP crawl scope + inventory cleanup:
 *  - setSchoolSnmpAction      — master SNMP-crawl switch for a whole school.
 *  - purgeDeviceAction        — reversibly exclude one device + stop polling it.
 *  - purgeAllDiscoveredAction — bulk-exclude every purely-discovered device.
 *  - restoreDeviceAction      — bring a purged device back.
 *
 * Purging a device sets `excludedAt` (hidden from inventory/map, survives
 * re-ingestion) AND pushes the device's mgmt IP into each sensor's
 * `desired_config.snmp_exclude`, so the collector's crawl stops polling/recursing
 * through it. All pushes MERGE into the existing config (never clobber).
 */
import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { sensors, auditLog } from "@/db/schema/app";
import { desiredConfig } from "@/db/schema/management";
import { entitiesSwitch, entitiesHost } from "@/db/schema/entities";
import { schoolPolicy } from "@/db/schema/policy";
import { registryDevices } from "@/db/schema/registry";
import { getSessionUser } from "@/lib/auth/current-user";
import type { InventoryActionState } from "./actions";
import { excludedIpsForSchool, getInventoryForSchool } from "./queries";

async function requireAdmin() {
  const user = await getSessionUser();
  return user?.role === "superadmin" ? user : null;
}

/** Merge a config patch into every sensor's desired_config at a school, bumping version. */
async function patchSchoolSensors(
  schoolId: number,
  patch: (cur: Record<string, unknown>) => Record<string, unknown>,
  adminId: number,
): Promise<number> {
  const schoolSensors = await db.select().from(sensors).where(eq(sensors.schoolId, schoolId));
  for (const sensor of schoolSensors) {
    const [existing] = await db
      .select()
      .from(desiredConfig)
      .where(eq(desiredConfig.sensorId, sensor.id));
    const curConfig = (existing?.config as Record<string, unknown>) ?? {};
    const nextConfig = patch({ ...curConfig });
    const nextVersion = (existing?.configVersion ?? 0) + 1;
    await db
      .insert(desiredConfig)
      .values({ sensorId: sensor.id, configVersion: nextVersion, config: nextConfig, updatedBy: adminId })
      .onConflictDoUpdate({
        target: desiredConfig.sensorId,
        set: { configVersion: nextVersion, config: nextConfig, updatedBy: adminId, updatedAt: new Date() },
      });
  }
  return schoolSensors.length;
}

/** Recompute the school's excluded-IP set and push it to every sensor as snmp_exclude. */
async function pushSnmpExclude(schoolId: number, adminId: number): Promise<void> {
  const ips = await excludedIpsForSchool(schoolId);
  await patchSchoolSensors(schoolId, (cur) => ({ ...cur, snmp_exclude: ips.join(",") }), adminId);
}

function parseKey(key: string): { kind: "sw" | "host"; id: number } | null {
  const m = /^(sw|host):(\d+)$/.exec(key);
  if (!m) return null;
  return { kind: m[1] as "sw" | "host", id: Number(m[2]) };
}

async function retireRegistry(id: number, adminId: number): Promise<void> {
  await db
    .update(registryDevices)
    .set({
      status: "retired",
      retiredReason: "purged from inventory",
      retiredAt: new Date(),
      updatedBy: adminId,
    })
    .where(eq(registryDevices.id, id));
}

/** Purge (reversibly exclude) one device, retire any linked registry entry, and
 *  stop the school's sensors from SNMP-polling it. */
export async function purgeDeviceAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  if (!admin) return;
  const schoolId = Number(formData.get("schoolId"));
  const basePath = String(formData.get("basePath") ?? "");
  const key = String(formData.get("key") ?? "");
  const registryId = Number(formData.get("registryId") ?? "");
  if (!Number.isInteger(schoolId)) return;

  if (key.startsWith("reg:")) {
    const rid = Number(key.slice(4));
    if (Number.isInteger(rid)) await retireRegistry(rid, admin.id);
  } else {
    const parsed = parseKey(key);
    if (!parsed) return;
    const set = { excludedAt: new Date(), excludedBy: admin.id };
    if (parsed.kind === "sw") {
      await db.update(entitiesSwitch).set(set).where(eq(entitiesSwitch.id, parsed.id));
    } else {
      await db.update(entitiesHost).set(set).where(eq(entitiesHost.id, parsed.id));
    }
    // A registered ("both") device: retire its registry record too so it doesn't
    // reappear as a manual-only ghost.
    if (Number.isInteger(registryId) && registryId > 0) await retireRegistry(registryId, admin.id);
  }

  await pushSnmpExclude(schoolId, admin.id);
  await db.insert(auditLog).values({
    actorType: "user",
    actor: admin.email,
    action: "device_purged",
    detail: { schoolId, key },
  });
  revalidatePath(`${basePath}/inventory`);
  revalidatePath(`${basePath}/map`);
}

/** Restore (un-exclude) a previously purged device. */
export async function restoreDeviceAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  if (!admin) return;
  const schoolId = Number(formData.get("schoolId"));
  const basePath = String(formData.get("basePath") ?? "");
  const key = String(formData.get("key") ?? "");
  if (!Number.isInteger(schoolId)) return;
  const parsed = parseKey(key);
  if (!parsed) return;

  const set = { excludedAt: null, excludedBy: null };
  if (parsed.kind === "sw") {
    await db.update(entitiesSwitch).set(set).where(eq(entitiesSwitch.id, parsed.id));
  } else {
    await db.update(entitiesHost).set(set).where(eq(entitiesHost.id, parsed.id));
  }
  await pushSnmpExclude(schoolId, admin.id);
  await db.insert(auditLog).values({
    actorType: "user",
    actor: admin.email,
    action: "device_restored",
    detail: { schoolId, key },
  });
  revalidatePath(`${basePath}/inventory`);
  revalidatePath(`${basePath}/map`);
}

/** Bulk-purge every purely-discovered device at the school (keeps registered + manual gear). */
export async function purgeAllDiscoveredAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const schoolId = Number(formData.get("schoolId"));
  const basePath = String(formData.get("basePath") ?? "");
  if (!Number.isInteger(schoolId)) return { error: "Invalid school." };

  const inv = await getInventoryForSchool(schoolId);
  const swIds: number[] = [];
  const hostIds: number[] = [];
  for (const r of inv.rows) {
    if (r.source !== "discovered") continue; // preserve registered + manual
    if (r.switchId) swIds.push(r.switchId);
    else if (r.hostId) hostIds.push(r.hostId);
  }
  if (swIds.length === 0 && hostIds.length === 0)
    return { ok: true, message: "Nothing to purge — every device is registered or manual." };

  const set = { excludedAt: new Date(), excludedBy: admin.id };
  if (swIds.length) await db.update(entitiesSwitch).set(set).where(inArray(entitiesSwitch.id, swIds));
  if (hostIds.length) await db.update(entitiesHost).set(set).where(inArray(entitiesHost.id, hostIds));

  await pushSnmpExclude(schoolId, admin.id);
  const n = swIds.length + hostIds.length;
  await db.insert(auditLog).values({
    actorType: "user",
    actor: admin.email,
    action: "devices_bulk_purged",
    detail: { schoolId, count: n },
  });
  revalidatePath(`${basePath}/inventory`);
  revalidatePath(`${basePath}/map`);
  return {
    ok: true,
    message: `Purged ${n} discovered device(s). Sensors stop SNMP-polling them on the next check-in — restore any from the Excluded tab.`,
  };
}

/** Valid effective device types for manual reclassify (mirrors entities_host). */
const DEVICE_TYPES = new Set([
  "switch", "router", "ap", "firewall", "printer", "phone", "camera",
  "computer", "server", "mobile", "storage", "iot", "vm", "unknown",
]);

/** Bulk-purge (reversibly exclude) the SELECTED devices. items = JSON array of
 *  { key: "sw:N"|"host:N"|"reg:N", registryId?: number }. */
export async function bulkPurgeDevicesAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const schoolId = Number(formData.get("schoolId"));
  const basePath = String(formData.get("basePath") ?? "");
  if (!Number.isInteger(schoolId)) return { error: "Invalid school." };

  let items: { key?: string; registryId?: number | null }[] = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "Bad selection." };
  }
  if (!Array.isArray(items) || items.length === 0) return { error: "Nothing selected." };

  const swIds: number[] = [];
  const hostIds: number[] = [];
  const regIds = new Set<number>();
  for (const it of items) {
    if (typeof it?.key !== "string") continue;
    if (it.key.startsWith("reg:")) {
      const rid = Number(it.key.slice(4));
      if (Number.isInteger(rid)) regIds.add(rid);
      continue;
    }
    const parsed = parseKey(it.key);
    if (!parsed) continue;
    if (parsed.kind === "sw") swIds.push(parsed.id);
    else hostIds.push(parsed.id);
    if (Number.isInteger(it.registryId) && (it.registryId as number) > 0)
      regIds.add(it.registryId as number);
  }
  if (swIds.length === 0 && hostIds.length === 0 && regIds.size === 0)
    return { error: "Nothing valid selected." };

  const set = { excludedAt: new Date(), excludedBy: admin.id };
  await db.transaction(async (tx) => {
    if (swIds.length) await tx.update(entitiesSwitch).set(set).where(inArray(entitiesSwitch.id, swIds));
    if (hostIds.length) await tx.update(entitiesHost).set(set).where(inArray(entitiesHost.id, hostIds));
    if (regIds.size)
      await tx
        .update(registryDevices)
        .set({ status: "retired", retiredReason: "purged from inventory", retiredAt: new Date(), updatedBy: admin.id })
        .where(inArray(registryDevices.id, [...regIds]));
  });

  await pushSnmpExclude(schoolId, admin.id);
  const n = swIds.length + hostIds.length + regIds.size;
  await db.insert(auditLog).values({
    actorType: "user", actor: admin.email, action: "devices_bulk_purged",
    detail: { schoolId, count: n },
  });
  revalidatePath(`${basePath}/inventory`);
  revalidatePath(`${basePath}/map`);
  return {
    ok: true,
    message: `Purged ${n} device(s) — hidden from the inventory + map; sensors stop SNMP-polling them on the next check-in. Restore any from the Excluded tab.`,
  };
}

/** Bulk-reclassify SELECTED discovered hosts. Sets a sticky manual override on
 *  entities_host that wins over the auto type and survives re-scans. hostIds =
 *  JSON array of entities_host ids; deviceType = one of DEVICE_TYPES. */
export async function bulkReclassifyDevicesAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const schoolId = Number(formData.get("schoolId"));
  const basePath = String(formData.get("basePath") ?? "");
  const deviceType = String(formData.get("deviceType") ?? "");
  if (!Number.isInteger(schoolId)) return { error: "Invalid school." };
  if (!DEVICE_TYPES.has(deviceType)) return { error: "Pick a device type." };

  let hostIds: number[] = [];
  try {
    hostIds = (JSON.parse(String(formData.get("hostIds") ?? "[]")) as unknown[])
      .map(Number)
      .filter((n) => Number.isInteger(n));
  } catch {
    return { error: "Bad selection." };
  }
  if (hostIds.length === 0)
    return {
      error:
        "Reclassify applies to discovered hosts — none were selected. (Switches and manual records keep their own type.)",
    };

  await db
    .update(entitiesHost)
    .set({ deviceTypeOverride: deviceType })
    .where(inArray(entitiesHost.id, hostIds));

  await db.insert(auditLog).values({
    actorType: "user", actor: admin.email, action: "devices_bulk_reclassified",
    detail: { schoolId, count: hostIds.length, deviceType },
  });
  revalidatePath(`${basePath}/inventory`);
  revalidatePath(`${basePath}/map`);
  return {
    ok: true,
    message: `Reclassified ${hostIds.length} device(s) as “${deviceType}” — sticks across future scans.`,
  };
}

/** Bulk-restore (un-exclude) SELECTED purged devices. keys = JSON array. */
export async function bulkRestoreDevicesAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const schoolId = Number(formData.get("schoolId"));
  const basePath = String(formData.get("basePath") ?? "");
  if (!Number.isInteger(schoolId)) return { error: "Invalid school." };
  let keys: string[] = [];
  try {
    keys = (JSON.parse(String(formData.get("keys") ?? "[]")) as unknown[]).map(String);
  } catch {
    return { error: "Bad selection." };
  }
  const swIds: number[] = [];
  const hostIds: number[] = [];
  for (const k of keys) {
    const parsed = parseKey(k);
    if (!parsed) continue;
    if (parsed.kind === "sw") swIds.push(parsed.id);
    else hostIds.push(parsed.id);
  }
  if (swIds.length === 0 && hostIds.length === 0) return { error: "Nothing selected." };
  const set = { excludedAt: null, excludedBy: null };
  if (swIds.length) await db.update(entitiesSwitch).set(set).where(inArray(entitiesSwitch.id, swIds));
  if (hostIds.length) await db.update(entitiesHost).set(set).where(inArray(entitiesHost.id, hostIds));
  await pushSnmpExclude(schoolId, admin.id);
  const n = swIds.length + hostIds.length;
  await db.insert(auditLog).values({
    actorType: "user", actor: admin.email, action: "devices_bulk_restored",
    detail: { schoolId, count: n },
  });
  revalidatePath(`${basePath}/inventory`);
  revalidatePath(`${basePath}/map`);
  return { ok: true, message: `Restored ${n} device(s).` };
}

/** Turn the SNMP crawl on/off for the whole school (fans out to every sensor). */
export async function setSchoolSnmpAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const schoolId = Number(formData.get("schoolId"));
  const basePath = String(formData.get("basePath") ?? "");
  const enabled = String(formData.get("enabled")) === "true";
  if (!Number.isInteger(schoolId)) return { error: "Invalid school." };

  await db
    .insert(schoolPolicy)
    .values({ schoolId, snmpEnabled: enabled, updatedBy: admin.id })
    .onConflictDoUpdate({
      target: schoolPolicy.schoolId,
      set: { snmpEnabled: enabled, updatedBy: admin.id, updatedAt: new Date() },
    });

  const n = await patchSchoolSensors(schoolId, (cur) => ({ ...cur, snmp_enabled: enabled }), admin.id);
  await db.insert(auditLog).values({
    actorType: "user",
    actor: admin.email,
    action: "school_snmp_set",
    detail: { schoolId, enabled },
  });
  revalidatePath(`${basePath}/inventory`);
  return {
    ok: true,
    message: enabled
      ? `SNMP crawl enabled — pushed to ${n} sensor(s); applies on each one's next check-in.`
      : `SNMP crawl disabled for the school — pushed to ${n} sensor(s); applies on each one's next check-in.`,
  };
}
