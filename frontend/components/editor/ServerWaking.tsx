"use client";

import { Server } from "lucide-react";

interface ServerWakingProps {
  message?: string;
}

export function ServerWaking({ message }: ServerWakingProps) {
  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-[radial-gradient(circle,_#E5E7EB_1px,_transparent_1px)] bg-[length:24px_24px]">
      {/* Centered Card Container */}
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-md p-6 shadow-sm">
        <div className="flex items-start gap-4">
          {/* Cluster Hardware / Cloud Icon */}
          <div className="w-10 h-10 rounded bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 flex-shrink-0">
            <Server className="w-5 h-5" />
          </div>

          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Waking up the server...</h3>
              <span className="text-[11px] font-mono text-indigo-600 font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-ping"></span>
                Booting node
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1 mb-4 leading-relaxed">
              {message || "This can take up to a minute after a quiet period while we allocate compute containers and mount your project storage."}
            </p>

            {/* Indeterminate Progress Bar */}
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden relative mb-3">
              <div className="h-full bg-indigo-600 rounded-full w-1/3 animate-[indeterminate_1.6s_infinite_cubic-bezier(0.65,0.815,0.735,0.395)]"></div>
            </div>

            {/* Step Telemetry Indicators */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100 text-[11px] font-mono text-gray-400">
              <div className="flex items-center gap-1 text-emerald-600">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span>Storage OK</span>
              </div>
              <div className="flex items-center gap-1 text-indigo-600 font-medium">
                <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
                <span>TeX Live</span>
              </div>
              <div className="flex items-center gap-1 text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300"></span>
                <span>Ready</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer micro-note */}
        <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400 font-mono">
          <span>Connecting to cluster...</span>
          <a href="/health" className="hover:text-gray-700 underline">View cluster health</a>
        </div>
      </div>

      {/* Add indeterminate animation to globals.css if not already present */}
      <style jsx>{`
        @keyframes indeterminate {
          0% {
            transform: translateX(-100%);
          }
          50% {
            transform: translateX(30%);
          }
          100% {
            transform: translateX(200%);
          }
        }
      `}</style>
    </div>
  );
}
