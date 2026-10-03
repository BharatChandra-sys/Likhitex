import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ClerkTokenBridge } from "@/components/auth/ClerkTokenBridge";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "Likhitex - Collaborative LaTeX Editor",
  description: "Private, invite-only collaborative LaTeX editor for students and friends",
  keywords: ["latex", "editor", "collaborative", "real-time", "academic"],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="min-h-full bg-surface text-on-surface font-sans antialiased">
        {/*
          ClerkProvider owns the session for the whole tree. ClerkTokenBridge is
          a client component so the API client can read the session token without
          any page having to pass it down by hand.
        */}
        <ClerkProvider>
          <ClerkTokenBridge />
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
