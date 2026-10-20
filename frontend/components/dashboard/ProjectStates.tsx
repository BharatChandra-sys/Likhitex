"use client";

import { AlertCircle, FolderPlus, Inbox, Loader2, RotateCw, Plus, Upload } from "lucide-react";

/** First-load placeholder: the shape of the table, so the layout does not jump. */
export function ProjectsSkeleton() {
  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden">
      <div className="bg-surface-container-low px-3 py-2.5 border-b border-[#E5E7EB] flex gap-6">
        {["w-[220px]", "w-[120px]", "w-[100px]", "w-[130px]", "w-[80px]"].map((w) => (
          <div key={w} className={`h-3 ${w} rounded bg-surface-container`} />
        ))}
      </div>
      <div className="divide-y divide-surface-container">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="px-3 py-3 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-surface-container shrink-0" />
            <div className="flex-1 flex flex-col gap-1.5 min-w-0">
              <div className="h-3 w-2/5 rounded bg-surface-container" />
              <div className="h-2.5 w-1/4 rounded bg-surface-container-low" />
            </div>
            <div className="h-5 w-20 rounded bg-surface-container-low" />
            <div className="h-5 w-14 rounded bg-surface-container-low" />
          </div>
        ))}
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        <Loader2 className="animate-spin" aria-hidden="true" />
        Loading projects
      </div>
    </div>
  );
}

interface EmptyStateProps {
  isSearching: boolean;
  onClearSearch: () => void;
  onCreate: () => void;
  onUploadZip?: () => void;
}

export function ProjectsEmptyState({ isSearching, onClearSearch, onCreate, onUploadZip }: EmptyStateProps) {
  // If searching/filtering, show simple message
  if (isSearching) {
    return (
      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-[#E5E7EB] py-16 px-6 flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-2xl bg-surface-container flex items-center justify-center mb-4">
          <Inbox className="w-6 h-6 text-outline" />
        </div>
        <h3 className="text-sm font-semibold text-on-surface">No projects found</h3>
        <p className="text-xs text-on-surface-variant mt-1 max-w-[380px]">
          No project name matches that search. Try a different term or clear the search.
        </p>
        <button
          type="button"
          onClick={onClearSearch}
          className="mt-5 h-8 px-4 bg-primary-container text-on-primary hover:bg-primary text-sm font-semibold rounded-lg transition-colors"
        >
          Clear search
        </button>
      </div>
    );
  }

  // True empty state with new design
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-16 bg-[radial-gradient(circle,_#E5E7EB_1px,_transparent_1px)] bg-[length:24px_24px] rounded-xl">
      {/* Quill & Blank Paper Illustration */}
      <div className="relative mb-6">
        <div className="w-24 h-32 bg-white rounded-md border border-gray-300 shadow-sm relative overflow-hidden flex flex-col justify-between p-3 rotate-[-3deg] transition-transform hover:rotate-0 duration-300">
          {/* LaTeX Document Header Preview */}
          <div className="space-y-1.5 opacity-40">
            <div className="h-2 w-12 bg-gray-800 rounded-sm"></div>
            <div className="h-1 w-full bg-gray-300 rounded-sm"></div>
            <div className="h-1 w-4/5 bg-gray-300 rounded-sm"></div>
            <div className="h-1 w-3/4 bg-gray-300 rounded-sm"></div>
          </div>
          <div className="space-y-1 opacity-25">
            <div className="h-1 w-full bg-gray-300 rounded-sm"></div>
            <div className="h-1 w-5/6 bg-gray-300 rounded-sm"></div>
          </div>
          <div className="text-[9px] font-mono text-gray-400 text-right">.tex</div>
        </div>

        {/* Stylized Quill & Bracket Badge */}
        <div className="absolute -bottom-3 -right-3 w-12 h-12 rounded-full bg-indigo-50 border-2 border-white shadow-md flex items-center justify-center text-indigo-600">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z"/>
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
            <path d="M2 2l7.586 7.586"/>
            <circle cx="11" cy="11" r="2"/>
          </svg>
        </div>
      </div>

      {/* Typography */}
      <h3 className="text-base font-semibold text-gray-900 mb-1">Create your first project</h3>
      <p className="text-xs text-gray-500 max-w-sm mb-6 leading-relaxed">
        Collaborate on academic papers, theses, or problem sets in real-time with verified institutional peers.
      </p>

      {/* Action Buttons (32px compact controls) */}
      <div className="flex items-center gap-3">
        <button
          onClick={onCreate}
          className="h-8 px-3.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-md shadow-sm flex items-center gap-1.5 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Project</span>
        </button>
        {onUploadZip && (
          <button
            onClick={onUploadZip}
            className="h-8 px-3.5 bg-white hover:bg-gray-50 text-gray-700 text-xs font-medium border border-gray-300 rounded-md shadow-sm flex items-center gap-1.5 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload zip</span>
          </button>
        )}
      </div>

      <div className="mt-6 pt-4 border-t border-gray-200/60 w-full max-w-xs flex items-center justify-center gap-2 text-[11px] text-gray-400 font-mono">
        <span>TeX Live 2024</span>
        <span>•</span>
        <span>Git backed</span>
        <span>•</span>
        <span>Instant sync</span>
      </div>
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  requestId: string | null;
  onRetry: () => void;
  /** True when the API could not be reached at all. */
  isNetworkError: boolean;
}

export function ProjectsErrorState({
  message,
  requestId,
  onRetry,
  isNetworkError,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="bg-surface-container-lowest rounded-xl shadow-sm border border-error/40 py-12 px-6 flex flex-col items-center text-center"
    >
      <div className="w-14 h-14 rounded-2xl bg-error/10 flex items-center justify-center mb-4">
        <AlertCircle className="w-6 h-6 text-error" />
      </div>
      <h3 className="text-sm font-semibold text-on-surface">
        {isNetworkError ? "Could not reach the API" : "Could not load projects"}
      </h3>
      <p className="text-xs text-on-surface-variant mt-1 max-w-[420px]">{message}</p>
      {isNetworkError && (
        <p className="text-[11px] font-[family-name:var(--font-mono)] text-outline mt-2">
          Expected the API at the NEXT_PUBLIC_API_URL origin.
        </p>
      )}
      {requestId && (
        <p className="text-[11px] font-[family-name:var(--font-mono)] text-outline mt-2">
          request_id: {requestId}
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 h-8 px-4 bg-on-surface text-surface hover:bg-on-surface/90 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
      >
        <RotateCw className="w-4 h-4" />
        Try again
      </button>
    </div>
  );
}
