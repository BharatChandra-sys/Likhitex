import Image from "next/image";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import {
  ArrowRight,
  ChevronDown,
  Database,
  FileCheck2,
  History,
  Lock,
  ShieldCheck,
  Users,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { UserMenu } from "@/components/ui/user-menu";
import EditorPreview from "@/components/landing/EditorPreview";
import styles from "@/components/landing/landing.module.css";

/**
 * Marketing page. Server-rendered; the only client code is the user menu for a
 * signed-in visitor, and all motion is CSS (see landing.module.css).
 *
 * Every claim here is true of the deployed product. Features that are on the
 * roadmap but not shipped (live co-editing, other TeX engines, ZIP transfer) are
 * not advertised, and the FAQ says so plainly where a visitor would ask.
 */

const NAV_LINKS = [
  { href: "#capabilities", label: "Capabilities" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#security", label: "Security" },
  { href: "#faq", label: "FAQ" },
];

const CAPABILITIES = [
  {
    icon: Lock,
    title: "Private by default",
    body: "Nobody gets in without an invitation, and an account alone opens nothing: until a project owner adds you, the API refuses every read and write on that project.",
  },
  {
    icon: ShieldCheck,
    title: "Compilation treated as code execution",
    body: "Every build runs in a throwaway container with no network and shell escape disabled, so a package you have not read cannot reach the machine or your data.",
  },
  {
    icon: FileCheck2,
    title: "The PDF beside the source",
    body: "Compile on a full TeX Live installation and the PDF appears next to your source. Errors arrive as diagnostics you can click straight to the offending line.",
  },
  {
    icon: Users,
    title: "Sharing by role",
    body: "Owners, editors and viewers are distinct. A viewer can read and compile, but every write is refused by the API rather than merely hidden in the interface.",
  },
  {
    icon: History,
    title: "History you can return to",
    body: "Snapshots are kept per project, so you can compare two revisions and restore an earlier one before overwriting anything.",
  },
  {
    icon: Database,
    title: "No vendor lock-in",
    body: "Files live in S3-compatible object storage on infrastructure you choose, and storage, mail and compile backends sit behind interfaces you can swap.",
  },
];

const STEPS = [
  {
    title: "Get on the access list",
    body: "An administrator adds your email address to the access list. Then create your account with that same address.",
  },
  {
    title: "Start a project",
    body: "Create a project and its files in the browser. Compile whenever you like and read the PDF alongside the source.",
  },
  {
    title: "Share it by role",
    body: "Add colleagues who have signed in as editors or viewers. Each one gets exactly the access that role allows.",
  },
];

/** Mirrors `LocalCompileBackend._docker_argv`, with the configured limits. */
const SANDBOX_ARGV = [
  "docker run --rm -i \\",
  "  --network none \\",
  "  --read-only \\",
  "  --tmpfs /compile:rw,noexec,nosuid,size=200m \\",
  "  --tmpfs /tmp:rw,noexec,nosuid,size=100m \\",
  "  -v likhitex-texmf-cache:/usr/local/texlive/texmf-local:ro \\",
  "  --cap-drop ALL --security-opt no-new-privileges \\",
  "  --pids-limit 50 --memory 1g --memory-swap 1g --cpus 2 \\",
  "  likhitex-compiler",
];

const FAQ = [
  {
    q: "How do I get access?",
    a: "Likhitex is invite-only. Ask your group's administrator to add your email address to the access list, then sign up with that address. To work on a specific project, its owner then adds you as an editor or viewer.",
  },
  {
    q: "Who can see my projects?",
    a: "Only the people the project's owner has added. Viewers can read and compile; editors can also change files; only owners manage membership. These rules are enforced by the API on every request.",
  },
  {
    q: "Which TeX distribution and engine does it use?",
    a: "Documents are compiled with pdfLaTeX on TeX Live, including the extra LaTeX, science and font collections that theses and papers usually need. Shell escape is disabled.",
  },
  {
    q: "Where are my files stored?",
    a: "In S3-compatible object storage configured by whoever runs your instance, alongside a Postgres database for projects and permissions. Nothing is shared outside the people a project owner adds.",
  },
  {
    q: "Can several people edit at the same time?",
    a: "Not yet. Projects can be shared with any number of editors and viewers today; live co-editing with shared cursors is in development.",
  },
];

const SECTION = "mx-auto max-w-6xl px-4 sm:px-6 lg:px-8";
const EYEBROW = "font-mono text-xs font-medium uppercase tracking-[0.12em] text-primary";
const MUTED_LINK = "text-on-surface-variant transition-colors hover:text-on-surface";

export default async function LandingPage() {
  // `auth()` reads the session locally; `currentUser()` would call Clerk's API
  // on every request just to learn whether someone is signed in.
  const { userId } = await auth();
  const signedIn = Boolean(userId);

  return (
    <div className={`${styles.root} min-h-screen overflow-x-clip bg-surface text-on-surface`}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface-container-lowest px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:left-4 focus:top-3"
      >
        Skip to content
      </a>
      <div aria-hidden="true" className={`${styles.progress} fixed inset-x-0 top-0 z-50 h-0.5 bg-primary`} />

      <header className="sticky top-0 z-40 border-b border-surface-container-high bg-surface/85 backdrop-blur-md">
        <div className={`${SECTION} flex h-14 items-center justify-between gap-4`}>
          <Link href="/" aria-label="Likhitex home" className="-ml-2 shrink-0">
            <Image src="/logo.png" alt="Likhitex" width={168} height={56} priority className="h-11 w-auto" />
          </Link>

          <nav aria-label="Sections" className="hidden items-center gap-7 md:flex">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className={`text-sm ${MUTED_LINK}`}>
                {link.label}
              </a>
            ))}
          </nav>

          {signedIn ? (
            <div className="flex items-center gap-2">
              <Link href="/projects" className={buttonVariants({ variant: "primary", size: "md" })}>
                Open projects
              </Link>
              <UserMenu />
            </div>
          ) : (
            <Link href="/sign-in" className={buttonVariants({ variant: "primary", size: "md" })}>
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main id="main">
        {/* Hero. Not wrapped in a reveal: the headline and the product view are
            the largest paint, and holding them at opacity 0 would delay it. */}
        <section className="relative">
          <div aria-hidden="true" className={`${styles.wash} pointer-events-none absolute inset-x-0 -top-24 h-[560px] opacity-80`} />

          <div className={`${SECTION} relative pt-14 pb-12 sm:pt-20 sm:pb-14`}>
            <p className="inline-flex items-center gap-2 rounded-full border border-primary-fixed-dim bg-surface-container-lowest/70 px-3 py-1 text-[length:var(--step--1)] font-medium text-on-surface-variant">
              <Lock className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              Private workspace · Invite only
            </p>

            <h1 className="mt-6 max-w-[18ch] text-[length:var(--step-4)] text-on-surface">
              LaTeX for research groups, on infrastructure you control
            </h1>

            <p className="mt-6 max-w-[60ch] text-[length:var(--step-1)] text-on-surface-variant">
              A private, invite-only collaborative LaTeX editor for trusted research
              groups and academic teams. Write on a full TeX Live toolchain, compile
              inside a sealed sandbox, and give each collaborator exactly the access
              their role allows.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              {signedIn ? (
                <Link href="/projects" className={buttonVariants({ variant: "primary", size: "lg" })}>
                  Open projects
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              ) : (
                <>
                  <Link href="/sign-in" className={buttonVariants({ variant: "primary", size: "lg" })}>
                    Sign in
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <a href="#access" className={buttonVariants({ variant: "outline", size: "lg", className: "bg-surface-container-lowest/60" })}>
                    Request access
                  </a>
                </>
              )}
            </div>

            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-on-surface-variant">
              {["TeX Live · pdfLaTeX", "No network, no shell escape", "Owner · Editor · Viewer", "S3-compatible storage"].map((fact) => (
                <li key={fact} className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-1 w-1 rounded-full bg-primary" />
                  {fact}
                </li>
              ))}
            </ul>
          </div>

          <div className={`${SECTION} relative pb-6`}>
            <EditorPreview />
          </div>
        </section>

        {/* Capabilities. Hairline rows rather than a grid of icon cards. */}
        <section id="capabilities" aria-labelledby="capabilities-title" className={`${SECTION} scroll-mt-20 py-16 sm:py-24`}>
          <div className={styles.reveal}>
            <p className={EYEBROW}>Capabilities</p>
            <h2 id="capabilities-title" className="mt-3 max-w-[22ch] text-[length:var(--step-3)]">
              Everything a thesis needs, nothing it does not
            </h2>
          </div>

          <ul className="mt-10 divide-y divide-surface-container-high border-y border-surface-container-high">
            {CAPABILITIES.map(({ icon: Icon, title, body }) => (
              <li key={title} className={`${styles.reveal} grid gap-x-10 gap-y-2 py-6 md:grid-cols-[minmax(0,18rem)_1fr]`}>
                <h3 className="flex items-center gap-3 text-[length:var(--step-1)]">
                  <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  {title}
                </h3>
                <p className="max-w-[65ch] text-[length:var(--step--1)] leading-relaxed text-on-surface-variant sm:text-[length:var(--step-0)]">
                  {body}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          aria-labelledby="how-title"
          className="scroll-mt-14 border-y border-surface-container-high bg-surface-container-low"
        >
          <div className={`${SECTION} py-16 sm:py-24`}>
            <div className={styles.reveal}>
              <p className={EYEBROW}>How it works</p>
              <h2 id="how-title" className="mt-3 max-w-[22ch] text-[length:var(--step-3)]">
                From invitation to shared PDF in three steps
              </h2>
            </div>

            <ol className="mt-10 grid gap-4 md:grid-cols-3 md:gap-6">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className={`${styles.reveal} rounded-xl border border-surface-container-high bg-surface-container-lowest p-6`}
                >
                  <span className="font-mono text-sm text-primary">0{index + 1}</span>
                  <h3 className="mt-3 text-[length:var(--step-2)]">{step.title}</h3>
                  <p className="mt-2 text-[length:var(--step--1)] leading-relaxed text-on-surface-variant sm:text-[length:var(--step-0)]">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Security. The mechanism, not a checklist of adjectives. */}
        <section id="security" aria-labelledby="security-title" className={`${SECTION} scroll-mt-14 py-16 sm:py-24`}>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center">
            <div className={styles.reveal}>
              <p className={EYEBROW}>Compilation sandbox</p>
              <h2 id="security-title" className="mt-3 max-w-[22ch] text-[length:var(--step-3)]">
                A submitted document should never be able to reach the machine
              </h2>
              <p className="mt-5 max-w-[58ch] text-on-surface-variant">
                A thesis will eventually load a package you have not read. Every build
                runs in a throwaway container with no network, no capabilities and an
                immutable root filesystem, so a document can read its own files and
                nothing else. The invocation is fixed in the backend rather than
                assembled per request, which is why the isolation tests can assert on it.
              </p>
            </div>

            <figure className={`${styles.reveal} min-w-0`}>
              <pre
                tabIndex={0}
                aria-label="The container invocation used for every compile"
                className="overflow-x-auto rounded-xl border border-inverse-surface bg-inverse-surface p-5 font-mono text-[12px] leading-[20px] text-inverse-on-surface"
              >
                <code>{SANDBOX_ARGV.join("\n")}</code>
              </pre>
              <figcaption className="mt-3 text-[length:var(--step--1)] text-on-surface-variant">
                The exact container invocation behind every compile.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* FAQ. Native disclosure elements: accessible and no JavaScript. */}
        <section
          id="faq"
          aria-labelledby="faq-title"
          className="scroll-mt-14 border-t border-surface-container-high"
        >
          <div className={`${SECTION} grid gap-8 py-16 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]`}>
            <div className={styles.reveal}>
              <p className={EYEBROW}>FAQ</p>
              <h2 id="faq-title" className="mt-3 text-[length:var(--step-3)]">
                Questions, answered
              </h2>
            </div>

            <div className="divide-y divide-surface-container-high border-y border-surface-container-high">
              {FAQ.map((item) => (
                <details key={item.q} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-medium text-on-surface [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronDown
                      className="h-4 w-4 shrink-0 text-on-surface-variant transition-transform group-open:rotate-180 motion-reduce:transition-none"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="max-w-[65ch] pb-5 text-[length:var(--step--1)] leading-relaxed text-on-surface-variant sm:text-[length:var(--step-0)]">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Access. The closing call to action, honest about being invite-only. */}
        <section id="access" aria-labelledby="access-title" className={`${SECTION} scroll-mt-20 pb-16 sm:pb-24`}>
          <div className={`${styles.reveal} relative overflow-hidden rounded-2xl border border-primary-fixed-dim bg-surface-container-lowest px-6 py-10 sm:px-12 sm:py-14`}>
            <div aria-hidden="true" className={`${styles.wash} pointer-events-none absolute inset-0 opacity-70`} />
            <div className="relative grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <h2 id="access-title" className="max-w-[22ch] text-[length:var(--step-3)]">
                  Access is granted per person, never opened to the public
                </h2>
                <p className="mt-4 max-w-[56ch] text-on-surface-variant">
                  To join, ask your group&apos;s administrator to add your email address,
                  then create your account with it. After that, a project owner adds
                  you to the work you need.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                {signedIn ? (
                  <Link href="/projects" className={buttonVariants({ variant: "primary", size: "lg" })}>
                    Open projects
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                ) : (
                  <>
                    <Link href="/sign-in" className={buttonVariants({ variant: "primary", size: "lg" })}>
                      Sign in
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                    <Link href="/sign-up" className={buttonVariants({ variant: "outline", size: "lg", className: "bg-surface-container-lowest" })}>
                      I have an invitation
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-surface-container-high">
        <div className={`${SECTION} flex flex-col gap-8 py-10 sm:flex-row sm:items-start sm:justify-between`}>
          <div>
            <Link href="/" aria-label="Likhitex home" className="-ml-1.5 inline-block">
              <Image src="/logo.png" alt="Likhitex" width={120} height={40} className="h-9 w-auto" />
            </Link>
            <p className="mt-2 max-w-[36ch] text-[length:var(--step--1)] text-on-surface-variant">
              Private, invite-only collaborative LaTeX for research groups and academic teams.
            </p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-[length:var(--step--1)]">
            <ul className="space-y-2">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className={MUTED_LINK}>{link.label}</a>
                </li>
              ))}
            </ul>
            <ul className="space-y-2">
              <li><Link href="/sign-in" className={MUTED_LINK}>Sign in</Link></li>
              <li><Link href="/sign-up" className={MUTED_LINK}>Create account</Link></li>
              <li><Link href="/projects" className={MUTED_LINK}>Projects</Link></li>
              <li><Link href="/settings" className={MUTED_LINK}>Settings</Link></li>
            </ul>
          </nav>
        </div>

        <div className="border-t border-surface-container-high">
          <p className={`${SECTION} py-5 text-[length:var(--step--1)] text-on-surface-variant`}>
            © {new Date().getFullYear()} Likhitex
          </p>
        </div>
      </footer>
    </div>
  );
}
