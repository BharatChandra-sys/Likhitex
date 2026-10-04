"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  FileCode2,
  FolderArchive,
  Copy,
  MoreVertical,
  Users,
  Pencil,
  Trash2,
  Share2,
  Loader2,
  Check,
  X,
} from "lucide-react";
import type { ProjectResponse } from "@/lib/api/types";
import { formatAbsoluteTime, formatBytes, formatRelativeTime } from "@/lib/format";

type SortKey = "updated_at" | "name" | "size_bytes";
type SortDirection = "asc" | "desc";

export type ViewMode = "list" | "grid";

interface ProjectsTableProps {
  projects: ProjectResponse[];
  currentUserId: string | null | undefined;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSortChange: (key: SortKey) => void;
  isRefreshing: boolean;
  onOpenShare: (project: ProjectResponse) => void;
  onRename: (project: ProjectResponse, newName: string) => void;
  onDuplicate?: (project: ProjectResponse) => void;
  onDownload?: (project: ProjectResponse) => void;
  onDelete: (project: ProjectResponse) => void;
  pendingIds: ReadonlySet<string>;
}

/** Inline rename input rendered directly in the title cell. */
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
    if (trimmed && trimmed !== initialValue) {
      onConfirm(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="flex items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        className="text-sm font-semibold text-on-surface bg-surface-container-low border border-primary rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-primary min-w-0 w-48"
        maxLength={100}
      />
      <button
        type="submit"
        title="Confirm rename"
        className="w-6 h-6 rounded flex items-center justify-center text-secondary hover:bg-secondary/10 transition-colors"
      >
        <Check className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        title="Cancel"
        onClick={onCancel}
        className="w-6 h-6 rounded flex items-center justify-center text-outline hover:bg-surface-container transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </form>
  );
}

