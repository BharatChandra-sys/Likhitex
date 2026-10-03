/**
 * Tests for CompileLogsDrawer.
 *
 * This is the component that surfaces the compiler's diagnostics, so these tests
 * use the exact shapes `parse_latex_log` emits: errors carry a file and line,
 * while engine-level warnings carry neither (file `""`, line `0`).
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CompileLogsDrawer from "@/components/editor/CompileLogsDrawer";
import type { CompileDiagnostic } from "@/components/editor/CompileLogsDrawer";

const ERROR: CompileDiagnostic = {
  file: "main.tex",
  line: 12,
  message: "Undefined control sequence.",
  severity: "error",
};

/** Exactly what the parser emits for `LaTeX Warning: ... on input line 42.` */
const WARNING: CompileDiagnostic = {
  file: "",
  line: 42,
  message: "LaTeX Warning: Citation `foo' undefined",
  severity: "warning",
};

function renderDrawer(props: Partial<React.ComponentProps<typeof CompileLogsDrawer>> = {}) {
  return render(
    <CompileLogsDrawer
      isOpen
      onClose={() => {}}
      errors={[ERROR]}
      warnings={[WARNING]}
      rawLog={"! Undefined control sequence.\n"}
      {...props}
    />,
  );
}

describe("visibility", () => {
  it("renders nothing when closed", () => {
    renderDrawer({ isOpen: false });

    expect(screen.queryByRole("region", { name: /compile logs/i })).toBeNull();
  });

  it("renders the log region when open", () => {
    renderDrawer();

    expect(screen.getByRole("region", { name: /compile logs/i })).toBeInTheDocument();
  });
});

