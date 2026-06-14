/**
 * Pure (DB-free) physical-topology graph algorithms shared by the ingest snapshot
 * build (ingest.ts) and the validation harness (graph.validate.ts). Everything
 * here operates on the stored snapshot shape `{ nodes, edges }` and imports
 * nothing from the DB layer, so it stays unit-testable with `npx tsx`.
 *
 * The pipeline (run at ingest, on the per-sensor union-merged physical graph):
 *
 *   reconcileNodes     fold gw:/ip:/cdp: placeholders into their canonical
 *                      `switch:<chassis>` node, and TAG the internet-facing
 *                      device (the one the gateway resolves to) as the edge.
 *   anchorEdge         choose the single edge node the Internet hangs off of,
 *                      from the gateway IP / lowest traceroute hop.
 *   inferConnectivity  bridge disconnected infra islands toward the edge using
 *                      traceroute-hop ordering (marked kind:'inferred') so the
 *                      map is never a set of floating clusters.
 *   pruneStale         drop nodes/edges not seen within the freshness window so
 *                      abandoned gear stops accumulating in the union-merge.
 *
 * Why this exists: previously the local LLDP star and the SNMP fabric crawl were
 * union-merged but only stitched together where a `self -> switch` LLDP edge
 * happened to exist, and the gateway (`gw:<ip>`) was never reconciled to its
 * fabric chassis. When either was missing, the sensor + Internet floated as one
 * island and the switch fabric as another — "no path to the internet".
 */

export interface GNode {
  id: string;
  type?: string;
  label?: string | null;
  ip?: string | null;
  mgmt_ip?: string | null;
  capabilities?: string[] | null;
  /** The internet-facing device — the Internet node attaches here at render. */
  isEdge?: boolean;
  /** ISO timestamp of the scan that last contributed this node (freshness). */
  seenAt?: string | null;
  [k: string]: unknown;
}

export interface GEdge {
  source: string;
  target: string;
  kind?: string | null;
  /** Synthesized to bridge a gap — NOT a measured LLDP/CDP/bridge link. */
  inferred?: boolean;
  /** Why we inferred it: 'traceroute' | 'uplink' | 'l3' | 'assumed'. */
  inferredReason?: string;
  seenAt?: string | null;
  [k: string]: unknown;
}

export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
  sourceScanId?: number | null;
}

