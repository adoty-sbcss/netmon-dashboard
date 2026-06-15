/**
 * Read-only, district-scoped tools the assistant can call (M4). The model picks
 * tools; we execute them here against the real data. SECURITY: every school-scoped
 * tool verifies the requested school_id is in the user's allowed set (computed
 * once from their grants), so the model can never read a district the user can't.
 */
import "server-only";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { schools, districts } from "@/db/schema/app";
import type { UserScope } from "@/lib/auth/scope";
import {
  getSchoolStats,
  listHostsForSchool,
  listFindingsForSchool,
  listScanSnapshotsForSchool,
  listSwitchesForSchool,
} from "@/db/queries";
import { ipInCidr } from "@/lib/net";
import type { AiToolDef, AiToolExecutor } from "./types";

export interface AllowedSite {
  id: number;
  name: string;
  districtName: string;
}

/** The schools the user may see, derived from their scope (one query). */
export async function getAllowedSites(scope: UserScope): Promise<AllowedSite[]> {
  if (!scope.all && scope.districtIds.length === 0) return [];
  const rows = await db
    .select({
      id: schools.id,
      name: schools.name,
      slug: schools.slug,
      districtName: districts.name,
    })
    .from(schools)
    .innerJoin(districts, eq(schools.districtId, districts.id))
    .where(scope.all ? undefined : inArray(districts.id, scope.districtIds))
    .orderBy(districts.name, schools.name);
  return rows.map((r) => ({
    id: r.id,
    name: r.name || r.slug,
    districtName: r.districtName || "?",
  }));
}

