"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Maximize2, Network, Table2 } from "lucide-react";

import type { MapGraph } from "@/db/queries";
import { Button } from "@/components/ui/button";

/** Per-type node appearance: shape + fill. Border encodes nothing yet (status
 *  lives in the Inventory tab); selection highlights in indigo. */
const TYPE_STYLE: Record<string, { color: string; shape: string }> = {
  internet: { color: "#0f172a", shape: "round-rectangle" },
  router: { color: "#f59e0b", shape: "diamond" },
  gateway: { color: "#f59e0b", shape: "diamond" },
  scanner: { color: "#3b82f6", shape: "round-rectangle" },
  switch: { color: "#8b5cf6", shape: "round-rectangle" },
  ap: { color: "#06b6d4", shape: "round-rectangle" },
  firewall: { color: "#ef4444", shape: "hexagon" },
  server: { color: "#6366f1", shape: "round-rectangle" },
  printer: { color: "#64748b", shape: "ellipse" },
  camera: { color: "#0ea5e9", shape: "ellipse" },
  computer: { color: "#94a3b8", shape: "ellipse" },
  phone: { color: "#10b981", shape: "ellipse" },
  mobile: { color: "#a855f7", shape: "ellipse" },
  storage: { color: "#0d9488", shape: "ellipse" },
  iot: { color: "#eab308", shape: "ellipse" },
  subnet: { color: "#14b8a6", shape: "round-rectangle" },
  host: { color: "#94a3b8", shape: "ellipse" },
  default: { color: "#94a3b8", shape: "ellipse" },
};
const styleFor = (t: string) => TYPE_STYLE[t] ?? TYPE_STYLE.default;
const INFRA = new Set(["internet", "router", "gateway", "scanner", "switch", "ap", "firewall"]);

function buildElements(graph: MapGraph, infraOnly: boolean) {
  const keep = (t: string) => (infraOnly ? INFRA.has(t) : true);
  const nodes = graph.nodes.filter((n) => keep(n.type));
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Synthesize an Internet root above the gateway/router for the Domotz look.
  const gw = nodes.find((n) => n.type === "gateway" || n.type === "router");
  const els: any[] = [];
  if (gw) {
    els.push({ data: { id: "__internet", label: "Internet", type: "internet", ...styleFor("internet") } });
  }
  for (const n of nodes) {
    const s = styleFor(n.type);
    els.push({
      data: {
        id: n.id,
        label: n.label?.length > 22 ? n.label.slice(0, 21) + "…" : n.label,
        full: n.label,
        type: n.type,
        ip: n.ip ?? "",
        model: n.model ?? "",
        entityId: n.entityId ?? null,
        entityKind: n.entityKind ?? null,
        color: s.color,
        shape: s.shape,
      },
    });
  }
  if (gw) els.push({ data: { id: `e_internet`, source: "__internet", target: gw.id, kind: "wan" } });
  for (const e of graph.edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
      els.push({ data: { id: `e_${e.source}_${e.target}_${e.kind ?? ""}`, source: e.source, target: e.target, kind: e.kind ?? "" } });
    }
  }
  return els;
}

const STYLESHEET: any[] = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      shape: "data(shape)",
      label: "data(label)",
      "font-size": 9,
      "text-valign": "bottom",
      "text-margin-y": 4,
      color: "#475569",
      width: 26,
      height: 26,
      "border-width": 2,
      "border-color": "#ffffff",
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.7,
      "text-background-padding": 1,
    },
  },
  { selector: 'node[type="switch"]', style: { width: 34, height: 26 } },
  { selector: 'node[type="internet"]', style: { width: 36, height: 28, color: "#0f172a" } },
  { selector: "edge", style: { width: 1.4, "line-color": "#cbd5e1", "curve-style": "bezier", "target-arrow-shape": "none" } },
  { selector: 'edge[kind="fdb"]', style: { "line-color": "#93c5fd", width: 1 } },
  { selector: 'edge[kind="wan"]', style: { "line-color": "#fbbf24", width: 2 } },
  { selector: "node:selected", style: { "border-color": "#6366f1", "border-width": 4 } },
  { selector: ".dim", style: { opacity: 0.25 } },
];

