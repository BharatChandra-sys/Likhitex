"use client";

/**
 * Editor state: the project's files, the open buffer, and compilation.
 *
 * Contents are held in memory keyed by path because the compile endpoint takes
 * the whole project at once (`POST /api/compile/` expects every file as a
 * path->text map). A buffer is therefore the source of truth for what will be
 * compiled, and saves push it to the API in the background.
 *
 * Two rules shape the code:
 * - Compiling uses unsaved buffers, so the PDF always matches what is on screen.
 * - Writes are debounced per file, and selecting another file flushes the
 *   outgoing one first, so switching tabs can never lose an edit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api/client";
import type {
  CompileResponse,
  Diagnostic,
  FileResponse,
  ProjectDetailResponse,
  Role,
} from "@/lib/api/types";
import {
  buildFileTree,
  isTextPath,
  pickInitialFile,
  type TreeDir,
} from "@/lib/fileTree";

/** How long after the last keystroke a buffer is written to the API. */
export const AUTOSAVE_DELAY_MS = 1200;

/**
 * Browsers drop a `fetch(..., { keepalive: true })` body above this size, so a
 * larger buffer is sent without the flag and allowed to outlive the page normally.
 * Matches the Fetch spec's 64 KiB keepalive content limit.
 */
const KEEPALIVE_MAX_BYTES = 64 * 1024;

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface EditorFile {
  path: string;
  type: string;
  sizeBytes: number;
  /** False for binaries: they can be listed and downloaded, not opened. */
  isText: boolean;
}

export interface UseEditorProjectResult {
  project: ProjectDetailResponse | null;
  files: EditorFile[];
  tree: TreeDir;
  selectedPath: string | null;
  /** Current buffer text. Empty string when no text file is open. */
  content: string;
  /**
   * Buffer text for any file in the project, loaded or not.
   *
   * `undefined` means the file has not been fetched yet. Compilation needs every
   * file's text, so it reads through this rather than the single open buffer.
   */
  contentsFor: (path: string) => string | undefined;
  /** Ensures every text file's content is loaded, then returns it. */
  loadAllContents: () => Promise<Record<string, string>>;
  isLoading: boolean;
  loadError: ApiError | null;

  /** True when the signed-in user may write: EDITOR or OWNER. */
  canEdit: boolean;
  /** True when the user is only a VIEWER, so writes must be hidden, not just disabled. */
  isReadOnly: boolean;

  saveState: SaveState;
  saveError: string | null;

  /** Paths with edits not yet written to the API. */
  dirtyPaths: ReadonlySet<string>;

  selectFile: (path: string) => void;
  setContent: (value: string) => void;
  saveNow: () => Promise<void>;
  createFile: (path: string, initialContent?: string) => Promise<boolean>;
  renameFile: (fromPath: string, toPath: string) => Promise<boolean>;
  deleteFile: (path: string) => Promise<boolean>;

  isCompiling: boolean;
  compileResult: CompileResponse | null;
  compileError: string | null;
  /**
   * Runs a compile, recording the result.
   *
   * Returns the response so a caller can react to a specific outcome; the editor
   * itself ignores it, which is why the public type stays `Promise<void>`.
   */
  compileNow: () => Promise<void>;
  /** As `compileNow`, but resolves with the compile response. */
  compileAndReport: () => Promise<CompileResponse | null>;

  /** Reloads the file list from the API, e.g. after an external change. */
  refreshFiles: () => Promise<void>;
}

function toEditorFile(file: FileResponse): EditorFile {
  return {
    path: file.path,
    type: file.type,
    sizeBytes: file.size_bytes,
    isText: isTextPath(file.path),
  };
}

/** Effective role of `userId` on `project`, mirroring the API's own resolution. */
export function effectiveRole(
  project: Pick<ProjectDetailResponse, "owner" | "members"> | null,
  userId: string | null,
): Role | null {
  if (!project || !userId) return null;
  if (project.owner.id === userId) return "owner";

  const membership = project.members.find((member) => member.user.id === userId);
  return membership ? membership.role : null;
}

