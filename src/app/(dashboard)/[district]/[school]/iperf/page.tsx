import { notFound } from "next/navigation";
import { Activity, AlertTriangle, Gauge, Globe, History, Network, Radio, ServerCog } from "lucide-react";

import { getDistrictBySlug, getSchoolBySlug } from "@/db/queries";
import {
  getDistrictIperf,
  getSchoolCommittedRate,
  listSchoolIperfResults,
  listSchoolSpeedtests,
  listSchoolLatency,
  listSchoolUplinkSamples,
  listSchoolUplinkDailyAvg,
  type SchoolIperfRow,
  type SchoolLatencyRow,
  type UplinkSampleRow,
} from "@/lib/iperf";
import { getSessionUser } from "@/lib/auth/current-user";
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
import { IperfChart } from "./iperf-chart-dynamic";
import { CommittedRateForm } from "./committed-rate-form";
import { SpeedScoreboard } from "./speed-scoreboard";
import { CollapsibleRuns } from "./collapsible-runs";
import { buildInternetCards, buildIperfCards } from "./summary";
import type { UplinkGlanceProps } from "./uplink-glance";

export const dynamic = "force-dynamic";

function f1(v: number | null | undefined): string {
  return v == null ? "—" : v.toFixed(1);
}

/** Run one section's query, falling back (and logging) if it throws, so a single
 *  failed query degrades its own card instead of 500-ing the whole page. The
 *  container-console log is greppable by label — this is how the uplink
 *  daily-avg bind bug surfaced (and what would otherwise hide the next one). */
async function safeQuery<T>(p: Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await p;
  } catch (err) {
    console.error(`[Speed & Bandwidth] query "${label}" failed; rendering without it:`, err);
    return fallback;
  }
}

/** Keep only uplink samples from the last 24h. Kept out of the component body so
 *  the Date.now() read isn't flagged as an impure render call. */
function withinLast24h(samples: UplinkSampleRow[]): UplinkSampleRow[] {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return samples.filter((s) => (s.sampledAt ?? s.createdAt).getTime() >= cutoff);
}

/** Recent-runs tables collapse to this window by default (CollapsibleRuns). */
const RECENT_WINDOW_MS = 5 * 60 * 60 * 1000;
/** ...but always show at least this many newest rows, so a quiet site whose last
 *  run predates the window still shows something instead of an empty table. */
const MIN_VISIBLE_ROWS = 3;

/** For a newest-first row list, flag which rows fall outside the recent window
 *  and should hide while the table is collapsed. Date.now() kept out of the
 *  render body, matching withinLast24h above. */
function tagOlder<T>(rows: T[], ts: (r: T) => number): boolean[] {
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  return rows.map((r, i) => i >= MIN_VISIBLE_ROWS && ts(r) < cutoff);
}

/** PERF-3: tint utilization as it approaches/exceeds the committed rate. */
function pctClass(p: number | null): string {
  if (p == null) return "";
  if (p >= 100) return "text-destructive";
  if (p >= 80) return "text-[var(--warning)]";
  return "";
}

function UplinkMetric({
  label,
  mbps,
  pct,
}: {
  label: string;
  mbps: number | null;
  pct: number | null;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">
        {mbps == null ? "—" : `${f1(mbps)} Mbps`}
      </p>
      {pct != null && (
        <p className={`text-xs tabular-nums ${pctClass(pct)}`}>
          {pct.toFixed(0)}% of committed
        </p>
      )}
    </div>
  );
}

interface SensorSummary {
  slug: string;
  name: string | null;
  runs: number;
  failed: number;
  latest: SchoolIperfRow | null;
  avg: number | null;
  min: number | null;
  max: number | null;
}

