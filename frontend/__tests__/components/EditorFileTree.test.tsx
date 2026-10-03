import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import FileTree from "@/components/editor/FileTree";
import { buildFileTree } from "@/lib/fileTree";
import { effectiveRole } from "@/hooks/useEditorProject";
import type { ProjectDetailResponse } from "@/lib/api/types";

/**
 * The tree's contract with the page: it renders the API's paths and reports the
 * user's intent upward. Folders come from path prefixes, so the component never
 * invents a directory the API does not know about.
 */

const FILES = [
  { path: "main.tex", sizeBytes: 120 },
  { path: "references.bib", sizeBytes: 80 },
  { path: "chapters/intro.tex", sizeBytes: 200 },
  { path: "figures/diagram.png", sizeBytes: 4096 },
];

function renderTree(props: Partial<React.ComponentProps<typeof FileTree>> = {}) {
  const onSelect = vi.fn();
  const onCreateFile = vi.fn();
  const onRename = vi.fn();
  const onDelete = vi.fn();

  render(
    <FileTree
      tree={buildFileTree(FILES)}
      selectedPath="main.tex"
      dirtyPaths={new Set()}
      canEdit
      onSelect={onSelect}
      onCreateFile={onCreateFile}
      onRename={onRename}
      onDelete={onDelete}
      {...props}
    />,
  );

  return { onSelect, onCreateFile, onRename, onDelete };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FileTree", () => {
  it("renders a row per file, including nested ones", () => {
    renderTree();

    expect(screen.getByText("main.tex")).toBeInTheDocument();
    expect(screen.getByText("references.bib")).toBeInTheDocument();
    expect(screen.getByText("intro.tex")).toBeInTheDocument();
    expect(screen.getByText("diagram.png")).toBeInTheDocument();
  });

  it("derives folders from path prefixes rather than inventing them", () => {
    renderTree();

    expect(screen.getByText("chapters/")).toBeInTheDocument();
    expect(screen.getByText("figures/")).toBeInTheDocument();
  });

  it("reports the selected file's path, not its basename", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderTree();

    await user.click(screen.getByText("intro.tex"));

    // The hook resolves ids by full path, so a basename would 404.
    expect(onSelect).toHaveBeenCalledWith("chapters/intro.tex");
  });

  it("collapses a folder when its header is clicked", async () => {
    const user = userEvent.setup();
    renderTree();

    const header = screen.getByText("chapters/");
    expect(screen.getByText("intro.tex")).toBeInTheDocument();

    await user.click(header);

    expect(screen.queryByText("intro.tex")).not.toBeInTheDocument();
  });

  it("marks the selected file for assistive technology", () => {
    renderTree();

    const row = screen.getByText("main.tex").closest("button");
    expect(row).toHaveAttribute("aria-current", "true");
  });

  it("shows an unsaved dot only for dirty files", () => {
    renderTree({ dirtyPaths: new Set(["references.bib"]) });

    const unsaved = screen.getAllByLabelText("Unsaved changes");
    expect(unsaved).toHaveLength(1);
  });

  it("hides write controls from viewers, whose writes the API rejects with 403", () => {
    renderTree({ canEdit: false });

    expect(screen.queryByRole("button", { name: "New file" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Actions for main.tex" }),
    ).not.toBeInTheDocument();
  });

  it("creates a file at the path typed, including a folder prefix", async () => {
    const user = userEvent.setup();
    const { onCreateFile } = renderTree();

    await user.click(screen.getByRole("button", { name: "New file" }));
    await user.type(screen.getByLabelText("New file path"), "chapters/methods.tex");
    await user.keyboard("{Enter}");

    expect(onCreateFile).toHaveBeenCalledWith("chapters/methods.tex");
  });

  it("renames within the same folder when only the basename changes", async () => {
    const user = userEvent.setup();
    const { onRename } = renderTree();

    await user.click(screen.getByRole("button", { name: "Actions for intro.tex" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByLabelText("Rename intro.tex");
    await user.clear(input);
    await user.type(input, "background.tex{Enter}");

    // Losing the folder prefix would move the file to the project root.
    expect(onRename).toHaveBeenCalledWith("chapters/intro.tex", "chapters/background.tex");
  });

  it("reports deletion for the file whose menu was opened", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderTree();

    await user.click(screen.getByRole("button", { name: "Actions for references.bib" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledWith("references.bib");
  });

  it("closes the row menu when clicking away", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.click(screen.getByRole("button", { name: "Actions for main.tex" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close menu" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("prompts for a first file when the project is empty", () => {
    renderTree({ tree: buildFileTree([]) });

    expect(screen.getByText(/No files yet/)).toBeInTheDocument();
  });

  it("exposes each menu as a real menu for keyboard and screen readers", async () => {
    const user = userEvent.setup();
    renderTree();

    await user.click(screen.getByRole("button", { name: "Actions for main.tex" }));

    const trigger = screen.getByRole("button", { name: "Actions for main.tex" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
  });
});

describe("effectiveRole", () => {
  const project = {
    owner: { id: "user_owner", email: "owner@example.com", full_name: "Owner" },
    members: [
      { id: "m1", user: { id: "user_editor", email: "e@example.com", full_name: null }, role: "editor" as const, added_at: "2026-01-01T00:00:00Z" },
      { id: "m2", user: { id: "user_viewer", email: "v@example.com", full_name: null }, role: "viewer" as const, added_at: "2026-01-01T00:00:00Z" },
    ],
  } as unknown as ProjectDetailResponse;

  it("reports owner for the project's owner", () => {
    expect(effectiveRole(project, "user_owner")).toBe("owner");
  });

  it("reads the membership role for everyone else", () => {
    expect(effectiveRole(project, "user_editor")).toBe("editor");
    expect(effectiveRole(project, "user_viewer")).toBe("viewer");
  });

  it("returns null for a non-member", () => {
    expect(effectiveRole(project, "user_stranger")).toBeNull();
  });

  it("returns null before the user or project is known", () => {
    expect(effectiveRole(project, null)).toBeNull();
    expect(effectiveRole(null, "user_owner")).toBeNull();
  });
});