export const ASSISTANT_TOOLS: AiToolDef[] = [
  {
    name: "list_sites",
    description:
      "List the schools you can access, with their school_id. Use these ids with the other tools.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "device_counts",
    description:
      "Total device count plus a breakdown by device type (ap, printer, phone, computer, switch, …) for one school.",
    parameters: {
      type: "object",
      properties: { school_id: { type: "number" } },
      required: ["school_id"],
      additionalProperties: false,
    },
  },
  {
    name: "search_devices",
    description:
      "Find devices at a school. Optionally filter by `type` (e.g. ap, printer), `subnet` (CIDR like 10.8.0.0/16), or `text` (matches hostname/vendor/MAC/IP). Returns up to `limit` rows plus the total matched.",
    parameters: {
      type: "object",
      properties: {
        school_id: { type: "number" },
        type: { type: "string" },
        subnet: { type: "string" },
        text: { type: "string" },
        limit: { type: "number" },
      },
      required: ["school_id"],
      additionalProperties: false,
    },
  },
  {
    name: "search_switches",
    description:
      "Find SWITCHES / infrastructure at a school by `text` (matches system name, model/description, management IP, or chassis MAC). Use this — not search_devices — for findings about switches, spanning-tree/STP root bridges, uplinks, or infrastructure gear. STP bridge IDs look like `priority/.../<chassis-mac>`; search the MAC part here.",
    parameters: {
      type: "object",
      properties: {
        school_id: { type: "number" },
        text: { type: "string" },
        limit: { type: "number" },
      },
      required: ["school_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_scans",
    description:
      "Recent scan runs for a school (newest first) with dates. Use a scan_id with devices_in_scan to see what was connected on a given day.",
    parameters: {
      type: "object",
      properties: { school_id: { type: "number" } },
      required: ["school_id"],
      additionalProperties: false,
    },
  },
  {
    name: "devices_in_scan",
    description: "Devices/clients seen in a specific scan run (a point-in-time snapshot).",
    parameters: {
      type: "object",
      properties: {
        school_id: { type: "number" },
        scan_id: { type: "number" },
        limit: { type: "number" },
      },
      required: ["school_id", "scan_id"],
      additionalProperties: false,
    },
  },
  {
    name: "site_findings",
    description: "Recent rule-based + AI findings/issues for a school.",
    parameters: {
      type: "object",
      properties: { school_id: { type: "number" } },
      required: ["school_id"],
      additionalProperties: false,
    },
  },
];

/** Build the executor bound to the user's allowed sites. */
export function buildToolExecutor(sites: AllowedSite[]): AiToolExecutor {
  const allowed = new Set(sites.map((s) => s.id));
  const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));
  const ensure = (schoolId: number) => {
    if (!Number.isFinite(schoolId) || !allowed.has(schoolId)) {
      throw new Error("school_id is not in your accessible sites — call list_sites first");
    }
  };

  return async (name, args) => {
    switch (name) {
      case "list_sites":
        return JSON.stringify(
          sites.map((s) => ({ school_id: s.id, name: s.name, district: s.districtName })),
        );

      case "device_counts": {
        const id = num(args.school_id);
        ensure(id);
        const [stats, hosts] = await Promise.all([
          getSchoolStats(id),
          listHostsForSchool(id),
        ]);
        const byType: Record<string, number> = {};
        for (const h of hosts) {
          const t = (h.deviceType ?? "unknown").toLowerCase();
          byType[t] = (byType[t] ?? 0) + 1;
        }
        return JSON.stringify({
          total_devices: stats.hostCount,
          by_type: byType,
          last_scan: stats.lastScanAt,
        });
      }

      case "search_devices": {
        const id = num(args.school_id);
        ensure(id);
        const limit = Math.min(200, Math.max(1, num(args.limit) || 50));
        const type = typeof args.type === "string" ? args.type.toLowerCase() : null;
        const subnet = typeof args.subnet === "string" ? args.subnet : null;
        const text = typeof args.text === "string" ? args.text.toLowerCase() : null;

        let hosts = await listHostsForSchool(id);
        if (type) hosts = hosts.filter((h) => (h.deviceType ?? "").toLowerCase() === type);
        if (subnet) hosts = hosts.filter((h) => h.ip != null && ipInCidr(h.ip, subnet));
        if (text) {
          hosts = hosts.filter((h) =>
            [h.hostname, h.vendor, h.mac, h.ip].some((f) => f?.toLowerCase().includes(text)),
          );
        }

        return JSON.stringify({
          matched: hosts.length,
          returned: Math.min(hosts.length, limit),
          devices: hosts.slice(0, limit).map((h) => ({
            hostname: h.hostname,
            ip: h.ip,
            mac: h.mac,
            vendor: h.vendor,
            type: h.deviceType,
            switch_port: h.switchPort,
            last_seen: h.lastSeenAt,
          })),
        });
      }

      case "search_switches": {
        const id = num(args.school_id);
        ensure(id);
        const limit = Math.min(200, Math.max(1, num(args.limit) || 50));
        const text = typeof args.text === "string" ? args.text.toLowerCase() : null;
        let switches = await listSwitchesForSchool(id);
        if (text) {
          switches = switches.filter((s) =>
            [s.systemName, s.systemDescription, s.mgmtIp, s.chassisId].some((f) =>
              f?.toLowerCase().includes(text),
            ),
          );
        }
        return JSON.stringify({
          matched: switches.length,
          returned: Math.min(switches.length, limit),
          switches: switches.slice(0, limit).map((s) => ({
            name: s.systemName,
            model: s.systemDescription,
            mgmt_ip: s.mgmtIp,
            chassis_mac: s.chassisId,
            last_seen: s.lastSeenAt,
          })),
        });
      }

      case "list_scans": {
        const id = num(args.school_id);
        ensure(id);
        const scans = (await listScanSnapshotsForSchool(id)).slice(0, 40);
        return JSON.stringify(
          scans.map((s) => ({ scan_id: s.scanId, sensor: s.sensorSlug, at: s.startedAt })),
        );
      }

      case "devices_in_scan": {
        const id = num(args.school_id);
        ensure(id);
        const scanId = num(args.scan_id);
        const limit = Math.min(300, Math.max(1, num(args.limit) || 150));
        const hosts = await listHostsForSchool(id, { scanId });
        return JSON.stringify({
          scan_id: scanId,
          count: hosts.length,
          devices: hosts.slice(0, limit).map((h) => ({
            hostname: h.hostname,
            ip: h.ip,
            mac: h.mac,
            vendor: h.vendor,
            type: h.deviceType,
          })),
        });
      }

      case "site_findings": {
        const id = num(args.school_id);
        ensure(id);
        const f = await listFindingsForSchool(id, 50);
        return JSON.stringify(
          f.map((x) => ({
            severity: x.severity,
            title: x.title,
            detail: x.detail,
            at: x.createdAt,
          })),
        );
      }

      default:
        return `Error: unknown tool "${name}"`;
    }
  };
}
