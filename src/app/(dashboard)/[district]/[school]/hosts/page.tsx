import { notFound } from "next/navigation";
import { Cpu, Info } from "lucide-react";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  getScanSnapshot,
  listScanSnapshotsForSchool,
  listHostsForSchool,
} from "@/db/queries";
import { dateTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { SnapshotPicker } from "@/components/snapshot-picker";
import { HostInventory } from "@/components/host-inventory";
import { Card, CardContent } from "@/components/ui/card";

export default async function HostsPage({
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

  const [snapshots, hosts, snapshot] = await Promise.all([
    listScanSnapshotsForSchool(school.id),
    listHostsForSchool(school.id, validScanId ? { scanId: validScanId } : {}),
    validScanId ? getScanSnapshot(school.id, validScanId) : Promise.resolve(null),
  ]);

  const basePath = `/${district.slug}/${school.slug}`;
  const anyPortResolved = hosts.some((h) => h.switchPort);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Host inventory"
        description={
          snapshot
            ? `${school.name || titleizeSlug(school.slug)} · snapshot ${dateTime(snapshot.startedAt)}`
            : `${school.name || titleizeSlug(school.slug)} · current view`
        }
        actions={<SnapshotPicker snapshots={snapshots} value={validScanId} />}
      />

      {validScanId ? (
        <Card className="border-[var(--info)]/30 bg-[var(--info)]/5">
          <CardContent className="flex items-start gap-2 py-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-[var(--info)]" />
            <span className="text-muted-foreground">
              Showing exactly what this scan saw — including transient or MAC-less
              hits. Rows without a stable identity aren&apos;t clickable. Switch to{" "}
              <span className="font-medium text-foreground">Latest</span> for the
              deduped current inventory.
            </span>
          </CardContent>
        </Card>
      ) : null}

      {hosts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Cpu className="size-8 text-muted-foreground" />
            <p className="font-medium">No hosts</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {validScanId
                ? "This scan recorded no host devices."
                : "No hosts have been discovered at this school yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <HostInventory hosts={hosts} basePath={basePath} />
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="size-3.5 shrink-0" />
        {anyPortResolved
          ? "Switch port is derived from BRIDGE-MIB forwarding tables (MAC → bridge port → ifName). Hosts without a port haven't been learned on an SNMP-polled switch yet."
          : "Per-host switch port requires BRIDGE-MIB forwarding-table polling on a managed switch. The collector now extracts it where available — no ports have resolved at this school yet (the access switches aren't SNMP-polled)."}
      </p>
    </div>
  );
}
