"use server";

/**
 * VLAN trunk monitoring actions (runtime push). Change the VLANs a deployed
 * sensor monitors from the dashboard — pushes NETMON_TRUNK_* into the sensor's
 * desired_config and queues the `host-apply-vlan` host action that builds the
 * netplan sub-interfaces on the box (guarded: auto-reverts if the box loses its
 * default route). `detect` sniffs the trunk to list the VLANs present.
 * Superadmin-only. Self-contained (no shared sensor-actions surface).
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { auditLog } from "@/db/schema/app";
import { commandQueue, desiredConfig } from "@/db/schema/management";
import { getSessionUser } from "@/lib/auth/current-user";

export interface VlanActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function audit(actor: string, action: string, detail: Record<string, unknown> = {}) {
  await db.insert(auditLog).values({ actorType: "user", actor, action, detail }).catch(() => {});
}

async function requireSuperadmin() {
  const u = await getSessionUser();
  return u && u.role === "superadmin" ? u : null;
}

const cleanVlans = (s: string) =>
  s.replace(/[^0-9,]/g, "").replace(/,+/g, ",").replace(/^,|,$/g, "");

/** Push VLAN trunk config into desired_config + queue the host apply. */
export async function saveVlanConfigAction(
  _prev: VlanActionState,
  formData: FormData,
): Promise<VlanActionState> {
  const admin = await requireSuperadmin();
  if (!admin) return { error: "Not authorized." };
  const sensorId = Number(formData.get("sensorId"));
  if (!Number.isInteger(sensorId)) return { error: "Invalid sensor." };

  const vlans = cleanVlans(String(formData.get("vlans") ?? ""));
  const parent = String(formData.get("parent") ?? "").trim();
  const statics = String(formData.get("statics") ?? "").trim();

  // Merge into desired_config (preserve everything else), bump the version.
  const [cur] = await db
    .select({ v: desiredConfig.configVersion, config: desiredConfig.config })
    .from(desiredConfig)
    .where(eq(desiredConfig.sensorId, sensorId))
    .limit(1);
  const nextVersion = (cur?.v ?? 0) + 1;
  const config = {
    ...((cur?.config as Record<string, unknown>) ?? {}),
    trunk_vlans: vlans,
    trunk_parent: parent,
    trunk_statics: statics,
  };
  await db
    .insert(desiredConfig)
    .values({ sensorId, configVersion: nextVersion, config, updatedBy: admin.id })
    .onConflictDoUpdate({
      target: desiredConfig.sensorId,
      set: { configVersion: nextVersion, config, updatedBy: admin.id, updatedAt: new Date() },
    });

  // Queue the host action that builds the netplan sub-interfaces from the env.
  // pending + requiresApproval:false so the check-in route dispatches it.
  if (vlans) {
    await db.insert(commandQueue).values({
      sensorId,
      command: "host-apply-vlan",
      status: "pending",
      requiresApproval: false,
      createdBy: admin.id,
    });
  }

  await audit(admin.email, "vlan_config_pushed", { sensorId, vlans, parent });
  revalidatePath(String(formData.get("basePath") ?? "/"));
  return {
    ok: true,
    message: vlans
      ? `VLANs ${vlans} pushed — the box applies them on its next check-in (~3 min).`
      : "VLAN monitoring cleared in config. (Existing sub-interfaces stay until the box is reconfigured.)",
  };
}

/** Queue a one-off VLAN sniff; the result lands in the command history. */
export async function runDetectVlansAction(
  _prev: VlanActionState,
  formData: FormData,
): Promise<VlanActionState> {
  const admin = await requireSuperadmin();
  if (!admin) return { error: "Not authorized." };
  const sensorId = Number(formData.get("sensorId"));
  if (!Number.isInteger(sensorId)) return { error: "Invalid sensor." };

  await db.insert(commandQueue).values({
    sensorId,
    command: "diag-detect-vlans",
    status: "pending",
    requiresApproval: false,
    createdBy: admin.id,
  });
  await audit(admin.email, "vlan_detect_queued", { sensorId });
  revalidatePath(String(formData.get("basePath") ?? "/"));
  return {
    ok: true,
    message: "Detecting VLANs on the trunk — the list shows in the command history at the next check-in.",
  };
}
