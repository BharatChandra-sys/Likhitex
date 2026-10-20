"use client";

import { Loader2, CheckCircle, X } from "lucide-react";

interface ConnectionBannerProps {
  status: "disconnected" | "reconnected" | "hidden";
  retryIn?: number;
  onSyncNow?: () => void;
  onDismiss?: () => void;
  localChanges?: number;
  syncTime?: number;
  commitHash?: string;
}

export function ConnectionBanner({
  status,
  retryIn,
  onSyncNow,
  onDismiss,
  localChanges = 0,
  syncTime,
  commitHash,
}: ConnectionBannerProps) {
  if (status === "hidden") return null;

  if (status === "disconnected") {
    return (
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {/* Inline Spinner */}
          <Loader2 className="w-4 h-4 animate-spin text-amber-600 flex-shrink-0" />
          <div className="text-xs text-amber-900 font-medium">
            Connection lost. Your changes are saved locally and will sync when you&apos;re back.
          </div>
        </div>

        <div className="flex items-center gap-2">
          {retryIn !== undefined && (
            <span className="text-[11px] font-mono text-amber-700 bg-amber-100/60 px-2 py-0.5 rounded">
              Retry in {retryIn}s
            </span>
          )}
          {onSyncNow && (
            <button
              onClick={onSyncNow}
              className="h-6 px-2 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-medium rounded transition-colors shadow-xs"
            >
              Sync now
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status === "reconnected") {
    return (
      <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-2.5 flex items-center justify-between transition-all">
        <div className="flex items-center gap-2.5">
          {/* Checkmark Icon */}
          <div className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0">
            <CheckCircle className="w-2.5 h-2.5" />
          </div>
          <div className="text-xs text-emerald-900 font-medium">
            Back online. {localChanges > 0 && `All ${localChanges} local changes synced with cluster`}
            {commitHash && (
              <>
                {" "}commit <span className="font-mono text-emerald-800 font-semibold">#{commitHash}</span>
              </>
            )}.
          </div>
        </div>

        <div className="flex items-center gap-2">
          {syncTime !== undefined && (
            <span className="text-[11px] font-mono text-emerald-700">Sync: {syncTime}ms</span>
          )}
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="text-emerald-700 hover:text-emerald-900 text-xs p-1"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
