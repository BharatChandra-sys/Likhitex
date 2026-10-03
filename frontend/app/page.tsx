import Image from "next/image";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { CheckCircle, Lock, Users, Zap, Shield } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface">
      {/* Sticky Navigation */}
      <nav className="sticky top-0 z-50 bg-surface-container-lowest border-b border-[#E5E7EB] backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center">
            <Image
              src="/logo.png"
              alt="Likhitex"
              width={140}
              height={40}
              priority
              className="h-8 w-auto"
            />
          </div>

          <div className="hidden md:flex items-center gap-6 text-sm text-on-surface-variant">
            <a href="#features" className="hover:text-on-surface transition-colors">
              Features
            </a>
            <a href="#security" className="hover:text-on-surface transition-colors">
              Security
            </a>
          </div>

          <Link href="/sign-in" className={buttonVariants({ variant: "primary", size: "md" })}>
            Sign in
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 py-20 lg:py-28">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left: Text Content */}
          <div className="space-y-6">
            <h1 className="text-4xl lg:text-5xl font-bold tracking-tight text-on-surface leading-tight">
              Write LaTeX together,{" "}
              <span className="text-primary">without the limits</span>
            </h1>
            <p className="text-lg text-on-surface-variant leading-relaxed">
              A private collaborative LaTeX editor for your group. Real-time editing,
              instant PDF preview, and secure sandboxed compilation.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link href="/sign-in" className={buttonVariants({ variant: "primary", size: "lg", className: "w-full sm:w-auto" })}>
                Sign in
              </Link>
              <Button variant="outline" size="lg" className="w-full sm:w-auto">
                Request an invite
              </Button>
            </div>
            <p className="text-xs text-on-surface-variant flex items-center gap-2">
              <Lock className="w-3.5 h-3.5" />
              Invite-only • 200 trusted members • Private workspace
            </p>
          </div>

          {/* Right: Editor Mock */}
          <div className="bg-surface-container-lowest rounded-lg border border-[#E5E7EB] shadow-lg overflow-hidden">
            <div className="bg-surface-container-low px-4 py-2 border-b border-[#E5E7EB] flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-error"></div>
              <div className="w-3 h-3 rounded-full bg-tertiary"></div>
              <div className="w-3 h-3 rounded-full bg-secondary"></div>
              <span className="ml-2 text-xs font-mono text-on-surface-variant">
                thesis-draft.tex
              </span>
            </div>
            <div className="grid grid-cols-2">
              <div className="p-4 bg-surface-container-lowest font-mono text-xs space-y-1">
                <div className="text-on-surface-variant">
                  <span className="text-primary">\documentclass</span>
                  {"{article}"}
                </div>
                <div className="text-on-surface-variant">
                  <span className="text-primary">\begin</span>
                  {"{document}"}
                </div>
                <div className="text-on-surface ml-4">
                  <span className="text-primary">\section</span>
                  {"{Introduction}"}
                </div>
                <div className="text-on-surface ml-4">
                  This is collaborative...
                </div>
                <div className="text-on-surface-variant">
                  <span className="text-primary">\end</span>
                  {"{document}"}
                </div>
              </div>
              <div className="p-4 bg-[#f5f5f5] text-xs text-on-surface-variant">
                <div className="font-bold text-sm mb-2">PDF Preview</div>
                <div className="space-y-1">
                  <div className="h-2 bg-surface-container rounded w-3/4"></div>
                  <div className="h-2 bg-surface-container rounded w-full"></div>
                  <div className="h-2 bg-surface-container rounded w-5/6"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="bg-surface-container-lowest py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-on-surface mb-3">
              Built for academic collaboration
            </h2>
            <p className="text-on-surface-variant">
              Everything you need to write papers, theses, and research documents together
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-lg bg-primary-fixed flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-on-surface">Real-time collaboration</h3>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                See your co-authors&apos; cursors and edits in real time. No conflicts, no
                lost work.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-lg bg-secondary-container/20 flex items-center justify-center">
                <Zap className="w-5 h-5 text-secondary" />
              </div>
              <h3 className="font-semibold text-on-surface">Instant PDF preview</h3>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                Compile on save with fast feedback. See errors highlighted in your source
                code.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-lg bg-tertiary-fixed/40 flex items-center justify-center">
                <Shield className="w-5 h-5 text-tertiary" />
              </div>
              <h3 className="font-semibold text-on-surface">Private and secure</h3>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                Invite-only access. Your documents never leave our secure sandbox.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section id="security" className="py-20">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-on-surface mb-3">Built for safety</h2>
            <p className="text-on-surface-variant">
              Security and privacy are fundamental to how we built Likhitex
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            <div className="flex gap-3">
              <CheckCircle className="w-5 h-5 text-secondary flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-on-surface mb-1">
                  Sandboxed compilation
                </h4>
                <p className="text-sm text-on-surface-variant">
                  LaTeX runs in isolated containers with no network access
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <CheckCircle className="w-5 h-5 text-secondary flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-on-surface mb-1">Invite-only access</h4>
                <p className="text-sm text-on-surface-variant">
                  Only approved members can join your workspace
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <CheckCircle className="w-5 h-5 text-secondary flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-on-surface mb-1">Private storage</h4>
                <p className="text-sm text-on-surface-variant">
                  Your files are encrypted and stored securely
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <CheckCircle className="w-5 h-5 text-secondary flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-on-surface mb-1">Regular backups</h4>
                <p className="text-sm text-on-surface-variant">
                  Automated daily backups with tested restore procedures
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#E5E7EB] bg-surface-container-lowest">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <Image
                src="/logo.png"
                alt="Likhitex"
                width={120}
                height={40}
                className="h-6 w-auto"
              />
              <span className="text-sm text-on-surface-variant">
                © 2026 Private workspace.
              </span>
            </div>
            <div className="flex items-center gap-6 text-sm text-on-surface-variant">
              <a href="#" className="hover:text-on-surface transition-colors">
                Privacy
              </a>
              <a href="#" className="hover:text-on-surface transition-colors">
                Contact
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
