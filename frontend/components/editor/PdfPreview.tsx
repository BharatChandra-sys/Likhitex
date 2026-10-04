"use client";

/**
 * PDF Preview with page navigation controls.
 * 
 * Uses iframe for display with page navigation and zoom controls.
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

  // Create blob URL for PDF and get page count
  useEffect(() => {
    if (!pdfBase64) {
      setPdfUrl(null);
      setTotalPages(0);
      setCurrentPage(1);
      return;
    }

    const loadPdf = async () => {
      try {
        const bytes = base64ToBytes(pdfBase64);
        // Create a proper ArrayBuffer for Blob (TypeScript workaround)
        const buffer = bytes.buffer.slice(0) as ArrayBuffer;
        const blob = new Blob([buffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);

        // Use PDF.js to get page count
        if (typeof window !== 'undefined') {
          const pdfjsLib = (await import('pdfjs-dist')) as any;
          pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
          const loadingTask = pdfjsLib.getDocument({ data: bytes });
          const doc = await loadingTask.promise;
          setTotalPages(doc.numPages);
        }
      } catch (err) {
        console.error('Failed to load PDF:', err);
      }
    };

    void loadPdf();

    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
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

  // Download PDF
  const handleDownload = () => {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = 'document.pdf';
    a.click();
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
              <button
                type="button"
                onClick={handleDownload}
                className="h-7 w-7 rounded flex items-center justify-center text-gray-700 hover:bg-gray-100 transition-colors"
                title="Download PDF"
                aria-label="Download PDF"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
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
            key={`page-${currentPage}-zoom-${zoom}`}
            src={`${pdfUrl}#page=${currentPage}&zoom=${zoom}&toolbar=0&navpanes=0&scrollbar=1`}
            className="w-full h-full border-0"
            title="PDF Preview"
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-6">
            <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
              <FileText className="w-8 h-8 text-gray-400" />
            </div>
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
