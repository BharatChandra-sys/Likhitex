"use client";

/**
 * Editor state: the project's files, the open buffer, and compilation.
 *
 * Contents are held in memory keyed by path because the compile endpoint takes
 * the whole project at once (`POST /api/compile/` expects every file as a
 * path->text map). A buffer is therefore the source of truth for what will be
 * compiled, and saves push it to the API in the background.
 *
 * Three rules shape the code:
 * - Compiling uses unsaved buffers, so the PDF always matches what is on screen.
 * - Writes are debounced per file, and selecting another file flushes the
 *   outgoing one first, so switching tabs can never lose an edit.
 * - Each file's text is fetched at most once. File ids come from the list
 *   already in memory, and mutations patch that list from their own responses,
 *   so neither a save nor a compile re-lists the project.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { api, ApiError } from "@/lib/api/client";
import type { CompileResponse, FileResponse, ProjectDetailResponse, Role } from "@/lib/api/types";
import { buildFileTree, isTextPath, pickInitialFile, type TreeDir } from "@/lib/fileTree";

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
  id: string;
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
  /** True while the selected text file's content is still being fetched. */
  isFileLoading: boolean;
  /** Every buffer loaded so far, keyed by path; read lazily, e.g. for completion. */
  getBuffers: () => Readonly<Record<string, string>>;
  isLoading: boolean;
  loadError: ApiError | null;

  /** True when the signed-in user may write: EDITOR or OWNER. */
  canEdit: boolean;
  /** True when the user is only a VIEWER, so writes must be hidden, not just disabled. */
  isReadOnly: boolean;
  role: Role | null;

  saveState: SaveState;
  saveError: string | null;

  /** Paths with edits not yet written to the API. */
  dirtyPaths: ReadonlySet<string>;

  selectFile: (path: string) => void;
  setContent: (value: string) => void;
  saveNow: () => Promise<void>;
  createFile: (path: string, initialContent?: string, fileType?: string) => Promise<boolean>;
  renameFile: (fromPath: string, toPath: string) => Promise<boolean>;
  deleteFile: (path: string) => Promise<boolean>;

  isCompiling: boolean;
  compileResult: CompileResponse | null;
  compileError: string | null;
  /** When true, the next compile skips images for speed. */
  draftMode: boolean;
  setDraftMode: (draft: boolean) => void;
  compileNow: () => Promise<void>;
}

