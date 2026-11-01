"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MenuProps {
  /** The element that opened the menu: positions it and receives focus back. */
  anchor: HTMLElement;
  onClose: () => void;
  /** Which edge of the anchor the menu lines up with. */
  align?: "start" | "end";
  label?: string;
  className?: string;
  children: ReactNode;
}

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])';

/**
 * Dropdown menu anchored to its trigger.
 *
 * Fixed positioning lets it escape `overflow` containers such as the table's
 * horizontal scroller. It follows the WAI-ARIA menu pattern: the first item is
 * focused on open, arrow keys/Home/End move between items, Escape closes and
 * returns focus to the trigger, and Tab or a click outside closes it. Scrolling
 * or resizing closes it too, since a fixed menu would otherwise drift away from
 * its trigger.
 */
export function Menu({ anchor, onClose, align = "end", label, className, children }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Measure before paint so the menu never flashes at the wrong offset. The
  // position is written straight to the DOM; it is layout, not React state.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const rect = anchor.getBoundingClientRect();
    const gap = 4;
    const below = rect.bottom + gap;
    // Flip above the trigger when there is no room underneath.
    const fitsBelow = below + menu.offsetHeight <= window.innerHeight - gap;
    menu.style.top = `${fitsBelow ? below : Math.max(gap, rect.top - gap - menu.offsetHeight)}px`;
    if (align === "end") menu.style.right = `${Math.max(gap, window.innerWidth - rect.right)}px`;
    else menu.style.left = `${Math.max(gap, rect.left)}px`;
    menu.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
  }, [anchor, align]);

  useEffect(() => {
    const close = () => onCloseRef.current();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The trigger toggles the menu itself; closing here would reopen it.
      if (!ref.current?.contains(target) && !anchor.contains(target)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, { capture: true });
    };
  }, [anchor]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      anchor.focus();
      return;
    }
    if (event.key === "Tab") {
      onClose();
      return;
    }
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown" ? items[(index + 1) % items.length]
      : event.key === "ArrowUp" ? items[(index - 1 + items.length) % items.length]
      : event.key === "Home" ? items[0]
      : event.key === "End" ? items[items.length - 1]
      : null;
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "fixed z-50 min-w-44 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-surface-container-lowest py-1 text-left shadow-xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface MenuItemProps {
  icon?: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Secondary line under the label. */
  hint?: ReactNode;
}

export function MenuItem({ icon, children, onSelect, danger, disabled, hint }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm outline-none transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        danger
          ? "text-error hover:bg-error/10 focus-visible:bg-error/10"
          : "text-on-surface hover:bg-surface-container-low focus-visible:bg-surface-container-low",
      )}
    >
      {icon && <span className={cn("shrink-0", danger ? "text-error" : "text-on-surface-variant")}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {hint && <span className="block truncate text-xs text-on-surface-variant">{hint}</span>}
      </span>
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 border-t border-border-subtle" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-outline" aria-hidden="true">
      {children}
    </div>
  );
}
