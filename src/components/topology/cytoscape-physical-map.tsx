"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, EyeOff, Layers, Maximize2, Network, RotateCcw, Save, Table2 } from "lucide-react";

import type { MapGraph } from "@/db/queries";
import { saveMapPositions, setDeviceMapHidden } from "@/lib/admin/map-actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { iconUri } from "./device-icons";

/** Per-type node appearance. Infra render as rounded tiles, endpoints as circles. */
const TYPE_STYLE: Record<string, { color: string; shape: string }> = {
  internet: { color: "#0f172a", shape: "round-rectangle" },
  router: { color: "#f59e0b", shape: "round-rectangle" },
  gateway: { color: "#f59e0b", shape: "round-rectangle" },
  scanner: { color: "#3b82f6", shape: "round-rectangle" },
  switch: { color: "#8b5cf6", shape: "round-rectangle" },
  ap: { color: "#06b6d4", shape: "round-rectangle" },
  firewall: { color: "#ef4444", shape: "round-rectangle" },
  server: { color: "#6366f1", shape: "round-rectangle" },
  printer: { color: "#64748b", shape: "ellipse" },
  camera: { color: "#0ea5e9", shape: "ellipse" },
  computer: { color: "#94a3b8", shape: "ellipse" },
  phone: { color: "#10b981", shape: "ellipse" },
  mobile: { color: "#a855f7", shape: "ellipse" },
  storage: { color: "#0d9488", shape: "ellipse" },
  iot: { color: "#eab308", shape: "ellipse" },
  subnet: { color: "#14b8a6", shape: "round-rectangle" },
  group: { color: "#cbd5e1", shape: "round-rectangle" },
  host: { color: "#94a3b8", shape: "ellipse" },
  default: { color: "#94a3b8", shape: "ellipse" },
};
const styleFor = (t: string) => TYPE_STYLE[t] ?? TYPE_STYLE.default;
const INFRA = new Set(["internet", "router", "gateway", "scanner", "switch", "ap", "firewall"]);
const TYPE_LABEL: Record<string, string> = {
  internet: "Internet", router: "Router", gateway: "Gateway", scanner: "Sensor",
  switch: "Switch", ap: "Access point", firewall: "Firewall", server: "Server",
  printer: "Printer", camera: "Camera", computer: "Computer", phone: "IP phone",
  mobile: "Mobile", storage: "Storage", media: "Media / TV", display: "Display",
  iot: "IoT", subnet: "Subnet", group: "Group", host: "Host",
};
const typeLabel = (t: string) => TYPE_LABEL[t] ?? t.charAt(0).toUpperCase() + t.slice(1);
const trunc = (s: string) => (s && s.length > 22 ? s.slice(0, 21) + "…" : s);

