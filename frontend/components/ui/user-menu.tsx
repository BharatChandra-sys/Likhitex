"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClerk, useUser } from "@clerk/nextjs";
import { ChevronDown, LogOut, Settings, User } from "lucide-react";

export function UserMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const { signOut } = useClerk();
  const { user } = useUser();
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
  };

  if (!user) return null;

  const userInitial = user.firstName?.[0] || user.emailAddresses[0]?.emailAddress[0].toUpperCase() || "U";
  const userName = user.firstName && user.lastName 
    ? `${user.firstName} ${user.lastName}`
    : user.firstName || "User";
  const userEmail = user.emailAddresses[0]?.emailAddress || "";

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-surface-container transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center font-semibold text-sm">
          {userInitial}
        </div>
        <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg border border-[#E5E7EB] shadow-lg overflow-hidden z-50">
          {/* User Info Header */}
          <div className="px-4 py-3 border-b border-[#F3F4F6]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center font-semibold">
                {userInitial}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-on-surface truncate">
                  {userName}
                </p>
                <p className="text-xs text-on-surface-variant truncate">
                  {userEmail}
                </p>
              </div>
            </div>
          </div>

          {/* Menu Items */}
          <div className="py-1">
            <button
              onClick={() => {
                setIsOpen(false);
                router.push("/projects");
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container transition-colors"
            >
              <User className="w-4 h-4 text-on-surface-variant" />
              <span>My Projects</span>
            </button>

            <button
              onClick={() => {
                setIsOpen(false);
                // TODO: Add settings page route
                console.log("Settings clicked");
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container transition-colors"
            >
              <Settings className="w-4 h-4 text-on-surface-variant" />
              <span>Account Settings</span>
            </button>

            <div className="border-t border-[#F3F4F6] my-1"></div>

            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-error hover:bg-error/5 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
