import type { Metadata } from "next";
import { Lock, Network, ShieldCheck, Sparkles } from "lucide-react";

import { enabledProviders } from "@/lib/auth/oidc";
import { getBranding } from "@/lib/branding";
import { BrandLogo } from "@/components/logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

// Product value props shown on the brand panel — the marketing "why".
const HIGHLIGHTS = [
  { icon: Network, text: "Continuous discovery of every device on your network" },
  { icon: Sparkles, text: "AI-assisted health checks and clear recommendations" },
  { icon: ShieldCheck, text: "Role-based access, scoped to your district" },
] as const;

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
          <div className="rounded-xl bg-white/15 p-2 ring-1 ring-white/20 backdrop-blur-sm">
            {logo}
          </div>
          <span className="font-heading text-lg font-semibold tracking-tight">{b.appName}</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-balance text-4xl font-semibold leading-[1.1] tracking-tight">
            {b.tagline}
          </h1>
          {b.description && (
            <p className="mt-4 text-sm leading-relaxed text-white/80">{b.description}</p>
          )}

          <ul className="mt-8 space-y-3.5">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-white/90">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20">
                  <Icon className="size-3.5 text-[var(--brand-a)]" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative space-y-1">
          <p className="text-xs font-medium text-white/80">
            San Bernardino County Superintendent of Schools
          </p>
          <p className="text-xs text-white/55">
            Authorized use only · Activity is monitored and logged
          </p>
        </div>
      </div>

      {/* Sign-in */}
      <div className="flex flex-1 items-center justify-center bg-muted/40 p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-2 lg:hidden">
            {logo}
            <div className="text-center leading-tight">
              <p className="font-heading text-lg font-semibold">{b.appName}</p>
              <p className="text-xs text-muted-foreground">{b.tagline}</p>
            </div>
          </div>

          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-xl">Sign in</CardTitle>
              <CardDescription className="flex items-center gap-1.5">
                <Lock className="size-3.5" />
                Secure access for authorized staff
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LoginForm providers={providers} errorMessage={errorMessage} />
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Need access? Contact your district administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
