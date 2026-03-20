import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { TsAgentAdapter } from '../oracle/TsAgentAdapter.js';

const BASE_URL = process.env.RA_PARITY_BASE_URL ?? 'http://localhost:3001';

describe('SCG05EA dog position mapping', () => {
  let adapter: TsAgentAdapter;

  beforeAll(async () => {
    adapter = new TsAgentAdapter({ url: BASE_URL, headless: true });
    await adapter.connect();
  }, 120_000);

  afterAll(async () => {
    await adapter.disconnect();
  }, 20_000);

  it('maps all dog positions at multiple ticks', async () => {
    await adapter.loadScenario('SCG05EA');

    // Sample dog positions at several ticks to see patrol patterns
    for (const tick of [100, 200, 300, 500, 800, 1200]) {
      const state = (await adapter.step(tick === 100 ? 100 : tick - 100)).state;
      const dogs = state.enemies.filter((u: { t: string }) => u.t === 'DOG');
      const spy = state.units.find((u: { t: string }) => u.t === 'SPY');
      console.log(`\n=== tick=${state.tick} dogs=${dogs.length} spy=${spy ? `(${spy.cx},${spy.cy})` : 'none'} ===`);
      for (const d of dogs.sort((a: { cy: number; cx: number }, b: { cy: number; cx: number }) => a.cy - b.cy || a.cx - b.cx)) {
        console.log(`  DOG (${d.cx}, ${d.cy}) house=${d.h}`);
      }
    }

    // Also check: what structures are near the WEAP?
    const state = (await adapter.step(1)).state;
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
