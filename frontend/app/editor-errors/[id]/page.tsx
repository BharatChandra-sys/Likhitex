"use client";

/**
 * Review: compile diagnostics for a project, with an optional PDF preview.
 *
 * The original design for this page was a comment thread -- reviewers leaving
 * notes on a line and resolving them. The API has no comments, threads or review
 * endpoints, so that could not be made real; building it anyway is exactly what
 * produced the dead "Resolve" and "Reply" buttons this page replaces.
 *
 * What it shows instead is genuinely available and genuinely useful: the compiler's
 * own diagnostics for the project, which is what a reviewer actually needs before
 * approving a paper. Clicking a diagnostic opens that file in the editor at that
 * line, so this page and the editor stay in sync.
 */

import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileCode2,
  Loader2,
  Play,
  RotateCcw,
} from "lucide-react";

import PdfPreview from "@/components/editor/PdfPreview";
import type { Diagnostic } from "@/lib/api/types";
import { useCurrentUser } from "@/hooks/useProjects";
import { useEditorProject } from "@/hooks/useEditorProject";

type Filter = "all" | "error" | "warning";

const SEVERITY_STYLES: Record<string, string> = {
  error: "text-error",
  warning: "text-tertiary",
};

export default function EditorErrorsPage() {
  const params = useParams<{ id: string }>();
  const projectId = typeof params?.id === "string" ? params.id : "";

  const { user } = useCurrentUser();
  const editor = useEditorProject(projectId, user?.id ?? null);

  const [filter, setFilter] = useState<Filter>("all");

  // The hook owns compiling, so this page and the editor always agree on what was
  // compiled: the same unsaved buffers, gathered by the same code path.
  const { project, canEdit, isLoading, loadError, isCompiling, compileResult, compileError, compileNow } =
    editor;

  // Compile once on load so the page arrives with findings rather than empty.
  useEffect(() => {
    if (isLoading || loadError) return;
    void compileNow();
    // Keyed on load completion only: re-running as `files` settles would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, loadError, projectId]);

  const result = compileResult;

  const all: Diagnostic[] = useMemo(
    () => [...(result?.errors ?? []), ...(result?.warnings ?? [])],
    [result],
  );

  const shown = useMemo(
    () => (filter === "all" ? all : all.filter((d) => d.severity === filter)),
    [all, filter],
  );

  // Group by file so a long list reads as a handful of documents, not 200 rows.
  const grouped = useMemo(() => {
    const byFile = new Map<string, Diagnostic[]>();
    for (const diagnostic of shown) {
      const key = diagnostic.file || "(engine)";
      const bucket = byFile.get(key);
      if (bucket) bucket.push(diagnostic);
      else byFile.set(key, [diagnostic]);
    }
    return [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  const errorCount = result?.errors.length ?? 0;
  const warningCount = result?.warnings.length ?? 0;

  /** Links into the editor at the diagnostic's line. */
  const editorHref = (file: string, line: number) => {
    const params = new URLSearchParams({ line: String(Math.max(1, line)) });
    if (file) params.set("file", file);
    return `/editor/${projectId}?${params.toString()}`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <Loader2 className="w-6 h-6 text-primary animate-spin" aria-label="Loading project" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-surface px-6 text-center">
        <AlertTriangle className="w-8 h-8 text-error" />
        <h1 className="text-lg font-semibold text-on-surface">Could not open this project</h1>
        <p className="text-sm text-on-surface-variant max-w-sm">{loadError.message}</p>
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
    <div className="h-screen flex flex-col bg-surface text-on-surface overflow-hidden">
      <header className="h-12 shrink-0 bg-surface-container-lowest border-b border-surface-container-high px-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href={`/editor/${projectId}`}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low transition-colors"
            title="Back to editor"
            aria-label="Back to editor"
          >
            <ArrowLeft className="w-[18px] h-[18px]" />
          </Link>
          <Image src="/logo.png" alt="Likhitex" width={120} height={32} priority className="h-8 w-auto" />
          <div className="h-4 w-[1px] bg-surface-container-high mx-1" />
          <h1 className="text-sm font-semibold truncate max-w-[260px]">{project?.name ?? "Project"}</h1>
          <span className="text-xs text-outline">Review</span>
        </div>

        <div className="flex items-center gap-2">
          {result && (
            <span className="text-xs text-on-surface-variant">
              {result.success ? (
                <span className="text-secondary">Compiled in {result.compile_time.toFixed(1)}s</span>
              ) : (
                <span className="text-error">Compile failed</span>
              )}
            </span>
          )}
          <button
            type="button"
            onClick={() => void compileNow()}
            disabled={isCompiling}
            className="h-8 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold flex items-center gap-1.5 hover:bg-primary-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isCompiling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : result ? (
              <RotateCcw className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span>{isCompiling ? "Compiling…" : result ? "Recompile" : "Compile"}</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Findings */}
        <div className="w-[420px] shrink-0 border-r border-surface-container-high bg-surface-bright flex flex-col min-h-0">
          <div className="h-11 px-3 flex items-center justify-between border-b border-surface-container-high shrink-0">
            <div className="flex items-center gap-1">
              {(
                [
                  { id: "all", label: "All", count: all.length },
                  { id: "error", label: "Errors", count: errorCount },
                  { id: "warning", label: "Warnings", count: warningCount },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  aria-pressed={filter === tab.id}
                  className={`h-7 px-2.5 rounded text-xs font-medium transition-colors ${
                    filter === tab.id
                      ? "bg-primary-fixed text-primary"
                      : "text-on-surface-variant hover:bg-surface-container-low"
                  }`}
                >
                  {tab.label}
                  <span className="ml-1 tabular-nums opacity-70">{tab.count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {compileError && (
              <div
                role="alert"
                className="m-3 rounded-lg bg-error-container/50 border border-error/30 px-3 py-2 text-xs text-on-error-container"
              >
                {compileError}
              </div>
            )}

            {isCompiling && all.length === 0 && (
              <p className="px-3 py-4 text-xs text-on-surface-variant">Compiling…</p>
            )}

            {!isCompiling && !compileError && all.length === 0 && result?.success && (
              <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-2">
                <CheckCircle2 className="w-8 h-8 text-secondary" />
                <p className="text-sm text-on-surface">No problems found</p>
                <p className="text-xs text-outline leading-relaxed">
                  The compiler reported no errors or warnings.
                </p>
              </div>
            )}

            {!isCompiling && all.length === 0 && result && !result.success && (
              <div className="px-3 py-4 text-xs text-on-surface-variant leading-relaxed">
                <p className="font-medium text-on-surface">The compiler could not finish.</p>
                <p className="mt-1">{result.error ?? "No further detail was returned."}</p>
                {result.log && (
                  <details className="mt-3">
                    <summary className="cursor-pointer font-medium text-primary">
                      Raw log
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto text-[10px] font-mono whitespace-pre-wrap bg-surface-container-low rounded p-2">
                      {result.log.slice(0, 4000)}
                    </pre>
                  </details>
                )}
              </div>
            )}

            {grouped.map(([file, diagnostics]) => (
              <section key={file}>
                <h2 className="sticky top-0 bg-surface-container-low px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-outline flex items-center gap-1.5">
                  <FileCode2 className="w-3 h-3" />
                  {file}
                  <span className="ml-auto tabular-nums">{diagnostics.length}</span>
                </h2>

                <ul>
                  {diagnostics.map((diagnostic, index) => (
                    <li key={`${diagnostic.line}-${index}`}>
                      <Link
                        href={editorHref(diagnostic.file, diagnostic.line)}
                        className="block px-3 py-2 hover:bg-surface-container-low transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <AlertTriangle
                            className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                              SEVERITY_STYLES[diagnostic.severity] ?? "text-outline"
                            }`}
                          />
                          <div className="min-w-0">
                            <p className="text-xs text-on-surface leading-snug break-words">
                              {diagnostic.message}
                            </p>
                            {diagnostic.line > 0 && (
                              <p className="mt-0.5 text-[10px] text-outline font-mono">
                                line {diagnostic.line}
                              </p>
                            )}
                          </div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {!canEdit && (
            <div className="border-t border-surface-container-high px-3 py-2 text-[10px] text-outline shrink-0">
              You have read-only access, so findings reflect the last saved state.
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="flex-1 min-w-0 flex flex-col bg-surface-dim">
          <PdfPreview
            pdfBase64={result?.success ? result.pdf : null}
            isCompiling={isCompiling}
            error={compileError ?? (result && !result.success ? result.error : null)}
            errorCount={errorCount}
            onCompile={() => void compileNow()}
            onOpenLogs={() => setFilter("all")}
          />
        </div>
      </div>
    </div>
  );
}
