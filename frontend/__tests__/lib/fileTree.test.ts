import { describe, expect, it } from "vitest";

import {
  ancestorDirs,
  buildFileTree,
  extensionOf,
  flattenFiles,
  isTextPath,
  parseOutline,
  pickInitialFile,
  validateNewPath,
  type TreeDir,
} from "@/lib/fileTree";

/**
 * The tree is derived from the API's flat path list, so all of its structure is a
 * pure function of those paths. These tests pin that derivation, including the
 * cases the API makes possible but a hand-written tree would get wrong.
 */

const files = [
  { path: "main.tex", sizeBytes: 120 },
  { path: "references.bib", sizeBytes: 80 },
  { path: "chapters/intro.tex", sizeBytes: 200 },
  { path: "chapters/methods.tex", sizeBytes: 300 },
  { path: "figures/diagram.png", sizeBytes: 4096 },
];

function dirNames(dir: TreeDir): string[] {
  return dir.children.map((c) => c.name);
}

describe("extensionOf", () => {
  it("reads the extension from a nested path", () => {
    expect(extensionOf("chapters/intro.tex")).toBe("tex");
  });

  it("lowercases the extension", () => {
    expect(extensionOf("README.MD")).toBe("md");
  });

  it("treats a leading dot as a dotfile rather than an extension", () => {
    // Otherwise `.gitignore` would look like the extension "gitignore".
    expect(extensionOf(".gitignore")).toBe("");
  });

  it("returns empty when there is no extension", () => {
    expect(extensionOf("Makefile")).toBe("");
  });
});

describe("buildFileTree", () => {
  it("groups files under the folder their path implies", () => {
    const tree = buildFileTree(files);

    expect(dirNames(tree)).toEqual(["chapters", "figures", "main.tex", "references.bib"]);
  });

  it("puts directories before files, then sorts each group", () => {
    const tree = buildFileTree([
      { path: "zeta.tex", sizeBytes: 1 },
      { path: "alpha/one.tex", sizeBytes: 1 },
    ]);

    expect(dirNames(tree)).toEqual(["alpha", "zeta.tex"]);
  });

  it("nests deeper paths to their full depth", () => {
    const tree = buildFileTree([
      { path: "a/b/c/deep.tex", sizeBytes: 1 },
      { path: "a/shallow.tex", sizeBytes: 1 },
    ]);

    const a = tree.children[0];
    expect(a.kind).toBe("dir");
    if (a.kind !== "dir") return;

    expect(dirNames(a)).toEqual(["b", "shallow.tex"]);
    const b = a.children[0];
    if (b.kind !== "dir") throw new Error("expected a directory");
    expect(dirNames(b)).toEqual(["c"]);
  });

  it("records whether each file can be opened as text", () => {
    const all = flattenFiles(buildFileTree(files));
    const byPath = new Map(all.map((f) => [f.path, f]));

    expect(byPath.get("main.tex")?.isText).toBe(true);
    expect(byPath.get("main.tex")?.isLatex).toBe(true);
    // A PNG is listable but has no inline content to edit.
    expect(byPath.get("figures/diagram.png")?.isText).toBe(false);
  });

  it("keeps every file reachable through flattenFiles", () => {
    expect(flattenFiles(buildFileTree(files)).map((f) => f.path).sort()).toEqual(
      files.map((f) => f.path).sort(),
    );
  });

  it("returns an empty root for no files", () => {
    expect(buildFileTree([]).children).toEqual([]);
  });
});

