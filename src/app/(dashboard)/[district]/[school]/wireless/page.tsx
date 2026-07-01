import { notFound } from "next/navigation";
import {
  Activity,
  Antenna,
  Gauge,
  Info,
  Lock,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Signal,
  Wifi,
  WifiOff,
} from "lucide-react";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  listWifiForSchool,
  listWifiExperienceForSchool,
  listWifiExperienceHistory,
  type WifiBssRow,
  type WifiExperienceRow,
  type WifiExperienceTrend,
} from "@/db/queries";
import { listSchoolWebperf, type WebperfResultRow } from "@/lib/webperf";
import { listSchoolWifiSpeedtests, type WifiSpeedtestRow } from "@/lib/iperf";
import { dateTime, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { SchoolTabs } from "@/components/school-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ---- small pure helpers ---------------------------------------------------

function countBy<T>(xs: T[], key: (x: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return m;
}

/** A signal value + unit -> a 0..100 strength for a bar, plus a label. */
function signalPct(signal: number | null, unit: string | null): number {
  if (signal == null) return 0;
  if (unit === "dbm") {
    // map -90 dBm (weak) .. -30 dBm (strong) onto 0..100
    return Math.max(0, Math.min(100, ((signal + 90) / 60) * 100));
  }
  return Math.max(0, Math.min(100, signal)); // nmcli quality 0..100
}
function signalLabel(signal: number | null, unit: string | null): string {
  if (signal == null) return "—";
  return unit === "dbm" ? `${signal} dBm` : `${signal}`;
}

const AUTH_LABEL: Record<string, string> = {
  "802.1x": "WPA2-Ent (802.1X)",
  peap: "WPA2-Ent (PEAP)",
  ttls: "WPA2-Ent (TTLS)",
  psk: "WPA2-PSK",
  sae: "WPA3-SAE",
  "psk+sae": "WPA2/3 (PSK+SAE)",
  open: "Open",
  wep: "WEP",
  unknown: "Unknown",
};
function authBadgeVariant(
  auth: string | null,
): "default" | "secondary" | "destructive" | "outline" {
  if (auth === "open" || auth === "wep") return "destructive";
  if (auth === "sae" || auth === "psk+sae") return "default";
  if (auth === "802.1x" || auth === "peap" || auth === "ttls") return "secondary";
  return "outline";
}

/** 2.4GHz clients are the "shoved onto the slow band" tell — flag it; 5/6GHz are healthy. */
function bandBadge(band: string): "default" | "secondary" | "destructive" | "outline" {
  if (band === "2.4GHz") return "secondary";
  if (band === "5GHz" || band === "6GHz") return "default";
  return "outline";
}

/** Shorten instructional-target hostnames for the compact latency column. */
function targetLabel(host: string): string {
  const h = host.replace(/^www\./, "");
  if (h.includes("google")) return "Google";
  if (h.includes("office") || h.includes("microsoft") || h.includes("office365")) return "M365";
  return h.length > 16 ? h.slice(0, 15) + "…" : h;
}

/** Build the WIFI-3 client-experience section (null if no battery results). */
function experienceSection(results: WifiExperienceRow[]) {
  if (results.length === 0) return null;
  const portalBadge = (
    s: string | null,
  ): "default" | "secondary" | "destructive" | "outline" =>
    s === "open" ? "default" : s === "portal" ? "secondary" : s === "blocked" ? "destructive" : "outline";
  return (
    <Card>
      <SectionHeader
        icon={Signal}
        title="Connection experience"
        meta={`${results.length} network${results.length === 1 ? "" : "s"} tested`}
      />
      <CardContent className="px-0 sm:px-6">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SSID</TableHead>
                <TableHead>Sensor</TableHead>
                <TableHead>Security</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Link</TableHead>
                <TableHead className="text-right">Assoc</TableHead>
                <TableHead className="text-right">DHCP</TableHead>
                <TableHead>Captive portal</TableHead>
                <TableHead>Internet</TableHead>
                <TableHead>DNS</TableHead>
                <TableHead>Guest isolation</TableHead>
                <TableHead className="text-right">Measured</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.ssid ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.sensorName}</TableCell>
                  <TableCell>
                    <Badge variant={authBadgeVariant(r.auth)} className="text-[10px]">
                      {AUTH_LABEL[r.auth ?? "unknown"] ?? r.auth}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {r.associated ? (
                      <Badge variant="default" className="text-[10px]">joined</Badge>
                    ) : (
                      <Badge variant="destructive" className="text-[10px]">failed</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs" title={r.bssid ? `BSSID ${r.bssid}` : undefined}>
                    {r.band || r.rxRateMbps != null ? (
                      <span className="flex items-center gap-1">
                        {r.band && (
                          <Badge variant={bandBadge(r.band)} className="text-[10px]">{r.band}</Badge>
                        )}
                        {r.rxRateMbps != null && (
                          <span className="tabular-nums text-muted-foreground">
                            {Math.round(r.rxRateMbps)} Mbps
                          </span>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.assocMs != null ? `${r.assocMs} ms` : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.dhcpMs == null ? "—" : r.dhcpMs < 0 ? "no lease" : `${r.dhcpMs} ms`}
                  </TableCell>
                  <TableCell title={r.captiveRedirect ?? undefined}>
                    {r.captiveState ? (
                      <span className="flex items-center gap-1">
                        <Badge variant={portalBadge(r.captiveState)} className="text-[10px]">
                          {r.captiveState}
                        </Badge>
                        {r.captiveAutoAccepted === true && (
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400" title="Auto-accept succeeded">✓ accepted</span>
                        )}
                        {r.captiveAutoAccepted === false && (
                          <span className="text-[10px] text-muted-foreground" title="Auto-accept attempted, portal still up">accept failed</span>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.pingOk
                      ? `${r.rttMs != null ? `${r.rttMs.toFixed(0)} ms` : "ok"}${r.lossPct ? ` · ${r.lossPct}% loss` : ""}`
                      : <span className="text-muted-foreground">unreachable</span>}
                  </TableCell>
                  <TableCell>
                    {r.dnsOk === true ? (
                      <Badge variant="default" className="text-[10px]">ok</Badge>
                    ) : r.dnsOk === false ? (
                      <Badge variant="destructive" className="text-[10px]">fail</Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {r.isolationReachable === true ? (
                      <Badge variant="destructive" className="text-[10px]" title={`reached ${r.isolationTarget ?? "internal"}`}>
                        not isolated
                      </Badge>
                    ) : r.isolationReachable === false ? (
                      <Badge variant="default" className="text-[10px]">isolated</Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {r.generatedAt ? relativeTime(r.generatedAt) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="px-4 pt-3 text-xs text-muted-foreground sm:px-0">
          The sensor joins each network on a spare radio (routes-off, so the uplink is
          never used) and measures the real client experience. &quot;Not isolated&quot;
          means a guest network could reach an internal host — worth investigating.
        </p>
      </CardContent>
    </Card>
  );
}

/** Tiny inline-SVG sparkline of a numeric series (nulls dropped). Server-rendered. */
function Sparkline({
  values,
  color = "text-sky-500",
  width = 140,
  height = 22,
}: {
  values: (number | null)[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length < 2) return <span className="text-xs text-muted-foreground">—</span>;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const pts = nums
    .map((v, i) => {
      const x = (i / (nums.length - 1)) * width;
      const y = height - 2 - ((v - min) / range) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} className={color} aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

/** Wi-Fi SPEED & app performance — the dedicated "how fast / how good" callout per
 *  joined network: source-bound download + instructional-target latency + the district
 *  URL waterfall measured over THIS Wi-Fi (the same probe the wired Speed & Bandwidth
 *  page runs, so the two are directly comparable). Null when nothing was measured. */
function wifiPerfSection(
  results: WifiExperienceRow[],
  wifiWeb: WebperfResultRow[],
  wifiSpeed: WifiSpeedtestRow[],
) {
  // Latest Wi-Fi webperf per (ssid, url); wifiWeb is newest-first.
  const webBySsid = new Map<string, Map<string, WebperfResultRow>>();
  for (const r of wifiWeb) {
    if (r.transport !== "wifi" || !r.ssid || !r.url) continue;
    const m = webBySsid.get(r.ssid) ?? new Map<string, WebperfResultRow>();
    if (!m.has(r.url)) m.set(r.url, r);
    webBySsid.set(r.ssid, m);
  }
  // Latest Wi-Fi internet speed test per (sensor, ssid).
  const speedByKey = new Map<string, WifiSpeedtestRow>();
  for (const s of wifiSpeed) speedByKey.set(`${s.sensorId}|${s.ssid ?? ""}`, s);
  const blocks = results.filter(
    (r) =>
      r.downloadMbps != null ||
      (r.targets && r.targets.length > 0) ||
      (r.ssid != null && webBySsid.has(r.ssid)) ||
      speedByKey.has(`${r.sensorId}|${r.ssid ?? ""}`),
  );
  if (blocks.length === 0) return null;
  const ms = (v: number | null) => (v == null ? "—" : `${Math.round(v)} ms`);
  return (
    <Card>
      <SectionHeader
        icon={Gauge}
        title="Wi-Fi speed & app performance"
        meta={`${blocks.length} network${blocks.length === 1 ? "" : "s"}`}
      />
      <CardContent className="flex flex-col gap-5">
        {blocks.map((r) => {
          const web = r.ssid
            ? [...(webBySsid.get(r.ssid)?.values() ?? [])].sort((a, b) =>
                (a.url ?? "").localeCompare(b.url ?? ""),
              )
            : [];
          const st = speedByKey.get(`${r.sensorId}|${r.ssid ?? ""}`);
          const spd = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)} Mbps`);
          return (
            <div
              key={`${r.sensorId}-${r.ssid}`}
              className="flex flex-col gap-2 border-b pb-4 last:border-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-medium">{r.ssid ?? "—"}</span>
                <span className="text-xs text-muted-foreground">{r.sensorName}</span>
                {st && (
                  <Badge variant="outline" className="text-[10px]" title="Runs the full internet speed test">
                    primary
                  </Badge>
                )}
                {!st && r.downloadMbps != null && (
                  <span className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">Download</span>
                    <span className="font-medium tabular-nums">{r.downloadMbps.toFixed(1)} Mbps</span>
                  </span>
                )}
                {r.targets?.map((t) => (
                  <span key={t.host} className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground">{targetLabel(t.host)}</span>
                    <span
                      className={`tabular-nums ${
                        t.rtt_ms == null
                          ? "text-destructive"
                          : t.rtt_ms > 100
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-foreground"
                      }`}
                    >
                      {t.rtt_ms == null ? "unreachable" : `${t.rtt_ms.toFixed(0)} ms`}
                    </span>
                  </span>
                ))}
              </div>
              {st && (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Internet speed</span>
                  <span className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">↓</span>
                    <span className="font-medium tabular-nums">{spd(st.downloadMbps)}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">↑</span>
                    <span className="font-medium tabular-nums">{spd(st.uploadMbps)}</span>
                  </span>
                  <span className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground">latency</span>
                    <span className="tabular-nums">{ms(st.latencyMs)}</span>
                  </span>
                  <span className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground">jitter</span>
                    <span className="tabular-nums">{ms(st.jitterMs)}</span>
                  </span>
                  {st.lossPct != null && st.lossPct > 0 && (
                    <span className="flex items-center gap-1 text-xs">
                      <span className="text-muted-foreground">loss</span>
                      <span className="tabular-nums text-amber-600 dark:text-amber-400">{st.lossPct}%</span>
                    </span>
                  )}
                </div>
              )}
              {web.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Site (over Wi-Fi)</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">DNS</TableHead>
                        <TableHead className="text-right">TTFB</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Speed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {web.map((w) => {
                        let host = w.url ?? "—";
                        try {
                          host = new URL(w.url ?? "").host;
                        } catch {
                          /* keep raw */
                        }
                        return (
                          <TableRow key={w.id}>
                            <TableCell className="font-medium" title={w.url ?? undefined}>
                              {host}
                            </TableCell>
                            <TableCell>
                              {w.ok ? (
                                <Badge variant="default" className="text-[10px]">
                                  {w.httpStatus ?? "ok"}
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="text-[10px]" title={w.error ?? undefined}>
                                  {w.httpStatus || "fail"}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{ms(w.dnsMs)}</TableCell>
                            <TableCell className="text-right tabular-nums">{ms(w.ttfbMs)}</TableCell>
                            <TableCell className="text-right font-medium tabular-nums">{ms(w.totalMs)}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {w.speedMbps == null ? "—" : `${w.speedMbps.toFixed(1)} Mbps`}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Measured on the sensor&apos;s analysis radio joined to each network — the same probes
          the wired Speed &amp; Bandwidth page runs, so compare them there side by side.
        </p>
      </CardContent>
    </Card>
  );
}

/** Per-network experience TREND over time — a status timeline + associate/RTT
 *  sparklines + a quick summary. Surfaces a slow-degrading network the latest-only
 *  table can't. */
function experienceTrendSection(trends: WifiExperienceTrend[]) {
  if (trends.length === 0) return null;
  return (
    <Card>
      <SectionHeader
        icon={Activity}
        title="Experience trend"
        meta={`${trends.length} network${trends.length === 1 ? "" : "s"}`}
      />
      <CardContent className="flex flex-col gap-5">
        {trends.map((t) => {
          const assoc = t.points.map((p) => p.assocMs).filter((v): v is number => v != null);
          const rtt = t.points
            .map((p) => p.rttMs)
            .filter((v): v is number => v != null && Number.isFinite(v));
          const joined = t.points.filter((p) => p.associated).length;
          const okRate = Math.round(
            (t.points.filter((p) => p.pingOk).length / t.points.length) * 100,
          );
          const lastAssoc = assoc.length ? assoc[assoc.length - 1] : null;
          const lastRtt = rtt.length ? rtt[rtt.length - 1] : null;
          const dl = t.points
            .map((p) => p.downloadMbps)
            .filter((v): v is number => v != null && Number.isFinite(v));
          const lastDl = dl.length ? dl[dl.length - 1] : null;
          return (
            <div
              key={`${t.sensorId}-${t.ssid}`}
              className="flex flex-col gap-2 border-b pb-4 last:border-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{t.ssid ?? "—"}</span>
                <span className="text-xs text-muted-foreground">{t.sensorName}</span>
                <span className="text-xs text-muted-foreground">· {t.points.length} runs</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {joined}/{t.points.length} joined · {okRate}% had internet
                </span>
              </div>
              <div
                className="flex flex-wrap items-center gap-0.5"
                title="Each run oldest→newest: green = internet, amber = joined but no internet, red = failed to join"
              >
                {t.points.map((p, i) => (
                  <span
                    key={i}
                    className={`inline-block size-2 rounded-[2px] ${
                      p.associated === false
                        ? "bg-destructive"
                        : p.pingOk
                          ? "bg-emerald-500"
                          : "bg-amber-500"
                    }`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                <span className="flex items-center gap-2">
                  <span className="w-20 text-muted-foreground">Time to join</span>
                  <Sparkline values={t.points.map((p) => p.assocMs)} color="text-sky-500" />
                  <span className="tabular-nums text-muted-foreground">
                    {lastAssoc != null ? `${lastAssoc} ms` : "—"}
                    {assoc.length ? ` · avg ${avg(assoc)}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="w-16 text-muted-foreground">Internet RTT</span>
                  <Sparkline values={t.points.map((p) => p.rttMs)} color="text-violet-500" />
                  <span className="tabular-nums text-muted-foreground">
                    {lastRtt != null ? `${lastRtt.toFixed(0)} ms` : "—"}
                    {rtt.length ? ` · avg ${avg(rtt)}` : ""}
                  </span>
                </span>
                {dl.length > 0 && (
                  <span className="flex items-center gap-2">
                    <span className="w-16 text-muted-foreground">Download</span>
                    <Sparkline values={t.points.map((p) => p.downloadMbps)} color="text-emerald-500" />
                    <span className="tabular-nums text-muted-foreground">
                      {lastDl != null ? `${lastDl.toFixed(1)} Mbps` : "—"}
                    </span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Newest run on the right. A rising &quot;time to join&quot; or a growing run of amber/red dots is an
          early sign of RADIUS / DHCP / RF trouble — before users flood the help desk.
        </p>
      </CardContent>
    </Card>
  );
}

function bandColor(band: string | null): string {
  if (band === "2.4GHz") return "bg-amber-500";
  if (band === "5GHz") return "bg-sky-500";
  if (band === "6GHz") return "bg-violet-500";
  return "bg-muted-foreground";
}

interface Finding {
  severity: "high" | "warn" | "info";
  title: string;
  detail: string;
}

/**
 * Turn client-experience results into actionable findings — the "Wi-Fi is broken in
 * Room X" alerts (join / DHCP / DNS / internet failures + a guest-isolation breach).
 * These are what a K-12 network admin actually chases; surfaced above the RF findings.
 */
function experienceFindings(results: WifiExperienceRow[]): Finding[] {
  const out: Finding[] = [];
  for (const r of results) {
    const where = `${r.ssid ?? "network"} · ${r.sensorName}`;
    if (r.associated === false) {
      out.push({
        severity: "high",
        title: `Can't join ${where}`,
        detail: "Failed to associate — check the key/RADIUS, the authorized MAC, or signal at this location.",
      });
      continue; // downstream checks are meaningless if it never joined
    }
    if (r.associated === true && r.dhcpMs != null && r.dhcpMs < 0)
      out.push({
        severity: "high",
        title: `No DHCP lease on ${where}`,
        detail: "Associated but never got an IP — DHCP scope exhausted, or the VLAN has no DHCP.",
      });
    if (r.isolationReachable === true)
      out.push({
        severity: "high",
        title: `Guest network NOT isolated on ${where}`,
        detail: `Reached an internal host (${r.isolationTarget ?? "gateway"}) from this network — review guest segmentation.`,
      });
    if (r.assocMs != null && r.assocMs > 10000)
      out.push({
        severity: "warn",
        title: `Slow to join ${where}`,
        detail: `Took ${(r.assocMs / 1000).toFixed(1)}s to associate — often a struggling RADIUS or weak signal.`,
      });
    if (r.captiveState === "blocked")
      out.push({
        severity: "warn",
        title: `Internet blocked on ${where}`,
        detail: "No internet and no captive portal detected — a walled-off or broken network.",
      });
    else if (r.pingOk === false && r.captiveState !== "portal")
      out.push({
        severity: "warn",
        title: `No internet on ${where}`,
        detail: "Associated + leased but can't reach the internet.",
      });
    if (r.dnsOk === false && r.captiveState !== "portal")
      out.push({
        severity: "warn",
        title: `DNS failing on ${where}`,
        detail: "Can't resolve names — DNS server or content-filter issue.",
      });
    if (typeof r.lossPct === "number" && r.lossPct >= 20)
      out.push({
        severity: "warn",
        title: `High packet loss on ${where}`,
        detail: `${r.lossPct}% loss to the internet — RF or upstream congestion.`,
      });
  }
  return out;
}

// ---- page -----------------------------------------------------------------

export default async function WirelessPage({
  params,
}: {
  params: Promise<{ district: string; school: string }>;
}) {
  const { district: districtSlug, school: schoolSlug } = await params;
  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const [wifi, exp, trends, webperf, wifiSpeed] = await Promise.all([
    listWifiForSchool(school.id),
    listWifiExperienceForSchool(school.id),
    listWifiExperienceHistory(school.id),
    listSchoolWebperf(school.id),
    listSchoolWifiSpeedtests(school.id),
  ]);
  const bss = wifi.bss;
  const expSection = experienceSection(exp.results);
  const perfSection = wifiPerfSection(exp.results, webperf, wifiSpeed);
  const trendSection = experienceTrendSection(trends);
  const schoolName = school.name || titleizeSlug(school.slug);

  // ---- empty state: no survey. If there's a join-experience battery, show that;
  // otherwise the "enable the survey" prompt. (Wi-Fi JOIN config lives in
  // Settings → School & district settings now — this tab is monitoring-only.) ----
  if (bss.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />
        <PageHeader title="Wireless" description={`${schoolName} · Wi-Fi RF / AP survey`} />
        {expSection}
        {perfSection}
        {trendSection}
        {!expSection && !perfSection && !trendSection && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <WifiOff className="size-10 text-muted-foreground" />
              <p className="text-lg font-medium">No Wi-Fi survey data yet</p>
              <p className="max-w-md text-sm text-muted-foreground">
                The managed-mode Wi-Fi survey is off for this site, or no sensor here
                has a Wi-Fi adapter. Enable it on a sensor (Sensors tab → Enable Wi-Fi
                survey, or set <code className="font-mono">NETMON_WIFI_SURVEY_ENABLED</code>)
                and data will appear after the next hourly bundle.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ---- aggregations ----
  const ssids = bss.map((b) => b.ssid).filter((s): s is string => !!s);
  const distinctSsids = Array.from(new Set(ssids));
  const districtBss = bss.filter((b) => b.isDistrictSsid === true);
  const neighborBss = bss.filter((b) => b.isDistrictSsid === false);
  const openBss = bss.filter((b) => b.auth === "open");
  const wepBss = bss.filter((b) => b.auth === "wep");
  const tkipBss = bss.filter((b) => (b.cipher ?? "").includes("tkip"));
  const wpa3Bss = bss.filter((b) => b.auth === "sae" || b.auth === "psk+sae");
  const hiddenBss = bss.filter((b) => !b.ssid);
  const distinctChannels = Array.from(
    new Set(bss.map((b) => b.channel).filter((c): c is number => c != null)),
  );

  const authCounts = countBy(bss, (b) => b.auth ?? "unknown");
  const bandCounts = countBy(bss, (b) => b.band ?? "—");
  const cipherCounts = countBy(bss, (b) => b.cipher ?? "—");
  const maxAuth = Math.max(1, ...authCounts.values());
  const maxBand = Math.max(1, ...bandCounts.values());

  // channel occupancy (band:channel -> count), sorted band then channel
  const chanMap = new Map<string, { band: string; channel: number; count: number }>();
  for (const b of bss) {
    if (b.channel == null) continue;
    const band = b.band ?? "—";
    const k = `${band}:${b.channel}`;
    const cur = chanMap.get(k) ?? { band, channel: b.channel, count: 0 };
    cur.count += 1;
    chanMap.set(k, cur);
  }
  const channels = Array.from(chanMap.values()).sort(
    (a, b) => a.band.localeCompare(b.band) || a.channel - b.channel,
  );
  const maxChan = Math.max(1, ...channels.map((c) => c.count));

  // SSID rollup
  interface SsidAgg {
    ssid: string | null;
    auths: Set<string>;
    bands: Set<string>;
    channels: Set<number>;
    count: number;
    maxSignal: number | null;
    signalUnit: string | null;
    district: boolean | null;
  }
  const ssidMap = new Map<string, SsidAgg>();
  for (const b of bss) {
    const key = b.ssid ?? "\u0000hidden";
    const cur =
      ssidMap.get(key) ??
      ({
        ssid: b.ssid,
        auths: new Set<string>(),
        bands: new Set<string>(),
        channels: new Set<number>(),
        count: 0,
        maxSignal: null,
        signalUnit: b.signalUnit,
        district: b.isDistrictSsid,
      } satisfies SsidAgg);
    if (b.auth) cur.auths.add(b.auth);
    if (b.band) cur.bands.add(b.band);
    if (b.channel != null) cur.channels.add(b.channel);
    cur.count += 1;
    if (b.signal != null && (cur.maxSignal == null || b.signal > cur.maxSignal))
      cur.maxSignal = b.signal;
    if (b.isDistrictSsid === true) cur.district = true;
    ssidMap.set(key, cur);
  }
  const ssidRollup = Array.from(ssidMap.values()).sort(
    (a, b) => (b.maxSignal ?? -999) - (a.maxSignal ?? -999),
  );

  // findings — client-experience alerts first (what an admin chases), then RF posture
  const findings: Finding[] = [...experienceFindings(exp.results)];
  if (openBss.length)
    findings.push({
      severity: "warn",
      title: `${openBss.length} open (unencrypted) AP${openBss.length === 1 ? "" : "s"}`,
      detail: `SSIDs: ${Array.from(new Set(openBss.map((b) => b.ssid ?? "<hidden>"))).join(", ")}. Open networks are expected for captive-portal guest, but confirm guest is isolated from internal subnets.`,
    });
  if (wepBss.length)
    findings.push({
      severity: "high",
      title: `${wepBss.length} AP${wepBss.length === 1 ? "" : "s"} using WEP`,
      detail: `WEP is broken and trivially crackable. SSIDs: ${Array.from(new Set(wepBss.map((b) => b.ssid ?? "<hidden>"))).join(", ")}.`,
    });
  if (tkipBss.length)
    findings.push({
      severity: "warn",
      title: `${tkipBss.length} AP${tkipBss.length === 1 ? "" : "s"} allow TKIP`,
      detail: "TKIP is deprecated and caps rates. Move to CCMP/AES-only.",
    });
  if (districtBss.length > 0 && wpa3Bss.length === 0)
    findings.push({
      severity: "info",
      title: "District APs are WPA2-only (no WPA3/SAE)",
      detail: "None of the district SSIDs advertise WPA3-SAE. Consider enabling WPA3 (transition mode) where AP firmware supports it.",
    });
  if (wifi.regdom === "00")
    findings.push({
      severity: "info",
      title: "Regulatory domain is unset (00 / world)",
      detail: "The survey radio's regdomain is the restrictive world default. Set it to US so all channels (incl. DFS) are visible and TX power is correct.",
    });
  if (hiddenBss.length)
    findings.push({
      severity: "info",
      title: `${hiddenBss.length} hidden SSID${hiddenBss.length === 1 ? "" : "s"}`,
      detail: "APs broadcasting no SSID (cloaked). Not a security control, but noted.",
    });

  const stats = [
    { label: "APs (BSSIDs)", value: bss.length, icon: Antenna },
    { label: "Distinct SSIDs", value: distinctSsids.length, icon: Wifi },
    { label: "District / Neighbor", value: `${districtBss.length} / ${neighborBss.length}`, icon: ShieldCheck },
    { label: "Channels in use", value: distinctChannels.length, icon: Radio },
    { label: "Open networks", value: openBss.length, icon: openBss.length ? ShieldAlert : Lock },
    { label: "WPA3 APs", value: wpa3Bss.length, icon: ShieldCheck },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />
      <PageHeader
        title="Wireless"
        description={
          wifi.generatedAt
            ? `${schoolName} · survey ${relativeTime(wifi.generatedAt)}${wifi.host ? ` · ${wifi.host}` : ""}`
            : `${schoolName} · Wi-Fi RF / AP survey`
        }
        actions={
          <div className="flex items-center gap-2">
            {wifi.backend && (
              <Badge variant="outline" className="text-[10px] uppercase">
                {wifi.backend}
              </Badge>
            )}
            {wifi.regdom && (
              <Badge
                variant={wifi.regdom === "00" ? "destructive" : "outline"}
                className="text-[10px] uppercase"
                title="Regulatory domain"
              >
                reg {wifi.regdom}
              </Badge>
            )}
            {wifi.stale && (
              <Badge variant="destructive" className="text-[10px] uppercase">
                stale
              </Badge>
            )}
          </div>
        }
      />

      {/* WIFI-3 client-experience battery (join -> measure -> leave), if any */}
      {expSection}

      {/* WIFI-6 Wi-Fi speed & app performance (throughput + app latency + URL waterfall) */}
      {perfSection}

      {/* WIFI-6 experience trend over time */}
      {trendSection}

      {/* stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label}>
              <CardContent className="flex flex-col gap-1 py-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon className="size-3.5" />
                  {s.label}
                </div>
                <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* findings */}
      {findings.length > 0 && (
        <Card>
          <SectionHeader icon={ShieldAlert} title="Wireless findings" meta={`${findings.length}`} />
          <CardContent className="flex flex-col gap-2">
            {findings.map((f) => (
              <div
                key={f.title}
                className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                  f.severity === "high"
                    ? "border-destructive/40 bg-destructive/10"
                    : f.severity === "warn"
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-border bg-muted/30"
                }`}
              >
                {f.severity === "info" ? (
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ShieldAlert
                    className={`mt-0.5 size-4 shrink-0 ${f.severity === "high" ? "text-destructive" : "text-amber-600"}`}
                  />
                )}
                <div>
                  <div className="font-medium">{f.title}</div>
                  <div className="text-muted-foreground">{f.detail}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* encryption posture + bands */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader icon={Lock} title="Encryption posture" meta={`${bss.length} APs`} />
          <CardContent className="flex flex-col gap-2 pt-2">
            {Array.from(authCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([auth, n]) => (
                <div key={auth} className="flex items-center gap-2">
                  <div className="w-36 shrink-0 text-sm">
                    {AUTH_LABEL[auth] ?? auth}
                  </div>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className={`h-full ${auth === "open" || auth === "wep" ? "bg-destructive" : auth === "sae" || auth === "psk+sae" ? "bg-emerald-500" : "bg-primary"}`}
                      style={{ width: `${(n / maxAuth) * 100}%` }}
                    />
                  </div>
                  <div className="w-8 shrink-0 text-right text-sm tabular-nums">{n}</div>
                </div>
              ))}
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Ciphers:</span>
              {Array.from(cipherCounts.entries()).map(([c, n]) => (
                <Badge key={c} variant="outline" className="text-[10px]">
                  {c} · {n}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <SectionHeader icon={Signal} title="Bands" meta={`${distinctChannels.length} channels`} />
          <CardContent className="flex flex-col gap-2 pt-2">
            {Array.from(bandCounts.entries())
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([band, n]) => (
                <div key={band} className="flex items-center gap-2">
                  <div className="w-16 shrink-0 text-sm">{band}</div>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className={`h-full ${bandColor(band)}`}
                      style={{ width: `${(n / maxBand) * 100}%` }}
                    />
                  </div>
                  <div className="w-8 shrink-0 text-right text-sm tabular-nums">{n}</div>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>

      {/* channel occupancy */}
      <Card>
        <SectionHeader icon={Radio} title="Channel occupancy" meta={`${channels.length} channels`} />
        <CardContent className="pt-2">
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {channels.map((c) => (
              <div key={`${c.band}:${c.channel}`} className="flex items-center gap-2">
                <div className="flex w-20 shrink-0 items-center gap-1 text-xs">
                  <span className={`inline-block size-2 rounded-full ${bandColor(c.band)}`} />
                  ch {c.channel}
                </div>
                <div className="h-3 flex-1 overflow-hidden rounded bg-muted">
                  <div
                    className={`h-full ${bandColor(c.band)}`}
                    style={{ width: `${(c.count / maxChan) * 100}%` }}
                  />
                </div>
                <div className="w-6 shrink-0 text-right text-xs tabular-nums">{c.count}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Counts are APs heard per channel. Many APs on one 2.4 GHz channel (1/6/11)
            indicates co-channel contention.
          </p>
        </CardContent>
      </Card>

      {/* SSID rollup */}
      <Card>
        <SectionHeader icon={Wifi} title="Networks (SSIDs)" meta={`${ssidRollup.length}`} />
        <CardContent className="px-0 sm:px-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SSID</TableHead>
                  <TableHead>Security</TableHead>
                  <TableHead>Bands</TableHead>
                  <TableHead className="text-right">APs</TableHead>
                  <TableHead className="text-right">Channels</TableHead>
                  <TableHead className="text-right">Best signal</TableHead>
                  <TableHead>Scope</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ssidRollup.map((s) => (
                  <TableRow key={s.ssid ?? "\u0000hidden"}>
                    <TableCell className="font-medium">
                      {s.ssid ?? <span className="italic text-muted-foreground">&lt;hidden&gt;</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {Array.from(s.auths).map((a) => (
                          <Badge key={a} variant={authBadgeVariant(a)} className="text-[10px]">
                            {AUTH_LABEL[a] ?? a}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {Array.from(s.bands).sort().join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.count}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Array.from(s.channels).sort((a, b) => a - b).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {signalLabel(s.maxSignal, s.signalUnit)}
                    </TableCell>
                    <TableCell>
                      {s.district === true ? (
                        <Badge variant="default" className="text-[10px]">district</Badge>
                      ) : s.district === false ? (
                        <Badge variant="outline" className="text-[10px]">neighbor</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* per-BSSID detail */}
      <Card>
        <SectionHeader icon={Antenna} title="All access points (BSSIDs)" meta={`${bss.length}`} />
        <CardContent className="px-0 sm:px-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SSID</TableHead>
                  <TableHead>BSSID</TableHead>
                  <TableHead>Band</TableHead>
                  <TableHead className="text-right">Ch</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead>Security</TableHead>
                  <TableHead className="hidden md:table-cell">Cipher</TableHead>
                  <TableHead className="hidden lg:table-cell">PMF</TableHead>
                  <TableHead>Scope</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bss.map((b: WifiBssRow) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">
                      {b.ssid ?? <span className="italic text-muted-foreground">&lt;hidden&gt;</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{b.bssid ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      <span className={`mr-1 inline-block size-2 rounded-full ${bandColor(b.band)}`} />
                      {b.band ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.channel ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-14 overflow-hidden rounded bg-muted">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${signalPct(b.signal, b.signalUnit)}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {signalLabel(b.signal, b.signalUnit)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={authBadgeVariant(b.auth)} className="text-[10px]">
                        {AUTH_LABEL[b.auth ?? "unknown"] ?? b.auth}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-xs md:table-cell">{b.cipher ?? "—"}</TableCell>
                    <TableCell className="hidden text-xs lg:table-cell">
                      {b.pmf === true ? "yes" : b.pmf === false ? "no" : "—"}
                    </TableCell>
                    <TableCell>
                      {b.isDistrictSsid === true ? (
                        <Badge variant="default" className="text-[10px]">district</Badge>
                      ) : b.isDistrictSsid === false ? (
                        <Badge variant="outline" className="text-[10px]">neighbor</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="size-3.5" />
        Passive managed-mode survey (no association). Backend{" "}
        <span className="font-mono">{wifi.backend ?? "?"}</span>, regdomain{" "}
        <span className="font-mono">{wifi.regdom ?? "?"}</span>
        {wifi.generatedAt ? ` · generated ${dateTime(wifi.generatedAt)}` : ""}. Signal
        is nmcli 0–100 quality (or dBm on iw). Client isolation means peer devices
        usually aren&apos;t visible — this is an AP/RF view, not a client inventory.
      </p>
    </div>
  );
}
