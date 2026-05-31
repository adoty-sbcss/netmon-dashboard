"use server";

/**
 * Auth server actions for local (break-glass) accounts: login, logout, and the
 * forced first-login password change. Federated (OIDC) sign-in is added later
 * and will reuse setSessionCookie / getSessionUser.
 *
 * Every outcome is written to the audit log. Login errors are deliberately
 * generic (no "user exists" oracle).
 */
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { users, auditLog } from "@/db/schema/app";
import { hashPassword, verifyPassword } from "./password";
import {
  getSessionUser,
  setSessionCookie,
  clearSessionCookie,
} from "./current-user";

export interface ActionState {
  error?: string;
}

const GENERIC_LOGIN_ERROR = "Invalid username or password.";

/** Normalize a typed login identifier (local username or email). */
function normalizeIdentifier(raw: string): string {
  return raw.trim().toLowerCase();
}

async function audit(
  actorType: string,
  actor: string | null,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(auditLog).values({ actorType, actor, action, detail });
  } catch {
    // Audit is best-effort; never block auth on a logging failure.
  }
}

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const identifier = normalizeIdentifier(String(formData.get("identifier") ?? ""));
  const password = String(formData.get("password") ?? "");
  if (!identifier || !password) return { error: "Enter your username and password." };

  const [u] = await db
    .select()
    .from(users)
    .where(eq(users.email, identifier))
    .limit(1);

  // Verify even when the user is missing/disabled to keep timing uniform-ish.
  const ok = await verifyPassword(password, u?.passwordHash);
  if (!u || u.disabled || !u.passwordHash || !ok) {
    await audit("breakglass", identifier, "login_failed");
    return { error: GENERIC_LOGIN_ERROR };
  }

  await db
    .update(users)
    .set({ lastLoginAt: sql`now()` })
    .where(eq(users.id, u.id));
  await setSessionCookie(u.id, u.mustChangePassword);
  await audit(u.isBreakGlass ? "breakglass" : "user", u.email, "login_ok");

  redirect(u.mustChangePassword ? "/account/change-password" : "/");
}

export async function logoutAction(): Promise<void> {
  const user = await getSessionUser();
  await clearSessionCookie();
  if (user) await audit("user", user.email, "logout");
  redirect("/login");
}

export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  // Re-verify the current password from the DB (defense in depth).
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!row || !(await verifyPassword(current, row.passwordHash))) {
    return { error: "Current password is incorrect." };
  }
  if (next.length < 12) {
    return { error: "New password must be at least 12 characters." };
  }
  if (next === current || next.toLowerCase() === "password") {
    return { error: "Choose a new password that differs from the default." };
  }
  if (next !== confirm) {
    return { error: "New password and confirmation do not match." };
  }

  const passwordHash = await hashPassword(next);
  await db
    .update(users)
    .set({ passwordHash, mustChangePassword: false })
    .where(eq(users.id, user.id));
  await setSessionCookie(user.id, false);
  await audit(user.isBreakGlass ? "breakglass" : "user", user.email, "password_changed");

  redirect("/");
}
