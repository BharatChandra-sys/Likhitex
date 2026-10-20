import Link from "next/link";
import { ShieldOff } from "lucide-react";

export default function NoAccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-gray-50">
      <div className="bg-white border border-gray-200 rounded-md p-8 max-w-md w-full shadow-sm">
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
              HTTP 403
            </span>
          </div>

          {/* Lock/Shield Icon and Message */}
          <div className="my-6 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-50 border-2 border-red-100 mb-3">
              <ShieldOff className="w-7 h-7 text-red-600" />
            </div>
            <h4 className="text-sm font-semibold text-gray-900 mt-2">
              No access to this project
            </h4>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              This LaTeX document is private, or you&apos;re not listed as a collaborator. Only invited institutional members may view shared work.
            </p>
          </div>

          {/* Monospaced detail box */}
          <div className="bg-gray-50 border border-gray-200 rounded p-3 text-[10px] font-mono text-gray-500 space-y-1">
            <div>Status: Forbidden (Access Denied)</div>
            <div>Your role: Not a member</div>
          </div>
        </div>

        {/* Actions: Request Access or Switch Account */}
        <div className="pt-4 mt-4 border-t border-gray-100 flex flex-col gap-2">
          <button className="h-8 px-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded transition-colors w-full text-center">
            Request access from owner
          </button>
          <div className="flex items-center justify-between text-[11px] px-1">
            <Link href="/auth/sign-in" className="text-gray-500 hover:text-gray-800 underline">
              Switch account
            </Link>
            <Link href="/projects" className="text-gray-500 hover:text-gray-800 underline">
              Back to projects
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