function toEditorFile(file: FileResponse): EditorFile {
  return {
    id: file.id,
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

const storageKey = (projectId: string) => `compile_result_${projectId}`;

/** The last compile, so a reload shows the PDF instead of an empty pane. */
function readStoredCompile(projectId: string): CompileResponse | null {
  if (typeof window === "undefined" || !projectId) return null;
  try {
    const stored = localStorage.getItem(storageKey(projectId));
    return stored ? (JSON.parse(stored) as CompileResponse) : null;
  } catch {
    return null;
  }
}

export function useEditorProject(
  projectId: string,
  /** File to open first, e.g. from a `?file=` deep link; ignored if absent. */
  preferredPath: string | null = null,
): UseEditorProjectResult {
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const [project, setProject] = useState<ProjectDetailResponse | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [files, setFiles] = useState<EditorFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [dirtyPaths, setDirtyPaths] = useState<ReadonlySet<string>>(new Set());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileResult, setCompileResult] = useState(() => readStoredCompile(projectId));
  const [compileError, setCompileError] = useState<string | null>(null);
  const [draftMode, setDraftMode] = useState(false);

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** In-flight content fetches, so a compile and a selection never fetch twice. */
  const inflight = useRef(new Map<string, Promise<string>>());
  /** Guards against overlapping compiles without re-creating the callback. */
  const compiling = useRef(false);

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

  /**
   * Maps a path to its file id.
   *
   * The single-file endpoints address files by UUID while the editor works in
   * paths. The list in memory answers this; the API is asked only for a path it
   * does not know, e.g. one added by a collaborator since the page loaded.
   */
  const fileIdFor = useCallback(
    async (path: string): Promise<string> => {
      const known = latest.current.files.find((f) => f.path === path);
      if (known) return known.id;

      const next = (await api.listFiles(projectId)).files.map(toEditorFile);
      setFiles(next);
      const match = next.find((f) => f.path === path);
      if (!match) throw new ApiError(404, `File not found: ${path}`, { code: "not_found" });
      return match.id;
    },
    [projectId],
  );

  /** Fetches a file's inline content, unless the buffer already holds it. */
  const fetchContent = useCallback(
    (path: string): Promise<string> => {
      const cached = latest.current.contents[path];
      if (cached !== undefined) return Promise.resolve(cached);

      let pending = inflight.current.get(path);
      if (!pending) {
        pending = fileIdFor(path)
          .then((id) => api.getFile(projectId, id))
          .then((detail) => detail.content ?? "")
          .finally(() => inflight.current.delete(path));
        inflight.current.set(path, pending);
      }
      return pending;
    },
    [projectId, fileIdFor],
  );

  /** Stores fetched text without clobbering a buffer the user has since edited. */
  const adoptContents = useCallback((loaded: Record<string, string>) => {
    setContents((current) => {
      const fresh = Object.keys(loaded).filter((path) => current[path] === undefined);
      if (fresh.length === 0) return current;
      const next = { ...current };
      for (const path of fresh) next[path] = loaded[path];
      return next;
    });
  }, []);

  // Initial load: project metadata, the file list and who is asking.
  useEffect(() => {
    if (!clerkLoaded || !isSignedIn || !projectId) return;

    const controller = new AbortController();
    const { signal } = controller;

    (async () => {
      try {
        // The profile is fetched here rather than through the dashboard's
        // `useCurrentUser`, which also loads the storage quota the editor never shows.
        const [projectDetail, fileList, me] = await Promise.all([
          api.getProject(projectId, { signal }),
          api.listFiles(projectId, { signal }),
          api.me({ signal }),
        ]);
        if (signal.aborted) return;

        setProject(projectDetail);
        setUserId(me.id);
        setFiles(fileList.files.map(toEditorFile));
        setLoadError(null);

        const preferred = fileList.files.some((f) => f.path === preferredPath) ? preferredPath : null;
        const initial = preferred ?? pickInitialFile(fileList.files);
        if (initial) setSelectedPath((current) => current ?? initial);
      } catch (cause) {
        if (signal.aborted) return;
        setLoadError(cause instanceof ApiError ? cause : new ApiError(0, "Could not load project"));
      } finally {
        if (!signal.aborted) setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [clerkLoaded, isSignedIn, projectId, preferredPath]);

  /** Loads the selected file's content the first time it is opened. */
  useEffect(() => {
    if (!selectedPath) return;
    const file = files.find((f) => f.path === selectedPath);
    if (!file?.isText || latest.current.contents[selectedPath] !== undefined) return;

    fetchContent(selectedPath)
      // A failed load leaves an empty buffer rather than blocking the editor;
      // the file remains selectable and saving will overwrite it.
      .catch(() => "")
      .then((text) => adoptContents({ [selectedPath]: text }));
  }, [selectedPath, files, fetchContent, adoptContents]);

  const persist = useCallback(
    async (path: string): Promise<boolean> => {
      const text = latest.current.contents[path];
      if (text === undefined) return true;

      setSaveState("saving");
      setSaveError(null);

      try {
        await api.updateFile(projectId, await fileIdFor(path), { content: text });
        // Only clear the flag if no keystroke landed while the request was out;
        // otherwise the newer text is still unsaved and its timer will write it.
        if (latest.current.contents[path] === text) {
          setDirtyPaths((current) => {
            if (!current.has(path)) return current;
            const next = new Set(current);
            next.delete(path);
            return next;
          });
        }
        setSaveState("saved");
        return true;
      } catch (cause) {
        // The edit stays in the buffer and remains dirty, so nothing is lost and
        // the next keystroke or manual save retries it.
        setSaveState("error");
        setSaveError(cause instanceof ApiError ? cause.message : "Could not save file");
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
   * Used when the page is being torn down. The pending timers are discarded
   * rather than awaited: a backgrounded tab has its timers throttled (Chrome
   * after 10s, Firefox after 30s), so waiting for the debounce would often mean
   * never saving at all.
   */
  const flushDirty = useCallback(async () => {
    const dirty = [...latest.current.dirtyPaths];
    for (const path of dirty) clearTimer(path);

    await Promise.all(dirty.map((path) => persist(path)));
  }, [clearTimer, persist]);

  // Unmount must not discard pending work. An earlier version cancelled the timers
  // here to avoid a setState-after-unmount warning, which silently threw away any
  // edit made inside the debounce window -- real data loss on every navigation.
  useEffect(() => () => void flushDirty(), [flushDirty]);

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
      for (const path of latest.current.dirtyPaths) {
        const text = latest.current.contents[path];
        if (text === undefined) continue;
        void fileIdFor(path)
          .then((fileId) =>
            api.updateFile(
              projectId,
              fileId,
              { content: text },
              // Keepalive lets the request outlive the document; browsers cap
              // the body, past which they drop it, hence the byte check.
              { keepalive: new Blob([text]).size <= KEEPALIVE_MAX_BYTES },
            ),
          )
          // Nothing useful can be reported once the page is going away; the
          // dirty flag stays set, so the next save retries.
          .catch(() => undefined);
      }
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
      setDirtyPaths((current) => (current.has(path) ? current : new Set(current).add(path)));
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

  /** Forgets a path locally once the API no longer has it. */
  const dropLocal = useCallback(
    (path: string) => {
      clearTimer(path);
      setContents((current) => {
        const next = { ...current };
        delete next[path];
        return next;
      });
      setDirtyPaths((current) => {
        if (!current.has(path)) return current;
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    },
    [clearTimer],
  );

  const createFile = useCallback(
    async (path: string, initialContent = "", fileType?: string) => {
      const normalizedPath = path.trim();
      if (latest.current.files.some((f) => f.path === normalizedPath)) {
        setSaveError(`A file named "${normalizedPath}" already exists`);
        return false;
      }

      try {
        const created = await api.uploadFile(projectId, {
          path: normalizedPath,
          content: initialContent,
          ...(fileType ? { type: fileType } : {}),
        });

        // Binaries (images, PDFs) live in object storage and are never buffered.
        if (isTextPath(normalizedPath)) adoptContents({ [normalizedPath]: initialContent });
        setFiles((current) => [...current, toEditorFile(created)]);
        setSelectedPath(normalizedPath);
        return true;
      } catch (cause) {
        setSaveError(cause instanceof ApiError ? cause.message : "Could not create file");
        return false;
      }
    },
    [projectId, adoptContents],
  );

  const deleteFile = useCallback(
    async (path: string) => {
      try {
        await api.deleteFile(projectId, await fileIdFor(path));
        dropLocal(path);
        const remaining = latest.current.files.filter((f) => f.path !== path);
        setFiles(remaining);
        setSelectedPath((current) => (current === path ? pickInitialFile(remaining) : current));
        return true;
      } catch (cause) {
        setSaveError(cause instanceof ApiError ? cause.message : "Could not delete file");
        return false;
      }
    },
    [projectId, fileIdFor, dropLocal],
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
        const content = await fetchContent(fromPath);
        const created = await api.uploadFile(projectId, { path: toPath, content });
        await api.deleteFile(projectId, await fileIdFor(fromPath));

        dropLocal(fromPath);
        adoptContents({ [toPath]: content });
        setFiles((current) => [
          ...current.filter((f) => f.path !== fromPath),
          toEditorFile(created),
        ]);
        setSelectedPath(toPath);
        return true;
      } catch (cause) {
        setSaveError(cause instanceof ApiError ? cause.message : "Could not rename file");
        return false;
      }
    },
    [projectId, fetchContent, fileIdFor, dropLocal, adoptContents],
  );

  /**
   * Every text file's content, preferring buffers that are already in memory.
   *
   * The main file goes first because the API compiles the first `.tex` it sees.
   */
  const loadAllContents = useCallback(async (): Promise<Record<string, string>> => {
    const textFiles = latest.current.files.filter((f) => f.isText);
    const main = pickInitialFile(textFiles);
    const ordered = [...textFiles].sort((a, b) => Number(b.path === main) - Number(a.path === main));

    const texts = await Promise.all(ordered.map((f) => fetchContent(f.path)));
    const payload: Record<string, string> = {};
    ordered.forEach((f, i) => (payload[f.path] = texts[i]));
    adoptContents(payload);
    return payload;
  }, [fetchContent, adoptContents]);

  const compileNow = useCallback(async () => {
    if (compiling.current) return;
    compiling.current = true;
    setIsCompiling(true);
    setCompileError(null);

    try {
      // Persist in parallel: the compile reads the buffers, not the stored files.
      void saveNow();

      const payload = await loadAllContents();
      if (Object.keys(payload).length === 0) {
        setCompileError("This project has no text files to compile.");
        return;
      }

      // project_id lets the API add the stored images/PDFs, which never live
      // in the browser's buffers.
      const result = await api.compile({ files: payload, draft: draftMode, project_id: projectId });
      setCompileResult(result);

      try {
        localStorage.setItem(storageKey(projectId), JSON.stringify(result));
      } catch {
        // Over quota (large PDFs) or storage disabled; the result still shows.
      }
    } catch (cause) {
      setCompileError(cause instanceof ApiError ? cause.message : "Compilation failed to start");
    } finally {
      compiling.current = false;
      setIsCompiling(false);
    }
  }, [draftMode, loadAllContents, projectId, saveNow]);

  const selectedFile = files.find((f) => f.path === selectedPath) ?? null;
  const isText = selectedPath !== null && selectedFile?.isText === true;

  return {
    project,
    files,
    tree: useMemo(() => buildFileTree(files), [files]),
    selectedPath,
    content: isText ? (contents[selectedPath] ?? "") : "",
    isFileLoading: isText && contents[selectedPath] === undefined,
    getBuffers: useCallback(() => latest.current.contents, []),
    // Signed out: nothing will load, and the page redirects.
    isLoading: isLoading && !(clerkLoaded && !isSignedIn),
    loadError,
    canEdit,
    isReadOnly,
    role,
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
    draftMode,
    setDraftMode,
    compileNow,
  };
}
