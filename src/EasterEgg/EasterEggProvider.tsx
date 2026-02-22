'use client';

import { useState, useCallback, lazy, Suspense } from 'react';
import { useKonamiCode } from './useKonamiCode';

const AntGame = lazy(() => import('./AntGame'));

export default function EasterEggProvider({ children }: { children: React.ReactNode }) {
  const [gameActive, setGameActive] = useState(false);

  const activateGame = useCallback(() => {
    setGameActive(true);
  }, []);

  const exitGame = useCallback(() => {
    setGameActive(false);
  }, []);

  const { reset } = useKonamiCode(activateGame);

  const handleExit = useCallback(() => {
    exitGame();
    reset();
  }, [exitGame, reset]);

  return (
    <>
      {children}
      {gameActive && (
        <Suspense fallback={
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            color: '#ff4400',
            fontFamily: 'monospace',
            fontSize: '24px',
          }}>
            Loading classified mission data...
          </div>
        }>
          <AntGame onExit={handleExit} />
        </Suspense>
      )}
    </>
  );
}
