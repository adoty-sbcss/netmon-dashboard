"use server";

/**
 * CSV import for the equipment registry. Two phases so we NEVER silently
 * overwrite: preview (parse + tag each row new/duplicate/error), then commit
 * with an explicit duplicate strategy (skip | overwrite | merge).
 *
 * Duplicate detection is by normalized MAC first, then IP, against the existing
 * registry rows in the same district.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { registryDevices } from "@/db/schema";
import { auditLog } from "@/db/schema/app";
import { getSessionUser } from "@/lib/auth/current-user";
import { encryptSecret } from "@/lib/crypto/secret-box";
import { parseCsv, type DeviceRow } from "@/ingest/bundle";
import { syncRegistryCommunitiesToSensors } from "./sensor-sync";
import {
  isMonitorType,
  isRegistryDeviceType,
  isRegistryStatus,
  normalizeMac,
} from "./types";

export type DuplicateStrategy = "skip" | "overwrite" | "merge";

export interface ImportPreviewRow {
  index: number;
  name: string;
  deviceType: string;
  ip: string | null;
  mac: string | null;
  status: "new" | "duplicate" | "error";
  matchId?: number;
  matchName?: string;
  error?: string;
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  newCount: number;
  dupCount: number;
  errorCount: number;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

interface ParsedDevice {
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
  snmpCommunity: string | null;
  firmwareCurrent: string | null;
  status: string;
  notes: string | null;
}

function field(r: DeviceRow, k: string): string | null {
  const v = (r[k] ?? "").trim();
  return v === "" ? null : v;
}

/** Parse + validate one CSV row into an insertable shape, or an error. */
function parseRow(r: DeviceRow): { ok: true; value: ParsedDevice } | { ok: false; error: string } {
  const name = field(r, "name");
  if (!name) return { ok: false, error: "Missing name" };

  const rawType = (field(r, "device_type") ?? "unknown").toLowerCase();
  let deviceType = rawType;
  let deviceTypeOther: string | null = null;
  if (deviceType !== "unknown" && !isRegistryDeviceType(deviceType)) {
    // Unrecognized type → keep the operator's label under 'other'.
    deviceTypeOther = field(r, "device_type");
    deviceType = "other";
  } else if (deviceType === "other") {
    deviceTypeOther = field(r, "device_type_other") ?? name;
  }

  let monitorType = (field(r, "monitor_type") ?? "none").toLowerCase();
  if (!isMonitorType(monitorType)) monitorType = "none";

  let status = (field(r, "status") ?? "active").toLowerCase();
  if (!isRegistryStatus(status)) status = "active";

  return {
    ok: true,
    value: {
      name,
      deviceType,
      deviceTypeOther,
      ip: field(r, "ip"),
      mac: normalizeMac(field(r, "mac")),
      vendor: field(r, "vendor"),
      model: field(r, "model"),
      building: field(r, "building"),
      room: field(r, "room"),
      monitorType,
      snmpCommunity: field(r, "snmp_community"),
      firmwareCurrent: field(r, "firmware_current"),
      status,
      notes: field(r, "notes"),
    },
  };
}

async function existingIndex(districtId: number) {
  const rows = await db
    .select({
      id: registryDevices.id,
      name: registryDevices.name,
      mac: registryDevices.mac,
      ip: registryDevices.ip,
    })
    .from(registryDevices)
    .where(eq(registryDevices.districtId, districtId));
  const byMac = new Map<string, { id: number; name: string }>();
  const byIp = new Map<string, { id: number; name: string }>();
  for (const r of rows) {
    if (r.mac) byMac.set(r.mac.toLowerCase(), { id: r.id, name: r.name });
    if (r.ip) byIp.set(r.ip, { id: r.id, name: r.name });
  }
  return { byMac, byIp };
}

function findDup(
  d: ParsedDevice,
  idx: { byMac: Map<string, { id: number; name: string }>; byIp: Map<string, { id: number; name: string }> },
) {
  if (d.mac) {
    const m = idx.byMac.get(d.mac.toLowerCase());
    if (m) return m;
  }
  if (d.ip) {
    const m = idx.byIp.get(d.ip);
    if (m) return m;
  }
  return null;
}

async function requireAdmin() {
  const user = await getSessionUser();
  return user?.role === "superadmin" ? user : null;
}

