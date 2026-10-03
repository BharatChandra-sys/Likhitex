"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Grid3X3,
  List,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Users,
} from "lucide-react";
import AppHeader from "@/components/dashboard/AppHeader";
import Sidebar, { type ProjectBucket } from "@/components/dashboard/Sidebar";
import ProjectsTable, { type ViewMode } from "@/components/dashboard/ProjectsTable";
import ProjectsGrid from "@/components/dashboard/ProjectsGrid";
import {
  ProjectsEmptyState,
  ProjectsErrorState,
  ProjectsSkeleton,
} from "@/components/dashboard/ProjectStates";
import NewProjectMenu from "@/components/modals/NewProjectMenu";
import CreateBlankProjectModal from "@/components/modals/CreateBlankProjectModal";
import { ShareProjectModal } from "@/components/modals/ShareProjectModal";
import ConfirmDialog from "@/components/dashboard/ConfirmDialog";
import { api, ApiError } from "@/lib/api/client";
import { useCurrentUser, useProjectBuckets, useProjects } from "@/hooks/useProjects";
import type { ProjectResponse } from "@/lib/api/types";

type SortKey = "updated_at" | "name" | "size_bytes";
type SortDirection = "asc" | "desc";

/** Toggles the header to its indeterminate state while a debounced search is pending. */
function ToggleButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
        active
          ? "bg-primary-fixed text-primary"
          : "text-outline hover:bg-surface-container hover:text-on-surface"
      }`}
    >
      {children}
    </button>
  );
}

export default function ProjectsDashboard() {
  const { user, quota } = useCurrentUser();
  const {
    projects,
    total,
    page,
    pageCount,
    isInitialLoading,
    isRefreshing,
    error,
    search,
    setSearch,
    appliedSearch,
    goToPage,
    reload,
  } = useProjects();

  const [bucket, setBucket] = useState<ProjectBucket>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  // Owned here so NewProjectMenu can measure the same button the sidebar renders.
  const newButtonRef = useRef<HTMLButtonElement>(null);

  const [isNewMenuOpen, setIsNewMenuOpen] = useState(false);
  const [isCreateBlankOpen, setIsCreateBlankOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectResponse | null>(null);
  const [shareTarget, setShareTarget] = useState<ProjectResponse | null>(null);

  const { owned, shared, all } = useProjectBuckets(projects, user?.id);

  // Server-side search already filters, so the bucket is a local refinement.
  const bucketProjects = useMemo(() => {
    const source = bucket === "owned" ? owned : bucket === "shared" ? shared : all;

    // Page-local sort; the API exposes no sort parameter.
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...source].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name) * direction;
      if (sortKey === "size_bytes") return (a.size_bytes - b.size_bytes) * direction;
      const aTime = new Date(a.updated_at).getTime();
      const bTime = new Date(b.updated_at).getTime();
      return (aTime - bTime) * direction;
    });
  }, [bucket, owned, shared, all, sortKey, sortDirection]);

  const onSortChange = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(key);
      // Names read best A-Z; the other columns read best largest/newest first.
      setSortDirection(key === "name" ? "asc" : "desc");
    },
    [sortKey],
  );

  /** Tracks in-flight mutations so the affected row can show a spinner. */
  const withPending = useCallback(async (ids: string[], work: () => Promise<void>) => {
    setPendingIds((current) => new Set([...current, ...ids]));
    try {
      await work();
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  }, []);

  const handleCreate = useCallback(
    async (data: { name: string }) => {
      setIsCreateBlankOpen(false);
      try {
        await withPending([], async () => {
          const created = await api.createProject({ name: data.name });
          // A blank project is not useful without an entry point, so seed a
          // minimal main.tex. No `type` is sent: the API derives it from the
          // extension and rejects values containing a slash, e.g. "text/plain".
          await api.uploadFile(created.id, {
            path: "main.tex",
            content: [
              "\\documentclass{article}",
              "\\begin{document}",
              `% ${data.name}`,
              "",
              "\\end{document}",
              "",
            ].join("\n"),
          });
        });
        reload();
      } catch (cause) {
        const message =
          cause instanceof ApiError ? cause.message : "Could not create the project";
        window.alert(message);
      }
    },
    [reload, withPending],
  );

  const handleRename = useCallback(
    async (id: string, name: string) => {
      await withPending([id], async () => {
        await api.updateProject(id, { name });
      });
      reload();
    },
    [reload, withPending],
  );

  const handleDelete = useCallback(
    async (project: ProjectResponse) => {
      setDeleteTarget(null);
      try {
        await withPending([project.id], async () => {
          await api.deleteProject(project.id);
        });
        reload();
      } catch (cause) {
        window.alert(
          cause instanceof ApiError ? cause.message : "Could not delete the project",
        );
      }
    },
    [reload, withPending],
  );

  const handleRenamePrompt = useCallback(
    (project: ProjectResponse) => {
      const next = window.prompt("Rename project", project.name);
      if (next && next.trim() && next.trim() !== project.name) {
        void handleRename(project.id, next.trim()).catch((cause: unknown) => {
          window.alert(cause instanceof ApiError ? cause.message : "Could not rename.");
        });
      }
    },
    [handleRename],
  );

  /** Opens the ZIP importer. */
  const handleArchiveImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        window.alert(
          `Cannot import ${file.name}: bulk archive import needs a multi-file upload ` +
            "endpoint, and the API only accepts one file at a time.",
        );
      }
    };
    input.click();
  }, []);

  const isSearching = appliedSearch.trim().length > 0;
  const hasProjects = total > 0;
  const bucketCount = bucketProjects.length;

  const title =
    bucket === "owned" ? "Your Projects" : bucket === "shared" ? "Shared with you" : "All Projects";

  return (
    <div className="min-h-screen bg-surface font-[family-name:var(--font-sans)]">
      <AppHeader
        user={user}
        quota={quota}
        search={search}
        onSearchChange={setSearch}
        isSearchPending={search !== appliedSearch}
      />

      <Sidebar
        activeBucket={bucket}
        onBucketChange={setBucket}
        projects={projects}
        ownedCount={owned.length}
        sharedCount={shared.length}
        totalCount={all.length}
        usedBytes={quota?.used_bytes ?? null}
        quotaBytes={quota?.quota_bytes ?? null}
        onCreateClick={() => setIsNewMenuOpen(true)}
        onTemplatesClick={() =>
          window.alert("Templates are not available yet: the API has no template endpoint.")
        }
        newButtonRef={newButtonRef}
      />

      {/* Main content */}
      <main className="pl-[240px] pt-14 min-h-screen">
        <div className="p-6 max-w-[1400px]">
          {/* Page header */}
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-on-surface">{title}</h1>
              <span className="text-xs font-[family-name:var(--font-mono)] text-outline">
                {bucket === "all"
                  ? `${total} ${total === 1 ? "project" : "projects"}`
                  : `${bucketCount} on this page`}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <ToggleButton
                active={viewMode === "list"}
                label="List view"
                onClick={() => setViewMode("list")}
              >
                <List className="w-4 h-4" />
              </ToggleButton>
              <ToggleButton
                active={viewMode === "grid"}
                label="Grid view"
                onClick={() => setViewMode("grid")}
              >
                <Grid3X3 className="w-4 h-4" />
              </ToggleButton>
            </div>
          </div>

          {/* Body */}
          {isInitialLoading ? (
            <ProjectsSkeleton />
          ) : error && !hasProjects ? (
            <ProjectsErrorState
              message={error.message}
              requestId={error.requestId}
              isNetworkError={error.isNetworkError}
              onRetry={reload}
            />
          ) : bucketProjects.length === 0 ? (
            <ProjectsEmptyState
              isSearching={isSearching || bucket !== "all"}
              onClearSearch={() => setSearch("")}
              onCreate={() => setIsCreateBlankOpen(true)}
            />
          ) : (
            <>
              {/* A stale-page error is shown inline; the rows stay on screen. */}
              {error && (
                <div
                  role="alert"
                  className="mb-3 px-3 py-2 rounded-lg bg-error/10 text-error text-xs flex items-center justify-between gap-3"
                >
                  <span>
                    Could not refresh: {error.message}
                    {error.requestId ? ` (request_id: ${error.requestId})` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={reload}
                    className="underline underline-offset-2 shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}

              {viewMode === "list" ? (
                <ProjectsTable
                  projects={bucketProjects}
                  currentUserId={user?.id}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSortChange={onSortChange}
                  isRefreshing={isRefreshing}
                  onOpenShare={(project) => setShareTarget(project)}
                  onRename={handleRenamePrompt}
                  // The API exposes no duplicate or ZIP-export endpoint, so
                  // these are left unimplemented rather than faked.
                  onDuplicate={undefined}
                  onDownload={undefined}
                  onDelete={(project) => setDeleteTarget(project)}
                  pendingIds={pendingIds}
                />
              ) : (
                <ProjectsGrid
                  projects={bucketProjects}
                  currentUserId={user?.id}
                  isRefreshing={isRefreshing}
                  pendingIds={pendingIds}
                  onOpenShare={(project) => setShareTarget(project)}
                  onRename={handleRenamePrompt}
                  onDelete={(project) => setDeleteTarget(project)}
                />
              )}

              {/* Pagination */}
              {pageCount > 1 && (
                <div className="flex items-center justify-between gap-4 mt-4">
                  <span className="text-[11px] font-[family-name:var(--font-mono)] text-outline">
                    Page {page} of {pageCount}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => goToPage(page - 1)}
                      disabled={page <= 1}
                      className="h-8 px-3 text-xs rounded-lg border border-[#E5E7EB] text-on-surface-variant hover:bg-surface-container disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1 transition-colors"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => goToPage(page + 1)}
                      disabled={page >= pageCount}
                      className="h-8 px-3 text-xs rounded-lg border border-[#E5E7EB] text-on-surface-variant hover:bg-surface-container disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1 transition-colors"
                    >
                      Next
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Bucket legend, shown only when a filter is hiding rows. */}
          {bucket === "owned" && shared.length > 0 && (
            <p className="mt-4 text-[11px] font-[family-name:var(--font-mono)] text-outline flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5" />
              {shared.length} shared project{shared.length === 1 ? "" : "s"} hidden
            </p>
          )}
          {bucket === "shared" && (
            <p className="mt-4 text-[11px] font-[family-name:var(--font-mono)] text-outline flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              {owned.length} of your own project{owned.length === 1 ? "" : "s"} hidden
            </p>
          )}
        </div>
      </main>

      {/* Modals */}
      <NewProjectMenu
        isOpen={isNewMenuOpen}
        onClose={() => setIsNewMenuOpen(false)}
        onCreateBlank={() => setIsCreateBlankOpen(true)}
        onUploadZip={handleArchiveImport}
        triggerRef={newButtonRef}
      />

      <CreateBlankProjectModal
        isOpen={isCreateBlankOpen}
        onClose={() => setIsCreateBlankOpen(false)}
        onCreate={(data) => void handleCreate(data)}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete project"
        body={
          deleteTarget
            ? `"${deleteTarget.name}" will be removed from your workspace. This cannot be undone from here.`
            : ""
        }
        confirmLabel="Delete"
        isDestructive
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <ShareProjectModal
        isOpen={shareTarget !== null}
        onClose={() => setShareTarget(null)}
        projectId={shareTarget?.id ?? null}
        projectTitle={shareTarget?.name ?? ""}
      />
    </div>
  );
}
