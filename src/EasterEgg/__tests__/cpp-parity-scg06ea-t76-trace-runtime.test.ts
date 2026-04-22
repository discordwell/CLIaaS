/**
 * @vitest-environment jsdom
 *
 * SCG06EA tick 76 runtime trace — load SCG06EA in Node and step tick-by-tick,
 * dumping USSR E1 @(24,67) state through the AREA_GUARD walk.
 *
 * Diagnoses whether the unit ever enters AREA_GUARD, whether approachTarget
 * sets a path, and whether path-shorten fires at (21,66) per the static-
 * geometry test (cpp-parity-scg06ea-t76-trace.test.ts).
 */

import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { NodeAgentAdapter } from './node-agent-adapter.js';

interface TraceRow {
  tick: number;
  cx: number;
  cy: number;
  lx: number;
  ly: number;
  mission: string;
  missionTimer: number;
  moveTarget: { lx: number; ly: number } | null;
  tgt: string | null;
  tgtInRange: boolean;
  path: string;
  pathIndex: number;
  firePrepActive: boolean;
  firePrepStage: number;
  isDriving: boolean;
  doing: string;
}

describe('SCG06EA runtime trace — USSR E1 @(24,67) tick 1-80', () => {
  let adapter: NodeAgentAdapter;

  beforeAll(async () => {
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCG06EA');
  }, 60_000);

  afterAll(() => {
    adapter.disconnect();
  });

  it('traces the specific E1 state through tick 80 and reports path-shorten firing tick', () => {
    // Access raw Game instance for direct entity inspection.
    // The adapter exposes `game` as a private field — we read via cast.
    const game = (adapter as unknown as { game: unknown }).game as {
      entities: Array<{
        alive: boolean; type: string; house: string;
        cell: { cx: number; cy: number };
        leptonX: number; leptonY: number;
        mission: string; missionTimer: number;
        moveTarget: { lx: number; ly: number } | null;
        target: { alive?: boolean; type?: string; leptonX: number; leptonY: number; cell: { cx: number; cy: number } } | null;
        path: Array<{ cx: number; cy: number }>;
        pathIndex: number;
        firePrepActive?: boolean;
        firePrepStage?: number;
        isDriving?: boolean;
        doing?: string;
        weapon?: { range: number } | null;
        inRange: (e: unknown) => boolean;
      }>;
      step: (n: number) => unknown;
      tick: number;
    };

    // Instrument approachTarget to log every call for the specific E1.
    const approachLog: Array<{tick: number; fromCx: number; fromCy: number; toPath: string}> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origApproach = (game as any).approachTarget?.bind(game);
    if (origApproach) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (game as any).approachTarget = function(e: { type: string; house: string; cell: { cx: number; cy: number }; path: Array<{cx: number; cy: number}>; _isTrace?: boolean }) {
        const isTrace = e.type === 'E1' && e.house === 'USSR' && e._isTrace === true;
        const fromCx = e.cell.cx, fromCy = e.cell.cy;
        origApproach(e);
        if (isTrace) {
          approachLog.push({ tick: game.tick, fromCx, fromCy, toPath: e.path.map(c => `(${c.cx},${c.cy})`).join('→') });
        }
      };
    }

    // Find the USSR E1 at spawn cell (24,67). There's ONE such unit per SCG06EA.
    const findE1 = () => game.entities.find(e =>
      e.alive && e.type === 'E1' && e.house === 'USSR' &&
      e.cell.cx === 24 && e.cell.cy === 67);

    const initial = findE1();
    if (!initial) {
      // eslint-disable-next-line no-console
      console.log('NO USSR E1 @(24,67) found at load — dumping all USSR E1s:');
      const allUssrE1 = game.entities.filter(e => e.alive && e.type === 'E1' && e.house === 'USSR');
      for (const e of allUssrE1) {
        // eslint-disable-next-line no-console
        console.log(`  USSR E1 id=${(e as { id?: number }).id} cell=(${e.cell.cx},${e.cell.cy}) m=${e.mission}`);
      }
      expect(initial).toBeDefined();
      return;
    }

    // Track entity by identity reference so we don't lose it if it moves
    const target = initial;
    (target as unknown as { _isTrace: boolean })._isTrace = true;
    const rows: TraceRow[] = [];
    let pathShortenTick = -1;
    let prevMoveTarget = JSON.stringify(target.moveTarget);

    for (let tick = 1; tick <= 80; tick++) {
      game.step(1);
      const tgt = target.target;
      const tgtInRange = !!(tgt && tgt.alive !== false && target.weapon && target.inRange(tgt as unknown));
      const row: TraceRow = {
        tick,
        cx: target.cell.cx,
        cy: target.cell.cy,
        lx: target.leptonX,
        ly: target.leptonY,
        mission: target.mission,
        missionTimer: target.missionTimer,
        moveTarget: target.moveTarget ? { lx: target.moveTarget.lx, ly: target.moveTarget.ly } : null,
        tgt: tgt ? `${tgt.type ?? '?'}@(${tgt.cell.cx},${tgt.cell.cy})` : null,
        tgtInRange,
        path: target.path.map(c => `(${c.cx},${c.cy})`).join('→'),
        pathIndex: target.pathIndex,
        firePrepActive: !!target.firePrepActive,
        firePrepStage: target.firePrepStage ?? 0,
        isDriving: !!target.isDriving,
        doing: target.doing ?? '',
      };
      rows.push(row);

      // Detect path-shorten firing: moveTarget goes from non-null to null
      // while target is still alive (distinguishes from natural arrival).
      const curMt = JSON.stringify(target.moveTarget);
      if (prevMoveTarget !== 'null' && curMt === 'null' && tgt?.alive && pathShortenTick < 0) {
        pathShortenTick = tick;
      }
      prevMoveTarget = curMt;
    }

    // Dump CONDENSED trace — only ticks where state changes meaningfully.
    // eslint-disable-next-line no-console
    console.log(`\nUSSR E1 @(24,67) — SCG06EA trace through tick 80:`);
    let lastCx = -1, lastCy = -1, lastM = '';
    for (const r of rows) {
      const cellChanged = r.cx !== lastCx || r.cy !== lastCy;
      const missionChanged = r.mission !== lastM;
      const significant = cellChanged || missionChanged || r.tgtInRange || r.firePrepActive ||
                          r.tick === 1 || r.tick === 80 || r.tick % 10 === 0 ||
                          (r.tick >= 65 && r.tick <= 80);
      if (significant) {
        // eslint-disable-next-line no-console
        console.log(
          `  t=${r.tick.toString().padStart(2)} (${r.cx},${r.cy}) lp(${r.lx},${r.ly}) m=${r.mission}` +
          ` mt=${r.missionTimer} mTgt=${r.moveTarget ? `(${r.moveTarget.lx},${r.moveTarget.ly})` : 'N'}` +
          ` tgt=${r.tgt ?? 'none'} inR=${r.tgtInRange ? 'Y' : 'N'}` +
          ` pIdx=${r.pathIndex}` +
          ` drv=${r.isDriving ? 'Y' : 'N'} fp=${r.firePrepActive ? 'Y' : 'N'}(${r.firePrepStage})`
        );
      }
      lastCx = r.cx; lastCy = r.cy; lastM = r.mission;
    }
    // eslint-disable-next-line no-console
    console.log(`\n  pathShortenTick = ${pathShortenTick}`);
    // eslint-disable-next-line no-console
    console.log(`  approachTarget calls: ${approachLog.length}`);
    for (const a of approachLog) {
      // eslint-disable-next-line no-console
      console.log(`    t=${a.tick} from(${a.fromCx},${a.fromCy}) → path=[${a.toPath}]`);
    }
    // eslint-disable-next-line no-console
    console.log(`  FINAL: (${rows[rows.length-1].cx},${rows[rows.length-1].cy}) m=${rows[rows.length-1].mission} fp=${rows[rows.length-1].firePrepActive}`);

    expect(rows.length).toBe(80);

    // === Regression assertions ===
    // The Firing_AI port to updateAreaGuard (cpp-parity fix for SCG06EA tick
    // 76 residual) ensures the unit fires the moment its target enters range,
    // not 70+ ticks later when the next Mission_Guard_Area timer fires. The
    // critical observable is that firePrepActive is set within ~1-2 ticks of
    // path-shorten clearing moveTarget — proving the every-tick Firing_AI
    // is hooked into the AREA_GUARD case.
    expect(pathShortenTick).toBeGreaterThan(0);
    expect(pathShortenTick).toBeLessThan(80);
    // After path-shorten, firePrepActive must transition to true within 2 ticks
    // (E1's pre-fire animation kicks off on the next tick after Can_Fire passes).
    const postShorten = rows.slice(pathShortenTick - 1, pathShortenTick + 2);
    const sawFirePrep = postShorten.some(r => r.firePrepActive || r.firePrepStage > 0);
    expect(sawFirePrep, 'firePrepActive should be set within 2 ticks of path-shorten when target is in range').toBe(true);
  }, 60_000);
});