function buildElements(
  graph: MapGraph,
  infraOnly: boolean,
  groupLeaves: boolean,
  status: Record<string, string>,
  hiddenTypes: Set<string>,
) {
  const keep = (t: string) => (infraOnly ? INFRA.has(t) : true) && !hiddenTypes.has(t);
  const nodes = graph.nodes.filter((n) => keep(n.type));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  // Group: fold degree-1 endpoint leaves under their single switch parent into
  // one "N devices" node (only when it declutters — 3+ leaves on a parent).
  const grouped = new Set<string>();
  const groupNodes: { parent: string; count: number }[] = [];
  if (groupLeaves) {
    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n.id, []);
    for (const e of edges) {
      adj.get(e.source)?.push(e.target);
      adj.get(e.target)?.push(e.source);
    }
    const isLeaf = (t: string) => !INFRA.has(t) && t !== "subnet" && t !== "group";
    const byParent = new Map<string, string[]>();
    for (const n of nodes) {
      const nbrs = adj.get(n.id) ?? [];
      if (isLeaf(n.type) && nbrs.length === 1) {
        const p = nbrs[0];
        const arr = byParent.get(p) ?? [];
        arr.push(n.id);
        byParent.set(p, arr);
      }
    }
    for (const [p, ids] of byParent) {
      if (ids.length >= 3) {
        ids.forEach((id) => grouped.add(id));
        groupNodes.push({ parent: p, count: ids.length });
      }
    }
  }

  const els: any[] = [];
  const gw = nodes.find((n) => n.type === "gateway" || n.type === "router");
  if (gw) {
    els.push({
      data: { id: "__internet", label: "Internet", full: "Internet", type: "internet", ip: "", model: "", entityId: null, entityKind: null, color: TYPE_STYLE.internet.color, shape: "round-rectangle", icon: iconUri("internet"), status: "" },
    });
  }
  for (const n of nodes) {
    if (grouped.has(n.id)) continue;
    const s = styleFor(n.type);
    const key = n.entityId && n.entityKind ? `${n.entityKind}:${n.entityId}` : "";
    els.push({
      data: {
        id: n.id,
        label: trunc(n.label),
        full: n.label,
        type: n.type,
        ip: n.ip ?? "",
        model: n.model ?? "",
        vendor: n.vendor ?? "",
        firmware: n.firmware ?? "",
        port: n.port ?? "",
        entityId: n.entityId ?? null,
        entityKind: n.entityKind ?? null,
        color: s.color,
        shape: s.shape,
        icon: iconUri(n.type),
        status: status[key] ?? "",
      },
    });
  }
  for (const g of groupNodes) {
    const gid = `${g.parent}__grp`;
    els.push({ data: { id: gid, label: `${g.count} devices`, full: `${g.count} devices`, type: "group", ip: "", model: "", entityId: null, entityKind: null, color: TYPE_STYLE.group.color, shape: "round-rectangle", icon: iconUri("group"), status: "" } });
    els.push({ data: { id: `e_${gid}`, source: gid, target: g.parent, kind: "fdb" } });
  }
  if (gw) els.push({ data: { id: "e_internet", source: "__internet", target: gw.id, kind: "wan" } });
  for (const e of edges) {
    if (grouped.has(e.source) || grouped.has(e.target)) continue;
    els.push({ data: { id: `e_${e.source}_${e.target}_${e.kind ?? ""}`, source: e.source, target: e.target, kind: e.kind ?? "" } });
  }
  return els;
}

const STYLESHEET: any[] = [
  {
    selector: "node",
    style: {
      shape: "data(shape)",
      "background-color": "data(color)",
      "background-image": "data(icon)",
      "background-fit": "contain",
      label: "data(label)",
      "font-size": 9.5,
      "text-valign": "bottom",
      "text-margin-y": 4,
      "text-max-width": 120,
      "text-wrap": "ellipsis",
      color: "#334155",
      width: 40,
      height: 32,
      "border-width": 2,
      "border-color": "#ffffff",
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.7,
      "text-background-padding": 2,
      "text-background-shape": "round-rectangle",
    },
  },
  { selector: 'node[shape="ellipse"]', style: { width: 30, height: 30 } },
  { selector: 'node[type="switch"]', style: { width: 50, height: 34 } },
  { selector: 'node[type="internet"]', style: { width: 46, height: 32 } },
  { selector: 'node[type="group"]', style: { width: 42, height: 30, color: "#475569" } },
  // Status ring (from the inventory overlay).
  { selector: 'node[status="snmp"]', style: { "border-color": "#10b981", "border-width": 3 } },
  { selector: 'node[status="gap"]', style: { "border-color": "#f59e0b", "border-width": 3 } },
  { selector: 'node[status="online"]', style: { "border-color": "#38bdf8", "border-width": 3 } },
  { selector: 'node[status="offline"]', style: { "border-color": "#cbd5e1", "border-width": 2, opacity: 0.6 } },
  { selector: "edge", style: { width: 1.4, "line-color": "#cbd5e1", "curve-style": "bezier", "target-arrow-shape": "none" } },
  { selector: 'edge[kind="fdb"]', style: { "line-color": "#93c5fd", width: 1 } },
  { selector: 'edge[kind="wan"]', style: { "line-color": "#fbbf24", width: 2.5 } },
  { selector: "node:selected", style: { "border-color": "#6366f1", "border-width": 4 } },
  { selector: ".dim", style: { opacity: 0.2 } },
];

