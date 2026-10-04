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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { usePanelResize } from "@/hooks/usePanelResize";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  CloudCheck,
  CloudUpload,
  FileCode2,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  History,
  Loader2,
  Search,
  Share2,
  Sliders,
  SplitSquareHorizontal,
  Upload,
  X,
} from "lucide-react";

import CodeEditor, {
  type CursorPosition,
  type HistoryState,
} from "@/components/editor/CodeEditor";import EditorToolbar from "@/components/editor/EditorToolbar";
import EditorMenuBar from "@/components/editor/EditorMenuBar";
import FileTree from "@/components/editor/FileTree";
import SymbolPalette from "@/components/editor/SymbolPalette";
import PdfPreview from "@/components/editor/PdfPreview";
import CompileLogsDrawer from "@/components/editor/CompileLogsDrawer";
import CompileStatusBanner from "@/components/editor/CompileStatusBanner";
import EditorLoadingSkeleton from "@/components/states/EditorLoadingSkeleton";
import ConfirmDialog from "@/components/dashboard/ConfirmDialog";
import { ShareProjectModal } from "@/components/modals/ShareProjectModal";
import { parseOutline } from "@/lib/fileTree";
import type { EditorCommand } from "@/lib/latexInsert";
import { WRAP_PRESETS } from "@/lib/latexInsert";
import { useCurrentUser } from "@/hooks/useProjects";
import { useEditorProject } from "@/hooks/useEditorProject";

/**
 * Whether a keyboard event came from inside the source buffer.
 *
 * The page handles shortcuts at the document level so they work from anywhere on
 * the page, but a formatting shortcut must not fire while the user is typing a
 * file name into the tree or focusing a filter box.
 */
function isEditorFocused(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("[data-testid='code-editor']") !== null;
}

