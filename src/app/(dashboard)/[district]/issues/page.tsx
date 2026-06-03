import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { getDistrictBySlug } from "@/db/queries";
import { listIssuesForDistrict } from "@/lib/issues/queries";
import { getSessionUser } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/page-header";
import { IssuesList } from "@/components/issues-list";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function DistrictIssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ district: string }>;
  searchParams: Promise<{ resolved?: string }>;
}) {
  const { district: districtSlug } = await params;
  const { resolved } = await searchParams;
  const showResolved = resolved === "1";

  const user = await getSessionUser();
  if (!user) redirect("/login");
  const district = await getDistrictBySlug(districtSlug);
  if (!district) notFound();

  const issues = await listIssuesForDistrict(district.id, { includeResolved: showResolved });
  const basePath = `/${district.slug}/issues`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Issues"
        description={`${district.name} · what needs attention — distilled from AI analysis, deduplicated, auto-resolving`}
      />

      <div className="flex items-center gap-3 text-sm">
        <Link
          href={`/${district.slug}/issues`}
          className={!showResolved ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}
        >
          Open
        </Link>
        <Link
          href={`/${district.slug}/issues?resolved=1`}
          className={showResolved ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}
        >
          Include resolved (history)
        </Link>
      </div>

      <Card>
        <CardContent>
          <IssuesList
            issues={issues}
            basePath={basePath}
            isAdmin={user.role === "superadmin"}
            showScope
          />
        </CardContent>
      </Card>
    </div>
  );
}
