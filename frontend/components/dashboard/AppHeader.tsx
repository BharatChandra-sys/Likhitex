"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useClerk, useUser } from "@clerk/nextjs";
import {
  Search,
  Cloud,
  HelpCircle,
  LogOut,
  Settings,
  User as UserIcon,
} from "lucide-react";
import type { QuotaResponse, UserResponse } from "@/lib/api/types";
import { formatQuotaPair } from "@/lib/format";

interface AppHeaderProps {
  user: UserResponse | null;
  quota: QuotaResponse | null;
  /** Uncontrolled-by-form search value, owned by the dashboard. */
  search: string;
  onSearchChange: (value: string) => void;
  isSearchPending: boolean;
}

/**
 * Fixed top bar: identity search, live storage meter, help, and the account menu.
 *
 * Every value here used to be a literal. The user and quota now come from the
 * API; the account menu is real and signs out through Clerk.
 */
export default function AppHeader({
  user,
  quota,
  search,
  onSearchChange,
  isSearchPending,
}: AppHeaderProps) {
  const { signOut } = useClerk();
  const { user: clerkUser } = useUser();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape: a menu with no dismissal path traps
  // keyboard and mouse users.
  useEffect(() => {
    if (!isMenuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isMenuOpen]);

  // Prefer the API user's full_name, fall back to Clerk's user object which
  // always has the real name from Google/OAuth.
  const clerkFullName = clerkUser?.fullName || 
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ");
  const clerkEmail = clerkUser?.primaryEmailAddress?.emailAddress;

  const name = (user?.full_name && user.full_name.trim())
    ? user.full_name
    : (clerkFullName || user?.email?.split("@")[0] || "User");
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // Use Clerk's real email if the DB still has the placeholder.
  const rawEmail = user?.email || clerkEmail || "—";
  const userEmail = (rawEmail.endsWith("@users.invalid") || rawEmail.endsWith("@example.com"))
    ? (clerkEmail || rawEmail)
    : rawEmail;

  const userId = user?.id || clerkUser?.id || null;
  const usedPercent = quota ? Math.min(100, Math.max(0, quota.percentage_used)) : null;

  return (
    <header className="fixed top-0 left-0 right-0 h-14 z-50 bg-surface-container-lowest border-b border-[#E5E7EB] flex items-center justify-between px-4 select-none">
      <div className="flex items-center gap-3 w-[240px]">
        <Image
          src="/logo.png"
          alt="Likhitex"
          width={140}
          height={40}
          priority
          className="h-8 w-auto"
        />
      </div>

      {/* Center Search */}
      <div className="flex-1 flex justify-center">
        <div className="w-[360px] relative flex items-center">
          <Search className="absolute left-3 w-[18px] h-[18px] text-outline pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search projects..."
            aria-label="Search projects"
            className="w-full h-8 pl-9 pr-14 bg-surface-container-low border border-[#E5E7EB] rounded-lg text-on-surface text-xs placeholder:text-outline focus:outline-none focus:border-primary-container focus:bg-surface-container-lowest transition-colors"
          />
          {isSearchPending ? (
            <span
              className="absolute right-2 text-[11px] font-[family-name:var(--font-mono)] text-outline"
              aria-live="polite"
            >
              …
            </span>
          ) : (
            <span className="absolute right-2 px-1.5 py-0.5 bg-surface-container border border-[#E5E7EB] rounded text-outline text-[11px] font-[family-name:var(--font-mono)] select-none pointer-events-none">
              ⌘K
            </span>
          )}
        </div>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-4 justify-end">
        {/* Storage Meter */}
        <div
          className="hidden sm:flex items-center gap-2 bg-surface-container-low border border-[#E5E7EB] px-3 py-1 rounded-full"
          title={
            quota
              ? `${formatQuotaPair(quota.used_bytes, quota.quota_bytes)} used`
              : "Storage usage unavailable"
          }
        >
          <Cloud className="w-4 h-4 text-outline" />
          {quota ? (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-3 text-[10px] font-medium text-on-surface-variant leading-[14px]">
                <span className="font-[family-name:var(--font-mono)]">
                  {formatQuotaPair(quota.used_bytes, quota.quota_bytes)}
                </span>
                <span className="text-outline font-[family-name:var(--font-mono)]">
                  {Math.round(usedPercent ?? 0)}%
                </span>
              </div>
              <div className="w-24 h-1 bg-surface-container rounded-full overflow-hidden">
                <div
                  className="bg-primary-container h-full"
                  style={{ width: `${usedPercent ?? 0}%` }}
                />
              </div>
            </div>
          ) : (
            <span className="text-[11px] font-[family-name:var(--font-mono)] text-outline">
              quota —
            </span>
          )}
        </div>

        {/* Help Button */}
        <a
          href="#help"
          title="Documentation & Help"
          className="w-8 h-8 flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors"
        >
          <HelpCircle className="w-5 h-5" />
        </a>

        {/* Account Menu */}
        <div className="relative flex items-center gap-2 pl-1" ref={menuRef}>
          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            className="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-surface-container transition-colors"
          >
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-[11px] font-bold text-white">{initials}</span>
              </div>
              <span
                className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-secondary-fixed-dim border-2 border-surface-container-lowest rounded-full"
                title="Signed in"
              />
            </div>
            <div className="hidden lg:flex flex-col text-left">
              <span className="text-sm font-semibold leading-tight text-on-surface">
                {name}
              </span>
              <span className="text-[11px] font-[family-name:var(--font-mono)] text-outline leading-tight">
                {userEmail}
              </span>
            </div>
          </button>

          {isMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-10 w-64 bg-white border border-[#E5E7EB] rounded-lg shadow-lg overflow-hidden z-50"
            >
              {/* User Info Header */}
              <div className="px-4 py-3 border-b border-[#F3F4F6]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center font-semibold">
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-on-surface truncate">
                      {name}
                    </p>
                    <p className="text-xs text-on-surface-variant truncate">
                      {userEmail}
                    </p>
                  </div>
                </div>
              </div>

              {/* Menu Items */}
              <div className="py-1">
                <Link
                  href="/projects"
                  role="menuitem"
                  onClick={() => setIsMenuOpen(false)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container transition-colors"
                >
                  <UserIcon className="w-4 h-4 text-on-surface-variant" />
                  <span>My Projects</span>
                </Link>

                <Link
                  href="/settings"
                  role="menuitem"
                  onClick={() => setIsMenuOpen(false)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container transition-colors"
                >
                  <Settings className="w-4 h-4 text-on-surface-variant" />
                  <span>Account Settings</span>
                </Link>

                <div className="border-t border-[#F3F4F6] my-1"></div>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void signOut({ redirectUrl: "/" })}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-error hover:bg-error/5 transition-colors text-left"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}