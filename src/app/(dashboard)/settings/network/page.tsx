import Link from "next/link";
import { redirect } from "next/navigation";
import { Radar, Rocket, UploadCloud } from "lucide-react";

import { getSessionUser } from "@/lib/auth/current-user";
import { listAuthorizedDhcpServers } from "@/lib/dhcp-policy";
import { getDistrictIperf } from "@/lib/iperf";
import {
  listDistrictsForSettings,
  listDistrictSensorCapabilities,
} from "@/db/settings-queries";
import { titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CapabilityMatrix } from "./capability-matrix";
import { SnmpCommunityForm } from "./snmp-community-form";
import { DhcpServersManager } from "../../[district]/settings/dhcp-servers-manager";
import { IperfServerForm } from "../../[district]/settings/iperf-server-form";

export const metadata = { title: "Network settings · NetMon Dashboard" };
export const dynamic = "force-dynamic";

const BASE = "/settings/network";

export default async function NetworkSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ district?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Single consolidated control plane for district + per-sensor config.
  if (user.role !== "superadmin") redirect("/");

  const districts = await listDistrictsForSettings();
  const { district: districtParam } = await searchParams;
  // Default to the first district so the page is never blank.
  const selected =
    districts.find((d) => d.slug === districtParam) ?? districts[0] ?? null;

  const basePath = selected ? `${BASE}?district=${selected.slug}` : BASE;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Network settings"
        description="One place for everything per district, school, and sensor — turn capabilities on for the boxes that need them, and set the shared policy they use."
      />

      {districts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No districts yet. Add one from the overview, then deploy a sensor.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* District picker — the whole page is scoped to one district at a time. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">District:</span>
            {districts.map((d) => {
              const active = selected?.id === d.id;
              return (
                <Button
                  key={d.id}
                  asChild
                  size="sm"
                  variant={active ? "default" : "outline"}
                >
                  <Link href={`${BASE}?district=${d.slug}`}>
                    {d.name || titleizeSlug(d.slug)}
                  </Link>
                </Button>
              );
            })}
          </div>

          {selected && (
            <NetworkSettingsForDistrict
              districtId={selected.id}
              districtSlug={selected.slug}
              basePath={basePath}
            />
          )}
        </>
      )}
    </div>
  );
}

async function NetworkSettingsForDistrict({
  districtId,
  districtSlug,
  basePath,
}: {
  districtId: number;
  districtSlug: string;
  basePath: string;
}) {
  const [sensors, dhcpServers, iperf] = await Promise.all([
    listDistrictSensorCapabilities(districtId),
    listAuthorizedDhcpServers(districtId),
    getDistrictIperf(districtId),
  ]);
  const currentCommunity = sensors.find((s) => s.snmpCommunities)?.snmpCommunities ?? "";

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Per-sensor capabilities — the headline: enable each capability on the
            boxes that need it. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Radar className="size-4 text-primary" />
            Per-sensor capabilities
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CapabilityMatrix basePath={basePath} sensors={sensors} />
        </CardContent>
      </Card>

      {/* 2. Shared settings the capabilities use. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shared settings (this district)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <SnmpCommunityForm districtId={districtId} basePath={basePath} current={currentCommunity} />
          <div className="border-t" />
          <IperfServerForm districtSlug={districtSlug} iperf={iperf} />
        </CardContent>
      </Card>

      {/* 3. District policy that tunes alerts + AI. */}
      <DhcpServersManager districtSlug={districtSlug} servers={dhcpServers} />

      {/* 4. Deeper/per-sensor settings that live elsewhere. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">More</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/sensors/sftp"><UploadCloud className="size-4" /> SFTP destination (fleet)</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/sensors/crawl"><Radar className="size-4" /> Crawl scope & tuning</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/sensors/releases"><Rocket className="size-4" /> Release channels</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