export interface ConnectOpts {
  /** Default-route gateway IP from the primary scan (the WAN-facing device). */
  gatewayIp?: string | null;
  /** ip -> minimum traceroute hop count (lower = closer to the sensor/edge). */
  hopsByIp?: Map<string, number>;
  /** ISO cutoff: nodes/edges with an older `seenAt` are pruned. Omit to skip. */
  freshnessCutoff?: string | null;
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** The address a node is reachable at: explicit ip, else mgmt_ip, else null. */
function nodeIp(n: GNode): string | null {
  if (isStr(n.ip)) return n.ip;
  if (isStr(n.mgmt_ip)) return n.mgmt_ip;
  // `gw:<ip>` / `ip:<addr>` carry the address in the id.
  if (isStr(n.id) && (n.id.startsWith("gw:") || n.id.startsWith("ip:"))) {
    return n.id.slice(3);
  }
  return null;
}

/** A node id we must never fold away — these are anchors, not placeholders. */
function isStableId(id: string): boolean {
  return (
    id.startsWith("switch:") ||
    id.startsWith("scanner:") ||
    id.startsWith("self:") ||
    id.startsWith("subnet:")
  );
}

/**
 * Fold placeholder nodes (`gw:<ip>`, `ip:<addr>`, `cdp:<name>`, or any node whose
 * ip equals a fabric switch's management IP) into the canonical
 * `switch:<chassis>` node for the same device. Conservative by design: matches
 * ONLY on exact management-IP equality (an IP belongs to exactly one device, so
 * there's no risk of merging two distinct switches). When a `gw:` node folds in,
 * the surviving switch is tagged `isEdge` — that's how the Internet path finally
 * attaches to the real fabric instead of a floating duplicate.
 *
 * Returns the reconciled graph plus the id remap, so the caller can migrate any
 * saved map positions to follow the rekeying.
 */
export function reconcileNodes(graph: Graph): { graph: Graph; remap: Map<string, string> } {
  const ipToSwitch = new Map<string, string>();
  for (const n of graph.nodes) {
    if (isStr(n.id) && n.id.startsWith("switch:")) {
      if (isStr(n.mgmt_ip)) ipToSwitch.set(n.mgmt_ip, n.id);
      if (isStr(n.ip)) ipToSwitch.set(n.ip, n.id);
    }
  }

  const remap = new Map<string, string>();
  if (ipToSwitch.size > 0) {
    for (const n of graph.nodes) {
      if (!isStr(n.id) || isStableId(n.id)) continue;
      const ip = nodeIp(n);
      const target = ip ? ipToSwitch.get(ip) : undefined;
      if (target && target !== n.id) remap.set(n.id, target);
    }
  }
  if (remap.size === 0) return { graph, remap };

  // A gateway placeholder folding into a switch marks that switch as the edge.
  const edgeTargets = new Set<string>();
  for (const [oldId, newId] of remap) {
    if (oldId.startsWith("gw:")) edgeTargets.add(newId);
  }

  const keptNodes = graph.nodes
    .filter((n) => !remap.has(n.id))
    .map((n) => (edgeTargets.has(n.id) ? { ...n, isEdge: true } : n));

  const edgeMap = new Map<string, GEdge>();
  for (const e of graph.edges) {
    const source = remap.get(e.source) ?? e.source;
    const target = remap.get(e.target) ?? e.target;
    if (source === target) continue; // collapsed self-loop → drop
    const ne = { ...e, source, target };
    edgeMap.set(`${source}|${target}|${ne.kind ?? ""}`, ne);
  }

  return {
    graph: { nodes: keptNodes, edges: [...edgeMap.values()], sourceScanId: graph.sourceScanId },
    remap,
  };
}

/**
 * Tag the single internet-facing edge node (mutates the chosen node in place).
 * Priority: a node already tagged by reconcile (a gateway folded into a switch)
 * → the node whose ip/mgmt_ip equals the default-route gateway IP → a surviving
 * `gw:<ip>` node → the lowest-traceroute-hop node. Returns the edge node id.
 */
export function anchorEdge(graph: Graph, opts: ConnectOpts): string | null {
  const already = graph.nodes.find((n) => n.isEdge);
  if (already) return already.id;

  if (isStr(opts.gatewayIp)) {
    const byGw = graph.nodes.find((n) => nodeIp(n) === opts.gatewayIp);
    if (byGw) {
      byGw.isEdge = true;
      return byGw.id;
    }
  }

  const gwNode = graph.nodes.find((n) => isStr(n.id) && n.id.startsWith("gw:"));
  if (gwNode) {
    gwNode.isEdge = true;
    return gwNode.id;
  }

  // Last resort: the node closest to the sensor by traceroute is the most
  // likely path toward the WAN. Skip the sensor's own `self:`/`scanner:` node.
  if (opts.hopsByIp && opts.hopsByIp.size > 0) {
    let best: GNode | null = null;
    let bestHops = Infinity;
    for (const n of graph.nodes) {
      if (isStr(n.id) && (n.id.startsWith("self:") || n.id.startsWith("scanner:"))) continue;
      const ip = nodeIp(n);
      const hops = ip ? opts.hopsByIp.get(ip) : undefined;
      if (hops != null && hops < bestHops) {
        best = n;
        bestHops = hops;
      }
    }
    if (best) {
      best.isEdge = true;
      return best.id;
    }
  }
  return null;
}

/** Undirected adjacency map for the graph's nodes. */
function adjacency(graph: Graph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const n of graph.nodes) adj.set(n.id, new Set());
  for (const e of graph.edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }
  return adj;
}

/** Connected-component index per node id (BFS over undirected edges). */
function components(graph: Graph): Map<string, number> {
  const adj = adjacency(graph);
  const comp = new Map<string, number>();
  let c = 0;
  for (const n of graph.nodes) {
    if (comp.has(n.id)) continue;
    const queue = [n.id];
    comp.set(n.id, c);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nb of adj.get(cur) ?? []) {
        if (!comp.has(nb)) {
          comp.set(nb, c);
          queue.push(nb);
        }
      }
    }
    c++;
  }
  return comp;
}

