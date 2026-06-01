import { redirect } from "next/navigation";
import { isNotNull } from "drizzle-orm";

import { getSessionUser } from "@/lib/auth/current-user";
import { listUsersWithGrants, listDistrictOptions } from "@/db/queries";
import { db } from "@/db";
import { users as usersTable } from "@/db/schema/app";
import { PageHeader } from "@/components/page-header";
import { UsersAdmin } from "./users-admin";

export const metadata = { title: "Users · NetMon Dashboard" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await getSessionUser();
  if (!me) redirect("/login");
  if (me.role !== "superadmin") redirect("/");

  const [users, districts, localRows] = await Promise.all([
    listUsersWithGrants(),
    listDistrictOptions(),
    // Which users have a local-login password set (vs OIDC-only).
    db.select({ id: usersTable.id }).from(usersTable).where(isNotNull(usersTable.passwordHash)),
  ]);
  const localUserIds = localRows.map((r) => r.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        description="Grant access by email. Users sign in with Google/Microsoft, or with a local password you set here — superadmins see everything, others see only their districts."
      />
      <UsersAdmin
        users={users}
        districts={districts}
        currentUserId={me.id}
        localUserIds={localUserIds}
      />
    </div>
  );
}