/** Fixed-position dropdown that escapes the table overflow container. */
function ActionsMenu({
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

  // Position relative to the trigger button using getBoundingClientRect
  useEffect(() => {
    const btn = anchorRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, [anchorRef]);

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
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
      <MenuItem
        icon={<Share2 className="w-4 h-4" />}
        label="Share"
        onClick={() => { onClose(); onShare(); }}
      />
      <MenuItem
        icon={<Pencil className="w-4 h-4" />}
        label="Rename"
        onClick={() => { onClose(); onRename(); }}
      />
      <div className="border-t border-[#F3F4F6] my-1" />
      <MenuItem
        icon={<Trash2 className="w-4 h-4" />}
        label="Delete"
        danger
        onClick={() => { onClose(); onDelete(); }}
      />
    </div>
  );
}

export default function ProjectsTable({
  projects,
  currentUserId,
  sortKey,
  sortDirection,
  onSortChange,
  isRefreshing,
  onOpenShare,
  onRename,
  onDuplicate,
  onDownload,
  onDelete,
  pendingIds,
}: ProjectsTableProps) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // Map of project id → button ref, for menu positioning
  const btnRefs = useRef<Map<string, React.RefObject<HTMLButtonElement | null>>>(new Map());

  const getBtnRef = (id: string) => {
    if (!btnRefs.current.has(id)) {
      btnRefs.current.set(id, { current: null });
    }
    return btnRefs.current.get(id)!;
  };

  const arrowFor = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="w-3.5 h-3.5 text-outline opacity-0 group-hover:opacity-100" />;
    return sortDirection === "asc" ? (
      <ArrowUp className="w-3.5 h-3.5 text-primary" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-primary" />
    );
  };

  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-low text-on-surface-variant text-xs font-medium select-none">
              <th className="py-2.5 px-3 font-medium min-w-[280px]" scope="col">
                <button
                  type="button"
                  onClick={() => onSortChange("name")}
                  className="group flex items-center gap-1 text-left hover:text-on-surface"
                >
                  <span>Document Title</span>
                  {arrowFor("name")}
                </button>
              </th>
              <th className="py-2.5 px-3 font-medium min-w-[140px]" scope="col">
                Compilation Status
              </th>
              <th className="py-2.5 px-3 font-medium min-w-[120px]" scope="col">
                Owner
              </th>
              <th className="py-2.5 px-3 font-medium min-w-[150px]" scope="col">
                <button
                  type="button"
                  onClick={() => onSortChange("updated_at")}
                  className="group flex items-center gap-1 text-left hover:text-on-surface"
                >
                  <span>Last Modified</span>
                  {arrowFor("updated_at")}
                </button>
              </th>
              <th className="py-2.5 px-3 font-medium min-w-[100px]" scope="col">
                <button
                  type="button"
                  onClick={() => onSortChange("size_bytes")}
                  className="group flex items-center gap-1 text-left hover:text-on-surface"
                >
                  <span>Size</span>
                  {arrowFor("size_bytes")}
                </button>
              </th>
              <th className="py-2.5 px-3 text-right pr-4 font-medium w-32" scope="col">
                Actions
              </th>
            </tr>
          </thead>

          <tbody
            className={`divide-y divide-surface-container text-sm text-on-surface transition-opacity ${
              isRefreshing ? "opacity-50" : "opacity-100"
            }`}
          >
            {projects.map((project) => {
              const isOwner = !currentUserId || project.owner_id === currentUserId;
              const isPending = pendingIds.has(project.id);
              const hasCompiled = project.last_compiled_at !== null;
              const isRenaming = renamingId === project.id;
              const btnRef = getBtnRef(project.id);

              return (
                <tr key={project.id} className="hover:bg-primary-fixed/20 transition-colors group">
                  {/* Title cell */}
                  <td className="py-2.5 px-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-primary-fixed text-primary flex items-center justify-center shrink-0 mt-0.5">
                        <FileCode2 className="w-[18px] h-[18px]" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                          {isRenaming ? (
                            <RenameInput
                              initialValue={project.name}
                              onConfirm={(newName) => {
                                setRenamingId(null);
                                onRename(project, newName);
                              }}
                              onCancel={() => setRenamingId(null)}
                            />
                          ) : (
                            <Link
                              href={`/editor/${project.id}`}
                              className="text-sm font-semibold text-primary hover:underline truncate"
                            >
                              {project.name}
                            </Link>
                          )}
                          {!isOwner && (
                            <span className="inline-flex items-center px-1.5 py-0.2 rounded-md bg-secondary-container text-on-secondary-container text-[10px] font-medium leading-[14px] shrink-0">
                              <Users className="w-3 h-3 mr-1" />
                              Shared
                            </span>
                          )}
                          {isPending && (
                            <Loader2
                              className="w-3.5 h-3.5 text-outline animate-spin shrink-0"
                              aria-label="Working"
                            />
                          )}
                        </div>
                        {project.description && !isRenaming && (
                          <span className="text-[11px] font-[family-name:var(--font-mono)] text-outline truncate mt-1">
                            {project.description}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Compilation status */}
                  <td className="py-2.5 px-3">
                    {hasCompiled ? (
                      <div
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-secondary-container/60 text-on-secondary-container text-[11px] font-[family-name:var(--font-mono)]"
                        title={formatAbsoluteTime(project.last_compiled_at)}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
                        <span>compiled</span>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-surface-container-high text-on-surface-variant text-[11px] font-[family-name:var(--font-mono)]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
                        <span>Draft</span>
                      </div>
                    )}
                  </td>

                  {/* Owner */}
                  <td className="py-2.5 px-3">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-container text-[11px] font-[family-name:var(--font-mono)] text-on-surface">
                      <span className="w-4 h-4 rounded-full bg-primary text-white text-[9px] flex items-center justify-center font-bold">
                        {isOwner ? "YOU" : "··"}
                      </span>
                      <span>{isOwner ? "You" : "Co-author"}</span>
                    </span>
                  </td>

                  {/* Last modified */}
                  <td className="py-2.5 px-3">
                    <span
                      className="text-[11px] font-[family-name:var(--font-mono)] text-on-surface"
                      title={formatAbsoluteTime(project.updated_at)}
                    >
                      {formatRelativeTime(project.updated_at)}
                    </span>
                  </td>

                  {/* Size */}
                  <td className="py-2.5 px-3">
                    <span className="text-[11px] font-[family-name:var(--font-mono)] text-outline">
                      {formatBytes(project.size_bytes)}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="py-2.5 px-3 text-right pr-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        title={onDownload ? "Download as ZIP" : "Download not available yet"}
                        onClick={() => onDownload?.(project)}
                        disabled={!onDownload || isPending}
                        className="w-7 h-7 rounded hover:bg-surface-container flex items-center justify-center text-outline hover:text-on-surface transition-colors disabled:opacity-40 disabled:pointer-events-none"
                      >
                        <FolderArchive className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title={onDuplicate ? "Duplicate" : "Duplicate not available yet"}
                        onClick={() => onDuplicate?.(project)}
                        disabled={!onDuplicate || isPending}
                        className="w-7 h-7 rounded hover:bg-surface-container flex items-center justify-center text-outline hover:text-on-surface transition-colors disabled:opacity-40 disabled:pointer-events-none"
                      >
                        <Copy className="w-4 h-4" />
                      </button>

                      {/* Three-dot menu trigger */}
                      <button
                        ref={btnRef as React.RefObject<HTMLButtonElement>}
                        type="button"
                        title="More options"
                        aria-haspopup="menu"
                        aria-expanded={menuFor === project.id}
                        onClick={() =>
                          setMenuFor((current) => (current === project.id ? null : project.id))
                        }
                        className="w-7 h-7 rounded hover:bg-surface-container flex items-center justify-center text-outline hover:text-on-surface transition-colors"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {/* Fixed-position popup — escapes overflow:hidden */}
                      {menuFor === project.id && (
                        <ActionsMenu
                          project={project}
                          anchorRef={btnRef}
                          onClose={() => setMenuFor(null)}
                          onShare={() => onOpenShare(project)}
                          onRename={() => setRenamingId(project.id)}
                          onDelete={() => onDelete(project)}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

function MenuItem({ icon, label, onClick, danger }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
        danger
          ? "text-error hover:bg-error/10"
          : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
