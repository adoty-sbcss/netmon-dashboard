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
  listWifiForSchool,
  listWifiExperienceForSchool,
} from "@/db/queries";
import { listSchoolWifiSpeedtests } from "@/lib/iperf";
import { listSchoolWebperf } from "@/lib/webperf";
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
  {
    name: "wireless_posture",
    description:
      "Wi-Fi RF/AP survey posture for a school: counts of access points by encryption/auth (open, WEP, WPA2-PSK, WPA2-Enterprise/802.1X, WPA3-SAE), district vs neighbor APs, bands/channels, and a per-SSID summary. Use for questions like 'which SSIDs are open or use weak encryption', 'is the guest network open', 'do we have WPA3', or 'what's broadcasting on channel 6'. Returns empty if the Wi-Fi survey isn't enabled on a sensor at the site.",
    parameters: {
      type: "object",
      properties: { school_id: { type: "number" } },
      required: ["school_id"],
      additionalProperties: false,
    },
  },
  {
    name: "wifi_experience",
    description:
      "Wi-Fi CLIENT-EXPERIENCE results for a school: for each network a sensor joined (open/PSK/PEAP-MSCHAPv2) — whether it associated, time-to-associate and time-to-DHCP, the AP it hit (bssid) + band (2.4/5/6GHz) + link rate, captive-portal state (+ whether auto-accept worked), internet reachability (ping/RTT/loss), DNS, throughput, per-app latency to Google/M365 (app_latency), the full internet_speed_test (download/upload/latency/jitter/loss — PRIMARY network only, else null), the per-URL website_perf measured OVER the Wi-Fi (DNS/TTFB/total, same probe as the wired Speed & Bandwidth page), and the guest->internal ISOLATION check (isolation_reachable=true means a guest network could reach an internal host — a security finding). Use for 'is the staff/guest Wi-Fi actually working / fast', 'how long to join', 'why is Wi-Fi slow / which band', 'how does Classroom perform on the Wi-Fi', 'did the captive portal accept', 'is the guest network isolated'. This is the JOIN experience (WIFI-6), distinct from wireless_posture (the RF/AP survey). Empty if no join battery has run at the site.",
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

      case "wireless_posture": {
        const id = num(args.school_id);
        ensure(id);
        const wifi = await listWifiForSchool(id);
        const b = wifi.bss;
        const byAuth: Record<string, number> = {};
        for (const x of b) {
          const a = x.auth ?? "unknown";
          byAuth[a] = (byAuth[a] ?? 0) + 1;
        }
        const tally = (pred: (x: (typeof b)[number]) => boolean): number =>
          b.filter(pred).length;
        interface SsidSummary {
          ssid: string;
          aps: number;
          security: Set<string>;
          bands: Set<string>;
          channels: Set<number>;
          district: boolean | null;
          best_signal: number | null;
        }
        const ssids = new Map<string, SsidSummary>();
        for (const x of b) {
          const k = x.ssid ?? "<hidden>";
          const s: SsidSummary = ssids.get(k) ?? {
            ssid: k,
            aps: 0,
            security: new Set<string>(),
            bands: new Set<string>(),
            channels: new Set<number>(),
            district: x.isDistrictSsid,
            best_signal: null,
          };
          s.aps += 1;
          if (x.auth) s.security.add(x.auth);
          if (x.band) s.bands.add(x.band);
          if (x.channel != null) s.channels.add(x.channel);
          if (x.isDistrictSsid === true) s.district = true;
          if (x.signal != null && (s.best_signal == null || x.signal > s.best_signal))
            s.best_signal = x.signal;
          ssids.set(k, s);
        }
        return JSON.stringify({
          generated_at: wifi.generatedAt,
          stale: wifi.stale,
          backend: wifi.backend,
          regdom: wifi.regdom,
          total_aps: b.length,
          // Same keying as `networks` below (incl. the hidden bucket) so the two
          // figures can never disagree.
          distinct_ssids: ssids.size,
          district_aps: tally((x) => x.isDistrictSsid === true),
          neighbor_aps: tally((x) => x.isDistrictSsid === false),
          open_aps: tally((x) => x.auth === "open"),
          wep_aps: tally((x) => x.auth === "wep"),
          wpa3_aps: tally((x) => x.auth === "sae" || x.auth === "psk+sae"),
          tkip_aps: tally((x) => (x.cipher ?? "").includes("tkip")),
          by_auth: byAuth,
          networks: Array.from(ssids.values()).map((s) => ({
            ssid: s.ssid,
            aps: s.aps,
            security: Array.from(s.security),
            bands: Array.from(s.bands),
            channels: Array.from(s.channels).sort((a, b) => a - b),
            district: s.district,
            best_signal: s.best_signal,
          })),
        });
      }

      case "wifi_experience": {
        const id = num(args.school_id);
        ensure(id);
        const [exp, wifiSpeed, webperf] = await Promise.all([
          listWifiExperienceForSchool(id),
          listSchoolWifiSpeedtests(id),
          listSchoolWebperf(id),
        ]);
        // latest Wi-Fi internet speed test per (sensor, ssid)
        const speedByKey = new Map<string, (typeof wifiSpeed)[number]>();
        for (const s of wifiSpeed) speedByKey.set(`${s.sensorId}|${s.ssid ?? ""}`, s);
        // latest Wi-Fi website-perf per (ssid, url); webperf is newest-first
        const webBySsid = new Map<string, Map<string, (typeof webperf)[number]>>();
        for (const w of webperf) {
          if (w.transport !== "wifi" || !w.ssid || !w.url) continue;
          const m = webBySsid.get(w.ssid) ?? new Map();
          if (!m.has(w.url)) m.set(w.url, w);
          webBySsid.set(w.ssid, m);
        }
        return JSON.stringify({
          generated_at: exp.generatedAt,
          interface: exp.interface,
          networks: exp.results.map((r) => {
            const st = speedByKey.get(`${r.sensorId}|${r.ssid ?? ""}`);
            const web = r.ssid ? [...(webBySsid.get(r.ssid)?.values() ?? [])] : [];
            return {
              ssid: r.ssid,
              sensor: r.sensorName,
              auth: r.auth,
              associated: r.associated,
              assoc_ms: r.assocMs,
              dhcp_ms: r.dhcpMs,
              band: r.band,
              bssid: r.bssid,
              rx_rate_mbps: r.rxRateMbps,
              captive_state: r.captiveState,
              captive_auto_accepted: r.captiveAutoAccepted,
              captive_vendor: r.captiveVendor, // portal platform: aruba_central|aruba|cisco_wlc|cisco_ise|meraki|generic

              internet_ok: r.pingOk,
              rtt_ms: r.rttMs,
              loss_pct: r.lossPct,
              dns_ok: r.dnsOk,
              throughput_download_mbps: r.downloadMbps,
              // instructional-target latency [{host, rtt_ms}]
              app_latency: r.targets ?? [],
              // full internet speed test — primary network only (else null)
              internet_speed_test: st
                ? {
                    download_mbps: st.downloadMbps,
                    upload_mbps: st.uploadMbps,
                    latency_ms: st.latencyMs,
                    jitter_ms: st.jitterMs,
                    loss_pct: st.lossPct,
                  }
                : null,
              // per-URL website performance measured OVER this Wi-Fi (same probe as wired)
              website_perf: web.map((w) => ({
                url: w.url,
                ok: w.ok,
                dns_ms: w.dnsMs,
                ttfb_ms: w.ttfbMs,
                total_ms: w.totalMs,
                http_status: w.httpStatus,
              })),
              isolation_target: r.isolationTarget,
              isolation_reachable: r.isolationReachable,
              measured_at: r.generatedAt,
            };
          }),
        });
      }

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
