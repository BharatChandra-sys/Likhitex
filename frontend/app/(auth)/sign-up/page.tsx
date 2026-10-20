"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignUp, useAuth } from "@clerk/nextjs";
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
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      router.replace("/projects");
    }
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-math-grid flex items-center justify-center p-6 select-none">
        <div className="text-sm text-on-surface-variant">Loading...</div>
        <style jsx global>{mathGridStyles}</style>
      </div>
    );
  }

  if (isSignedIn) {
    return null;
  }

  return (
    <div className="min-h-screen bg-math-grid flex items-center justify-center p-6 select-none">
      <main className="w-full flex justify-center">
        <div className="flex flex-col items-center">
          <SignUp
            appearance={authAppearance}
            fallbackRedirectUrl="/projects"
            signInUrl="/sign-in"
          />
          
          {/* Navigation Links */}
          <div className="mt-6 flex flex-col items-center gap-4">
            <p className="text-xs text-on-surface-variant">
              Already have an account?{" "}
              <Link
                href="/sign-in"
                className="text-primary hover:text-primary/80 font-medium underline underline-offset-2"
              >
                Sign in
              </Link>
            </p>
            
            <Link
              href="/"
              className="flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Home</span>
            </Link>
          </div>
        </div>
      </main>

      <style jsx global>{mathGridStyles}</style>
      <style jsx global>{`
        /* Hide Clerk branding */
        .cl-footer,
        .cl-footerPages,
        .cl-footerActionText,
        .cl-internal-b3fm6y {
          display: none !important;
        }
      `}</style>
    </div>
  );
}