/**
 * Bridge disconnected infrastructure islands toward the edge so the physical map
 * is one connected graph rooted at the Internet, instead of floating clusters.
 * Mutates `graph.edges` by appending inferred links.
 *
 * For every component that does NOT contain the edge node, we add ONE inferred
 * edge from that component's most-upstream member (lowest traceroute hop) to the
 * edge node. Inferred edges are tagged so the renderer can draw them distinctly —
 * the map stays honest about what was measured vs. assumed.
 */
export function inferConnectivity(
  graph: Graph,
  edgeId: string | null,
  opts: ConnectOpts,
): GEdge[] {
  if (graph.nodes.length === 0) return [];
  const comp = components(graph);
  const rootComp = edgeId != null ? comp.get(edgeId) : undefined;

  // Group node ids by component.
  const byComp = new Map<number, string[]>();
  for (const [id, c] of comp) {
    const arr = byComp.get(c) ?? [];
    arr.push(id);
    byComp.set(c, arr);
  }

  // If we have no edge anchor, root the largest component so we still produce a
  // single tree (the renderer will fall back to its own internet heuristic).
  let anchorComp = rootComp;
  let anchorId = edgeId;
  if (anchorComp == null) {
    let bestC = -1;
    let bestSize = -1;
    for (const [c, ids] of byComp) {
      if (ids.length > bestSize) {
        bestSize = ids.length;
        bestC = c;
      }
    }
    anchorComp = bestC;
    anchorId = bestC >= 0 ? upstreamMember(graph, byComp.get(bestC) ?? [], opts) : null;
  }

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const hopsOf = (id: string): number => {
    const n = nodeById.get(id);
    const ip = n ? nodeIp(n) : null;
    const h = ip ? opts.hopsByIp?.get(ip) : undefined;
    return h ?? Infinity;
  };

  const added: GEdge[] = [];
  for (const [c, ids] of byComp) {
    if (c === anchorComp || anchorId == null) continue;
    const rep = upstreamMember(graph, ids, opts);
    if (!rep || rep === anchorId) continue;
    const reason = hopsOf(rep) !== Infinity ? "traceroute" : "l3";
    const edge: GEdge = {
      source: rep,
      target: anchorId,
      kind: "inferred",
      inferred: true,
      inferredReason: reason,
    };
    graph.edges.push(edge);
    added.push(edge);
  }
  return added;
}

/** The most-upstream member of a component: lowest traceroute hop, then the
 *  most-connected node, then a router-capable node, as tie-breaks. */
