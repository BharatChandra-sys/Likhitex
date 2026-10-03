export default function EditorLoadingSkeleton() {
  return (
    <div className="flex flex-col h-screen bg-neutral-50">
      {/* Mock Top Bar */}
      <div className="h-10 bg-white border-b border-neutral-200 px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded bg-neutral-200 animate-pulse" />
          <div className="h-3.5 w-24 bg-neutral-200 rounded animate-pulse" />
          <div className="h-3.5 w-16 bg-neutral-100 rounded animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-6 w-16 bg-neutral-200 rounded animate-pulse" />
          <div className="h-6 w-20 bg-indigo-200 rounded animate-pulse" />
        </div>
      </div>

      {/* 3-Pane Skeleton Body */}
      <div className="flex-1 grid grid-cols-12">
        {/* Left Pane: File Tree Skeleton */}
        <div className="col-span-3 bg-white border-r border-neutral-200 p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="h-3 w-16 bg-neutral-200 rounded animate-pulse" />
              <div className="flex gap-1">
                <div className="w-3.5 h-3.5 bg-neutral-100 rounded" />
                <div className="w-3.5 h-3.5 bg-neutral-100 rounded" />
              </div>
            </div>
            {/* Shimmer items */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 bg-neutral-200 rounded" />
                <div className="h-3 w-28 bg-neutral-200 rounded animate-pulse" />
              </div>
              <div className="flex items-center gap-2 pl-3">
                <div className="w-3 h-3 bg-neutral-100 rounded" />
                <div className="h-2.5 w-20 bg-neutral-200 rounded animate-pulse" />
              </div>
              <div className="flex items-center gap-2 pl-3">
                <div className="w-3 h-3 bg-neutral-100 rounded" />
                <div className="h-2.5 w-24 bg-neutral-200 rounded animate-pulse" />
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 bg-neutral-200 rounded" />
                <div className="h-3 w-32 bg-neutral-200 rounded animate-pulse" />
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 bg-neutral-200 rounded" />
                <div className="h-3 w-16 bg-neutral-200 rounded animate-pulse" />
              </div>
            </div>
          </div>

          {/* Bottom sync state shimmer */}
          <div className="pt-3 border-t border-neutral-100 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-neutral-200 animate-ping" />
            <div className="h-2.5 w-20 bg-neutral-200 rounded" />
          </div>
        </div>

        {/* Middle Pane: Code Editor Shimmer */}
        <div className="col-span-5 bg-white border-r border-neutral-200 p-4">
          {/* Code Tab bar shimmer */}
          <div className="flex items-center gap-2 mb-4 pb-2 border-b border-neutral-100">
            <div className="h-4 w-20 bg-indigo-100 rounded" />
            <div className="h-4 w-24 bg-neutral-100 rounded" />
          </div>

          {/* Code lines with line number gutters */}
          <div className="space-y-2 font-mono">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => (
              <div key={num} className="flex items-center gap-3">
                <span className="text-[10px] text-neutral-300 w-4 text-right">
                  {num}
                </span>
                <div
                  className={`h-3 bg-neutral-200 rounded animate-pulse ${
                    num % 3 === 0 ? "w-28" : num % 2 === 0 ? "w-48" : "w-36"
                  }`}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Right Pane: PDF Page Preview Skeleton */}
        <div className="col-span-4 bg-[#F0F2F5] p-5 flex flex-col items-center justify-start">
          <div className="w-full bg-white rounded border border-neutral-200 shadow-sm p-4 h-[290px] flex flex-col justify-between">
            {/* PDF Sheet title shimmer */}
            <div className="space-y-3">
              <div className="flex justify-center">
                <div className="h-3.5 w-3/4 bg-neutral-200 rounded animate-pulse" />
              </div>
              <div className="flex justify-center">
                <div className="h-2 w-1/2 bg-neutral-100 rounded" />
              </div>
              {/* Abstract lines */}
              <div className="pt-2 space-y-1.5">
                <div className="h-1.5 w-full bg-neutral-200 rounded" />
                <div className="h-1.5 w-full bg-neutral-200 rounded" />
                <div className="h-1.5 w-5/6 bg-neutral-200 rounded" />
              </div>
              {/* Column blocks */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-neutral-200 rounded" />
                  <div className="h-1.5 w-full bg-neutral-200 rounded" />
                  <div className="h-1.5 w-3/4 bg-neutral-200 rounded" />
                </div>
                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-neutral-200 rounded" />
                  <div className="h-1.5 w-4/5 bg-neutral-200 rounded" />
                  <div className="h-1.5 w-full bg-neutral-200 rounded" />
                </div>
              </div>
            </div>
            <div className="flex justify-between items-center text-[9px] font-mono text-neutral-300 pt-2 border-t border-neutral-100">
              <span>Page 1 of 1</span>
              <span>100% zoom</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Statusbar Shimmer */}
      <div className="h-6 bg-white border-t border-neutral-200 px-3 flex items-center justify-between text-[10px] text-neutral-400 font-mono">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-neutral-300" />
          <div className="h-2 w-16 bg-neutral-200 rounded" />
        </div>
        <div className="h-2 w-24 bg-neutral-200 rounded" />
      </div>
    </div>
  );
}
