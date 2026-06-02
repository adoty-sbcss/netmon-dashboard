"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Camera,
  Circle,
  Cpu,
  HardDrive,
  Minus,
  Monitor,
  Network,
  Phone,
  Plus,
  Printer,
  Radio,
  RotateCcw,
  Router,
  Save,
  Server,
  Shield,
  Smartphone,
  Wifi,
  type LucideIcon,
} from "lucide-react";

import type { MapGraph, MapNode } from "@/db/queries";
import { saveMapPositions } from "@/lib/admin/map-actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type View = "physical" | "logical";
interface XY {
  x: number;
  y: number;
}

const META: Record<string, { color: string; icon: LucideIcon; label: string; r: number }> = {
  scanner: { color: "#3b82f6", icon: Radio, label: "Sensor", r: 18 },
  router: { color: "#f59e0b", icon: Router, label: "Router", r: 18 },
  gateway: { color: "#f59e0b", icon: Router, label: "Gateway", r: 18 },
  switch: { color: "#8b5cf6", icon: Network, label: "Switch", r: 16 },
  ap: { color: "#06b6d4", icon: Wifi, label: "Access point", r: 15 },
  firewall: { color: "#ef4444", icon: Shield, label: "Firewall", r: 16 },
  subnet: { color: "#14b8a6", icon: Boxes, label: "Subnet", r: 16 },
  phone: { color: "#10b981", icon: Phone, label: "Phone", r: 11 },
  printer: { color: "#64748b", icon: Printer, label: "Printer", r: 11 },
  camera: { color: "#0ea5e9", icon: Camera, label: "Camera", r: 11 },
  server: { color: "#6366f1", icon: Server, label: "Server", r: 13 },
  computer: { color: "#94a3b8", icon: Monitor, label: "Computer", r: 10 },
  storage: { color: "#0d9488", icon: HardDrive, label: "Storage", r: 12 },
  mobile: { color: "#a855f7", icon: Smartphone, label: "Mobile", r: 10 },
  iot: { color: "#eab308", icon: Cpu, label: "IoT", r: 10 },
  host: { color: "#94a3b8", icon: Monitor, label: "Host", r: 10 },
  default: { color: "#94a3b8", icon: Circle, label: "Node", r: 11 },
};
const metaFor = (t: string) => META[t] ?? META.default;

const W = 1000;
const H = 700;

/** Top-down layered (BFS) layout — core at top, leaves toward the bottom. */
function computeLayout(graph: MapGraph): Map<string, XY> {
  const pos = new Map<string, XY>();
  if (graph.nodes.length === 0) return pos;

  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }
  }
  const byType = (t: string) => graph.nodes.find((n) => n.type === t)?.id;
  const root =
    byType("scanner") ??
    byType("router") ??
    byType("gateway") ??
    [...adj.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ??
    graph.nodes[0].id;

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
  let maxLevel = Math.max(0, ...[...level.values()]);
  for (const n of graph.nodes)
    if (!level.has(n.id)) level.set(n.id, maxLevel + 1);
  maxLevel = Math.max(0, ...[...level.values()]);

  const byLevel = new Map<number, string[]>();
  for (const [id, l] of level) {
    const arr = byLevel.get(l) ?? [];
    arr.push(id);
    byLevel.set(l, arr);
  }
  const top = 70;
  const gap = maxLevel > 0 ? (H - 140) / maxLevel : 0;
  for (const [l, ids] of byLevel) {
    const y = top + l * gap;
    ids.forEach((id, i) => pos.set(id, { x: ((i + 1) / (ids.length + 1)) * W, y }));
  }
  return pos;
}