const STATUS_LEGEND: { key: string; label: string; color: string }[] = [
  { key: "snmp", label: "Answering SNMP", color: "#10b981" },
  { key: "gap", label: "Reachable, no SNMP", color: "#f59e0b" },
  { key: "online", label: "Online", color: "#38bdf8" },
  { key: "offline", label: "Offline", color: "#cbd5e1" },
];

interface HoverState {
  x: number;
  y: number;
  label: string;
  ip: string;
  type: string;
  model: string;
  vendor: string;
  firmware: string;
  port: string;
  status: string;
  connected: number;
}
interface MenuState {
  x: number;
  y: number;
  entityId: number;
  entityKind: "switch" | "host";
  label: string;
}

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  snmp: { label: "Answering SNMP", color: "#10b981" },
  gap: { label: "Reachable, no SNMP", color: "#f59e0b" },
  online: { label: "Online", color: "#38bdf8" },
  offline: { label: "Offline", color: "#94a3b8" },
};

export function CytoscapePhysicalMap({
  graph,
  basePath,
  status = {},
  schoolId,
  canSave = false,
}: {
  graph: MapGraph;
  basePath: string;
  status?: Record<string, string>;
  schoolId: number;
  canSave?: boolean;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  const [infraOnly, setInfraOnly] = useState(false);
  const [groupLeaves, setGroupLeaves] = useState(true);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [cw, setCw] = useState(800);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [, startHide] = useTransition();

  // Device-type toggles (chips): the distinct types present + per-type counts.
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of graph.nodes) m.set(n.type, (m.get(n.type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph]);

  const elements = useMemo(
    () => buildElements(graph, infraOnly, groupLeaves, status, hiddenTypes),
    [graph, infraOnly, groupLeaves, status, hiddenTypes],
  );

  function toggleType(t: string) {
    setHiddenTypes((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  }
  function hideDevice(m: MenuState) {
    setMenu(null);
    startHide(async () => {
      const res = await setDeviceMapHidden(schoolId, m.entityKind, m.entityId, true, basePath);
      if (res.ok) router.refresh();
    });
  }

  useEffect(() => {
    let cy: any;
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const cytoscape = (await import("cytoscape")).default;
      const dagre = (await import("cytoscape-dagre")).default;
      try {
        cytoscape.use(dagre);
      } catch {
        /* already registered */
      }
      if (cancelled || !containerRef.current) return;
      setCw(containerRef.current.clientWidth || 800);
      ro = new ResizeObserver(() => setCw(containerRef.current?.clientWidth || 800));
      ro.observe(containerRef.current);

      cy = cytoscape({
        container: containerRef.current,
        elements,
        style: STYLESHEET,
        layout: { name: "dagre", rankDir: "TB", nodeSep: 22, rankSep: 64, fit: true, padding: 30 } as any,
        wheelSensitivity: 0.2,
        minZoom: 0.12,
        maxZoom: 3.5,
      });
      cyRef.current = cy;

      cy.on("tap", "node", (e: any) => {
        setMenu(null);
        const d = e.target.data();
        if (d.entityId && d.entityKind) router.push(`${basePath}/${d.entityKind}/${d.entityId}`);
      });
      cy.on("tap", (e: any) => {
        if (e.target === cy) setMenu(null); // background tap closes the menu
      });
      // Right-click a device → context menu (Open / Hide from map).
      cy.on("cxttap", "node", (e: any) => {
        const d = e.target.data();
        if (!d.entityId || !d.entityKind) return; // can't act on subnet/group/internet
        const rp = e.target.renderedPosition();
        setHover(null);
        setMenu({ x: rp.x, y: rp.y, entityId: d.entityId, entityKind: d.entityKind, label: d.full || d.label });
      });
      cy.on("mouseover", "node", (e: any) => {
        const d = e.target.data();
        const rp = e.target.renderedPosition();
        setHover({
          x: rp.x,
          y: rp.y,
          label: d.full || d.label,
          ip: d.ip,
          type: d.type,
          model: d.model,
          vendor: d.vendor,
          firmware: d.firmware,
          port: d.port,
          status: d.status,
          connected: e.target.degree(false),
        });
        const hood = e.target.closedNeighborhood();
        cy.elements().not(hood).addClass("dim");
      });
      cy.on("mouseout", "node", () => {
        setHover(null);
        cy.elements().removeClass("dim");
      });
      // Panning/zooming should dismiss an open menu so it never floats out of place.
      cy.on("pan zoom drag", () => setMenu(null));

      // Apply any saved manual positions ON TOP of the auto-layout: nodes you've
      // placed snap back to where you left them; new/unplaced nodes keep their
      // dagre spot (so the layout fills gaps but never stomps a manual arrangement).
      const savedPos = (graph.positions ?? {}) as Record<string, { x: number; y: number }>;
      let applied = 0;
      cy.nodes().forEach((n: any) => {
        const p = savedPos[n.id()];
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
          n.position({ x: p.x, y: p.y });
          applied++;
        }
      });
      if (applied > 0) cy.fit(undefined, 30);
      cy.on("dragfree", "node", () => setDirty(true));
      setDirty(false);
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      cy?.destroy();
    };
  }, [elements, basePath, router, graph]);

  function fit() {
    cyRef.current?.fit(undefined, 30);
  }
  async function saveLayout() {
    const cy = cyRef.current;
    if (!cy) return;
    setSaving(true);
    const positions = cy
      .nodes()
      .map((n: any) => ({ nodeId: n.id(), x: n.position("x"), y: n.position("y") }));
    const res = await saveMapPositions(schoolId, "physical", basePath, positions);
    setSaving(false);
    if (res.ok) {
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }
  function autoLayout() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.layout({ name: "dagre", rankDir: "TB", nodeSep: 22, rankSep: 64, fit: true, padding: 30 } as any).run();
    setDirty(true); // let the operator save the re-laid-out arrangement to overwrite
  }
  function exportPng() {
    const cy = cyRef.current;
    if (!cy) return;
    const uri = cy.png({ full: true, scale: 2, bg: "#ffffff" });
    const a = document.createElement("a");
    a.href = uri;
    a.download = "network-topology.png";
    a.click();
  }
  function exportCsv() {
    const lines = ["id,label,type,ip,model"];
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    for (const n of graph.nodes) {
      lines.push([n.id, n.label, n.type, n.ip ?? "", n.model ?? ""].map((x) => esc(String(x))).join(","));
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "network-topology.csv";
    a.click();
  }

  const hasStatus = Object.keys(status).length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={groupLeaves ? "default" : "outline"} onClick={() => setGroupLeaves((v) => !v)}>
          <Layers className="size-4" /> {groupLeaves ? "Grouped leaves" : "Group leaves"}
        </Button>
        <Button type="button" size="sm" variant={infraOnly ? "default" : "outline"} onClick={() => setInfraOnly((v) => !v)}>
          <Network className="size-4" /> Infrastructure only
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={fit}>
          <Maximize2 className="size-4" /> Fit
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={exportPng}>
          <Download className="size-4" /> PNG
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={exportCsv}>
          <Table2 className="size-4" /> CSV
        </Button>
        {canSave && (
          <>
            <Button type="button" size="sm" variant="outline" onClick={autoLayout} title="Re-run the automatic layout">
              <RotateCcw className="size-4" /> Auto-layout
            </Button>
            <Button
              type="button"
              size="sm"
              variant={dirty ? "default" : "outline"}
              disabled={!dirty || saving}
              onClick={saveLayout}
              title="Save the current node arrangement for this school"
            >
              <Save className="size-4" />
              {saving ? "Saving…" : saved ? "Saved" : dirty ? "Save layout" : "Layout saved"}
            </Button>
          </>
        )}
        {hasStatus && (
          <div className="ml-auto flex flex-wrap gap-2.5">
            {STATUS_LEGEND.map((s) => (
              <span key={s.key} className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="size-2.5 rounded-full" style={{ boxShadow: `0 0 0 2px ${s.color}` }} />
                {s.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Per-type visibility toggles — click a type to hide/show it on the map. */}
      {typeCounts.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Show:</span>
          {typeCounts.map(([t, count]) => {
            const off = hiddenTypes.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                title={off ? "Hidden — click to show" : "Click to hide this type"}
                className={cn(
                  "flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-xs hover:bg-accent",
                  off ? "text-muted-foreground/50 line-through" : "text-muted-foreground",
                )}
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: styleFor(t).color, opacity: off ? 0.3 : 1 }}
                />
                {typeLabel(t)} <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
          {hiddenTypes.size > 0 && (
            <button type="button" onClick={() => setHiddenTypes(new Set())} className="text-xs text-primary hover:underline">
              show all
            </button>
          )}
        </div>
      )}

      <div
        className="relative overflow-hidden rounded-xl border bg-[var(--muted)]/30"
        onContextMenu={(e) => e.preventDefault()}
      >
        {graph.nodes.length === 0 ? (
          <div className="flex h-[600px] items-center justify-center p-6 text-center text-sm text-muted-foreground">
            No physical topology captured yet. It builds from LLDP/CDP neighbors and the
            bridge forwarding table — it fills in as your switches answer SNMP.
          </div>
        ) : (
          <>
            <div ref={containerRef} className="h-[600px] w-full" />
            {hover && !menu && (
              <div
                className="pointer-events-none absolute z-10 w-60 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
                style={{ left: Math.min(hover.x + 14, Math.max(8, cw - 248)), top: hover.y + 14 }}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{typeLabel(hover.type)}</p>
                  {STATUS_BADGE[hover.status] && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="size-2 rounded-full" style={{ background: STATUS_BADGE[hover.status].color }} />
                      {STATUS_BADGE[hover.status].label}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-sm font-semibold">{hover.label}</p>
                <dl className="mt-1.5 space-y-0.5 text-xs">
                  {hover.ip && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">IP</dt>
                      <dd className="font-mono">{hover.ip}</dd>
                    </div>
                  )}
                  {hover.vendor && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Vendor</dt>
                      <dd className="truncate text-right">{hover.vendor}</dd>
                    </div>
                  )}
                  {/* Firmware is a first-class slot even when empty — it fills in as
                      we add SSH config digestion / richer SNMP. */}
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Firmware</dt>
                    <dd className="truncate text-right">{hover.firmware || "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Connected</dt>
                    <dd className="tabular-nums">{hover.connected}</dd>
                  </div>
                  {hover.port && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Port</dt>
                      <dd className="font-mono">{hover.port}</dd>
                    </div>
                  )}
                </dl>
                {hover.model && hover.model !== hover.firmware && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{hover.model}</p>
                )}
                <p className="mt-1.5 text-[11px] text-muted-foreground">Click to open · right-click for actions</p>
              </div>
            )}
            {menu && (
              <div
                className="absolute z-20 w-44 overflow-hidden rounded-lg border bg-popover py-1 text-popover-foreground shadow-md"
                style={{ left: Math.min(menu.x + 6, Math.max(8, cw - 188)), top: menu.y + 6 }}
              >
                <p className="truncate border-b px-3 py-1.5 text-xs font-medium">{menu.label}</p>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    router.push(`${basePath}/${menu.entityKind}/${menu.entityId}`);
                    setMenu(null);
                  }}
                >
                  <ExternalLink className="size-3.5" /> Open details
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => hideDevice(menu)}
                >
                  <EyeOff className="size-3.5" /> Hide from map
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {graph.nodes.length} nodes · {graph.edges.length} links · scroll to zoom, drag the canvas to pan,
        drag a device to reposition it, click to open it, right-click to hide it from the map.
        {canSave ? " Save layout to keep your arrangement." : ""} Leaf devices attach to their access switch
        port via the bridge table; toggle grouping to expand them.
      </p>
    </div>
  );
}