export function CytoscapePhysicalMap({ graph, basePath }: { graph: MapGraph; basePath: string }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  const [infraOnly, setInfraOnly] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; label: string; ip: string; type: string; model: string } | null>(null);

  const elements = useMemo(() => buildElements(graph, infraOnly), [graph, infraOnly]);

  useEffect(() => {
    let cy: any;
    let cancelled = false;
    (async () => {
      const cytoscape = (await import("cytoscape")).default;
      const dagre = (await import("cytoscape-dagre")).default;
      try {
        cytoscape.use(dagre);
      } catch {
        /* already registered */
      }
      if (cancelled || !containerRef.current) return;
      cy = cytoscape({
        container: containerRef.current,
        elements,
        style: STYLESHEET,
        layout: { name: "dagre", rankDir: "TB", nodeSep: 18, rankSep: 60, fit: true, padding: 28 } as any,
        wheelSensitivity: 0.2,
        minZoom: 0.15,
        maxZoom: 3,
      });
      cyRef.current = cy;

      cy.on("tap", "node", (e: any) => {
        const d = e.target.data();
        if (d.entityId && d.entityKind) router.push(`${basePath}/${d.entityKind}/${d.entityId}`);
      });
      cy.on("mouseover", "node", (e: any) => {
        const d = e.target.data();
        const rp = e.target.renderedPosition();
        setHover({ x: rp.x, y: rp.y, label: d.full || d.label, ip: d.ip, type: d.type, model: d.model });
        const hood = e.target.closedNeighborhood();
        cy.elements().not(hood).addClass("dim");
      });
      cy.on("mouseout", "node", () => {
        setHover(null);
        cy.elements().removeClass("dim");
      });
    })();
    return () => {
      cancelled = true;
      cy?.destroy();
    };
  }, [elements, basePath, router]);

  function fit() {
    cyRef.current?.fit(undefined, 28);
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
    for (const n of graph.nodes) {
      const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
      lines.push([n.id, n.label, n.type, n.ip ?? "", n.model ?? ""].map((x) => esc(String(x))).join(","));
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "network-topology.csv";
    a.click();
  }

  const types = [...new Set(graph.nodes.map((n) => n.type))];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={infraOnly ? "default" : "outline"} onClick={() => setInfraOnly((v) => !v)}>
          <Network className="size-4" /> {infraOnly ? "Showing infrastructure" : "Infrastructure only"}
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
        <div className="ml-auto flex flex-wrap gap-2">
          {types.map((t) => (
            <span key={t} className="flex items-center gap-1.5 text-xs capitalize text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ background: styleFor(t).color }} />
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border bg-[var(--muted)]/30">
        {graph.nodes.length === 0 ? (
          <div className="flex h-[600px] items-center justify-center p-6 text-center text-sm text-muted-foreground">
            No physical topology captured yet. It builds from LLDP/CDP neighbors and the
            bridge forwarding table — it fills in as your switches answer SNMP.
          </div>
        ) : (
          <>
            <div ref={containerRef} className="h-[600px] w-full" />
            {hover && (
              <div
                className="pointer-events-none absolute z-10 w-56 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
                style={{ left: Math.min(hover.x + 14, 600), top: hover.y + 14 }}
              >
                <p className="text-xs font-medium capitalize text-muted-foreground">{hover.type}</p>
                <p className="truncate text-sm font-semibold">{hover.label}</p>
                {hover.ip && <p className="font-mono text-xs text-muted-foreground">{hover.ip}</p>}
                {hover.model && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{hover.model}</p>}
              </div>
            )}
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {graph.nodes.length} nodes · {graph.edges.length} links · scroll to zoom, drag to pan,
        click a device to open its detail. Leaf devices attach to their access switch port via the bridge table.
      </p>
    </div>
  );
}
