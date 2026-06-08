/**
 * Builds the evidence context a model reads for one analysis run. Composes the
 * existing server query helpers (src/db/queries.ts) so the AI sees the SAME
 * compact, deduped picture the dashboard renders — not raw packet dumps.
 *
 * Design choices for cost/context discipline (docs/DESIGN.md §10):
 *  - We feed COMPACT rollups (resolver health, DHCP scopes+issues, STP summary,
 *    switch inventory, host-type breakdown, recent findings, the daily health
 *    trend) — never the bulky per-probe / per-packet / raw-SNMP data.
 *  - The raw `raw/` SNMP stays in Blob; a future "drill into scan N" hook can
 *    pull it on demand. For now the seam is documented and unused.
 *
 * Output is a single JSON string (compact, deterministic) the adapters pass as
 * the user message.
 */
import "server-only";

import {
  listSchools,
  getSchoolStats,
  listFindingsForSchool,
  listDnsForSchool,
  getDhcpAnalysis,
  listStpForSchool,
  listSwitchesForSchool,
  listHostsForSchool,
  getSchoolHealthTrend,
} from "@/db/queries";
import { getAuthorizedDhcpServerSet } from "@/lib/dhcp-policy";
import type { AnalysisScope, AnalysisWindow } from "./types";

/** Compact per-school evidence block. */
interface SchoolContext {
  slug: string;
  name: string | null;
  stats: Awaited<ReturnType<typeof getSchoolStats>>;
  recentFindings: { severity: string; title: string; detail: string | null }[];
  dnsResolvers: {
    resolverIp: string | null;
    source: string | null;
    probes: number | null;
    ok: number | null;
    errors: number | null;
    meanMs: number | null;
    nxdomainRewrite: boolean | null;
  }[];
  dhcp: {
    summary: Awaited<ReturnType<typeof getDhcpAnalysis>>["summary"];
    scopes: Awaited<ReturnType<typeof getDhcpAnalysis>>["scopes"];
    servers: Awaited<ReturnType<typeof getDhcpAnalysis>>["servers"];
    issues: Awaited<ReturnType<typeof getDhcpAnalysis>>["issues"];
  };
  stp: { total: number; topologyChanges: number; rootBridges: string[] };
  switches: {
    name: string | null;
    mgmtIp: string | null;
    description: string | null;
  }[];
  hostTypeBreakdown: Record<string, number>;
  healthTrend: { day: string; metrics: Record<string, number> }[];
}

async function buildSchoolContext(
  schoolId: number,
  slug: string,
  name: string | null,
  authorizedServers: Set<string>,
): Promise<SchoolContext> {
  const [stats, findings, dns, dhcp, stp, switches, hosts, trend] =
    await Promise.all([
      getSchoolStats(schoolId),
      listFindingsForSchool(schoolId, 50),
      listDnsForSchool(schoolId),
      // AI-5: pass the authorized list so DHCP issues are authorization-aware
      // (each server tagged authorized:true/false; expected failover not flagged).
      getDhcpAnalysis(schoolId, { authorizedServers }),
      listStpForSchool(schoolId),
      listSwitchesForSchool(schoolId),
      listHostsForSchool(schoolId),
      getSchoolHealthTrend(schoolId, 30),
    ]);

  const hostTypeBreakdown: Record<string, number> = {};
  for (const h of hosts) {
    const key = h.deviceType ?? "unknown";
    hostTypeBreakdown[key] = (hostTypeBreakdown[key] ?? 0) + 1;
  }

  return {
    slug,
    name,
    stats,
    recentFindings: findings.map((f) => ({
      severity: f.severity,
      title: f.title,
      detail: f.detail,
    })),
    dnsResolvers: dns.resolvers.map((r) => ({
      resolverIp: r.resolverIp,
      source: r.resolverSource,
      probes: r.probes,
      ok: r.ok,
      errors: r.errors,
      meanMs: r.meanMs,
      nxdomainRewrite: r.nxdomainRewrite,
    })),
    dhcp: {
      summary: dhcp.summary,
      scopes: dhcp.scopes,
      servers: dhcp.servers,
      issues: dhcp.issues,
    },
    stp: {
      total: stp.total,
      topologyChanges: stp.topologyChanges,
      rootBridges: stp.rootBridges,
    },
    switches: switches.map((s) => ({
      name: s.systemName,
      mgmtIp: s.mgmtIp,
      description: s.systemDescription,
    })),
    hostTypeBreakdown,
    healthTrend: trend,
  };
}

/**
 * Assemble the context for a scope. School scope → one block; district scope →
 * one block per school in the district. Returns a compact JSON string.
 */
export async function buildAnalysisContext(
  scope: AnalysisScope,
  window: AnalysisWindow,
): Promise<string> {
  // Operator-declared authorized DHCP servers for this district — fetched first so
  // each school's DHCP analysis can tag servers authorized:true/false and skip
  // "rogue" framing for expected (failover) servers (AI-5).
  const authorizedSet = await getAuthorizedDhcpServerSet(scope.districtId);

  let schools_: SchoolContext[];

  if (scope.type === "school") {
    schools_ = [await buildSchoolContext(scope.id, scope.label, scope.label, authorizedSet)];
  } else {
    const schoolRows = await listSchools(scope.districtId);
    schools_ = await Promise.all(
      schoolRows.map((s) => buildSchoolContext(s.id, s.slug, s.name, authorizedSet)),
    );
  }

  const authorizedDhcpServers = [...authorizedSet];

  const payload = {
    scope: { type: scope.type, label: scope.label },
    window: { start: window.start.toISOString(), end: window.end.toISOString() },
    authorizedDhcpServers,
    schoolCount: schools_.length,
    schools: schools_,
  };

  return JSON.stringify(payload, null, 2);
}
