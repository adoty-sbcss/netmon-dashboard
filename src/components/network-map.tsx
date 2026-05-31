"use client";

import { useMemo, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";

import type { TopoEdge, TopoGraph, TopoNode } from "@/db/queries";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type View = "physical" | "logical";

const NODE_STYLE: Record<string, { fill: string; r: number; label: string }> = {
  scanner: { fill: "var(--info, #3b82f6)", r: 16, label: "Sensor" },
  gateway: { fill: "#f59e0b", r: 18, label: "Gateway" },
  switch: { fill: "#8b5cf6", r: 14, label: "Switch" },
  subnet: { fill: "#14b8a6", r: 16, label: "Subnet" },
  host: { fill: "#94a3b8", r: 8, label: "Host" },
  default: { fill: "#94a3b8", r: 10, label: "Node" },
};

function styleFor(type: string) {
  return NODE_STYLE[type] ?? NODE_STYLE.default;
}

interface Pos {
  x: number;
  y: number;
}
const W = 1000;
const H = 700;

/** Deterministic radial BFS layout: root at center, levels in concentric rings. */
function layout(graph: TopoGraph): Map<string, Pos> {
  const pos = new Map<string, Pos>();
  if (graph.nodes.length === 0) return pos;

  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }
  }

  // Root preference: gateway > scanner > highest-degree node.
  const byType = (t: string) => graph.nodes.find((n) => n.type === t)?.id;
  let root =
    byType("gateway") ??
    byType("scanner") ??
    [...adj.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ??
    graph.nodes[0].id;

  // BFS levels.
  const level = new Map<string, number>([[root, 0]]);
  const queue = [root];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (!level.has(nb)) {
        level.set(nb, (level.get(cur) ?? 0) + 1);
        queue.push(nb);
      }
    }
  }
  // Disconnected nodes → outer ring.
  const maxLevel = Math.max(0, ...[...level.values()]);
  for (const n of graph.nodes) if (!level.has(n.id)) level.set(n.id, maxLevel + 1);

  const byLevel = new Map<number, string[]>();
  for (const [id, l] of level) {
    const arr = byLevel.get(l) ?? [];
    arr.push(id);
    byLevel.set(l, arr);
  }

  const cx = W / 2;
  const cy = H / 2;
  const ring = 110;
  for (const [l, ids] of byLevel) {
    if (l === 0) {
      pos.set(ids[0], { x: cx, y: cy });
      // any extra level-0 (shouldn't happen) fan out slightly
      ids.slice(1).forEach((id, i) => pos.set(id, { x: cx + 30 * (i + 1), y: cy }));
      continue;
    }
    const radius = l * ring;
    const n = ids.length;
    ids.forEach((id, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      pos.set(id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    });
  }
  return pos;
}

