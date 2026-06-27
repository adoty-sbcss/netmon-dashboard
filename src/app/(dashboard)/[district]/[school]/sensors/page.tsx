import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";

import {
  getDistrictBySlug,
  getSchoolBySlug,
  listSensorsForSchool,
} from "@/db/queries";
import { dateTime, num, relativeTime, titleizeSlug } from "@/lib/format";
import { getSessionUser } from "@/lib/auth/current-user";
import { getEnrollmentView } from "@/lib/sensor/enrollment";
import { resolveSftpConfig } from "@/lib/ingest/settings";
import { getDistrictSftpCreds } from "@/lib/admin/sftp-provision";
import { PageHeader } from "@/components/page-header";
import { SchoolTabs } from "@/components/school-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeploySensor } from "../deploy-sensor";

// Live data — render on each request.
export const dynamic = "force-dynamic";

export default async function SchoolSensorsPage({
  params,
}: {
  params: Promise<{ district: string; school: string }>;
}) {
  const { district: districtSlug, school: schoolSlug } = await params;

  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const school = await getSchoolBySlug(district.id, schoolSlug);
  if (!school) notFound();

  const sensors = await listSensorsForSchool(school.id);

  // PROV-2b: superadmin-only "Deploy a sensor here" (the provisioning block
  // carries the bootstrap key + SFTP password, so it's gated).
  const user = await getSessionUser();
  let deploy: {
    appOrigin: string;
    bootstrapKey: string | null;
    sftp: { host: string; port: number; user: string; password: string | null; remotePath: string } | null;
  } | null = null;
  if (user?.role === "superadmin") {
    const [enrollment, sftpResolved, hdrs] = await Promise.all([
      getEnrollmentView(),
      resolveSftpConfig(),
      headers(),
    ]);
    let appOrigin = (process.env.APP_ORIGIN ?? "").replace(/\/$/, "");
    if (!appOrigin) {
      const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
      const proto = hdrs.get("x-forwarded-proto") ?? "https";
      appOrigin = host ? `${proto}://${host}` : "";
    }
    // Prefer this district's SCOPED depot creds (SFTP-2b); fall back to the
    // shared fleet SFTP until the district's user has been minted.
    const districtCreds = await getDistrictSftpCreds(district.id);
    const c = sftpResolved.config;
    deploy = {
      appOrigin,
      bootstrapKey: enrollment.bootstrapKey,
      sftp: districtCreds
        ? {
            host: districtCreds.host,
            port: districtCreds.port,
            user: districtCreds.username,
            password: districtCreds.password,
            remotePath: districtCreds.remotePath,
          }
        : c
          ? {
              host: c.host,
              port: c.port,
              user: c.username,
              password: c.password ?? null,
              remotePath: c.baseDir || "/",
            }
          : null,
    };
  }

  return (
    <div className="flex flex-col gap-6">
      <SchoolTabs districtSlug={district.slug} schoolSlug={school.slug} />

      <PageHeader
        title="Sensors"
        description={`${school.name || titleizeSlug(school.slug)} · ${num(sensors.length)} sensor${sensors.length === 1 ? "" : "s"} reporting`}
      />

      <Card>
        <CardContent className="px-0 sm:px-6">
          {sensors.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No sensors reporting at this school yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sensor</TableHead>
                    <TableHead className="text-right">Devices</TableHead>
                    <TableHead>Last scan</TableHead>
                    <TableHead className="hidden md:table-cell">Last check-in</TableHead>
                    <TableHead className="hidden lg:table-cell">Agent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sensors.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/${district.slug}/${school.slug}/sensor/${s.id}`}
                          className="hover:underline"
                        >
                          {s.name || titleizeSlug(s.slug)}
                        </Link>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {s.slug}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {num(s.deviceCount)}
                      </TableCell>
                      <TableCell>
                        {s.lastScanAt ? (
                          <span title={dateTime(s.lastScanAt)}>
                            {relativeTime(s.lastScanAt)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">never</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {s.lastCheckinAt ? (
                          relativeTime(s.lastCheckinAt)
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            no check-in
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                        {s.agentVersion ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deploy a sensor here — superadmin only. */}
      {deploy && (
        <DeploySensor
          appOrigin={deploy.appOrigin}
          bootstrapKey={deploy.bootstrapKey}
          sftp={deploy.sftp}
          districtName={district.name}
          districtSlug={district.slug}
          schoolName={school.name || titleizeSlug(school.slug)}
          schoolSlug={school.slug}
        />
      )}
    </div>
  );
}
