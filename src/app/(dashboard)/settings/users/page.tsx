import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/current-user";
import { listUsersWithGrants, listDistrictOptions } from "@/db/queries";
import { PageHeader } from "@/components/page-header";
import { UsersAdmin } from "./users-admin";

export const metadata = { title: "Users · NetMon Dashboard" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await getSessionUser();
  if (!me) redirect("/login");
  if (me.role !== "superadmin") redirect("/");

  const [users, districts] = await Promise.all([
    listUsersWithGrants(),
    listDistrictOptions(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        description="Grant access by email. Whoever signs in with Google or Microsoft using a listed email gets in — superadmins see everything, others see only their districts."
      />
      <UsersAdmin users={users} districts={districts} currentUserId={me.id} />
    </div>
  );
}
