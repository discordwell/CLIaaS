'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface AntGameProps {
  onExit: () => void;
}

type EmscriptenModule = {
  canvas: HTMLCanvasElement;
  print: (...args: string[]) => void;
  printErr: (...args: string[]) => void;
  setStatus: (text: string) => void;
  totalDependencies: number;
  monitorRunDependencies: (left: number) => void;
  onRuntimeInitialized: () => void;
  locateFile: (path: string) => string;
  preRun: (() => void)[];
  noInitialRun: boolean;
  arguments: string[];
  [key: string]: unknown;
};

declare global {
  interface Window {
    Module: EmscriptenModule;
  }
}

export default function AntGame({ onExit }: AntGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('Initializing...');
  const [showIntro, setShowIntro] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const gameStarted = useRef(false);
  const scriptsLoaded = useRef(false);

  const startGame = useCallback(async () => {
    if (gameStarted.current || !canvasRef.current) return;
    gameStarted.current = true;
    setShowIntro(false);
    setLoading(true);
    setStatus('Loading Red Alert...');

    const canvas = canvasRef.current;

    // Set up the Emscripten Module
    const mod: EmscriptenModule = {
      canvas,
      print: (...args: string[]) => console.log('[RA]', ...args),
      printErr: (...args: string[]) => console.warn('[RA]', ...args),
      setStatus: (text: string) => {
        if (!text) {
          setLoading(false);
          setStatus('');
          return;
        }
        // Parse progress from Emscripten status messages like "Downloading... (5/10)"
        const match = text.match(/\((\d+(?:\.\d+)?)\/(\d+)\)/);
        if (match) {
          const current = parseFloat(match[1]);
          const total = parseFloat(match[2]);
          setLoadProgress(Math.round((current / total) * 100));
        }
        setStatus(text);
      },
      totalDependencies: 0,
      monitorRunDependencies: function (left: number) {
        this.totalDependencies = Math.max(this.totalDependencies, left);
        if (left === 0) {
          setLoading(false);
          setStatus('');
        } else {
          const done = this.totalDependencies - left;
          setStatus(`Preparing... (${done}/${this.totalDependencies})`);
          setLoadProgress(Math.round((done / this.totalDependencies) * 100));
        }
      },
      onRuntimeInitialized: () => {
        setStatus('Red Alert initialized!');
        setLoading(false);
      },
      locateFile: (path: string) => `/ra/${path}`,
      preRun: [],
      noInitialRun: false,
      arguments: [],
    };

    window.Module = mod;

    try {
      // Load the gamedata.js first (sets up preloaded filesystem)
      await loadScript('/ra/gamedata.js');
      // Then load the main WASM application
      await loadScript('/ra/rasdl.js');
      scriptsLoaded.current = true;
    } catch (e) {
      setError(`Failed to load game: ${e instanceof Error ? e.message : String(e)}`);
      setLoading(false);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clean up global Module
      if (window.Module) {
        delete (window as unknown as Record<string, unknown>).Module;
      }
      // Remove injected scripts
      document.querySelectorAll('script[data-ra-game]').forEach(s => s.remove());
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

  // Handle ESC to exit during gameplay
  useEffect(() => {
    if (showIntro || !scriptsLoaded.current) return;
    const handleKey = (e: KeyboardEvent) => {
      // Double-tap ESC to exit (single ESC is used by the game)
      if (e.key === 'F10') {
        onExit();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showIntro, onExit]);

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
            COMMAND &amp; CONQUER
          </h1>
          <h2 style={{
            color: '#cc3300',
            fontSize: '32px',
            fontWeight: 'bold',
            letterSpacing: '6px',
            marginBottom: '8px',
            textTransform: 'uppercase',
          }}>
            RED ALERT
          </h2>
          <h3 style={{
            color: '#ffaa44',
            fontSize: '18px',
            fontWeight: 'normal',
            letterSpacing: '8px',
            marginBottom: '40px',
            textTransform: 'uppercase',
          }}>
            Native WebAssembly Port
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
              The full original Red Alert, compiled from C++ source to
              WebAssembly and running natively in your browser.
            </p>
            <p style={{ color: '#aaaaaa', marginBottom: '8px' }}>
              Game data will be downloaded on launch (~26MB).
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
            A CLIaaS Easter Egg | Freeware release by Electronic Arts
            <br />
            Source: Daft-Freak/CnC_and_Red_Alert (GPL v3) | Compiled with Emscripten
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
      <canvas
        ref={canvasRef}
        id="canvas"
        onContextMenu={(e) => e.preventDefault()}
        tabIndex={-1}
        style={{
          display: showIntro ? 'none' : 'block',
          width: '100%',
          height: '100%',
          background: '#000',
        }}
      />
    </div>
  );
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.setAttribute('data-ra-game', 'true');
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}
