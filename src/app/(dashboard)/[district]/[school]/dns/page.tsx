import { notFound } from "next/navigation";
import { Globe, Info, ShieldAlert } from "lucide-react";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  getScanSnapshot,
  listScanSnapshotsForSchool,
  listDnsForSchool,
} from "@/db/queries";
import { dateTime, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { SchoolTabs } from "@/components/school-tabs";
import { SnapshotPicker } from "@/components/snapshot-picker";
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

export default async function DnsPage({
  params,
  searchParams,
}: {
  params: Promise<{ district: string; school: string }>;
  searchParams: Promise<{ scan?: string }>;
}) {
  const { district: districtSlug, school: schoolSlug } = await params;
  const { scan } = await searchParams;

  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const scanId = scan ? Number.parseInt(scan, 10) : null;
  const validScanId = scanId != null && !Number.isNaN(scanId) ? scanId : null;

  const [snapshots, dns, snapshot] = await Promise.all([
    listScanSnapshotsForSchool(school.id),
    listDnsForSchool(school.id, validScanId ? { scanId: validScanId } : {}),
    validScanId ? getScanSnapshot(school.id, validScanId) : Promise.resolve(null),
  ]);

  const { resolvers, probes } = dns;
  const anyRewrite = resolvers.some((r) => r.nxdomainRewrite);

  return (
    <div className="flex flex-col gap-6">
      <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />
      <PageHeader
        title="DNS health"
        description={
          snapshot
            ? `${school.name || titleizeSlug(school.slug)} · snapshot ${dateTime(snapshot.startedAt)}`
            : `${school.name || titleizeSlug(school.slug)} · most recent probe set`
        }
        actions={<SnapshotPicker snapshots={snapshots} value={validScanId} />}
      />

      {anyRewrite && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>
            One or more resolvers rewrote NXDOMAIN responses — a sign of
            captive-portal redirection or upstream DNS filtering.
          </span>
        </div>
      )}

      {/* Resolver health */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Resolver health
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {resolvers.length} resolver{resolvers.length === 1 ? "" : "s"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {resolvers.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Globe className="size-8 text-muted-foreground" />
              <p className="font-medium">No DNS health data</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                No resolver probes were recorded
                {validScanId ? " in this scan." : " at this school yet."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resolver</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Probes</TableHead>
                    <TableHead className="text-right">OK</TableHead>
                    <TableHead className="text-right">Errors</TableHead>
                    <TableHead className="text-right">Mean</TableHead>
                    <TableHead>NXDOMAIN</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resolvers.map((r) => {
                    const failed = (r.errors ?? 0) > 0;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-sm">
                          {r.resolverIp ?? "—"}
                        </TableCell>
                        <TableCell>
                          {r.resolverSource ? (
                            <Badge variant="outline" className="text-[10px] uppercase">
                              {r.resolverSource}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.probes ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.ok ?? "—"}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${failed ? "text-destructive font-medium" : ""}`}
                        >
                          {r.errors ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.meanMs != null ? `${r.meanMs.toFixed(1)} ms` : "—"}
                        </TableCell>
                        <TableCell>
                          {r.nxdomainRewrite ? (
                            <Badge variant="destructive" className="text-[10px] uppercase">
                              rewritten
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">clean</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Probe detail */}
      {probes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Probe detail
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {probes.length} quer{probes.length === 1 ? "y" : "ies"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:px-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resolver</TableHead>
                    <TableHead>Query</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Time</TableHead>
                    <TableHead className="hidden lg:table-cell">Answers</TableHead>
                    <TableHead className="hidden xl:table-cell">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {probes.map((p) => {
                    const mismatch =
                      p.expectedStatus != null &&
                      p.status != null &&
                      p.expectedStatus !== p.status;
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">
                          {p.resolverIp ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {p.queryName ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">{p.queryType ?? "—"}</TableCell>
                        <TableCell>
                          {p.status ? (
                            <Badge
                              variant={mismatch || p.error ? "destructive" : "secondary"}
                              className="text-[10px] uppercase"
                              title={
                                p.expectedStatus
                                  ? `expected ${p.expectedStatus}`
                                  : undefined
                              }
                            >
                              {p.status}
                            </Badge>
                          ) : p.error ? (
                            <Badge variant="destructive" className="text-[10px] uppercase">
                              error
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.queryTimeMs != null ? `${p.queryTimeMs} ms` : "—"}
                        </TableCell>
                        <TableCell
                          className="hidden max-w-xs truncate font-mono text-xs lg:table-cell"
                          title={p.answersText ?? p.error ?? undefined}
                        >
                          {p.answersText ?? (p.error ? p.error : "—")}
                        </TableCell>
                        <TableCell
                          className="hidden text-xs xl:table-cell"
                          title={dateTime(p.probedAt)}
                        >
                          {p.probedAt ? relativeTime(p.probedAt) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="size-3.5" />
        The sensor actively probes each resolver it can find (DHCP-provided,
        public, system stub) with a fixed query set, recording reachability,
        latency, and whether NXDOMAIN responses were rewritten.
      </p>
    </div>
  );
}
