"use server";

/**
 * Superadmin user-management actions: register users by email, set role, assign
 * district access (grants), enable/disable, delete. All superadmin-gated + audited.
 *
 * Users sign in with Google/Microsoft (OIDC) — the email here is the allowlist
 * key; whoever proves that email via either provider is let in. No password is
 * stored for these (only the break-glass admin has one).
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { users, grants, auditLog } from "@/db/schema/app";
import { getSessionUser } from "@/lib/auth/current-user";

const USERS_PATH = "/settings/users";

export interface UserActionState {
  error?: string;
  ok?: boolean;
  message?: string;
}

type Role = "superadmin" | "user";

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRole(v: unknown): Role {
  return v === "superadmin" ? "superadmin" : "user";
}

function parseDistrictIds(formData: FormData): number[] {
  return formData
    .getAll("districtIds")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** Replace a user's district grants with the given set (within a tx). */
async function setDistrictGrants(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: number,
  districtIds: number[],
) {
  await tx.delete(grants).where(and(eq(grants.userId, userId), eq(grants.scopeType, "district")));
  if (districtIds.length > 0) {
    await tx.insert(grants).values(
      districtIds.map((id) => ({ userId, scopeType: "district" as const, scopeId: id })),
    );
  }
}

export async function addUserAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = parseRole(formData.get("role"));
  const displayName = String(formData.get("displayName") ?? "").trim() || null;
  const districtIds = role === "superadmin" ? [] : parseDistrictIds(formData);

  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (role === "user" && districtIds.length === 0) {
    return { error: "Pick at least one district for a non-admin user." };
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) return { error: `${email} is already a user.` };

  await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ email, displayName, role })
      .returning({ id: users.id });
    if (role === "superadmin") {
      await tx.insert(grants).values({ userId: u.id, scopeType: "global", scopeId: null });
    } else {
      await setDistrictGrants(tx, u.id, districtIds);
    }
  });

  await audit(admin.email, "user_added", { email, role, districtIds });
  revalidatePath(USERS_PATH);
  return { ok: true, message: `Added ${email}. They can sign in with Google or Microsoft.` };
}

export async function updateUserAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const userId = Number(formData.get("userId"));
  const role = parseRole(formData.get("role"));
  const districtIds = role === "superadmin" ? [] : parseDistrictIds(formData);
  if (!Number.isInteger(userId)) return { error: "Invalid request." };
  if (role === "user" && districtIds.length === 0) {
    return { error: "Pick at least one district, or make them a superadmin." };
  }

  const [target] = await db.select().from(users).where(eq(users.id, userId));
  if (!target) return { error: "That user no longer exists." };
  if (target.isBreakGlass) return { error: "The break-glass admin can't be edited here." };

  await db.transaction(async (tx) => {
    await tx.update(users).set({ role }).where(eq(users.id, userId));
    // Reset all scope grants, then apply the new ones.
    await tx.delete(grants).where(eq(grants.userId, userId));
    if (role === "superadmin") {
      await tx.insert(grants).values({ userId, scopeType: "global", scopeId: null });
    } else {
      await setDistrictGrants(tx, userId, districtIds);
    }
  });

  await audit(admin.email, "user_updated", { userId, email: target.email, role, districtIds });
  revalidatePath(USERS_PATH);
  return { ok: true, message: `Updated ${target.email}.` };
}

export async function setUserDisabledAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const userId = Number(formData.get("userId"));
  const disabled = formData.get("disabled") === "true";
  if (!Number.isInteger(userId)) return { error: "Invalid request." };

  const [target] = await db.select().from(users).where(eq(users.id, userId));
  if (!target) return { error: "That user no longer exists." };
  if (target.id === admin.id) return { error: "You can't disable your own account." };
  if (target.isBreakGlass) return { error: "The break-glass admin can't be disabled here." };

  await db.update(users).set({ disabled }).where(eq(users.id, userId));
  await audit(admin.email, disabled ? "user_disabled" : "user_enabled", { userId, email: target.email });
  revalidatePath(USERS_PATH);
  return { ok: true, message: `${disabled ? "Disabled" : "Enabled"} ${target.email}.` };
}

export async function deleteUserAction(
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const userId = Number(formData.get("userId"));
  if (!Number.isInteger(userId)) return { error: "Invalid request." };

  const [target] = await db.select().from(users).where(eq(users.id, userId));
  if (!target) return { error: "That user no longer exists." };
  if (target.id === admin.id) return { error: "You can't delete your own account." };
  if (target.isBreakGlass) return { error: "The break-glass admin can't be deleted." };

  await db.delete(users).where(eq(users.id, userId)); // grants cascade
  await audit(admin.email, "user_deleted", { userId, email: target.email });
  revalidatePath(USERS_PATH);
  return { ok: true, message: `Removed ${target.email}.` };
}
