/**
 * @vitest-environment jsdom
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { NodeAgentAdapter } from './node-agent-adapter.js';

/**
 * SCG05EA dog position mapping — runs directly in Node.js via NodeAgentAdapter.
 * No browser/dev server needed.
 */

describe('SCG05EA dog position mapping', () => {
  let adapter: NodeAgentAdapter;

  beforeAll(async () => {
    adapter = new NodeAgentAdapter();
  }, 30_000);

  afterAll(() => {
    adapter.disconnect();
  });

  it('maps all dog positions at multiple ticks', async () => {
    await adapter.loadScenario('SCG05EA');

    // Sample dog positions at several ticks to see patrol patterns
    let prevTick = 0;
    for (const tick of [100, 200, 300, 500, 800, 1200]) {
      const stepTicks = tick - prevTick;
      prevTick = tick;
      const state = adapter.step(stepTicks).state;
      const dogs = state.enemies.filter((u: { t: string }) => u.t === 'DOG');
      const spy = state.units.find((u: { t: string }) => u.t === 'SPY');
      console.log(`\n=== tick=${state.tick} dogs=${dogs.length} spy=${spy ? `(${spy.cx},${spy.cy})` : 'none'} ===`);
      for (const d of dogs.sort((a: { cy: number; cx: number }, b: { cy: number; cx: number }) => a.cy - b.cy || a.cx - b.cx)) {
        console.log(`  DOG (${d.cx}, ${d.cy}) house=${d.h}`);
      }
    }

    // Also check: what structures are near the WEAP?
    const state = adapter.step(1).state;
    const weap = state.structures.find((s: { t: string; ally: boolean }) => s.t === 'WEAP' && !s.ally);
    console.log(`\nWEAP at (${weap?.cx}, ${weap?.cy})`);

    // Show enemy structures near the WEAP
    const nearStructs = state.structures.filter((s: { cx: number; cy: number; ally: boolean }) => {
      if (s.ally) return false;
      const dx = s.cx - (weap?.cx ?? 0);
      const dy = s.cy - (weap?.cy ?? 0);
      return dx * dx + dy * dy <= 100; // within 10 cells
    });
    console.log(`\nEnemy structures within 10 cells of WEAP:`);
    for (const s of nearStructs) {
      console.log(`  ${s.t} (${s.cx}, ${s.cy})`);
    }

    expect(true).toBe(true);
  }, 120_000);
});
