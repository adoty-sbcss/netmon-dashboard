"use server";

/**
 * PERF-3: set a school's committed/provisioned WAN rate — the number uplink
 * utilization is measured against (a 10G/100G port may carry only 1–10G of paid
 * transport, so %util vs the physical port speed is misleading). Superadmin-only,
 * audit-logged. The editor lives inline on the school's Speed & Bandwidth page.
 */
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { auditLog } from "@/db/schema/app";
import { getDistrictBySlug, getSchoolBySlug } from "@/db/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { saveSchoolCommittedRate } from "@/lib/iperf";

export interface UplinkActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

/** Upsert (or clear, when the rate is blank) a school's committed WAN rate. */
export async function setSchoolCommittedRateAction(
  _prev: UplinkActionState,
  formData: FormData,
): Promise<UplinkActionState> {
  const user = await getSessionUser();
  if (!user || user.role !== "superadmin") return { error: "Not authorized." };

  const districtSlug = String(formData.get("districtSlug") ?? "");
  const schoolSlug = String(formData.get("schoolSlug") ?? "");
  const district = await getDistrictBySlug(districtSlug);
  if (!district) return { error: "District not found." };
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) return { error: "School not found." };

  const raw = String(formData.get("committedMbps") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  let committedMbps: number | null = null;
  if (raw !== "") {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      return { error: "Enter a whole number of Mbps (e.g. 1000), or leave blank to clear." };
    }
    committedMbps = n;
  }

  await saveSchoolCommittedRate(
    school.id,
    { committedMbps, label: label || null, note: note || null },
    user.id,
  );
  await db
    .insert(auditLog)
    .values({
      actorType: "user",
      actor: user.email,
      action: committedMbps == null ? "committed_rate_cleared" : "committed_rate_set",
      target: `school:${district.slug}/${school.slug}`,
      detail: { committedMbps },
    })
    .catch(() => {});

  revalidatePath(`/${district.slug}/${school.slug}/iperf`);
  return {
    ok: true,
    message:
      committedMbps == null
        ? "Committed rate cleared."
        : `Committed rate set to ${committedMbps} Mbps.`,
  };
}
