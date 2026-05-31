"use client";

import { useActionState } from "react";

import { loginAction, type ActionState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    loginAction,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="identifier" className="text-sm font-medium">
          Username
        </label>
        <Input
          id="identifier"
          name="identifier"
          autoComplete="username"
          autoFocus
          required
          placeholder="adaministrator"
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

      <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" disabled title="Coming soon">
          Continue with Microsoft
        </Button>
        <Button type="button" variant="outline" disabled title="Coming soon">
          Continue with Google
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Federated sign-in (Microsoft 365 / Google) is coming soon.
      </p>
    </form>
  );
}
