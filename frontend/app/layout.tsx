import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ClerkTokenBridge } from "@/components/auth/ClerkTokenBridge";
import "./globals.css";

// Self-hosted at build time: no request to Google at runtime, and the fallback
// metrics are adjusted so the swap does not shift layout.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "Likhitex - Collaborative LaTeX Editor",
  description: "Private, invite-only collaborative LaTeX editor for students and friends",
  keywords: ["latex", "editor", "collaborative", "real-time", "academic"],
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} ${sourceSerif.variable} h-full`}
    >
      <body className="min-h-full bg-surface text-on-surface font-sans antialiased">
        {/*
          ClerkProvider owns the session for the whole tree. ClerkTokenBridge is
          a client component so the API client can read the session token without
          any page having to pass it down by hand.
        */}
        <ClerkProvider
          appearance={{
            options: {
              logoImageUrl: "/logo-feather.png",
              socialButtonsVariant: "iconButton",
            },
            variables: {
              // The design system's primary, so Clerk's own widgets (UserButton,
              // account modals) match the app chrome.
              colorPrimary: "#4F46E5",
            },
            elements: {
              rootBox: "font-sans",
              card: "shadow-lg",
            },
          }}
        >
          <ClerkTokenBridge />
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
