"use client";

/**
 * Drag-to-resize logic for a single panel divider.
 *
 * Returns a `startDrag` handler to attach to `onMouseDown` of the resize grip.
 * While dragging the cursor is locked to the resize style globally so it stays
 * consistent even when the pointer moves faster than the DOM updates.
 *
 * The caller owns the width state; the hook just calls `onResize` with the new
 * pixel value on every mousemove so the caller can clamp it to min/max.
 */

import { useCallback, useRef } from "react";

export function usePanelResize(onResize: (newWidth: number) => void) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const startDrag = useCallback(
    (e: React.MouseEvent, currentWidth: number) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = currentWidth;

      // Lock cursor globally so fast moves don't flash back to default
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - startX.current;
        onResize(startWidth.current + delta);
      };

      const onUp = () => {
        dragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [onResize],
  );

  return { startDrag };
}
