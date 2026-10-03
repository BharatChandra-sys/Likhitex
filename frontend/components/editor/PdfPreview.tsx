"use client";

/**
 * Renders the PDF returned by the compile endpoint.
 *
 * The response is base64, so it is decoded to a Blob and exposed as an object URL
 * for the iframe to load.
 *
 * The URL is created inside the effect rather than in `useMemo`. That is not a
 * style preference: React's StrictMode runs an extra setup-then-cleanup cycle in
 * development, and `useMemo` is not re-invoked by that cycle. A memoised URL would
 * therefore be revoked by the first cleanup and never recreated, leaving a
 * permanently blank preview. This is the bug Streamlit hit and fixed the same way
 * (streamlit/streamlit#13602).
 *
 * The cleanup closes over the URL this effect invocation created, never over one
 * read from state, so a re-render cannot revoke a URL that is still in use.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Download, FileText, Loader2, Play } from "lucide-react";

/** A4 width at 96dpi, the reference the zoom percentage scales from. */
const BASE_PAGE_WIDTH_PX = 794;
/** A4 aspect ratio, used to keep the scroll area proportional while zoomed. */
const PAGE_ASPECT_RATIO = 1.414;

export const ZOOM_STEPS = [50, 75, 100, 125, 150, 200] as const;

/**
 * Decodes base64 into raw bytes.
 *
 * Done in slices rather than `atob` in one shot: `String.fromCharCode(...bytes)`
 * overflows the argument limit on large arrays, and a compiled thesis PDF is
 * routinely large enough to hit it.
 */
function base64ToBytes(base64: string): Blob | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: "application/pdf" });
  } catch {
    // Malformed base64 should blank the preview, not crash the editor.
    return null;
  }
}

export interface PdfPreviewProps {
  /** Base64 PDF, or null when nothing has compiled successfully yet. */
  pdfBase64: string | null;
  isCompiling: boolean;
  /** Set when the compile request itself failed. */
  error: string | null;
  errorCount: number;
  /** Starts a compile. Required, because the control is a real button. */
  onCompile: () => void;
  onOpenLogs: () => void;
}

export default function PdfPreview({
  pdfBase64,
  isCompiling,
  error,
  errorCount,
  onCompile,
  onOpenLogs,
}: PdfPreviewProps) {
  /**
   * The current object URL, tagged with the base64 that produced it.
   *
   * Tagging lets the live URL be *derived* rather than imperatively cleared: when
   * `pdfBase64` goes null there is no new URL to set, and the stale one simply no
   * longer matches. Without the tag the effect would have to call `setState`
   * synchronously to clear the value, which is a cascading render.
   */
  const [created, setCreated] = useState<{ url: string; forBase64: string } | null>(null);
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    if (!pdfBase64) return;

    const blob = base64ToBytes(pdfBase64);
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    // Setting state here is the documented use of an effect: synchronising an
    // external resource (the compiled PDF) into the tree. The derived-state
    // alternative -- building the URL during render -- is what reintroduces the
    // StrictMode revocation bug described at the top of this file, because a
    // render-phase cache survives the cleanup that revoked its entry.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCreated({ url, forBase64: pdfBase64 });

    // Closes over `url`, the value this invocation created.
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [pdfBase64]);

  const objectUrl = created && created.forBase64 === pdfBase64 ? created.url : null;

  const stepZoom = (direction: 1 | -1) => {
    const current = ZOOM_STEPS.indexOf(zoom as (typeof ZOOM_STEPS)[number]);
    const base = current === -1 ? ZOOM_STEPS.indexOf(100) : current;
    setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, base + direction))]);
  };

  const scale = zoom / 100;
  // The iframe is sized up rather than CSS-scaled. A transform would rasterise the
  // page at 1x and then stretch it, which makes text blurry and unselectable when
  // zoomed in; growing the viewport lets the PDF viewer render at the larger size.
  const frameWidth = Math.round(BASE_PAGE_WIDTH_PX * scale);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="h-10 px-2 border-b border-surface-container-high flex items-center justify-between shrink-0 bg-surface-container-lowest">
        {error ? (
          <button
            type="button"
            onClick={onOpenLogs}
            title="Open compile logs"
            className="h-8 px-2 rounded-lg bg-error-container text-on-error-container text-xs font-semibold flex items-center gap-1.5 hover:bg-error/20 transition-colors truncate max-w-[70%]"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{error}</span>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCompile}
              disabled={isCompiling}
              className="h-8 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold flex items-center gap-1.5 hover:bg-primary-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isCompiling ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>{isCompiling ? "Compiling…" : "Recompile"}</span>
            </button>

            {errorCount > 0 && (
              <button
                type="button"
                onClick={onOpenLogs}
                className="w-7 h-7 rounded flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low relative"
                aria-label={`${errorCount} compile errors`}
              >
                <AlertTriangle className="w-4 h-4" />
                <span className="absolute -top-0.5 -right-0.5 bg-error text-white text-[9px] font-bold h-3.5 w-3.5 rounded-full flex items-center justify-center">
                  {errorCount}
                </span>
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-1">
          {objectUrl && (
            <a
              href={objectUrl}
              download="document.pdf"
              className="w-7 h-7 rounded flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low transition-colors"
              title="Download PDF"
              aria-label="Download PDF"
            >
              <Download className="w-4 h-4" />
            </a>
          )}
          <div className="w-[1px] h-4 bg-surface-container-high mx-1" />
          <button
            type="button"
            onClick={() => stepZoom(-1)}
            disabled={zoom === ZOOM_STEPS[0]}
            className="w-7 h-7 rounded flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Zoom out"
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="text-xs text-on-surface-variant font-medium px-1 w-10 text-center tabular-nums">
            {zoom}%
          </span>
          <button
            type="button"
            onClick={() => stepZoom(1)}
            disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            className="w-7 h-7 rounded flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Zoom in"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 bg-surface-dim">
        {objectUrl ? (
          <iframe
            // Re-keying on the URL forces the PDF plugin to load the new document.
            // A blob URL changes whenever the PDF does, so this never fires for a
            // recompile that produced identical bytes.
            key={objectUrl}
            src={objectUrl}
            title="Compiled PDF preview"
            className="bg-white shadow-lg border-0 mx-auto block"
            style={{ width: frameWidth, height: Math.round(frameWidth * PAGE_ASPECT_RATIO) }}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2 px-6">
            <FileText className="w-10 h-10 text-outline opacity-50" />
            <p className="text-sm text-on-surface-variant">
              {isCompiling ? "Compiling your document…" : "No preview yet"}
            </p>
            <p className="text-xs text-outline max-w-[280px] leading-relaxed">
              {isCompiling
                ? "This can take a few seconds for larger documents."
                : "Compile the project to render a PDF preview here."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}