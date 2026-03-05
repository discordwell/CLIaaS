'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Game, type GameState, type MissionInfo, type Difficulty,
  MISSIONS, getMissionIndex, loadProgress, saveProgress, DIFFICULTIES,
  CAMPAIGNS, getCampaign, loadCampaignProgress, saveCampaignProgress, checkMissionExists,
  loadMissionBriefings, getMissionBriefing,
  type CampaignId, type CampaignDef, type CampaignMission,
  getMissionMovies, hasFMV, MoviePlayer, CAMPAIGN_END_MOVIES,
} from './engine';
import { TestRunner, type TestLogEntry } from './engine/testRunner';
import { QATestRunner, type QALogEntry, type QAReport } from './engine/qaTestRunner';
import { resolvePreset } from './engine/turbo';
import { BriefingRenderer } from './engine/briefing';

interface AntGameProps {
  onExit: () => void;
}

type Screen = 'main_menu' | 'select' | 'briefing' | 'cutscene' | 'loading' | 'playing'
  | 'faction_select' | 'campaign_select'
  | 'fmv_intro' | 'fmv_briefing' | 'fmv_action' | 'objectives_interstitial'
  | 'fmv_win' | 'fmv_lose' | 'fmv_campaign_end';

export default function AntGame({ onExit }: AntGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [screen, setScreen] = useState<Screen>('main_menu');
  const [loadProgress_, setLoadProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState>('loading');
  const [unlockedMissions, setUnlockedMissions] = useState(loadProgress);
  const [selectedMission, setSelectedMission] = useState<MissionInfo | null>(null);
  const [missionIndex, setMissionIndex] = useState(0);
  // Campaign state
  const [activeCampaign, setActiveCampaign] = useState<CampaignDef | null>(null);
  const [campaignType, setCampaignType] = useState<'allied' | 'soviet' | 'counterstrike_allied' | 'counterstrike_soviet' | null>(null);
  const [campaignMissionIndex, setCampaignMissionIndex] = useState(0);
  const [campaignUnlocked, setCampaignUnlocked] = useState(0);
  const [pendingFaction, setPendingFaction] = useState<'allied' | 'soviet' | 'counterstrike_allied' | 'counterstrike_soviet' | null>(null);
  const [availableMissions, setAvailableMissions] = useState<boolean[]>([]);
  const [briefingsLoaded, setBriefingsLoaded] = useState(false);
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
  const moviePlayerRef = useRef<MoviePlayer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  /** Check if current campaign mission is the final one */
  const isFinalCampaignMission = useCallback(() =>
    !!activeCampaign && campaignMissionIndex + 1 >= activeCampaign.missions.length,
  [activeCampaign, campaignMissionIndex]);

  /** Get faction of current campaign ('allied' or 'soviet') */
  const getCampaignFaction = useCallback((): string | null => {
    if (!activeCampaign?.missions[0]) return null;
    return activeCampaign.missions[0].id.startsWith('SCG') ? 'allied' : 'soviet';
  }, [activeCampaign]);

  /** Play a post-mission FMV (win, lose, or campaign ending) */
  const playPostMissionFMV = useCallback((movieName: string, screenState: Screen, _missionId: string) => {
    if (!containerRef.current) return;

    // Clean up previous player
    if (moviePlayerRef.current) {
      moviePlayerRef.current.destroy();
      moviePlayerRef.current = null;
    }

    const player = new MoviePlayer(containerRef.current);
    moviePlayerRef.current = player;

    player.onComplete = () => {
      moviePlayerRef.current?.destroy();
      moviePlayerRef.current = null;
      // After win FMV, check for campaign ending
      if (screenState === 'fmv_win' && isFinalCampaignMission()) {
        const faction = getCampaignFaction();
        const endMovie = faction ? CAMPAIGN_END_MOVIES[faction] : undefined;
        if (endMovie && containerRef.current) {
          playPostMissionFMV(endMovie, 'fmv_campaign_end', _missionId);
          return;
        }
      }
      setScreen('playing'); // show win/lose overlay
    };
    player.onError = () => {
      moviePlayerRef.current?.destroy();
      moviePlayerRef.current = null;
      // Same campaign-end check on error (skip broken video)
      if (screenState === 'fmv_win' && isFinalCampaignMission()) {
        const faction = getCampaignFaction();
        const endMovie = faction ? CAMPAIGN_END_MOVIES[faction] : undefined;
        if (endMovie && containerRef.current) {
          playPostMissionFMV(endMovie, 'fmv_campaign_end', _missionId);
          return;
        }
      }
      setScreen('playing');
    };

    setScreen(screenState);
    player.play(movieName);
  }, [isFinalCampaignMission, getCampaignFaction]);

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
        // Ant mission progress
        const idx = getMissionIndex(mission.id);
        if (idx >= 0) saveProgress(idx);
        setUnlockedMissions(loadProgress());
        // Campaign progress
        if (activeCampaign) {
          saveCampaignProgress(activeCampaign.id, campaignMissionIndex);
          setCampaignUnlocked(loadCampaignProgress(activeCampaign.id));
        }
        // Post-mission win FMV
        const movies = getMissionMovies(mission.id);
        if (movies?.win && containerRef.current) {
          playPostMissionFMV(movies.win, 'fmv_win', mission.id);
          return;
        }
        // No win video — check campaign ending
        if (isFinalCampaignMission()) {
          const faction = getCampaignFaction();
          const endMovie = faction ? CAMPAIGN_END_MOVIES[faction] : undefined;
          if (endMovie && containerRef.current) {
            playPostMissionFMV(endMovie, 'fmv_campaign_end', mission.id);
            return;
          }
        }
      }
      if (state === 'lost') {
        // Post-mission lose FMV
        const movies = getMissionMovies(mission.id);
        if (movies?.lose && containerRef.current) {
          playPostMissionFMV(movies.lose, 'fmv_lose', mission.id);
          return;
        }
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
      setScreen(activeCampaign ? 'campaign_select' : 'select');
    }
  }, [difficulty, activeCampaign, campaignMissionIndex, playPostMissionFMV, isFinalCampaignMission, getCampaignFaction]);

  /** Helper: play an FMV and call onDone when complete (or fallback to procedural) */
  const playFMV = useCallback((movieName: string, screenState: Screen, _mission: MissionInfo, onDone: () => void) => {
    if (!containerRef.current) { onDone(); return; }

    // Reuse preloaded player or create new one
    let player = moviePlayerRef.current;
    if (!player && containerRef.current) {
      player = new MoviePlayer(containerRef.current);
      moviePlayerRef.current = player;
    }
    if (!player) { onDone(); return; }

    player.onComplete = () => onDone();
    player.onError = () => {
      moviePlayerRef.current?.destroy();
      moviePlayerRef.current = null;
      onDone(); // skip on error
    };
    setScreen(screenState);
    player.play(movieName);
  }, []);

  /** Start the animated briefing cutscene before launching the mission.
   *  Flow: Intro → Brief → Objectives → Action → gameplay
   *  Any missing step is skipped. */
  const startCutscene = useCallback((mission: MissionInfo) => {
    if (!canvasRef.current) return;

    // Clean up previous briefing if any
    if (briefingRef.current) {
      briefingRef.current.stop();
      briefingRef.current = null;
    }

    const movies = getMissionMovies(mission.id);

    /** After intro (or if no intro), try to play brief */
    const afterIntro = () => {
      if (movies?.brief && containerRef.current) {
        // After intro, create fresh player for brief video
        if (moviePlayerRef.current) {
          moviePlayerRef.current.destroy();
          moviePlayerRef.current = null;
        }
        const player = new MoviePlayer(containerRef.current);
        moviePlayerRef.current = player;

        player.onComplete = () => {
          setScreen('objectives_interstitial');
        };
        player.onError = () => {
          // Fallback to procedural briefing
          moviePlayerRef.current?.destroy();
          moviePlayerRef.current = null;
          goToObjectivesOrProcedural();
        };

        setScreen('fmv_briefing');
        player.play(movies.brief!);
      } else if (movies?.intro || movies?.action) {
        // Has intro but no brief (LANDCOM missions, ant missions) — go to objectives
        setScreen('objectives_interstitial');
      } else {
        // No FMV at all — procedural briefing
        goToObjectivesOrProcedural();
      }
    };

    /** Fallback to procedural briefing renderer */
    const goToObjectivesOrProcedural = () => {
      setScreen('cutscene');
      const renderer = new BriefingRenderer(canvasRef.current!);
      briefingRef.current = renderer;
      renderer.onComplete = () => {
        briefingRef.current = null;
        launchMission(mission);
      };
      renderer.start(mission.id, mission.briefing);
    };

    // Start the chain: Intro → Brief → Objectives → Action → gameplay
    if (movies?.intro && containerRef.current) {
      transitionTo(() => {
        playFMV(movies.intro!, 'fmv_intro', mission, afterIntro);
      });
    } else if (movies?.brief && containerRef.current) {
      transitionTo(() => afterIntro());
    } else {
      // No FMV — procedural path
      transitionTo(() => goToObjectivesOrProcedural());
    }
  }, [launchMission, transitionTo, playFMV]);

  /** Continue from objectives interstitial → play Action FMV or launch directly */
  const continueFromObjectives = useCallback(() => {
    if (!selectedMission) return;
    const movies = getMissionMovies(selectedMission.id);

    if (movies?.action && containerRef.current) {
      // Clean up previous player
      if (moviePlayerRef.current) {
        moviePlayerRef.current.destroy();
        moviePlayerRef.current = null;
      }

      const player = new MoviePlayer(containerRef.current);
      moviePlayerRef.current = player;

      player.onComplete = () => {
        moviePlayerRef.current?.destroy();
        moviePlayerRef.current = null;
        launchMission(selectedMission);
      };
      player.onError = () => {
        // Skip action video on error, just launch
        moviePlayerRef.current?.destroy();
        moviePlayerRef.current = null;
        launchMission(selectedMission);
      };

      setScreen('fmv_action');
      player.play(movies.action);
    } else {
      // No action movie — launch directly
      if (moviePlayerRef.current) {
        moviePlayerRef.current.destroy();
        moviePlayerRef.current = null;
      }
      launchMission(selectedMission);
    }
  }, [selectedMission, launchMission]);

  const selectMission = useCallback((index: number) => {
    const mission = MISSIONS[index];
    if (!mission) return;
    setMissionIndex(index);
    setSelectedMission(mission);
    setActiveCampaign(null); // ant missions are not campaigns

    // Preload first FMV video (intro or brief) while user reads the briefing screen
    const movies = getMissionMovies(mission.id);
    const firstMovie = movies?.intro || movies?.brief;
    if (firstMovie && containerRef.current) {
      if (moviePlayerRef.current) {
        moviePlayerRef.current.destroy();
      }
      const player = new MoviePlayer(containerRef.current);
      player.preload(firstMovie);
      moviePlayerRef.current = player;
    }

    transitionTo(() => setScreen('briefing'));
  }, [transitionTo]);

  /** Select a campaign mission and go to briefing */
  const selectCampaignMission = useCallback((campaign: CampaignDef, index: number) => {
    const cm = campaign.missions[index];
    if (!cm) return;
    setCampaignMissionIndex(index);
    setActiveCampaign(campaign);
    // Use real briefing from mission.ini if available
    const realBriefing = getMissionBriefing(cm.id);
    const missionInfo: MissionInfo = {
      id: cm.id,
      title: cm.title,
      briefing: realBriefing || cm.briefing,
      objective: cm.objective,
    };
    setSelectedMission(missionInfo);

    // Preload first FMV video (intro or brief) while user reads the briefing screen
    const movies = getMissionMovies(cm.id);
    const firstMovie = movies?.intro || movies?.brief;
    if (firstMovie && containerRef.current) {
      if (moviePlayerRef.current) {
        moviePlayerRef.current.destroy();
      }
      const player = new MoviePlayer(containerRef.current);
      player.preload(firstMovie);
      moviePlayerRef.current = player;
    }

    transitionTo(() => setScreen('briefing'));
  }, [transitionTo]);

  const handleNextMission = useCallback(() => {
    if (activeCampaign) {
      // Campaign mode: advance to next campaign mission
      const nextIdx = campaignMissionIndex + 1;
      if (nextIdx < activeCampaign.missions.length) {
        const cm = activeCampaign.missions[nextIdx];
        transitionTo(() => {
          setCampaignMissionIndex(nextIdx);
          const realBriefing = getMissionBriefing(cm.id);
          const missionInfo: MissionInfo = {
            id: cm.id,
            title: cm.title,
            briefing: realBriefing || cm.briefing,
            objective: cm.objective,
          };
          setSelectedMission(missionInfo);
          setScreen('briefing');
        });
      } else {
        // All campaign missions complete
        transitionTo(() => {
          if (gameRef.current) {
            gameRef.current.stop();
            gameRef.current = null;
          }
          setScreen('campaign_select');
        });
      }
    } else {
      // Ant mission mode
      const nextIdx = missionIndex + 1;
      if (nextIdx < MISSIONS.length) {
        const mission = MISSIONS[nextIdx];
        transitionTo(() => {
          if (mission) {
            setMissionIndex(nextIdx);
            setSelectedMission(mission);
            setScreen('briefing');
          }
        });
      } else {
        transitionTo(() => {
          if (gameRef.current) {
            gameRef.current.stop();
            gameRef.current = null;
          }
          setScreen('select');
        });
      }
    }
  }, [missionIndex, activeCampaign, campaignMissionIndex, transitionTo]);

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
      setScreen(activeCampaign ? 'campaign_select' : 'select');
    });
  }, [transitionTo, activeCampaign]);

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

    // Agent mode: pause-step harness for Claude Code AI player
    if (anttest === 'agent') {
      setTestMode(true);
      setScreen('playing');

      const canvas = canvasRef.current;
      const game = new Game(canvas);
      gameRef.current = game;
      game.fogDisabled = true;

      game.onLoadProgress = (loaded, total) => {
        setLoadProgress(Math.round((loaded / total) * 100));
      };
      game.onStateChange = (s) => setStatus(s);

      const scenarioId = params.get('scenario') || 'SCA01EA';
      const diff = (params.get('difficulty') || 'normal') as Difficulty;

      import('./engine/agentHarness').then(({ installHarness }) => {
        game.start(scenarioId, diff).then(() => {
          game.pause();
          game.disableFog();
          game.step(1);
          installHarness(game);
        }).catch((err) => {
          console.error('Agent harness: game start failed', err);
          setError(String(err));
        });
      });

      return () => {
        game.stop();
        gameRef.current = null;
        const w = window as unknown as Record<string, unknown>;
        delete w.__agentReady;
        delete w.__agentState;
        delete w.__agentCommand;
        delete w.__agentStep;
      };
    }

    // Play mode: direct launch into a scenario with no test overlay
    if (anttest === 'play') {
      setScreen('playing');

      const canvas = canvasRef.current;
      const game = new Game(canvas);
      gameRef.current = game;

      game.onLoadProgress = (loaded, total) => {
        setLoadProgress(Math.round((loaded / total) * 100));
      };
      game.onStateChange = (s) => {
        setStatus(s);
        setGameState(s);
        if (s === 'playing') canvasRef.current?.focus();
      };

      const scenarioId = params.get('scenario') || 'SCA01EA';
      const diff = (params.get('difficulty') || 'normal') as Difficulty;

      game.start(scenarioId, diff).catch((err) => {
        console.error('Play mode: game start failed', err);
        setError(String(err));
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

  // Load mission briefings from mission.ini on mount
  useEffect(() => {
    loadMissionBriefings().then(() => setBriefingsLoaded(true));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (briefingRef.current) {
        briefingRef.current.stop();
        briefingRef.current = null;
      }
      if (moviePlayerRef.current) {
        moviePlayerRef.current.destroy();
        moviePlayerRef.current = null;
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
        if (screen === 'fmv_intro' || screen === 'fmv_briefing' || screen === 'fmv_action') {
          if (moviePlayerRef.current) {
            moviePlayerRef.current.skip();
          }
        } else if (screen === 'fmv_win' || screen === 'fmv_lose' || screen === 'fmv_campaign_end') {
          // Skip post-mission FMV → show win/lose overlay
          if (moviePlayerRef.current) {
            moviePlayerRef.current.skip();
          }
        } else if (screen === 'objectives_interstitial') {
          // Escape on objectives → skip action video, launch directly
          if (moviePlayerRef.current) {
            moviePlayerRef.current.destroy();
            moviePlayerRef.current = null;
          }
          if (selectedMission) launchMission(selectedMission);
        } else if (screen === 'cutscene') {
          if (briefingRef.current) {
            briefingRef.current.skip();
          }
        } else if (screen === 'briefing') {
          setScreen(activeCampaign ? 'campaign_select' : 'select');
        } else if (screen === 'campaign_select') {
          setScreen('main_menu');
          setActiveCampaign(null);
        } else if (screen === 'faction_select') {
          setScreen('main_menu');
        } else if (screen === 'select') {
          setScreen('main_menu');
        } else if (screen === 'main_menu') {
          onExit();
        }
      }
      // FMV screens: Space/Enter to skip
      if ((screen === 'fmv_intro' || screen === 'fmv_briefing' || screen === 'fmv_action'
        || screen === 'fmv_win' || screen === 'fmv_lose' || screen === 'fmv_campaign_end')
        && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        if (moviePlayerRef.current) {
          moviePlayerRef.current.skip();
        }
      }
      // Objectives interstitial: Space/Enter to continue
      if (screen === 'objectives_interstitial' && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        continueFromObjectives();
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
        if (selectedMission) {
          startCutscene(selectedMission);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [screen, unlockedMissions, selectedMission, selectMission, launchMission, startCutscene, continueFromObjectives, onExit, activeCampaign, campaignMissionIndex]);

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
    <div ref={containerRef} style={{
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

      {/* ── Main Menu Screen ── */}
      {!testMode && !qaMode && screen === 'main_menu' && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'radial-gradient(ellipse at center, #0a0808 0%, #000000 70%)',
          zIndex: 100000, fontFamily: 'monospace',
        }}>
          <h1 style={{
            color: '#cc0000',
            fontSize: '42px',
            fontWeight: 'bold',
            textShadow: '0 0 20px #cc0000, 0 0 40px #880000',
            letterSpacing: '4px',
            marginBottom: '6px',
            textAlign: 'center',
          }}>
            RED ALERT
          </h1>
          <h2 style={{
            color: '#882200',
            fontSize: '14px',
            fontWeight: 'bold',
            letterSpacing: '6px',
            textTransform: 'uppercase',
            marginBottom: '40px',
          }}>
            Mission Select
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '340px' }}>
            {/* Ant Missions */}
            <button
              onClick={() => transitionTo(() => setScreen('select'))}
              style={{
                background: 'rgba(255,68,0,0.08)',
                border: '1px solid #553300',
                color: '#ff6633',
                padding: '14px 20px',
                fontFamily: 'monospace',
                fontSize: '15px',
                fontWeight: 'bold',
                cursor: 'pointer',
                letterSpacing: '2px',
                textAlign: 'left',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,68,0,0.18)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,68,0,0.08)'; }}
            >
              ANT MISSIONS
              <div style={{ fontSize: '10px', color: '#886633', fontWeight: 'normal', marginTop: '2px', letterSpacing: '1px' }}>
                It Came From Red Alert!
              </div>
            </button>

            {/* Original Campaign */}
            <button
              onClick={() => {
                setPendingFaction(null);
                setCampaignType(null);
                transitionTo(() => setScreen('faction_select'));
              }}
              style={{
                background: 'rgba(100,0,0,0.08)',
                border: '1px solid #442222',
                color: '#cc4444',
                padding: '14px 20px',
                fontFamily: 'monospace',
                fontSize: '15px',
                fontWeight: 'bold',
                cursor: 'pointer',
                letterSpacing: '2px',
                textAlign: 'left',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(100,0,0,0.18)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(100,0,0,0.08)'; }}
            >
              ORIGINAL CAMPAIGN
              <div style={{ fontSize: '10px', color: '#664444', fontWeight: 'normal', marginTop: '2px', letterSpacing: '1px' }}>
                14 missions per faction
              </div>
            </button>

            {/* Counterstrike */}
            <button
              onClick={() => {
                setPendingFaction(null);
                setCampaignType('counterstrike_allied');
                transitionTo(() => setScreen('faction_select'));
              }}
              style={{
                background: 'rgba(0,50,100,0.08)',
                border: '1px solid #223344',
                color: '#6688aa',
                padding: '14px 20px',
                fontFamily: 'monospace',
                fontSize: '15px',
                fontWeight: 'bold',
                cursor: 'pointer',
                letterSpacing: '2px',
                textAlign: 'left',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,50,100,0.18)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,50,100,0.08)'; }}
            >
              COUNTERSTRIKE
              <div style={{ fontSize: '10px', color: '#445566', fontWeight: 'normal', marginTop: '2px', letterSpacing: '1px' }}>
                Expansion pack missions
              </div>
            </button>
          </div>

          <div style={{ display: 'flex', gap: '20px', marginTop: '30px', alignItems: 'center' }}>
            <button
              onClick={onExit}
              style={{
                background: '#222', color: '#888', border: '1px solid #444',
                padding: '8px 24px', fontFamily: 'monospace', fontSize: '12px', cursor: 'pointer',
              }}
            >
              Return to CLIaaS
            </button>
            <span style={{ color: '#444', fontSize: '11px' }}>F10 to exit</span>
          </div>

          <div style={{
            position: 'absolute', bottom: '16px',
            color: '#333', fontSize: '10px', textAlign: 'center',
          }}>
            A CLIaaS Easter Egg | C&amp;C Red Alert Engine
          </div>
        </div>
      )}

      {/* ── Faction Select Screen ── */}
      {!testMode && !qaMode && screen === 'faction_select' && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'radial-gradient(ellipse at center, #0a0808 0%, #000000 70%)',
          zIndex: 100000, fontFamily: 'monospace',
        }}>
          <h2 style={{
            color: '#888',
            fontSize: '14px',
            letterSpacing: '6px',
            textTransform: 'uppercase',
            marginBottom: '30px',
          }}>
            Choose Your Side
          </h2>

          <div style={{ display: 'flex', gap: '24px' }}>
            {/* Allied */}
            <button
              onClick={() => {
                const id: CampaignId = campaignType === 'counterstrike_allied' ? 'counterstrike_allied' : 'allied';
                const campaign = getCampaign(id);
                if (campaign) {
                  setActiveCampaign(campaign);
                  setCampaignUnlocked(loadCampaignProgress(id));
                  // Probe which missions exist
                  Promise.all(campaign.missions.map(m => checkMissionExists(m.id)))
                    .then(results => {
                      setAvailableMissions(results);
                      transitionTo(() => setScreen('campaign_select'));
                    });
                }
              }}
              style={{
                background: 'rgba(30,60,120,0.15)',
                border: '2px solid #335588',
                color: '#88aadd',
                padding: '30px 40px',
                fontFamily: 'monospace',
                fontSize: '20px',
                fontWeight: 'bold',
                cursor: 'pointer',
                letterSpacing: '3px',
                transition: 'background 0.15s, border-color 0.15s',
                minWidth: '200px',
                textAlign: 'center',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(30,60,120,0.3)';
                (e.currentTarget as HTMLElement).style.borderColor = '#5588bb';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(30,60,120,0.15)';
                (e.currentTarget as HTMLElement).style.borderColor = '#335588';
              }}
            >
              ALLIED
              <div style={{ fontSize: '10px', color: '#556688', fontWeight: 'normal', marginTop: '6px', letterSpacing: '1px' }}>
                Blue / Gold
              </div>
            </button>

            {/* Soviet */}
            <button
              onClick={() => {
                const id: CampaignId = campaignType === 'counterstrike_allied' ? 'counterstrike_soviet' : 'soviet';
                const campaign = getCampaign(id);
                if (campaign) {
                  setActiveCampaign(campaign);
                  setCampaignUnlocked(loadCampaignProgress(id));
                  Promise.all(campaign.missions.map(m => checkMissionExists(m.id)))
                    .then(results => {
                      setAvailableMissions(results);
                      transitionTo(() => setScreen('campaign_select'));
                    });
                }
              }}
              style={{
                background: 'rgba(120,20,20,0.15)',
                border: '2px solid #883333',
                color: '#dd6666',
                padding: '30px 40px',
                fontFamily: 'monospace',
                fontSize: '20px',
                fontWeight: 'bold',
                cursor: 'pointer',
                letterSpacing: '3px',
                transition: 'background 0.15s, border-color 0.15s',
                minWidth: '200px',
                textAlign: 'center',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(120,20,20,0.3)';
                (e.currentTarget as HTMLElement).style.borderColor = '#bb5555';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(120,20,20,0.15)';
                (e.currentTarget as HTMLElement).style.borderColor = '#883333';
              }}
            >
              SOVIET
              <div style={{ fontSize: '10px', color: '#886644', fontWeight: 'normal', marginTop: '6px', letterSpacing: '1px' }}>
                Red
              </div>
            </button>
          </div>

          <button
            onClick={() => transitionTo(() => setScreen('main_menu'))}
            style={{
              background: '#222', color: '#888', border: '1px solid #444',
              padding: '8px 24px', fontFamily: 'monospace', fontSize: '12px', cursor: 'pointer',
              marginTop: '30px',
            }}
          >
            Back
          </button>
          <span style={{ color: '#444', fontSize: '11px', marginTop: '8px' }}>
            ESC to go back
          </span>
        </div>
      )}

      {/* ── Campaign Select Screen ── */}
      {!testMode && !qaMode && screen === 'campaign_select' && activeCampaign && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: `radial-gradient(ellipse at center, ${
            activeCampaign.faction === 'allied' ? '#000a14' : '#140000'
          } 0%, #000000 70%)`,
          zIndex: 100000, fontFamily: 'monospace',
        }}>
          <h1 style={{
            color: activeCampaign.faction === 'allied' ? '#88aadd' : '#dd6666',
            fontSize: '28px',
            fontWeight: 'bold',
            textShadow: `0 0 15px ${activeCampaign.faction === 'allied' ? 'rgba(80,120,200,0.5)' : 'rgba(200,60,60,0.5)'}`,
            letterSpacing: '3px',
            marginBottom: '4px',
          }}>
            {activeCampaign.title}
          </h1>
          <h2 style={{
            color: '#666',
            fontSize: '12px',
            letterSpacing: '4px',
            textTransform: 'uppercase',
            marginBottom: '24px',
          }}>
            {activeCampaign.faction === 'allied' ? 'Allied' : 'Soviet'} Campaign
          </h2>

          <div style={{ width: '100%', maxWidth: '520px', maxHeight: '60vh', overflowY: 'auto' }}>
            {activeCampaign.missions.map((cm, i) => {
              const unlocked = i <= campaignUnlocked;
              const completed = i < campaignUnlocked;
              const exists = availableMissions[i] !== false;
              const accentColor = activeCampaign.faction === 'allied' ? '#4488cc' : '#cc4444';
              const accentDim = activeCampaign.faction === 'allied' ? '#223344' : '#442222';
              return (
                <button
                  key={cm.id}
                  onClick={() => unlocked && exists && selectCampaignMission(activeCampaign, i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    width: '100%',
                    padding: '10px 16px',
                    marginBottom: '6px',
                    background: unlocked && exists ? `rgba(${activeCampaign.faction === 'allied' ? '40,80,160' : '160,40,40'},0.08)` : 'rgba(40,40,40,0.3)',
                    border: `1px solid ${unlocked && exists ? accentDim : '#222'}`,
                    color: unlocked ? '#eee' : '#555',
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    cursor: unlocked && exists ? 'pointer' : 'not-allowed',
                    textAlign: 'left',
                    transition: 'background 0.15s',
                    opacity: exists ? 1 : 0.5,
                  }}
                  onMouseEnter={(e) => {
                    if (unlocked && exists) (e.currentTarget as HTMLElement).style.background = `rgba(${activeCampaign.faction === 'allied' ? '40,80,160' : '160,40,40'},0.18)`;
                  }}
                  onMouseLeave={(e) => {
                    if (unlocked && exists) (e.currentTarget as HTMLElement).style.background = `rgba(${activeCampaign.faction === 'allied' ? '40,80,160' : '160,40,40'},0.08)`;
                  }}
                >
                  <span style={{
                    fontSize: '16px',
                    color: completed ? '#44ff44' : unlocked ? accentColor : '#444',
                    minWidth: '24px',
                    textAlign: 'center',
                  }}>
                    {completed ? '\u2713' : unlocked && exists ? `${i + 1}` : !exists ? '\u2717' : '\u{1F512}'}
                  </span>
                  <div>
                    <div style={{
                      fontWeight: 'bold',
                      color: unlocked && exists ? accentColor : '#555',
                    }}>
                      Mission {i + 1}: {cm.title}
                    </div>
                    <div style={{
                      fontSize: '10px',
                      color: unlocked ? '#666' : '#444',
                      marginTop: '2px',
                    }}>
                      {!exists ? 'Mission file not found' : !unlocked ? 'Complete previous mission to unlock' : cm.id}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '16px', marginTop: '20px', alignItems: 'center' }}>
            <button
              onClick={() => { setActiveCampaign(null); transitionTo(() => setScreen('main_menu')); }}
              style={{
                background: '#222', color: '#888', border: '1px solid #444',
                padding: '8px 24px', fontFamily: 'monospace', fontSize: '12px', cursor: 'pointer',
              }}
            >
              Back
            </button>
            <span style={{ color: '#444', fontSize: '11px' }}>ESC to go back</span>
          </div>
        </div>
      )}

      {/* ── Ant Mission Select Screen ── */}
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
            color: activeCampaign ? (activeCampaign.faction === 'allied' ? '#4488cc' : '#cc4444') : '#ff4400',
            fontSize: '12px',
            letterSpacing: '6px',
            textTransform: 'uppercase',
            marginBottom: '8px',
          }}>
            {activeCampaign ? 'Command Briefing' : 'Mission Briefing'}
          </div>

          <h1 style={{
            color: activeCampaign ? (activeCampaign.faction === 'allied' ? '#88aadd' : '#dd6666') : '#ff6633',
            fontSize: '32px',
            fontWeight: 'bold',
            textShadow: `0 0 15px ${activeCampaign ? (activeCampaign.faction === 'allied' ? 'rgba(80,120,200,0.5)' : 'rgba(200,60,60,0.5)') : 'rgba(255,68,0,0.5)'}`,
            letterSpacing: '2px',
            marginBottom: '6px',
          }}>
            {selectedMission.title}
          </h1>

          <div style={{
            color: activeCampaign ? '#666' : '#cc3300',
            fontSize: '13px',
            letterSpacing: '2px',
            marginBottom: '30px',
          }}>
            {activeCampaign
              ? `Mission ${campaignMissionIndex + 1} of ${activeCampaign.missions.length}`
              : `Mission ${missionIndex + 1} of ${MISSIONS.length}`}
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
                setScreen(activeCampaign ? 'campaign_select' : 'select');
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

          {gameState === 'won' && !activeCampaign && missionIndex + 1 >= MISSIONS.length && (
            <div style={{
              color: '#ffaa44',
              fontSize: '16px',
              marginBottom: '20px',
              textShadow: '0 0 10px #ffaa44',
            }}>
              All ant missions complete! The threat has been neutralized.
            </div>
          )}
          {gameState === 'won' && activeCampaign && campaignMissionIndex + 1 >= activeCampaign.missions.length && (
            <div style={{
              color: '#ffaa44',
              fontSize: '16px',
              marginBottom: '20px',
              textShadow: '0 0 10px #ffaa44',
            }}>
              Campaign complete! All missions accomplished.
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
            {gameState === 'won' && (
              activeCampaign
                ? campaignMissionIndex + 1 < activeCampaign.missions.length
                : missionIndex + 1 < MISSIONS.length
            ) && (
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
            onClick={() => { setError(null); setScreen(activeCampaign ? 'campaign_select' : 'select'); }}
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

      {/* ── FMV Click Overlay (skip video on click) ── */}
      {!testMode && !qaMode && (screen === 'fmv_intro' || screen === 'fmv_briefing' || screen === 'fmv_action'
        || screen === 'fmv_win' || screen === 'fmv_lose' || screen === 'fmv_campaign_end') && (
        <div
          onClick={() => { if (moviePlayerRef.current) moviePlayerRef.current.skip(); }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            zIndex: 100022,
            cursor: 'pointer',
          }}
        />
      )}

      {/* ── Objectives Interstitial ── */}
      {!testMode && !qaMode && screen === 'objectives_interstitial' && selectedMission && (
        <div
          onClick={() => continueFromObjectives()}
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
            zIndex: 100020,
            fontFamily: 'monospace',
            cursor: 'pointer',
          }}
        >
          <div style={{
            color: activeCampaign?.faction === 'soviet' ? '#cc4444' : '#4488cc',
            fontSize: '12px',
            letterSpacing: '6px',
            textTransform: 'uppercase',
            marginBottom: '8px',
          }}>
            Mission Objectives
          </div>

          <h1 style={{
            color: activeCampaign?.faction === 'soviet' ? '#dd6666' : '#88aadd',
            fontSize: '28px',
            fontWeight: 'bold',
            textShadow: `0 0 15px ${activeCampaign?.faction === 'soviet' ? 'rgba(200,60,60,0.5)' : 'rgba(80,120,200,0.5)'}`,
            letterSpacing: '2px',
            marginBottom: '24px',
          }}>
            {selectedMission.title}
          </h1>

          <div style={{
            maxWidth: '550px',
            padding: '24px 28px',
            background: activeCampaign?.faction === 'soviet' ? 'rgba(40,10,10,0.5)' : 'rgba(10,20,40,0.5)',
            border: `1px solid ${activeCampaign?.faction === 'soviet' ? '#441111' : '#112244'}`,
            marginBottom: '16px',
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
              borderTop: `1px solid ${activeCampaign?.faction === 'soviet' ? '#331111' : '#112233'}`,
              paddingTop: '12px',
            }}>
              <span style={{
                color: activeCampaign?.faction === 'soviet' ? '#884444' : '#446688',
                fontSize: '11px',
                letterSpacing: '2px',
                textTransform: 'uppercase',
              }}>
                Objective:
              </span>
              <span style={{
                color: activeCampaign?.faction === 'soviet' ? '#ff6666' : '#66aaff',
                fontSize: '13px',
                marginLeft: '8px',
              }}>
                {selectedMission.objective}
              </span>
            </div>
          </div>

          <div style={{
            color: '#555',
            fontSize: '11px',
            marginTop: '12px',
          }}>
            Press ENTER to continue | ESC to skip
          </div>
        </div>
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