/** Phase 1: parse the CSV and tag each row without writing anything. */
export async function previewRegistryCsvAction(input: {
  districtId: number;
  csv: string;
}): Promise<ImportPreview | { error: string }> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  let parsed: DeviceRow[];
  try {
    parsed = parseCsv(input.csv);
  } catch {
    return { error: "Could not parse the CSV." };
  }
  if (parsed.length === 0) return { error: "No rows found (need a header row + data)." };

  const idx = await existingIndex(input.districtId);
  const rows: ImportPreviewRow[] = [];
  let newCount = 0,
    dupCount = 0,
    errorCount = 0;

  parsed.forEach((raw, i) => {
    const p = parseRow(raw);
    if (!p.ok) {
      rows.push({ index: i, name: raw.name ?? `Row ${i + 1}`, deviceType: "", ip: null, mac: null, status: "error", error: p.error });
      errorCount++;
      return;
    }
    const dup = findDup(p.value, idx);
    if (dup) {
      rows.push({ index: i, name: p.value.name, deviceType: p.value.deviceType, ip: p.value.ip, mac: p.value.mac, status: "duplicate", matchId: dup.id, matchName: dup.name });
      dupCount++;
    } else {
      rows.push({ index: i, name: p.value.name, deviceType: p.value.deviceType, ip: p.value.ip, mac: p.value.mac, status: "new" });
      newCount++;
    }
  });

  return { rows, newCount, dupCount, errorCount };
}

/** Phase 2: commit the import with an explicit duplicate strategy. */
export async function commitRegistryCsvAction(input: {
  districtId: number;
  schoolId: number | null;
  basePath: string;
  csv: string;
  strategy: DuplicateStrategy;
}): Promise<ImportResult | { error: string }> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  let parsed: DeviceRow[];
  try {
    parsed = parseCsv(input.csv);
  } catch {
    return { error: "Could not parse the CSV." };
  }
  const idx = await existingIndex(input.districtId);
  const res: ImportResult = { created: 0, updated: 0, skipped: 0, errors: 0 };

  for (const raw of parsed) {
    const p = parseRow(raw);
    if (!p.ok) {
      res.errors++;
      continue;
    }
    const d = p.value;
    const enc = d.snmpCommunity ? { snmpCommunityEnc: encryptSecret(d.snmpCommunity) } : {};
    const common = {
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
      firmwareCurrent: d.firmwareCurrent,
      status: d.status,
      notes: d.notes,
    };

    const dup = findDup(d, idx);
    if (dup) {
      if (input.strategy === "skip") {
        res.skipped++;
        continue;
      }
      if (input.strategy === "overwrite") {
        await db
          .update(registryDevices)
          .set({ ...common, ...enc, updatedBy: admin.id, updatedAt: new Date() })
          .where(eq(registryDevices.id, dup.id));
        res.updated++;
        continue;
      }
      // merge: only fill columns that are currently empty.
      const [cur] = await db.select().from(registryDevices).where(eq(registryDevices.id, dup.id));
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(common)) {
        if (v != null && (cur as Record<string, unknown>)[k] == null) patch[k] = v;
      }
      if (d.snmpCommunity && !cur.snmpCommunityEnc) patch.snmpCommunityEnc = encryptSecret(d.snmpCommunity);
      if (Object.keys(patch).length > 0) {
        await db
          .update(registryDevices)
          .set({ ...patch, updatedBy: admin.id, updatedAt: new Date() })
          .where(eq(registryDevices.id, dup.id));
        res.updated++;
      } else {
        res.skipped++;
      }
      continue;
    }

    // New row
    await db.insert(registryDevices).values({
      districtId: input.districtId,
      schoolId: input.schoolId,
      ...common,
      ...enc,
      source: "csv",
      createdBy: admin.id,
    });
    res.created++;
  }

  await db.insert(auditLog).values({
    actorType: "user",
    actor: admin.email,
    action: "registry_csv_import",
    detail: { ...res, strategy: input.strategy, districtId: input.districtId },
  });
  // Push any SNMP communities the import added down to the school's sensors.
  if (input.schoolId != null) {
    try {
      await syncRegistryCommunitiesToSensors(input.schoolId);
    } catch {
      // non-fatal
    }
  }
  revalidatePath(`${input.basePath}/inventory`);
  return res;
}
