"use client";

/**
 * Reveals its children once when they scroll into view.
 *
 * CSS owns the animation (see `.landing [data-reveal]` in `globals.css`); this
 * component only decides *when* it should run. Keeping the timing in one place
 * means every section animates identically, and the reduced-motion override can
 * disable all of them at once.
 *
 * The observer disconnects after the first intersection. These sections do not
 * animate again on the way back up, and leaving the observers attached would
 * keep every revealed node observed for the life of the page.
 */

import { useEffect, useRef, type ReactNode } from "react";

export interface RevealProps {
  children: ReactNode;
  /** Stagger within a group, in milliseconds. */
  delay?: number;
  className?: string;
  /** How far into the viewport the element must come before revealing. */
  margin?: string;
}

export default function Reveal({
  children,
  delay = 0,
  className,
  margin = "0px 0px -12% 0px",
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Anything without IntersectionObserver is simply shown, rather than left
    // invisible by an effect that will never run.
    if (typeof IntersectionObserver === "undefined") {
      node.dataset.revealed = "true";
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          // `IntersectionObserver` reports its target as the base `Element`;
          // the observed node is always this component's own div.
          (entry.target as HTMLElement).dataset.revealed = "true";
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [margin]);

  return (
    <div
      ref={ref}
      data-reveal=""
      className={className}
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}