"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Optional leading icon shown beside the title. */
  icon?: ReactNode;
  children?: ReactNode;
  /** Right-aligned action row. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** `alertdialog` for confirmations that interrupt the user. */
  role?: "dialog" | "alertdialog";
}

const SIZES = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg" } as const;

/**
 * Modal dialog built on the native `<dialog>` element.
 *
 * `showModal()` gives the hard parts for free: the page behind becomes inert
 * (focus cannot leave the dialog), the dialog renders in the top layer above
 * every z-index, and Escape fires `cancel`. This component adds focus on an
 * element marked `data-autofocus`, focus return to whatever opened it, and
 * close-on-backdrop-click. Content mounts only while open, so forms inside start
 * fresh on every open.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  size = "md",
  role = "dialog",
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // Mirrors `open` so the native `close` event can tell a user dismissal from
  // the close this component performs itself when `open` turns false.
  const isOpenRef = useRef(false);
  const pressedBackdropRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    isOpenRef.current = open;

    if (open && !dialog.open) {
      openerRef.current = document.activeElement as HTMLElement | null;
      // jsdom has no showModal; the attribute keeps tests rendering content.
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      if (openerRef.current?.isConnected) openerRef.current.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      role={role === "alertdialog" ? "alertdialog" : undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // Keep React in charge of visibility; Escape becomes a request to close.
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        // Only reached if the browser closed it anyway (e.g. a repeated Escape).
        if (isOpenRef.current) onClose();
      }}
      onPointerDown={(event) => {
        pressedBackdropRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // The content fills the dialog box, so a click whose target is the
        // dialog itself landed on the backdrop. Requiring the press to start
        // there too stops a text selection dragged outside from closing it.
        if (pressedBackdropRef.current && event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] p-0 overflow-hidden",
        "rounded-xl border border-border bg-surface-container-lowest text-on-surface shadow-2xl",
        "backdrop:bg-on-surface/40 backdrop:backdrop-blur-[2px]",
        "open:flex flex-col",
        SIZES[size],
      )}
    >
      {open && (
        <>
          <header className="flex items-start gap-3 px-5 pt-5 pb-4">
            {icon && <div className="shrink-0">{icon}</div>}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-semibold leading-snug text-on-surface">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                  {description}
                </p>
              )}
            </div>
            {role === "dialog" && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </header>

          {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>}

          {footer && (
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle bg-surface-container-low/60 px-5 py-3">
              {footer}
            </footer>
          )}
        </>
      )}
    </dialog>
  );
}
