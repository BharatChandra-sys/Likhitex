import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectsTable from "@/components/dashboard/ProjectsTable";
import type { ProjectResponse } from "@/lib/api/types";

/**
 * The table is the only place project data reaches the screen, so these tests
 * assert against a payload shaped exactly like the API's `ProjectResponse`
 * rather than convenient test doubles.
 */

const CURRENT_USER_ID = "user_1";

function makeProject(overrides: Partial<ProjectResponse> = {}): ProjectResponse {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Deep Residual Learning for Image Recognition",
    description: "NeurIPS 2025 submission",
    owner_id: CURRENT_USER_ID,
    size_bytes: 14_920_570,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-10-03T11:56:00Z",
    last_compiled_at: "2026-10-03T11:00:00Z",
    ...overrides,
  };
}

/** Renders the table with one project, exposing the handlers for assertions. */
function renderTable(props: Partial<React.ComponentProps<typeof ProjectsTable>> = {}) {
  const onOpenShare = vi.fn();
  const onRename = vi.fn();
  const onDelete = vi.fn();
  const projects = [makeProject()];

  // ProjectsTable renders its own <table>; wrapping it in another would produce
  // nested tables and two elements with role="table".
  render(
    <ProjectsTable
      projects={projects}
      currentUserId={CURRENT_USER_ID}
      sortKey="updated_at"
      sortDirection="desc"
      onSortChange={vi.fn()}
      isRefreshing={false}
      onOpenShare={onOpenShare}
      onRename={onRename}
      onDelete={onDelete}
      pendingIds={new Set()}
      {...props}
    />,
  );

  return { onOpenShare, onRename, onDelete, projects };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProjectsTable", () => {
  it("renders the project name and description from the API payload", () => {
    renderTable();

    expect(
      screen.getByRole("link", { name: /Deep Residual Learning for Image Recognition/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("NeurIPS 2025 submission")).toBeInTheDocument();
  });

  it("links a project to its editor route using the real id", () => {
    renderTable();

    const link = screen.getByRole("link", { name: /Deep Residual Learning/ });
    expect(link).toHaveAttribute(
      "href",
      "/editor/11111111-1111-1111-1111-111111111111",
    );
  });

  it("formats size_bytes rather than showing a raw number", () => {
    renderTable();

    // 14_920_570 bytes is 14.2 MiB.
    expect(screen.getByText("14.2 MiB")).toBeInTheDocument();
    expect(screen.queryByText("14920570")).not.toBeInTheDocument();
  });

  it("shows a compiled badge when last_compiled_at is set", () => {
    renderTable();

    expect(screen.getByText("compiled")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("falls back to Draft for a project that has never compiled", () => {
    renderTable({ projects: [makeProject({ last_compiled_at: null })] });

    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.queryByText("compiled")).not.toBeInTheDocument();
  });

  it("marks a project the caller does not own as Shared", () => {
    renderTable({
      projects: [makeProject({ owner_id: "someone_else" })],
    });

    expect(screen.getByText("Shared")).toBeInTheDocument();
  });

  it("does not mark an owned project as Shared", () => {
    renderTable();

    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
  });

  it("requests a page-local sort when a column header is clicked", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    renderTable({ onSortChange });

    await user.click(screen.getByRole("button", { name: /Document Title/ }));

    expect(onSortChange).toHaveBeenCalledWith("name");
  });

  it("opens the row menu and reports share, rename and delete", async () => {
    const user = userEvent.setup();
    const { onOpenShare, onRename, onDelete, projects } = renderTable();
    const project = projects[0];

    await user.click(screen.getByRole("button", { name: "More options" }));

    const menu = screen.getByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "Share" }));
    expect(onOpenShare).toHaveBeenCalledWith(expect.objectContaining({ name: expect.any(String) }));

    // The menu closes after each action, so it is reopened for the next one.
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Rename" }),
    );
    expect(onRename).toHaveBeenCalledWith(project);

    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Delete" }),
    );
    expect(onDelete).toHaveBeenCalledWith(project);
  });

  it("disables duplicate and download when no handler is supplied", () => {
    renderTable({ onDuplicate: undefined, onDownload: undefined });

    expect(screen.getByTitle("Duplicating is not implemented yet")).toBeDisabled();
    expect(screen.getByTitle("Downloading a ZIP is not implemented yet")).toBeDisabled();
  });

  it("enables those actions once a handler is supplied", () => {
    renderTable({ onDuplicate: vi.fn(), onDownload: vi.fn() });

    expect(screen.getByTitle("Duplicate")).toBeEnabled();
    expect(screen.getByTitle("Download project as ZIP")).toBeEnabled();
  });

  it("disables a row's actions while that row has a pending mutation", () => {
    // Handlers are supplied here so the buttons carry their enabled titles; the
    // assertion is about the pending state, not about availability.
    renderTable({
      onDuplicate: vi.fn(),
      onDownload: vi.fn(),
      pendingIds: new Set(["11111111-1111-1111-1111-111111111111"]),
    });

    expect(screen.getByTitle("Duplicate")).toBeDisabled();
    expect(screen.getByLabelText("Working")).toBeInTheDocument();
  });

  it("renders an empty tbody without throwing when there are no projects", () => {
    renderTable({ projects: [] });

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryAllByRole("row")).toHaveLength(1); // header only
  });
});
