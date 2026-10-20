"use client";

/**
 * A hairline scroll-progress bar under the header.
 *
 * It reads position on a scroll listener rather than driving an animation, so it
 * costs one transform per frame and no layout. `requestAnimationFrame` is the
 * throttle: scroll fires far more often than the display can show, and writing
 * the width for each event would do the same work several times over.
 *
 * Fixed positioning means this is the one element in the tree that scrolls the
 * page without being in the flow, so it is the one that needs `pointer-events:
 * none` -- otherwise it would swallow clicks on the navigation.
 */

import { useEffect, useRef } from "react";

export default function ScrollProgress() {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    let frame = 0;

    const update = () => {
      frame = 0;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      // A page shorter than the viewport has nothing to progress through.
      const ratio = scrollable > 0 ? window.scrollY / scrollable : 0;
      bar.style.transform = `scaleX(${Math.min(1, Math.max(0, ratio))})`;
    };

    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="fixed left-0 right-0 top-0 z-50 h-px pointer-events-none"
    >
      <div
        ref={barRef}
        className="h-full origin-left bg-primary"
        style={{ transform: "scaleX(0)" }}
      />
    </div>
  );
}