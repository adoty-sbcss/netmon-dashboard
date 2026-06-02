"use server";

/**
 * Equipment-registry server actions. Writes are superadmin-only for now
 * (consistent with the other admin actions); every change is audit-logged.
 * Retirement is a SOFT state change (reason + timestamp), never a hard delete.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { registryDevices } from "@/db/schema";
import { auditLog } from "@/db/schema/app";
import { getSessionUser } from "@/lib/auth/current-user";
import { encryptSecret } from "@/lib/crypto/secret-box";
import {
  isMonitorType,
  isRegistryDeviceType,
  isRegistryStatus,
  normalizeMac,
} from "./types";

export interface RegistryActionState {
  error?: string;
  ok?: boolean;
  message?: string;
  id?: number;
}

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user.role === "superadmin" ? user : null;
}

async function audit(actor: string, action: string, detail: Record<string, unknown> = {}) {
  try {
    await db.insert(auditLog).values({ actorType: "user", actor, action, detail });
  } catch {
    // best-effort
  }
}

function s(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

/** Create or update a registry device (presence of a non-empty `id` = update). */
export async function saveRegistryDeviceAction(
  _prev: RegistryActionState,
  formData: FormData,
): Promise<RegistryActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const idRaw = s(formData, "id");
  const id = idRaw ? Number(idRaw) : null;
  const basePath = s(formData, "basePath") ?? "";

  const name = s(formData, "name");
  if (!name) return { error: "Name is required." };

  const deviceType = s(formData, "deviceType") ?? "unknown";
  if (!isRegistryDeviceType(deviceType) && deviceType !== "unknown")
    return { error: "Invalid device type." };
  const deviceTypeOther = deviceType === "other" ? s(formData, "deviceTypeOther") : null;
  if (deviceType === "other" && !deviceTypeOther)
    return { error: "Describe the device type for 'Other'." };

  const monitorType = s(formData, "monitorType") ?? "none";
  if (!isMonitorType(monitorType)) return { error: "Invalid monitor type." };

  const status = s(formData, "status") ?? "active";
  if (!isRegistryStatus(status)) return { error: "Invalid status." };

  const snmpCommunity = s(formData, "snmpCommunity");

  const base = {
    name,
    deviceType,
    deviceTypeOther,
    ip: s(formData, "ip"),
    mac: normalizeMac(s(formData, "mac")),
    vendor: s(formData, "vendor"),
    model: s(formData, "model"),
    building: s(formData, "building"),
    room: s(formData, "room"),
    monitorType,
    firmwareCurrent: s(formData, "firmwareCurrent"),
    status,
    notes: s(formData, "notes"),
    updatedBy: admin.id,
    updatedAt: new Date(),
  };

  // SNMP community: encrypt only when a new value is typed (blank = keep current).
  const encField = snmpCommunity ? { snmpCommunityEnc: encryptSecret(snmpCommunity) } : {};

  if (id != null && Number.isInteger(id)) {
    const [existing] = await db
      .select({ id: registryDevices.id, districtId: registryDevices.districtId })
      .from(registryDevices)
      .where(eq(registryDevices.id, id));
    if (!existing) return { error: "That device no longer exists." };
    await db
      .update(registryDevices)
      .set({ ...base, ...encField })
      .where(eq(registryDevices.id, id));
    await audit(admin.email, "registry_device_updated", { id, name });
    revalidatePath(basePath);
    revalidatePath(`${basePath}/registry`);
    return { ok: true, id, message: "Device saved." };
  }

  // Create
  const districtId = Number(s(formData, "districtId"));
  if (!Number.isInteger(districtId)) return { error: "Missing district." };
  const schoolIdRaw = s(formData, "schoolId");
  const schoolId = schoolIdRaw ? Number(schoolIdRaw) : null;

  const [created] = await db
    .insert(registryDevices)
    .values({
      districtId,
      schoolId,
      ...base,
      ...encField,
      source: "manual",
      createdBy: admin.id,
    })
    .returning({ id: registryDevices.id });

  await audit(admin.email, "registry_device_created", { id: created.id, name });
  revalidatePath(`${basePath}/registry`);
  redirect(`${basePath}/registry`);
}

/** Soft-retire (reason + timestamp). Retired devices remain queryable. */
export async function retireRegistryDeviceAction(
  _prev: RegistryActionState,
  formData: FormData,
): Promise<RegistryActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const id = Number(s(formData, "id"));
  if (!Number.isInteger(id)) return { error: "Invalid device." };
  const reason = s(formData, "reason") ?? "Retired";
  const basePath = s(formData, "basePath") ?? "";

  await db
    .update(registryDevices)
    .set({ status: "retired", retiredReason: reason, retiredAt: new Date(), updatedBy: admin.id })
    .where(eq(registryDevices.id, id));
  await audit(admin.email, "registry_device_retired", { id, reason });
  revalidatePath(basePath);
  revalidatePath(`${basePath}/registry`);
  return { ok: true, id, message: "Device retired." };
}

/** Restore a retired device to active. */
export async function restoreRegistryDeviceAction(
  _prev: RegistryActionState,
  formData: FormData,
): Promise<RegistryActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const id = Number(s(formData, "id"));
  if (!Number.isInteger(id)) return { error: "Invalid device." };
  const basePath = s(formData, "basePath") ?? "";
  await db
    .update(registryDevices)
    .set({ status: "active", retiredReason: null, retiredAt: null, updatedBy: admin.id })
    .where(eq(registryDevices.id, id));
  await audit(admin.email, "registry_device_restored", { id });
  revalidatePath(basePath);
  revalidatePath(`${basePath}/registry`);
  return { ok: true, id, message: "Device restored." };
}

/** Hard-delete a registry row — for correcting an entry mistake (superadmin). */
export async function deleteRegistryDeviceAction(
  _prev: RegistryActionState,
  formData: FormData,
): Promise<RegistryActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const id = Number(s(formData, "id"));
  if (!Number.isInteger(id)) return { error: "Invalid device." };
  const basePath = s(formData, "basePath") ?? "";
  await db.delete(registryDevices).where(eq(registryDevices.id, id));
  await audit(admin.email, "registry_device_deleted", { id });
  revalidatePath(`${basePath}/registry`);
  redirect(`${basePath}/registry`);
}
