"use client";

import { useActionState, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  KeyRound,
  Pencil,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";

import {
  addUserAction,
  updateUserAction,
  setUserDisabledAction,
  deleteUserAction,
  setUserPasswordAction,
  type UserActionState,
} from "@/lib/admin/user-actions";
import type { ManagedUser } from "@/db/queries";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/section-header";

type District = { id: number; name: string };
type Role = "user" | "superadmin" | "viewer";

/** Read-only viewer scope toggle + (when not global) the district picker. */
function ViewerScope({
  districts,
  selected,
  global,
  onGlobalChange,
}: {
  districts: District[];
  selected?: Set<number>;
  global: boolean;
  onGlobalChange: (v: boolean) => void;
}) {
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="globalScope"
          value="true"
          checked={global}
          onChange={(e) => onGlobalChange(e.target.checked)}
          className="size-4 rounded border-input accent-primary"
        />
        All districts (read everything)
      </label>
      {!global && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">District access (read-only)</label>
          <DistrictPicker districts={districts} selected={selected} />
        </div>
      )}
    </>
  );
}

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
  localUserIds,
}: {
  users: ManagedUser[];
  districts: District[];
  currentUserId: number;
  /** Ids of users that have a local-login password set. */
  localUserIds: number[];
}) {
  const localSet = new Set(localUserIds);
  const [addRole, setAddRole] = useState<Role>("user");
  const [addGlobal, setAddGlobal] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const [editRole, setEditRole] = useState<Role>("user");
  const [editGlobal, setEditGlobal] = useState(true);

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
  const [pwState, pwAction, pwPending] = useActionState<UserActionState, FormData>(
    setUserPasswordAction,
    {},
  );

  const labelCls = "text-sm font-medium";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {/* Add user */}
      <Card>
        <SectionHeader icon={UserPlus} title="Add a user" />
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
                onChange={(e) => setAddRole(e.target.value as Role)}
                className="h-8 w-full max-w-xs rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                <option value="user">User — only assigned districts</option>
                <option value="viewer">Viewer — read-only</option>
                <option value="superadmin">Superadmin — full access</option>
              </select>
            </div>
            {addRole === "user" && (
              <div className="flex flex-col gap-1.5">
                <label className={labelCls}>District access</label>
                <DistrictPicker districts={districts} />
              </div>
            )}
            {addRole === "viewer" && (
              <ViewerScope districts={districts} global={addGlobal} onGlobalChange={setAddGlobal} />
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className={labelCls}>
                Temporary password <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="Leave blank for Google/Microsoft sign-in only"
                className="max-w-sm"
              />
              <p className="text-xs text-muted-foreground">
                Set one to create a local-login account (email + password). Min 12
                characters; they&apos;ll be required to change it at first sign-in.
              </p>
            </div>
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
        <SectionHeader icon={Users} title="Users" meta={users.length} />
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
                      ) : u.role === "viewer" ? (
                        <Badge variant="outline" className="gap-1 border-[var(--warning)]/40 text-[var(--warning)]">
                          <Eye className="size-3" /> Viewer
                        </Badge>
                      ) : (
                        <Badge variant="secondary">User</Badge>
                      )}
                      {locked && <Badge variant="outline">break-glass</Badge>}
                      {localSet.has(u.id) && (
                        <Badge variant="outline" className="gap-1">
                          <KeyRound className="size-3" /> local login
                        </Badge>
                      )}
                      {u.disabled && <Badge variant="outline" className="border-destructive text-destructive">disabled</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {u.role === "superadmin" ? (
                        <span>all districts</span>
                      ) : u.role === "viewer" && u.districts.length === 0 ? (
                        <span>all districts · read-only</span>
                      ) : u.districts.length === 0 ? (
                        <span className="text-[var(--warning)]">no district access</span>
                      ) : (
                        u.districts.map((d) => (
                          <Badge key={d.id} variant="outline" className="text-[10px] font-normal">
                            {d.name}
                          </Badge>
                        ))
                      )}
                      {/* relativeTime() is Date.now()-based; in this client component the
                          server-rendered text and the hydration text differ by a few seconds,
                          which tripped React hydration error #418 (and forced a client re-render).
                          The timestamp legitimately differs, so flag it as an intentional mismatch. */}
                      <span suppressHydrationWarning>· {u.lastLoginAt ? `last in ${relativeTime(u.lastLoginAt)}` : "never signed in"}</span>
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
                          // A viewer with no district grants is global-scoped.
                          setEditGlobal(u.districts.length === 0);
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
                  <>
                  <form action={editAction} className="mt-3 flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
                    <input type="hidden" name="userId" value={u.id} />
                    <div className="flex flex-col gap-1.5">
                      <label className={labelCls}>Role</label>
                      <select
                        name="role"
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value as Role)}
                        className="h-8 w-full max-w-xs rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                      >
                        <option value="user">User — only assigned districts</option>
                        <option value="viewer">Viewer — read-only</option>
                        <option value="superadmin">Superadmin — full access</option>
                      </select>
                    </div>
                    {editRole === "user" && (
                      <div className="flex flex-col gap-1.5">
                        <label className={labelCls}>District access</label>
                        <DistrictPicker districts={districts} selected={new Set(u.districts.map((d) => d.id))} />
                      </div>
                    )}
                    {editRole === "viewer" && (
                      <ViewerScope
                        districts={districts}
                        selected={new Set(u.districts.map((d) => d.id))}
                        global={editGlobal}
                        onGlobalChange={setEditGlobal}
                      />
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
                  <form action={pwAction} className="mt-2 flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
                    <input type="hidden" name="userId" value={u.id} />
                    <label className={labelCls}>Local password</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        placeholder={localSet.has(u.id) ? "New password (min 12)" : "Set password (min 12)"}
                        className="max-w-xs"
                      />
                      <Button type="submit" size="sm" variant="outline" disabled={pwPending}>
                        <KeyRound className="size-3.5" /> {localSet.has(u.id) ? "Reset" : "Set password"}
                      </Button>
                      {localSet.has(u.id) && (
                        <Button
                          type="submit"
                          name="clear"
                          value="true"
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                        >
                          Remove local login
                        </Button>
                      )}
                    </div>
                    <Notice state={pwState} />
                  </form>
                  </>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
