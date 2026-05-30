import { notFound } from "next/navigation";
import { HardDrive, Info, Server } from "lucide-react";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  getScanSnapshot,
  listScanSnapshotsForSchool,
  listDhcpForSchool,
} from "@/db/queries";
import { dateTime, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
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

export default async function DhcpPage({
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

  const [snapshots, rows, snapshot] = await Promise.all([
    listScanSnapshotsForSchool(school.id),
    listDhcpForSchool(school.id, validScanId ? { scanId: validScanId } : {}),
    validScanId ? getScanSnapshot(school.id, validScanId) : Promise.resolve(null),
  ]);

  // Distinct servers observed (when any server fields are present).
  const servers = new Map<string, { ip: string; mac: string | null; count: number }>();
  for (const r of rows) {
    if (r.serverIp) {
      const cur = servers.get(r.serverIp) ?? { ip: r.serverIp, mac: r.serverMac, count: 0 };
      cur.count += 1;
      if (!cur.mac && r.serverMac) cur.mac = r.serverMac;
      servers.set(r.serverIp, cur);
    }
  }
  const serverList = [...servers.values()].sort((a, b) => b.count - a.count);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="DHCP activity"
        description={
          snapshot
            ? `${school.name || titleizeSlug(school.slug)} · snapshot ${dateTime(snapshot.startedAt)}`
            : `${school.name || titleizeSlug(school.slug)} · most recent observations`
        }
        actions={<SnapshotPicker snapshots={snapshots} value={validScanId} />}
      />

      {/* Servers */}
      {serverList.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="size-4 text-primary" />
              DHCP servers observed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {serverList.map((s) => (
                <Badge key={s.ip} variant="outline" className="gap-2 py-1.5">
                  <span className="font-mono">{s.ip}</span>
                  {s.mac && (
                    <span className="font-mono text-xs text-muted-foreground">{s.mac}</span>
                  )}
                  <span className="text-xs text-muted-foreground">×{s.count}</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Observations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Observations
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {rows.length} packet{rows.length === 1 ? "" : "s"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <HardDrive className="size-8 text-muted-foreground" />
              <p className="font-medium">No DHCP traffic</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                No DHCP packets were captured
                {validScanId ? " in this scan." : " at this school yet."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Client MAC</TableHead>
                    <TableHead className="hidden md:table-cell">Offered IP</TableHead>
                    <TableHead className="hidden lg:table-cell">Server</TableHead>
                    <TableHead className="hidden xl:table-cell">Router</TableHead>
                    <TableHead className="hidden xl:table-cell">DNS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell title={dateTime(r.seenAt)}>
                        {r.seenAt ? relativeTime(r.seenAt) : "—"}
                      </TableCell>
                      <TableCell>
                        {r.messageType ? (
                          <Badge variant="secondary" className="text-[10px] uppercase">
                            {r.messageType}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.clientMac ?? "—"}</TableCell>
                      <TableCell className="hidden font-mono tabular-nums md:table-cell">
                        {r.offeredIp ?? "—"}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs lg:table-cell">
                        {r.serverIp ?? "—"}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs xl:table-cell">
                        {r.router ?? "—"}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs xl:table-cell">
                        {r.dnsServers ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="size-3.5" />
        Sensors observe DHCP passively, so server-side fields (offered IP, lease,
        options) are only present when an OFFER/ACK is captured on the wire — many
        rows are client REQUEST/DISCOVER packets with limited detail.
      </p>
    </div>
  );
}
