'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Game, type GameState, type MissionInfo,
  MISSIONS, getMissionIndex, loadProgress, saveProgress,
} from './engine';
import { TestRunner, type TestLogEntry } from './engine/testRunner';
import { resolvePreset } from './engine/turbo';

interface AntGameProps {
  onExit: () => void;
}

type Screen = 'select' | 'briefing' | 'loading' | 'playing';

export default function AntGame({ onExit }: AntGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [screen, setScreen] = useState<Screen>('select');
  const [loadProgress_, setLoadProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState>('loading');
  const [unlockedMissions, setUnlockedMissions] = useState(loadProgress);
  const [selectedMission, setSelectedMission] = useState<MissionInfo | null>(null);
  const [missionIndex, setMissionIndex] = useState(0);
  const [testMode, setTestMode] = useState(false);
  const [testLog, setTestLog] = useState<TestLogEntry[]>([]);
  const testRunnerRef = useRef<TestRunner | null>(null);

  const launchMission = useCallback(async (mission: MissionInfo) => {
    if (!canvasRef.current) return;
    setScreen('loading');
    setStatus('Loading assets...');
    setLoadProgress(0);
    setGameState('loading');

    // Stop previous game if running
    if (gameRef.current) {
      gameRef.current.stop();
      gameRef.current = null;
    }

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
        setScreen('playing');
        setStatus('');
      }
      if (state === 'won') {
        const idx = getMissionIndex(mission.id);
        if (idx >= 0) saveProgress(idx);
        setUnlockedMissions(loadProgress());
      }
    };

    try {
      await game.start(mission.id);
    } catch (e) {
      setError(`Failed to load mission: ${e instanceof Error ? e.message : String(e)}`);
      setScreen('select');
    }
  }, []);

  const selectMission = useCallback((index: number) => {
    const mission = MISSIONS[index];
    if (!mission) return;
    setMissionIndex(index);
    setSelectedMission(mission);
    setScreen('briefing');
  }, []);

  const handleNextMission = useCallback(() => {
    const nextIdx = missionIndex + 1;
    if (nextIdx < MISSIONS.length) {
      selectMission(nextIdx);
    } else {
      // All missions complete — stop game and back to select
      if (gameRef.current) {
        gameRef.current.stop();
        gameRef.current = null;
      }
      setScreen('select');
    }
  }, [missionIndex, selectMission]);

  const handleRetry = useCallback(() => {
    if (selectedMission) {
      launchMission(selectedMission);
    }
  }, [selectedMission, launchMission]);

  const handleMissionSelect = useCallback(() => {
    if (gameRef.current) {
      gameRef.current.stop();
      gameRef.current = null;
    }
    setScreen('select');
  }, []);

  // Detect ?anttest= URL param and launch automated test run
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const anttest = params.get('anttest');
    if (!anttest || !canvasRef.current) return;

    setTestMode(true);
    setScreen('playing');

    const preset = resolvePreset(anttest);
    const runner = new TestRunner(canvasRef.current, preset);
    testRunnerRef.current = runner;

    runner.onLog = (entry) => {
      setTestLog(prev => [...prev, entry]);
    };

    runner.runAll();

    return () => {
      runner.stop();
      testRunnerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (testRunnerRef.current) {
        testRunnerRef.current.stop();
        testRunnerRef.current = null;
      }
      if (gameRef.current) {
        gameRef.current.stop();
        gameRef.current = null;
      }
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'F10') {
        e.preventDefault();
        if (screen === 'briefing') {
          setScreen('select');
        } else {
          onExit();
        }
      }
      if (screen === 'select' && e.key >= '1' && e.key <= String(MISSIONS.length)) {
        const idx = parseInt(e.key) - 1;
        if (idx <= unlockedMissions) selectMission(idx);
      }
      if (screen === 'briefing' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        if (selectedMission) launchMission(selectedMission);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [screen, unlockedMissions, selectedMission, selectMission, launchMission, onExit]);

  // Handle canvas resize
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const observer = new ResizeObserver(() => {
      gameRef.current?.input.updateScale();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const allComplete = unlockedMissions >= MISSIONS.length;

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
      {/* ── Test Mode Overlay ── */}
      {testMode && testLog.length > 0 && (
        <div style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 100010,
          fontFamily: 'monospace',
          fontSize: '13px',
          lineHeight: '1.6',
          background: 'rgba(0,0,0,0.75)',
          padding: '12px 16px',
          borderRadius: '4px',
          border: '1px solid #333',
          maxWidth: '500px',
          pointerEvents: 'none',
        }}>
          <div style={{ color: '#44ff44', fontWeight: 'bold', marginBottom: '6px' }}>
            E2E Ant Mission Test
          </div>
          {testLog.map((entry, i) => {
            let color = '#888';
            let prefix = '';
            if (entry.type === 'start') { color = '#ffaa00'; prefix = '[START] '; }
            if (entry.type === 'pass') { color = '#44ff44'; prefix = '[PASS]  '; }
            if (entry.type === 'fail') { color = '#ff4444'; prefix = '[FAIL]  '; }
            if (entry.type === 'timeout') { color = '#ff8800'; prefix = '[TIMEOUT] '; }
            if (entry.type === 'done') { color = entry.detail?.startsWith('ALL') ? '#44ff44' : '#ff4444'; prefix = ''; }
            return (
              <div key={i} style={{ color }}>
                {prefix}{entry.mission ? `${entry.mission}: ` : ''}{entry.detail || entry.mission || ''}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Mission Select Screen ── */}
      {!testMode && screen === 'select' && (
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
        }}>
          <div style={{
            fontSize: '80px',
            marginBottom: '10px',
            filter: 'drop-shadow(0 0 20px #ff4400) drop-shadow(0 0 40px #cc2200)',
            animation: 'pulse 2s ease-in-out infinite',
          }}>
            {allComplete ? '\u{1F3C6}' : '\u{1F41C}'}
          </div>

          <h1 style={{
            color: '#ff4400',
            fontSize: '36px',
            fontWeight: 'bold',
            textShadow: '0 0 20px #ff4400, 0 0 40px #cc2200',
            letterSpacing: '3px',
            marginBottom: '4px',
            textAlign: 'center',
          }}>
            IT CAME FROM RED ALERT!
          </h1>
          <h2 style={{
            color: '#cc3300',
            fontSize: '16px',
            fontWeight: 'bold',
            letterSpacing: '4px',
            marginBottom: '30px',
            textTransform: 'uppercase',
          }}>
            The Giant Ant Missions
          </h2>

          {/* Mission List */}
          <div style={{ width: '100%', maxWidth: '500px' }}>
            {MISSIONS.map((m, i) => {
              const unlocked = i <= unlockedMissions;
              const completed = i < unlockedMissions;
              return (
                <button
                  key={m.id}
                  onClick={() => unlocked && selectMission(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    width: '100%',
                    padding: '12px 16px',
                    marginBottom: '8px',
                    background: unlocked ? 'rgba(255,68,0,0.08)' : 'rgba(40,40,40,0.3)',
                    border: `1px solid ${unlocked ? '#553300' : '#222'}`,
                    color: unlocked ? '#eee' : '#555',
                    fontFamily: 'monospace',
                    fontSize: '14px',
                    cursor: unlocked ? 'pointer' : 'not-allowed',
                    textAlign: 'left',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (unlocked) (e.target as HTMLElement).style.background = 'rgba(255,68,0,0.18)';
                  }}
                  onMouseLeave={(e) => {
                    if (unlocked) (e.target as HTMLElement).style.background = 'rgba(255,68,0,0.08)';
                  }}
                >
                  <span style={{
                    fontSize: '18px',
                    color: completed ? '#44ff44' : unlocked ? '#ff4400' : '#444',
                    minWidth: '24px',
                    textAlign: 'center',
                  }}>
                    {completed ? '\u2713' : unlocked ? `${i + 1}` : '\u{1F512}'}
                  </span>
                  <div>
                    <div style={{
                      fontWeight: 'bold',
                      color: unlocked ? '#ff6633' : '#555',
                    }}>
                      Mission {i + 1}: {m.title}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: unlocked ? '#888' : '#444',
                      marginTop: '2px',
                    }}>
                      {unlocked ? m.objective : 'Complete previous mission to unlock'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {allComplete && (
            <div style={{
              color: '#44ff44',
              fontSize: '14px',
              marginTop: '16px',
              textShadow: '0 0 10px #44ff44',
            }}>
              All missions completed! Select any mission to replay.
            </div>
          )}

          <div style={{
            display: 'flex',
            gap: '20px',
            marginTop: '24px',
            alignItems: 'center',
          }}>
            <button
              onClick={onExit}
              style={{
                background: '#222',
                color: '#888',
                border: '1px solid #444',
                padding: '8px 24px',
                fontFamily: 'monospace',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Return to CLIaaS
            </button>
            <span style={{ color: '#444', fontSize: '11px' }}>
              Press 1-4 to select | F10 to exit
            </span>
          </div>

          <div style={{
            position: 'absolute',
            bottom: '16px',
            color: '#333',
            fontSize: '10px',
            textAlign: 'center',
          }}>
            A CLIaaS Easter Egg | Based on C&amp;C Red Alert Counterstrike
          </div>

          <style>{`
            @keyframes pulse {
              0%, 100% { transform: scale(1); }
              50% { transform: scale(1.06); }
            }
          `}</style>
        </div>
      )}

      {/* ── Mission Briefing Screen ── */}
      {!testMode && screen === 'briefing' && selectedMission && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(ellipse at center, #0a0a00 0%, #000000 70%)',
            zIndex: 100000,
            fontFamily: 'monospace',
            cursor: 'pointer',
          }}
          onClick={() => launchMission(selectedMission)}
        >
          <div style={{
            color: '#ff4400',
            fontSize: '12px',
            letterSpacing: '6px',
            textTransform: 'uppercase',
            marginBottom: '8px',
          }}>
            Mission Briefing
          </div>

          <h1 style={{
            color: '#ff6633',
            fontSize: '32px',
            fontWeight: 'bold',
            textShadow: '0 0 15px rgba(255,68,0,0.5)',
            letterSpacing: '2px',
            marginBottom: '6px',
          }}>
            {selectedMission.title}
          </h1>

          <div style={{
            color: '#cc3300',
            fontSize: '13px',
            letterSpacing: '2px',
            marginBottom: '30px',
          }}>
            Mission {missionIndex + 1} of {MISSIONS.length}
          </div>

          <div style={{
            maxWidth: '550px',
            padding: '24px 28px',
            background: 'rgba(40,25,10,0.4)',
            border: '1px solid #442200',
            marginBottom: '24px',
          }}>
            <div style={{
              color: '#ccaa88',
              fontSize: '14px',
              lineHeight: '1.8',
              marginBottom: '16px',
            }}>
              {selectedMission.briefing}
            </div>
            <div style={{
              borderTop: '1px solid #332211',
              paddingTop: '12px',
            }}>
              <span style={{ color: '#886633', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase' }}>
                Objective:
              </span>
              <span style={{ color: '#ffaa44', fontSize: '13px', marginLeft: '8px' }}>
                {selectedMission.objective}
              </span>
            </div>
          </div>

          <div style={{
            display: 'flex',
            gap: '16px',
            alignItems: 'center',
          }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setScreen('select');
              }}
              style={{
                background: '#222',
                color: '#888',
                border: '1px solid #444',
                padding: '10px 20px',
                fontFamily: 'monospace',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Back
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                launchMission(selectedMission);
              }}
              style={{
                background: '#441100',
                color: '#ff6633',
                border: '1px solid #663300',
                padding: '10px 32px',
                fontFamily: 'monospace',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer',
                letterSpacing: '2px',
                animation: 'glow 2s ease-in-out infinite',
              }}
            >
              LAUNCH MISSION
            </button>
          </div>

          <div style={{
            color: '#555',
            fontSize: '11px',
            marginTop: '16px',
          }}>
            Press ENTER to launch | ESC to go back
          </div>

          <style>{`
            @keyframes glow {
              0%, 100% { box-shadow: 0 0 8px rgba(255,68,0,0.3); }
              50% { box-shadow: 0 0 20px rgba(255,68,0,0.6); }
            }
          `}</style>
        </div>
      )}

      {/* ── Loading Overlay ── */}
      {!testMode && screen === 'loading' && (
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
              width: `${loadProgress_}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #cc2200, #ff4400)',
              transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ color: '#666', fontSize: '12px', marginTop: '8px' }}>
            {loadProgress_}%
          </div>
        </div>
      )}

      {/* ── Win/Lose Overlay ── */}
      {!testMode && (gameState === 'won' || gameState === 'lost') && screen === 'playing' && (
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
            marginBottom: '12px',
            textShadow: `0 0 20px ${gameState === 'won' ? '#44ff44' : '#ff4444'}`,
          }}>
            {gameState === 'won' ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'}
          </div>

          {gameState === 'won' && missionIndex + 1 >= MISSIONS.length && (
            <div style={{
              color: '#ffaa44',
              fontSize: '16px',
              marginBottom: '20px',
              textShadow: '0 0 10px #ffaa44',
            }}>
              All ant missions complete! The threat has been neutralized.
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
            {gameState === 'won' && missionIndex + 1 < MISSIONS.length && (
              <button
                onClick={handleNextMission}
                style={{
                  background: '#224400',
                  color: '#44ff44',
                  border: '1px solid #336600',
                  padding: '10px 30px',
                  fontFamily: 'monospace',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  letterSpacing: '1px',
                }}
              >
                Next Mission
              </button>
            )}
            <button
              onClick={handleRetry}
              style={{
                background: '#333',
                color: '#fff',
                border: '1px solid #666',
                padding: '10px 24px',
                fontFamily: 'monospace',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              {gameState === 'lost' ? 'Retry' : 'Replay'}
            </button>
            <button
              onClick={handleMissionSelect}
              style={{
                background: '#222',
                color: '#aaa',
                border: '1px solid #444',
                padding: '10px 24px',
                fontFamily: 'monospace',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Mission Select
            </button>
            <button
              onClick={onExit}
              style={{
                background: '#222',
                color: '#888',
                border: '1px solid #444',
                padding: '10px 24px',
                fontFamily: 'monospace',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Exit
            </button>
          </div>
        </div>
      )}

      {/* ── Error Overlay ── */}
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
            onClick={() => { setError(null); setScreen('select'); }}
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
            Back to Mission Select
          </button>
        </div>
      )}

      {/* ── Game Canvas ── */}
      <div style={{
        display: testMode || screen === 'playing' || screen === 'loading' ? 'flex' : 'none',
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
