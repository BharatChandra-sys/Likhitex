import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        "primary-container": "var(--color-primary-container)",
        "primary-fixed": "var(--color-primary-fixed)",
        "primary-fixed-dim": "var(--color-primary-fixed-dim)",
        "primary-hover": "#4338ca",
        surface: "var(--color-surface)",
        "surface-container": "var(--color-surface-container)",
        "surface-container-low": "var(--color-surface-container-low)",
        "surface-container-high": "var(--color-surface-container-high)",
        "surface-container-lowest": "var(--color-surface-container-lowest)",
        "on-surface": "var(--color-on-surface)",
        "on-surface-variant": "var(--color-on-surface-variant)",
        "on-primary": "var(--color-on-primary)",
        "on-primary-fixed-variant": "var(--color-on-primary-fixed-variant)",
        secondary: "var(--color-secondary)",
        "secondary-container": "var(--color-secondary-container)",
        "secondary-fixed": "var(--color-secondary-fixed)",
        "secondary-fixed-dim": "var(--color-secondary-fixed-dim)",
        "on-secondary-container": "var(--color-on-secondary-container)",
        tertiary: "var(--color-tertiary)",
        "tertiary-fixed": "var(--color-tertiary-fixed)",
        error: "var(--color-error)",
        "error-container": "var(--color-error-container)",
        outline: "var(--color-outline)",
        "outline-variant": "var(--color-outline-variant)",
        "inverse-surface": "var(--color-inverse-surface)",
        "inverse-on-surface": "var(--color-inverse-on-surface)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      spacing: {
        "60": "15rem",
        "90": "22.5rem",
        "105": "26.25rem",
        "340": "85rem",
      },
      maxWidth: {
        "60": "15rem",
        "90": "22.5rem",
        "105": "26.25rem",
        "340": "85rem",
      },
      width: {
        "60": "15rem",
        "90": "22.5rem",
        "105": "26.25rem",
        "340": "85rem",
      },
      height: {
        "4.5": "1.125rem",
      },
      leading: {
        "14px": "14px",
      },
    },
  },
  plugins: [],
};
export default config;
