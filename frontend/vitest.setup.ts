/**
 * Vitest setup: DOM matchers plus the browser APIs jsdom does not implement.
 *
 * Every polyfill here stands in for something the real browser provides. Each
 * one is mocked deliberately rather than silently missing, so a component that
 * relies on it fails loudly instead of passing on a no-op.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// jsdom has no layout engine, so anything that measures the DOM returns zero.
// `scrollIntoView` is called by every list and dialog component.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// `ResizeObserver` backs the resizable split panes in the editor design.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// `matchMedia` backs every responsive Tailwind variant.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Dialogs and menus use pointer capture, which jsdom does not implement.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = () => false;
}

// The editor design opens PDFs and downloads; jsdom has no object URLs.
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
}

// Keep test output readable: React 19 logs act() hints that are noise here.
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const first = String(args[0] ?? "");
    if (first.includes("not wrapped in act")) return;
    originalError(...args);
  };
});
afterAll(() => {
  console.error = originalError;
});