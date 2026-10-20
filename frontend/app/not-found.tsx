import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-gray-50">
      <div className="bg-white border border-gray-200 rounded-md p-8 max-w-md w-full shadow-sm">
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
              HTTP 404
            </span>
          </div>

          {/* Quill-and-Bracket 404 Graphic */}
          <div className="my-6 text-center">
            <div className="inline-block text-3xl font-mono font-bold text-gray-300 tracking-wider">
              [\ 404 /]
            </div>
            <h4 className="text-sm font-semibold text-gray-900 mt-2">Project not found</h4>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              This document may have been deleted, renamed, or never existed in this campus cluster.
            </p>
          </div>

          {/* Monospaced detail box */}
          <div className="bg-gray-50 border border-gray-200 rounded p-3 text-[10px] font-mono text-gray-500 space-y-1">
            <div>Status: Resource not found</div>
            <div>Request ID: {Math.random().toString(36).substring(7)}</div>
          </div>
        </div>

        {/* Action */}
        <div className="pt-4 mt-4 border-t border-gray-100 flex items-center justify-between">
          <Link
            href="/projects"
            className="h-8 px-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded transition-colors w-full text-center flex items-center justify-center"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
