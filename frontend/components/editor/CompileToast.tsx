import { Loader2, Clock } from "lucide-react";

type CompileStatus = "compiling" | "queued";

interface CompileToastProps {
  status: CompileStatus;
  queuePosition?: number;
}

export default function CompileToast({
  status,
  queuePosition,
}: CompileToastProps) {
  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div className="bg-white border border-neutral-200 rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 min-w-[240px]">
        {status === "compiling" ? (
          <>
            <Loader2 className="w-5 h-5 text-indigo-600 animate-spin flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-neutral-900">
                Compiling...
              </div>
              <div className="text-xs text-neutral-500 font-mono">
                Processing LaTeX document
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-neutral-900">
                Queued: position {queuePosition}
              </div>
              <div className="text-xs text-neutral-500">
                Waiting for compiler slot
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
