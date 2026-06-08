"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { issues } from "@/db/schema";
import { auditLog } from "@/db/schema/app";
import { getSessionUser } from "@/lib/auth/current-user";

export interface IssueActionState {
  error?: string;
  ok?: boolean;
}

async function requireAdmin() {
  const user = await getSessionUser();
  return user?.role === "superadmin" ? user : null;
}

/** Acknowledge / resolve / reopen an issue. */
export async function updateIssueAction(
  _prev: IssueActionState,
  formData: FormData,
): Promise<IssueActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };
  const id = Number(formData.get("id"));
  const action = String(formData.get("action") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  if (!Number.isInteger(id)) return { error: "Invalid issue." };
  const now = new Date();

  if (action === "acknowledge") {
    await db
      .update(issues)
      .set({ status: "acknowledged", acknowledgedBy: admin.id, acknowledgedAt: now, updatedAt: now })
      .where(eq(issues.id, id));
  } else if (action === "resolve") {
    await db
      .update(issues)
      .set({ status: "resolved", resolvedAt: now, updatedAt: now })
      .where(eq(issues.id, id));
  } else if (action === "reopen") {
    await db
      .update(issues)
      .set({
        status: "open",
        resolvedAt: null,
        missedRuns: 0,
        acknowledgedAt: null,
        acknowledgedBy: null,
        updatedAt: now,
      })
      .where(eq(issues.id, id));
  } else if (action === "mute") {
    // AI-4: "acknowledge — don't warn me about this again". Sticky: reconcile
    // won't reopen/auto-resolve it, future analysis runs are told to skip it, and
    // it's filtered out of the AI findings surfaced on overviews.
    await db
      .update(issues)
      .set({ status: "muted", acknowledgedBy: admin.id, acknowledgedAt: now, updatedAt: now })
      .where(eq(issues.id, id));
  } else if (action === "unmute") {
    await db
      .update(issues)
      .set({
        status: "open",
        acknowledgedBy: null,
        acknowledgedAt: null,
        missedRuns: 0,
        updatedAt: now,
      })
      .where(eq(issues.id, id));
  } else {
    return { error: "Unknown action." };
  }

  await db.insert(auditLog).values({
    actorType: "user",
    actor: admin.email,
    action: `issue_${action}`,
    detail: { id },
  });
  if (basePath) revalidatePath(basePath);
  return { ok: true };
}
