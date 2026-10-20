"use client";

/**
 * PDF Preview with page navigation controls.
 * 
 * Uses an iframe for display with page navigation and zoom controls. Zoom
 * widens the iframe rather than CSS-scaling it, so text stays sharp.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Download, FileText, Loader2, Play } from "lucide-react";
import { parseSyncTeX } from "@/lib/synctex";

export const ZOOM_STEPS = [50, 75, 100, 125, 150, 200] as const;

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

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="h-10 px-3 border-b border-gray-200 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCompile}
            disabled={isCompiling}
            className="h-7 px-3 rounded bg-blue-600 text-white text-xs font-medium flex items-center gap-1.5 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCompiling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            <span>{isCompiling ? "Compiling" : "Recompile"}</span>
          </button>

          {/* Logs button - always visible */}
          <button
            type="button"
            onClick={onOpenLogs}
            className={`h-7 px-2 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${
              error
                ? 'bg-red-50 text-red-700 hover:bg-red-100'
                : errorCount > 0
                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title={error || errorCount > 0 ? 'View errors' : 'View compile logs'}
            aria-label={
              errorCount > 0
                ? `${errorCount} compile ${errorCount === 1 ? "error" : "errors"}`
                : undefined
            }
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Logs</span>
            {errorCount > 0 && (
              <span className="ml-0.5 bg-red-600 text-white text-[9px] font-bold h-4 px-1 rounded-full flex items-center justify-center min-w-4">
                {errorCount}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-1">
          {pdfUrl && (
            <>
              {/* Download */}
              <a
                href={pdfUrl}
                download="document.pdf"
                className="h-7 w-7 rounded flex items-center justify-center text-gray-700 hover:bg-gray-100 transition-colors"
                title="Download PDF"
                aria-label="Download PDF"
              >
                <Download className="w-3.5 h-3.5" />
              </a>
              <div className="w-px h-4 bg-gray-200 mx-0.5" />
              
              {/* Page navigation */}
              <button
                type="button"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="h-7 w-6 rounded flex items-center justify-center text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-lg leading-none"
                title="Previous page"
                aria-label="Previous page"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={totalPages || 1}
                value={currentPage}
                onChange={handlePageInputChange}
                className="h-7 w-12 px-1 text-xs text-center border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 tabular-nums"
                aria-label="Current page"
              />
              <span className="text-xs text-gray-600 whitespace-nowrap">/ {totalPages || '—'}</span>
              <button
                type="button"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= (totalPages || 1)}
                className="h-7 w-6 rounded flex items-center justify-center text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-lg leading-none"
                title="Next page"
                aria-label="Next page"
              >
                +
              </button>
              <div className="w-px h-4 bg-gray-200 mx-0.5" />
            </>
          )}
          
          {/* Zoom controls */}
          <button
            type="button"
            onClick={() => stepZoom(-1)}
            disabled={zoom === ZOOM_STEPS[0]}
            className="h-7 w-6 rounded flex items-center justify-center text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-base leading-none"
            title="Zoom out"
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="text-xs text-gray-700 font-medium px-1 min-w-9 text-center tabular-nums">
            {zoom}%
          </span>
          <button
            type="button"
            onClick={() => stepZoom(1)}
            disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            className="h-7 w-6 rounded flex items-center justify-center text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-base leading-none"
            title="Zoom in"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-gray-100">
        {pdfUrl ? (
          <iframe
            // Remount on page change: browsers ignore a fragment-only src update.
            key={`page-${currentPage}`}
            src={`${pdfUrl}#page=${currentPage}&toolbar=0&navpanes=0&scrollbar=1`}
            className="h-full border-0 block"
            style={{ width: `${zoom}%` }}
            title="Compiled PDF preview"
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-6">
            <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
              <FileText className="w-8 h-8 text-gray-400" />
            </div>
            {error && !isCompiling && (
              <button
                type="button"
                onClick={onOpenLogs}
                className="flex items-center gap-1.5 rounded bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{error}</span>
              </button>
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
          </div>
        )}
      </div>
    </div>
  );
}
