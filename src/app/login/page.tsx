import { Network } from "lucide-react";

import { enabledProviders } from "@/lib/auth/oidc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · NetMon Dashboard" };

// Auth state is per-request; never prerender.
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  denied: "That account isn't authorized. Ask an administrator to add your email.",
  oidc: "Sign-in with that provider failed. Please try again.",
  state: "Your sign-in session expired. Please try again.",
  provider: "That sign-in method isn't available.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const providers = enabledProviders();
  const errorMessage = error ? (ERRORS[error] ?? "Sign-in failed. Please try again.") : null;

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
          <LoginForm providers={providers} errorMessage={errorMessage} />
        </CardContent>
      </Card>
    </div>
  );
}
