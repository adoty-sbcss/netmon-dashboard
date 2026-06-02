/**
 * Equipment registry — the HUMAN-owned layer on top of the auto-discovered
 * entities_host / entities_switch. Devices here are manually entered or CSV-
 * imported and carry curated fields scans can't know (room/IDF, status, notes,
 * monitor intent). A registry device may be LINKED to a discovered entity by
 * MAC/IP so a detail view shows both curated fields and live scan data.
 *
 * Also defines the device-lifecycle reference data (EOL/EOS/firmware keyed by
 * vendor+model), the per-vendor EOL data sources (API keys, encrypted), and the
 * low-overhead "newly discovered" acknowledgment feed.
 */
import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  date,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { districts, schools, users } from "./app";
import { entitiesHost, entitiesSwitch } from "./entities";

/**
 * Manually-entered / CSV-imported device. `deviceType` uses the DeviceType
 * vocab (src/lib/oui/types.ts); when it is 'other', `deviceTypeOther` holds the
 * free-text label. SNMP community is stored ENCRYPTED (secret-box) — it is the
 * only "credential" we accept in Phase 1, and only as monitoring metadata.
 */
export const registryDevices = pgTable(
  "registry_devices",
  {
    id: serial("id").primaryKey(),
    districtId: integer("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "cascade" }),
    schoolId: integer("school_id").references(() => schools.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    deviceType: text("device_type").notNull().default("unknown"),
    deviceTypeOther: text("device_type_other"),
    ip: text("ip"),
    mac: text("mac"),
    vendor: text("vendor"),
    model: text("model"),
    building: text("building"),
    room: text("room"), // room / IDF
    // Monitoring intent — NO full credentials in Phase 1. monitorType is one of
    // 'snmp' | 'wmi' | 'icmp' | 'none'. The SNMP community is encrypted at rest.
    monitorType: text("monitor_type").notNull().default("none"),
    snmpCommunityEnc: text("snmp_community_enc"),
    // Per-device current firmware (manual, or parsed from SNMP sysDescr on the
    // linked entity). EOL/EOS dates + latest firmware resolve via lifecycleModels
    // by (vendor, model), so they are NOT duplicated per device.
    firmwareCurrent: text("firmware_current"),
    status: text("status").notNull().default("active"), // active|maintenance|eol|retired
    notes: text("notes"),
    // Links to the auto-discovered canonical entities (set on match by MAC/IP).
    linkedHostId: integer("linked_host_id").references(() => entitiesHost.id, {
      onDelete: "set null",
    }),
    linkedSwitchId: integer("linked_switch_id").references(
      () => entitiesSwitch.id,
      { onDelete: "set null" },
    ),
    // Soft retirement — never hard-delete; retired rows stay queryable.
    retiredReason: text("retired_reason"),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    source: text("source").notNull().default("manual"), // manual|csv
    createdBy: integer("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedBy: integer("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("idx_registry_district").on(t.districtId),
    index("idx_registry_school").on(t.schoolId),
    index("idx_registry_mac").on(t.mac),
    index("idx_registry_ip").on(t.ip),
  ],
);

/**
 * Device lifecycle reference, keyed by normalized (vendor, model). Populated by
 * the admin CSV/Excel upload, vendor APIs, and endoflife.date. ANY device
 * (registry, switch, host) with a known vendor+model joins here to display EOL.
 * Store vendor/model lowercased for a stable match key.
 */
export const lifecycleModels = pgTable(
  "lifecycle_models",
  {
    id: serial("id").primaryKey(),
    vendor: text("vendor").notNull(),
    model: text("model").notNull(),
    eolDate: date("eol_date"), // end-of-life announcement
    endOfSaleDate: date("end_of_sale_date"),
    eosDate: date("eos_date"), // end-of-support (the one that matters most)
    latestFirmware: text("latest_firmware"),
    source: text("source"), // 'upload' | 'endoflife.date' | 'cisco-eox' | 'meraki' | ...
    notes: text("notes"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("uq_lifecycle_vendor_model").on(t.vendor, t.model)],
);

/**
 * Per-vendor EOL data source config. API keys only (no usernames/passwords) —
 * stored encrypted (secret-box). The Excel/CSV upload path writes directly to
 * lifecycleModels and needs no row here.
 */
export const lifecycleSources = pgTable("lifecycle_sources", {
  id: serial("id").primaryKey(),
  vendor: text("vendor").notNull().unique(), // 'cisco' | 'meraki' | 'endoflife' | ...
  apiKeyEnc: text("api_key_enc"),
  baseUrl: text("base_url"),
  enabled: boolean("enabled").notNull().default(false),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedBy: integer("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Sticky acknowledgment for the "newly discovered" feed. A discovered device
 * (entities_host/switch) not in the registry shows in the feed until someone
 * acknowledges or mutes it here — keeping the feed self-cleaning and low-noise.
 */
export const deviceAcks = pgTable(
  "device_acks",
  {
    id: serial("id").primaryKey(),
    districtId: integer("district_id")
      .notNull()
      .references(() => districts.id, { onDelete: "cascade" }),
    mac: text("mac").notNull(),
    action: text("action").notNull(), // 'acknowledged' | 'muted'
    note: text("note"),
    actedBy: integer("acted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    actedAt: timestamp("acted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("uq_device_ack_district_mac").on(t.districtId, t.mac)],
);
