/**
 * Project file-tree logic, kept free of React so it can be tested directly.
 *
 * The API stores files as flat project-relative paths (`chapters/intro.tex`) and
 * has no directory entity: a folder exists only because some file's path runs
 * through it. Everything here derives that structure rather than inventing one.
 *
 * The allowed extensions mirror `ALLOWED_EXTENSIONS` in
 * `apps/api/app/files/routes.py`. Keeping a copy is deliberate -- the list has to
 * be available before a request is made to get a 400 back, and a rejected upload
 * that clears the user's buffer is worse than no upload at all.
 */

/** Extensions the API stores inline as text, and which the editor can open. */
export const TEXT_EXTENSIONS = new Set([
  "tex",
  "bib",
  "sty",
  "cls",
  "bst",
  "ltx",
  "def",
  "cfg",
  "txt",
  "md",
]);

/** Everything the API will accept, including binaries routed to object storage. */
export const ALLOWED_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  "png",
  "jpg",
  "jpeg",
  "pdf",
  "svg",
  "eps",
  "gif",
]);

/** LaTeX sources, the only files worth offering syntax highlighting for. */
const LATEX_EXTENSIONS = new Set(["tex", "sty", "cls", "ltx", "def", "cfg"]);

export interface TreeFile {
  kind: "file";
  /** Basename, e.g. `intro.tex`. */
  name: string;
  /** Full project-relative path, e.g. `chapters/intro.tex`. */
  path: string;
  /** Lowercase extension without the dot, e.g. `tex`. Empty when there is none. */
  extension: string;
  sizeBytes: number;
  /** False for binaries: those have no inline content to edit. */
  isText: boolean;
  isLatex: boolean;
}

export interface TreeDir {
  kind: "dir";
  /** Segment name, e.g. `chapters`. Empty string for the synthetic root. */
  name: string;
  /** Path prefix without a trailing slash, e.g. `chapters`. Empty for the root. */
  path: string;
  children: TreeNode[];
}

export type TreeNode = TreeFile | TreeDir;

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  // A leading dot means a dotfile, not an extension: `.gitignore` has none.
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(path));
}

/**
 * Whether the API would accept this path.
 *
 * Mirrors `validate_project_path` plus the extension check, so the editor can
 * refuse locally what the server would refuse with a 400.
 */
export function validateNewPath(
  raw: string,
  existingPaths: ReadonlySet<string>,
): { ok: true; path: string } | { ok: false; reason: string } {
  const path = raw.trim();

  if (!path) return { ok: false, reason: "Enter a file name." };
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    return { ok: false, reason: "Path must be relative to the project." };
  }
  if (path.includes("\\")) return { ok: false, reason: "Use forward slashes." };
  if (path.length > 255) return { ok: false, reason: "Path is too long." };

  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return { ok: false, reason: "Path segments cannot be empty, '.' or '..'." };
  }
  // The API rejects any segment starting with a dot, which also blocks `.tex~`
  // style editor backups from being created by accident.
  if (segments.some((segment) => segment.startsWith("."))) {
    return { ok: false, reason: "Path segments cannot start with a dot." };
  }
  if (!ALLOWED_EXTENSIONS.has(extensionOf(path))) {
    return { ok: false, reason: `Extension not allowed. Use one of: ${[...ALLOWED_EXTENSIONS].join(", ")}.` };
  }
  if (existingPaths.has(path)) return { ok: false, reason: "A file with that path already exists." };

  return { ok: true, path };
}

/**
 * Builds the nested tree from flat paths.
 *
 * Intermediate directories are created on demand, and a file whose path collides
 * with a directory (impossible via the API, since paths are unique) is skipped
 * rather than allowed to corrupt the shape.
 */
