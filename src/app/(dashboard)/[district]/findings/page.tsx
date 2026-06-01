import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { getDistrictBySlug } from "@/db/queries";
import { listDistrictFindings } from "@/db/district-queries";
import { num, relativeTime, titleizeSlug } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { SeverityBadge } from "@/components/severity-badge";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function DistrictFindingsPage({
  params,
}: {
  params: Promise<{ district: string }>;
}) {
  const { district: districtSlug } = await params;
  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();
  const findings = await listDistrictFindings(district.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="District findings"
        description={`${district.name || titleizeSlug(district.slug)} · ${num(findings.length)} finding${findings.length === 1 ? "" : "s"} across all schools`}
      />
      <Card>
        <CardContent className="py-2">
          {findings.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <ShieldAlert className="size-7 text-[var(--success)]" />
              <p className="text-sm font-medium">No findings</p>
              <p className="text-sm text-muted-foreground">
                No issues reported across this district&apos;s recent scans.
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
                    href={`/${district.slug}/${f.schoolSlug}`}
                    className="shrink-0 text-sm text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {f.schoolName || titleizeSlug(f.schoolSlug)}
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
