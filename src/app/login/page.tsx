import { Network } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · NetMon Dashboard" };

// Auth state is per-request; never prerender.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/30 p-4">
      <div className="flex items-center gap-2.5">
        <div className="flex aspect-square size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Network className="size-5" />
        </div>
        <div className="leading-tight">
          <p className="font-semibold">NetMon</p>
          <p className="text-xs text-muted-foreground">Network Dashboard</p>
        </div>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
