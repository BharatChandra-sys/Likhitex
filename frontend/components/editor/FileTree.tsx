"use client";

/**
 * Project file tree with create, rename and delete.
 *
 * The tree is derived from the API's flat path list, so folders exist only as
 * path prefixes. Creating a file at `chapters/intro.tex` is therefore what makes
 * the `chapters` folder appear -- there is no separate folder to POST.
 *
 * Write affordances are hidden, not merely disabled, for VIEWERs: the API rejects
 * their writes with a 403, so an enabled button would only offer a dead end.
 */

import { useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

import type { TreeDir, TreeFile, TreeNode } from "@/lib/fileTree";
import { formatBytes } from "@/lib/format";

export interface FileTreeProps {
  tree: TreeDir;
  selectedPath: string | null;
  dirtyPaths: ReadonlySet<string>;
  /** Paths that failed to load, shown so a bad file is not silently empty. */
  canEdit: boolean;
  onSelect: (path: string) => void;
  onCreateFile: (path: string) => void;
  onRename: (fromPath: string, toPath: string) => void;
  onDelete: (path: string) => void;
  /** Called when the user asks for a brand-new folder. */
  onCreateFolder?: (folderName: string) => void;
}

/** Icon per file kind, so binaries are distinguishable at a glance. */
function iconFor(file: TreeFile) {
  if (file.extension === "bib") return <BookOpen className="w-[15px] h-[15px]" />;
  if (!file.isText) return <ImageIcon className="w-[15px] h-[15px]" />;
  if (file.isLatex) return <FileCode2 className="w-[15px] h-[15px]" />;
  return <FileIcon className="w-[15px] h-[15px]" />;
}

interface RowProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  dirtyPaths: ReadonlySet<string>;
  /** Paths explicitly collapsed; anything absent is open. */
  collapsed: ReadonlySet<string>;
  canEdit: boolean;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  onRename: (fromPath: string, toPath: string) => void;
  onDelete: (path: string) => void;
}

