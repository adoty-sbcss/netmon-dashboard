/**
 * Deterministic validation harness for the physical-topology graph pipeline
 * (graph.ts). No database, no browser — run with:  npx tsx src/lib/topology/graph.validate.ts
 *
 * It reproduces the real "Roy C Hill" symptom (sensor + Internet floating as one
 * island, the SNMP switch fabric as another) plus the gateway-reconcile and
 * stack/LAG-collapse cases, and asserts the redesign produces ONE connected,
 * anchored, collapsed graph. Exits non-zero on any failure.
 */
import {
  connectPhysicalGraph,
  collapseStacksAndLags,
  type Graph,
  type GNode,
} from "./graph";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  const tag = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  [${tag}] ${name}${detail && !cond ? ` — ${detail}` : ""}`);
}

/** Count connected components over an undirected view of the graph. */
function componentCount(g: Graph): number {
  const adj = new Map<string, Set<string>>();
  for (const n of g.nodes) adj.set(n.id, new Set());
  for (const e of g.edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }
  const seen = new Set<string>();
  let c = 0;
  for (const n of g.nodes) {
    if (seen.has(n.id)) continue;
    c++;
    const q = [n.id];
    seen.add(n.id);
    while (q.length) {
      const cur = q.shift()!;
      for (const nb of adj.get(cur) ?? []) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
  }
  return c;
}

// ---------------------------------------------------------------------------
// Scenario A — the Roy C Hill island: sensor+gateway disconnected from fabric.
// ---------------------------------------------------------------------------
function scenarioIsland() {
  console.log("\nScenario A — bridge the sensor/Internet island to the fabric");
  const sw = (chassis: string, mgmt: string, name: string): GNode => ({
    id: `switch:${chassis}`,
    type: "switch",
    label: name,
    mgmt_ip: mgmt,
    capabilities: ["bridge"],
  });
  const input: Graph = {
    nodes: [
      { id: "self:eth0#s1", type: "scanner", label: "NetMon", ip: "10.8.2.50/24" },
      { id: "gw:10.8.2.1", type: "gateway", label: "gateway 10.8.2.1", ip: "10.8.2.1" },
      sw("CORE", "10.8.2.2", "core-sw"),
      sw("ACC1", "10.8.2.3", "acc1-sw"),
      sw("ACC2", "10.8.2.4", "acc2-sw"),
    ],
    edges: [
      // The sensor only reaches the gateway (default route). The fabric below is
      // a SEPARATE island — exactly the bug: no measured path between them.
      { source: "self:eth0#s1", target: "gw:10.8.2.1", kind: "default_route" },
      { source: "switch:CORE", target: "switch:ACC1", kind: "lldp" },
      { source: "switch:CORE", target: "switch:ACC2", kind: "lldp" },
    ],
  };
  // Two islands before connecting.
  check("starts as 2 islands", componentCount(input) === 2, `got ${componentCount(input)}`);

  const hopsByIp = new Map<string, number>([
    ["10.8.2.1", 1], // gateway is closest
    ["10.8.2.2", 2], // core is the most-upstream fabric node
    ["10.8.2.3", 3],
    ["10.8.2.4", 3],
  ]);
  const { graph, edgeId } = connectPhysicalGraph(input, { gatewayIp: "10.8.2.1", hopsByIp });

  check("collapses to 1 connected graph", componentCount(graph) === 1, `got ${componentCount(graph)}`);
  check("anchors the Internet edge on the gateway", edgeId === "gw:10.8.2.1", `edgeId=${edgeId}`);
  check("tags exactly one edge node", graph.nodes.filter((n) => n.isEdge).length === 1);
  const inferred = graph.edges.filter((e) => e.inferred);
  check("adds an inferred bridge link", inferred.length >= 1, `inferred=${inferred.length}`);
  check(
    "roots the fabric at its most-upstream node (core, hops=2)",
    inferred.some((e) => e.source === "switch:CORE" || e.target === "switch:CORE"),
  );
}

// ---------------------------------------------------------------------------
// Scenario B — the gateway IS in the fabric: fold gw:<ip> into switch:<chassis>.
// ---------------------------------------------------------------------------
function scenarioReconcileGateway() {
  console.log("\nScenario B — reconcile the gateway placeholder into its fabric node");
  const input: Graph = {
    nodes: [
      { id: "self:eth0#s1", type: "scanner", label: "NetMon", ip: "10.9.0.50/24" },
      { id: "gw:10.9.0.1", type: "gateway", label: "gateway 10.9.0.1", ip: "10.9.0.1" },
      { id: "switch:EDGE", type: "switch", label: "edge-fw", mgmt_ip: "10.9.0.1", capabilities: ["router"] },
      { id: "switch:CORE", type: "switch", label: "core-sw", mgmt_ip: "10.9.0.2", capabilities: ["bridge"] },
    ],
    edges: [
      { source: "self:eth0#s1", target: "gw:10.9.0.1", kind: "default_route" },
      { source: "switch:EDGE", target: "switch:CORE", kind: "lldp" },
    ],
  };
  const { graph, remap, edgeId } = connectPhysicalGraph(input, { gatewayIp: "10.9.0.1" });

  check("folds gw:<ip> away", !graph.nodes.some((n) => n.id.startsWith("gw:")));
  check("remaps gateway → fabric chassis", remap.get("gw:10.9.0.1") === "switch:EDGE");
  check("edge anchored on the real fabric node", edgeId === "switch:EDGE", `edgeId=${edgeId}`);
  check("tags the fabric edge node", graph.nodes.find((n) => n.id === "switch:EDGE")?.isEdge === true);
  check("stays connected (no inference needed)", componentCount(graph) === 1);
  check("no inferred links when measured path exists", graph.edges.every((e) => !e.inferred));
}

// ---------------------------------------------------------------------------
// Scenario C — collapse a 2-member stack + bundle a 2× LAG.
// ---------------------------------------------------------------------------
function scenarioCollapse() {
  console.log("\nScenario C — collapse switch stack + bundle LAG");
  const map = {
    nodes: [
      { id: "switch:CORE", type: "switch", ip: "10.7.0.2", label: "core", entityId: 1 },
      { id: "switch:STK-A", type: "switch", ip: "10.7.0.5", label: "dist-sw", entityId: 2 },
      { id: "switch:STK-B", type: "switch", ip: "10.7.0.5", label: "dist-sw", entityId: 3 },
    ],
    edges: [
      // Two parallel core↔stack links = a LAG; plus the intra-stack link.
      { source: "switch:CORE", target: "switch:STK-A", kind: "lldp", speed_mbps: 10000 },
      { source: "switch:CORE", target: "switch:STK-B", kind: "lldp", speed_mbps: 10000 },
      { source: "switch:STK-A", target: "switch:STK-B", kind: "lldp" },
    ],
  };
  const out = collapseStacksAndLags(map);
  check("stack collapses to one node", out.nodes.length === 2, `nodes=${out.nodes.length}`);
  const stackNode = out.nodes.find((n) => (n as { stackCount?: number }).stackCount);
  check("survivor carries stackCount=2", (stackNode as { stackCount?: number })?.stackCount === 2);
  check("intra-stack link removed", !out.edges.some((e) => e.source === e.target));
  const lag = out.edges.find((e) => (e as { lagCount?: number }).lagCount);
  check("parallel links bundle into a LAG", (lag as { lagCount?: number })?.lagCount === 2);
  check("LAG sums member speed (20G)", (lag as { speed_mbps?: number })?.speed_mbps === 20000);
}

console.log("NetMon topology pipeline — validation");
scenarioIsland();
scenarioReconcileGateway();
scenarioCollapse();
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