function upstreamMember(graph: Graph, ids: string[], opts: ConnectOpts): string | null {
  if (ids.length === 0) return null;
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const deg = new Map<string, number>();
  for (const e of graph.edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  }
  const score = (id: string): [number, number, number] => {
    const n = nodeById.get(id);
    const ip = n ? nodeIp(n) : null;
    const hops = (ip ? opts.hopsByIp?.get(ip) : undefined) ?? Infinity;
    const caps = (n?.capabilities ?? []).map((s) => String(s).toLowerCase());
    const routerish = caps.includes("router") ? 0 : 1;
    return [hops, routerish, -(deg.get(id) ?? 0)];
  };
  let best = ids[0];
  let bestScore = score(best);
  for (const id of ids.slice(1)) {
    const s = score(id);
    if (s[0] < bestScore[0] || (s[0] === bestScore[0] && (s[1] < bestScore[1] || (s[1] === bestScore[1] && s[2] < bestScore[2])))) {
      best = id;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Drop nodes/edges whose `seenAt` is older than the cutoff so abandoned gear
 * ages out of the union-merged snapshot. Nodes with no `seenAt` (pre-stamp data)
 * are kept — we never want a one-time prune to nuke an existing map.
 */
export function pruneStale(graph: Graph, cutoffIso: string): Graph {
  const fresh = (seen: string | null | undefined) => !isStr(seen) || seen >= cutoffIso;
  const nodes = graph.nodes.filter((n) => fresh(n.seenAt));
  const keep = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter(
    (e) => keep.has(e.source) && keep.has(e.target) && fresh(e.seenAt),
  );
  return { nodes, edges, sourceScanId: graph.sourceScanId };
}

/**
 * Full ingest pipeline on a per-sensor union-merged physical graph: reconcile
 * placeholders + gateway, anchor the edge, bridge islands, prune stale. Returns
 * the connected graph, the reconcile id remap (for position migration), and the
 * chosen edge node id.
 */
export function connectPhysicalGraph(
  input: Graph,
  opts: ConnectOpts = {},
): { graph: Graph; remap: Map<string, string>; edgeId: string | null } {
  // Inferred links are DERIVED from the current structure, so regenerate them
  // each ingest instead of letting last run's guesses persist in the union-merge
  // (a real LLDP/CDP link may have appeared since, making the old guess wrong).
  const measured: Graph = {
    ...input,
    edges: input.edges.filter((e) => e.kind !== "inferred" && !e.inferred),
  };
  const { graph: reconciled, remap } = reconcileNodes(measured);
  // Clone so anchor/infer mutate a fresh copy, never the caller's objects.
  const g: Graph = {
    nodes: reconciled.nodes.map((n) => ({ ...n })),
    edges: reconciled.edges.map((e) => ({ ...e })),
    sourceScanId: reconciled.sourceScanId,
  };
  const edgeId = anchorEdge(g, opts);
  inferConnectivity(g, edgeId, opts);
  const pruned = isStr(opts.freshnessCutoff) ? pruneStale(g, opts.freshnessCutoff) : g;
  return { graph: pruned, remap, edgeId };
}

/** BFS depth of every node from the edge/root (edge = 0). Unreachable → null.
 *  The renderer uses this to rank the layout Internet → edge → core → access. */
export function rankByDepth(graph: Graph, rootId: string | null): Map<string, number> {
  const depth = new Map<string, number>();
  if (!rootId) return depth;
  const adj = adjacency(graph);
  if (!adj.has(rootId)) return depth;
  depth.set(rootId, 0);
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    for (const nb of adj.get(cur) ?? []) {
      if (!depth.has(nb)) {
        depth.set(nb, d + 1);
        queue.push(nb);
      }
    }
  }
  return depth;
}

// --------------------------------------------------------------------------
// Collapse (read-time, on the render-ready MapGraph). Kept here so it's pure
// and testable; queries.ts calls it after enrich + the FDB overlay.
// --------------------------------------------------------------------------

// Minimal structural shapes the collapse operates on — deliberately NO index
// signature, so the render-ready MapNode/TopoEdge (which have none) satisfy them
// and generic inference keeps the caller's richer types on the way out.
export interface CNode {
  id: string;
  type?: string;
  ip?: string | null;
  label?: string;
  entityId?: number | null;
}
export interface CEdge {
  source: string;
  target: string;
  kind?: string | null;
  speed_mbps?: number | null;
}

const INFRA_TYPES = new Set(["router", "gateway", "switch", "ap", "firewall", "scanner"]);

/**
 * Collapse two kinds of visual clutter, in this order:
 *
 *  1. Switch STACKS — multiple chassis that are really one logical switch. We
 *     merge switch nodes that share a non-empty management IP, OR that share an
 *     identical system name AND are directly cabled together (a stacking link).
 *     Both are low-false-positive signals (one mgmt IP = one managed device).
 *     The survivor keeps a real entity link (click-through still works) and
 *     carries `stackCount` for a "stack ×N" badge.
 *
 *  2. LAG bundles — multiple measured links between the SAME pair of devices.
 *     We fold them into one edge carrying `lagCount` and the summed speed, so a
 *     port-channel reads as one fat link, not a thicket.
 *
 * Generic over the node/edge shape so queries.ts can pass its MapGraph directly.
 */
export function collapseStacksAndLags<N extends CNode, E extends CEdge>(g: {
  nodes: N[];
  edges: E[];
}): { nodes: N[]; edges: E[] } {
  const remap = stackRemap(g);

  // Rewire nodes: keep survivors, stamp stackCount/members on them.
  const members = new Map<string, string[]>();
  for (const [member, survivor] of remap) {
    const arr = members.get(survivor) ?? [];
    arr.push(member);
    members.set(survivor, arr);
  }
  const nodes = g.nodes
    .filter((n) => !remap.has(n.id))
    .map((n) => {
      const m = members.get(n.id);
      return m ? ({ ...n, stackCount: m.length + 1 } as N) : n;
    });

  // Rewire + dedup edges through the stack remap, then bundle LAGs.
  type Acc = E & { lagCount?: number };
  const byPair = new Map<string, Acc>();
  // Non-bundled edges (fdb/inferred/wan) — keyed source|target|kind so rewiring two
  // stack members onto one survivor can't emit a duplicate edge id downstream.
  const passByKey = new Map<string, E>();
  for (const e of g.edges) {
    const source = remap.get(e.source) ?? e.source;
    const target = remap.get(e.target) ?? e.target;
    if (source === target) continue; // intra-stack link → gone
    const rewired = { ...e, source, target } as E;
    // Only bundle measured infra-to-infra links; leave fdb/inferred/wan alone.
    const kind = e.kind ?? "";
    const bundleable = kind === "lldp" || kind === "cdp" || kind === "";
    if (!bundleable) {
      passByKey.set(`${source}|${target}|${kind}`, rewired);
      continue;
    }
    const a = source < target ? source : target;
    const b = source < target ? target : source;
    const key = `${a}|${b}`;
    const prev = byPair.get(key);
    if (!prev) {
      byPair.set(key, { ...rewired, lagCount: 1 } as Acc);
    } else {
      prev.lagCount = (prev.lagCount ?? 1) + 1;
      const ps = typeof prev.speed_mbps === "number" ? prev.speed_mbps : 0;
      const es = typeof e.speed_mbps === "number" ? e.speed_mbps : 0;
      if (ps || es) prev.speed_mbps = ps + es;
    }
  }
  const bundled = [...byPair.values()].map((e) => {
    if ((e.lagCount ?? 1) <= 1) {
      const { lagCount: _drop, ...rest } = e;
      void _drop;
      return rest as E;
    }
    return e as unknown as E;
  });

  return { nodes, edges: [...bundled, ...passByKey.values()] };
}

/** Build member-id -> survivor-id remap for switch stacks. */
function stackRemap<N extends CNode, E extends CEdge>(g: { nodes: N[]; edges: E[] }): Map<string, string> {
  const switches = g.nodes.filter((n) => (n.type ?? "") === "switch" || INFRA_TYPES.has(n.type ?? ""));
  // Union-find over stack-equivalent switches.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const n of switches) parent.set(n.id, n.id);

  // (1) shared non-empty management IP.
  const byIp = new Map<string, string[]>();
  for (const n of switches) {
    if (isStr(n.ip)) {
      const arr = byIp.get(n.ip) ?? [];
      arr.push(n.id);
      byIp.set(n.ip, arr);
    }
  }
  for (const ids of byIp.values()) {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  // (2) identical system name AND a direct link between them (a stacking cable).
  const nameById = new Map(switches.map((n) => [n.id, (n.label ?? "").trim().toLowerCase()]));
  const swIds = new Set(switches.map((n) => n.id));
  for (const e of g.edges) {
    if (!swIds.has(e.source) || !swIds.has(e.target)) continue;
    const na = nameById.get(e.source);
    const nb = nameById.get(e.target);
    if (na && na === nb) union(e.source, e.target);
  }

  // Choose a survivor per group: prefer a node with a real entityId (so
  // click-through opens a switch), else the lexicographically smallest id.
  const groups = new Map<string, string[]>();
  for (const n of switches) {
    const r = find(n.id);
    const arr = groups.get(r) ?? [];
    arr.push(n.id);
    groups.set(r, arr);
  }
  const entityIdById = new Map(g.nodes.map((n) => [n.id, n.entityId ?? null]));
  const remap = new Map<string, string>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort();
    const survivor = sorted.find((id) => entityIdById.get(id) != null) ?? sorted[0];
    for (const id of ids) if (id !== survivor) remap.set(id, survivor);
  }
  return remap;
}
