"use client";

import Image from "next/image";
import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { Lock, ArrowLeft } from "lucide-react";
import { authAppearance, mathGridStyles } from "@/lib/auth/appearance";

/**
 * Invitation acceptance.
 *
 * This page is not linked from the sign-in screen: the workspace is invite-only,
 * so a member lands here from the link in their invitation email, and Clerk
 * carries the invitation in the query string and applies it on submit. Keeping the
 * route separate also means someone who guesses the URL still has no way to
 * register without a valid invitation.
 */
export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-math-grid flex flex-col justify-between p-6 sm:p-10 select-none">
      <header className="max-w-[1360px] w-full mx-auto flex items-center justify-between pb-6 border-b border-[#E5E7EB] mb-8">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <Image
              src="/logo.png"
              alt="Likhitex"
              width={140}
              height={40}
              priority
              className="h-8 w-auto"
            />
            <span className="text-xs px-2 py-0.5 rounded bg-[#EEF2FF] text-[#4F46E5] font-mono font-medium border border-[#E0E7FF]">
              v0.9.4-private
            </span>
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-on-surface transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Home</span>
          </Link>
          <div className="hidden md:flex items-center gap-4 text-xs font-mono text-[#6B7280]">
            <span className="text-[#D1D5DB]">|</span>
            <span>invitation required</span>
          </div>
        </div>
      </header>

      <main className="max-w-[1360px] w-full mx-auto my-auto py-4 flex justify-center">
        <SignUp
          appearance={authAppearance}
          fallbackRedirectUrl="/projects"
          signInUrl="/sign-in"
        />
      </main>

      <div className="max-w-[1360px] w-full mx-auto space-y-3">
        <p className="text-[11px] text-on-surface-variant font-normal flex items-center justify-center gap-1.5">
          <Lock className="w-3 h-3 text-outline flex-shrink-0" />
          <span>You can only reach this page from an invitation link</span>
        </p>
        <p className="text-xs text-on-surface-variant text-center">
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="text-primary hover:text-primary/80 font-medium underline underline-offset-2"
          >
            Sign in
          </Link>
        </p>
      </div>

      <div className="h-16"></div>

      <style jsx global>{mathGridStyles}</style>
    </div>
  );
}