export default function EditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = typeof params?.id === "string" ? params.id : "";

  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const { user } = useCurrentUser();
  const editor = useEditorProject(projectId, user?.id ?? null);

  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isLayoutSplit, setIsLayoutSplit] = useState(true);
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 });
  const [jumpToLine, setJumpToLine] = useState<number | null>(null);
  const [command, setCommand] = useState<EditorCommand | null>(null);
  const [history, setHistory] = useState<HistoryState>({ canUndo: false, canRedo: false });
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  /** Distinguishes repeated jumps to the same line, which a number cannot. */
  const [jumpNonce, setJumpNonce] = useState(0);

  // ── Active sidebar panel — null means panel is collapsed ──────────────────
  type SidePanel = "files" | "search" | "history";
  const [activePanel, setActivePanel] = useState<SidePanel | null>("files");
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newItemPath, setNewItemPath] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const togglePanel = (panel: SidePanel) =>
    setActivePanel((cur) => (cur === panel ? null : panel));

  // ── Resizable panels ──────────────────────────────────────────────────────
  const TREE_MIN = 160;
  const TREE_MAX = 480;
  const PDF_MIN = 280;
  const PDF_MAX = 800;

  const [treeWidth, setTreeWidth] = useState(260);
  const [pdfWidth, setPdfWidth] = useState(420);

  const { startDrag: startTreeDrag } = usePanelResize((w) =>
    setTreeWidth(Math.min(TREE_MAX, Math.max(TREE_MIN, w))),
  );

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

  // ── File upload from local disk ────────────────────────────────────────────
  const handleUploadFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList) return;
      for (const file of Array.from(fileList)) {
        const reader = new FileReader();
        await new Promise<void>((resolve) => {
          reader.onload = async () => {
            const content =
              typeof reader.result === "string"
                ? reader.result
                : "";
            await createFile(file.name, content);
            resolve();
          };
          reader.readAsText(file);
        });
      }
    },
    [createFile],
  );

  // ── New file / folder inline creation ──────────────────────────────────────
  const submitNewItem = useCallback(
    (isFolder: boolean) => {
      const path = newItemPath.trim();
      if (!path) {
        setIsCreatingFile(false);
        setIsCreatingFolder(false);
        return;
      }
      if (isFolder) {
        // Folders are materialised by creating a .gitkeep inside
        void createFile(`${path}/.gitkeep`, "");
      } else {
        void createFile(path.includes(".") ? path : `${path}.tex`, "");
      }
      setNewItemPath("");
      setIsCreatingFile(false);
      setIsCreatingFolder(false);
    },
    [createFile, newItemPath],
  );

  const diagnostics = useMemo(
    () => ({
      errors: compileResult?.errors ?? [],
      warnings: compileResult?.warnings ?? [],
    }),
    [compileResult],
  );

  const outline = useMemo(() => (selectedPath ? parseOutline(content) : []), [selectedPath, content]);

  // Ctrl/Cmd+S saves, Ctrl/Cmd+Enter compiles, and Ctrl/Cmd+B/I format the
  // selection, from anywhere on the page. The formatting pair is scoped to the
  // buffer so it cannot hijack the same keys in a file-name field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.key === "s") {
        event.preventDefault();
        void saveNow();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void compileNow();
        return;
      }
      if (!canEdit || !isEditorFocused(event.target)) return;

      const key = event.key.toLowerCase();
      if (key !== "b" && key !== "i") return;
      // The caret or selection is unknown here, so only the delimiters are
      // chosen; the editor reads the live selection when it runs the command.
      event.preventDefault();
      setCommand({
        kind: "wrap",
        ...(key === "b" ? WRAP_PRESETS.bold : WRAP_PRESETS.italic),
        nonce: Date.now(),
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canEdit, compileNow, saveNow]);

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
   * Hands a toolbar edit to the editor.
   *
   * The command is queued as state rather than spliced into `content` here: the
   * caret position is only known inside CodeMirror, and the resulting change
   * travels back through the normal `onChange` path, so one Ctrl+Z removes the
   * whole snippet instead of the buffer being clobbered by a replacement.
   */
  const runCommand = useCallback(
    (next: EditorCommand) => {
      if (!canEdit || !selectedPath) return;
      setCommand(next);
    },
    [canEdit, selectedPath],
  );

  /** The symbol palette inserts literal LaTeX, which is a plain insert. */
  const insertAtCaret = useCallback(
    (latex: string) => {
      runCommand({ kind: "insert", text: latex, nonce: Date.now() });
    },
    [runCommand],
  );

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? "Save failed"
        : dirtyPaths.size > 0
          ? "Unsaved"
          : "Saved";

  // Wait for Clerk to load before attempting to load the project
  if (!clerkLoaded) {
    return <EditorLoadingSkeleton />;
  }

  // Redirect to sign-in if not authenticated
  if (!isSignedIn) {
    router.push("/sign-in");
    return <EditorLoadingSkeleton />;
  }

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

      {/* Menu bar — File / Edit / Insert / Format / View / Help */}
      <EditorMenuBar
        projectName={project?.name ?? ""}
        canEdit={canEdit}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        isLayoutSplit={isLayoutSplit}
        onUndo={() => setCommand({ kind: "undo", nonce: Date.now() })}
        onRedo={() => setCommand({ kind: "redo", nonce: Date.now() })}
        onFind={() => setCommand({ kind: "find", nonce: Date.now() })}
        onSave={() => void saveNow()}
        onCompile={() => void compileNow()}
        onCreateFile={() => handleCreateFile("new-file.tex")}
        onToggleLayout={() => setIsLayoutSplit((s) => !s)}
        onDownloadZip={() => window.alert("ZIP download coming soon.")}
        onShowHistory={() => router.push(`/history/${projectId}`)}
        onInsert={(latex) => runCommand({ kind: "insert", text: latex, nonce: Date.now() })}
      />

      <div className="flex-1 flex min-h-0">
        {/* Icon rail */}
        <aside className="w-12 shrink-0 border-r border-surface-container-high bg-surface-container-lowest flex flex-col items-center py-2 gap-1 justify-between z-20">
          <div className="flex flex-col items-center gap-1 w-full">
            {/* Files */}
            <button
              type="button"
              onClick={() => togglePanel("files")}
              title="Project files"
              aria-label="Project files"
              className={`relative w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                activePanel === "files"
                  ? "text-primary bg-primary-fixed"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low"
              }`}
            >
              <FolderOpen className="w-[19px] h-[19px]" />
              {activePanel === "files" && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary rounded-r-full" />
              )}
            </button>

            {/* Search */}
            <button
              type="button"
              onClick={() => togglePanel("search")}
              title="Search files"
              aria-label="Search files"
              className={`relative w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                activePanel === "search"
                  ? "text-primary bg-primary-fixed"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low"
              }`}
            >
              <Search className="w-[19px] h-[19px]" />
              {activePanel === "search" && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary rounded-r-full" />
              )}
            </button>

            {/* History */}
            <button
              type="button"
              onClick={() => togglePanel("history")}
              title="Version history"
              aria-label="Version history"
              className={`relative w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                activePanel === "history"
                  ? "text-primary bg-primary-fixed"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low"
              }`}
            >
              <History className="w-[19px] h-[19px]" />
              {activePanel === "history" && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-primary rounded-r-full" />
              )}
            </button>

            <SymbolPalette onInsert={insertAtCaret} />
          </div>

          <div className="flex flex-col items-center gap-1 w-full">
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

        {/* Side panel — shown only when a panel is active */}
        {activePanel !== null && (
          <div
            style={{ width: treeWidth, minWidth: TREE_MIN, maxWidth: TREE_MAX }}
            className="shrink-0 bg-surface-bright flex flex-col min-h-0 relative border-r border-surface-container-high"
          >
            {/* ── Files panel ───────────────────────────────────────────── */}
            {activePanel === "files" && (
              <>
                {/* Panel header */}
                <div className="h-9 px-2.5 flex items-center justify-between border-b border-surface-container-high bg-surface-container-lowest shrink-0">
                  <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider flex items-center gap-1">
                    <ChevronDown className="w-3 h-3" />
                    File tree
                  </span>
                  {canEdit && (
                    <div className="flex items-center gap-0.5">
                      {/* New file */}
                      <button
                        type="button"
                        onClick={() => { setIsCreatingFile(true); setIsCreatingFolder(false); setNewItemPath(""); }}
                        title="New file"
                        aria-label="New file"
                        className="w-6 h-6 rounded flex items-center justify-center text-outline hover:bg-surface-container-low hover:text-on-surface transition-colors"
                      >
                        <FilePlus2 className="w-[15px] h-[15px]" />
                      </button>
                      {/* New folder */}
                      <button
                        type="button"
                        onClick={() => { setIsCreatingFolder(true); setIsCreatingFile(false); setNewItemPath(""); }}
                        title="New folder"
                        aria-label="New folder"
                        className="w-6 h-6 rounded flex items-center justify-center text-outline hover:bg-surface-container-low hover:text-on-surface transition-colors"
                      >
                        <FolderPlus className="w-[15px] h-[15px]" />
                      </button>
                      {/* Upload */}
                      <button
                        type="button"
                        onClick={() => uploadInputRef.current?.click()}
                        title="Upload file"
                        aria-label="Upload file"
                        className="w-6 h-6 rounded flex items-center justify-center text-outline hover:bg-surface-container-low hover:text-on-surface transition-colors"
                      >
                        <Upload className="w-[15px] h-[15px]" />
                      </button>
                      {/* Close panel */}
                      <button
                        type="button"
                        onClick={() => setActivePanel(null)}
                        title="Close panel"
                        aria-label="Close panel"
                        className="w-6 h-6 rounded flex items-center justify-center text-outline hover:bg-surface-container-low hover:text-on-surface transition-colors"
                      >
                        <X className="w-[13px] h-[13px]" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Hidden file input for upload */}
                <input
                  ref={uploadInputRef}
                  type="file"
                  multiple
                  accept=".tex,.bib,.sty,.cls,.bst,.png,.jpg,.jpeg,.pdf,.svg,.eps,.txt"
                  className="hidden"
                  onChange={(e) => void handleUploadFiles(e.target.files)}
                />

                {/* Inline new-file / new-folder input */}
                {(isCreatingFile || isCreatingFolder) && (
                  <form
                    className="px-2 py-1 border-b border-surface-container-high bg-surface-container-lowest"
                    onSubmit={(e) => { e.preventDefault(); submitNewItem(isCreatingFolder); }}
                  >
                    <div className="flex items-center gap-1">
                      {isCreatingFolder
                        ? <FolderPlus className="w-3.5 h-3.5 text-outline shrink-0" />
                        : <FilePlus2 className="w-3.5 h-3.5 text-outline shrink-0" />
                      }
                      <input
                        autoFocus
                        value={newItemPath}
                        onChange={(e) => setNewItemPath(e.target.value)}
                        onBlur={() => submitNewItem(isCreatingFolder)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setIsCreatingFile(false);
                            setIsCreatingFolder(false);
                            setNewItemPath("");
                          }
                        }}
                        placeholder={isCreatingFolder ? "folder-name" : "file.tex"}
                        aria-label={isCreatingFolder ? "New folder name" : "New file path"}
                        className="flex-1 bg-surface-container-lowest border border-primary rounded px-1.5 py-0.5 text-[11px] font-mono outline-none"
                      />
                    </div>
                  </form>
                )}

                {/* File tree */}
                <div className="flex-1 min-h-0 overflow-y-auto">
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
                </div>

                {/* File outline */}
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
              </>
            )}

            {/* ── Search panel ──────────────────────────────────────────── */}
            {activePanel === "search" && (
              <>
                <div className="h-9 px-2.5 flex items-center justify-between border-b border-surface-container-high bg-surface-container-lowest shrink-0">
                  <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
                    Search
                  </span>
                  <button
                    type="button"
                    onClick={() => setActivePanel(null)}
                    className="w-6 h-6 rounded flex items-center justify-center text-outline hover:bg-surface-container-low hover:text-on-surface transition-colors"
                    aria-label="Close search"
                  >
                    <X className="w-[13px] h-[13px]" />
                  </button>
                </div>
                <div className="p-2 border-b border-surface-container-high">
                  <div className="flex gap-1">
                    <input
                      autoFocus
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search all files…"
                      className="flex-1 bg-surface-container-lowest border border-surface-container-high rounded px-2 py-1 text-[12px] outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      className="px-2 py-1 rounded bg-primary text-on-primary text-[11px] font-semibold"
                      onClick={() => setCommand({ kind: "find", nonce: Date.now() })}
                    >
                      Find
                    </button>
                  </div>
                  <p className="text-[10px] text-outline mt-1.5">
                    Use Ctrl+F to search within the current file.
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  <p className="text-[11px] text-outline text-center mt-8">
                    {searchQuery ? `No results for "${searchQuery}"` : "Type to search across project files."}
                  </p>
                </div>
              </>
            )}

            {/* ── History panel ─────────────────────────────────────────── */}
            {activePanel === "history" && (
              <>
                <div className="h-9 px-2.5 flex items-center justify-between border-b border-surface-container-high bg-surface-container-lowest shrink-0">
                  <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
                    Version History
                  </span>
                  <button
                    type="button"
                    onClick={() => setActivePanel(null)}
                    className="w-6 h-6 rounded flex items-center justify-center text-outline hover:bg-surface-container-low hover:text-on-surface transition-colors"
                    aria-label="Close history"
                  >
                    <X className="w-[13px] h-[13px]" />
                  </button>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4 text-center">
                  <History className="w-8 h-8 text-outline opacity-50" />
                  <p className="text-[12px] text-on-surface-variant">
                    View and restore previous versions of this project.
                  </p>
                  <Link
                    href={`/history/${projectId}`}
                    className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[12px] font-semibold hover:bg-primary-container transition-colors"
                  >
                    Open History
                  </Link>
                </div>
              </>
            )}

            {/* Resize grip — right edge */}
            <div
              onMouseDown={(e) => startTreeDrag(e, treeWidth)}
              className="absolute top-0 right-0 h-full w-1 cursor-col-resize group z-30"
              aria-hidden="true"
            >
              <div className="h-full w-full bg-surface-container-high group-hover:bg-primary transition-colors" />
            </div>
          </div>
        )}

        {/* Editor */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          <EditorToolbar
            content={selectedPath ? content : null}
            canEdit={canEdit && selectedPath !== null}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onCommand={runCommand}
            leading={
              <>
                <span className="h-7 px-2 rounded text-xs font-medium bg-primary-fixed text-primary flex items-center gap-1.5 min-w-0">
                  <FileCode2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{selectedPath ?? "No file open"}</span>
                  {selectedPath && dirtyPaths.has(selectedPath) && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-tertiary shrink-0"
                      aria-label="Unsaved"
                    />
                  )}
                </span>
                {isReadOnly && (
                  <span className="text-[10px] font-medium text-outline px-1.5 py-0.5 rounded bg-surface-container-low shrink-0">
                    Read only
                  </span>
                )}
              </>
            }
          />

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
                command={command}
                onHistoryChange={setHistory}
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

        {/* PDF preview — resizable */}
        {isLayoutSplit && (
          <div
            style={{ width: pdfWidth, minWidth: PDF_MIN, maxWidth: PDF_MAX }}
            className="shrink-0 bg-surface-dim flex flex-col min-h-0 relative"
          >
            {/* Resize grip — left edge of the PDF panel */}
            <div
              onMouseDown={(e) => {
                // Dragging right shrinks PDF, dragging left grows it.
                // Invert: we track startWidth as pdfWidth and subtract delta.
                e.preventDefault();
                const startX = e.clientX;
                const startW = pdfWidth;
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
                const onMove = (ev: MouseEvent) => {
                  const delta = ev.clientX - startX;
                  setPdfWidth(Math.min(PDF_MAX, Math.max(PDF_MIN, startW - delta)));
                };
                const onUp = () => {
                  document.body.style.cursor = "";
                  document.body.style.userSelect = "";
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
              className="absolute top-0 left-0 h-full w-1 cursor-col-resize group z-30"
              title="Drag to resize"
              aria-hidden="true"
            >
              <div className="h-full w-full bg-surface-container-high group-hover:bg-primary transition-colors" />
            </div>

            <PdfPreview
              pdfBase64={compileResult?.success ? compileResult.pdf : null}
              synctexBase64={compileResult?.success ? (compileResult.synctex || null) : null}
              isCompiling={isCompiling}
              error={compileError ?? (compileResult && !compileResult.success ? compileResult.error : null)}
              errorCount={diagnostics.errors.length}
              onCompile={() => void compileNow()}
              onOpenLogs={() => setIsLogsOpen(true)}
              onJumpToLine={(line) => {
                setJumpToLine(line);
                setJumpNonce((n) => n + 1);
              }}
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
