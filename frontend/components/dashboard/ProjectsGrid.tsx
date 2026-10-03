"use client";

import { useState } from "react";
import Link from "next/link";
import {
  FileCode2,
  Users,
  Loader2,
  MoreVertical,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import type { ProjectResponse } from "@/lib/api/types";
import { formatAbsoluteTime, formatBytes, formatRelativeTime } from "@/lib/format";

interface ProjectsGridProps {
  projects: ProjectResponse[];
  currentUserId: string | null | undefined;
  isRefreshing: boolean;
  pendingIds: ReadonlySet<string>;
  /**
   * Row actions. These mirror the table's so switching view never silently
   * removes the ability to share, rename or delete a project.
   */
  onOpenShare: (project: ProjectResponse) => void;
  onRename: (project: ProjectResponse) => void;
  onDelete: (project: ProjectResponse) => void;
}

/** Card layout over the same data the table renders, for the grid view toggle. */
export default function ProjectsGrid({
  projects,
  currentUserId,
  isRefreshing,
  pendingIds,
  onOpenShare,
  onRename,
  onDelete,
}: ProjectsGridProps) {
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const runAndClose = (action: () => void) => {
    setMenuFor(null);
    action();
  };

  return (
    <div
      className={`grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 transition-opacity ${
        isRefreshing ? "opacity-50" : "opacity-100"
      }`}
    >
      {projects.map((project) => {
        const isOwner = !currentUserId || project.owner_id === currentUserId;
        const isPending = pendingIds.has(project.id);

        return (
          <div
            key={project.id}
            className="bg-surface-container-lowest rounded-xl shadow-sm border border-[#E5E7EB] p-4 hover:shadow-md transition-shadow flex flex-col gap-2 relative"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary-fixed text-primary flex items-center justify-center shrink-0">
                <FileCode2 className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-1.5">
                {isPending && (
                  <Loader2 className="w-3.5 h-3.5 text-outline animate-spin" aria-label="Working" />
                )}
                {!isOwner && (
                  <span className="inline-flex items-center px-1.5 py-0.2 rounded-md bg-secondary-container text-on-secondary-container text-[10px] font-medium">
                    <Users className="w-3 h-3 mr-1" />
                    Shared
                  </span>
                )}

                <div className="relative">
                  <button
                    type="button"
                    title={`Actions for ${project.name}`}
                    aria-haspopup="menu"
                    aria-expanded={menuFor === project.id}
                    onClick={() =>
                      setMenuFor((current) => (current === project.id ? null : project.id))
                    }
                    className="w-6 h-6 rounded flex items-center justify-center text-outline hover:bg-surface-container hover:text-on-surface transition-colors"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>

                  {menuFor === project.id && (
                    <div
                      role="menu"
                      className="absolute right-0 top-7 w-[160px] bg-surface-container-lowest border border-[#E5E7EB] rounded-lg shadow-lg py-1 z-50 text-left"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => runAndClose(() => onOpenShare(project))}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors"
                      >
                        <Share2 className="w-4 h-4" />
                        Share
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => runAndClose(() => onRename(project))}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                        Rename
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => runAndClose(() => onDelete(project))}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-error hover:bg-error/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <Link
              href={`/editor/${project.id}`}
              className="text-sm font-semibold text-primary hover:underline line-clamp-2"
            >
              {project.name}
            </Link>

            {project.description && (
              <p className="text-xs text-on-surface-variant line-clamp-2">
                {project.description}
              </p>
            )}

            <div className="mt-auto pt-2 flex items-center justify-between text-[11px] font-[family-name:var(--font-mono)] text-outline">
              <span title={formatAbsoluteTime(project.updated_at)}>
                {formatRelativeTime(project.updated_at)}
              </span>
              <span>{formatBytes(project.size_bytes)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
