'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Game, type GameState, type MissionInfo, type Difficulty,
  MISSIONS, getMissionIndex, loadProgress, saveProgress, DIFFICULTIES,
} from './engine';
import { TestRunner, type TestLogEntry } from './engine/testRunner';
import { QATestRunner, type QALogEntry, type QAReport } from './engine/qaTestRunner';
import { resolvePreset } from './engine/turbo';
import { BriefingRenderer } from './engine/briefing';

interface AntGameProps {
  onExit: () => void;
}

type Screen = 'select' | 'briefing' | 'cutscene' | 'loading' | 'playing';

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
  const [difficulty, setDifficulty] = useState<Difficulty>(() => {
    try {
      const saved = localStorage.getItem('antmissions_settings');
      if (saved) {
        const settings = JSON.parse(saved);
        return settings.difficulty ?? 'normal';
      }
    } catch { /* ignore */ }
    return 'normal';
  });
  const [fadeOpacity, setFadeOpacity] = useState(0);
  const [fadeActive, setFadeActive] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [testLog, setTestLog] = useState<TestLogEntry[]>([]);
  const testRunnerRef = useRef<TestRunner | null>(null);
  const [qaMode, setQaMode] = useState(false);
  const [qaLog, setQaLog] = useState<QALogEntry[]>([]);
  const [qaReport, setQaReport] = useState<QAReport | null>(null);
  const qaRunnerRef = useRef<QATestRunner | null>(null);
  const briefingRef = useRef<BriefingRenderer | null>(null);

  const transitionTo = useCallback((callback: () => void) => {
    setFadeActive(true);
    setFadeOpacity(1); // fade to black
    setTimeout(() => {
      callback();
      setTimeout(() => {
        setFadeOpacity(0); // fade in
        setTimeout(() => {
          setFadeActive(false);
        }, 500);
      }, 50);
    }, 400);
  }, []);

  const launchMission = useCallback(async (mission: MissionInfo) => {
    if (!canvasRef.current) return;

    // Clean up any running briefing cutscene
    if (briefingRef.current) {
      briefingRef.current.stop();
      briefingRef.current = null;
    }

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
        // Focus canvas so keyboard input (WASD/arrows) reaches the game
        canvasRef.current?.focus();
      }
      if (state === 'won') {
        const idx = getMissionIndex(mission.id);
        if (idx >= 0) saveProgress(idx);
        setUnlockedMissions(loadProgress());
      }
    };

    try {
      await game.start(mission.id, difficulty);
      // Restore saved audio settings
      try {
        const saved = localStorage.getItem('antmissions_settings');
        if (saved) {
          const settings = JSON.parse(saved);
          if (typeof settings.volume === 'number') game.audio.setVolume(settings.volume);
          if (settings.muted) game.audio.toggleMute();
        }
      } catch { /* ignore */ }
    } catch (e) {
      setError(`Failed to load mission: ${e instanceof Error ? e.message : String(e)}`);
      setScreen('select');
    }
  }, [difficulty]);

  /** Start the animated briefing cutscene before launching the mission */
  const startCutscene = useCallback((mission: MissionInfo) => {
    if (!canvasRef.current) return;

    // Clean up previous briefing if any
    if (briefingRef.current) {
      briefingRef.current.stop();
      briefingRef.current = null;
    }

    transitionTo(() => {
      setScreen('cutscene');

      const renderer = new BriefingRenderer(canvasRef.current!);
      briefingRef.current = renderer;

      renderer.onComplete = () => {
        briefingRef.current = null;
        launchMission(mission);
      };

      renderer.start(mission.id);
    });
  }, [launchMission, transitionTo]);

  const selectMission = useCallback((index: number) => {
    const mission = MISSIONS[index];
    if (!mission) return;
    setMissionIndex(index);
    setSelectedMission(mission);
    transitionTo(() => setScreen('briefing'));
  }, [transitionTo]);

  const handleNextMission = useCallback(() => {
    const nextIdx = missionIndex + 1;
    if (nextIdx < MISSIONS.length) {
      // Directly set state instead of calling selectMission (which has its own transitionTo)
      const mission = MISSIONS[nextIdx];
      transitionTo(() => {
        if (mission) {
          setMissionIndex(nextIdx);
          setSelectedMission(mission);
          setScreen('briefing');
        }
      });
    } else {
      // All missions complete — stop game and back to select
      transitionTo(() => {
        if (gameRef.current) {
          gameRef.current.stop();
          gameRef.current = null;
        }
        setScreen('select');
      });
    }
  }, [missionIndex, selectMission, transitionTo]);

  const handleRetry = useCallback(() => {
    if (selectedMission) {
      launchMission(selectedMission);
    }
  }, [selectedMission, launchMission]);

  const handleMissionSelect = useCallback(() => {
    transitionTo(() => {
      if (gameRef.current) {
        gameRef.current.stop();
        gameRef.current = null;
      }
      setScreen('select');
    });
  }, [transitionTo]);

  // Detect ?anttest= URL param and launch automated test run
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const anttest = params.get('anttest');
    if (!anttest || !canvasRef.current) return;

    // QA mode: full anomaly detection pipeline
    if (anttest === 'qa') {
      setQaMode(true);
      setScreen('playing');

      const runner = new QATestRunner(canvasRef.current);
      qaRunnerRef.current = runner;

      runner.onLog = (entry) => {
        setQaLog(prev => [...prev, entry]);
      };

      runner.runAll().then((report) => {
        setQaReport(report);
      });

      return () => {
        runner.stop();
        qaRunnerRef.current = null;
      };
    }

    // Comparison mode: start paused, fog off, expose globals for Playwright
    if (anttest === 'compare') {
      setTestMode(true);
      setScreen('playing');

      const canvas = canvasRef.current;
      const game = new Game(canvas);
      gameRef.current = game;
      game.comparisonMode = true;
      game.fogDisabled = true;

      game.onLoadProgress = (loaded, total) => {
        setLoadProgress(Math.round((loaded / total) * 100));
      };
      game.onStateChange = (s) => setStatus(s);

      const scenarioId = params.get('scenario') || 'SCA01EA';
      const difficulty = (params.get('difficulty') || 'normal') as Difficulty;

      game.start(scenarioId, difficulty).then(() => {
        // Immediately pause and disable fog
        game.pause();
        game.disableFog();

        game.step(1); // render one frame so canvas has content

        // Expose Playwright-accessible globals
        const w = window as unknown as Record<string, unknown>;
        w.__tsGame = game;
        w.__tsCompareReady = true;

        w.__tsCaptureLayer = (layer: string) => {
          return game.renderer.renderLayer(
            layer as 'terrain' | 'units' | 'buildings' | 'overlays' | 'full-no-ui',
            game.camera, game.map,
            game.entities, game.structures, game.assets,
            game.selectedIds, game.effects, game.tick,
          );
        };

        w.__tsPause = () => game.pause();
        w.__tsResume = () => game.resume();
        w.__tsStep = (n: number) => game.step(n);
        w.__tsSetCamera = (wx: number, wy: number) => game.camera.centerOn(wx, wy);
      });

      return () => {
        game.stop();
        gameRef.current = null;
      };
    }

    // Regular test mode
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
      if (briefingRef.current) {
        briefingRef.current.stop();
        briefingRef.current = null;
      }
      if (testRunnerRef.current) {
        testRunnerRef.current.stop();
        testRunnerRef.current = null;
      }
      if (qaRunnerRef.current) {
        qaRunnerRef.current.stop();
        qaRunnerRef.current = null;
      }
      if (gameRef.current) {
        gameRef.current.stop();
        gameRef.current = null;
      }
    };
  }, []);

  // Save settings to localStorage when they change
  useEffect(() => {
    try {
      const settings = { difficulty, volume: gameRef.current?.audio?.getVolume(), muted: gameRef.current?.audio?.isMuted() };
      localStorage.setItem('antmissions_settings', JSON.stringify(settings));
    } catch { /* ignore */ }
  }, [difficulty]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'F10') {
        e.preventDefault();
        if (screen === 'cutscene') {
          // Skip the animated briefing cutscene
          if (briefingRef.current) {
            briefingRef.current.skip();
            // skip() calls onComplete which triggers launchMission
          }
        } else if (screen === 'briefing') {
          setScreen('select');
        } else if (screen === 'select') {
          onExit();
        }
        // During gameplay, Escape is handled by the game engine (pause toggle)
      }
      if (screen === 'cutscene' && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        if (briefingRef.current) {
          briefingRef.current.advance();
        }
      }
      if (screen === 'select' && e.key >= '1' && e.key <= String(MISSIONS.length)) {
        const idx = parseInt(e.key) - 1;
        if (idx <= unlockedMissions) selectMission(idx);
      }
      if (screen === 'briefing' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        if (selectedMission) startCutscene(selectedMission);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [screen, unlockedMissions, selectedMission, selectMission, launchMission, startCutscene, onExit]);

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

      {/* ── QA Mode Overlay ── */}
      {qaMode && (
        <div style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 100010,
          fontFamily: 'monospace',
          fontSize: '12px',
          lineHeight: '1.5',
          background: 'rgba(0,0,0,0.80)',
          padding: '12px 16px',
          borderRadius: '4px',
          border: '1px solid #444',
          maxWidth: '550px',
          maxHeight: '80vh',
          overflowY: 'auto',
          pointerEvents: qaReport ? 'auto' : 'none',
        }}>
          <div style={{ color: '#00ccff', fontWeight: 'bold', marginBottom: '6px', fontSize: '14px' }}>
            QA Pipeline {qaReport ? (qaReport.summary.passed ? '- PASSED' : '- FAILED') : '- Running...'}
          </div>
          {qaLog.map((entry, i) => {
            let color = '#888';
            let prefix = '';
            if (entry.type === 'start') { color = '#ffaa00'; prefix = '[START] '; }
            if (entry.type === 'pass') { color = '#44ff44'; prefix = '[PASS]  '; }
            if (entry.type === 'fail') { color = '#ff4444'; prefix = '[FAIL]  '; }
            if (entry.type === 'timeout') { color = '#ff8800'; prefix = '[TIMEOUT] '; }
            if (entry.type === 'anomaly') {
              const sev = entry.anomaly?.severity;
              color = sev === 'critical' ? '#ff4444' : sev === 'warning' ? '#ffaa00' : '#888';
              prefix = `[${entry.anomaly?.id}] `;
            }
            if (entry.type === 'done') {
              color = entry.detail?.startsWith('PASSED') ? '#44ff44' : '#ff4444';
              prefix = '';
            }
            return (
              <div key={i} style={{ color, fontSize: entry.type === 'anomaly' ? '11px' : '12px' }}>
                {prefix}{entry.mission ? `${entry.mission}: ` : ''}{entry.anomaly?.message ?? entry.detail ?? ''}
              </div>
            );
          })}
          {qaReport && (
            <div style={{ marginTop: '8px', borderTop: '1px solid #333', paddingTop: '8px' }}>
              <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '4px' }}>
                Critical: {qaReport.summary.bySeverity.critical} | Warnings: {qaReport.summary.bySeverity.warning} | Info: {qaReport.summary.bySeverity.info}
              </div>
              <div style={{ color: '#aaa', fontSize: '11px', marginBottom: '8px' }}>
                Screenshots: {qaReport.screenshots.length}
              </div>
              <button
                onClick={() => {
                  const blob = new Blob([JSON.stringify(qaReport, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `qa-report-${new Date().toISOString().slice(0, 19)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                style={{
                  background: '#224466',
                  color: '#88ccff',
                  border: '1px solid #336699',
                  padding: '6px 16px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                Download Report
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Mission Select Screen ── */}
      {!testMode && !qaMode && screen === 'select' && (
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
      {!testMode && !qaMode && screen === 'briefing' && selectedMission && (
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
          onClick={() => startCutscene(selectedMission)}
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
                startCutscene(selectedMission);
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

          {/* Difficulty selector */}
          <div style={{
            display: 'flex',
            gap: '8px',
            marginTop: '20px',
            alignItems: 'center',
          }}>
            <span style={{ color: '#886633', fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase' }}>
              Difficulty:
            </span>
            {DIFFICULTIES.map(d => (
              <button
                key={d}
                onClick={(e) => { e.stopPropagation(); setDifficulty(d); }}
                style={{
                  background: d === difficulty ? (d === 'easy' ? '#224422' : d === 'hard' ? '#442222' : '#443311') : '#1a1a1a',
                  color: d === difficulty ? (d === 'easy' ? '#66ff66' : d === 'hard' ? '#ff6666' : '#ffaa44') : '#555',
                  border: `1px solid ${d === difficulty ? '#664400' : '#333'}`,
                  padding: '4px 14px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                {d}
              </button>
            ))}
          </div>

          <div style={{
            color: '#555',
            fontSize: '11px',
            marginTop: '12px',
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
      {!testMode && !qaMode && screen === 'loading' && (
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
      {!testMode && !qaMode && (gameState === 'won' || gameState === 'lost') && screen === 'playing' && (
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

          {/* Mission Stats */}
          {gameRef.current && (() => {
            const g = gameRef.current!;
            const secs = Math.floor(g.tick / 15);
            const mins = Math.floor(secs / 60);
            const s = secs % 60;
            return (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'auto auto',
                gap: '4px 20px',
                padding: '14px 24px',
                background: 'rgba(30,20,10,0.5)',
                border: '1px solid #442200',
                marginBottom: '16px',
                fontSize: '13px',
                fontFamily: 'monospace',
              }}>
                <span style={{ color: '#886633' }}>Time:</span>
                <span style={{ color: '#ddd' }}>{mins}:{s.toString().padStart(2, '0')}</span>
                <span style={{ color: '#886633' }}>Kills:</span>
                <span style={{ color: '#44ff44' }}>{g.killCount}</span>
                <span style={{ color: '#886633' }}>Losses:</span>
                <span style={{ color: '#ff6644' }}>{g.lossCount}</span>
                <span style={{ color: '#886633' }}>Built:</span>
                <span style={{ color: '#88bbff' }}>{g.structuresBuilt}</span>
                {g.structuresLost > 0 && <>
                  <span style={{ color: '#886633' }}>Destroyed:</span>
                  <span style={{ color: '#ff6644' }}>{g.structuresLost}</span>
                </>}
                <span style={{ color: '#886633' }}>Credits:</span>
                <span style={{ color: '#FFD700' }}>${g.credits}</span>
              </div>
            );
          })()}

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

      {/* ── Cutscene Click Overlay ── */}
      {!testMode && !qaMode && screen === 'cutscene' && (
        <div
          onClick={() => { if (briefingRef.current) briefingRef.current.advance(); }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            zIndex: 100000,
            cursor: 'pointer',
          }}
        />
      )}

      {/* ── Game Canvas ── */}
      <div style={{
        display: testMode || qaMode || screen === 'playing' || screen === 'loading' || screen === 'cutscene' ? 'flex' : 'none',
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
          tabIndex={0}
          style={{
            width: 'min(100vw, calc(100vh * 640 / 400))',
            height: 'min(100vh, calc(100vw * 400 / 640))',
            imageRendering: 'pixelated',
            outline: 'none',
          }}
        />
      </div>

      {/* ── Fade Transition Overlay ── */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: '#000',
        opacity: fadeOpacity,
        transition: fadeActive ? 'opacity 0.4s ease-in-out' : 'none',
        pointerEvents: fadeActive ? 'all' : 'none',
        zIndex: fadeActive ? 200000 : -1,
      }} />
    </div>
  );
}