export default async function IperfPage({
  params,
}: {
  params: Promise<{ district: string; school: string }>;
}) {
  const { district: districtSlug, school: schoolSlug } = await params;
  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const [
    cfg,
    rows,
    speedtests,
    latencyRows,
    committed,
    uplinkRows,
    uplinkDaily,
    sessionUser,
  ] = await Promise.all([
    safeQuery(getDistrictIperf(district.id), { serverHost: "", serverPort: 5201, enabled: false }, "districtIperf"),
    safeQuery(listSchoolIperfResults(school.id, 300), [], "iperfResults"),
    safeQuery(listSchoolSpeedtests(school.id, 200), [], "speedtests"),
    safeQuery(listSchoolLatency(school.id, 400), [], "latency"),
    safeQuery(getSchoolCommittedRate(school.id), { committedMbps: null, label: null, note: null, updatedAt: null }, "committedRate"),
    safeQuery(listSchoolUplinkSamples(school.id, 500), [], "uplinkSamples"),
    safeQuery(listSchoolUplinkDailyAvg(school.id, 30), [], "uplinkDailyAvg"),
    safeQuery(getSessionUser(), null, "sessionUser"),
  ]);
  const canEditRate = sessionUser?.role === "superadmin";

  // Latest latency probe per target (internet / gateway / dns), newest-first input.
  const latencyLatest = new Map<string, SchoolLatencyRow>();
  for (const r of latencyRows) {
    const k = r.label ?? "other";
    if (!latencyLatest.has(k)) latencyLatest.set(k, r);
  }
  const latencyCards = ["internet", "gateway", "dns"]
    .filter((k) => latencyLatest.has(k))
    .map((k) => latencyLatest.get(k)!);

  const schoolName = school.name || titleizeSlug(school.slug);

  // --- per-sensor summary (rows arrive newest-first) ------------------------
  const bySensor = new Map<string, SensorSummary>();
  for (const r of rows) {
    let s = bySensor.get(r.sensorSlug);
    if (!s) {
      s = { slug: r.sensorSlug, name: r.sensorName, runs: 0, failed: 0, latest: null, avg: null, min: null, max: null };
      bySensor.set(r.sensorSlug, s);
    }
    s.runs++;
    if (!r.ok) s.failed++;
    if (s.latest == null) s.latest = r; // first seen = most recent
  }
  for (const s of bySensor.values()) {
    const vals = rows
      .filter((r) => r.sensorSlug === s.slug && r.ok && r.throughputMbps != null)
      .map((r) => r.throughputMbps as number);
    if (vals.length) {
      s.avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      s.min = Math.min(...vals);
      s.max = Math.max(...vals);
    }
  }
  const summaries = [...bySensor.values()].sort(
    (a, b) => (a.latest?.throughputMbps ?? Infinity) - (b.latest?.throughputMbps ?? Infinity),
  );
  // Relative bottleneck cue: best latest throughput across the school's sensors.
  const bestLatest = Math.max(
    0,
    ...summaries.map((s) => (s.latest?.ok ? s.latest.throughputMbps ?? 0 : 0)),
  );

  // --- chart series (ok results, one line per sensor+direction) -------------
  const seriesMap = new Map<number, Record<string, number>>();
  const keySet = new Set<string>();
  for (const r of rows) {
    if (!r.ok || r.throughputMbps == null) continue;
    const ts = (r.startedAt ?? r.createdAt).getTime();
    const label = `${r.sensorName || r.sensorSlug}${r.direction ? ` ${r.direction}` : ""}`;
    keySet.add(label);
    const point = seriesMap.get(ts) ?? { ts };
    point[label] = r.throughputMbps;
    seriesMap.set(ts, point);
  }
  const series = [...seriesMap.values()].sort((a, b) => a.ts - b.ts);
  const keys = [...keySet];

  // --- speed test: download/upload trend (latest-per-sensor → scoreboard) ----
  const stSeriesMap = new Map<number, Record<string, number>>();
  const stKeySet = new Set<string>();
  for (const r of speedtests) {
    if (!r.ok) continue;
    const ts = (r.startedAt ?? r.createdAt).getTime();
    const label = r.sensorName || r.sensorSlug;
    const point = stSeriesMap.get(ts) ?? { ts };
    if (r.downloadMbps != null) {
      point[`${label} ↓`] = r.downloadMbps;
      stKeySet.add(`${label} ↓`);
    }
    if (r.uploadMbps != null) {
      point[`${label} ↑`] = r.uploadMbps;
      stKeySet.add(`${label} ↑`);
    }
    stSeriesMap.set(ts, point);
  }
  const stSeries = [...stSeriesMap.values()].sort((a, b) => a.ts - b.ts);
  const stKeys = [...stKeySet];

  // --- PERF-3: uplink utilization vs committed rate -------------------------
  // Group samples by uplink (chassis+ifindex). The school's WAN uplink = the
  // busiest one (highest latest in+out Mbps) — in a directional spine crawl
  // that's the edge/core port facing the gateway.
  const upByKey = new Map<string, UplinkSampleRow[]>();
  for (const s of uplinkRows) {
    const key = `${s.chassisId}|${s.ifindex}`;
    (upByKey.get(key) ?? upByKey.set(key, []).get(key)!).push(s);
  }
  // rows arrive newest-first; keep each uplink's series oldest-first for charts.
  for (const arr of upByKey.values()) arr.reverse();
  const latestRate = (arr: UplinkSampleRow[]) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      const r = arr[i];
      if (r.inMbps != null || r.outMbps != null) return (r.inMbps ?? 0) + (r.outMbps ?? 0);
    }
    return -1; // no computed rate yet (only a baseline sample)
  };
  let wanKey: string | null = null;
  let wanBest = -1;
  for (const [key, arr] of upByKey) {
    const r = latestRate(arr);
    if (r > wanBest) {
      wanBest = r;
      wanKey = key;
    }
  }
  const wanSamples = wanKey ? upByKey.get(wanKey)! : [];
  const wanLatest = [...wanSamples].reverse().find((s) => s.inMbps != null || s.outMbps != null) ?? null;
  const wanCurrentIn = wanLatest?.inMbps ?? null;
  const wanCurrentOut = wanLatest?.outMbps ?? null;
  const committedMbps = committed.committedMbps;
  const utilPct = (mbps: number | null) =>
    committedMbps && committedMbps > 0 && mbps != null ? (mbps / committedMbps) * 100 : null;
  const utilInPct = utilPct(wanCurrentIn);
  const utilOutPct = utilPct(wanCurrentOut);
  const wanName = wanLatest?.ifName ?? wanSamples.at(-1)?.ifName ?? null;
  const wanSpeedMbps = wanLatest?.speedMbps ?? wanSamples.at(-1)?.speedMbps ?? null;
  // Hourly samples are kept to the recent window; the 30-day view below is the
  // long-range overview (daily averages, aggregated DB-side).
  const sampleTs = (s: UplinkSampleRow) => (s.sampledAt ?? s.createdAt).getTime();
  const wanSamples24h = withinLast24h(wanSamples);
  // Hourly trend for the WAN uplink (in/out Mbps over the last 24h).
  const upSeries = wanSamples24h
    .filter((s) => s.inMbps != null || s.outMbps != null)
    .map((s) => {
      const point: Record<string, number> = { ts: sampleTs(s) };
      if (s.inMbps != null) point["↓ in"] = s.inMbps;
      if (s.outMbps != null) point["↑ out"] = s.outMbps;
      return point;
    });
  const upKeys = ["↓ in", "↑ out"].filter((k) => upSeries.some((p) => k in p));

  // Daily-average trend for the WAN uplink over the last 30 days. The aggregate
  // covers all uplinks; keep just the one we picked as the WAN edge.
  const wanDaily = wanKey
    ? uplinkDaily.filter((d) => `${d.chassisId}|${d.ifindex}` === wanKey)
    : [];
  const upDailySeries = wanDaily
    .filter((d) => d.inMbps != null || d.outMbps != null)
    .map((d) => {
      const point: Record<string, number> = {
        ts: new Date(`${d.day}T00:00:00`).getTime(),
      };
      if (d.inMbps != null) point["↓ in"] = d.inMbps;
      if (d.outMbps != null) point["↑ out"] = d.outMbps;
      return point;
    })
    .sort((a, b) => a.ts - b.ts);
  const upDailyKeys = ["↓ in", "↑ out"].filter((k) =>
    upDailySeries.some((p) => k in p),
  );
  const hasUplinkData = uplinkRows.length > 0;

  // --- scoreboard view-models (the at-a-glance hero) -------------------------
  const internetCards = buildInternetCards(speedtests);
  const iperfCards = buildIperfCards(rows);
  const uplinkGlance: UplinkGlanceProps | null = hasUplinkData
    ? {
        committedMbps,
        inMbps: wanCurrentIn,
        outMbps: wanCurrentOut,
        inPct: utilInPct,
        outPct: utilOutPct,
        wanName,
        when: wanLatest?.sampledAt ?? null,
        portSpeedMbps: wanSpeedMbps,
      }
    : null;

  // --- recent-runs collapse: tag rows past the 5h window (newest-first) -------
  const stRows = speedtests.slice(0, 50);
  const stOlder = tagOlder(stRows, (r) => (r.startedAt ?? r.createdAt).getTime());
  const stOlderCount = stOlder.filter(Boolean).length;
  const iperfRows = rows.slice(0, 50);
  const iperfOlder = tagOlder(iperfRows, (r) => (r.startedAt ?? r.createdAt).getTime());
  const iperfOlderCount = iperfOlder.filter(Boolean).length;
  const sampleRowsDesc = [...wanSamples24h].reverse();
  const sampleOlder = tagOlder(sampleRowsDesc, (s) => (s.sampledAt ?? s.createdAt).getTime());
  const sampleOlderCount = sampleOlder.filter(Boolean).length;

  const configured = Boolean(cfg.enabled && cfg.serverHost);

  return (
    <div className="flex flex-col gap-6">
      <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />
      <PageHeader
        title="Speed & Bandwidth"
        description={`${schoolName} · internet speed tests + internal throughput`}
      />

      {/* --- At-a-glance scoreboard: internet + iperf side by side, WAN strip --- */}
      <SpeedScoreboard internet={internetCards} iperf={iperfCards} uplink={uplinkGlance} />

      {/* --- Internet speed (public speed tests: Ookla + Cloudflare) --- */}
      <Card>
        <SectionHeader icon={Globe} title="Internet speed · history" />
        <CardContent className="px-0 sm:px-6">
          {speedtests.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground sm:px-0">
              No public speed tests yet. Enable scheduled speed tests for this site
              to measure the internet circuit (download / upload / latency via
              Cloudflare).
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              {stKeys.length > 0 && (
                <div className="px-6 sm:px-0">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Download / upload over time
                  </p>
                  <IperfChart series={stSeries} keys={stKeys} />
                </div>
              )}
              <CollapsibleRuns olderCount={stOlderCount} triggerClassName="px-6 sm:px-0">
              <div className="overflow-x-auto">
                <p className="mb-2 px-6 text-xs font-medium text-muted-foreground sm:px-0">
                  Recent runs <span className="font-normal">· last 5 hours</span>
                </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Sensor</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>↓ Down</TableHead>
                    <TableHead>↑ Up</TableHead>
                    <TableHead className="hidden sm:table-cell">Latency</TableHead>
                    <TableHead className="hidden md:table-cell">Jitter</TableHead>
                    <TableHead className="hidden lg:table-cell">Server / ISP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stRows.map((r, i) => (
                    <TableRow
                      key={r.id}
                      className={stOlder[i] ? "group-data-[expanded=false]/runs:hidden" : undefined}
                    >
                      <TableCell
                        className="whitespace-nowrap text-muted-foreground"
                        title={dateTime(r.startedAt ?? r.createdAt)}
                      >
                        {relativeTime(r.startedAt ?? r.createdAt)}
                      </TableCell>
                      <TableCell>{r.sensorName || r.sensorSlug}</TableCell>
                      <TableCell className="capitalize">{r.provider ?? "—"}</TableCell>
                      <TableCell>
                        {!r.ok ? (
                          <Badge
                            variant="outline"
                            className="gap-1 text-destructive"
                            title={r.error ?? undefined}
                          >
                            <AlertTriangle className="size-3" /> failed
                          </Badge>
                        ) : (
                          `${f1(r.downloadMbps)} Mbps`
                        )}
                      </TableCell>
                      <TableCell>{r.ok ? `${f1(r.uploadMbps)} Mbps` : "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {r.latencyMs == null ? "—" : `${f1(r.latencyMs)} ms`}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {r.jitterMs == null ? "—" : `${f1(r.jitterMs)} ms`}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {!r.ok ? (
                          <span className="text-destructive" title={r.error ?? undefined}>
                            {r.error ?? "failed"}
                          </span>
                        ) : (
                          <>
                            {r.resultUrl ? (
                              <a
                                href={r.resultUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                              >
                                {r.server || "result"}
                              </a>
                            ) : (
                              r.server || "—"
                            )}
                            {r.isp ? ` · ${r.isp}` : ""}
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
              </CollapsibleRuns>
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- Latency / jitter / loss (latest per target) --- */}
      {latencyCards.length > 0 && (
        <Card>
          <SectionHeader icon={Activity} title="Latency & loss (latest)" />
          <CardContent className="px-0 sm:px-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Target</TableHead>
                    <TableHead className="hidden sm:table-cell">Host</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead>Jitter</TableHead>
                    <TableHead>Loss</TableHead>
                    <TableHead className="hidden lg:table-cell">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latencyCards.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium capitalize">{r.label ?? "—"}</TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                        {r.target ?? "—"}
                      </TableCell>
                      <TableCell>{r.latencyMs == null ? "—" : `${f1(r.latencyMs)} ms`}</TableCell>
                      <TableCell>{r.jitterMs == null ? "—" : `${f1(r.jitterMs)} ms`}</TableCell>
                      <TableCell
                        className={
                          r.lossPct != null && r.lossPct > 0
                            ? "font-medium text-[var(--warning)]"
                            : ""
                        }
                      >
                        {r.lossPct == null ? "—" : `${r.lossPct.toFixed(1)}%`}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {relativeTime(r.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- Uplink utilization vs committed rate (PERF-3) --- */}
      {(hasUplinkData || canEditRate || committedMbps != null) && (
        <Card>
          <SectionHeader
            icon={Network}
            title="Uplink utilization"
            meta={
              committedMbps != null ? (
                <Badge variant="outline" className="font-normal">
                  vs {committedMbps} Mbps committed
                </Badge>
              ) : undefined
            }
          />
          <CardContent className="flex flex-col gap-6">
            <p className="text-sm text-muted-foreground">
              Measured from SNMP uplink counter deltas on the WAN-facing port,
              shown against the school&apos;s <em>committed</em> rate — not the
              physical port speed (a 10G port may carry only 1–10G of paid
              transport). Each point is the average over an ~hourly sample.
            </p>

            {!hasUplinkData ? (
              <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                No uplink samples yet. They appear once a sensor with SNMP spine
                crawl enabled reports its uplink counters (two samples are needed
                to compute a rate).
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <UplinkMetric label="↓ In" mbps={wanCurrentIn} pct={utilInPct} />
                  <UplinkMetric label="↑ Out" mbps={wanCurrentOut} pct={utilOutPct} />
                  <div>
                    <p className="text-xs text-muted-foreground">Committed</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {committedMbps != null ? `${committedMbps} Mbps` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Port speed</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {wanSpeedMbps != null ? `${wanSpeedMbps} Mbps` : "—"}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  WAN uplink: {wanName ?? "—"}
                  {wanLatest?.sampledAt
                    ? ` · sampled ${relativeTime(wanLatest.sampledAt)}`
                    : ""}
                </p>
                {committedMbps == null && (
                  <p className="text-xs text-[var(--warning)]">
                    Set a committed rate {canEditRate ? "below " : ""}to see
                    utilization %.
                  </p>
                )}
                {upDailyKeys.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Daily average · last 30 days
                    </p>
                    <IperfChart
                      series={upDailySeries}
                      keys={upDailyKeys}
                      referenceY={committedMbps}
                      referenceLabel="Contracted rate"
                    />
                  </div>
                )}
                {upKeys.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Hourly · last 24 hours
                    </p>
                    <IperfChart
                      series={upSeries}
                      keys={upKeys}
                      referenceY={committedMbps}
                      referenceLabel="Contracted rate"
                    />
                  </div>
                )}
                <div className="overflow-x-auto">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Recent samples <span className="font-normal">· last 5 hours</span>
                  </p>
                  {sampleRowsDesc.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No uplink samples in the last 24 hours.
                    </p>
                  ) : (
                  <CollapsibleRuns olderCount={sampleOlderCount}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>↓ In</TableHead>
                        <TableHead>↑ Out</TableHead>
                        <TableHead className="hidden sm:table-cell">
                          % of committed
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sampleRowsDesc.map((s, i) => {
                          const pIn = utilPct(s.inMbps);
                          const pOut = utilPct(s.outMbps);
                          const peak =
                            pIn != null || pOut != null
                              ? Math.max(pIn ?? 0, pOut ?? 0)
                              : null;
                          return (
                            <TableRow
                              key={s.id}
                              className={sampleOlder[i] ? "group-data-[expanded=false]/runs:hidden" : undefined}
                            >
                              <TableCell
                                className="whitespace-nowrap text-muted-foreground"
                                title={s.sampledAt ? dateTime(s.sampledAt) : ""}
                              >
                                {s.sampledAt
                                  ? relativeTime(s.sampledAt)
                                  : relativeTime(s.createdAt)}
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {f1(s.inMbps)}
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {f1(s.outMbps)}
                              </TableCell>
                              <TableCell
                                className={`hidden tabular-nums sm:table-cell ${pctClass(peak)}`}
                              >
                                {peak == null ? "—" : `${peak.toFixed(0)}%`}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                  </CollapsibleRuns>
                  )}
                </div>
              </>
            )}

            {canEditRate && (
              <CommittedRateForm
                districtSlug={district.slug}
                schoolSlug={school.slug}
                committedMbps={committedMbps}
                label={committed.label}
                note={committed.note}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* --- Internal throughput (iperf to the district's own server) --- */}
      <div className="flex items-center gap-2 pt-2 text-sm font-semibold text-muted-foreground">
        <Gauge className="size-4" /> Internal throughput (iperf)
      </div>

      {!configured && (
        <Card className="border-[var(--warning)]/40">
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <ServerCog className="mt-0.5 size-4 text-[var(--warning)]" />
            <div>
              <p className="font-medium">iPerf server not enabled for this district</p>
              <p className="text-muted-foreground">
                Set the iperf server in District → Settings, then schedule runs per
                sensor on the sensor page. Any past results still show below.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <Gauge className="size-8 text-muted-foreground" />
          <p className="font-medium">No iPerf results yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Schedule a run on a sensor (sensor page → iPerf) or run one on demand;
            results report back here.
          </p>
        </div>
      ) : (
        <>
          <Card>
            <SectionHeader icon={Gauge} title="Throughput over time" />
            <CardContent>
              <IperfChart series={series} keys={keys} />
            </CardContent>
          </Card>

          <Card>
            <SectionHeader icon={Radio} title="By sensor (slowest first)" />
            <CardContent className="px-0 sm:px-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sensor</TableHead>
                      <TableHead>Latest</TableHead>
                      <TableHead className="hidden sm:table-cell">Avg</TableHead>
                      <TableHead className="hidden md:table-cell">Min / Max</TableHead>
                      <TableHead className="hidden lg:table-cell">Last run</TableHead>
                      <TableHead>Runs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summaries.map((s) => {
                      const latest = s.latest;
                      const slow =
                        bestLatest > 0 &&
                        latest?.ok === true &&
                        latest.throughputMbps != null &&
                        latest.throughputMbps < bestLatest * 0.5;
                      return (
                        <TableRow key={s.slug}>
                          <TableCell className="font-medium">{s.name || s.slug}</TableCell>
                          <TableCell>
                            {latest == null ? (
                              "—"
                            ) : !latest.ok ? (
                              <Badge variant="outline" className="gap-1 text-destructive">
                                <AlertTriangle className="size-3" /> failed
                              </Badge>
                            ) : (
                              <span className={slow ? "font-medium text-[var(--warning)]" : ""}>
                                {f1(latest.throughputMbps)} Mbps
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">{f1(s.avg)}</TableCell>
                          <TableCell className="hidden text-muted-foreground md:table-cell">
                            {f1(s.min)} / {f1(s.max)}
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground lg:table-cell">
                            {latest ? relativeTime(latest.createdAt) : "—"}
                          </TableCell>
                          <TableCell>
                            {s.runs}
                            {s.failed > 0 && (
                              <span className="text-destructive"> ({s.failed} failed)</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <SectionHeader icon={History} title="Recent runs" meta="· last 5 hours" />
            <CardContent className="px-0 sm:px-6">
              <CollapsibleRuns olderCount={iperfOlderCount} triggerClassName="px-6 sm:px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Sensor</TableHead>
                      <TableHead className="hidden sm:table-cell">Dir</TableHead>
                      <TableHead className="hidden sm:table-cell">Proto</TableHead>
                      <TableHead>Mbps</TableHead>
                      <TableHead className="hidden md:table-cell">Retr</TableHead>
                      <TableHead className="hidden lg:table-cell">Jitter</TableHead>
                      <TableHead className="hidden lg:table-cell">Loss</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {iperfRows.map((r, i) => (
                      <TableRow
                        key={r.id}
                        className={iperfOlder[i] ? "group-data-[expanded=false]/runs:hidden" : undefined}
                      >
                        <TableCell
                          className="whitespace-nowrap text-muted-foreground"
                          title={dateTime(r.startedAt ?? r.createdAt)}
                        >
                          {relativeTime(r.startedAt ?? r.createdAt)}
                        </TableCell>
                        <TableCell>{r.sensorName || r.sensorSlug}</TableCell>
                        <TableCell className="hidden capitalize sm:table-cell">
                          {r.direction ?? "—"}
                        </TableCell>
                        <TableCell className="hidden uppercase sm:table-cell">
                          {r.protocol ?? "—"}
                        </TableCell>
                        <TableCell>
                          {!r.ok ? <span className="text-destructive">failed</span> : f1(r.throughputMbps)}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">{r.retransmits ?? "—"}</TableCell>
                        <TableCell className="hidden lg:table-cell">{f1(r.jitterMs)}</TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {r.lossPct == null ? "—" : `${r.lossPct.toFixed(1)}%`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              </CollapsibleRuns>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
