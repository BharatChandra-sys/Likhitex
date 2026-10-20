"use client";

import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

interface ConnectionBannerProps {
  status: ConnectionStatus;
  onDismiss?: () => void;
}

export function ConnectionBanner({ status, onDismiss }: ConnectionBannerProps) {
  if (status === "connected") {
    return null; // Don't show banner when connected
  }

  const isReconnecting = status === "reconnecting";
  const isDisconnected = status === "disconnected";

  return (
    <div
      className={cn(
        "fixed top-14 left-0 right-0 z-40 px-4 py-3 text-sm font-medium flex items-center justify-center gap-2",
        isReconnecting && "bg-warning text-on-warning",
        isDisconnected && "bg-error text-on-error"
      )}
    >
      {isReconnecting && (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Connection lost. Your changes are saved locally and will sync when you're back.</span>
        </>
      )}
      
      {isDisconnected && (
        <>
          <AlertCircle className="w-4 h-4" />
          <span>Unable to connect to the server. Please check your internet connection.</span>
        </>
      )}
    </div>
  );
}

export function ConnectionRestored({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="fixed top-14 left-0 right-0 z-40 px-4 py-3 bg-secondary text-on-secondary text-sm font-medium flex items-center justify-center gap-2">
      <CheckCircle className="w-4 h-4" />
      <span>Back online. All changes synced.</span>
      <button
        onClick={onDismiss}
        className="ml-4 underline hover:no-underline"
      >
        Dismiss
      </button>
    </div>
  );
}
