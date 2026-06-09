import type { Metadata } from "next";

import { enabledProviders } from "@/lib/auth/oidc";
import { getBranding } from "@/lib/branding";
import { BrandLogo } from "@/components/logo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  return { title: `Sign in · ${b.appName}` };
}

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
  const b = await getBranding();

  const logo = b.hasLogo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/branding/logo?v=${b.version}`} alt={b.appName} className="size-12 object-contain" />
  ) : (
    <BrandLogo className="size-12" />
  );

  return (
    <div className="flex min-h-svh">
      {/* Branded panel — SBCSS blue gradient with a soft gold accent. */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-[var(--brand-b)] via-primary to-[oklch(0.32_0.13_265)] p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-20 size-96 rounded-full bg-[var(--brand-a)]/25 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <div className="rounded-xl bg-white/15 p-2 backdrop-blur-sm">{logo}</div>
          <span className="text-lg font-semibold tracking-tight">{b.appName}</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">{b.tagline}</h1>
          {b.description && (
            <p className="mt-3 text-sm leading-relaxed text-white/80">{b.description}</p>
          )}
        </div>

        <p className="relative text-xs text-white/60">
          San Bernardino County Superintendent of Schools
        </p>
      </div>

      {/* Sign-in */}
      <div className="flex flex-1 items-center justify-center bg-muted/40 p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-2 lg:hidden">
            {logo}
            <div className="text-center leading-tight">
              <p className="text-lg font-semibold">{b.appName}</p>
              <p className="text-xs text-muted-foreground">{b.tagline}</p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Sign in</CardTitle>
            </CardHeader>
            <CardContent>
              <LoginForm providers={providers} errorMessage={errorMessage} />
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            {b.appName} · secure access for authorized staff
          </p>
        </div>
      </div>
    </div>
  );
}
