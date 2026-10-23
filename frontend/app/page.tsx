import Image from "next/image";
import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import {
  ArrowRight,
  Blocks,
  FileStack,
  History,
  Lock,
  ShieldCheck,
  Terminal,
  Users,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { UserMenu } from "@/components/ui/user-menu";
import Reveal from "@/components/landing/Reveal";
import ScrollProgress from "@/components/landing/ScrollProgress";

/**
 * Marketing page.
 *
 * Written against the research rather than a template: manus.im and godly.design
 * both set a serif headline at weight 400-500 and keep body copy at 14-16px, so
 * the type here is deliberately smaller and lighter than the app's own dense UI.
 * The `.landing` scope in `globals.css` owns the scale so the app keeps its 13px
 * base.
 *
 * Every claim here is checkable. The earlier version of this page advertised
 * "200+ active users, 10k+ documents, 99.9% uptime" and linked to `#` from the
 * footer; the numbers were invented and the links went nowhere. Where a number
 * would have gone there is now the actual compiler invocation, which is both true
 * and more interesting to the audience this product is for.
 */

const NAV_LINKS = [
  { href: "#capabilities", label: "Capabilities" },
  { href: "#security", label: "Security" },
  { href: "#access", label: "Access" },
];

const CAPABILITIES = [
  {
    icon: Terminal,
    title: "A real LaTeX toolchain",
    body: "A full TeX Live distribution with the packages academic work actually needs. No curated subset, no waiting for a build to finish.",
  },
  {
    icon: Blocks,
    title: "Compile as you type",
    body: "Every save queues a build and streams the PDF back beside the source. Errors arrive as diagnostics you can click straight to the offending line.",
  },
  {
    icon: Users,
    title: "Roles, not shared accounts",
    body: "Owners, editors and viewers are distinct. A viewer can read and compile but every write is refused by the API rather than merely hidden in the UI.",
  },
  {
    icon: History,
    title: "History you can return to",
    body: "Snapshots are kept per project, diffed on request, and restorable. Compare two revisions before overwriting either one.",
  },
  {
    icon: FileStack,
    title: "Bring the whole project",
    body: "Import a ZIP and the tree, assets and bibliography arrive intact. Export whenever you need to move to a local TeX installation.",
  },
];

/** Mirrors `LocalCompileBackend._docker_argv`, with the image name as configured. */
const SANDBOX_ARGV = [
  "docker run --rm -i \\",
  "  --network none \\",
  "  --read-only \\",
  "  --tmpfs /compile:rw,noexec,nosuid,size=200m \\",
  "  --tmpfs /tmp:rw,noexec,nosuid,size=100m \\",
  "  --cap-drop ALL --security-opt no-new-privileges \\",
  "  --pids-limit 50 --memory 1g --memory-swap 1g --cpus 2 \\",
  "  likhitex-compiler",
];

export default async function LandingPage() {
  const user = await currentUser();

  return (
    <div className="landing min-h-screen bg-surface text-on-surface">
      <ScrollProgress />

      {/* Header. 56px, matching the height both reference sites use, so the page
          does not open with a chunky bar the way the previous version did. */}
      <header className="sticky top-0 z-40 border-b border-surface-container-high bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.png" alt="Likhitex" width={200} height={56} priority className="h-10 w-auto" />
          </Link>

          <nav className="hidden items-center gap-7 md:flex" aria-label="Sections">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-[length:var(--step--1)] text-on-surface-variant transition-colors hover:text-on-surface"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {user ? (
            <div className="flex items-center gap-2">
              <Link
                href="/projects"
                className={buttonVariants({ variant: "primary", size: "md" })}
              >
                Open editor
              </Link>
              <UserMenu />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/sign-in"
                className="px-2 text-[length:var(--step--1)] font-medium text-on-surface-variant transition-colors hover:text-on-surface"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className={buttonVariants({ variant: "primary", size: "md" })}
              >
                Create account
              </Link>
            </div>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* A wide, very low-contrast wash behind the headline. Kept faint on
            purpose: the reference pages get their depth from type and space,
            not from a gradient panel. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-32 h-[420px] bg-[radial-gradient(60%_60%_at_50%_40%,var(--color-primary-fixed)_0%,transparent_70%)] opacity-70"
        />

        <div className="relative mx-auto max-w-7xl px-6 pt-16 pb-14 sm:pt-20 sm:pb-16 lg:px-8">
          <div className="flex items-center gap-2 text-[length:var(--step--1)] font-medium text-on-surface-variant">
            <Lock className="h-3.5 w-3.5 text-primary" />
            <span>Invite-only workspace</span>
          </div>

          <h1 className="mt-5 max-w-[16ch] text-[length:var(--step-4)] font-medium text-on-surface">
            LaTeX your research group can actually work in together
          </h1>

          <p className="mt-5 max-w-[58ch] text-[length:var(--step-1)] leading-relaxed text-on-surface-variant">
            Likhitex compiles on a real TeX Live toolchain, keeps every build inside a
            locked-down container, and gives each collaborator exactly the access their
            role allows. Built for groups writing one document rather than one person
            writing alone.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {user ? (
              <Link
                href="/projects"
                className={buttonVariants({ variant: "primary", size: "lg" })}
              >
                Open editor
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            ) : (
              <>
                <Link
                  href="/sign-up"
                  className={buttonVariants({ variant: "primary", size: "lg" })}
                >
                  Create account
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
                <Link
                  href="/sign-in"
                  className={buttonVariants({ variant: "outline", size: "lg" })}
                >
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Product view. A miniature of the actual editor, in the app's own
            palette and syntax colours, rather than grey placeholder bars. */}
        <div className="relative mx-auto max-w-7xl px-6 pb-16 lg:px-8">
          <div className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest shadow-[0_1px_2px_rgba(25,28,30,0.04),0_12px_32px_-12px_rgba(25,28,30,0.12)]">
            <div className="flex items-center gap-2 border-b border-surface-container-high bg-surface-container-low px-3 py-2">
              <span className="font-mono text-[11px] text-outline">main.tex</span>
              <span className="ml-auto flex items-center gap-1.5 text-[11px] text-secondary">
                <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
                Saved
              </span>
            </div>

            <div className="grid grid-cols-[168px_1fr] sm:grid-cols-[200px_1fr_1fr]">
              {/* File tree */}
              <div className="hidden border-r border-surface-container-high px-2 py-2.5 sm:block">
                {["sections/", "  introduction.tex", "  method.tex", "figures/", "  arch.pdf", "references.bib"].map(
                  (entry) => (
                    <div
                      key={entry}
                      className={`truncate rounded px-1.5 py-1 font-mono text-[11px] ${
                        entry.includes("method.tex")
                          ? "bg-primary-fixed text-primary"
                          : "text-on-surface-variant"
                      }`}
                    >
                      {entry}
                    </div>
                  ),
                )}
              </div>

              {/* Source, coloured as CodeEditor renders it */}
              <div className="border-r border-surface-container-high px-3 py-2.5 font-mono text-[11px] leading-[17px]">
                <div>
                  <span className="text-[#4F46E5]">\section</span>
                  <span className="text-[#464555]">&#123;Method&#125;</span>
                </div>
                <div className="text-outline">&#32;</div>
                <div>
                  <span className="text-[#4F46E5]">We</span>{" "}
                  <span className="text-[#0F766E]">train</span>
                </div>
                <div>
                  {"the model on "}
                  <span className="text-[#2563EB]">\cite</span>
                  <span className="text-[#464555]">&#123;krizhevsky&#125;</span>
                </div>
                <div className="text-[#2563EB]">{"\includegraphics"}</div>
                <div className="text-[#464555]">&#123;figures/arch&#125;</div>
                <div className="text-[#6B7280] italic">{"% compiles on every save"}</div>
              </div>

              {/* Rendered page */}
              <div className="hidden px-4 py-3 sm:block">
                <div className="text-[13px] font-semibold text-on-surface">2 Method</div>
                <div className="mt-2 space-y-1.5">
                  <div className="h-1.5 w-4/5 rounded-full bg-surface-container-high" />
                  <div className="h-1.5 w-full rounded-full bg-surface-container-high" />
                  <div className="h-1.5 w-11/12 rounded-full bg-surface-container-high" />
                </div>
                <div className="mt-4 flex h-16 items-center justify-center rounded border border-surface-container-high bg-surface-container-low text-[11px] text-outline">
                  figure
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="h-1.5 w-full rounded-full bg-surface-container-high" />
                  <div className="h-1.5 w-3/4 rounded-full bg-surface-container-high" />
                </div>
              </div>
            </div>
          </div>

          {/* Dissolves the hero's wash into the page instead of a hard seam. */}
          <div aria-hidden="true" className="landing-edge pointer-events-none h-12 w-full" />
        </div>
      </section>

      {/* Capabilities. Rows with hairline separators rather than a grid of
          coloured icon squares, which is the pattern both reference sites
          avoid and which reads as generic. */}
      <section id="capabilities" className="mx-auto max-w-7xl px-6 py-14 sm:py-16 lg:px-8">
        <Reveal>
          <h2 className="max-w-[20ch] text-[length:var(--step-3)] font-medium text-on-surface">
            Everything a thesis needs, nothing it does not
          </h2>
        </Reveal>

        <div className="mt-9 divide-y divide-surface-container-high border-y border-surface-container-high">
          {CAPABILITIES.map((item, index) => (
            <Reveal key={item.title} delay={index * 60}>
              <div className="grid gap-x-8 gap-y-2 py-5 sm:grid-cols-[minmax(0,15rem)_1fr] sm:py-6">
                <div className="flex items-center gap-2.5">
                  <item.icon className="h-4 w-4 shrink-0 text-primary" />
                  <h3 className="text-[length:var(--step-0)] font-semibold text-on-surface">
                    {item.title}
                  </h3>
                </div>
                <p className="text-[length:var(--step--1)] leading-relaxed text-on-surface-variant">
                  {item.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Security. The mechanism, not a checklist of adjectives. */}
      <section id="security" className="border-y border-surface-container-high bg-surface-container-low">
        <div className="mx-auto max-w-7xl px-6 py-14 sm:py-16 lg:px-8">
          <Reveal>
            <div className="flex items-center gap-2 text-[length:var(--step--1)] font-medium text-on-surface-variant">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span>Compilation sandbox</span>
            </div>
            <h2 className="mt-4 max-w-[24ch] text-[length:var(--step-3)] font-medium text-on-surface">
              A submitted document should never be able to reach the machine
            </h2>
            <p className="mt-4 max-w-[58ch] text-[length:var(--step--1)] leading-relaxed text-on-surface-variant">
              A thesis will eventually contain a package you have not read. Every build
              runs in a throwaway container with no network, no capabilities and an
              immutable root filesystem, so a document can read its own files and nothing
              else. The invocation is fixed in the backend rather than assembled per
              request, which is why the isolation tests can assert on it.
            </p>
          </Reveal>

          <Reveal delay={80}>
            <pre className="mt-7 overflow-x-auto rounded-lg border border-surface-container-high bg-surface-container-lowest p-4 font-mono text-[11.5px] leading-[18px] text-on-surface">
              <code>{SANDBOX_ARGV.join("\n")}</code>
            </pre>
          </Reveal>
        </div>
      </section>

      {/* Access */}
      <section id="access" className="mx-auto max-w-7xl px-6 py-14 sm:py-16 lg:px-8">
        <Reveal>
          <div className="grid gap-8 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <h2 className="max-w-[22ch] text-[length:var(--step-3)] font-medium text-on-surface">
                Access is granted per person, not opened to the public
              </h2>
              <p className="mt-4 max-w-[54ch] text-[length:var(--step--1)] leading-relaxed text-on-surface-variant">
                An account is not an invitation to a project. Until someone with access
                adds you, the API refuses every read and write on it, and signing in
                takes you to a page that says so rather than an empty dashboard.
              </p>
            </div>
            <Link href="/no-access" className={buttonVariants({ variant: "outline", size: "lg" })}>
              No access yet?
            </Link>
          </div>
        </Reveal>
      </section>

      {/* Closing call to action */}
      <section className="border-t border-surface-container-high bg-surface-container-low">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-12 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <h2 className="max-w-[20ch] text-[length:var(--step-2)] font-medium text-on-surface">
            Start with a document you already have
          </h2>
          {user ? (
            <Link href="/projects" className={buttonVariants({ variant: "primary", size: "lg" })}>
              Open editor
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          ) : (
            <Link href="/sign-up" className={buttonVariants({ variant: "primary", size: "lg" })}>
              Create account
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          )}
        </div>
      </section>

      {/* Footer. Only links to routes that exist. */}
      <footer className="border-t border-surface-container-high">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-9 sm:flex-row sm:items-start sm:justify-between lg:px-8">
          <div>
            <Link href="/" className="flex items-center gap-2">
              <Image src="/logo.png" alt="Likhitex" width={96} height={28} className="h-6 w-auto" />
            </Link>
            <p className="mt-2 text-[length:var(--step--1)] text-outline">
              Collaborative LaTeX for research groups.
            </p>
          </div>

          <div className="flex gap-10 text-[length:var(--step--1)]">
            <div>
              <h3 className="mb-2 font-semibold text-on-surface">Product</h3>
              <ul className="space-y-1.5">
                <li>
                  <Link href="/projects" className="text-on-surface-variant transition-colors hover:text-on-surface">
                    Editor
                  </Link>
                </li>
                <li>
                  <a href="#capabilities" className="text-on-surface-variant transition-colors hover:text-on-surface">
                    Capabilities
                  </a>
                </li>
                <li>
                  <a href="#security" className="text-on-surface-variant transition-colors hover:text-on-surface">
                    Security
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="mb-2 font-semibold text-on-surface">Account</h3>
              <ul className="space-y-1.5">
                <li>
                  <Link href="/sign-in" className="text-on-surface-variant transition-colors hover:text-on-surface">
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link href="/sign-up" className="text-on-surface-variant transition-colors hover:text-on-surface">
                    Create account
                  </Link>
                </li>
                <li>
                  <Link href="/settings" className="text-on-surface-variant transition-colors hover:text-on-surface">
                    Settings
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="border-t border-surface-container-high">
          <div className="mx-auto max-w-7xl px-6 py-5 text-[length:var(--step--1)] text-outline lg:px-8">
            © {new Date().getFullYear()} Likhitex
          </div>
        </div>
      </footer>
    </div>
  );
}