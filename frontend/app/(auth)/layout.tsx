import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";

import styles from "@/components/landing/landing.module.css";

/**
 * Shared shell for /sign-in and /sign-up, in the landing page's visual language:
 * the same wordmark, indigo wash and serif card titles. Server-rendered, so the
 * frame paints before clerk-js loads and only the card itself waits on Clerk.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${styles.authBackdrop} flex min-h-screen flex-col text-on-surface`}>
      <header className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="Likhitex home" className="-ml-2 shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          <Image src="/logo.png" alt="Likhitex" width={168} height={56} priority className="h-11 w-auto" />
        </Link>
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-md text-sm text-on-surface-variant transition-colors hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to home
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-12">
        {children}
      </main>

      <footer className="flex items-center justify-center gap-1.5 px-4 pb-8 text-center text-xs text-on-surface-variant">
        <Lock className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        Private, invite-only workspace. Access is limited to invited members.
      </footer>
    </div>
  );
}
