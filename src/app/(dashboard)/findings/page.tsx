import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { getSessionUser } from "@/lib/auth/current-user";
import { getUserScope } from "@/lib/auth/scope";
import { listFleetFindings } from "@/db/fleet-queries";
import { num, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { SeverityBadge } from "@/components/severity-badge";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function FleetFindingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const scope = await getUserScope(user);
  const findings = await listFleetFindings(scope.all ? null : scope.districtIds);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="All findings"
        description={`${num(findings.length)} open finding${
          findings.length === 1 ? "" : "s"
        } across every district you oversee`}
      />
      <Card>
        <CardContent className="py-2">
          {findings.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <ShieldAlert className="size-7 text-[var(--success)]" />
              <p className="text-sm font-medium">No findings</p>
              <p className="text-sm text-muted-foreground">
                No issues reported across recent scans. All clear.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {findings.map((f) => (
                <li key={f.id} className="flex items-start gap-3 py-3">
                  <SeverityBadge severity={f.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{f.title}</p>
                    {f.detail && (
                      <p className="text-sm text-muted-foreground">{f.detail}</p>
                    )}
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {f.rule}
                      {f.createdAt ? ` · ${relativeTime(f.createdAt)}` : ""}
                    </p>
                  </div>
                  <Link
                    href={`/${f.districtSlug}/${f.schoolSlug}`}
                    className="shrink-0 text-right text-sm text-muted-foreground hover:text-foreground hover:underline"
                  >
                    <span className="block">
                      {f.schoolName || titleizeSlug(f.schoolSlug)}
                    </span>
                    <span className="block text-xs">
                      {f.districtName || titleizeSlug(f.districtSlug)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
