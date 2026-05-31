"use client";

import { useActionState } from "react";

import {
  changePasswordAction,
  type ActionState,
} from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    changePasswordAction,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="current" className="text-sm font-medium">
          Current password
        </label>
        <Input
          id="current"
          name="current"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="next" className="text-sm font-medium">
          New password
        </label>
        <Input
          id="next"
          name="next"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
        />
        <p className="text-xs text-muted-foreground">
          At least 12 characters; must differ from the default.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm" className="text-sm font-medium">
          Confirm new password
        </label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
        />
      </div>

      {state.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