export function useEditorProject(projectId: string, userId: string | null): UseEditorProjectResult {
  const [project, setProject] = useState<ProjectDetailResponse | null>(null);
  const [files, setFiles] = useState<EditorFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [dirtyPaths, setDirtyPaths] = useState<ReadonlySet<string>>(new Set());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileResult, setCompileResult] = useState<CompileResponse | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  /**
   * Latest state, for async callbacks that must not be re-created per keystroke.
   *
   * Autosave timers, the compile loop and `selectFile` all need current values
   * but are wired up once, so they cannot close over them directly. The snapshot
   * is refreshed in an effect rather than during render: assigning a ref while
   * rendering is impure, and the compiler's lint rules reject it. Effects run
   * before any user interaction can fire, so the snapshot is never stale when it
   * is actually read.
   */
  const latest = useRef({ contents, files, selectedPath, dirtyPaths });
  useEffect(() => {
    latest.current = { contents, files, selectedPath, dirtyPaths };
  });

  const clearTimer = useCallback((path: string) => {
    const timer = timers.current.get(path);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(path);
    }
  }, []);

  const role = useMemo(() => effectiveRole(project, userId), [project, userId]);
  const canEdit = role === "editor" || role === "owner";
  const isReadOnly = role === "viewer";

  /** Loads the file list and pushes it into state. */
  const loadFileList = useCallback(async () => {
    const response = await api.listFiles(projectId);
    const next = response.files.map(toEditorFile);
    setFiles(next);
    return next;
  }, [projectId]);

  /**
   * Maps a path to its file id.
   *
   * The single-file endpoints address files by UUID, but the rest of the editor
   * works in paths, and `FileResponse` carries both. Rather than keep a second
   * id-keyed map in sync with the tree, the path is resolved on demand.
   */
  const fileIdFor = useCallback(
    async (path: string): Promise<string> => {
      const detail = await api.listFiles(projectId);
      const match = detail.files.find((f) => f.path === path);
      if (!match) throw new ApiError(404, `File not found: ${path}`, { code: "not_found" });
      return match.id;
    },
    [projectId],
  );

  /** Fetches a file's inline content, unless the buffer already holds it. */
  const fetchContent = useCallback(
    async (path: string): Promise<string> => {
      const cached = latest.current.contents[path];
      if (cached !== undefined) return cached;

      const file = latest.current.files.find((f) => f.path === path);
      if (file && !file.isText) return "";

      const detail = await api.getFile(projectId, await fileIdFor(path));
      return detail.content ?? "";
    },
    [projectId, fileIdFor],
  );

  // Initial load: project metadata plus the file list.
  useEffect(() => {
    if (!projectId) return;

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      // Inside the async body rather than the effect body: `isLoading` already
      // starts true, and setting it here avoids a synchronous re-render.
      setIsLoading(true);
      setLoadError(null);

      try {
        const [projectDetail, fileList] = await Promise.all([
          api.getProject(projectId, { signal: controller.signal }),
          api.listFiles(projectId, { signal: controller.signal }),
        ]);
        if (cancelled) return;

        setProject(projectDetail);
        setFiles(fileList.files.map(toEditorFile));

        const initial = pickInitialFile(fileList.files);
        if (initial) setSelectedPath((current) => current ?? initial);
      } catch (cause) {
        if (cancelled || controller.signal.aborted) return;
        setLoadError(
          cause instanceof ApiError ? cause : new ApiError(0, "Could not load project"),
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [projectId]);

  /** Loads the selected file's content whenever the selection changes. */
  useEffect(() => {
    if (!selectedPath) return;

    let cancelled = false;
    const file = files.find((f) => f.path === selectedPath);
    if (!file?.isText) return;

    if (contents[selectedPath] !== undefined) return;

    (async () => {
      try {
        const detail = await api.getFile(projectId, await fileIdFor(selectedPath));
        if (cancelled) return;
        setContents((current) => ({ ...current, [selectedPath]: detail.content ?? "" }));
      } catch {
        // A failed load leaves an empty buffer rather than blocking the editor;
        // the file remains selectable and saving will overwrite it.
        if (!cancelled) {
          setContents((current) =>
            current[selectedPath] === undefined ? { ...current, [selectedPath]: "" } : current,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedPath, projectId, files, contents, fileIdFor]);

  const persist = useCallback(
    async (path: string): Promise<boolean> => {
      const text = latest.current.contents[path];
      if (text === undefined) return true;

      setSaveState("saving");
      setSaveError(null);

      try {
        const fileId = await fileIdFor(path);
        await api.updateFile(projectId, fileId, { content: text });
        setDirtyPaths((current) => {
          if (!current.has(path)) return current;
          const next = new Set(current);
          next.delete(path);
          return next;
        });
        setSaveState("saved");
        return true;
      } catch (cause) {
        // The edit stays in the buffer and remains dirty, so nothing is lost and
        // the next keystroke or manual save retries it.
        setSaveState("error");
        setSaveError(
          cause instanceof ApiError ? cause.message : "Could not save file",
        );
        return false;
      }
    },
    [projectId, fileIdFor],
  );

  const scheduleSave = useCallback(
    (path: string) => {
      clearTimer(path);
      timers.current.set(
        path,
        setTimeout(() => {
          timers.current.delete(path);
          void persist(path);
        }, AUTOSAVE_DELAY_MS),
      );
    },
    [clearTimer, persist],
  );

  /**
   * Flushes every dirty buffer immediately, ignoring the debounce.
   *
   * Used when the page is being hidden or torn down. The pending timers are
   * discarded rather than awaited: a backgrounded tab has its timers throttled
   * (Chrome after 10s, Firefox after 30s), so waiting for the debounce would
   * often mean never saving at all.
   */
  const flushDirty = useCallback(async () => {
    const dirty = [...latest.current.dirtyPaths];
    for (const path of dirty) clearTimer(path);

    await Promise.all(dirty.map((path) => persist(path)));
  }, [clearTimer, persist]);

  // Unmount must not discard pending work. An earlier version cancelled the timers
  // here to avoid a setState-after-unmount warning, which silently threw away any
  // edit made inside the debounce window -- real data loss on every navigation.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      void flushDirty();
    };
  }, [flushDirty]);

  /**
   * Saves when the tab is hidden or closed.
   *
   * `visibilitychange` is used rather than `beforeunload` because MDN documents
   * `beforeunload` as unreliable (often not fired on mobile) and bfcache-hostile,
   * which costs back-navigation performance in Firefox. `pagehide` is registered
   * as the fallback for browsers that miss `visibilitychange`.
   *
   * `fetch` with `keepalive` is used, not `sendBeacon`: the beacon quota is 64 KiB
   * across all queued beacons, and a LaTeX file routinely exceeds that, so it
   * would fail silently. `keepalive` has the same 64 KiB content limit, so small
   * files go out immediately and larger ones fall back to a normal request, which
   * the browser continues after the page is gone.
   */
  useEffect(() => {
    if (!canEdit) return;

    const onHidden = () => {
      const dirty = [...latest.current.dirtyPaths];
      if (dirty.length === 0) return;

      void (async () => {
        for (const path of dirty) {
          const text = latest.current.contents[path];
          if (text === undefined) continue;

          try {
            const fileId = await fileIdFor(path);
            // Keepalive lets the request outlive the document; browsers cap the
            // body, past which they drop it, hence the byte check.
            const smallEnough = new Blob([text]).size <= KEEPALIVE_MAX_BYTES;
            await api.updateFile(projectId, fileId, { content: text }, { keepalive: smallEnough });
          } catch {
            // Nothing useful can be reported once the page is going away; the
            // dirty flag would have been cleared on the next successful save.
          }
        }
      })();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") onHidden();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onHidden);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onHidden);
    };
  }, [canEdit, fileIdFor, projectId]);

  const setContent = useCallback(
    (value: string) => {
      const path = latest.current.selectedPath;
      if (!path) return;

      setContents((current) => ({ ...current, [path]: value }));
      setDirtyPaths((current) => new Set(current).add(path));
      setSaveState("idle");
      scheduleSave(path);
    },
    [scheduleSave],
  );

  /** Flushes the open buffer immediately, used before switching or compiling. */
  const saveNow = useCallback(async () => {
    const path = latest.current.selectedPath;
    if (!path) return;

    clearTimer(path);
    if (!latest.current.dirtyPaths.has(path)) return;
    await persist(path);
  }, [clearTimer, persist]);

  const selectFile = useCallback(
    async (path: string) => {
      if (path === latest.current.selectedPath) return;
      // Flush the outgoing buffer so its debounce cannot fire against a stale path.
      const outgoing = latest.current.selectedPath;
      if (outgoing) clearTimer(outgoing);
      if (outgoing && latest.current.dirtyPaths.has(outgoing)) await persist(outgoing);
      setSelectedPath(path);
    },
    [clearTimer, persist],
  );

  const refreshFiles = useCallback(async () => {
    try {
      const next = await loadFileList();
      setSelectedPath((current) => {
        if (current && next.some((f) => f.path === current)) return current;
        return pickInitialFile(next);
      });
    } catch {
      // A failed refresh leaves the current list in place; the next action retries.
    }
  }, [loadFileList]);

  const createFile = useCallback(
    async (path: string, initialContent = "") => {
      try {
        await api.uploadFile(projectId, { path, content: initialContent });
        setContents((current) => ({ ...current, [path]: initialContent }));
        await refreshFiles();
        setSelectedPath(path);
        return true;
      } catch (cause) {
        setSaveError(cause instanceof ApiError ? cause.message : "Could not create file");
        return false;
      }
    },
    [projectId, refreshFiles],
  );

  const deleteFile = useCallback(
    async (path: string) => {
      try {
        const fileId = await fileIdFor(path);
        await api.deleteFile(projectId, fileId);

        clearTimer(path);
        setContents((current) => {
          const next = { ...current };
          delete next[path];
          return next;
        });
        setDirtyPaths((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
        await refreshFiles();
        return true;
      } catch (cause) {
        setSaveError(cause instanceof ApiError ? cause.message : "Could not delete file");
        return false;
      }
    },
    [projectId, fileIdFor, clearTimer, refreshFiles],
  );

  /**
   * Renames by creating the new path and deleting the old one.
   *
   * The API has no rename endpoint, and this ordering keeps the content safe: if
   * the create fails the original is untouched, and only a failed delete after a
   * successful create leaves a duplicate, which is recoverable. Losing the file
   * would not be.
   */
  const renameFile = useCallback(
    async (fromPath: string, toPath: string) => {
      try {
        const content = latest.current.contents[fromPath] ?? "";
        await api.uploadFile(projectId, { path: toPath, content });
        const fileId = await fileIdFor(fromPath);
        await api.deleteFile(projectId, fileId);

        setContents((current) => {
          const next = { ...current, [toPath]: content };
          delete next[fromPath];
          return next;
        });
        setDirtyPaths((current) => {
          const next = new Set(current);
          next.delete(fromPath);
          return next;
        });
        await refreshFiles();
        setSelectedPath(toPath);
        return true;
      } catch (cause) {
        setSaveError(cause instanceof ApiError ? cause.message : "Could not rename file");
        return false;
      }
    },
    [projectId, fileIdFor, refreshFiles],
  );

  /**
   * Loads every text file's content, preferring buffers that are already in memory.
   *
   * Shared with the review page so both entry points compile the same bytes from
   * the same rule: unsaved buffers win, because that is what the user can see.
   */
  const loadAllContents = useCallback(async (): Promise<Record<string, string>> => {
    const payload: Record<string, string> = {};
    for (const file of latest.current.files) {
      if (!file.isText) continue;
      payload[file.path] = latest.current.contents[file.path] ?? (await fetchContent(file.path));
    }
    return payload;
  }, [fetchContent]);

  /** Runs a compile and records the result, shared by the editor and review page. */
  const runCompile = useCallback(async () => {
    // Already running: return null rather than a bare undefined so the resolved
    // type stays `CompileResponse | null`.
    if (isCompiling) return null;

    setIsCompiling(true);
    setCompileError(null);

    try {
      // Write the open buffer first: the PDF must reflect what is on screen.
      await saveNow();

      const payload = await loadAllContents();
      if (Object.keys(payload).length === 0) {
        setCompileError("This project has no text files to compile.");
        return null;
      }

      const result = await api.compile({ files: payload });
      setCompileResult(result);
      return result;
    } catch (cause) {
      setCompileError(
        cause instanceof ApiError ? cause.message : "Compilation failed to start",
      );
      return null;
    } finally {
      setIsCompiling(false);
    }
  }, [isCompiling, loadAllContents, saveNow]);

  const selectedFile = files.find((f) => f.path === selectedPath) ?? null;
  const content = selectedPath && selectedFile?.isText ? (contents[selectedPath] ?? "") : "";

  return {
    project,
    files,
    tree: useMemo(() => buildFileTree(files), [files]),
    selectedPath,
    content,
    contentsFor: (path: string) => contents[path],
    loadAllContents,
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
    // Wrapped so the public signature stays `Promise<void>`; `compileAndReport`
    // exposes the response for callers that need the outcome.
    compileNow: async () => {
      await runCompile();
    },
    compileAndReport: runCompile,
    refreshFiles,
  };
}

/** Convenience accessor for the diagnostics the editor surfaces. */
export function diagnosticsOf(result: CompileResponse | null): {
  errors: Diagnostic[];
  warnings: Diagnostic[];
} {
  if (!result) return { errors: [], warnings: [] };
  return { errors: result.errors ?? [], warnings: result.warnings ?? [] };
}
