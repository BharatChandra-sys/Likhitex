"use client";

import { AlertCircle, FolderPlus, Inbox, Loader2, RotateCw } from "lucide-react";

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
}

export function ProjectsEmptyState({ isSearching, onClearSearch, onCreate }: EmptyStateProps) {
  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-[#E5E7EB] py-16 px-6 flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-2xl bg-surface-container flex items-center justify-center mb-4">
        {isSearching ? (
          <Inbox className="w-6 h-6 text-outline" />
        ) : (
          <FolderPlus className="w-6 h-6 text-outline" />
        )}
      </div>
      <h3 className="text-sm font-semibold text-on-surface">
        {isSearching ? "No projects found" : "No projects yet"}
      </h3>
      <p className="text-xs text-on-surface-variant mt-1 max-w-[380px]">
        {isSearching
          ? "No project name matches that search. Try a different term or clear the search."
          : "Create your first LaTeX project to start writing, then invite co-authors to collaborate."}
      </p>
      <button
        type="button"
        onClick={isSearching ? onClearSearch : onCreate}
        className="mt-5 h-8 px-4 bg-primary-container text-on-primary hover:bg-primary text-sm font-semibold rounded-lg transition-colors"
      >
        {isSearching ? "Clear search" : "New Project"}
      </button>
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
