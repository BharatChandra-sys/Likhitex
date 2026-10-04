"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, useSignIn } from "@clerk/nextjs";
import { Lock, AlertCircle, ArrowRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mathGridStyles } from "@/lib/auth/appearance";

/**
 * Sign-in, rendered in the product's own design.
 *
 * Clerk's `<SignIn />` component cannot be used here: v7 exposes no localization
 * key for an input placeholder and no way to replace its internal layout, so the
 * card could never match the Stitch screen (its field would read "Enter your
 * email address", not "user@university.edu").
 *
 * Clerk still owns the protocol. `useSignIn()` performs the real work and this
 * component only chooses which step to show, so OAuth, email codes and
 * multi-factor all run on Clerk's implementation rather than a reimplementation.
 *
 * Two v7 conventions shape the code below:
 * - the hook returns `{ errors, fetchStatus, signIn }` -- there is no `isLoaded`
 *   or `setActive` on it (`isLoaded` comes from `useAuth`, and `signIn.finalize()`
 *   is what activates the session);
 * - the `SignInFuture` methods *return* `{ error }` instead of throwing, so every
 *   call site has to inspect the result.
 */

type Step =
  | { kind: "identifier" }
  | { kind: "password" }
  | { kind: "email_code" }
  | { kind: "email_link_sent" }
  | { kind: "second_factor" };

const DEFAULT_REDIRECT = "/projects";

/** Reads the `redirect_url` that `proxy.ts` adds when bouncing a signed-out user. */
function useRedirectTarget(): string {
  const searchParams = useSearchParams();
  const target = searchParams.get("redirect_url");
  // Only same-origin paths are honoured, so this query parameter cannot be used
  // to bounce someone off-site after they authenticate.
  if (!target || !target.startsWith("/") || target.startsWith("//")) {
    return DEFAULT_REDIRECT;
  }
  return target;
}

function GoogleIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.86c2.26-2.09 3.56-5.17 3.56-8.87z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.28v3.09A11.99 11.99 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.28a11.99 11.99 0 0 0 0 10.76l3.99-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A11.99 11.99 0 0 0 1.28 6.62l3.99 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

/** Flattens whatever a failed Clerk call produced into one readable sentence. */
function toMessage(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Something went wrong. Try again.";
}

/** Maps Clerk error codes onto plainer wording where the raw message is unhelpful. */
function humanise(code: unknown, fallback: string | null): string | null {
  switch (code) {
    case "form_identifier_not_found":
      return "No account matches that email address.";
    case "form_param_identifier_missing":
      return "Enter your email address.";
    case "session_user_locked":
      return "This account is locked. Contact the admin.";
    case "form_code_incorrect":
    case "form_code_length_invalid":
      return "That code is not correct. Check it and try again.";
    case "form_password_incorrect":
      return "That password is not correct.";
    default:
      return fallback;
  }
}

