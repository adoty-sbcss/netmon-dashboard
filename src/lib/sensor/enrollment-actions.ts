"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { auditLog } from "@/db/schema/app";
import { getSessionUser } from "@/lib/auth/current-user";
import { saveEnrollment } from "@/lib/sensor/enrollment";

const PATH = "/settings/ingestion";

export interface EnrollmentActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

export async function saveEnrollmentAction(
  _prev: EnrollmentActionState,
  formData: FormData,
): Promise<EnrollmentActionState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "superadmin") return { error: "Not authorized." };

  const autoEnrollEnabled = formData.get("autoEnrollEnabled") === "on";
  const generate = formData.get("generate") === "on";
  const newBootstrapKey = String(formData.get("newBootstrapKey") ?? "").trim();

  if (autoEnrollEnabled && !generate && !newBootstrapKey) {
    // Enabling but no key provided and none being generated — only OK if one
    // already exists; saveEnrollment leaves the existing key untouched.
  }
  if (newBootstrapKey && newBootstrapKey.length < 12) {
    return { error: "A custom key should be at least 12 characters." };
  }

  await saveEnrollment({
    autoEnrollEnabled,
    generate,
    newBootstrapKey: newBootstrapKey || undefined,
    updatedBy: user.id,
  });

  try {
    await db.insert(auditLog).values({
      actorType: "user",
      actor: user.email,
      action: "sensor_autoenroll_saved",
      detail: { autoEnrollEnabled, rotated: generate || !!newBootstrapKey },
    });
  } catch {
    // best-effort
  }

  revalidatePath(PATH);
  return {
    ok: true,
    message: generate || newBootstrapKey ? "Saved. New bootstrap key is active." : "Saved.",
  };
}
