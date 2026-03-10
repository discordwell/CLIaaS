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
  | 'faction_select' | 'campaign_select' | 'map_select'
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

  /** Helper: play an FMV and call onDone when complete (or fallback to procedural).
   *  When `immediate` is true, uses playImmediate() to preserve user gesture context
   *  for autoplay with sound. Otherwise falls back to async play(). */
  const playFMV = useCallback((movieName: string, screenState: Screen, _mission: MissionInfo, onDone: () => void, immediate = false) => {
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

    // Use playImmediate() when called directly from a click handler to
    // preserve Chrome's user gesture context for autoplay with sound.
    if (immediate) {
      player.playImmediate(movieName);
    } else {
      player.play(movieName);
    }
  }, []);

  /** Start the animated briefing cutscene before launching the mission.
   *  Flow: Intro → Brief → Objectives → Action → gameplay
   *  Any missing step is skipped.
   *
   *  IMPORTANT: When an intro FMV exists, video.play() is called synchronously
   *  from the user's click handler (via playImmediate) BEFORE the fade transition
   *  starts. The video plays behind the fade overlay (z-index 200000 vs 100020),
   *  so it's invisible until the fade lifts. This preserves Chrome's user gesture
   *  context so autoplay with sound works. */
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
      // Start video playback IMMEDIATELY (synchronously from click handler)
      // to preserve Chrome's user gesture context for autoplay with sound.
      // The video plays behind the fade overlay (z-index 200000 > 100020),
      // so the user sees: fade-to-black → video revealed when fade lifts.
      playFMV(movies.intro!, 'fmv_intro', mission, afterIntro, /* immediate */ true);
      // Run the fade transition in parallel — it just fades to black then
      // fades back in, revealing the already-playing video underneath.
      setFadeActive(true);
      setFadeOpacity(1);
      setTimeout(() => {
        setFadeOpacity(0);
        setTimeout(() => {
          setFadeActive(false);
        }, 500);
      }, 400);
    } else if (movies?.brief && containerRef.current) {
      // Brief-only missions (no intro): start video immediately, fade around it.
      // Can't use playFMV here because we need custom error handling (fallback
      // to procedural briefing rather than just skipping).
      let player = moviePlayerRef.current;
      if (!player && containerRef.current) {
        player = new MoviePlayer(containerRef.current);
        moviePlayerRef.current = player;
      }
      if (player) {
        player.onComplete = () => {
          setScreen('objectives_interstitial');
        };
        player.onError = () => {
          // Fallback to procedural briefing on error
          moviePlayerRef.current?.destroy();
          moviePlayerRef.current = null;
          goToObjectivesOrProcedural();
        };
        setScreen('fmv_briefing');
        player.playImmediate(movies.brief!);
      } else {
        goToObjectivesOrProcedural();
      }
      // Run the fade transition in parallel
      setFadeActive(true);
      setFadeOpacity(1);
      setTimeout(() => {
        setFadeOpacity(0);
        setTimeout(() => {
          setFadeActive(false);
        }, 500);
      }, 400);
    } else {
      // No FMV — procedural path (no autoplay concern, use normal transition)
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

  /** Advance from map_select to the next mission briefing */
  const advanceFromMapSelect = useCallback(() => {
    if (activeCampaign) {
      const nextIdx = campaignMissionIndex + 1;
      if (nextIdx < activeCampaign.missions.length) {
        const cm = activeCampaign.missions[nextIdx];
        setCampaignMissionIndex(nextIdx);
        const realBriefing = getMissionBriefing(cm.id);
        const missionInfo: MissionInfo = {
          id: cm.id,
          title: cm.title,
          briefing: realBriefing || cm.briefing,
          objective: cm.objective,
        };
        setSelectedMission(missionInfo);
        transitionTo(() => setScreen('briefing'));
      }
    } else {
      // Ant mission mode
      const nextIdx = missionIndex + 1;
      if (nextIdx < MISSIONS.length) {
        const mission = MISSIONS[nextIdx];
        if (mission) {
          setMissionIndex(nextIdx);
          setSelectedMission(mission);
          transitionTo(() => setScreen('briefing'));
        }
      }
    }
  }, [missionIndex, activeCampaign, campaignMissionIndex, transitionTo]);

  const handleNextMission = useCallback(() => {
    if (activeCampaign) {
      // Campaign mode: advance to next campaign mission via map select
      const nextIdx = campaignMissionIndex + 1;
      if (nextIdx < activeCampaign.missions.length) {
        transitionTo(() => {
          setScreen('map_select');
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
      // Ant mission mode — show map select between missions
      const nextIdx = missionIndex + 1;
      if (nextIdx < MISSIONS.length) {
        transitionTo(() => {
          setScreen('map_select');
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
        } else if (screen === 'map_select') {
          // ESC on map select → skip to campaign/mission select
          setScreen(activeCampaign ? 'campaign_select' : 'select');
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
      if (screen === 'map_select' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        advanceFromMapSelect();
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
  }, [screen, unlockedMissions, selectedMission, selectMission, launchMission, startCutscene, continueFromObjectives, advanceFromMapSelect, onExit, activeCampaign, campaignMissionIndex]);

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

      {/* ── Map Selection Screen ── */}
      {!testMode && !qaMode && screen === 'map_select' && (
        <div
          data-testid="map-select-screen"
          onClick={() => advanceFromMapSelect()}
          style={{
            position: 'absolute',
            top: 0, left: 0, width: '100%', height: '100%',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: '#000',
            zIndex: 100000, fontFamily: 'monospace',
            cursor: 'pointer',
            overflow: 'hidden',
          }}
        >
          {/* Faction-specific map content */}
          {(() => {
            // Determine which map to show based on campaign type
            const isAnt = !activeCampaign;
            const faction = activeCampaign?.faction;
            const isSoviet = faction === 'soviet';

            // Current mission index (what was just completed)
            const completedIdx = activeCampaign ? campaignMissionIndex : missionIndex;
            const nextIdx = completedIdx + 1;
            const totalMissions = activeCampaign ? activeCampaign.missions.length : MISSIONS.length;
            const nextMission = activeCampaign
              ? activeCampaign.missions[nextIdx]
              : MISSIONS[nextIdx];

            // Color scheme
            const accentColor = isAnt ? '#ffaa00' : isSoviet ? '#cc4444' : '#4488cc';
            const accentGlow = isAnt ? 'rgba(255,170,0,0.5)' : isSoviet ? 'rgba(200,60,60,0.5)' : 'rgba(80,120,200,0.5)';
            const gridColor = isAnt ? 'rgba(255,170,0,0.06)' : isSoviet ? 'rgba(200,60,60,0.06)' : 'rgba(80,120,200,0.06)';
            const lineColor = isAnt ? 'rgba(255,170,0,0.2)' : isSoviet ? 'rgba(200,60,60,0.2)' : 'rgba(80,120,200,0.2)';

            // Ant mission map locations (themed terrain progression)
            const antLocations = [
              { x: 20, y: 70, label: 'Outpost Alpha', subtitle: 'Remote outpost' },
              { x: 38, y: 50, label: 'Twin Villages', subtitle: 'Civilian sector' },
              { x: 58, y: 35, label: 'Ant Nests', subtitle: 'Surface colony' },
              { x: 78, y: 20, label: 'The Tunnels', subtitle: 'Underground network' },
            ];

            // Allied campaign map locations (European theater, roughly west to east)
            const alliedLocations = [
              { x: 30, y: 55, label: 'Rescue' },       // M1: In the Thick of It
              { x: 35, y: 48, label: 'Defense' },       // M2: Five to One
              { x: 28, y: 40, label: 'Convoy' },        // M3: Dead End
              { x: 40, y: 42, label: 'Infiltration' },  // M4: Tanya's Tale
              { x: 45, y: 35, label: 'Nuclear' },       // M5: Paradox Equation
              { x: 50, y: 50, label: 'Base Defense' },  // M6: Situation Critical
              { x: 42, y: 60, label: 'Chemical' },      // M7: Sarin Gas 1
              { x: 48, y: 65, label: 'Sub Pen' },       // M8: Sarin Gas 2
              { x: 55, y: 55, label: 'Plant' },         // M9: Sarin Gas 3
              { x: 60, y: 45, label: 'Spy Op' },        // M10: Suspicion
              { x: 65, y: 38, label: 'Counter' },       // M11: Aftermath
              { x: 70, y: 42, label: 'Strike' },        // M12: Focused Blast
              { x: 75, y: 35, label: 'Capture' },       // M13: Negotiations
              { x: 82, y: 28, label: 'Moscow' },        // M14: No Remorse
            ];

            // Soviet campaign map locations (expanding westward from Moscow)
            const sovietLocations = [
              { x: 78, y: 30, label: 'Village' },       // M1: Lesson in Blood
              { x: 72, y: 35, label: 'Tesla Lab' },     // M2: Tesla's Spark
              { x: 68, y: 40, label: 'Cleanup' },       // M3: Covert Cleanup
              { x: 62, y: 38, label: 'Supply' },        // M4: Behind the Lines
              { x: 58, y: 45, label: 'Forward Base' },  // M5: Distant Thunder
              { x: 52, y: 50, label: 'Bridge' },        // M6: Bridge over Grotz
              { x: 48, y: 42, label: 'Strike' },        // M7: Core of the Matter
              { x: 42, y: 55, label: 'Island' },        // M8: Elba Island
              { x: 38, y: 48, label: 'Occupation' },    // M9: Overseer
              { x: 35, y: 40, label: 'Wasteland' },     // M10: Wasteland
              { x: 30, y: 52, label: 'Missile' },       // M11: Ground Zero
              { x: 25, y: 45, label: 'Trap' },          // M12: Mousetrap
              { x: 22, y: 38, label: 'Tesla' },         // M13: Legacy of Tesla
              { x: 18, y: 30, label: 'London' },        // M14: Soviet Supremacy
            ];

            // Pick the right locations array
            const locations = isAnt ? antLocations
              : (activeCampaign?.id === 'allied' || activeCampaign?.id === 'counterstrike_allied')
                ? alliedLocations.slice(0, totalMissions)
                : sovietLocations.slice(0, totalMissions);

            return (
              <>
                {/* Animated background grid */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                  backgroundImage: `
                    linear-gradient(${gridColor} 1px, transparent 1px),
                    linear-gradient(90deg, ${gridColor} 1px, transparent 1px)
                  `,
                  backgroundSize: '40px 40px',
                }} />

                {/* Radar sweep animation */}
                <div style={{
                  position: 'absolute', top: '50%', left: '50%',
                  width: '120%', height: '120%',
                  transform: 'translate(-50%, -50%)',
                  background: `conic-gradient(from 0deg, transparent 0deg, ${accentGlow} 15deg, transparent 30deg)`,
                  animation: 'radarSweep 6s linear infinite',
                  opacity: 0.15,
                }} />

                {/* Map title */}
                <div style={{
                  position: 'absolute', top: '4%', left: '50%', transform: 'translateX(-50%)',
                  textAlign: 'center', zIndex: 2,
                }}>
                  <div style={{
                    color: accentColor, fontSize: '10px', letterSpacing: '6px',
                    textTransform: 'uppercase', opacity: 0.7, marginBottom: '4px',
                  }}>
                    {isAnt ? 'Theater of Operations' : isSoviet ? 'Soviet Command' : 'Allied Command'}
                  </div>
                  <div style={{
                    color: accentColor, fontSize: '22px', fontWeight: 'bold',
                    letterSpacing: '3px', textShadow: `0 0 15px ${accentGlow}`,
                  }}>
                    {isAnt ? 'ANT CAMPAIGN' : activeCampaign?.title.toUpperCase()}
                  </div>
                </div>

                {/* Map area with mission nodes */}
                <div style={{
                  position: 'relative',
                  width: '80%', maxWidth: '700px',
                  height: '55%', maxHeight: '400px',
                  border: `1px solid ${lineColor}`,
                  borderRadius: '4px',
                  zIndex: 2,
                }}>
                  {/* Connection lines (SVG) */}
                  <svg style={{
                    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                    pointerEvents: 'none',
                  }}>
                    {locations.map((loc, i) => {
                      if (i === 0) return null;
                      const prev = locations[i - 1];
                      const completed = i <= completedIdx;
                      const isNextLine = i === nextIdx;
                      return (
                        <line
                          key={`line-${i}`}
                          x1={`${prev.x}%`} y1={`${prev.y}%`}
                          x2={`${loc.x}%`} y2={`${loc.y}%`}
                          stroke={completed ? accentColor : isNextLine ? accentColor : 'rgba(255,255,255,0.08)'}
                          strokeWidth={completed || isNextLine ? 2 : 1}
                          strokeDasharray={completed ? 'none' : '6 4'}
                          opacity={completed ? 0.7 : isNextLine ? 0.5 : 0.3}
                        />
                      );
                    })}
                  </svg>

                  {/* Mission nodes */}
                  {locations.map((loc, i) => {
                    const completed = i <= completedIdx;
                    const isNext = i === nextIdx;
                    const isFuture = i > nextIdx;
                    const nodeSize = isNext ? 16 : completed ? 12 : 8;

                    return (
                      <div
                        key={`node-${i}`}
                        style={{
                          position: 'absolute',
                          left: `${loc.x}%`, top: `${loc.y}%`,
                          transform: 'translate(-50%, -50%)',
                          display: 'flex', flexDirection: 'column', alignItems: 'center',
                          zIndex: isNext ? 10 : 5,
                        }}
                      >
                        {/* Node dot */}
                        <div style={{
                          width: `${nodeSize}px`, height: `${nodeSize}px`,
                          borderRadius: '50%',
                          background: completed ? accentColor : isNext ? accentColor : 'rgba(255,255,255,0.15)',
                          border: `2px solid ${completed ? accentColor : isNext ? accentColor : 'rgba(255,255,255,0.2)'}`,
                          boxShadow: isNext ? `0 0 12px ${accentGlow}, 0 0 24px ${accentGlow}` : completed ? `0 0 6px ${accentGlow}` : 'none',
                          animation: isNext ? 'mapNodePulse 1.5s ease-in-out infinite' : 'none',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {completed && !isNext && (
                            <span style={{ color: '#000', fontSize: '8px', fontWeight: 'bold', lineHeight: 1 }}>
                              {'\u2713'}
                            </span>
                          )}
                        </div>

                        {/* Label */}
                        {(completed || isNext) && (
                          <div style={{
                            position: 'absolute',
                            top: `${nodeSize / 2 + 6}px`,
                            whiteSpace: 'nowrap',
                            textAlign: 'center',
                          }}>
                            <div style={{
                              color: isNext ? accentColor : 'rgba(255,255,255,0.5)',
                              fontSize: isNext ? '11px' : '9px',
                              fontWeight: isNext ? 'bold' : 'normal',
                              letterSpacing: '1px',
                              textShadow: isNext ? `0 0 8px ${accentGlow}` : 'none',
                            }}>
                              {loc.label}
                            </div>
                            {isAnt && isNext && 'subtitle' in loc && (
                              <div style={{
                                color: 'rgba(255,255,255,0.3)', fontSize: '8px', marginTop: '1px',
                              }}>
                                {(loc as { subtitle: string }).subtitle}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Future node — just a dim dot, no label */}
                        {isFuture && (
                          <div style={{
                            position: 'absolute',
                            top: `${nodeSize / 2 + 4}px`,
                            color: 'rgba(255,255,255,0.15)',
                            fontSize: '7px',
                          }}>
                            ?
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Coordinate labels along edges */}
                  {[0, 25, 50, 75, 100].map(pct => (
                    <span key={`x-${pct}`} style={{
                      position: 'absolute', bottom: '-16px', left: `${pct}%`,
                      transform: 'translateX(-50%)',
                      color: 'rgba(255,255,255,0.1)', fontSize: '8px',
                    }}>
                      {Math.round(pct * 1.28)}
                    </span>
                  ))}
                  {[0, 25, 50, 75, 100].map(pct => (
                    <span key={`y-${pct}`} style={{
                      position: 'absolute', left: '-20px', top: `${pct}%`,
                      transform: 'translateY(-50%)',
                      color: 'rgba(255,255,255,0.1)', fontSize: '8px',
                    }}>
                      {Math.round(pct * 0.96)}
                    </span>
                  ))}
                </div>

                {/* Next mission info panel */}
                <div style={{
                  position: 'absolute', bottom: '8%', left: '50%', transform: 'translateX(-50%)',
                  textAlign: 'center', zIndex: 2,
                }}>
                  <div style={{
                    color: accentColor, fontSize: '13px', fontWeight: 'bold',
                    letterSpacing: '2px', marginBottom: '4px',
                    textShadow: `0 0 10px ${accentGlow}`,
                  }}>
                    NEXT: {nextMission ? (isAnt ? (nextMission as MissionInfo).title : (nextMission as CampaignMission).title) : 'UNKNOWN'}
                  </div>
                  <div style={{
                    color: 'rgba(255,255,255,0.3)', fontSize: '10px', letterSpacing: '1px',
                  }}>
                    Mission {nextIdx + 1} of {totalMissions}
                  </div>
                  <div style={{
                    color: 'rgba(255,255,255,0.2)', fontSize: '10px', marginTop: '12px',
                  }}>
                    Click or press ENTER to continue
                  </div>
                </div>

                {/* CSS Animations */}
                <style>{`
                  @keyframes radarSweep {
                    from { transform: translate(-50%, -50%) rotate(0deg); }
                    to { transform: translate(-50%, -50%) rotate(360deg); }
                  }
                  @keyframes mapNodePulse {
                    0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
                    50% { transform: translate(-50%, -50%) scale(1.4); opacity: 0.7; }
                  }
                `}</style>
              </>
            );
          })()}
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
      {!testMode && !qaMode && screen === 'briefing' && selectedMission && (() => {
        // Faction theming: allied=blue/green, soviet=red/black, ants=amber/orange
        const faction: 'allied' | 'soviet' | 'ants' = activeCampaign ? activeCampaign.faction : 'ants';
        const theme = {
          allied: {
            primary: '#4488cc', accent: '#88ccff', dim: '#2a4466',
            bg: 'rgba(10,25,50,0.85)', border: '#335577', glow: 'rgba(68,136,204,0.4)',
            stamp: '#3366aa', headerBg: 'rgba(20,40,80,0.9)',
            launchBg: '#1a3355', launchColor: '#66bbff', launchBorder: '#4488cc',
            docBg: 'rgba(15,30,55,0.6)', docBorder: '#2a4466',
            objColor: '#66ccff', insigniaColor: '#4488cc',
            classification: 'ALLIED COMMAND',
          },
          soviet: {
            primary: '#cc4444', accent: '#ff6666', dim: '#662222',
            bg: 'rgba(40,10,10,0.85)', border: '#663333', glow: 'rgba(204,68,68,0.4)',
            stamp: '#aa3333', headerBg: 'rgba(60,15,15,0.9)',
            launchBg: '#441111', launchColor: '#ff6666', launchBorder: '#cc4444',
            docBg: 'rgba(45,15,15,0.6)', docBorder: '#552222',
            objColor: '#ff8888', insigniaColor: '#cc4444',
            classification: 'SOVIET COMMAND',
          },
          ants: {
            primary: '#ff8800', accent: '#ffaa33', dim: '#664400',
            bg: 'rgba(30,20,5,0.85)', border: '#664400', glow: 'rgba(255,136,0,0.4)',
            stamp: '#cc6600', headerBg: 'rgba(50,30,10,0.9)',
            launchBg: '#442200', launchColor: '#ffaa33', launchBorder: '#ff8800',
            docBg: 'rgba(40,25,10,0.6)', docBorder: '#553311',
            objColor: '#ffcc44', insigniaColor: '#ff8800',
            classification: 'FIELD COMMAND',
          },
        }[faction];
        const missionNum = activeCampaign
          ? `${campaignMissionIndex + 1} of ${activeCampaign.missions.length}`
          : `${missionIndex + 1} of ${MISSIONS.length}`;
        const missionLabel = activeCampaign ? 'OPERATION' : 'MISSION';

        return (
        <div
          data-testid="briefing-screen"
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
            fontFamily: '"Courier New", Courier, monospace',
            cursor: 'pointer',
            overflow: 'hidden',
          }}
          onClick={() => startCutscene(selectedMission)}
        >
          {/* CRT scanline overlay */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)',
            pointerEvents: 'none',
            zIndex: 100010,
          }} />

          {/* Vignette overlay */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%)',
            pointerEvents: 'none',
            zIndex: 100009,
          }} />

          {/* ── Dossier container ── */}
          <div style={{
            position: 'relative',
            width: '580px',
            maxWidth: '90%',
            background: theme.bg,
            border: `2px solid ${theme.border}`,
            boxShadow: `0 0 30px ${theme.glow}, inset 0 0 60px rgba(0,0,0,0.5)`,
            padding: 0,
            zIndex: 100001,
          }}>
            {/* Corner markings */}
            {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map(corner => {
              const isTop = corner.includes('top');
              const isLeft = corner.includes('left');
              return (
                <div key={corner} style={{
                  position: 'absolute',
                  [isTop ? 'top' : 'bottom']: '-1px',
                  [isLeft ? 'left' : 'right']: '-1px',
                  width: '12px',
                  height: '12px',
                  borderTop: isTop ? `2px solid ${theme.accent}` : 'none',
                  borderBottom: !isTop ? `2px solid ${theme.accent}` : 'none',
                  borderLeft: isLeft ? `2px solid ${theme.accent}` : 'none',
                  borderRight: !isLeft ? `2px solid ${theme.accent}` : 'none',
                  zIndex: 2,
                }} />
              );
            })}

            {/* ── Header bar ── */}
            <div style={{
              background: theme.headerBg,
              borderBottom: `1px solid ${theme.border}`,
              padding: '12px 20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              {/* Faction insignia (CSS-only) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  border: `2px solid ${theme.insigniaColor}`,
                  borderRadius: faction === 'soviet' ? '0' : faction === 'allied' ? '50%' : '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                  color: theme.insigniaColor,
                  fontWeight: 'bold',
                  position: 'relative',
                  transform: faction === 'soviet' ? 'rotate(45deg)' : 'none',
                  boxShadow: `0 0 8px ${theme.glow}`,
                }}>
                  <span style={{ transform: faction === 'soviet' ? 'rotate(-45deg)' : 'none' }}>
                    {faction === 'allied' ? '\u2605' : faction === 'soviet' ? '\u2620' : '\u26A0'}
                  </span>
                </div>
                <div>
                  <div style={{
                    color: theme.accent,
                    fontSize: '10px',
                    letterSpacing: '3px',
                    textTransform: 'uppercase',
                    opacity: 0.7,
                  }}>
                    {theme.classification}
                  </div>
                  <div style={{
                    color: theme.primary,
                    fontSize: '11px',
                    letterSpacing: '4px',
                    textTransform: 'uppercase',
                  }}>
                    {activeCampaign ? 'COMMAND BRIEFING' : 'MISSION BRIEFING'}
                  </div>
                </div>
              </div>

              {/* Classification stamp */}
              <div style={{
                border: `2px solid ${theme.stamp}`,
                padding: '2px 10px',
                color: theme.stamp,
                fontSize: '10px',
                letterSpacing: '3px',
                fontWeight: 'bold',
                transform: 'rotate(-3deg)',
                opacity: 0.8,
                textTransform: 'uppercase',
              }}>
                TOP SECRET
              </div>
            </div>

            {/* ── Mission designation ── */}
            <div style={{
              padding: '16px 20px 8px',
              borderBottom: `1px dashed ${theme.dim}`,
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
              }}>
                <div>
                  <span style={{
                    color: theme.dim,
                    fontSize: '10px',
                    letterSpacing: '3px',
                    textTransform: 'uppercase',
                  }}>
                    {missionLabel} {missionNum}
                  </span>
                </div>
                <div style={{
                  color: theme.dim,
                  fontSize: '9px',
                  letterSpacing: '2px',
                  fontStyle: 'italic',
                }}>
                  {selectedMission.id}
                </div>
              </div>
              <h1 style={{
                color: theme.accent,
                fontSize: '22px',
                fontWeight: 'bold',
                letterSpacing: '2px',
                margin: '6px 0 10px',
                textShadow: `0 0 12px ${theme.glow}`,
                textTransform: 'uppercase',
                fontFamily: '"Courier New", Courier, monospace',
              }}>
                {selectedMission.title}
              </h1>
            </div>

            {/* ── Briefing text area (aged document style) ── */}
            <div style={{
              margin: '14px 20px',
              padding: '16px 18px',
              background: theme.docBg,
              border: `1px solid ${theme.docBorder}`,
              position: 'relative',
              maxHeight: '180px',
              overflowY: 'auto',
            }}>
              {/* Faint ruled lines */}
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                background: 'repeating-linear-gradient(180deg, transparent, transparent 23px, rgba(255,255,255,0.02) 23px, rgba(255,255,255,0.02) 24px)',
                pointerEvents: 'none',
              }} />
              <div style={{
                color: '#ccbb99',
                fontSize: '13px',
                lineHeight: '24px',
                position: 'relative',
                whiteSpace: 'pre-wrap',
              }}>
                {selectedMission.briefing}
              </div>
            </div>

            {/* ── Objective callout ── */}
            <div style={{
              margin: '0 20px 14px',
              padding: '10px 14px',
              background: `linear-gradient(90deg, ${theme.docBg}, transparent)`,
              borderLeft: `3px solid ${theme.primary}`,
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
            }}>
              <div style={{
                color: theme.dim,
                fontSize: '10px',
                letterSpacing: '2px',
                textTransform: 'uppercase',
                fontWeight: 'bold',
                whiteSpace: 'nowrap',
                paddingTop: '2px',
              }}>
                PRIMARY OBJECTIVE
              </div>
              <div style={{
                color: theme.objColor,
                fontSize: '13px',
                fontWeight: 'bold',
                lineHeight: '1.4',
              }}>
                {selectedMission.objective}
              </div>
            </div>

            {/* ── Difficulty selector ── */}
            <div style={{
              margin: '0 20px 14px',
              padding: '10px 14px',
              borderTop: `1px solid ${theme.dim}`,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}>
              <span style={{
                color: theme.dim,
                fontSize: '10px',
                letterSpacing: '2px',
                textTransform: 'uppercase',
                fontWeight: 'bold',
              }}>
                THREAT LEVEL
              </span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {DIFFICULTIES.map(d => {
                  const isActive = d === difficulty;
                  const diffColors = {
                    easy: { bg: isActive ? '#1a3322' : 'transparent', color: isActive ? '#55dd55' : '#445544', border: isActive ? '#338833' : '#333' },
                    normal: { bg: isActive ? '#332b1a' : 'transparent', color: isActive ? '#ddaa33' : '#554433', border: isActive ? '#886622' : '#333' },
                    hard: { bg: isActive ? '#331a1a' : 'transparent', color: isActive ? '#dd5555' : '#554444', border: isActive ? '#883333' : '#333' },
                  }[d];
                  return (
                    <button
                      key={d}
                      onClick={(e) => { e.stopPropagation(); setDifficulty(d); }}
                      data-testid={`difficulty-${d}`}
                      style={{
                        background: diffColors.bg,
                        color: diffColors.color,
                        border: `1px solid ${diffColors.border}`,
                        padding: '3px 12px',
                        fontFamily: '"Courier New", Courier, monospace',
                        fontSize: '11px',
                        cursor: 'pointer',
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                        fontWeight: isActive ? 'bold' : 'normal',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Action bar ── */}
            <div style={{
              padding: '12px 20px 16px',
              borderTop: `1px solid ${theme.border}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setScreen(activeCampaign ? 'campaign_select' : 'select');
                }}
                data-testid="briefing-back"
                style={{
                  background: 'rgba(30,30,30,0.8)',
                  color: '#888',
                  border: '1px solid #444',
                  padding: '8px 20px',
                  fontFamily: '"Courier New", Courier, monospace',
                  fontSize: '11px',
                  cursor: 'pointer',
                  letterSpacing: '2px',
                  textTransform: 'uppercase',
                }}
              >
                ABORT
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startCutscene(selectedMission);
                }}
                data-testid="briefing-launch"
                style={{
                  background: `linear-gradient(180deg, ${theme.launchBg}, ${theme.launchBg}dd)`,
                  color: theme.launchColor,
                  border: `2px solid ${theme.launchBorder}`,
                  padding: '10px 32px',
                  fontFamily: '"Courier New", Courier, monospace',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  letterSpacing: '3px',
                  textTransform: 'uppercase',
                  animation: 'briefingGlow 2s ease-in-out infinite',
                  position: 'relative',
                  boxShadow: `0 0 15px ${theme.glow}`,
                }}
              >
                LAUNCH MISSION
              </button>
            </div>
          </div>

          {/* ── Footer hints ── */}
          <div style={{
            color: '#444',
            fontSize: '10px',
            marginTop: '16px',
            letterSpacing: '2px',
            animation: 'briefingBlink 3s ease-in-out infinite',
          }}>
            PRESS ENTER TO LAUNCH | ESC TO ABORT
          </div>

          <style>{`
            @keyframes briefingGlow {
              0%, 100% { box-shadow: 0 0 8px ${theme.glow}; }
              50% { box-shadow: 0 0 25px ${theme.glow}, 0 0 50px ${theme.glow}44; }
            }
            @keyframes briefingBlink {
              0%, 100% { opacity: 0.6; }
              50% { opacity: 0.3; }
            }

          `}</style>
        </div>
        );
      })()}

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
            zIndex: 100019,
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
