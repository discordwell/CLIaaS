'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Game, type GameState } from './engine';

interface AntGameProps {
  onExit: () => void;
}

export default function AntGame({ onExit }: AntGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [showIntro, setShowIntro] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState>('loading');
  const gameStarted = useRef(false);

  const startGame = useCallback(async () => {
    if (gameStarted.current || !canvasRef.current) return;
    gameStarted.current = true;
    setShowIntro(false);
    setLoading(true);
    setStatus('Loading assets...');

    const canvas = canvasRef.current;
    const game = new Game(canvas);
    gameRef.current = game;

    game.onLoadProgress = (loaded, total) => {
      setLoadProgress(Math.round((loaded / total) * 100));
      setStatus(`Loading sprites... (${loaded}/${total})`);
    };

    game.onStateChange = (state) => {
      setGameState(state);
      if (state === 'playing') {
        setLoading(false);
        setStatus('');
      }
    };

    try {
      await game.start('SCA01EA');
    } catch (e) {
      setError(`Failed to load game: ${e instanceof Error ? e.message : String(e)}`);
      setLoading(false);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gameRef.current) {
        gameRef.current.stop();
        gameRef.current = null;
      }
    };
  }, []);

  // Handle intro keypress
  useEffect(() => {
    if (!showIntro) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        startGame();
      }
      if (e.key === 'Escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showIntro, startGame, onExit]);

  // Handle F10 to exit during gameplay
  useEffect(() => {
    if (showIntro) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'F10') {
        e.preventDefault();
        onExit();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showIntro, onExit]);

  // Handle canvas resize
  useEffect(() => {
    if (!canvasRef.current || !gameRef.current) return;
    const observer = new ResizeObserver(() => {
      gameRef.current?.input.updateScale();
    });
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [gameState]);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      zIndex: 99999,
      background: '#000',
      overflow: 'hidden',
    }}>
      {/* Intro Screen */}
      {showIntro && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(ellipse at center, #1a0a00 0%, #000000 70%)',
          zIndex: 100000,
          fontFamily: 'monospace',
          cursor: 'pointer',
        }}
        onClick={startGame}
        >
          <div style={{
            fontSize: '100px',
            marginBottom: '20px',
            filter: 'drop-shadow(0 0 20px #ff4400) drop-shadow(0 0 40px #cc2200)',
            animation: 'pulse 2s ease-in-out infinite',
          }}>
            🐜
          </div>

          <h1 style={{
            color: '#ff4400',
            fontSize: '42px',
            fontWeight: 'bold',
            textShadow: '0 0 20px #ff4400, 0 0 40px #cc2200',
            letterSpacing: '4px',
            marginBottom: '8px',
            textAlign: 'center',
          }}>
            IT CAME FROM RED ALERT!
          </h1>
          <h2 style={{
            color: '#cc3300',
            fontSize: '24px',
            fontWeight: 'bold',
            letterSpacing: '6px',
            marginBottom: '8px',
            textTransform: 'uppercase',
          }}>
            The Giant Ant Missions
          </h2>
          <h3 style={{
            color: '#ffaa44',
            fontSize: '16px',
            fontWeight: 'normal',
            letterSpacing: '4px',
            marginBottom: '40px',
            textTransform: 'uppercase',
          }}>
            TypeScript Engine Reimplementation
          </h3>

          <div style={{
            color: '#888',
            fontSize: '13px',
            lineHeight: '2',
            textAlign: 'center',
            maxWidth: '600px',
            marginBottom: '40px',
          }}>
            <p style={{ color: '#cccccc', fontSize: '15px', marginBottom: '16px' }}>
              The classic giant ant missions from Command &amp; Conquer: Red Alert,
              rebuilt from scratch as a pure TypeScript/Canvas 2D game.
            </p>
            <p style={{ color: '#aaaaaa', marginBottom: '8px' }}>
              Select units with left click, right click to move/attack.
            </p>
            <p style={{ color: '#888888', fontSize: '11px' }}>
              Press <strong style={{ color: '#44aaff' }}>F10</strong> at any time to return to CLIaaS.
            </p>
          </div>

          <div style={{
            color: '#ff4400',
            fontSize: '18px',
            animation: 'blink 1.2s step-end infinite',
          }}>
            PRESS ENTER OR CLICK TO LAUNCH
          </div>

          <div style={{
            position: 'absolute',
            bottom: '20px',
            color: '#444',
            fontSize: '11px',
            textAlign: 'center',
          }}>
            A CLIaaS Easter Egg | Based on C&amp;C Red Alert Counterstrike
          </div>

          <style>{`
            @keyframes pulse {
              0%, 100% { transform: scale(1); }
              50% { transform: scale(1.08); }
            }
            @keyframes blink {
              0%, 100% { opacity: 1; }
              50% { opacity: 0; }
            }
          `}</style>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && !showIntro && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.9)',
          zIndex: 100001,
          fontFamily: 'monospace',
        }}>
          <div style={{ color: '#ff4400', fontSize: '24px', marginBottom: '20px' }}>
            {status}
          </div>
          <div style={{
            width: '300px',
            height: '20px',
            background: '#222',
            borderRadius: '4px',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${loadProgress}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #cc2200, #ff4400)',
              transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ color: '#666', fontSize: '12px', marginTop: '8px' }}>
            {loadProgress}%
          </div>
        </div>
      )}

      {/* Win/Lose Overlay */}
      {(gameState === 'won' || gameState === 'lost') && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.75)',
          zIndex: 100001,
          fontFamily: 'monospace',
        }}>
          <div style={{
            color: gameState === 'won' ? '#44ff44' : '#ff4444',
            fontSize: '48px',
            fontWeight: 'bold',
            marginBottom: '20px',
            textShadow: `0 0 20px ${gameState === 'won' ? '#44ff44' : '#ff4444'}`,
          }}>
            {gameState === 'won' ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'}
          </div>
          <button
            onClick={onExit}
            style={{
              background: '#333',
              color: '#fff',
              border: '1px solid #666',
              padding: '10px 30px',
              fontFamily: 'monospace',
              fontSize: '14px',
              cursor: 'pointer',
              marginTop: '20px',
            }}
          >
            Return to CLIaaS
          </button>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.95)',
          zIndex: 100002,
          fontFamily: 'monospace',
        }}>
          <div style={{ color: '#ff0000', fontSize: '24px', marginBottom: '20px' }}>
            ERROR
          </div>
          <div style={{ color: '#cc0000', fontSize: '14px', marginBottom: '30px', maxWidth: '500px', textAlign: 'center' }}>
            {error}
          </div>
          <button
            onClick={onExit}
            style={{
              background: '#333',
              color: '#fff',
              border: '1px solid #666',
              padding: '10px 30px',
              fontFamily: 'monospace',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Return to CLIaaS
          </button>
        </div>
      )}

      {/* Game Canvas */}
      <div style={{
        display: showIntro ? 'none' : 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100vw',
        height: '100vh',
        background: '#000',
      }}>
        <canvas
          ref={canvasRef}
          width={640}
          height={400}
          onContextMenu={(e) => e.preventDefault()}
          tabIndex={-1}
          style={{
            width: 'min(100vw, calc(100vh * 640 / 400))',
            height: 'min(100vh, calc(100vw * 400 / 640))',
            imageRendering: 'pixelated',
          }}
        />
      </div>
    </div>
  );
}