function Row({
  node,
  depth,
  selectedPath,
  dirtyPaths,
  collapsed,
  canEdit,
  onSelect,
  onToggle,
  onRename,
  onDelete,
}: RowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(node.name);

  // Indent by depth, matching the design's 4px-per-level rhythm.
  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  if (node.kind === "dir") {
    const isOpen = !collapsed.has(node.path);

    return (
      <>
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          aria-expanded={isOpen}
          className="w-full flex items-center gap-1 py-1 pr-2 rounded text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors"
          style={indent}
        >
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 shrink-0" />
          )}
          {isOpen ? (
            <FolderOpen className="w-[15px] h-[15px] text-outline" />
          ) : (
            <Folder className="w-[15px] h-[15px] text-outline" />
          )}
          <span className="truncate text-[11px]">{node.name}/</span>
        </button>

        {isOpen &&
          node.children.map((child) => (
            <Row
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              dirtyPaths={dirtyPaths}
              collapsed={collapsed}
              canEdit={canEdit}
              onSelect={onSelect}
              onToggle={onToggle}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
      </>
    );
  }

  const isSelected = node.path === selectedPath;
  const isDirty = dirtyPaths.has(node.path);

  if (renaming) {
    return (
      <form
        style={indent}
        className="py-0.5 pr-2"
        onSubmit={(event) => {
          event.preventDefault();
          const next = draft.trim();
          if (next && next !== node.name) {
            // Preserve the folder when only the basename is edited.
            const slash = node.path.lastIndexOf("/");
            const parent = slash === -1 ? "" : node.path.slice(0, slash + 1);
            onRename(node.path, `${parent}${next}`);
          }
          setRenaming(false);
        }}
      >
        <input
          autoFocus
          value={draft}
          aria-label={`Rename ${node.name}`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setRenaming(false);
          }}
          className="w-full bg-surface-container-lowest border border-primary rounded px-1.5 py-0.5 text-[11px] font-mono outline-none"
        />
      </form>
    );
  }

  return (
    <div
      className={`group relative flex items-center gap-1 py-1 pr-1 rounded transition-colors ${
        isSelected
          ? "bg-primary-fixed/60 text-primary border-l-2 border-primary"
          : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface border-l-2 border-transparent"
      }`}
      style={indent}
    >
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        className="flex items-center gap-1.5 truncate flex-1 text-left"
        title={`${node.path} (${formatBytes(node.sizeBytes)})`}
        aria-current={isSelected ? "true" : undefined}
      >
        <span className={isSelected ? "text-primary" : "text-outline"}>{iconFor(node)}</span>
        <span className="truncate">{node.name}</span>
        {isDirty && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-tertiary shrink-0"
            aria-label="Unsaved changes"
          />
        )}
      </button>

      {canEdit && (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={`Actions for ${node.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="w-5 h-5 rounded flex items-center justify-center text-outline hover:bg-surface-container-high hover:text-on-surface opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>

          {menuOpen && (
            <>
              {/* Click-away layer, so the menu closes without a document listener. */}
              <button
                type="button"
                aria-label="Close menu"
                tabIndex={-1}
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div
                role="menu"
                className="absolute right-0 top-5 z-20 w-32 py-1 rounded-lg bg-surface-container-lowest border border-surface-container-high shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setDraft(node.name);
                    setRenaming(true);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(node.path);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-error hover:bg-error-container/40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function FileTree({
  tree,
  selectedPath,
  dirtyPaths,
  canEdit,
  onSelect,
  onCreateFile,
  onRename,
  onDelete,
  onCreateFolder,
}: FileTreeProps) {
  // A directory is open unless it has been explicitly collapsed. Keeping only the
  // collapsed set avoids the two-set desynchronisation where a path could be in
  // both `expanded` and `collapsed` and render inconsistently.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState("");

  const toggle = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const submitNewFile = () => {
    const path = newPath.trim();
    if (!path) return;
    onCreateFile(path);
    setNewPath("");
    setCreating(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="h-9 px-2.5 flex items-center justify-between border-b border-surface-container-high bg-surface-container-lowest shrink-0">
        <span className="text-[11px] font-semibold text-outline uppercase tracking-wider">
          Project Files
        </span>
        {canEdit && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setCreating(true)}
              title="New file"
              aria-label="New file"
              className="w-6 h-6 rounded flex items-center justify-center text-outline hover:bg-surface-container-low hover:text-on-surface transition-colors"
            >
              <FilePlus2 className="w-[15px] h-[15px]" />
            </button>
            {onCreateFolder && (
              <button
                type="button"
                onClick={() => onCreateFolder("")}
                title="New folder"
                aria-label="New folder"
                className="w-6 h-6 rounded flex items-center justify-center text-outline hover:bg-surface-container-low hover:text-on-surface transition-colors"
              >
                <FolderPlus className="w-[15px] h-[15px]" />
              </button>
            )}
          </div>
        )}
      </div>

      {creating && (
        <form
          className="px-2 py-1 border-b border-surface-container-high"
          onSubmit={(event) => {
            event.preventDefault();
            submitNewFile();
          }}
        >
          <input
            autoFocus
            value={newPath}
            onChange={(event) => setNewPath(event.target.value)}
            onBlur={submitNewFile}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setNewPath("");
                setCreating(false);
              }
            }}
            placeholder="chapters/intro.tex"
            aria-label="New file path"
            className="w-full bg-surface-container-lowest border border-primary rounded px-1.5 py-1 text-[11px] font-mono outline-none"
          />
        </form>
      )}

      <div className="flex-1 overflow-y-auto py-1 px-1 text-[11px] font-mono leading-[16px]">
        {tree.children.length === 0 && !creating ? (
          <p className="px-2 py-3 text-[11px] font-sans text-outline leading-relaxed">
            No files yet. Create one to start writing.
          </p>
        ) : (
          tree.children.map((child) => (
            <Row
              key={child.path}
              node={child}
              depth={0}
              selectedPath={selectedPath}
              dirtyPaths={dirtyPaths}
              collapsed={collapsed}
              canEdit={canEdit}              onSelect={onSelect}
              onToggle={toggle}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
