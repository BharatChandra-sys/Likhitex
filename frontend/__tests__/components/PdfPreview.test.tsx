import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PdfPreview from "@/components/editor/PdfPreview";

/**
 * The preview turns the compile response's base64 PDF into something an iframe
 * can display, so these tests cover the parts that are easy to get subtly wrong:
 * object-URL lifecycle, the base64 decode, and the empty/error states.
 */

/** A minimal, valid PDF header. Content is irrelevant to the component. */
const PDF_BASE64 = "JVBERi0xLjQKJcTl8uXrCg==";

describe("PdfPreview", () => {
  let created: string[];
  let revoked: string[];

  beforeEach(() => {
    created = [];
    revoked = [];

    // jsdom has no object-URL implementation, and the component must revoke what
    // it creates or every compiled PDF would stay pinned for the tab's lifetime.
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => {
        const url = `blob:mock/${created.length}`;
        created.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revoked.push(url);
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows an empty state before the first successful compile", () => {
    render(
      <PdfPreview pdfBase64={null} isCompiling={false} error={null} errorCount={0} onCompile={vi.fn()} onOpenLogs={vi.fn()} />,
    );

    expect(screen.getByText("No preview yet")).toBeInTheDocument();
    expect(screen.queryByTitle("Compiled PDF preview")).not.toBeInTheDocument();
  });

  it("reports progress while compiling instead of claiming there is no preview", () => {
    render(
      <PdfPreview pdfBase64={null} isCompiling error={null} errorCount={0} onCompile={vi.fn()} onOpenLogs={vi.fn()} />,
    );

    expect(screen.getByText("Compiling your document…")).toBeInTheDocument();
  });

  it("renders an iframe from an object URL once a PDF arrives", () => {
    render(
      <PdfPreview pdfBase64={PDF_BASE64} isCompiling={false} error={null} errorCount={0} onCompile={vi.fn()} onOpenLogs={vi.fn()} />,
    );

    const frame = screen.getByTitle("Compiled PDF preview");
    expect(frame).toHaveAttribute("src", expect.stringContaining("blob:mock/0"));
  });

  it("revokes the previous object URL when a new PDF replaces it", () => {
    const { rerender } = render(
      <PdfPreview pdfBase64={PDF_BASE64} isCompiling={false} error={null} errorCount={0} onCompile={vi.fn()} onOpenLogs={vi.fn()} />,
    );

    const second = btoa("%PDF-1.4 second");
    rerender(
      <PdfPreview pdfBase64={second} isCompiling={false} error={null} errorCount={0} onCompile={vi.fn()} onOpenLogs={vi.fn()} />,
    );

    expect(revoked).toContain("blob:mock/0");
  });

  it("revokes the object URL on unmount", () => {
    const { unmount } = render(
      <PdfPreview pdfBase64={PDF_BASE64} isCompiling={false} error={null} errorCount={0} onCompile={vi.fn()} onOpenLogs={vi.fn()} />,
    );

    unmount();

    expect(revoked).toContain("blob:mock/0");
  });

  it("offers a download link only when there is a PDF", () => {
    const { rerender } = render(
      <PdfPreview pdfBase64={null} isCompiling={false} error={null} errorCount={0} onCompile={vi.fn()} onOpenLogs={vi.fn()} />,
    );
    expect(screen.queryByLabelText("Download PDF")).not.toBeInTheDocument();

    rerender(
      <PdfPreview pdfBase64={PDF_BASE64} isCompiling={false} error={null} errorCount={0} onCompile={vi.fn()} onOpenLogs={vi.fn()} />,
    );
    expect(screen.getByLabelText("Download PDF")).toHaveAttribute("href", "blob:mock/0");
  });

  it("surfaces the error count and opens the logs when clicked", async () => {
    const user = userEvent.setup();
    const onOpenLogs = vi.fn();
    render(
      <PdfPreview pdfBase64={null} isCompiling={false} error={null} errorCount={2} onCompile={vi.fn()} onOpenLogs={onOpenLogs} />,
    );

    await user.click(screen.getByLabelText("2 compile errors"));

    expect(onOpenLogs).toHaveBeenCalled();
  });

  it("turns a compile failure into a button that opens the logs", async () => {
    const user = userEvent.setup();
    const onOpenLogs = vi.fn();
    render(
      <PdfPreview
        pdfBase64={null}
        isCompiling={false}
        error="Compilation exceeded 60s timeout"
        errorCount={0}
        onCompile={vi.fn()}
        onOpenLogs={onOpenLogs}
      />,
    );

    const button = screen.getByText("Compilation exceeded 60s timeout");
    await user.click(button);

    expect(onOpenLogs).toHaveBeenCalled();
  });

  it("steps zoom through fixed increments", async () => {
    const user = userEvent.setup();
    render(
      <PdfPreview pdfBase64={PDF_BASE64} isCompiling={false} error={null} errorCount={0} onCompile={vi.fn()} onOpenLogs={vi.fn()} />,
    );

    expect(screen.getByText("100%")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Zoom in"));
    expect(screen.getByText("125%")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Zoom out"));
    await user.click(screen.getByLabelText("Zoom out"));
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("will not zoom past the supported range", async () => {
    const user = userEvent.setup();
    render(
      <PdfPreview pdfBase64={PDF_BASE64} isCompiling={false} error={null} errorCount={0} onCompile={vi.fn()} onOpenLogs={vi.fn()} />,
    );

    for (let i = 0; i < 10; i++) await user.click(screen.getByLabelText("Zoom out"));

    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  /**
   * Regression test for a silent, development-only failure.
   *
   * The URL used to be built in `useMemo`. React's StrictMode runs an extra
   * setup-then-cleanup cycle, and `useMemo` is not re-invoked by it, so the first
   * cleanup revoked the only URL and it was never recreated -- a permanently blank
   * preview in dev while production looked fine.
   */
  it("keeps a usable URL through StrictMode's double mount", () => {
    render(
      <StrictMode>
        <PdfPreview pdfBase64={PDF_BASE64} isCompiling={false} error={null} errorCount={0} onCompile={vi.fn()} onOpenLogs={vi.fn()} />
      </StrictMode>,
    );

    const frame = screen.getByTitle("Compiled PDF preview");
    const src = frame.getAttribute("src") ?? "";

    // The rendered URL must not be one that has already been revoked.
    expect(revoked).not.toContain(src);
  });

  it("recreates the URL after the StrictMode cleanup revoked the first one", () => {
    render(
      <StrictMode>
        <PdfPreview pdfBase64={PDF_BASE64} isCompiling={false} error={null} errorCount={0} onCompile={vi.fn()} onOpenLogs={vi.fn()} />
      </StrictMode>,
    );

    // StrictMode creates, revokes, then creates again; the live URL is the last one.
    expect(created.length).toBeGreaterThan(1);
    const live = screen.getByTitle("Compiled PDF preview").getAttribute("src");
    expect(created.at(-1)).toBe(live);
  });

  it("starts a compile when Recompile is pressed", async () => {
    const user = userEvent.setup();
    const onCompile = vi.fn();
    render(
      <PdfPreview pdfBase64={PDF_BASE64} isCompiling={false} error={null} errorCount={0} onCompile={onCompile} onOpenLogs={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: /Recompile/ }));

    expect(onCompile).toHaveBeenCalled();
  });

  it("disables Recompile while a compile is already running", () => {
    render(
      <PdfPreview pdfBase64={null} isCompiling error={null} errorCount={0} onCompile={vi.fn()} onOpenLogs={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: /Compiling/ })).toBeDisabled();
  });

  /**
   * Zoom must widen the viewport, not CSS-scale it. A transform rasterises the page
   * at 1x and stretches it, which makes text blurry and unselectable when zoomed.
   */
  it("widens the iframe for zoom instead of scaling it with a transform", async () => {
    const user = userEvent.setup();
    render(
      <PdfPreview pdfBase64={PDF_BASE64} isCompiling={false} error={null} errorCount={0} onCompile={vi.fn()} onOpenLogs={vi.fn()} />,
    );

    const frame = screen.getByTitle("Compiled PDF preview");
    const at100 = Number.parseInt(frame.style.width, 10);

    await user.click(screen.getByLabelText("Zoom in"));

    const at125 = Number.parseInt(frame.style.width, 10);
    expect(at125).toBeGreaterThan(at100);
    expect(frame.style.transform).toBe("");
  });

  it("disables the zoom controls at the ends of the range", async () => {
    const user = userEvent.setup();
    render(
      <PdfPreview pdfBase64={PDF_BASE64} isCompiling={false} error={null} errorCount={0} onCompile={vi.fn()} onOpenLogs={vi.fn()} />,
    );

    for (let i = 0; i < 10; i++) await user.click(screen.getByLabelText("Zoom out"));

    expect(screen.getByLabelText("Zoom out")).toBeDisabled();
    expect(screen.getByLabelText("Zoom in")).toBeEnabled();
  });
});
