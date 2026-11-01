"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignUp, useAuth } from "@clerk/nextjs";
import { authAppearance, authClasses } from "@/lib/auth/appearance";

/**
 * Invitation acceptance.
 *
 * The workspace is invite-only, so a member lands here from the link in their
 * invitation email; Clerk carries the invitation in the query string and applies
 * it on submit. Someone who guesses the URL still cannot register without a
 * valid invitation. The page frame comes from `(auth)/layout.tsx`.
 */
export default function SignUpPage() {
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded && isSignedIn) router.replace("/projects");
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded || isSignedIn) {
    return <div aria-busy="true" className={`${authClasses.card} ${authClasses.placeholder}`} />;
  }

  return (
    <div className="flex w-full flex-col items-center">
      <SignUp appearance={authAppearance} fallbackRedirectUrl="/projects" signInUrl="/sign-in" />
      <p className="mt-6 text-sm text-on-surface-variant">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-primary underline underline-offset-2 hover:text-primary/80">
          Sign in
        </Link>
      </p>
    </div>
  );
}
