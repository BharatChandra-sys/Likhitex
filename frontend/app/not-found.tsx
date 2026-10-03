"use client";

import Link from "next/link";
import { FileQuestion, Home, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        {/* Icon */}
        <div className="mb-6 flex justify-center">
          <div className="w-20 h-20 rounded-full bg-indigo-50 border-2 border-indigo-100 flex items-center justify-center">
            <FileQuestion className="w-10 h-10 text-indigo-600" strokeWidth={1.5} />
          </div>
        </div>

        {/* Error Code */}
        <div className="text-6xl font-bold text-neutral-900 mb-2">404</div>

        {/* Title */}
        <h1 className="text-xl font-semibold text-neutral-900 mb-2">
          Page not found
        </h1>

        {/* Description */}
        <p className="text-sm text-neutral-600 mb-8 leading-relaxed">
          The page you&apos;re looking for doesn&apos;t exist or has been moved. Check the
          URL or head back to the dashboard.
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/projects"
            className="h-10 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow-sm flex items-center gap-2 transition-colors w-full sm:w-auto justify-center"
          >
            <Home className="w-4 h-4" />
            <span>Go to Dashboard</span>
          </Link>
          <button
            onClick={() => window.history.back()}
            className="h-10 px-4 bg-white hover:bg-neutral-50 text-neutral-700 text-sm font-medium border border-neutral-300 rounded-lg shadow-sm flex items-center gap-2 transition-colors w-full sm:w-auto justify-center"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Go Back</span>
          </button>
        </div>

        {/* Footer Info */}
        <div className="mt-10 pt-6 border-t border-neutral-200 text-xs text-neutral-500 font-mono">
          <p>
            Need help?{" "}
            <Link href="/" className="text-indigo-600 hover:underline">
              Contact support
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
