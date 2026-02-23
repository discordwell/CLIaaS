/**
 * QATestRunner — orchestrates GameInspector + ScreenshotCapture + AutoPlayer.
 *
 * Runs all 4 missions in turbo mode, collecting anomalies and screenshots.
 * Produces a QAReport JSON and sets window.__qaReport / window.__qaComplete.
 */

import { Game, MISSIONS, type GameState } from './index';
import { AutoPlayer } from './autoPlayer';
import { GameInspector, type Anomaly, type AnomalySeverity, type AnomalyCategory } from './inspector';
import { ScreenshotCapture, type Screenshot } from './screenshotCapture';

// === Report types ===

export interface QAMissionResult {
  id: string;
  title: string;
  outcome: 'won' | 'lost' | 'timeout';
  ticks: number;
  realTimeMs: number;
  anomalies: Anomaly[];
  screenshotCount: number;
  stats: {
    unitsRemaining: number;
    killCount: number;
    lossCount: number;
    credits: number;
  };
}

export interface QAReport {
  timestamp: string;
  missions: QAMissionResult[];
  summary: {
    totalAnomalies: number;
    bySeverity: Record<AnomalySeverity, number>;
    byCategory: Record<AnomalyCategory, number>;
    allMissionsCompleted: boolean;
    zeroCritical: boolean;
    passed: boolean;
  };
  screenshots: Screenshot[];
}

export type QALogEntry = {
  type: 'start' | 'pass' | 'fail' | 'timeout' | 'anomaly' | 'done';
  mission?: string;
  detail?: string;
  anomaly?: Anomaly;
};

const TIMEOUT_TICKS = 90_000;

// Declare window globals for Playwright access
declare global {
  interface Window {
    __qaReport?: QAReport;
    __qaComplete?: boolean;
  }
}

export class QATestRunner {
  private game: Game;
  private autoPlayer: AutoPlayer;
  private inspector: GameInspector;
  private capture: ScreenshotCapture;
  private allScreenshots: Screenshot[] = [];

  onLog?: (entry: QALogEntry) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.game = new Game(canvas);
    this.autoPlayer = new AutoPlayer();
    this.inspector = new GameInspector();
    this.capture = new ScreenshotCapture();
    this.capture.setCanvas(canvas);
  }

  /** Run all 4 missions, produce QA report */
  async runAll(): Promise<QAReport> {
    const results: QAMissionResult[] = [];

    for (const mission of MISSIONS) {
      this.onLog?.({ type: 'start', mission: mission.id, detail: mission.title });
      const result = await this.runMission(mission.id, mission.title);
      results.push(result);

      if (result.outcome === 'won') {
        this.onLog?.({
          type: 'pass', mission: mission.id,
          detail: `${result.ticks} ticks, ${result.anomalies.length} anomalies, ${(result.realTimeMs / 1000).toFixed(1)}s`,
        });
      } else {
        this.onLog?.({
          type: result.outcome === 'lost' ? 'fail' : 'timeout',
          mission: mission.id,
          detail: `${result.outcome} at ${result.ticks} ticks, ${result.anomalies.length} anomalies`,
        });
      }
    }

    // Aggregate
    const allAnomalies = results.flatMap(r => r.anomalies);
    const bySeverity: Record<AnomalySeverity, number> = { critical: 0, warning: 0, info: 0 };
    const byCategory: Record<AnomalyCategory, number> = {
      physics: 0, behavior: 0, combat: 0, visual: 0, economy: 0, performance: 0,
    };
    for (const a of allAnomalies) {
      bySeverity[a.severity]++;
      byCategory[a.category]++;
    }

    const allMissionsCompleted = results.every(r => r.outcome !== 'timeout');
    const zeroCritical = bySeverity.critical === 0;

    const report: QAReport = {
      timestamp: new Date().toISOString(),
      missions: results,
      summary: {
        totalAnomalies: allAnomalies.length,
        bySeverity,
        byCategory,
        allMissionsCompleted,
        zeroCritical,
        passed: allMissionsCompleted && zeroCritical,
      },
      screenshots: this.allScreenshots,
    };

    // Expose to Playwright
    if (typeof window !== 'undefined') {
      window.__qaReport = report;
      window.__qaComplete = true;
    }

    this.onLog?.({
      type: 'done',
      detail: report.summary.passed
        ? `PASSED — ${allAnomalies.length} anomalies (0 critical)`
        : `FAILED — ${bySeverity.critical} critical, ${bySeverity.warning} warnings`,
    });

    return report;
  }

  private runMission(scenarioId: string, title: string): Promise<QAMissionResult> {
    return new Promise((resolve) => {
      const startTime = performance.now();
      let resolved = false;
      const missionAnomalies: Anomaly[] = [];

      this.inspector.reset();
      this.capture.reset();
      this.capture.setMission(scenarioId);

      const finish = (outcome: 'won' | 'lost' | 'timeout') => {
        if (resolved) return;
        resolved = true;

        // Final state screenshot
        this.capture.requestCapture('state', outcome);
        this.capture.flush(this.game.tick);

        const screenshots = this.capture.getAll();
        this.allScreenshots.push(...screenshots);

        this.game.stop();
        resolve({
          id: scenarioId, title, outcome,
          ticks: this.game.tick,
          realTimeMs: performance.now() - startTime,
          anomalies: missionAnomalies,
          screenshotCount: screenshots.length,
          stats: {
            unitsRemaining: this.game.entities.filter(e => e.alive && e.isPlayerUnit).length,
            killCount: this.game.killCount,
            lossCount: this.game.lossCount,
            credits: this.game.credits,
          },
        });
      };

      // Wire everything into game tick
      this.game.onTick = (g) => {
        const tickStart = performance.now();

        this.autoPlayer.update(g);

        const anomalies = this.inspector.check(g);
        for (const a of anomalies) {
          missionAnomalies.push(a);
          this.onLog?.({ type: 'anomaly', mission: scenarioId, anomaly: a });

          // Screenshot on critical/warning anomalies
          if (a.severity === 'critical' || a.severity === 'warning') {
            this.capture.requestCapture('anomaly', `${a.id}_${a.entityId ?? 'global'}`);
          }
        }

        // Periodic screenshots
        this.capture.tick(g.tick);

        // Tick duration check
        const tickMs = performance.now() - tickStart;
        const durAnomaly = this.inspector.checkTickDuration(g.tick, tickMs);
        if (durAnomaly) {
          missionAnomalies.push(durAnomaly);
        }

        if (g.tick >= TIMEOUT_TICKS) finish('timeout');
      };

      // onPostRender — flush screenshots after canvas has been painted
      this.game.onPostRender = () => {
        this.capture.flush(this.game.tick);
      };

      // Listen for win/lose
      this.game.onStateChange = (state: GameState) => {
        if (state === 'playing') {
          // Set turbo AFTER start() completes (start() resets turboMultiplier to 1)
          this.game.turboMultiplier = 60;
        }
        if (state === 'won') {
          this.capture.requestCapture('state', 'won');
          finish('won');
        }
        if (state === 'lost') {
          this.capture.requestCapture('state', 'lost');
          finish('lost');
        }
      };

      // Start mission
      this.game.start(scenarioId).catch(() => finish('lost'));
    });
  }

  /** Stop the QA run */
  stop(): void {
    this.game.stop();
  }

  /** Get the internal game instance (for AntGame.tsx overlay) */
  getGame(): Game {
    return this.game;
  }
}
