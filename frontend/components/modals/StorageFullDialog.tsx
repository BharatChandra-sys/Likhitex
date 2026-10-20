"use client";

import { AlertTriangle, ArrowRight, X } from "lucide-react";

interface StorageFullDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onManageStorage: () => void;
  usedMB: number;
  limitMB: number;
  breakdown?: {
    sourceMB: number;
    imagesMB: number;
    cacheMB: number;
  };
  reclaimableMB?: number;
}

export function StorageFullDialog({
  isOpen,
  onClose,
  onManageStorage,
  usedMB,
  limitMB,
  breakdown = { sourceMB: 96, imagesMB: 64, cacheMB: 40 },
  reclaimableMB = 42,
}: StorageFullDialogProps) {
  if (!isOpen) return null;

  const percentUsed = Math.round((usedMB / limitMB) * 100);
  const sourcePercent = Math.round((breakdown.sourceMB / limitMB) * 100);
  const imagesPercent = Math.round((breakdown.imagesMB / limitMB) * 100);
  const cachePercent = Math.round((breakdown.cacheMB / limitMB) * 100);

  return (
    <>
      {/* Modal backdrop */}
      <div
        className="fixed inset-0 bg-gray-900/10 z-50 flex items-center justify-center p-8"
        onClick={onClose}
      >
        {/* Dialog Card (460px) */}
        <div
          className="w-full max-w-[440px] bg-white border border-gray-200 rounded-md shadow-xl overflow-hidden animate-in fade-in duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="p-5 pb-4">
            <div className="flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-md bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 flex-shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">
                    You&apos;ve reached your {limitMB} MB limit
                  </h3>
                  <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  Compilations, git snapshots, and asset uploads are temporarily halted until disk space is freed or allocated.
                </p>
              </div>
            </div>

            {/* Storage Consumption Breakdown Bar */}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <div className="flex items-center justify-between text-xs font-mono mb-1.5">
                <span className="text-gray-600 font-medium">Used disk quota</span>
                <span className="text-red-600 font-semibold">
                  {usedMB.toFixed(1)} MB / {limitMB} MB ({percentUsed}%)
                </span>
              </div>

              {/* Stacked Progress indicator */}
              <div className="w-full h-2 rounded-sm bg-gray-100 overflow-hidden flex">
                <div
                  style={{ width: `${sourcePercent}%` }}
                  className="h-full bg-indigo-600"
                  title={`Source files: ${breakdown.sourceMB} MB`}
                ></div>
                <div
                  style={{ width: `${imagesPercent}%` }}
                  className="h-full bg-sky-500"
                  title={`Images: ${breakdown.imagesMB} MB`}
                ></div>
                <div
                  style={{ width: `${cachePercent}%` }}
                  className="h-full bg-amber-500"
                  title={`PDF Cache & Git: ${breakdown.cacheMB} MB`}
                ></div>
              </div>

              {/* Legend pills */}
              <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px] font-mono text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>
                  .tex &amp; .bib
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                  Figures/PDFs
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  Build Cache
                </span>
              </div>
            </div>

            {/* Recommendation Callout */}
            {reclaimableMB > 0 && (
              <div className="mt-3 p-2.5 rounded bg-gray-50 border border-gray-200 text-[11px] text-gray-600">
                <span className="font-medium text-gray-800">Quick tip:</span> Pruning
                auxiliary logs (<code className="font-mono">.aux</code>,{" "}
                <code className="font-mono">.bbl</code>, cached PDF revisions) in Account
                Settings can immediately recover up to{" "}
                <span className="font-mono font-medium text-gray-900">
                  {reclaimableMB} MB
                </span>
                .
              </div>
            )}
          </div>

          {/* Modal Footer Actions (32px controls) */}
          <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2.5">
            <button
              onClick={onClose}
              className="h-8 px-3 text-xs font-medium text-gray-700 hover:bg-gray-100 border border-gray-300 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onManageStorage}
              className="h-8 px-3.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded shadow-sm flex items-center gap-1.5 transition-colors"
            >
              <span>Manage storage</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
