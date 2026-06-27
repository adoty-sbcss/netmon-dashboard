"use client";

import Link from "next/link";
import { KeyRound, LogOut, UserRound, DownloadCloud, DatabaseZap, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({
  email,
  role,
}: {
  email: string;
  role: "superadmin" | "user" | "viewer";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account menu">
          <UserRound />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{email}</span>
          <span className="text-xs font-normal text-muted-foreground capitalize">
            {role}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {role === "superadmin" && (
          <>
            <DropdownMenuItem asChild>
              <Link href="/settings/ingestion">
                <DownloadCloud />
                SFTP ingestion
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings/data">
                <DatabaseZap />
                Data management
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings/users">
                <Users />
                Users
              </Link>
            </DropdownMenuItem>
          </>
        )}
        {role !== "viewer" && (
          <DropdownMenuItem asChild>
            <Link href="/account/change-password">
              <KeyRound />
              Change password
            </Link>
          </DropdownMenuItem>
        )}
        {role !== "viewer" && <DropdownMenuSeparator />}
        <DropdownMenuItem asChild variant="destructive">
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="flex w-full items-center gap-2">
              <LogOut />
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
