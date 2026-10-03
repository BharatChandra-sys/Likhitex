/**
 * Clerk component theming, shared by the sign-in and sign-up screens.
 *
 * Clerk renders the interactive card (it already handles password reset, second
 * factors and OAuth error states), while the surrounding page shell is ours. This
 * object is what makes Clerk's widget match the Stitch design, so it lives in one
 * place: the two screens previously carried near-identical copies, which is how
 * the two cards drift apart.
 */
export const authAppearance = {
  variables: {
    colorPrimary: "#4F46E5",
    colorText: "#111827",
    colorTextSecondary: "#6B7280",
    colorBackground: "#FFFFFF",
    colorInputBackground: "#F9FAFB",
    colorInputText: "#111827",
    colorNeutral: "#6B7280",
    fontFamily: "var(--font-inter), system-ui, sans-serif",
    borderRadius: "0.375rem",
  },
  elements: {
    // The page shell supplies the framing, so Clerk's own card box is suppressed.
    cardBox: "shadow-none ring-0 border-0 bg-transparent p-0",
    card: "w-[420px] max-w-full rounded-md border border-[#E5E7EB] shadow-sm",

    headerTitle: "text-xl font-bold tracking-tight text-on-surface",
    headerSubtitle: "text-xs font-normal text-on-surface-variant",
    header: "[&_p]:mt-1",

    formFieldInput:
      "h-8 bg-surface-container-lowest border border-[#E5E7EB] rounded-lg text-xs placeholder:text-outline focus:border-primary-container focus:ring-0",
    formFieldLabel: "text-xs font-medium text-[#374151]",
    formButtonPrimary:
      "h-8 bg-primary-container hover:bg-primary text-on-primary text-sm font-semibold rounded-lg",

    socialButtonsBlockButton:
      "h-8 bg-surface-container-lowest border border-[#E5E7EB] text-sm font-medium hover:bg-surface-container-low",

    // Self sign-up is suppressed: the workspace is invite-only, so there is no
    // "Don't have an account? Sign up" link to offer.
    footerAction: "hidden",
    footerActionLink: "hidden",
    identityPreview: "rounded-lg",
  },
} as const;

/**
 * The two-column grid backdrop used by both auth screens.
 *
 * Declared once because it is referenced by a global `<style jsx global>` block in
 * each page, and a Tailwind class alone cannot express the two gradient axes.
 */
export const mathGridStyles = `
  .bg-math-grid {
    background-color: #f9fafb;
    background-image: linear-gradient(
        to right,
        rgba(229, 231, 235, 0.7) 1px,
        transparent 1px
      ),
      linear-gradient(
        to bottom,
        rgba(229, 231, 235, 0.7) 1px,
        transparent 1px
      );
    background-size: 24px 24px;
  }
`;