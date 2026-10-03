"use client";

/**
 * Project overview: members, storage and the file inventory.
 *
 * This route was originally a version-history page with a commit timeline, a
 * restore button and a revision filter. The API has no commits, revisions or
 * restore endpoints -- `GET /api/projects/{id}` exposes only current state -- so
 * none of that could be made real. Rather than keep controls that cannot work,
 * the route now shows what the API can actually answer about a project.
 *
 * The URL is unchanged so existing links keep resolving; the header and every
 * link into this route now call it "Project", not "Version History".
 */

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  FileCode2,
  FileText,
  HardDrive,
  Image as ImageIcon,
  Info,
  Loader2,
  Pencil,
  Trash2,
  Users,
} from "lucide-react";

import ConfirmDialog from "@/components/dashboard/ConfirmDialog";
import { api, ApiError } from "@/lib/api/client";
import type { ProjectDetailResponse, Role } from "@/lib/api/types";
import { formatAbsoluteTime, formatBytes, formatQuotaPair, initialsOf } from "@/lib/format";
import { useCurrentUser } from "@/hooks/useProjects";
import { flattenFiles, buildFileTree, isTextPath } from "@/lib/fileTree";

type RoleFilter = "all" | Role;

const FILES_PER_PAGE = 50;

export default function ProjectOverviewPage() {
  const params = useParams<{ id: string }>();
  const projectId = typeof params?.id === "string" ? params.id : "";

  const { user } = useCurrentUser();

  const [project, setProject] = useState<ProjectDetailResponse | null>(null);
  const [quota, setQuota] = useState<{ used_bytes: number; quota_bytes: number; percentage_used: number } | null>(null);
  const [files, setFiles] = useState<{ path: string; sizeBytes: number; isText: boolean }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [fileQuery, setFileQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(FILES_PER_PAGE);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!projectId) return;

    const controller = new AbortController();

    (async () => {
      try {
        const [detail, projectQuota, fileList] = await Promise.all([
          api.getProject(projectId, { signal: controller.signal }),
          api.projectQuota(projectId, { signal: controller.signal }),
          api.listFiles(projectId, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;

        setProject(detail);
        setQuota(projectQuota);
        setFiles(
          fileList.files.map((f) => ({
            path: f.path,
            sizeBytes: f.size_bytes,
            isText: isTextPath(f.path),
          })),
        );
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof ApiError ? cause.message : "Could not load this project");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [projectId]);

  const members = useMemo(() => {
    if (!project) return [];
    // The owner is not in `members`, but is a collaborator like any other.
    const owner = {
      id: `owner:${project.owner.id}`,
      role: "owner" as Role,
      added_at: project.created_at,
      user: project.owner,
    };
    return [owner, ...project.members];
  }, [project]);

  const shownMembers = useMemo(
    () => (roleFilter === "all" ? members : members.filter((m) => m.role === roleFilter)),
    [members, roleFilter],
  );

  const filteredFiles = useMemo(() => {
    const query = fileQuery.trim().toLowerCase();
    if (!query) return files;
    return files.filter((f) => f.path.toLowerCase().includes(query));
  }, [files, fileQuery]);

  // Directory totals, so the inventory shows where a project's bytes actually go.
  const byFolder = useMemo(() => {
    const tree = buildFileTree(files);
    const totals = new Map<string, number>();

    for (const file of flattenFiles(tree)) {
      const slash = file.path.lastIndexOf("/");
      const folder = slash === -1 ? "(root)" : file.path.slice(0, slash);
      totals.set(folder, (totals.get(folder) ?? 0) + file.sizeBytes);
    }

    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [files]);

  const canEdit = useMemo(() => {
    if (!project || !user) return false;
    if (project.owner.id === user.id) return true;
    const membership = project.members.find((m) => m.user.id === user.id);
    return membership?.role === "editor" || membership?.role === "owner";
  }, [project, user]);

  const router = useRouter();

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    try {
      await api.deleteProject(projectId);
      // Client-side navigation, so the app keeps its state instead of reloading.
      router.push("/projects");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not delete the project");
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  const visibleFiles = filteredFiles.slice(0, visibleCount);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <Loader2 className="w-6 h-6 text-primary animate-spin" aria-label="Loading project" />
      </div>
    );
  }

  if (error && !project) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-surface px-6 text-center">
        <AlertTriangle className="w-8 h-8 text-error" />
        <h1 className="text-lg font-semibold text-on-surface">Could not open this project</h1>
        <p className="text-sm text-on-surface-variant max-w-sm">{error}</p>
        <Link
          href="/projects"
          className="h-9 px-4 rounded-lg bg-primary text-on-primary text-sm font-semibold inline-flex items-center hover:bg-primary-container transition-colors"
        >
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <header className="h-14 bg-surface-container-lowest border-b border-surface-container-high sticky top-0 z-50">
        <div className="max-w-[1100px] mx-auto px-6 h-full flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/projects"
              className="h-8 w-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low transition-colors"
              title="Back to Projects"
              aria-label="Back to Projects"
            >
              <ArrowLeft className="w-[18px] h-[18px]" />
            </Link>
            <Image src="/logo.png" alt="Likhitex" width={120} height={32} priority className="h-8 w-auto" />
            <div className="h-4 w-[1px] bg-surface-container-high" />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold truncate">{project?.name}</h1>
              <p className="text-xs text-on-surface-variant truncate">{project?.description || "No description"}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/editor/${projectId}`}
              className="h-8 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold flex items-center gap-1.5 hover:bg-primary-container transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              Open editor
            </Link>
            {canEdit && (
              <button
                type="button"
                onClick={() => setDeleteTarget(project?.name ?? null)}
                className="h-8 px-3 rounded-lg border border-error text-error text-xs font-semibold flex items-center gap-1.5 hover:bg-error-container/40 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-6 py-8 space-y-8">
        {error && (
          <div role="alert" className="rounded-lg bg-error-container/50 border border-error/30 px-4 py-3 text-sm text-on-error-container">
            {error}
          </div>
        )}

        {/* Facts */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Files" value={String(files.length)} icon={<FileText className="w-4 h-4" />} />
          <Stat
            label="Storage"
            value={quota ? formatQuotaPair(quota.used_bytes, quota.quota_bytes) : "—"}
            icon={<HardDrive className="w-4 h-4" />}
          />
          <Stat label="Collaborators" value={String(members.length)} icon={<Users className="w-4 h-4" />} />
          <Stat
            label="Last compiled"
            value={project?.last_compiled_at ? formatAbsoluteTime(project.last_compiled_at) : "Never"}
            icon={<FileCode2 className="w-4 h-4" />}
          />
        </section>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Members */}
          <section className="bg-surface-container-lowest border border-surface-container-high rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-container-high">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Users className="w-4 h-4 text-outline" />
                Collaborators
              </h2>
              <select
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
                aria-label="Filter by role"
                className="h-7 pl-2 pr-6 text-xs bg-surface-container-lowest border border-surface-container-high rounded-lg text-on-surface outline-none"
              >
                <option value="all">All roles</option>
                <option value="owner">Owner</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>

            <ul className="divide-y divide-surface-container-high">
              {shownMembers.map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-primary-fixed text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                      {initialsOf(member.user.full_name ?? member.user.email, member.user.email)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm truncate">
                        {member.user.full_name || member.user.email}
                      </p>
                      <p className="text-xs text-on-surface-variant truncate">{member.user.email}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-surface-container-low text-on-surface-variant capitalize shrink-0">
                    {member.role}
                  </span>
                </li>
              ))}
              {shownMembers.length === 0 && (
                <li className="px-4 py-6 text-center text-xs text-on-surface-variant">
                  No collaborators with that role.
                </li>
              )}
            </ul>
          </section>

          {/* Storage by folder */}
          <section className="bg-surface-container-lowest border border-surface-container-high rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-container-high">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-outline" />
                Storage by folder
              </h2>
            </div>

            {byFolder.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-on-surface-variant">No files yet.</p>
            ) : (
              <ul className="divide-y divide-surface-container-high">
                {byFolder.map(([folder, bytes]) => {
                  const share = quota && quota.used_bytes > 0 ? (bytes / quota.used_bytes) * 100 : 0;
                  return (
                    <li key={folder} className="px-4 py-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono truncate">{folder}</span>
                        <span className="text-on-surface-variant tabular-nums shrink-0 ml-2">
                          {formatBytes(bytes)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${share}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* File inventory */}
        <section className="bg-surface-container-lowest border border-surface-container-high rounded-xl overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-container-high">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4 text-outline" />
              Files
            </h2>
            <input
              value={fileQuery}
              onChange={(event) => {
                setFileQuery(event.target.value);
                setVisibleCount(FILES_PER_PAGE);
              }}
              placeholder="Filter files…"
              aria-label="Filter files"
              className="h-7 px-2.5 text-xs bg-surface-container-lowest border border-surface-container-high rounded-lg text-on-surface outline-none focus:border-primary"
            />
          </div>

          <ul className="divide-y divide-surface-container-high">
            {visibleFiles.map((file) => (
              <li key={file.path} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="flex items-center gap-2 min-w-0 text-xs">
                  {file.path.endsWith(".bib") ? (
                    <BookOpen className="w-3.5 h-3.5 text-outline shrink-0" />
                  ) : file.isText ? (
                    <FileCode2 className="w-3.5 h-3.5 text-outline shrink-0" />
                  ) : (
                    <ImageIcon className="w-3.5 h-3.5 text-outline shrink-0" />
                  )}
                  <span className="font-mono truncate">{file.path}</span>
                </span>
                <span className="text-xs text-on-surface-variant tabular-nums shrink-0">
                  {formatBytes(file.sizeBytes)}
                </span>
              </li>
            ))}
            {visibleFiles.length === 0 && (
              <li className="px-4 py-6 text-center text-xs text-on-surface-variant">
                {files.length === 0 ? "This project has no files yet." : "No files match that filter."}
              </li>
            )}
          </ul>

          {filteredFiles.length > visibleFiles.length && (
            <div className="px-4 py-3 border-t border-surface-container-high">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + FILES_PER_PAGE)}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Show {Math.min(FILES_PER_PAGE, filteredFiles.length - visibleFiles.length)} more
              </button>
            </div>
          )}
        </section>

        <p className="flex items-start gap-2 text-xs text-outline leading-relaxed">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            The API exposes only a project&apos;s current state. There is no commit or revision
            history, so no timeline or restore is shown here.
          </span>
        </p>
      </main>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete project"
        body={`This permanently deletes "${deleteTarget ?? ""}" and every file in it. This cannot be undone.`}
        confirmLabel={isDeleting ? "Deleting…" : "Delete project"}
        isDestructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-surface-container-lowest border border-surface-container-high rounded-xl px-4 py-3">
      <p className="text-xs text-on-surface-variant flex items-center gap-1.5">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold truncate">{value}</p>
    </div>
  );
}
