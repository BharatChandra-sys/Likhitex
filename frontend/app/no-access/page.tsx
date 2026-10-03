import Link from "next/link";
import { ShieldAlert, Home, Mail } from "lucide-react";

export default function NoAccessPage() {
  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        {/* Icon */}
        <div className="mb-6 flex justify-center">
          <div className="w-20 h-20 rounded-full bg-red-50 border-2 border-red-100 flex items-center justify-center">
            <ShieldAlert
              className="w-10 h-10 text-red-600"
              strokeWidth={1.5}
            />
          </div>
        </div>

        {/* Error Code */}
        <div className="text-6xl font-bold text-neutral-900 mb-2">403</div>

        {/* Title */}
        <h1 className="text-xl font-semibold text-neutral-900 mb-2">
          No access to this project
        </h1>

        {/* Description */}
        <p className="text-sm text-neutral-600 mb-4 leading-relaxed">
          You don&apos;t have permission to view this project. It may be private or
          you&apos;ve been removed as a collaborator.
        </p>

        {/* Info Box */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-8 text-left">
          <div className="flex items-start gap-3">
            <Mail className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900">
              <div className="font-medium mb-1">Need access?</div>
              <div className="text-amber-800">
                Ask the project owner to share it with you. Only invited
                Likhitex members can access private projects.
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/projects"
            className="h-10 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow-sm flex items-center gap-2 transition-colors w-full sm:w-auto justify-center"
          >
            <Home className="w-4 h-4" />
            <span>Go to Dashboard</span>
          </Link>
          <Link
            href="/"
            className="h-10 px-4 bg-white hover:bg-neutral-50 text-neutral-700 text-sm font-medium border border-neutral-300 rounded-lg shadow-sm flex items-center gap-2 transition-colors w-full sm:w-auto justify-center"
          >
            <span>Learn More</span>
          </Link>
        </div>

        {/* Footer Info */}
        <div className="mt-10 pt-6 border-t border-neutral-200 text-xs text-neutral-500 font-mono">
          <p>
            Believe this is an error?{" "}
            <Link href="/" className="text-indigo-600 hover:underline">
              Contact support
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
