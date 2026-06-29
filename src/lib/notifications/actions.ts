"use server";

/**
 * Superadmin actions for /settings/notifications: report + alert config,
 * recipient management, and a send-test. All audited.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { auditLog } from "@/db/schema/app";
import { notificationRecipients } from "@/db/schema/notifications";
import { getSessionUser } from "@/lib/auth/current-user";
import { saveNotificationConfig } from "@/lib/notifications/settings";
import { EMAIL_RE, sendEmail } from "@/lib/email";

const PATH = "/settings/notifications";
const SEVERITIES = ["critical", "high", "medium"];

export interface NotifActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

async function requireSuperadmin() {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  return u.role === "superadmin" ? u : null;
}

async function audit(actor: string, action: string, detail: Record<string, unknown> = {}) {
  await db.insert(auditLog).values({ actorType: "user", actor, action, detail }).catch(() => {});
}

export async function saveNotificationSettingsAction(
  _prev: NotifActionState,
  formData: FormData,
): Promise<NotifActionState> {
  const u = await requireSuperadmin();
  if (!u) return { error: "Not authorized." };

  const day = Number(formData.get("reportDayOfMonth"));
  const sev = String(formData.get("alertMinSeverity") ?? "critical");
  await saveNotificationConfig(
    {
      reportEnabled: formData.get("reportEnabled") === "on",
      reportDayOfMonth: Number.isFinite(day) && day >= 1 && day <= 28 ? Math.floor(day) : 1,
      alertsEnabled: formData.get("alertsEnabled") === "on",
      alertMinSeverity: SEVERITIES.includes(sev) ? sev : "critical",
      alertOnSecurity: formData.get("alertOnSecurity") === "on",
      alertOnSensorOffline: formData.get("alertOnSensorOffline") === "on",
      alertOnStorage: formData.get("alertOnStorage") === "on",
      fromOverride: String(formData.get("fromOverride") ?? "").trim() || null,
    },
    u.id,
  );
  await audit(u.email, "notification_settings_saved");
  revalidatePath(PATH);
  return { ok: true, message: "Settings saved." };
}

export async function addRecipientAction(
  _prev: NotifActionState,
  formData: FormData,
): Promise<NotifActionState> {
  const u = await requireSuperadmin();
  if (!u) return { error: "Not authorized." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };

  try {
    await db.insert(notificationRecipients).values({
      email,
      name,
      alerts: formData.get("alerts") === "on",
      reports: formData.get("reports") === "on",
    });
  } catch {
    return { error: "That email is already a recipient." };
  }
  await audit(u.email, "notification_recipient_added", { email });
  revalidatePath(PATH);
  return { ok: true, message: `Added ${email}.` };
}

export async function updateRecipientAction(
  _prev: NotifActionState,
  formData: FormData,
): Promise<NotifActionState> {
  const u = await requireSuperadmin();
  if (!u) return { error: "Not authorized." };

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return { error: "Invalid recipient." };
  await db
    .update(notificationRecipients)
    .set({
      alerts: formData.get("alerts") === "on",
      reports: formData.get("reports") === "on",
    })
    .where(eq(notificationRecipients.id, id));
  await audit(u.email, "notification_recipient_updated", { id });
  revalidatePath(PATH);
  return { ok: true, message: "Recipient updated." };
}

export async function removeRecipientAction(
  _prev: NotifActionState,
  formData: FormData,
): Promise<NotifActionState> {
  const u = await requireSuperadmin();
  if (!u) return { error: "Not authorized." };

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return { error: "Invalid recipient." };
  await db.delete(notificationRecipients).where(eq(notificationRecipients.id, id));
  await audit(u.email, "notification_recipient_removed", { id });
  revalidatePath(PATH);
  return { ok: true, message: "Recipient removed." };
}

export async function sendTestEmailAction(
  _prev: NotifActionState,
  formData: FormData,
): Promise<NotifActionState> {
  const u = await requireSuperadmin();
  if (!u) return { error: "Not authorized." };

  const to = String(formData.get("to") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return { error: "Enter a valid email address." };

  const r = await sendEmail({
    to: [to],
    subject: "NetMon — test email",
    html:
      "<p>This is a test from the NetMon dashboard's notification settings.</p>" +
      "<p>If you received it, outbound email works — alerts and the monthly summary will deliver here.</p>",
    text: "NetMon test email. If you got this, outbound email works.",
    tag: "test",
  });
  await audit(u.email, "notification_test_sent", { to, provider: r.provider, ok: r.ok });
  if (!r.ok) return { error: `Send failed (${r.provider}): ${r.error ?? "unknown error"}` };
  return {
    ok: true,
    message:
      r.provider === "log"
        ? `Email transport isn't wired in this environment yet — logged a test to ${to}.`
        : `Test email sent to ${to}.`,
  };
}
