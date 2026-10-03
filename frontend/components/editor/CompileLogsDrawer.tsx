"use client";

import { useCallback, useState } from "react";
import { AlertCircle, AlertTriangle, FileText, X, Copy } from "lucide-react";
import type { Diagnostic } from "@/lib/api/types";

/**
 * A diagnostic plus the surrounding source lines, which the API does not send.
 *
 * `excerpt` is produced on the client from the already-loaded buffer rather than
 * over the wire, so it is optional here and rendered only when available.
 */
export interface CompileDiagnostic extends Diagnostic {
  excerpt?: string;
}

export interface CompileLogsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  errors: CompileDiagnostic[];
  warnings: CompileDiagnostic[];
  rawLog: string;
  /** Wall-clock compile duration shown in the header. */
  compileTime?: number;
  /**
   * Invoked by "Go to source". Previously a console.log stub, which left the
   * primary diagnostic action dead-ended.
   */
  onNavigateToLine?: (file: string, line: number) => void;
}

export default function CompileLogsDrawer({
  isOpen,
  onClose,
  errors,
  warnings,
  rawLog,
  compileTime,
  onNavigateToLine,
}: CompileLogsDrawerProps) {
  const [activeTab, setActiveTab] = useState<"errors" | "warnings" | "raw">(
    "errors"
  );
  const [copied, setCopied] = useState(false);

  const handleCopyLog = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rawLog);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by permissions policy; failing silently
      // here would leave the user thinking the copy worked.
      setCopied(false);
    }
  }, [rawLog]);

  if (!isOpen) return null;

  const handleGoToSource = (file: string, line: number) => {
    onNavigateToLine?.(file, line);
  };

  // TeX reports diagnostics with no file, and engine warnings with no line.
  const describeLocation = (file: string, line: number) => {
    const hasFile = file.length > 0;
    const hasLine = line > 0;
    if (hasFile && hasLine) return `${file}, line ${line}`;
    if (hasFile) return file;
    if (hasLine) return `line ${line}`;
    return "document";
  };

  const renderExcerpt = (diagnostic: CompileDiagnostic, tone: "red" | "amber") => {
    if (!diagnostic.excerpt) return null;
    const highlight = tone === "red" ? "bg-red-100" : "bg-amber-100";
    const border = tone === "red" ? "border-red-200" : "border-amber-200";

    return (
      <div className={`bg-white border ${border} rounded p-2.5 mb-3 font-mono text-xs`}>
        <div className="text-neutral-600">
          {diagnostic.excerpt.split("\n").map((line, index) => (
            <div
              key={`${diagnostic.file}-${diagnostic.line}-${index}`}
              className={index === 1 ? `${highlight} -mx-2.5 px-2.5` : ""}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderDiagnostic = (
    diagnostic: CompileDiagnostic,
    tone: "error" | "warning",
  ) => {
    const isError = tone === "error";
    return (
      <div
        key={`${diagnostic.file}-${diagnostic.line}-${diagnostic.message}`}
        data-testid={`${tone}-item`}
        data-severity={diagnostic.severity}
        className={
          isError
            ? "bg-red-50/50 border border-red-200 rounded-lg p-3 hover:shadow-sm transition-shadow"
            : "bg-amber-50/50 border border-amber-200 rounded-lg p-3 hover:shadow-sm transition-shadow"
        }
      >
        <div className="flex items-start gap-3">
          <div
            className={
              isError
                ? "w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center text-red-600 flex-shrink-0"
                : "w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600 flex-shrink-0"
            }
          >
            {isError ? (
              <AlertCircle className="w-5 h-5" />
            ) : (
              <AlertTriangle className="w-5 h-5" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={
                  isError
                    ? "text-xs font-mono font-semibold text-red-900"
                    : "text-xs font-mono font-semibold text-amber-900"
                }
              >
                {describeLocation(diagnostic.file, diagnostic.line)}
              </span>
              <span
                className={
                  isError
                    ? "text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium"
                    : "text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium"
                }
              >
                {isError ? "Error" : "Warning"}
              </span>
            </div>

            <div
              className={
                isError
                  ? "text-sm font-semibold text-red-900 mb-2 break-words"
                  : "text-sm font-semibold text-amber-900 mb-2 break-words"
              }
            >
              {diagnostic.message}
            </div>

            {renderExcerpt(diagnostic, isError ? "red" : "amber")}

            {/* Navigation is only meaningful when TeX gave us a real location. */}
            {diagnostic.line > 0 && (
              <button
                onClick={() => handleGoToSource(diagnostic.file, diagnostic.line)}
                className={
                  isError
                    ? "h-7 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium shadow-sm transition-colors"
                    : "h-7 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium shadow-sm transition-colors"
                }
              >
                Go to source
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const total = errors.length + warnings.length;

  return (
    <div
      className="absolute bottom-0 left-0 right-0 h-[45%] bg-white border-t border-neutral-200 flex flex-col z-10 shadow-lg"
      role="region"
      aria-label="Compile logs"
    >
      {/* Header */}
      <div className="h-10 border-b border-neutral-200 bg-neutral-50 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1 bg-white border border-neutral-200 rounded-lg p-0.5"
            role="tablist"
          >
            {(
              [
                { id: "errors", label: "Errors", count: errors.length },
                { id: "warnings", label: "Warnings", count: warnings.length },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? tab.id === "errors"
                      ? "bg-red-50 text-red-700 shadow-sm"
                      : "bg-amber-50 text-amber-700 shadow-sm"
                    : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {tab.id === "errors" ? (
                    <AlertCircle className="w-3.5 h-3.5" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  )}
                  {tab.label} ({tab.count})
                </span>
              </button>
            ))}
            <button
              role="tab"
              aria-selected={activeTab === "raw"}
              onClick={() => setActiveTab("raw")}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                activeTab === "raw"
                  ? "bg-neutral-100 text-neutral-900 shadow-sm"
                  : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                Raw Log
              </span>
            </button>
          </div>

          {total > 0 && (
            <span className="text-xs text-neutral-500 font-mono">
              Compile failed
              {compileTime !== undefined && ` in ${compileTime.toFixed(1)}s`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyLog}
            className="h-7 px-2.5 rounded-lg hover:bg-neutral-100 text-neutral-600 hover:text-neutral-900 text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>{copied ? "Copied" : "Copy Log"}</span>
          </button>
          <button
            onClick={onClose}
            aria-label="Close compile logs"
            className="h-7 w-7 rounded-lg hover:bg-neutral-100 text-neutral-600 hover:text-neutral-900 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "errors" &&
          (errors.length > 0 ? (
            <div className="space-y-3">
              {errors.map((diagnostic) => renderDiagnostic(diagnostic, "error"))}
            </div>
          ) : (
            <EmptyState tone="error" total={total} />
          ))}

        {activeTab === "warnings" &&
          (warnings.length > 0 ? (
            <div className="space-y-3">
              {warnings.map((diagnostic) => renderDiagnostic(diagnostic, "warning"))}
            </div>
          ) : (
            <EmptyState tone="warning" total={total} />
          ))}

        {activeTab === "raw" && (
          <div className="bg-neutral-900 text-green-400 font-mono text-xs p-4 rounded-lg overflow-auto">
            <pre className="whitespace-pre-wrap">{rawLog}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

/** Explains an empty tab instead of leaving a blank panel. */
function EmptyState({
  tone,
  total,
}: {
  tone: "error" | "warning";
  total: number;
}) {
  const label = tone === "error" ? "errors" : "warnings";

  return (
    <div className="h-full flex flex-col items-center justify-center text-neutral-400 gap-1 py-8">
      {tone === "error" ? (
        <AlertCircle className="w-6 h-6 text-emerald-500" />
      ) : (
        <AlertTriangle className="w-6 h-6" />
      )}
      <p className="text-sm font-medium text-neutral-600">No {label}</p>
      <p className="text-xs">
        {total === 0
          ? "The document compiled cleanly."
          : `The document has no ${label}.`}
      </p>
    </div>
  );
}
