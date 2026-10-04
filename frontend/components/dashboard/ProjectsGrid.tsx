"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  FileCode2,
  Users,
  Loader2,
  MoreVertical,
  Pencil,
  Share2,
  Trash2,
  Check,
  X,
} from "lucide-react";
import type { ProjectResponse } from "@/lib/api/types";
import { formatAbsoluteTime, formatBytes, formatRelativeTime } from "@/lib/format";

interface ProjectsGridProps {
  projects: ProjectResponse[];
  currentUserId: string | null | undefined;
  isRefreshing: boolean;
  pendingIds: ReadonlySet<string>;
  onOpenShare: (project: ProjectResponse) => void;
  onRename: (project: ProjectResponse, newName: string) => void;
  onDelete: (project: ProjectResponse) => void;
}

/** Inline rename input for grid cards. */
function RenameInput({
  initialValue,
  onConfirm,
  onCancel,
}: {
  initialValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initialValue) onConfirm(trimmed);
    else onCancel();
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex items-center gap-1">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        className="text-sm font-semibold text-on-surface bg-surface-container-low border border-primary rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-primary w-full"
        maxLength={100}
      />
      <button type="submit" title="Confirm" className="w-6 h-6 rounded flex items-center justify-center text-secondary hover:bg-secondary/10 shrink-0">
        <Check className="w-3.5 h-3.5" />
      </button>
      <button type="button" title="Cancel" onClick={onCancel} className="w-6 h-6 rounded flex items-center justify-center text-outline hover:bg-surface-container shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </form>
  );
}

/** Fixed-position actions menu — escapes any overflow:hidden parent. */
function CardActionsMenu({
  project,
  anchorRef,
  onClose,
  onShare,
  onRename,
  onDelete,
}: {
  project: ProjectResponse;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onShare: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    const btn = anchorRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, [anchorRef]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose, anchorRef]);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999 }}
      className="w-44 bg-white border border-[#E5E7EB] rounded-lg shadow-xl py-1 text-left"
    >
      <button
        type="button" role="menuitem"
        onClick={() => { onClose(); onShare(); }}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors"
      >
        <Share2 className="w-4 h-4" /> Share
      </button>
      <button
        type="button" role="menuitem"
        onClick={() => { onClose(); onRename(); }}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors"
      >
        <Pencil className="w-4 h-4" /> Rename
      </button>
      <div className="border-t border-[#F3F4F6] my-1" />
      <button
        type="button" role="menuitem"
        onClick={() => { onClose(); onDelete(); }}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors"
      >
        <Trash2 className="w-4 h-4" /> Delete
      </button>
    </div>
  );
}

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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const btnRefs = useRef<Map<string, React.RefObject<HTMLButtonElement | null>>>(new Map());

  const getBtnRef = (id: string) => {
    if (!btnRefs.current.has(id)) btnRefs.current.set(id, { current: null });
    return btnRefs.current.get(id)!;
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
        const isRenaming = renamingId === project.id;
        const btnRef = getBtnRef(project.id);

        return (
          <div
            key={project.id}
            className="bg-surface-container-lowest rounded-xl shadow-sm border border-[#E5E7EB] p-4 hover:shadow-md transition-shadow flex flex-col gap-2"
          >
            {/* Card header */}
            <div className="flex items-start justify-between gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary-fixed text-primary flex items-center justify-center shrink-0">
                <FileCode2 className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-1.5">
                {isPending && (
                  <Loader2 className="w-3.5 h-3.5 text-outline animate-spin" aria-label="Working" />
                )}
                {!isOwner && (
                  <span className="inline-flex items-center px-1.5 rounded-md bg-secondary-container text-on-secondary-container text-[10px] font-medium">
                    <Users className="w-3 h-3 mr-1" /> Shared
                  </span>
                )}
                {/* Three-dot trigger */}
                <button
                  ref={btnRef as React.RefObject<HTMLButtonElement>}
                  type="button"
                  title="More options"
                  aria-haspopup="menu"
                  aria-expanded={menuFor === project.id}
                  onClick={() => setMenuFor((cur) => (cur === project.id ? null : project.id))}
                  className="w-6 h-6 rounded flex items-center justify-center text-outline hover:bg-surface-container hover:text-on-surface transition-colors"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {/* Fixed-position popup */}
                {menuFor === project.id && (
                  <CardActionsMenu
                    project={project}
                    anchorRef={btnRef}
                    onClose={() => setMenuFor(null)}
                    onShare={() => onOpenShare(project)}
                    onRename={() => setRenamingId(project.id)}
                    onDelete={() => onDelete(project)}
                  />
                )}
              </div>
            </div>

            {/* Title / rename */}
            {isRenaming ? (
              <RenameInput
                initialValue={project.name}
                onConfirm={(newName) => { setRenamingId(null); onRename(project, newName); }}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <Link
                href={`/editor/${project.id}`}
                className="text-sm font-semibold text-primary hover:underline line-clamp-2"
              >
                {project.name}
              </Link>
            )}

            {project.description && !isRenaming && (
              <p className="text-xs text-on-surface-variant line-clamp-2">
                {project.description}
              </p>
            )}

            {/* Footer metadata */}
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
