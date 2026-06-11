import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { ShieldAlert, Terminal } from "lucide-react";

import { db } from "@/db";
import { shellSessions } from "@/db/schema/management";
import { sensors, schools, districts } from "@/db/schema/app";
import { getSessionUser } from "@/lib/auth/current-user";
import { hashToken } from "@/lib/sensor/auth";
import { dateTime, relativeTime } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApproveButton } from "./approve-button";

export const metadata = { title: "Approve console session · NetMon Dashboard" };
export const dynamic = "force-dynamic";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Approve console session" description="Super-admin approval for a live remote-console (SSH-like) session." />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="size-4 text-primary" /> Console session
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">{children}</CardContent>
      </Card>
    </div>
  );
}

export default async function ApproveConsolePage({
  params,
  searchParams,
}: {
  params: Promise<{ sid: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { sid } = await params;
  const { token } = await searchParams;

  if (user.role !== "superadmin") {
    return (
      <Shell>
        <p className="flex items-center gap-2 text-sm text-destructive">
          <ShieldAlert className="size-4 shrink-0" /> Only super-admins can approve console sessions.
        </p>
      </Shell>
    );
  }

  const [s] = await db
    .select({
      status: shellSessions.status,
      openedByEmail: shellSessions.openedByEmail,
      approvalTokenHash: shellSessions.approvalTokenHash,
      approvedAt: shellSessions.approvedAt,
      createdAt: shellSessions.createdAt,
      expiresAt: shellSessions.expiresAt,
      sensorName: sensors.name,
      sensorSlug: sensors.slug,
      schoolName: schools.name,
      districtName: districts.name,
    })
    .from(shellSessions)
    .innerJoin(sensors, eq(shellSessions.sensorId, sensors.id))
    .innerJoin(schools, eq(sensors.schoolId, schools.id))
    .innerJoin(districts, eq(schools.districtId, districts.id))
    .where(eq(shellSessions.id, sid))
    .limit(1);

  if (!s) {
    return <Shell><p className="text-sm text-muted-foreground">This session was not found — it may have expired or been cleaned up.</p></Shell>;
  }
  if (!token || !s.approvalTokenHash || hashToken(token) !== s.approvalTokenHash) {
    return <Shell><p className="text-sm text-destructive">This approval link is invalid or has expired.</p></Shell>;
  }

  const sensorLabel = s.sensorName || s.sensorSlug;
  const details = (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">Sensor</dt>
      <dd className="font-medium">{sensorLabel} <span className="font-mono text-xs text-muted-foreground">{s.sensorSlug}</span></dd>
      <dt className="text-muted-foreground">Location</dt>
      <dd>{s.districtName} · {s.schoolName}</dd>
      <dt className="text-muted-foreground">Requested by</dt>
      <dd>{s.openedByEmail ?? "—"}</dd>
      <dt className="text-muted-foreground">Requested</dt>
      <dd title={dateTime(s.createdAt)}>{relativeTime(s.createdAt)}</dd>
    </dl>
  );

  if (s.approvedAt) {
    return <Shell>{details}<p className="text-sm text-emerald-600 dark:text-emerald-400">Already approved {relativeTime(s.approvedAt)} — the session is on its way.</p></Shell>;
  }
  if (s.status !== "pending") {
    return <Shell>{details}<p className="text-sm text-muted-foreground">This session is <strong>{s.status}</strong>; there&apos;s nothing to approve.</p></Shell>;
  }

  return (
    <Shell>
      {details}
      {s.openedByEmail === user.email && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
          You requested this session yourself. Approving it is allowed, but ideally a different
          super-admin reviews it.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Approving queues the session for the box. It connects out on its next check-in (~3 min) and
        the requester&apos;s console becomes ready. The session is time-boxed (30 min) and fully recorded.
      </p>
      <ApproveButton sid={sid} token={token} />
    </Shell>
  );
}
