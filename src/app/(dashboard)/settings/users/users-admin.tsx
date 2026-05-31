"use client";

import { useActionState, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Pencil,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";

import {
  addUserAction,
  updateUserAction,
  setUserDisabledAction,
  deleteUserAction,
  type UserActionState,
} from "@/lib/admin/user-actions";
import type { ManagedUser } from "@/db/queries";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type District = { id: number; name: string };

function Notice({ state }: { state: UserActionState }) {
  if (state.error)
    return (
      <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
        <AlertCircle className="size-4 shrink-0" />
        {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-4 shrink-0" />
        {state.message}
      </p>
    );
  return null;
}

function DistrictPicker({
  districts,
  selected,
}: {
  districts: District[];
  selected?: Set<number>;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-input p-3">
      {districts.length === 0 && (
        <span className="text-xs text-muted-foreground">No districts yet.</span>
      )}
      {districts.map((d) => (
        <label key={d.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="districtIds"
            value={d.id}
            defaultChecked={selected?.has(d.id)}
            className="size-4 rounded border-input accent-primary"
          />
          {d.name}
        </label>
      ))}
    </div>
  );
}

export function UsersAdmin({
  users,
  districts,
  currentUserId,
}: {
  users: ManagedUser[];
  districts: District[];
  currentUserId: number;
}) {
  const [addRole, setAddRole] = useState<"user" | "superadmin">("user");
  const [editing, setEditing] = useState<number | null>(null);
  const [editRole, setEditRole] = useState<"user" | "superadmin">("user");

  const [addState, addAction, adding] = useActionState<UserActionState, FormData>(
    addUserAction,
    {},
  );
  const [editState, editAction, editingPending] = useActionState<UserActionState, FormData>(
    updateUserAction,
    {},
  );
  const [disState, disAction] = useActionState<UserActionState, FormData>(
    setUserDisabledAction,
    {},
  );
  const [delState, delAction] = useActionState<UserActionState, FormData>(
    deleteUserAction,
    {},
  );

  const labelCls = "text-sm font-medium";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {/* Add user */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-4 text-primary" />
            Add a user
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={addAction} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="email" className={labelCls}>Email</label>
                <Input id="email" name="email" type="email" placeholder="person@sbcss.net" autoComplete="off" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="displayName" className={labelCls}>Name (optional)</label>
                <Input id="displayName" name="displayName" placeholder="Jane Doe" autoComplete="off" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="role" className={labelCls}>Role</label>
              <select
                id="role"
                name="role"
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as "user" | "superadmin")}
                className="h-8 w-full max-w-xs rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                <option value="user">User — only assigned districts</option>
                <option value="superadmin">Superadmin — full access</option>
              </select>
            </div>
            {addRole === "user" && (
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>District access</label>
                <DistrictPicker districts={districts} />
              </div>
            )}
            <Notice state={addState} />
            <div>
              <Button type="submit" disabled={adding}>
                {adding ? "Adding…" : "Add user"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Existing users */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Users
            <span className="ml-2 text-sm font-normal text-muted-foreground">{users.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Notice state={disState} />
          <Notice state={delState} />
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            const locked = u.isBreakGlass;
            const isEditing = editing === u.id;
            return (
              <div key={u.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{u.email}</span>
                      {u.role === "superadmin" ? (
                        <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
                          <ShieldCheck className="size-3" /> Superadmin
                        </Badge>
                      ) : (
                        <Badge variant="secondary">User</Badge>
                      )}
                      {locked && <Badge variant="outline">break-glass</Badge>}
                      {u.disabled && <Badge variant="outline" className="border-destructive text-destructive">disabled</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {u.role === "superadmin" ? (
                        <span>all districts</span>
                      ) : u.districts.length === 0 ? (
                        <span className="text-[var(--warning)]">no district access</span>
                      ) : (
                        u.districts.map((d) => (
                          <Badge key={d.id} variant="outline" className="text-[10px] font-normal">
                            {d.name}
                          </Badge>
                        ))
                      )}
                      <span>· {u.lastLoginAt ? `last in ${relativeTime(u.lastLoginAt)}` : "never signed in"}</span>
                    </div>
                  </div>
                  {!locked && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          setEditing((c) => (c === u.id ? null : u.id));
                          setEditRole(u.role);
                        }}
                      >
                        <Pencil className="size-3.5" /> Edit
                      </Button>
                      {!isSelf && (
                        <form action={disAction}>
                          <input type="hidden" name="userId" value={u.id} />
                          <input type="hidden" name="disabled" value={u.disabled ? "false" : "true"} />
                          <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs">
                            {u.disabled ? "Enable" : "Disable"}
                          </Button>
                        </form>
                      )}
                      {!isSelf && (
                        <form action={delAction}>
                          <input type="hidden" name="userId" value={u.id} />
                          <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive hover:text-destructive">
                            <Trash2 className="size-3.5" /> Remove
                          </Button>
                        </form>
                      )}
                    </div>
                  )}
                </div>

                {isEditing && !locked && (
                  <form action={editAction} className="mt-3 flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
                    <input type="hidden" name="userId" value={u.id} />
                    <div className="flex flex-col gap-1.5">
                      <label className={labelCls}>Role</label>
                      <select
                        name="role"
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value as "user" | "superadmin")}
                        className="h-8 w-full max-w-xs rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                      >
                        <option value="user">User — only assigned districts</option>
                        <option value="superadmin">Superadmin — full access</option>
                      </select>
                    </div>
                    {editRole === "user" && (
                      <div className="flex flex-col gap-1.5">
                        <label className={labelCls}>District access</label>
                        <DistrictPicker districts={districts} selected={new Set(u.districts.map((d) => d.id))} />
                      </div>
                    )}
                    <Notice state={editState} />
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={editingPending}>
                        {editingPending ? "Saving…" : "Save changes"}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
