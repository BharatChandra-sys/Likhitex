import { SignOutButton } from "@clerk/nextjs";
import { ShieldOff } from "lucide-react";

/** Where a signed-in account lands when the API refuses it. */
export default function NoAccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-gray-50">
      <div className="bg-white border border-gray-200 rounded-md p-8 max-w-md w-full shadow-sm text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-50 border-2 border-red-100 mb-3">
          <ShieldOff className="w-7 h-7 text-red-600" />
        </div>
        <h1 className="text-sm font-semibold text-gray-900 mt-2">
          This account hasn&apos;t been invited yet
        </h1>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
          Likhitex is invite-only. Ask the person who shared it with you to add your email,
          or sign in with the address they invited.
        </p>
        <div className="pt-4 mt-4 border-t border-gray-100">
          <SignOutButton redirectUrl="/sign-in">
            <button
              type="button"
              className="h-8 px-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded transition-colors w-full"
            >
              Sign in with another account
            </button>
          </SignOutButton>
        </div>
      </div>
    </div>
  );
}
