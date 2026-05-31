"use client";

import { useActionState } from "react";

import { loginAction, type ActionState } from "@/lib/auth/actions";
import type { Provider } from "@/lib/auth/oidc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleIcon, MicrosoftIcon } from "@/components/provider-icons";

const PROVIDER_LABEL: Record<Provider, string> = {
  google: "Sign in with Google",
  microsoft: "Sign in with Microsoft",
};

export function LoginForm({
  providers,
  errorMessage,
}: {
  providers: Provider[];
  errorMessage?: string | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    loginAction,
    {},
  );

  return (
    <div className="flex flex-col gap-4">
      {errorMessage && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}

      {/* Federated sign-in (Google / Microsoft) — official brand buttons. */}
      {providers.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {providers.map((p) => (
            <a
              key={p}
              href={`/api/auth/oidc/${p}`}
              className="flex h-11 items-center justify-center gap-3 rounded-md border border-[#dadce0] bg-white px-4 text-sm font-medium text-[#3c4043] shadow-sm transition-colors hover:bg-[#f8f9fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {p === "google" ? (
                <GoogleIcon className="size-5" />
              ) : (
                <MicrosoftIcon className="size-5" />
              )}
              {PROVIDER_LABEL[p]}
            </a>
          ))}
          <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or sign in with a local account
            <span className="h-px flex-1 bg-border" />
          </div>
        </div>
      )}

      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="identifier" className="text-sm font-medium">
            Username
          </label>
          <Input
            id="identifier"
            name="identifier"
            autoComplete="username"
            required
            placeholder="username"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        {state.error && (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        )}

        <Button type="submit" disabled={pending} className="mt-1">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {providers.length === 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Federated sign-in (Microsoft / Google) isn&apos;t configured yet.
        </p>
      )}
    </div>
  );
}
