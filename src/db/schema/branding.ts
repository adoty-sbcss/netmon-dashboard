/**
 * Branding configuration — SINGLETON (id = 1). The dashboard's white-label
 * surface: app name/tagline, brand colors, and uploaded logo + favicon. Edited
 * from /settings/branding (superadmin) and applied at runtime (metadata, an
 * injected color <style>, and the /branding/* asset routes).
 *
 * Assets are stored INLINE as base64 text (logos/favicons are a few KB) — no
 * Blob/upload infra needed. mime + data are set together or both null.
 */
import {
  pgTable,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { users } from "./app";

export const brandingSettings = pgTable("branding_settings", {
  id: integer("id").primaryKey().default(1),
  /** Short product name (sidebar title, applicationName), e.g. "NetMon". */
  appName: text("app_name"),
  /** Sidebar subtitle / org line, e.g. "SBCSS Network Dashboard". */
  tagline: text("tagline"),
  /** <meta> description. */
  description: text("description"),
  /** Brand accent (hex) → overrides --primary / --ring. */
  primaryColor: text("primary_color"),
  /** Generated-star colors (hex). Ignored when a custom logo is uploaded. */
  logoColorA: text("logo_color_a"),
  logoColorB: text("logo_color_b"),
  /** Uploaded logo (base64) + its mime, or both null to use the generated star. */
  logoMime: text("logo_mime"),
  logoData: text("logo_data"),
  /** Uploaded favicon (base64) + mime, or both null to use the default icon. */
  faviconMime: text("favicon_mime"),
  faviconData: text("favicon_data"),
  updatedBy: integer("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
