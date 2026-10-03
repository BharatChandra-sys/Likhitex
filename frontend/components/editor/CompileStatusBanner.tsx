import { AlertCircle, X } from "lucide-react";

interface CompileStatusBannerProps {
  errorCount: number;
  warningCount: number;
  onShowLogs: () => void;
  onDismiss?: () => void;
}

export default function CompileStatusBanner({
  errorCount,
  warningCount,
  onShowLogs,
  onDismiss,
}: CompileStatusBannerProps) {
  return (
    <div className="bg-red-50 border-b border-red-200 px-4 py-2.5 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-5 h-5 rounded-full bg-red-600 flex items-center justify-center">
          <AlertCircle className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-red-900">
            Compile failed. {errorCount} errors, {warningCount} warnings
          </span>
          <span className="text-xs font-mono text-red-700">in 1.4s</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onShowLogs}
          className="h-7 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium shadow-sm transition-colors"
        >
          Show Logs
        </button>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="h-7 w-7 rounded-lg hover:bg-red-100 text-red-700 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
