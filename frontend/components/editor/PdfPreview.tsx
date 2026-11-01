"use client";

/**
 * PDF Preview with page navigation controls.
 * 
 * Uses an iframe for display with page navigation and zoom controls. Zoom
 * widens the iframe rather than CSS-scaling it, so text stays sharp.
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Minus,
  Play,
  Plus,
} from "lucide-react";
import { parseSyncTeX } from "@/lib/synctex";

export const ZOOM_STEPS = [50, 75, 100, 125, 150, 200] as const;

const ICON_BUTTON =
  "h-7 w-7 rounded-md flex items-center justify-center text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-35 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export interface PdfPreviewProps {
  pdfBase64: string | null;
  synctexBase64: string | null;
  isCompiling: boolean;
  error: string | null;
  errorCount: number;
  warningCount?: number;
  /** Seconds the last compile took; omitted before the first result. */
  compileTime?: number | null;
  onCompile: () => void;
  onOpenLogs: () => void;
  onJumpToLine?: (line: number) => void;
}

export default function PdfPreview({
  pdfBase64,
  synctexBase64,
  isCompiling,
  error,
  errorCount,
  warningCount = 0,
  compileTime = null,
  onCompile,
  onOpenLogs,
  onJumpToLine,
}: PdfPreviewProps) {
  const [zoom, setZoom] = useState(100);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [syncMappings, setSyncMappings] = useState<any[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // Parse SyncTeX data when available
  useEffect(() => {
    if (synctexBase64) {
      try {
        const mappings = parseSyncTeX(synctexBase64);
        setSyncMappings(mappings);
        console.log(`Parsed ${mappings.length} SyncTeX mappings`);
      } catch (err) {
        console.error('Failed to parse SyncTeX:', err);
      }
    }
  }, [synctexBase64]);

  // Create a blob URL for the PDF and read its page count.
  //
  // The URL is created and revoked by the same effect run, through a local
  // variable: revoking the `pdfUrl` state from the cleanup would hit a stale
  // closure and leak one full PDF per compile.
  useEffect(() => {
    if (!pdfBase64) {
      setPdfUrl(null);
      setTotalPages(0);
      setCurrentPage(1);
      return;
    }

    const bytes = base64ToBytes(pdfBase64);
    const url = URL.createObjectURL(
      new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }),
    );
    setPdfUrl(url);

    let cancelled = false;
    void (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        // pdf.js transfers the buffer to its worker, so hand it a copy.
        const task = pdfjsLib.getDocument({ data: bytes.slice() });
        const doc = await task.promise;
        if (!cancelled) setTotalPages(doc.numPages);
        void task.destroy();
      } catch (err) {
        console.error("Failed to load PDF:", err);
      }
    })();

    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [pdfBase64]);

  const stepZoom = (direction: 1 | -1) => {
    const current = ZOOM_STEPS.indexOf(zoom as (typeof ZOOM_STEPS)[number]);
    const base = current === -1 ? ZOOM_STEPS.indexOf(100) : current;
    setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, base + direction))]);
  };

  const goToPage = (page: number) => {
    const validPage = Math.max(1, Math.min(page, totalPages || 1));
    setCurrentPage(validPage);
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '') {
      setCurrentPage(1);
      return;
    }
    const pageNum = parseInt(value, 10);
    if (!isNaN(pageNum)) {
      goToPage(pageNum);
    }
  };

  const hasProblem = Boolean(error) || errorCount > 0;

  return (
    <div className="@container flex flex-col h-full min-h-0">
      <div className="h-11 px-3 border-b border-gray-200 flex items-center gap-1.5 shrink-0 bg-white">
        <button
          type="button"
          onClick={onCompile}
          disabled={isCompiling}
          title="Compile the project"
          className="h-8 px-3 rounded-md bg-primary text-white text-xs font-medium flex items-center gap-1.5 transition-colors hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
        >
          {isCompiling ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5 fill-current" />
          )}
          <span>{isCompiling ? "Compiling" : "Recompile"}</span>
        </button>

        <button
          type="button"
          onClick={onOpenLogs}
          title={hasProblem ? "View errors" : "View compile logs"}
          aria-label={
            errorCount > 0
              ? `${errorCount} compile ${errorCount === 1 ? "error" : "errors"}`
              : undefined
          }
          className={`h-8 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            hasProblem ? "text-red-700 hover:bg-red-50" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          }`}
        >
          <span>Logs</span>
          {errorCount > 0 ? (
            <span className="min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
              {errorCount}
            </span>
          ) : warningCount > 0 ? (
            <span
              title={`${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`}
              className="min-w-4 h-4 px-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold flex items-center justify-center tabular-nums"
            >
              {warningCount}
            </span>
          ) : null}
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          {pdfUrl && compileTime !== null && !isCompiling && (
            <span className="hidden @sm:inline text-[11px] text-gray-500 tabular-nums">
              {compileTime.toFixed(1)}s
            </span>
          )}
          {pdfUrl && (
            <a href={pdfUrl} download="document.pdf" className={ICON_BUTTON} title="Download PDF" aria-label="Download PDF">
              <Download className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>

      <div className="relative flex-1 min-h-0 bg-gray-100">
        {pdfUrl ? (
          <>
            <div className="h-full overflow-auto">
              <iframe
                // Remount on page change: browsers ignore a fragment-only src update.
                key={`page-${currentPage}`}
                src={`${pdfUrl}#page=${currentPage}&toolbar=0&navpanes=0&scrollbar=1`}
                className="h-full border-0 block mx-auto"
                style={{ width: `${zoom}%` }}
                title="Compiled PDF preview"
              />
            </div>

            {/* Viewing controls float over the page, out of the toolbar's way. */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-0.5 p-1 rounded-lg bg-white/95 border border-gray-200 shadow-md">
              {totalPages > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage <= 1}
                    className={ICON_BUTTON}
                    title="Previous page"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={totalPages}
                    value={currentPage}
                    onChange={handlePageInputChange}
                    className="h-7 w-8 text-xs text-center text-gray-800 rounded-md bg-transparent tabular-nums hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    aria-label="Current page"
                  />
                  <span className="text-xs text-gray-500 whitespace-nowrap pr-1 tabular-nums">/ {totalPages}</span>
                  <button
                    type="button"
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className={ICON_BUTTON}
                    title="Next page"
                    aria-label="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <div className="w-px h-4 bg-gray-200 mx-1" />
                </>
              )}
              <button
                type="button"
                onClick={() => stepZoom(-1)}
                disabled={zoom === ZOOM_STEPS[0]}
                className={ICON_BUTTON}
                title="Zoom out"
                aria-label="Zoom out"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="text-xs text-gray-700 min-w-10 text-center tabular-nums">{zoom}%</span>
              <button
                type="button"
                onClick={() => stepZoom(1)}
                disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                className={ICON_BUTTON}
                title="Zoom in"
                aria-label="Zoom in"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-6">
            {isCompiling ? (
              <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
            ) : (
              <FileText className="w-6 h-6 text-gray-400" />
            )}
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-700">
                {isCompiling ? "Compiling your document…" : "No preview yet"}
              </p>
              <p className="text-xs text-gray-500 max-w-70 leading-relaxed">
                {isCompiling
                  ? "This can take a few seconds for larger documents."
                  : "Compile the project to render a PDF preview here."}
              </p>
            </div>
            {error && !isCompiling && (
              <button
                type="button"
                onClick={onOpenLogs}
                className="flex items-start gap-1.5 max-w-80 rounded-md bg-red-50 px-3 py-2 text-left text-xs font-medium text-red-700 hover:bg-red-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                <span>{error}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
