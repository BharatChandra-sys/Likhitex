"use client";

/**
 * The LaTeX editor.
 *
 * Everything here is driven by the API rather than mock data: the file tree comes
 * from `GET /api/projects/{id}/files/`, the buffer from the single-file endpoint,
 * and the preview from `POST /api/compile/`. State and side effects live in
 * `useEditorProject`; this file is the layout and the wiring between panels.
 *
 * Write controls are hidden for VIEWERs because the API rejects their writes with
 * a 403 -- a disabled button would only promise something the server refuses.
 */

import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  CloudCheck,
  CloudUpload,
  FileCode2,
  FolderOpen,
  History,
  Loader2,
  Search,
  Share2,
  Sliders,
  SplitSquareHorizontal,
} from "lucide-react";

import CodeEditor, {
  type CursorPosition,
  type TextInsertRequest,
} from "@/components/editor/CodeEditor";
import FileTree from "@/components/editor/FileTree";
import SymbolPalette from "@/components/editor/SymbolPalette";
import PdfPreview from "@/components/editor/PdfPreview";
import CompileLogsDrawer from "@/components/editor/CompileLogsDrawer";
import CompileStatusBanner from "@/components/editor/CompileStatusBanner";
import EditorLoadingSkeleton from "@/components/states/EditorLoadingSkeleton";
import ConfirmDialog from "@/components/dashboard/ConfirmDialog";
import { ShareProjectModal } from "@/components/modals/ShareProjectModal";
import { parseOutline } from "@/lib/fileTree";
import { useCurrentUser } from "@/hooks/useProjects";
import { useEditorProject } from "@/hooks/useEditorProject";

/** Snippets the toolbar inserts at the caret, as LaTeX rather than rich text. */
interface Snippet {
  title: string;
  snippet: string;
  icon: string;
  /** Extra styling for the glyph, e.g. to make "I" italic. */
  className?: string;
}

const SNIPPETS: Snippet[] = [
  { title: "Bold", snippet: "\\textbf{text}", icon: "B", className: "font-bold" },
  { title: "Italic", snippet: "\\textit{text}", icon: "I", className: "italic font-serif" },
  { title: "Section", snippet: "\\section{Title}\n", icon: "\u00A7" },
  { title: "Cite", snippet: "\\cite{key}", icon: "\u201C" },
  { title: "Equation", snippet: "\\begin{equation}\n\n\\end{equation}\n", icon: "\u03A3" },
];

