/**
 * Display formatters for API values.
 *
 * The dashboard previously hardcoded these strings ("14.2 MB", "4 mins ago"), so
 * anything that renders a real value needs one definition here instead of a
 * format expression copy-pasted into each component.
 */

/**
 * Human-readable byte size.
 *
 * Uses binary units (KiB/MiB) because the API's quota is defined in MB as
 * `MB * 1024 * 1024`, so reporting in binary keeps the denominator consistent
 * with what the server enforces.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)),
  );
  const value = bytes / 1024 ** exponent;

  // Whole bytes never need a decimal; larger units get one place.
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
}

/**
 * Compact quota string for the header meter, e.g. "42.1 MiB of 200 MiB".
 */
export function formatQuotaPair(used: number, quota: number): string {
  return `${formatBytes(used)} of ${formatBytes(quota)}`;
}

/**
 * Relative time, e.g. "4 mins ago".
 *
 * Uses `Intl.RelativeTimeFormat`, which needs a fixed locale rather than the
 * viewer's, because the server and client can disagree and hydration must not
 * flip the rendered string.
 */
const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

export function formatRelativeTime(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return "never";

  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "—";

  const deltaSeconds = Math.round((timestamp - now.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (Math.abs(deltaSeconds) >= seconds || unit === "second") {
      return formatter.format(Math.round(deltaSeconds / seconds), unit);
    }
  }
  return "just now";
}

/** Absolute date for tooltips, where the relative form would be ambiguous. */
export function formatAbsoluteTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Up to two uppercase initials for an avatar chip.
 *
 * An email is reduced to its local part first: splitting the whole address on
 * separators would take the initials from the domain, so
 * `alok.kumar@university.edu` would render "AE".
 *
 * Falls back to "?" so an avatar is never rendered as an empty circle, which
 * would otherwise read as a broken image.
 */
export function initialsOf(
  name: string | null | undefined,
  email?: string | null,
): string {
  const source = name?.trim() || email?.trim() || "";
  if (!source) return "?";

  const localPart = source.includes("@") ? source.slice(0, source.indexOf("@")) : source;
  const words = localPart.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Display name with a sensible fallback chain. */
export function displayName(
  fullName: string | null | undefined,
  email: string | null | undefined,
): string {
  return fullName?.trim() || email?.trim() || "Unknown user";
}
