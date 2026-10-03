import { describe, expect, it } from "vitest";
import {
  formatAbsoluteTime,
  formatBytes,
  formatQuotaPair,
  formatRelativeTime,
  initialsOf,
  displayName,
} from "@/lib/format";

describe("formatBytes", () => {
  it("reports 0 B rather than an empty string", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("keeps whole bytes undecimated", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("uses binary units to match the API's MiB quota", () => {
    expect(formatBytes(1024)).toBe("1.0 KiB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MiB");
  });

  it("formats a quota-sized value without scientific notation", () => {
    const value = 200 * 1024 * 1024;
    expect(formatBytes(value)).toBe("200.0 MiB");
  });

  it("clamps the largest unit instead of overflowing the table", () => {
    expect(formatBytes(1024 ** 5)).toBe("1024.0 TiB");
  });

  it("renders a placeholder for missing or invalid input", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("formatQuotaPair", () => {
  it("renders used-of-quota", () => {
    expect(formatQuotaPair(42 * 1024 * 1024, 200 * 1024 * 1024)).toBe(
      "42.0 MiB of 200.0 MiB",
    );
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-10-03T12:00:00Z");

  it("reports 'never' when there is no timestamp", () => {
    expect(formatRelativeTime(null, now)).toBe("never");
    expect(formatRelativeTime(undefined, now)).toBe("never");
  });

  it("reports minutes for a recent change", () => {
    const fourMinutesAgo = new Date(now.getTime() - 4 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fourMinutesAgo, now)).toBe("4 minutes ago");
  });

  it("reports 'yesterday' for a day-old change", () => {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(yesterday, now)).toBe("yesterday");
  });

  it("handles a future timestamp without going blank", () => {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(tomorrow, now)).toBe("tomorrow");
  });

  it("renders a placeholder for an unparseable timestamp", () => {
    expect(formatRelativeTime("not-a-date", now)).toBe("—");
  });
});

describe("formatAbsoluteTime", () => {
  it("reports 'Never' for a project that was never compiled", () => {
    expect(formatAbsoluteTime(null)).toBe("Never");
  });

  it("renders a full timestamp for the tooltip", () => {
    const rendered = formatAbsoluteTime("2026-10-01T09:30:00Z");
    expect(rendered).not.toBe("—");
    expect(rendered).toContain("2026");
  });
});

describe("initialsOf", () => {
  it("uses the first and last word", () => {
    expect(initialsOf("Alok Kumar")).toBe("AK");
  });

  it("handles a single name", () => {
    expect(initialsOf("Marcus")).toBe("MA");
  });

  it("falls back to the email when there is no name", () => {
    expect(initialsOf(null, "ak@likhitex.org")).toBe("AK");
  });

  it("takes initials from the email local part, not the domain", () => {
    // Naive splitting would yield "AE" from the trailing "edu".
    expect(initialsOf(null, "alok.kumar@university.edu")).toBe("AK");
  });

  it("never returns an empty string, which would render a blank avatar", () => {
    expect(initialsOf(null, null)).toBe("?");
    expect(initialsOf("   ", "  ")).toBe("?");
  });
});

describe("displayName", () => {
  it("prefers the full name", () => {
    expect(displayName("Alok Kumar", "ak@likhitex.org")).toBe("Alok Kumar");
  });

  it("falls back to the email", () => {
    expect(displayName(null, "ak@likhitex.org")).toBe("ak@likhitex.org");
  });

  it("falls back to a readable placeholder", () => {
    expect(displayName(null, null)).toBe("Unknown user");
  });
});
