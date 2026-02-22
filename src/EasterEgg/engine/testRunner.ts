/**
 * TestRunner — sequential mission orchestrator for E2E testing.
 *
 * Creates Game + AutoPlayer, runs all 4 missions to completion,
 * collects results, and reports pass/fail via event callbacks.
 */

import { Game, MISSIONS, type GameState } from './index';
import { AutoPlayer } from './autoPlayer';
import { type TurboConfig } from './turbo';

export interface MissionResult {
  id: string;
  title: string;
  outcome: 'won' | 'lost' | 'timeout';
  ticks: number;
  realTimeMs: number;
  unitsRemaining: number;
}

export interface TestRunResults {
  missions: MissionResult[];
  allPassed: boolean;
  totalRealTimeMs: number;
}

export type TestLogEntry = {
  type: 'start' | 'pass' | 'fail' | 'timeout' | 'done';
  mission?: string;
  detail?: string;
};

const TIMEOUT_TICKS = 90_000; // ~100 min game time at 15 FPS

export class TestRunner {
  private game: Game;
  private autoPlayer: AutoPlayer;
  private config: TurboConfig;
  onLog?: (entry: TestLogEntry) => void;

  constructor(canvas: HTMLCanvasElement, config: TurboConfig) {
    this.game = new Game(canvas);
    this.autoPlayer = new AutoPlayer();
    this.config = config;
  }

  /** Run all 4 missions sequentially, return aggregate results */
  async runAll(): Promise<TestRunResults> {
    const results: MissionResult[] = [];
    const totalStart = performance.now();

    for (const mission of MISSIONS) {
      this.onLog?.({ type: 'start', mission: mission.id, detail: mission.title });
      const result = await this.runMission(mission.id, mission.title);
      results.push(result);

      if (result.outcome === 'won') {
        this.onLog?.({
          type: 'pass', mission: mission.id,
          detail: `${result.ticks} ticks, ${result.unitsRemaining} units left, ${(result.realTimeMs / 1000).toFixed(1)}s`,
        });
      } else {
        this.onLog?.({
          type: result.outcome === 'lost' ? 'fail' : 'timeout',
          mission: mission.id,
          detail: `${result.outcome} at ${result.ticks} ticks, ${(result.realTimeMs / 1000).toFixed(1)}s`,
        });
      }
    }

    const totalRealTimeMs = performance.now() - totalStart;
    const allPassed = results.every(r => r.outcome === 'won');

    this.onLog?.({
      type: 'done',
      detail: allPassed
        ? `ALL PASSED in ${(totalRealTimeMs / 1000).toFixed(1)}s`
        : `SOME FAILED in ${(totalRealTimeMs / 1000).toFixed(1)}s`,
    });

    return { missions: results, allPassed, totalRealTimeMs };
  }

  /** Run a single mission to completion */
  private runMission(scenarioId: string, title: string): Promise<MissionResult> {
    return new Promise((resolve) => {
      const startTime = performance.now();
      let resolved = false;

      const finish = (outcome: 'won' | 'lost' | 'timeout') => {
        if (resolved) return;
        resolved = true;
        this.game.stop();
        resolve({
          id: scenarioId, title, outcome,
          ticks: this.game.tick,
          realTimeMs: performance.now() - startTime,
          unitsRemaining: this.game.entities.filter(e => e.alive && e.isPlayerUnit).length,
        });
      };

      // Wire auto-player into game tick
      this.game.onTick = (g) => {
        this.autoPlayer.update(g);
        if (g.tick >= TIMEOUT_TICKS) finish('timeout');
      };

      // Set turbo multiplier
      this.game.turboMultiplier = this.config.ticksPerFrame;

      // Listen for win/lose
      this.game.onStateChange = (state: GameState) => {
        if (state === 'won' || state === 'lost') finish(state);
      };

      // Start mission
      this.game.start(scenarioId).catch(() => finish('lost'));
    });
  }

  /** Stop the test run */
  stop(): void {
    this.game.stop();
  }
}
