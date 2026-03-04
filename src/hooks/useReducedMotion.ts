'use client';

import { useState, useEffect } from 'react';

/**
 * Returns true when the user prefers reduced motion.
 * Returns false during SSR and initial hydration to avoid mismatch —
 * the video element renders first (correct for most users), then
 * swaps to static fallback if reduced motion is detected on the client.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return reduced;
}
