/**
 * Notification config + recipient helpers. Used by the settings page, the alert
 * dispatch, and the monthly report job. Relative imports + no `server-only` so
 * the cron jobs can import it under tsx.
 */
import { eq, asc } from "drizzle-orm";

import { db } from "../../db";
import { notificationSettings, notificationRecipients } from "../../db/schema/notifications";

export interface NotifConfig {
  fromOverride: string | null;
  reportEnabled: boolean;
  reportDayOfMonth: number;
  alertsEnabled: boolean;
  /** 'critical' | 'high' | 'medium' */
  alertMinSeverity: string;
  alertOnSecurity: boolean;
  alertOnSensorOffline: boolean;
  alertOnStorage: boolean;
}

const DEFAULTS: NotifConfig = {
  fromOverride: null,
  reportEnabled: true,
  reportDayOfMonth: 1,
  alertsEnabled: true,
  alertMinSeverity: "critical",
  alertOnSecurity: true,
  alertOnSensorOffline: true,
  alertOnStorage: true,
};

export async function getNotificationConfig(): Promise<NotifConfig> {
  const [row] = await db
    .select()
    .from(notificationSettings)
    .where(eq(notificationSettings.id, 1))
    .limit(1);
  if (!row) return { ...DEFAULTS };
  return {
    fromOverride: row.fromOverride,
    reportEnabled: row.reportEnabled,
    reportDayOfMonth: row.reportDayOfMonth,
    alertsEnabled: row.alertsEnabled,
    alertMinSeverity: row.alertMinSeverity,
    alertOnSecurity: row.alertOnSecurity,
    alertOnSensorOffline: row.alertOnSensorOffline,
    alertOnStorage: row.alertOnStorage,
  };
}

export async function saveNotificationConfig(
  patch: Partial<NotifConfig>,
  userId: number,
): Promise<void> {
  await db
    .insert(notificationSettings)
    .values({ id: 1, ...patch, updatedBy: userId })
    .onConflictDoUpdate({
      target: notificationSettings.id,
      set: { ...patch, updatedBy: userId, updatedAt: new Date() },
    });
}

export interface Recipient {
  id: number;
  email: string;
  name: string | null;
  alerts: boolean;
  reports: boolean;
}

export async function listRecipients(): Promise<Recipient[]> {
  return db
    .select({
      id: notificationRecipients.id,
      email: notificationRecipients.email,
      name: notificationRecipients.name,
      alerts: notificationRecipients.alerts,
      reports: notificationRecipients.reports,
    })
    .from(notificationRecipients)
    .orderBy(asc(notificationRecipients.email));
}

/** Emails subscribed to a channel — used by the alert dispatch + report job. */
export async function getRecipientsFor(channel: "alerts" | "reports"): Promise<string[]> {
  const col = channel === "alerts" ? notificationRecipients.alerts : notificationRecipients.reports;
  const rows = await db
    .select({ email: notificationRecipients.email })
    .from(notificationRecipients)
    .where(eq(col, true));
  return rows.map((r) => r.email);
}
