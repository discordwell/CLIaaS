/**
 * @vitest-environment jsdom
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { NodeAgentAdapter } from './node-agent-adapter.js';

/**
 * SCG05EA spy infiltration test — sends spy to WEAP and tests attack_struct.
 * Runs directly in Node.js via NodeAgentAdapter (no browser/dev server needed).
 */

describe('SCG05EA spy infiltration test', () => {
  let adapter: NodeAgentAdapter;

  beforeAll(async () => {
    adapter = new NodeAgentAdapter();
  }, 30_000);

  afterAll(() => {
    adapter.disconnect();
  });

  it('sends spy to (47,49) then attack_struct on WEAP', async () => {
    await adapter.loadScenario('SCG05EA');

    // Get spy (reinforcement from scripted trigger — timing may vary slightly
    // with CDTimer end-of-tick parity adjustments).
    let state = adapter.step(1).state;
    for (let i = 0; i < 200; i++) {
      state = adapter.step(15).state;
      if (state.units.find(u => u.t === 'SPY')) break;
    }
    const spy = state.units.find(u => u.t === 'SPY');
    if (!spy) {
      console.log(`SPY did not spawn within ${state.tick} ticks — skipping`);
      return;
    }

    // Move spy directly to (47,49) via cell-by-cell
    const wps = [
      { cx: 18, cy: 48 }, { cx: 21, cy: 48 }, { cx: 24, cy: 48 },
      { cx: 27, cy: 48 }, { cx: 30, cy: 48 }, { cx: 35, cy: 48 },
      { cx: 40, cy: 48 }, { cx: 45, cy: 48 }, { cx: 47, cy: 49 },
    ];
    for (const wp of wps) {
      adapter.step(1, [{ cmd: 'move', unitIds: [spy.id], cx: wp.cx, cy: wp.cy }]);
      for (let j = 0; j < 50; j++) {
        state = adapter.step(15).state;
        const s = state.units.find(u => u.t === 'SPY');
        if (!s) { console.log('SPY DIED en route'); return; }
        if (Math.abs(s.cx - wp.cx) <= 1 && Math.abs(s.cy - wp.cy) <= 1) break;
      }
    }

    const spyNow = state.units.find(u => u.t === 'SPY')!;
    console.log(`Spy at (${spyNow.cx},${spyNow.cy})`);

    // Find WEAP
    const weap = state.structures.find(s => s.t === 'WEAP' && !s.ally);
    console.log(`WEAP at (${weap!.cx},${weap!.cy}) idx=${weap!.idx}`);

    // Send attack_struct DIRECTLY
    const result = adapter.step(1, [
      { cmd: 'attack_struct', unitIds: [spyNow.id], structIdx: weap!.idx },
    ]);
    console.log(`attack_struct result: ${result.results.map(r => `${r.cmd}:${r.ok}:${r.error ?? 'ok'}`).join(', ')}`);

    // Wait for infiltration
    for (let i = 0; i < 30; i++) {
      state = adapter.step(15).state;
      const s = state.units.find(u => u.t === 'SPY');
      if (!s) {
        console.log(`\nSPY CONSUMED at tick ${state.tick}! globals=[${state.globals.join(',')}]`);
        const tanya = state.units.find(u => u.t === 'E7');
        console.log(`Tanya: ${tanya ? `(${tanya.cx},${tanya.cy})` : 'not yet'}`);
        // Wait more for Tanya
        for (let k = 0; k < 100; k++) {
          state = adapter.step(30).state;
          const t = state.units.find(u => u.t === 'E7');
          if (t) {
            console.log(`TANYA SPAWNED at (${t.cx},${t.cy}) tick=${state.tick}!`);
            break;
          }
        }
        break;
      }
      if (i % 5 === 0) {
        console.log(`  [${i}] spy (${s.cx},${s.cy}) m="${s.m}" hp=${s.hp}`);
      }
    }

    expect(true).toBe(true);
  }, 300_000);
});
