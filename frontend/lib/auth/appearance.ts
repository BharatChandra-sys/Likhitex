import type { ComponentProps } from "react";
import type { SignUp } from "@clerk/nextjs";

/**
 * Shared look for the auth cards.
 *
 * Sign-in renders its own card (see its page for why) and sign-up renders Clerk's
 * `<SignUp>`; both read their classes from here so the two cards cannot drift
 * apart, and both match the landing page (serif title, hairline border, the
 * product mock's shadow).
 */
export const authClasses = {
  card: "w-full max-w-[400px] rounded-xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-[0_1px_2px_rgba(25,28,30,0.04),0_24px_48px_-24px_rgba(25,28,30,0.18)] sm:p-8",
  title: "font-serif text-[1.75rem] font-medium leading-tight tracking-tight text-on-surface",
  subtitle: "text-sm text-on-surface-variant",
  /** Reserves the card's height while clerk-js loads, so the page does not jump. */
  placeholder: "min-h-[420px]",
} as const;

export const authAppearance = {
  variables: {
    colorPrimary: "#4F46E5",
    colorForeground: "#191C1E",
    colorMutedForeground: "#464555",
    colorBackground: "#FFFFFF",
    colorInput: "#FFFFFF",
    colorInputForeground: "#191C1E",
    colorNeutral: "#464555",
    fontFamily: "var(--font-inter), system-ui, sans-serif",
    borderRadius: "0.375rem",
  },
  elements: {
    rootBox: "w-full max-w-[400px]",
    // Clerk's own card box is flattened so `authClasses.card` is the only frame.
    cardBox: "w-full shadow-none ring-0 border-0 bg-transparent",
    card: authClasses.card,
    headerTitle: authClasses.title,
    headerSubtitle: authClasses.subtitle,

    formFieldLabel: "text-xs font-medium text-on-surface",
    formFieldInput:
      "h-9 rounded-md border border-surface-container-high bg-surface-container-lowest text-sm placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary",
    formButtonPrimary:
      "h-9 rounded-md bg-primary text-sm font-medium text-on-primary normal-case shadow-none hover:bg-primary/90",
    socialButtonsBlockButton:
      "h-9 border border-surface-container-high bg-surface-container-lowest text-sm font-medium hover:bg-surface-container-low",
    identityPreview: "rounded-md",

    // The page renders its own "Already have an account?" link, and Clerk's
    // footer (branding, development-mode badge) has no place on this screen.
    footer: "hidden",
  },
  options: {
    // The page header already carries the wordmark.
    logoPlacement: "none",
    socialButtonsVariant: "blockButton",
    shimmer: false,
    showOptionalFields: false,
  },
} satisfies NonNullable<ComponentProps<typeof SignUp>["appearance"]>;