function SignInForm() {
  const { signIn } = useSignIn();
  const { isLoaded } = useAuth();
  const router = useRouter();
  const redirectTarget = useRedirectTarget();

  const [step, setStep] = useState<Step>({ kind: "identifier" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isBusy = isSubmitting || !isLoaded || !signIn;
  const identifier = email.trim();

  /** Activates the freshly created session and returns to the requested page. */
  const completeSignIn = async () => {
    const { error: finalizeError } = await signIn.finalize();
    const message = toMessage(finalizeError);
    if (message) {
      setError(message);
      return;
    }
    // A refresh is required so server components re-read the new session cookie.
    router.replace(redirectTarget);
    router.refresh();
  };

  /**
   * Routes to the next step based on what Clerk says the flow now needs.
   *
   * Clerk decides which strategy applies -- it depends on how the instance is
   * configured and on the account -- so this only picks which screen to show.
   */
  const advance = async () => {
    if (signIn.status === "complete") {
      await completeSignIn();
      return;
    }

    if (signIn.status === "needs_first_factor") {
      const strategy = signIn.supportedFirstFactors[0]?.strategy;

      if (strategy === "password") {
        setStep({ kind: "password" });
        return;
      }
      if (strategy === "email_code") {
        const { error: sendError } = await signIn.emailCode.sendCode({ emailAddress: identifier });
        const message = humanise(
          (sendError as { code?: string } | null)?.code,
          toMessage(sendError),
        );
        if (message) {
          setError(message);
          return;
        }
        setStep({ kind: "email_code" });
        return;
      }
      if (strategy === "email_link") {
        const { error: sendError } = await signIn.emailLink.sendLink({
          emailAddress: identifier,
          verificationUrl: `${window.location.origin}/sign-in`,
        });
        const message = humanise(
          (sendError as { code?: string } | null)?.code,
          toMessage(sendError),
        );
        if (message) {
          setError(message);
          return;
        }
        setStep({ kind: "email_link_sent" });
        return;
      }

      setError("This workspace requires a sign-in method that is not available here.");
      return;
    }

    if (
      signIn.status === "needs_second_factor" ||
      signIn.status === "needs_client_trust"
    ) {
      setStep({ kind: "second_factor" });
      return;
    }

    if (signIn.status === "needs_new_password") {
      setError("This account needs a password reset, which this screen does not handle yet.");
      return;
    }

    if (signIn.status === "needs_protect_check") {
      setError("Clerk's bot challenge is required here but is not enabled in this build.");
      return;
    }

    // Still waiting on an identifier: leave the user on the email field.
    setStep({ kind: "identifier" });
  };

  const submitIdentifier = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!identifier) return;

    setError(null);
    setIsSubmitting(true);
    try {
      const { error: createError } = await signIn.create({ identifier });
      const message = humanise(
        (createError as { code?: string } | null)?.code,
        toMessage(createError),
      );
      if (message) {
        setError(message);
        return;
      }
      await advance();
    } catch (cause) {
      setError(toMessage(cause) ?? "Something went wrong. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const { error: passwordError } = await signIn.password({ identifier, password });
      const message = humanise(
        (passwordError as { code?: string } | null)?.code,
        toMessage(passwordError),
      );
      if (message) {
        setError(message);
        return;
      }
      await advance();
    } catch (cause) {
      setError(toMessage(cause) ?? "Something went wrong. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitEmailCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const { error: verifyError } = await signIn.emailCode.verifyCode({ code });
      const message = humanise(
        (verifyError as { code?: string } | null)?.code,
        toMessage(verifyError),
      );
      if (message) {
        setError(message);
        return;
      }
      await advance();
    } catch (cause) {
      setError(toMessage(cause) ?? "Something went wrong. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitSecondFactor = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      // The second factor is chosen by the account's enrolment, so the strategy
      // is read back rather than assumed.
      const strategy = signIn.supportedSecondFactors[0]?.strategy;

      let result: { error: unknown };
      if (strategy === "backup_code") {
        result = await signIn.mfa.verifyBackupCode({ code });
      } else if (strategy === "email_code") {
        result = await signIn.mfa.verifyEmailCode({ code });
      } else {
        result = await signIn.mfa.verifyTOTP({ code });
      }

      const message = humanise(
        (result.error as { code?: string } | null)?.code,
        toMessage(result.error),
      );
      if (message) {
        setError(message);
        return;
      }
      await advance();
    } catch (cause) {
      setError(toMessage(cause) ?? "Something went wrong. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const continueWithGoogle = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const { error: ssoError } = await signIn.sso({
        strategy: "oauth_google",
        // Clerk parses the provider's callback on this page.
        redirectUrl: `${window.location.origin}/sign-in`,
        redirectCallbackUrl: redirectTarget,
      });
      const message = toMessage(ssoError);
      if (message) setError(message);
    } catch (cause) {
      setError(toMessage(cause) ?? "Could not start Google sign-in.");
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Starts the email-link flow over, for a user who did not find the email. */
  const resendEmailLink = async () => {
    setIsSubmitting(true);
    try {
      const { error: sendError } = await signIn.emailLink.sendLink({
        emailAddress: identifier,
        verificationUrl: `${window.location.origin}/sign-in`,
      });
      const message = toMessage(sendError);
      setError(message ?? "Sent again. Check your inbox.");
    } catch (cause) {
      setError(toMessage(cause) ?? "Could not send another link.");
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Returns to the start of the flow so a different account can be used. */
  const startOver = async () => {
    setPassword("");
    setCode("");
    setError(null);
    setStep({ kind: "identifier" });
    // `reset` clears Clerk's attempt so the next `create` starts clean; a failure
    // here is not actionable for the user, so it is deliberately swallowed.
    await signIn.reset().catch(() => undefined);
  };

  return (
    <div className="min-h-screen bg-math-grid flex flex-col justify-between p-6 sm:p-10 select-none">
      {/* Top Header */}
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
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#10B981]"></span>
              <span>auth-cluster: ready</span>
            </span>
          </div>
        </div>
      </header>

      {/* Card */}
      <main className="max-w-[1360px] w-full mx-auto my-auto py-4 flex justify-center">
        <div className="w-full flex flex-col items-center">
          <div className="w-[420px] max-w-full bg-white rounded-md border border-[#E5E7EB] p-8 shadow-sm">
            <div className="flex flex-col items-center text-center">
              <div className="mb-6">
                <Image
                  src="/logo.png"
                  alt="Likhitex"
                  width={180}
                  height={50}
                  priority
                  className="h-10 w-auto"
                />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-on-surface">
                Sign in to Likhitex
              </h2>
              <p className="text-xs text-on-surface-variant mt-1 font-normal">
                Invite-only workspace for LaTeX projects
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-5 flex items-start gap-1.5 rounded-lg bg-error/10 border border-error/30 px-3 py-2 text-xs text-error"
              >
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-6 space-y-4">
              {step.kind === "identifier" && (
                <>
                  <Button
                    variant="default"
                    className="w-full"
                    onClick={() => void continueWithGoogle()}
                    disabled={isBusy}
                  >
                    <GoogleIcon />
                    <span>Continue with Google</span>
                  </Button>

                  <div className="relative flex items-center justify-center my-3">
                    <div className="border-t border-[#E5E7EB] w-full"></div>
                    <span className="bg-white px-2.5 text-[11px] font-mono text-outline uppercase absolute">
                      or
                    </span>
                  </div>

                  <form onSubmit={submitIdentifier} className="space-y-3">
                    <div>
                      <label
                        htmlFor="signin-email"
                        className="block text-xs font-medium text-[#374151] mb-1.5"
                      >
                        Academic or institutional email
                      </label>
                      <Input
                        type="email"
                        id="signin-email"
                        name="identifier"
                        autoComplete="email"
                        placeholder="user@university.edu"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        disabled={isBusy}
                        required
                      />
                    </div>

                    <Button type="submit" variant="primary" className="w-full" disabled={isBusy}>
                      <span>{isSubmitting ? "Continuing..." : "Continue"}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-outline" />
                    </Button>
                  </form>
                </>
              )}

              {step.kind === "password" && (
                <form onSubmit={submitPassword} className="space-y-3">
                  <p className="text-xs text-on-surface-variant">
                    Enter the password for{" "}
                    <span className="font-[family-name:var(--font-mono)] text-on-surface">
                      {identifier}
                    </span>
                  </p>
                  <div>
                    <label
                      htmlFor="signin-password"
                      className="block text-xs font-medium text-[#374151] mb-1.5"
                    >
                      Password
                    </label>
                    <Input
                      type="password"
                      id="signin-password"
                      autoComplete="current-password"
                      placeholder="Your password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={isBusy}
                      required
                      autoFocus
                    />
                  </div>
                  <Button type="submit" variant="primary" className="w-full" disabled={isBusy}>
                    {isSubmitting ? "Signing in..." : "Sign in"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => void startOver()}
                    className="w-full text-[11px] text-on-surface-variant hover:text-on-surface hover:underline underline-offset-2"
                  >
                    Use a different email
                  </button>
                </form>
              )}

              {step.kind === "email_code" && (
                <form onSubmit={submitEmailCode} className="space-y-3">
                  <p className="text-xs text-on-surface-variant">
                    We sent a code to{" "}
                    <span className="font-[family-name:var(--font-mono)] text-on-surface">
                      {identifier}
                    </span>
                  </p>
                  <div>
                    <label
                      htmlFor="signin-code"
                      className="block text-xs font-medium text-[#374151] mb-1.5"
                    >
                      Verification code
                    </label>
                    <Input
                      type="text"
                      id="signin-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      disabled={isBusy}
                      required
                      autoFocus
                    />
                  </div>
                  <Button type="submit" variant="primary" className="w-full" disabled={isBusy}>
                    {isSubmitting ? "Verifying..." : "Verify"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => void startOver()}
                    className="w-full text-[11px] text-on-surface-variant hover:text-on-surface hover:underline underline-offset-2"
                  >
                    Use a different email
                  </button>
                </form>
              )}

              {step.kind === "email_link_sent" && (
                <div className="space-y-3 text-center">
                  <p className="text-xs text-on-surface-variant">
                    A sign-in link was sent to{" "}
                    <span className="font-[family-name:var(--font-mono)] text-on-surface">
                      {identifier}
                    </span>
                    . Open it on this device to finish signing in.
                  </p>
                  <Button
                    variant="default"
                    className="w-full"
                    onClick={() => void resendEmailLink()}
                    disabled={isBusy}
                  >
                    {isSubmitting ? "Sending..." : "Send again"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => void startOver()}
                    className="w-full text-[11px] text-on-surface-variant hover:text-on-surface hover:underline underline-offset-2"
                  >
                    Use a different email
                  </button>
                </div>
              )}

              {step.kind === "second_factor" && (
                <form onSubmit={submitSecondFactor} className="space-y-3">
                  <p className="text-xs text-on-surface-variant">
                    {signIn?.supportedSecondFactors?.[0]?.strategy === "backup_code"
                      ? "Enter one of your backup codes"
                      : "Enter the code from your authenticator app"}{" "}
                    for{" "}
                    <span className="font-[family-name:var(--font-mono)] text-on-surface">
                      {identifier}
                    </span>
                  </p>
                  <div>
                    <label
                      htmlFor="signin-2fa"
                      className="block text-xs font-medium text-[#374151] mb-1.5"
                    >
                      Authentication code
                    </label>
                    <Input
                      type="text"
                      id="signin-2fa"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      disabled={isBusy}
                      required
                      autoFocus
                    />
                  </div>
                  <Button type="submit" variant="primary" className="w-full" disabled={isBusy}>
                    {isSubmitting ? "Verifying..." : "Verify"}
                  </Button>
                </form>
              )}
            </div>

            {/* Card Footer */}
            <div className="mt-6 pt-4 border-t border-[#F3F4F6] text-center space-y-3">
              <p className="text-[11px] text-on-surface-variant font-normal flex items-center justify-center gap-1.5">
                <Lock className="w-3 h-3 text-outline flex-shrink-0" />
                <span>Access is limited to invited members</span>
              </p>
              <p className="text-xs text-on-surface-variant">
                Have an invitation?{" "}
                <Link
                  href="/sign-up"
                  className="text-primary hover:text-primary/80 font-medium underline underline-offset-2"
                >
                  Create account
                </Link>
              </p>
            </div>
          </div>

          {/* Links Below Card */}
          <div className="mt-4 flex items-center justify-center gap-4 text-xs text-on-surface-variant">
            <a
              href="#privacy"
              className="hover:text-on-surface hover:underline underline-offset-2 transition-colors"
            >
              Privacy
            </a>
            <span className="text-[#D1D5DB]">•</span>
            <a
              href="#contact"
              className="hover:text-on-surface hover:underline underline-offset-2 transition-colors"
            >
              Contact the admin
            </a>
          </div>
        </div>
      </main>

      <div className="h-16"></div>

      <style jsx global>{mathGridStyles}</style>
    </div>
  );
}

export default function SignInPage() {
  // `useSearchParams` suspends during prerender, so the form needs a boundary.
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}