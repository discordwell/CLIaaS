"use client";

import { useRef, useEffect, useCallback } from "react";

/**
 * Renders lines of text at the largest font size where every line
 * fits within the container width. Uses ResizeObserver to stay
 * responsive. Falls back to maxSize on SSR (adjusts on hydration).
 */
export default function FitText({
  lines,
  maxSize = 96,
  minSize = 16,
  className = "",
}: {
  lines: string[];
  maxSize?: number;
  minSize?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  const resize = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const els = lineRefs.current.filter(Boolean) as HTMLDivElement[];
    if (els.length === 0) return;

    const containerWidth = container.clientWidth;

    // Measure each line at maxSize to get natural widths
    els.forEach((el) => { el.style.fontSize = `${maxSize}px`; });

    // Find the smallest ratio (the line that needs the most shrinking)
    let minRatio = Infinity;
    els.forEach((el) => {
      const ratio = containerWidth / el.scrollWidth;
      if (ratio < minRatio) minRatio = ratio;
    });

    // Clamp between minSize and maxSize
    const size = Math.max(minSize, Math.min(maxSize, maxSize * minRatio));
    els.forEach((el) => { el.style.fontSize = `${size}px`; });
  }, [maxSize, minSize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => observer.disconnect();
  }, [resize]);

  return (
    <div ref={containerRef} className={className}>
      {lines.map((line, i) => (
        <div
          key={i}
          ref={(el) => { lineRefs.current[i] = el; }}
          className="whitespace-nowrap font-bold leading-[1.1]"
          style={{ fontSize: maxSize }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}
