"use client";

export function EditorLoadingSkeleton() {
  return (
    <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
      {/* Mock Top Bar */}
      <div className="h-10 bg-white border-b border-gray-200 px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded bg-gray-200 animate-pulse"></div>
          <div className="h-3.5 w-24 bg-gray-200 rounded animate-pulse"></div>
          <div className="h-3.5 w-16 bg-gray-100 rounded animate-pulse"></div>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-6 w-16 bg-gray-200 rounded animate-pulse"></div>
          <div className="h-6 w-20 bg-indigo-200 rounded animate-pulse"></div>
        </div>
      </div>

      {/* 3-Pane Skeleton Body */}
      <div className="flex-1 grid grid-cols-12 min-h-[340px]">
        {/* Left Pane: File Tree Skeleton (3 cols) */}
        <div className="col-span-3 bg-white border-r border-gray-200 p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="h-3 w-16 bg-gray-200 rounded animate-pulse"></div>
              <div className="flex gap-1">
                <div className="w-3.5 h-3.5 bg-gray-100 rounded"></div>
                <div className="w-3.5 h-3.5 bg-gray-100 rounded"></div>
              </div>
            </div>
            {/* Shimmer items */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 bg-gray-200 rounded"></div>
                <div className="h-3 w-28 bg-gray-200 rounded animate-pulse"></div>
              </div>
              <div className="flex items-center gap-2 pl-3">
                <div className="w-3 h-3 bg-gray-100 rounded"></div>
                <div className="h-2.5 w-20 bg-gray-200 rounded animate-pulse"></div>
              </div>
              <div className="flex items-center gap-2 pl-3">
                <div className="w-3 h-3 bg-gray-100 rounded"></div>
                <div className="h-2.5 w-24 bg-gray-200 rounded animate-pulse"></div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 bg-gray-200 rounded"></div>
                <div className="h-3 w-32 bg-gray-200 rounded animate-pulse"></div>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 bg-gray-200 rounded"></div>
                <div className="h-3 w-16 bg-gray-200 rounded animate-pulse"></div>
              </div>
            </div>
          </div>

          {/* Bottom sync state shimmer */}
          <div className="pt-3 border-t border-gray-100 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gray-200 animate-ping"></div>
            <div className="h-2.5 w-20 bg-gray-200 rounded"></div>
          </div>
        </div>

        {/* Middle Pane: Code Editor Shimmer (5 cols) */}
        <div className="col-span-5 bg-white border-r border-gray-200 p-4">
          {/* Code Tab bar shimmer */}
          <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-100">
            <div className="h-4 w-20 bg-indigo-100 rounded"></div>
            <div className="h-4 w-24 bg-gray-100 rounded"></div>
          </div>

          {/* Code lines with line number gutters */}
          <div className="space-y-2 font-mono">
            {[
              { line: 1, width: "w-36" },
              { line: 2, width: "w-48" },
              { line: 3, width: "w-28" },
              { line: 4, width: "w-64" },
              { line: 5, width: "w-52" },
              { line: 6, width: "w-32" },
              { line: 7, width: "w-44" },
              { line: 8, width: "w-60" },
            ].map(({ line, width }) => (
              <div key={line} className="flex items-center gap-3">
                <span className="text-[10px] text-gray-300 w-4 text-right">{line}</span>
                <div className={`h-3 ${width} bg-gray-200 rounded animate-pulse`}></div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Pane: PDF Page Preview Skeleton (4 cols) */}
        <div className="col-span-4 bg-[#F0F2F5] p-5 flex flex-col items-center justify-start">
          <div className="w-full bg-white rounded border border-gray-200 shadow-sm p-4 h-[290px] flex flex-col justify-between">
            {/* PDF Sheet title shimmer */}
            <div className="space-y-3">
              <div className="flex justify-center">
                <div className="h-3.5 w-3/4 bg-gray-200 rounded animate-pulse"></div>
              </div>
              <div className="flex justify-center">
                <div className="h-2 w-1/2 bg-gray-100 rounded"></div>
              </div>
              {/* Abstract lines */}
              <div className="pt-2 space-y-1.5">
                <div className="h-1.5 w-full bg-gray-200 rounded"></div>
                <div className="h-1.5 w-full bg-gray-200 rounded"></div>
                <div className="h-1.5 w-5/6 bg-gray-200 rounded"></div>
              </div>
              {/* Column blocks */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-gray-200 rounded"></div>
                  <div className="h-1.5 w-full bg-gray-200 rounded"></div>
                  <div className="h-1.5 w-3/4 bg-gray-200 rounded"></div>
                </div>
                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-gray-200 rounded"></div>
                  <div className="h-1.5 w-4/5 bg-gray-200 rounded"></div>
                  <div className="h-1.5 w-full bg-gray-200 rounded"></div>
                </div>
              </div>
            </div>
            <div className="flex justify-between items-center text-[9px] font-mono text-gray-300 pt-2 border-t border-gray-100">
              <span>Page 1 of 1</span>
              <span>100% zoom</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Statusbar Shimmer */}
      <div className="h-6 bg-white border-t border-gray-200 px-3 flex items-center justify-between text-[10px] text-gray-400 font-mono">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-gray-300"></div>
          <div className="h-2 w-16 bg-gray-200 rounded"></div>
        </div>
        <div className="h-2 w-24 bg-gray-200 rounded"></div>
      </div>
    </div>
  );
}
