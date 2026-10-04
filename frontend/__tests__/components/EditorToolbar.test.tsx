import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EditorToolbar from "@/components/editor/EditorToolbar";

/**
 * The toolbar is where an author spends most of their clicks, so these tests
 * assert on the LaTeX each tool actually produces, not merely that a button
 * exists -- a tool that emits the wrong command is worse than a missing one.
 */

function renderToolbar(
  props: Partial<React.ComponentProps<typeof EditorToolbar>> = {},
) {
  const onCommand = vi.fn();
  render(
    <EditorToolbar
      content="\\section{Methods}\nWe train the model."
      canEdit
      canUndo={false}
      canRedo={false}
      onCommand={onCommand}
      {...props}
    />,
  );
  return { onCommand };
}

describe("EditorToolbar", () => {
  it("wraps the selection in bold rather than inserting a fixed template", async () => {
    const user = userEvent.setup();
    const { onCommand } = renderToolbar();

    await user.click(screen.getByRole("button", { name: /Bold/ }));

    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "wrap", open: "\\textbf{", close: "}" }),
    );
  });

  it("sends the italic and math delimiters", async () => {
    const user = userEvent.setup();
    const { onCommand } = renderToolbar();

    await user.click(screen.getByRole("button", { name: /Italic/ }));
    await user.click(screen.getByRole("button", { name: /Inline math/ }));

    expect(onCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: "wrap", open: "\\textit{" }),
    );
    expect(onCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: "wrap", open: "$", close: "$" }),
    );
  });

  it("inserts a complete figure float", async () => {
    const user = userEvent.setup();
    const { onCommand } = renderToolbar();

    await user.click(screen.getByRole("button", { name: /Insert figure/ }));

    const command = onCommand.mock.calls[0][0];
    expect(command.kind).toBe("insert");
    // A figure has to be a full float to compile, not a bare \includegraphics.
    expect(command.text).toContain("\\begin{figure}");
    expect(command.text).toContain("\\includegraphics");
    expect(command.text).toContain("\\label{fig:caption}");
    expect(command.text).toContain("\\end{figure}");
  });

  it("inserts a table with a tabular body", async () => {
    const user = userEvent.setup();
    const { onCommand } = renderToolbar();

    await user.click(screen.getByRole("button", { name: /Insert table/ }));

    const command = onCommand.mock.calls[0][0];
    expect(command.text).toContain("\\begin{table}");
    expect(command.text).toContain("\\begin{tabular}");
    expect(command.text).toContain("\\end{table}");
  });

  it("inserts both list flavours", async () => {
    const user = userEvent.setup();
    const { onCommand } = renderToolbar();

    await user.click(screen.getByRole("button", { name: /Bulleted list/ }));
    await user.click(screen.getByRole("button", { name: /Numbered list/ }));

    expect(onCommand.mock.calls[0][0].text).toContain("\\begin{itemize}");
    expect(onCommand.mock.calls[1][0].text).toContain("\\begin{enumerate}");
  });

  it("toggles comments rather than inserting one", async () => {
    const user = userEvent.setup();
    const { onCommand } = renderToolbar();

    await user.click(screen.getByRole("button", { name: /Toggle comment/ }));

    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "toggleComment" }),
    );
  });

  it("distinguishes repeat clicks of the same tool", async () => {
    const user = userEvent.setup();
    const { onCommand } = renderToolbar();

    const button = screen.getByRole("button", { name: /Bold/ });
    await user.click(button);
    await user.click(button);

    // Without a changing nonce the second click would be an identical command
    // and the editor's effect would not fire again.
    expect(onCommand.mock.calls[0][0].nonce).not.toBe(onCommand.mock.calls[1][0].nonce);
  });

  it("disables undo and redo when there is no history", () => {
    renderToolbar({ canUndo: false, canRedo: false });

    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("enables undo and redo once the editor reports history", () => {
    renderToolbar({ canUndo: true, canRedo: true });

    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
  });

  it("asks for undo and redo instead of editing the buffer", async () => {
    const user = userEvent.setup();
    const { onCommand } = renderToolbar({ canUndo: true, canRedo: true });

    await user.click(screen.getByRole("button", { name: "Undo" }));
    await user.click(screen.getByRole("button", { name: "Redo" }));

    expect(onCommand.mock.calls[0][0].kind).toBe("undo");
    expect(onCommand.mock.calls[1][0].kind).toBe("redo");
  });

  it("hides every write tool from a read-only viewer", () => {
    // The API answers a VIEWER's writes with 403, so offering the tools would be
    // a promise the server refuses to keep.
    renderToolbar({ canEdit: false });

    expect(screen.queryByRole("button", { name: /Bold/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("reports word count and size for the open file", () => {
    renderToolbar({ content: "one two three four" });

    expect(screen.getByTestId("word-count")).toHaveTextContent("4 words");
    expect(screen.getByTestId("file-size")).toHaveTextContent("B");
  });

  it("says so when no file is open rather than showing a count of nothing", () => {
    renderToolbar({ content: null });

    expect(screen.queryByTestId("word-count")).not.toBeInTheDocument();
    expect(screen.getByText("No file open")).toBeInTheDocument();
  });

  it("formats a large word count with separators", () => {
    renderToolbar({ content: Array.from({ length: 1500 }, () => "word").join(" ") });

    expect(screen.getByTestId("word-count")).toHaveTextContent("1,500 words");
  });
});
