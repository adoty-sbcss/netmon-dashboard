/**
 * Compact, model-ready JSON describing a school's PHYSICAL topology for the AI
 * design review: infrastructure nodes + how they interconnect, leaf fan-out per
 * switch, inventory mix, and SNMP coverage gaps (the blind spots that bound how
 * much of the map can be trusted). Intentionally summarized — no raw host dumps.
 */
import { getSchoolMap } from "@/db/queries";
import { getInventoryForSchool } from "@/lib/inventory/queries";

const INFRA = new Set(["switch", "router", "gateway", "ap", "firewall", "scanner"]);

export async function buildTopologyContext(
  schoolId: number,
  label: string,
): Promise<string> {
  const [map, inv] = await Promise.all([
    getSchoolMap(schoolId),
    getInventoryForSchool(schoolId),
  ]);
  const g = map.physical;
  const nodeById = new Map(g.nodes.map((n) => [n.id, n]));

  const adj = new Map<string, Set<string>>();
  for (const n of g.nodes) adj.set(n.id, new Set());
  for (const e of g.edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }

  const infra = g.nodes.filter((n) => INFRA.has(n.type));
  const infraIds = new Set(infra.map((n) => n.id));

  const infrastructure = infra.map((n) => {
    const neighbors = [...(adj.get(n.id) ?? [])];
    return {
      name: n.label,
      type: n.type,
      ip: n.ip ?? null,
      model: n.model ?? null,
      connectsToInfra: neighbors
        .filter((id) => infraIds.has(id))
        .map((id) => nodeById.get(id)?.label ?? id),
      leafDeviceCount: neighbors.filter((id) => !infraIds.has(id)).length,
    };
  });

  const infraLinks = g.edges
    .filter((e) => infraIds.has(e.source) && infraIds.has(e.target))
    .map((e) => ({
      from: nodeById.get(e.source)?.label ?? e.source,
      to: nodeById.get(e.target)?.label ?? e.target,
      kind: e.kind ?? "lldp",
    }));

  const typeCounts: Record<string, number> = {};
  for (const r of inv.rows) {
    const t = r.deviceType ?? "unknown";
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
  }

  const leafTotal = g.nodes.filter((n) => !INFRA.has(n.type)).length;

  const ctx = {
    school: label,
    inventory: {
      total: inv.total,
      online: inv.online,
      discovered: inv.discovered,
      manual: inv.manual,
      snmpResponding: inv.snmpResponding,
      snmpGaps: inv.snmpGaps,
    },
    deviceTypeCounts: typeCounts,
    infrastructure,
    infraLinks,
    snmpGapDevices: inv.rows
      .filter((r) => r.snmp === "gap")
      .slice(0, 40)
      .map((r) => ({ name: r.name, ip: r.ip, vendor: r.vendor })),
    coverageNote:
      `${leafTotal} leaf devices are attached to a switch port on the physical map ` +
      `via the bridge forwarding table. Devices behind switches that do NOT answer ` +
      `SNMP are not visible, so the map is partial wherever SNMP coverage is missing ` +
      `(${inv.snmpGaps} reachable devices are not answering SNMP). Treat the layout ` +
      `as a lower bound and weight recommendations accordingly.`,
  };

  return JSON.stringify(ctx, null, 1);
}