describe("tabs", () => {
  it("defaults to the errors tab", () => {
    renderDrawer();

    expect(screen.getByRole("tab", { name: /errors \(1\)/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("shows errors with their file and line", () => {
    renderDrawer();

    expect(screen.getByText("main.tex, line 12")).toBeInTheDocument();
    expect(screen.getByText("Undefined control sequence.")).toBeInTheDocument();
  });

  it("switches to the warnings tab", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole("tab", { name: /warnings \(1\)/i }));

    expect(screen.getByText("LaTeX Warning: Citation `foo' undefined")).toBeInTheDocument();
  });

  it("describes a warning with only a line, rather than a blank location", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole("tab", { name: /warnings \(1\)/i }));

    // file is "" and line is 42, so the label must not read ", line 42".
    expect(screen.getByText("line 42")).toBeInTheDocument();
    expect(screen.queryByText(/^, line/)).toBeNull();
  });

  it("shows the raw log", async () => {
    const user = userEvent.setup();
    renderDrawer({ rawLog: "This is the TeX log body" });

    await user.click(screen.getByRole("tab", { name: /raw log/i }));

    expect(screen.getByText("This is the TeX log body")).toBeInTheDocument();
  });

  it("counts reflect the supplied arrays", () => {
    renderDrawer({ errors: [ERROR, { ...ERROR, line: 20 }], warnings: [] });

    expect(screen.getByRole("tab", { name: /errors \(2\)/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /warnings \(0\)/i })).toBeInTheDocument();
  });
});

describe("empty states", () => {
  it("explains that a clean compile has no errors", () => {
    renderDrawer({ errors: [], warnings: [] });

    expect(screen.getByText(/compiled cleanly/i)).toBeInTheDocument();
  });

  it("says there are no errors when only warnings exist", () => {
    renderDrawer({ errors: [], warnings: [WARNING] });

    // A warning is still something to report, so the copy must not claim the
    // document compiled cleanly.
    expect(screen.getByText("No errors")).toBeInTheDocument();
    expect(screen.queryByText(/compiled cleanly/i)).toBeNull();
  });

  it("distinguishes no-warnings from no-errors at all", async () => {
    const user = userEvent.setup();
    renderDrawer({ errors: [ERROR], warnings: [] });

    await user.click(screen.getByRole("tab", { name: /warnings \(0\)/i }));

    expect(screen.getByText("No warnings")).toBeInTheDocument();
  });
});

describe("go to source", () => {
  it("calls back with the diagnostic location", async () => {
    const user = userEvent.setup();
    const onNavigateToLine = vi.fn();
    renderDrawer({ onNavigateToLine });

    await user.click(screen.getByRole("button", { name: /go to source/i }));

    expect(onNavigateToLine).toHaveBeenCalledWith("main.tex", 12);
  });

  it("omits the action when TeX reported no line, since navigation is impossible", () => {
    renderDrawer({ warnings: [{ ...WARNING, line: 0 }], errors: [] });

    // Nothing to jump to, so the button must not be offered.
    expect(screen.queryByRole("button", { name: /go to source/i })).toBeNull();
  });

  it("does not throw when no handler is supplied", async () => {
    const user = userEvent.setup();
    renderDrawer({ onNavigateToLine: undefined });

    await user.click(screen.getByRole("button", { name: /go to source/i }));

    expect(screen.getByRole("region", { name: /compile logs/i })).toBeInTheDocument();
  });
});

describe("code excerpts", () => {
  it("renders an excerpt when one is supplied", () => {
    renderDrawer({
      errors: [{ ...ERROR, excerpt: "\\documentclass{article}\n\\badcommand\n\\end{document}" }],
    });

    expect(screen.getByText("\\badcommand")).toBeInTheDocument();
  });

  it("omits the excerpt block when absent, matching the API payload", () => {
    renderDrawer();

    // The API never sends `excerpt`, so the panel must not render an empty box.
    expect(screen.getByText("Undefined control sequence.")).toBeInTheDocument();
    expect(screen.queryByText(/documentclass/)).toBeNull();
  });
});

describe("header", () => {
  it("closes when the close button is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderDrawer({ onClose });

    await user.click(screen.getByRole("button", { name: /close compile logs/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("omits the compile-time caption when no diagnostics exist", () => {
    renderDrawer({ errors: [], warnings: [], compileTime: 1.4 });

    expect(screen.queryByText(/compile failed/i)).toBeNull();
  });

  it("reports the real compile duration", () => {
    renderDrawer({ compileTime: 2.75 });

    expect(screen.getByText(/compile failed in 2\.8s/i)).toBeInTheDocument();
  });

  it("does not hardcode a duration when none is supplied", () => {
    renderDrawer({ compileTime: undefined });

    expect(screen.queryByText(/in 1\.4s/i)).toBeNull();
  });
});

/**
 * Replace `navigator.clipboard`.
 *
 * jsdom exposes it as a getter-only property, so `Object.assign` throws and the
 * descriptor must be redefined instead. `userEvent.setup()` installs its own
 * clipboard stub, so it must run first or this override would be discarded.
 */
function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return () => {
    if (original) Object.defineProperty(navigator, "clipboard", original);
  };
}

describe("copy log", () => {
  it("copies the raw log to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const restore = stubClipboard(writeText);
    renderDrawer({ rawLog: "log body" });

    await user.click(screen.getByRole("button", { name: /copy log/i }));

    expect(writeText).toHaveBeenCalledWith("log body");
    restore();
  });

  it("confirms the copy", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const restore = stubClipboard(writeText);
    renderDrawer();

    await user.click(screen.getByRole("button", { name: /copy log/i }));

    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
    restore();
  });

  it("does not report success when the clipboard is denied", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const restore = stubClipboard(writeText);
    renderDrawer();

    await user.click(screen.getByRole("button", { name: /copy log/i }));

    // Must not falsely claim success.
    expect(screen.queryByRole("button", { name: /copied/i })).toBeNull();
    restore();
  });
});

describe("accessibility", () => {
  it("marks the active tab for assistive tech", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(screen.getByRole("tab", { name: /warnings/i }));

    expect(screen.getByRole("tab", { name: /warnings/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /errors/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("exposes the severity on each diagnostic for styling and testing", () => {
    renderDrawer();

    expect(screen.getByTestId("error-item")).toHaveAttribute("data-severity", "error");
  });

  it("renders every diagnostic in the active tab", () => {
    renderDrawer({
      errors: [ERROR, { ...ERROR, line: 30, message: "Second problem." }],
    });

    const list = screen.getAllByTestId("error-item");
    expect(list).toHaveLength(2);
    expect(within(list[0]).getByText("main.tex, line 12")).toBeInTheDocument();
  });
});