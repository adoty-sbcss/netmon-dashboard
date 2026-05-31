import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";

import { getSessionUser } from "@/lib/auth/current-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "Change password · NetMon Dashboard" };
export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="size-4 text-primary" />
            {user.mustChangePassword ? "Set a new password" : "Change password"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {user.mustChangePassword && (
            <p className="text-sm text-muted-foreground">
              You&apos;re signed in as{" "}
              <span className="font-medium text-foreground">{user.email}</span>.
              Before continuing, replace the default password.
            </p>
          )}
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
