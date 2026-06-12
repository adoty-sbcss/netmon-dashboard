import { notFound } from "next/navigation";
import { Activity, AlertTriangle, Gauge, Globe, ServerCog } from "lucide-react";

import { getDistrictBySlug, getSchoolBySlug } from "@/db/queries";
import {
  getDistrictIperf,
  listSchoolIperfResults,
  listSchoolSpeedtests,
  listSchoolLatency,
  type SchoolIperfRow,
  type SchoolLatencyRow,
} from "@/lib/iperf";
import { dateTime, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { SchoolTabs } from "@/components/school-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IperfChart } from "./iperf-chart";
import { SpeedtestLatest } from "./speedtest-latest";

export const dynamic = "force-dynamic";

function f1(v: number | null | undefined): string {
  return v == null ? "—" : v.toFixed(1);
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

  const [cfg, rows, speedtests, latencyRows] = await Promise.all([
    getDistrictIperf(district.id),
    listSchoolIperfResults(school.id, 300),
    listSchoolSpeedtests(school.id, 200),
    listSchoolLatency(school.id, 400),
  ]);

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

  // --- speed test: latest result per sensor + download/upload trend ---------
  const stLatestMap = new Map<string, (typeof speedtests)[number]>();
  for (const r of speedtests) {
    if (!stLatestMap.has(r.sensorSlug)) stLatestMap.set(r.sensorSlug, r);
  }
  const stLatest = [...stLatestMap.values()];

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

  const configured = Boolean(cfg.enabled && cfg.serverHost);

  return (
    <div className="flex flex-col gap-6">
      <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />
      <PageHeader
        title="Speed & Bandwidth"
        description={`${schoolName} · internet speed tests + internal throughput`}
      />

      {/* --- Internet speed (public speed tests: Ookla + Cloudflare) --- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="size-4 text-primary" /> Internet speed (public tests)
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {speedtests.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground sm:px-0">
              No public speed tests yet. Enable scheduled speed tests for this site
              to measure the internet circuit (download / upload / latency via
              Cloudflare).
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              <SpeedtestLatest items={stLatest} />
              {stKeys.length > 0 && (
                <div className="px-6 sm:px-0">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Download / upload over time
                  </p>
                  <IperfChart series={stSeries} keys={stKeys} />
                </div>
              )}
              <div className="overflow-x-auto">
                <p className="mb-2 px-6 text-xs font-medium text-muted-foreground sm:px-0">
                  Recent runs
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
                  {speedtests.slice(0, 50).map((r) => (
                    <TableRow key={r.id}>
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* --- Latency / jitter / loss (latest per target) --- */}
      {latencyCards.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-primary" /> Latency &amp; loss (latest)
            </CardTitle>
          </CardHeader>
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
            <CardHeader>
              <CardTitle className="text-base">Throughput over time</CardTitle>
            </CardHeader>
            <CardContent>
              <IperfChart series={series} keys={keys} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By sensor (slowest first)</CardTitle>
            </CardHeader>
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
            <CardHeader>
              <CardTitle className="text-base">Recent runs</CardTitle>
            </CardHeader>
            <CardContent className="px-0 sm:px-6">
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
                    {rows.slice(0, 50).map((r) => (
                      <TableRow key={r.id}>
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
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