export function NetworkMap({
  physical,
  logical,
  basePath,
  schoolId,
  canSave,
}: {
  physical: MapGraph;
  logical: MapGraph;
  basePath: string;
  schoolId: number;
  canSave: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>(
    physical.nodes.length >= logical.nodes.length ? "physical" : "logical",
  );
  const graph = view === "physical" ? physical : logical;

  const layout = useMemo(() => computeLayout(graph), [graph]);
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const [drag, setDrag] = useState<Record<string, XY>>({});
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, startSave] = useTransition();

  const posOf = (id: string): XY =>
    drag[id] ?? graph.positions[id] ?? layout.get(id) ?? { x: W / 2, y: H / 2 };

  const [vb, setVb] = useState({ x: 0, y: 0, w: W, h: H });
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; sx: number; sy: number } | null>(null);
  // Cursor state instead of reading the pan ref during render.
  const [panning, setPanning] = useState(false);
  // Measured render width of the SVG, kept in state so the hover-tooltip clamp
  // never reads a ref during render. The callback ref (re)attaches the observer
  // whenever the SVG mounts/unmounts (e.g. toggling to an empty view).
  const [svgWidth, setSvgWidth] = useState(800);
  const svgRef = useRef<SVGSVGElement>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const setSvgEl = useCallback((el: SVGSVGElement | null) => {
    svgRef.current = el;
    roRef.current?.disconnect();
    if (!el) return;
    const ro = new ResizeObserver(() => setSvgWidth(el.clientWidth));
    ro.observe(el);
    roRef.current = ro;
  }, []);
  const pan = useRef<{ x: number; y: number } | null>(null);
  const node = useRef<{ id: string; off: XY; moved: boolean } | null>(null);

  function reset() {
    setVb({ x: 0, y: 0, w: W, h: H });
    setSelected(null);
  }
  function zoom(factor: number) {
    setVb((v) => {
      const nw = Math.min(W * 2.5, Math.max(W * 0.2, v.w * factor));
      const nh = (nw / W) * H;
      return { x: v.x + (v.w - nw) / 2, y: v.y + (v.h - nh) / 2, w: nw, h: nh };
    });
  }
  function toSvg(clientX: number, clientY: number): XY {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: vb.x + ((clientX - rect.left) / rect.width) * vb.w,
      y: vb.y + ((clientY - rect.top) / rect.height) * vb.h,
    };
  }

  // ---- background pan / zoom ----
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    zoom(e.deltaY > 0 ? 1.1 : 0.9);
  }
  function onBgDown(e: React.PointerEvent) {
    pan.current = { x: e.clientX, y: e.clientY };
    setPanning(true);
  }
  function onMove(e: React.PointerEvent) {
    if (node.current) {
      const p = toSvg(e.clientX, e.clientY);
      const np = { x: p.x - node.current.off.x, y: p.y - node.current.off.y };
      node.current.moved = true;
      setDrag((d) => ({ ...d, [node.current!.id]: np }));
      setDirty(true);
      return;
    }
    if (pan.current) {
      const dx = ((e.clientX - pan.current.x) / (svgRef.current?.clientWidth || 800)) * vb.w;
      const dy = ((e.clientY - pan.current.y) / (svgRef.current?.clientHeight || 560)) * vb.h;
      pan.current = { x: e.clientX, y: e.clientY };
      setVb((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
    }
  }
  function onUp() {
    pan.current = null;
    node.current = null;
    setPanning(false);
  }

  // ---- node interactions ----
  function onNodeDown(e: React.PointerEvent, n: MapNode) {
    e.stopPropagation();
    const p = toSvg(e.clientX, e.clientY);
    const cur = posOf(n.id);
    node.current = { id: n.id, off: { x: p.x - cur.x, y: p.y - cur.y }, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onNodeUp(e: React.PointerEvent, n: MapNode) {
    e.stopPropagation();
    const wasDrag = node.current?.moved;
    node.current = null;
    if (wasDrag) return; // a move, not a click
    if (n.entityId && n.entityKind) {
      router.push(`${basePath}/${n.entityKind}/${n.entityId}`);
    } else {
      setSelected((cur) => (cur === n.id ? null : n.id));
    }
  }

  function save() {
    const positions = graph.nodes.map((n) => ({ nodeId: n.id, ...posOf(n.id) }));
    startSave(async () => {
      const res = await saveMapPositions(schoolId, view, basePath, positions);
      if (res.ok) {
        setDirty(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    });
  }

  const neighborIds = useMemo(() => {
    const focus = hover?.id ?? selected;
    if (!focus) return null;
    const s = new Set<string>([focus]);
    for (const e of graph.edges) {
      if (e.source === focus) s.add(e.target);
      if (e.target === focus) s.add(e.source);
    }
    return s;
  }, [hover, selected, graph]);

  const hoverNode = hover ? nodeById.get(hover.id) : null;
  const types = [...new Set(graph.nodes.map((n) => n.type))];

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border">
          {(["physical", "logical"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                if (v !== view) {
                  setView(v);
                  setDrag({});
                  setDirty(false);
                }
                reset();
              }}
              className={cn(
                "px-3 py-1.5 text-sm capitalize",
                view === v ? "bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {v}
            </button>
          ))}
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
        {canSave && (
          <Button
            type="button"
            size="sm"
            variant={dirty ? "default" : "outline"}
            disabled={!dirty || pending}
            onClick={save}
          >
            <Save className="size-4" />
            {pending ? "Saving…" : saved ? "Saved" : dirty ? "Save layout" : "Layout saved"}
          </Button>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {types.map((t) => (
            <span key={t} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ background: metaFor(t).color }} />
              {metaFor(t).label}
            </span>
          ))}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-xl border bg-[var(--muted)]/30">
        {graph.nodes.length === 0 ? (
          <div className="flex h-[560px] items-center justify-center p-6 text-center text-sm text-muted-foreground">
            No {view} topology captured for this school yet. The physical map builds
            from LLDP/CDP neighbors; the logical map from subnet/gateway grouping.
          </div>
        ) : (
          <>
            <svg
              ref={setSvgEl}
              viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
              className="h-[560px] w-full touch-none select-none"
              style={{ cursor: panning ? "grabbing" : "grab" }}
              onWheel={onWheel}
              onPointerDown={onBgDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={onUp}
            >
              {/* edges */}
              {graph.edges.map((e, i) => {
                const a = posOf(e.source);
                const b = posOf(e.target);
                if (!nodeById.has(e.source) || !nodeById.has(e.target)) return null;
                const active = neighborIds && (neighborIds.has(e.source) && neighborIds.has(e.target));
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={active ? "var(--primary)" : "currentColor"}
                    strokeOpacity={neighborIds ? (active ? 0.9 : 0.1) : 0.3}
                    strokeWidth={active ? 2 : 1.2}
                    className="text-muted-foreground"
                  />
                );
              })}
              {/* nodes */}
              {graph.nodes.map((n) => {
                const p = posOf(n.id);
                const m = metaFor(n.type);
                const Icon = m.icon;
                const dim = neighborIds && !neighborIds.has(n.id);
                const label = n.label;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x} ${p.y})`}
                    opacity={dim ? 0.3 : 1}
                    style={{ cursor: n.entityId ? "pointer" : "grab" }}
                    onPointerDown={(ev) => onNodeDown(ev, n)}
                    onPointerUp={(ev) => onNodeUp(ev, n)}
                    onPointerEnter={() =>
                      setHover({ id: n.id, sx: 0, sy: 0 })
                    }
                    onPointerMove={(ev) => {
                      const rect = svgRef.current!.getBoundingClientRect();
                      setHover({ id: n.id, sx: ev.clientX - rect.left, sy: ev.clientY - rect.top });
                    }}
                    onPointerLeave={() => setHover((h) => (h?.id === n.id ? null : h))}
                  >
                    <circle
                      r={m.r}
                      fill={m.color}
                      stroke={selected === n.id ? "var(--primary)" : "white"}
                      strokeWidth={selected === n.id ? 3 : 1.5}
                    />
                    {n.type === "subnet" && n.hostCount != null ? (
                      <text textAnchor="middle" dy="4" className="fill-white text-[10px] font-semibold">
                        {n.hostCount}
                      </text>
                    ) : (
                      <Icon
                        x={-m.r * 0.6}
                        y={-m.r * 0.6}
                        width={m.r * 1.2}
                        height={m.r * 1.2}
                        color="white"
                      />
                    )}
                    <text
                      textAnchor="middle"
                      y={m.r + 12}
                      className="fill-foreground text-[11px]"
                      style={{ paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 }}
                    >
                      {label.length > 24 ? label.slice(0, 23) + "…" : label}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Hover tooltip */}
            {hoverNode && hover && (
              <div
                className="pointer-events-none absolute z-10 w-56 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
                style={{
                  left: Math.min(hover.sx + 14, svgWidth - 230),
                  top: hover.sy + 14,
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: metaFor(hoverNode.type).color }} />
                  <span className="text-sm font-medium">{metaFor(hoverNode.type).label}</span>
                </div>
                <p className="mt-1 truncate text-sm font-semibold">{hoverNode.label}</p>
                {hoverNode.ip && <p className="font-mono text-xs text-muted-foreground">{hoverNode.ip}</p>}
                {hoverNode.model && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{hoverNode.model}</p>
                )}
                {hoverNode.hostCount != null && (
                  <p className="text-xs text-muted-foreground">{hoverNode.hostCount} hosts</p>
                )}
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {hoverNode.entityId ? "Click to open details" : "Click to focus · drag to move"}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {graph.nodes.length} nodes · {graph.edges.length} links
        {graph.generatedAt && ` · snapshot ${new Date(graph.generatedAt).toLocaleString()}`}
        {" · "}scroll to zoom, drag the canvas to pan, drag a node to reposition
        {canSave ? ", then Save layout." : "."}
      </p>
    </div>
  );
}