export default function EditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = typeof params?.id === "string" ? params.id : "";

  const { user } = useCurrentUser();
  const editor = useEditorProject(projectId, user?.id ?? null);

  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isLayoutSplit, setIsLayoutSplit] = useState(true);
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 });
  const [jumpToLine, setJumpToLine] = useState<number | null>(null);
  const [insertRequest, setInsertRequest] = useState<TextInsertRequest | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  /** Distinguishes repeated jumps to the same line, which a number cannot. */
  const [jumpNonce, setJumpNonce] = useState(0);

  const {
    project,
    tree,
    files,
    selectedPath,
    content,
    isLoading,
    loadError,
    canEdit,
    isReadOnly,
    saveState,
    saveError,
    dirtyPaths,
    selectFile,
    setContent,
    saveNow,
    createFile,
    renameFile,
    deleteFile,
    isCompiling,
    compileResult,
    compileError,
    compileNow,
  } = editor;

  const diagnostics = useMemo(
    () => ({
      errors: compileResult?.errors ?? [],
      warnings: compileResult?.warnings ?? [],
    }),
    [compileResult],
  );

  const outline = useMemo(() => (selectedPath ? parseOutline(content) : []), [selectedPath, content]);

  // Ctrl/Cmd+S saves and Ctrl/Cmd+Enter compiles, from anywhere on the page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.key === "s") {
        event.preventDefault();
        void saveNow();
      } else if (event.key === "Enter") {
        event.preventDefault();
        void compileNow();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [compileNow, saveNow]);

  const handleCreateFile = useCallback(
    async (path: string) => {
      setPanelError(null);
      const ok = await createFile(path, "");
      if (!ok) setPanelError(`Could not create ${path}`);
    },
    [createFile],
  );

  const handleRename = useCallback(
    async (fromPath: string, toPath: string) => {
      setPanelError(null);
      const ok = await renameFile(fromPath, toPath);
      if (!ok) setPanelError(`Could not rename ${fromPath}`);
    },
    [renameFile],
  );

  const handleDelete = useCallback(
    async (path: string) => {
      setPanelError(null);
      const ok = await deleteFile(path);
      if (!ok) setPanelError(`Could not delete ${path}`);
    },
    [deleteFile],
  );

  /** Opens a diagnostic's file and moves the caret to its line. */
  const handleNavigateToDiagnostic = useCallback(
    (file: string, line: number) => {
      // The parser reports engine-level warnings against an empty path.
      const target = file && files.some((f) => f.path === file) ? file : selectedPath;
      if (target && target !== selectedPath) void selectFile(target);
      setJumpToLine(line > 0 ? line : 1);
      setJumpNonce((n) => n + 1);
    },
    [files, selectFile, selectedPath],
  );

  /**
   * Inserts a snippet where the caret is, not at the end of the file.
   *
   * The request is handed to `CodeEditor` rather than splicing `content` here:
   * the caret position is only known inside CodeMirror, and the resulting change
   * then travels back through the normal `onChange` path, so one Ctrl+Z removes
   * the whole snippet instead of the buffer being clobbered by a replacement.
   * The nonce is what lets the same snippet be inserted twice in a row.
   */
  const insertAtCaret = useCallback(
    (snippet: string) => {
      if (!canEdit || !selectedPath) return;
      setInsertRequest((prev) => ({ text: snippet, nonce: (prev?.nonce ?? 0) + 1 }));
    },
    [canEdit, selectedPath],
  );

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? "Save failed"
        : dirtyPaths.size > 0
          ? "Unsaved"
          : "Saved";

  if (!projectId) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 bg-surface">
        <p className="text-sm text-on-surface-variant">No project selected.</p>
        <Link href="/projects" className="text-sm text-primary font-semibold hover:underline">
          Back to projects
        </Link>
      </div>
    );
  }

  if (isLoading) return <EditorLoadingSkeleton />;

  if (loadError) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-3 bg-surface px-6 text-center">
        <AlertTriangle className="w-8 h-8 text-error" />
        <h1 className="text-lg font-semibold text-on-surface">Could not open this project</h1>
        <p className="text-sm text-on-surface-variant max-w-sm leading-relaxed">
          {loadError.message}
        </p>
        {loadError.status === 403 && (
          <p className="text-sm text-on-surface-variant max-w-sm leading-relaxed">
            You need at least viewer access to this project.
          </p>
        )}
        <button
          type="button"
          onClick={() => router.push("/projects")}
          className="mt-1 h-9 px-4 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:bg-primary-container transition-colors"
        >
          Back to projects
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-surface text-on-surface font-sans antialiased select-none overflow-hidden">
      <header className="h-12 shrink-0 bg-surface-container-lowest border-b border-surface-container-high px-3 flex items-center justify-between z-50">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/projects"
            className="h-8 w-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors"
            title="Back to Projects"
            aria-label="Back to Projects"
          >
            <ArrowLeft className="w-[18px] h-[18px]" />
          </Link>
          <Image
            src="/logo.png"
            alt="Likhitex"
            width={120}
            height={32}
            priority
            className="h-8 w-auto"
          />
          <div className="h-4 w-[1px] bg-surface-container-high mx-1" />
          <h1 className="text-sm font-semibold text-on-surface truncate max-w-[220px]">
            {project?.name ?? "Project"}
          </h1>
          <div
            className={`flex items-center gap-1 pl-1.5 ${
              saveState === "error" ? "text-error" : "text-secondary"
            }`}
          >
            {saveState === "saving" ? (
              <Loader2 className="w-[15px] h-[15px] animate-spin" />
            ) : saveState === "error" ? (
              <AlertTriangle className="w-[15px] h-[15px]" />
            ) : (
              <CloudCheck className="w-[15px] h-[15px]" />
            )}
            <span className="text-[10px] font-medium leading-[14px]">{saveLabel}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Real members, so the avatars reflect access rather than decoration. */}
          {project && project.members.length > 0 && (
            <div className="flex items-center -space-x-1.5 pr-1.5">
              {project.members.slice(0, 4).map((member) => (
                <div
                  key={member.id}
                  className="w-6 h-6 rounded-full bg-surface-container-highest flex items-center justify-center ring-2 ring-primary text-primary text-[10px] font-semibold"
                  title={`${member.user.email} (${member.role})`}
                >
                  {member.user.email.slice(0, 2).toUpperCase()}
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsShareOpen(true)}
            className="h-8 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold flex items-center gap-1.5 hover:bg-primary-container transition-colors"
          >
            <Share2 className="w-4 h-4" />
            <span>Share</span>
          </button>

          <Link
            href={`/history/${projectId}`}
            title="Project overview"
            aria-label="Project overview"
            className="h-8 w-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors"
          >
            <History className="w-[18px] h-[18px]" />
          </Link>

          <button
            type="button"
            onClick={() => setIsLayoutSplit((split) => !split)}
            aria-pressed={isLayoutSplit}
            title="Toggle PDF preview"
            aria-label="Toggle PDF preview"
            className={`h-8 w-8 flex items-center justify-center rounded-lg transition-colors ${
              isLayoutSplit
                ? "bg-primary-fixed text-primary"
                : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
            }`}
          >
            <SplitSquareHorizontal className="w-[18px] h-[18px]" />
          </button>

          <Link
            href={`/editor-errors/${projectId}`}
            className="h-8 px-3 rounded-lg border border-primary text-primary text-xs font-semibold flex items-center gap-1 hover:bg-primary-fixed hover:text-primary transition-colors"
          >
            Review
          </Link>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Icon rail */}
        <aside className="w-12 shrink-0 border-r border-surface-container-high bg-surface-container-lowest flex flex-col items-center py-2.5 justify-between z-20">
          <div className="flex flex-col items-center gap-1.5 w-full">
            <span
              className="relative w-8 h-8 rounded-md flex items-center justify-center text-primary bg-primary-fixed"
              title="Project files"
            >
              <FolderOpen className="w-[19px] h-[19px]" />
              <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary rounded-r-full" />
            </span>
            <button
              type="button"
              onClick={() => setIsLogsOpen(true)}
              className="w-8 h-8 rounded-md flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors"
              title="Search project files"
              aria-label="Search project files"
            >
              <Search className="w-[19px] h-[19px]" />
            </button>
            <SymbolPalette onInsert={insertAtCaret} />
            <Link
              href={`/history/${projectId}`}
              className="w-8 h-8 rounded-md flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors"
              title="Project overview"
              aria-label="Project overview"
            >
              <History className="w-[19px] h-[19px]" />
            </Link>
          </div>

          <div className="flex flex-col items-center gap-1.5 w-full">
            {diagnostics.errors.length > 0 && (
              <button
                type="button"
                onClick={() => setIsLogsOpen(true)}
                className="relative w-8 h-8 rounded-md flex items-center justify-center text-error hover:bg-error-container/40 transition-colors"
                title={`${diagnostics.errors.length} compile errors`}
                aria-label={`${diagnostics.errors.length} compile errors`}
              >
                <AlertTriangle className="w-[19px] h-[19px]" />
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-error ring-1 ring-surface-container-lowest" />
              </button>
            )}
            <Link
              href="/settings"
              className="w-8 h-8 rounded-md flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors"
              title="Settings"
              aria-label="Settings"
            >
              <Sliders className="w-[19px] h-[19px]" />
            </Link>
          </div>
        </aside>

        {/* File tree */}
        <div className="w-[260px] shrink-0 border-r border-surface-container-high bg-surface-bright flex flex-col min-h-0">
          <FileTree
            tree={tree}
            selectedPath={selectedPath}
            dirtyPaths={dirtyPaths}
            canEdit={canEdit}
            onSelect={(path) => void selectFile(path)}
            onCreateFile={(path) => void handleCreateFile(path)}
            onRename={(from, to) => void handleRename(from, to)}
            onDelete={(path) => setDeleteTarget(path)}
          />

          {/* Outline of the open file */}
          <div className="border-t border-surface-container-high bg-surface-container-low p-2 shrink-0 max-h-[40%] overflow-y-auto">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-outline uppercase tracking-wider">
                File Outline
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-outline" />
            </div>
            {outline.length === 0 ? (
              <p className="text-[11px] font-sans text-outline">No sections found.</p>
            ) : (
              <div className="space-y-0.5 text-[11px] font-mono">
                {outline.map((entry) => (
                  <button
                    key={`${entry.line}-${entry.title}`}
                    type="button"
                    onClick={() => {
                      setJumpToLine(entry.line);
                      setJumpNonce((n) => n + 1);
                    }}
                    className="w-full text-left px-2 py-0.5 truncate text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded transition-colors"
                    style={{ paddingLeft: `${8 + (entry.level - 1) * 8}px` }}
                    title={`Line ${entry.line}`}
                  >
                    {entry.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          <div className="h-10 px-2 border-b border-surface-container-high flex items-center justify-between shrink-0 bg-surface-container-lowest">
            <div className="flex items-center gap-1 min-w-0">
              <span className="h-7 px-2 rounded text-xs font-medium bg-primary-fixed text-primary flex items-center gap-1.5">
                <FileCode2 className="w-3.5 h-3.5" />
                <span className="truncate">{selectedPath ?? "No file open"}</span>
                {selectedPath && dirtyPaths.has(selectedPath) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-tertiary" aria-label="Unsaved" />
                )}
              </span>
              {isReadOnly && (
                <span className="text-[10px] font-medium text-outline px-1.5 py-0.5 rounded bg-surface-container-low">
                  Read only
                </span>
              )}
            </div>

            {canEdit && selectedPath && (
              <div className="flex items-center gap-0.5">
                {SNIPPETS.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    title={`Insert ${item.title}`}
                    aria-label={`Insert ${item.title}`}
                    onClick={() => insertAtCaret(item.snippet)}
                    className="w-7 h-7 rounded flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low transition-colors"
                  >
                    <span className={`text-xs ${item.className ?? ""}`}>{item.icon}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0">
            {selectedPath ? (
              <CodeEditor
                // The nonce forces a jump even when the line number repeats, which
                // a plain number prop cannot express.
                key={`${selectedPath}:${jumpNonce}`}
                path={selectedPath}
                value={content}
                onChange={setContent}
                readOnly={!canEdit}
                onSave={() => void saveNow()}
                onCursorChange={setCursor}
                jumpToLine={jumpToLine}
                insertRequest={insertRequest}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
                <FileCode2 className="w-8 h-8 text-outline opacity-50" />
                <p className="text-sm text-on-surface-variant">No file selected</p>
                <p className="text-xs text-outline max-w-xs leading-relaxed">
                  {files.length === 0
                    ? "This project has no files yet. Create one from the file tree to begin."
                    : "Choose a file from the tree to start editing."}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* PDF preview */}
        {isLayoutSplit && (
          <div className="w-[42%] min-w-[380px] shrink-0 border-l border-surface-container-high bg-surface-dim flex flex-col min-h-0">
            <PdfPreview
              pdfBase64={compileResult?.success ? compileResult.pdf : null}
              isCompiling={isCompiling}
              error={compileError ?? (compileResult && !compileResult.success ? compileResult.error : null)}
              errorCount={diagnostics.errors.length}
              onCompile={() => void compileNow()}
              onOpenLogs={() => setIsLogsOpen(true)}
            />
          </div>
        )}
      </div>

      <footer className="h-7 shrink-0 bg-surface-container-lowest border-t border-surface-container-high px-3 flex items-center justify-between text-xs text-on-surface-variant z-40">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            {saveState === "saving" ? (
              <CloudUpload className="w-3.5 h-3.5 text-secondary" />
            ) : saveState === "error" ? (
              <AlertTriangle className="w-3.5 h-3.5 text-error" />
            ) : (
              <CloudCheck className="w-3.5 h-3.5 text-secondary" />
            )}
            <span className={saveState === "error" ? "text-error" : undefined}>{saveLabel}</span>
          </div>
          {saveError && <span className="text-error truncate max-w-[280px]">{saveError}</span>}
          {panelError && <span className="text-error truncate max-w-[280px]">{panelError}</span>}
          {compileResult?.success && (
            <span className="text-outline">
              Compiled in {compileResult.compile_time.toFixed(1)}s
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span>
            Line {cursor.line}, Col {cursor.column}
          </span>
          <span>UTF-8</span>
          <span>pdfLaTeX</span>
        </div>
      </footer>

      {/* Compile status banner, shown only when there is something to say. */}
      {(diagnostics.errors.length > 0 || diagnostics.warnings.length > 0) && (
        <CompileStatusBanner
          errorCount={diagnostics.errors.length}
          warningCount={diagnostics.warnings.length}
          onShowLogs={() => setIsLogsOpen(true)}
        />
      )}

      <CompileLogsDrawer
        isOpen={isLogsOpen}
        onClose={() => setIsLogsOpen(false)}
        errors={diagnostics.errors}
        warnings={diagnostics.warnings}
        rawLog={compileResult?.log ?? ""}
        compileTime={compileResult?.compile_time}
        onNavigateToLine={handleNavigateToDiagnostic}
      />

      <ShareProjectModal
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        projectId={projectId}
        projectTitle={project?.name ?? ""}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete file"
        body={`This permanently removes ${deleteTarget ?? ""} and cannot be undone.`}
        confirmLabel="Delete"
        isDestructive
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