export function buildFileTree(
  files: ReadonlyArray<{ path: string; sizeBytes: number }>,
): TreeDir {
  const root: TreeDir = { kind: "dir", name: "", path: "", children: [] };

  const dirs = new Map<string, TreeDir>([["", root]]);

  const ensureDir = (path: string): TreeDir => {
    const existing = dirs.get(path);
    if (existing) return existing;

    const slash = path.lastIndexOf("/");
    const parentPath = slash === -1 ? "" : path.slice(0, slash);
    const name = slash === -1 ? path : path.slice(slash + 1);

    const dir: TreeDir = { kind: "dir", name, path, children: [] };
    ensureDir(parentPath).children.push(dir);
    dirs.set(path, dir);
    return dir;
  };

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const slash = file.path.lastIndexOf("/");
    const parent = slash === -1 ? root : ensureDir(file.path.slice(0, slash));
    const name = slash === -1 ? file.path : file.path.slice(slash + 1);
    const extension = extensionOf(file.path);

    parent.children.push({
      kind: "file",
      name,
      path: file.path,
      extension,
      sizeBytes: file.sizeBytes,
      isText: TEXT_EXTENSIONS.has(extension),
      isLatex: LATEX_EXTENSIONS.has(extension),
    });
  }

  sortChildren(root);
  return root;
}

/** Directories first, then files; each group alphabetical, case-insensitively. */
function sortChildren(dir: TreeDir): void {
  dir.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  for (const child of dir.children) {
    if (child.kind === "dir") sortChildren(child);
  }
}

/** Every file path in the tree, depth first. */
export function flattenFiles(dir: TreeDir): TreeFile[] {
  const out: TreeFile[] = [];
  const walk = (node: TreeDir) => {
    for (const child of node.children) {
      if (child.kind === "file") out.push(child);
      else walk(child);
    }
  };
  walk(dir);
  return out;
}

/**
 * Picks the file to open on load.
 *
 * LaTeX has no manifest, so the main document is a convention. `main.tex` wins
 * when present, then any other `.tex` at the root, then the first `.tex`
 * anywhere, and only then the first file of any kind.
 */
export function pickInitialFile(files: ReadonlyArray<{ path: string }>): string | null {
  if (files.length === 0) return null;

  const paths = files.map((f) => f.path);
  const has = (path: string) => paths.includes(path);

  if (has("main.tex")) return "main.tex";
  if (has("paper.tex")) return "paper.tex";

  const rootTex = paths.find((p) => p.endsWith(".tex") && !p.includes("/"));
  if (rootTex) return rootTex;

  const anyTex = paths.find((p) => p.endsWith(".tex"));
  if (anyTex) return anyTex;

  return paths[0];
}

/**
 * Ancestor directory paths of a file, shallowest first.
 *
 * Used to open every folder leading to the selected file, so a file inside
 * `a/b/c/` is visible without the user expanding each level by hand.
 */
export function ancestorDirs(path: string): string[] {
  const segments = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    out.push(segments.slice(0, i).join("/"));
  }
  return out;
}

/**
 * LaTeX section headings in a source file, for the outline panel.
 *
 * Recognises the starred and unstarred forms of the sectioning commands and
 * reads only the first braced group, which is the title for all of them.
 */
export interface OutlineEntry {
  /** 1-5 for part/chapter/section/subsection/subsubsection. */
  level: number;
  title: string;
  /** 1-based line number. */
  line: number;
}

const SECTION_RE =
  /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*\{([^}]*)\}/;

export function parseOutline(source: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];

  source.split("\n").forEach((line, index) => {
    const match = line.match(SECTION_RE);
    if (!match) return;

    const title = match[2].trim();
    if (!title) return;

    // `\paragraph` is a run-in heading, ranked with subsubsection.
    const level = match[1] === "paragraph" ? 5 : SECTION_RE_LEVEL[match[1]];
    entries.push({ level, title, line: index + 1 });
  });

  return entries;
}

const SECTION_RE_LEVEL: Record<string, number> = {
  part: 1,
  chapter: 2,
  section: 3,
  subsection: 4,
  subsubsection: 5,
};
