/**
 * Notification / email configuration: who gets what, the monthly summary
 * schedule, and which alerts fire. Read by the alert dispatch + the monthly
 * report job; edited at /settings/notifications (superadmin).
 */
import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./app";

/** Singleton (id = 1) global notification config. */
export const notificationSettings = pgTable("notification_settings", {
  id: integer("id").primaryKey().default(1),
  /** Override the ACS sender address (e.g. a branded sbcss.net mailbox once
   *  verified). Null = the default Azure-managed sender / EMAIL_FROM. */
  fromOverride: text("from_override"),

  // --- monthly administrative summary ---
  reportEnabled: boolean("report_enabled").notNull().default(true),
  /** Day of month (1–28) the monthly summary is sent. */
  reportDayOfMonth: integer("report_day_of_month").notNull().default(1),

  // --- alerts ---
  alertsEnabled: boolean("alerts_enabled").notNull().default(true),
  /** Minimum severity that triggers an alert email. 'critical' | 'high' | 'medium'. */
  alertMinSeverity: text("alert_min_severity").notNull().default("critical"),
  alertOnSecurity: boolean("alert_on_security").notNull().default(true),
  alertOnSensorOffline: boolean("alert_on_sensor_offline").notNull().default(true),
  alertOnStorage: boolean("alert_on_storage").notNull().default(true),

  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Recipients, and which categories of mail each receives. */
export const notificationRecipients = pgTable(
  "notification_recipients",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    /** Receives alert emails. */
    alerts: boolean("alerts").notNull().default(true),
    /** Receives the monthly administrative summary. */
    reports: boolean("reports").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uq_notif_recipient_email").on(t.email)],
);