export function NetworkMap({
  physical,
  logical,
}: {
  physical: TopoGraph;
  logical: TopoGraph;
}) {
  const [view, setView] = useState<View>(
    physical.nodes.length >= logical.nodes.length ? "physical" : "logical",
  );
  const graph = view === "physical" ? physical : logical;

  const pos = useMemo(() => layout(graph), [graph]);
  const nodeById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph],
  );

  const [vb, setVb] = useState({ x: 0, y: 0, w: W, h: H });
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  function reset() {
    setVb({ x: 0, y: 0, w: W, h: H });
    setSelected(null);
  }
  function zoom(factor: number) {
    setVb((v) => {
      const nw = Math.min(W * 2.5, Math.max(W * 0.25, v.w * factor));
      const nh = (nw / W) * H;
      return { x: v.x + (v.w - nw) / 2, y: v.y + (v.h - nh) / 2, w: nw, h: nh };
    });
  }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    zoom(e.deltaY > 0 ? 1.1 : 0.9);
  }
  function onPointerDown(e: React.PointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = ((e.clientX - drag.current.x) / 800) * vb.w;
    const dy = ((e.clientY - drag.current.y) / 560) * vb.h;
    drag.current = { x: e.clientX, y: e.clientY };
    setVb((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
  }
  function onPointerUp() {
    drag.current = null;
  }

  const neighborIds = useMemo(() => {
    if (!selected) return new Set<string>();
    const s = new Set<string>();
    for (const e of graph.edges) {
      if (e.source === selected) s.add(e.target);
      if (e.target === selected) s.add(e.source);
    }
    return s;
  }, [selected, graph]);

  const selNode = selected ? nodeById.get(selected) : null;
  const selDegree = selected
    ? graph.edges.filter((e) => e.source === selected || e.target === selected).length
    : 0;

  const types = [...new Set(graph.nodes.map((n) => n.type))];

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border">
          <button
            type="button"
            onClick={() => {
              setView("physical");
              reset();
            }}
            className={cn(
              "px-3 py-1.5 text-sm",
              view === "physical" ? "bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            Physical
          </button>
          <button
            type="button"
            onClick={() => {
              setView("logical");
              reset();
            }}
            className={cn(
              "px-3 py-1.5 text-sm",
              view === "logical" ? "bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            Logical
          </button>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="outline" className="size-8" onClick={() => zoom(0.8)}>
            <Plus className="size-4" />
          </Button>
          <Button type="button" size="icon" variant="outline" className="size-8" onClick={() => zoom(1.25)}>
            <Minus className="size-4" />
          </Button>
          <Button type="button" size="icon" variant="outline" className="size-8" onClick={reset}>
            <RotateCcw className="size-4" />
          </Button>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {types.map((t) => (
            <span key={t} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ background: styleFor(t).fill }} />
              {styleFor(t).label}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_18rem]">
        {/* Canvas */}
        <div className="relative overflow-hidden rounded-xl border bg-[var(--muted)]/30">
          {graph.nodes.length === 0 ? (
            <div className="flex h-[520px] items-center justify-center p-6 text-center text-sm text-muted-foreground">
              No {view} topology captured for this school yet. The map builds from
              LLDP/CDP neighbors (physical) and subnet/gateway grouping (logical).
            </div>
          ) : (
            <svg
              viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
              className="h-[520px] w-full touch-none select-none"
              style={{ cursor: drag.current ? "grabbing" : "grab" }}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              {/* edges */}
              {graph.edges.map((e: TopoEdge, i) => {
                const a = pos.get(e.source);
                const b = pos.get(e.target);
                if (!a || !b) return null;
                const active =
                  selected && (e.source === selected || e.target === selected);
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={active ? "var(--primary)" : "currentColor"}
                    strokeOpacity={selected ? (active ? 0.9 : 0.12) : 0.3}
                    strokeWidth={active ? 2 : 1}
                    className="text-muted-foreground"
                  />
                );
              })}
              {/* nodes */}
              {graph.nodes.map((n: TopoNode) => {
                const p = pos.get(n.id);
                if (!p) return null;
                const st = styleFor(n.type);
                const dimmed = selected && selected !== n.id && !neighborIds.has(n.id);
                const label = n.label ?? n.ip ?? n.id;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x} ${p.y})`}
                    opacity={dimmed ? 0.35 : 1}
                    className="cursor-pointer"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelected((cur) => (cur === n.id ? null : n.id));
                    }}
                  >
                    <circle
                      r={st.r}
                      fill={st.fill}
                      stroke={selected === n.id ? "var(--primary)" : "white"}
                      strokeWidth={selected === n.id ? 3 : 1.5}
                    />
                    {n.type === "subnet" && n.hostCount != null && (
                      <text textAnchor="middle" dy="4" className="fill-white text-[10px] font-semibold">
                        {n.hostCount}
                      </text>
                    )}
                    <text
                      textAnchor="middle"
                      y={st.r + 12}
                      className="fill-foreground text-[11px]"
                      style={{ paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 }}
                    >
                      {label.length > 22 ? label.slice(0, 21) + "…" : label}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* Inspector */}
        <div className="rounded-xl border p-4">
          {selNode ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="size-3 rounded-full" style={{ background: styleFor(selNode.type).fill }} />
                <span className="font-medium">{styleFor(selNode.type).label}</span>
              </div>
              <dl className="flex flex-col gap-2 text-sm">
                <Row label="Label" value={selNode.label ?? "—"} />
                {selNode.ip && <Row label="IP" value={selNode.ip} mono />}
                {selNode.hostCount != null && <Row label="Hosts" value={String(selNode.hostCount)} />}
                <Row label="Connections" value={String(selDegree)} />
                <Row label="ID" value={selNode.id} mono />
              </dl>
              {neighborIds.size > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Neighbors</p>
                  <div className="flex flex-wrap gap-1">
                    {[...neighborIds].slice(0, 12).map((id) => {
                      const nb = nodeById.get(id);
                      return (
                        <Badge
                          key={id}
                          variant="outline"
                          className="cursor-pointer text-[10px]"
                          onClick={() => setSelected(id)}
                        >
                          {nb?.label ?? nb?.ip ?? id}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col justify-center gap-1 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{graph.nodes.length} nodes · {graph.edges.length} links</p>
              <p>Click a node to inspect it. Scroll to zoom, drag to pan.</p>
              {graph.generatedAt && (
                <p className="text-xs">Snapshot built {new Date(graph.generatedAt).toLocaleString()}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-right", mono && "font-mono text-xs")}>{value}</dd>
    </div>
  );
}
