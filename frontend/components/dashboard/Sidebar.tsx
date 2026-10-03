"use client";

import { Plus, ChevronDown, Folder, User, Users, Tag, LayoutGrid } from "lucide-react";
import type { ProjectResponse } from "@/lib/api/types";
import { formatBytes } from "@/lib/format";

export type ProjectBucket = "all" | "owned" | "shared";

interface SidebarProps {
  activeBucket: ProjectBucket;
  onBucketChange: (bucket: ProjectBucket) => void;
  projects: ProjectResponse[];
  ownedCount: number;
  sharedCount: number;
  totalCount: number;
  usedBytes: number | null;
  quotaBytes: number | null;
  onCreateClick: () => void;
  onTemplatesClick: () => void;
  /**
   * The "New Project" button. Owned by the page so the same ref can be handed to
   * NewProjectMenu, which measures it to dock the menu directly underneath.
   */
  newButtonRef: React.RefObject<HTMLButtonElement | null>;
}

interface NavItemProps {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick?: () => void;
}

function NavItem({ active, icon, label, count, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-sm transition-colors text-left ${
        active
          ? "bg-primary-fixed text-on-primary-fixed-variant font-medium"
          : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
      }`}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      {count !== undefined && (
        <span className="text-[11px] font-[family-name:var(--font-mono)] px-1.5 py-0.2 bg-surface-container-low rounded text-on-surface-variant">
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * Left rail: new-project action, the three project buckets, and a storage summary.
 *
 * Counts come from the loaded page, not a server total, because the API exposes
 * a single list endpoint with no per-bucket filter. They are therefore marked
 * page-local in the footer rather than presented as workspace totals.
 */
export default function Sidebar({
  activeBucket,
  onBucketChange,
  projects,
  ownedCount,
  sharedCount,
  totalCount,
  usedBytes,
  quotaBytes,
  onCreateClick,
  onTemplatesClick,
  newButtonRef,
}: SidebarProps) {
  return (
    <aside className="fixed left-0 top-14 bottom-0 w-[240px] bg-surface-container-lowest border-r border-[#E5E7EB] z-40 flex flex-col justify-between p-3">
      <div className="flex flex-col overflow-y-auto">
        {/* New Project Button */}
        <div className="mb-4">
          <div className="inline-flex w-full rounded-lg shadow-sm">
            <button
              ref={newButtonRef}
              type="button"
              onClick={onCreateClick}
              className="flex-1 h-8 bg-primary-container text-on-primary hover:bg-primary text-sm font-semibold rounded-l-lg flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus className="w-[18px] h-[18px]" />
              New Project
            </button>
            <button
              type="button"
              title="Project templates"
              aria-label="More ways to create a project"
              onClick={onTemplatesClick}
              className="w-8 h-8 bg-primary-container text-on-primary hover:bg-primary border-l border-white/20 rounded-r-lg flex items-center justify-center transition-colors"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex flex-col gap-0.5">
          <NavItem
            active={activeBucket === "all"}
            icon={<Folder className="w-[18px] h-[18px]" />}
            label="All Projects"
            count={totalCount}
            onClick={() => onBucketChange("all")}
          />
          <NavItem
            active={activeBucket === "owned"}
            icon={<User className="w-[18px] h-[18px]" />}
            label="Your Projects"
            count={ownedCount}
            onClick={() => onBucketChange("owned")}
          />
          <NavItem
            active={activeBucket === "shared"}
            icon={<Users className="w-[18px] h-[18px]" />}
            label="Shared with you"
            count={sharedCount}
            onClick={() => onBucketChange("shared")}
          />
        </nav>

        <div className="mt-4 pt-4 border-t border-[#F3F4F6]">
          <div className="px-3 mb-1.5 text-[11px] font-[family-name:var(--font-mono)] uppercase tracking-wide text-outline">
            Organize
          </div>
          <nav className="flex flex-col gap-0.5">
            {/*
              Tags have no backend representation yet -- there is no tag field on
              Project and no tag endpoint -- so this row is disabled rather than
              shown as a control that silently does nothing.
            */}
            <div
              title="Tags are not available yet"
              aria-disabled="true"
              className="flex items-center justify-between px-3 py-1.5 rounded-lg text-sm text-outline cursor-not-allowed"
            >
              <span className="flex items-center gap-2">
                <Tag className="w-[18px] h-[18px]" />
                Tags
              </span>
              <span className="text-[10px] font-[family-name:var(--font-mono)]">soon</span>
            </div>
            <NavItem
              active={false}
              icon={<LayoutGrid className="w-[18px] h-[18px]" />}
              label="Templates"
              onClick={onTemplatesClick}
            />
          </nav>
        </div>
      </div>

      {/* Storage Summary */}
      <div className="mt-3 pt-3 border-t border-[#F3F4F6]">
        <div className="px-3 text-[11px] font-[family-name:var(--font-mono)] text-outline leading-tight">
          {usedBytes !== null && quotaBytes !== null ? (
            <>
              <div>
                {formatBytes(usedBytes)} of {formatBytes(quotaBytes)} used
              </div>
              <div className="mt-1 text-outline">
                {projects.length} loaded
              </div>
            </>
          ) : (
            <div>storage —</div>
          )}
        </div>
      </div>
    </aside>
  );
}
