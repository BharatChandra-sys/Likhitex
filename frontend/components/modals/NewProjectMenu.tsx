"use client";

import { useLayoutEffect, useState } from "react";
import { FileText, FolderArchive } from "lucide-react";

interface NewProjectMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateBlank: () => void;
  onUploadZip: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

/** Fallback used before the trigger has been measured, and if measuring fails. */
const UNMEASURED = { top: 0, left: 0 };

export default function NewProjectMenu({
  isOpen,
  onClose,
  onCreateBlank,
  onUploadZip,
  triggerRef,
}: NewProjectMenuProps) {
  const [position, setPosition] = useState(UNMEASURED);

  // The trigger's box cannot be read during render, so it is measured in a
  // layout effect and kept in state. This runs before paint, so the menu is
  // never visible at the wrong offset. A stale position is harmless while
  // closed because nothing is rendered; it is re-measured on the next open.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    setPosition(rect ? { top: rect.bottom + 2, left: rect.left } : UNMEASURED);
  }, [isOpen, triggerRef]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Menu */}
      <div
        className="fixed z-50 w-[290px] bg-white rounded-lg shadow-lg p-1.5 flex flex-col gap-0.5"
        style={{ top: `${position.top}px`, left: `${position.left}px` }}
      >
        {/* Header */}
        <div className="px-2 py-1 text-xs text-neutral-500 uppercase tracking-wide">
          New Document
        </div>

        {/* Blank Project */}
        <button
          onClick={() => {
            onCreateBlank();
            onClose();
          }}
          className="group flex items-center justify-between p-2 rounded-md bg-neutral-100 hover:bg-neutral-100 text-neutral-900"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <FileText className="w-[18px] h-[18px] text-indigo-600 shrink-0" />
            <div className="flex flex-col min-w-0 text-left">
              <span className="text-sm font-medium truncate text-indigo-600">
                Blank Project
              </span>
              <span className="text-xs text-neutral-500 truncate">
                Empty main.tex canvas
              </span>
            </div>
          </div>
          <span className="text-xs font-mono text-neutral-400 bg-neutral-200 px-1 rounded shrink-0">
            ⌥B
          </span>
        </button>

        {/* Separator */}
        <div className="h-px bg-neutral-200 my-1" />

        {/* Upload Archive */}
        <button
          onClick={() => {
            onUploadZip();
            onClose();
          }}
          className="group flex items-center justify-between p-2 rounded-md hover:bg-neutral-100 text-neutral-900 transition-colors"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <FolderArchive className="w-[18px] h-[18px] text-neutral-500 shrink-0" />
            <div className="flex flex-col min-w-0 text-left">
              <span className="text-sm font-medium truncate">
                Upload Archive
              </span>
              <span className="text-xs text-neutral-500 truncate">
                Import existing directory
              </span>
            </div>
          </div>
          <span className="text-xs font-mono text-green-700 bg-neutral-200 px-1 rounded shrink-0">
            .zip
          </span>
        </button>

        {/*
          "Example Project" and "Template Gallery" were removed: both need a
          template endpoint, which the API does not have. Shipping them as
          styled rows with no handler was the mock-up problem this menu is meant
          to avoid.
        */}

        {/* Info Text */}
        <div className="w-full pt-1 flex items-center gap-1.5 text-neutral-500 px-2">
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-xs font-mono">Docked 2px below trigger</span>
        </div>
      </div>
    </>
  );
}
