'use client';

import { useEffect, useCallback, useRef } from 'react';

// The classic Konami Code: Up Up Down Down Left Right Left Right
// Also supports WASD variant: W W S S A D A D
const KONAMI_ARROWS = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'];
const KONAMI_WASD = ['w', 'w', 's', 's', 'a', 'd', 'a', 'd'];

export function useKonamiCode(onActivate: () => void) {
  const arrowProgress = useRef(0);
  const wasdProgress = useRef(0);
  const lastKeyTime = useRef(0);
  const activated = useRef(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (activated.current) return;

    const now = Date.now();
    // Reset if too much time between keys (2 seconds)
    if (now - lastKeyTime.current > 2000) {
      arrowProgress.current = 0;
      wasdProgress.current = 0;
    }
    lastKeyTime.current = now;

    // Check arrow sequence
    if (e.key === KONAMI_ARROWS[arrowProgress.current]) {
      arrowProgress.current++;
      if (arrowProgress.current === KONAMI_ARROWS.length) {
        activated.current = true;
        onActivate();
        return;
      }
    } else if (e.key === KONAMI_ARROWS[0]) {
      arrowProgress.current = 1;
    } else {
      arrowProgress.current = 0;
    }

    // Check WASD sequence
    if (e.key === KONAMI_WASD[wasdProgress.current]) {
      wasdProgress.current++;
      if (wasdProgress.current === KONAMI_WASD.length) {
        activated.current = true;
        onActivate();
        return;
      }
    } else if (e.key === KONAMI_WASD[0]) {
      wasdProgress.current = 1;
    } else {
      wasdProgress.current = 0;
    }
  }, [onActivate]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const reset = useCallback(() => {
    activated.current = false;
    arrowProgress.current = 0;
    wasdProgress.current = 0;
  }, []);

  return { reset };
}