describe("validateNewPath", () => {
  const existing = new Set(["main.tex"]);

  it("accepts a nested path with an allowed extension", () => {
    expect(validateNewPath("chapters/intro.tex", existing)).toEqual({
      ok: true,
      path: "chapters/intro.tex",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(validateNewPath("  notes.md  ", existing)).toEqual({ ok: true, path: "notes.md" });
  });

  it("rejects an absolute path", () => {
    expect(validateNewPath("/etc/passwd.tex", existing)).toMatchObject({ ok: false });
  });

  it("rejects traversal, which the API refuses with a 400", () => {
    expect(validateNewPath("../secrets.tex", existing)).toMatchObject({ ok: false });
    expect(validateNewPath("a/../../b.tex", existing)).toMatchObject({ ok: false });
  });

  it("rejects a backslash, so paths stay POSIX as the API expects", () => {
    expect(validateNewPath("chapters\\intro.tex", existing)).toMatchObject({ ok: false });
  });

  it("rejects a dot-prefixed segment", () => {
    // The API forbids these, which also blocks editor backup files.
    expect(validateNewPath(".hidden.tex", existing)).toMatchObject({ ok: false });
  });

  it("rejects an extension the API would not store", () => {
    expect(validateNewPath("payload.exe", existing)).toMatchObject({ ok: false });
  });

  it("rejects a duplicate path", () => {
    expect(validateNewPath("main.tex", existing)).toMatchObject({ ok: false });
  });

  it("rejects an empty name", () => {
    expect(validateNewPath("   ", existing)).toMatchObject({ ok: false });
  });
});

describe("pickInitialFile", () => {
  it("prefers main.tex when present", () => {
    expect(pickInitialFile([{ path: "paper.tex" }, { path: "main.tex" }])).toBe("main.tex");
  });

  it("falls back to a root-level .tex", () => {
    expect(pickInitialFile([{ path: "chapters/a.tex" }, { path: "thesis.tex" }])).toBe("thesis.tex");
  });

  it("falls back to any .tex when none is at the root", () => {
    expect(pickInitialFile([{ path: "notes.md" }, { path: "chapters/a.tex" }])).toBe(
      "chapters/a.tex",
    );
  });

  it("falls back to the first file when there is no .tex at all", () => {
    expect(pickInitialFile([{ path: "notes.md" }])).toBe("notes.md");
  });

  it("returns null for an empty project", () => {
    expect(pickInitialFile([])).toBeNull();
  });
});

describe("ancestorDirs", () => {
  it("lists every folder leading to the file, shallowest first", () => {
    expect(ancestorDirs("a/b/c/deep.tex")).toEqual(["a", "a/b", "a/b/c"]);
  });

  it("returns nothing for a root-level file", () => {
    expect(ancestorDirs("main.tex")).toEqual([]);
  });
});

describe("parseOutline", () => {
  const source = [
    "\\documentclass{article}",
    "\\begin{document}",
    "\\part{Background}",
    "\\section{Introduction}",
    "Some prose.",
    "\\subsection{Details}",
    "\\section*{Acknowledgements}",
    "\\section{}",
    "\\end{document}",
  ].join("\n");

  it("finds each sectioning command with its title", () => {
    expect(parseOutline(source)).toEqual([
      { level: 1, title: "Background", line: 3 },
      { level: 3, title: "Introduction", line: 4 },
      { level: 4, title: "Details", line: 6 },
      { level: 3, title: "Acknowledgements", line: 7 },
    ]);
  });

  it("numbers headings so the outline can indent by depth", () => {
    const levels = parseOutline(source).map((e) => e.level);
    expect(levels).toEqual([1, 3, 4, 3]);
  });

  it("handles the starred form, which suppresses numbering but not the title", () => {
    expect(parseOutline("\\section*{Preface}")[0]).toMatchObject({
      level: 3,
      title: "Preface",
    });
  });

  it("skips a heading with an empty title", () => {
    expect(parseOutline(source).some((e) => e.title === "")).toBe(false);
  });

  it("returns nothing for a file with no headings", () => {
    expect(parseOutline("just some text\nand more")).toEqual([]);
  });

  it("does not match a command that is not at the start of a line", () => {
    expect(parseOutline("text \\section{Nope}")).toEqual([]);
  });
});

describe("isTextPath", () => {
  it("treats LaTeX and BibTeX sources as text", () => {
    expect(isTextPath("main.tex")).toBe(true);
    expect(isTextPath("refs.bib")).toBe(true);
  });

  it("treats binaries as not text, so the editor refuses to open them", () => {
    expect(isTextPath("figures/a.png")).toBe(false);
    expect(isTextPath("paper.pdf")).toBe(false);
  });
});
