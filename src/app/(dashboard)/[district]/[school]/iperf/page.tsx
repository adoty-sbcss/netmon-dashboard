import { notFound } from "next/navigation";
import { AlertTriangle, Gauge, ServerCog } from "lucide-react";

import { getDistrictBySlug, getSchoolBySlug } from "@/db/queries";
import { getDistrictIperf, listSchoolIperfResults, type SchoolIperfRow } from "@/lib/iperf";
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

  const [cfg, rows] = await Promise.all([
    getDistrictIperf(district.id),
    listSchoolIperfResults(school.id, 300),
  ]);

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

  const configured = Boolean(cfg.enabled && cfg.serverHost);

  return (
    <div className="flex flex-col gap-6">
      <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />
      <PageHeader
        title="iPerf bandwidth"
        description={
          configured
            ? `${schoolName} · server ${cfg.serverHost}:${cfg.serverPort}`
            : `${schoolName} · throughput tests`
        }
      />

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
