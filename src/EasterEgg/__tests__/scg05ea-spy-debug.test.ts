import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { TsAgentAdapter } from '../oracle/TsAgentAdapter.js';

const BASE_URL = process.env.RA_PARITY_BASE_URL ?? 'http://localhost:3001';

describe('SCG05EA y=47 test', () => {
  let adapter: TsAgentAdapter;

  beforeAll(async () => {
    adapter = new TsAgentAdapter({ url: BASE_URL, headless: true });
    await adapter.connect();
  }, 120_000);

  afterAll(async () => {
    await adapter.disconnect();
  }, 20_000);

  it('can spy move to y=47?', async () => {
    await adapter.loadScenario('SCG05EA');

    // Get spy
    let state = (await adapter.step(1)).state;
    for (let i = 0; i < 40; i++) {
      state = (await adapter.step(15)).state;
      if (state.units.find(u => u.t === 'SPY')) break;
    }
    const spy = state.units.find(u => u.t === 'SPY')!;

    // Move to (18,48) first
    await adapter.step(1, [{ cmd: 'move', unitIds: [spy.id], cx: 18, cy: 48 }]);
    for (let i = 0; i < 30; i++) {
      state = (await adapter.step(15)).state;
      const s = state.units.find(u => u.t === 'SPY');
      if (s && s.cx >= 18 && s.cy <= 48) break;
    }
    let s = state.units.find(u => u.t === 'SPY')!;
    console.log(`Start: (${s.cx},${s.cy})`);

    // Try moving to y=47
    const r = await adapter.step(120, [{ cmd: 'move', unitIds: [s.id], cx: 18, cy: 47 }]);
    const s2 = r.state.units.find(u => u.t === 'SPY');
    console.log(`After move to (18,47): ${s2 ? `(${s2.cx},${s2.cy}) m="${s2.m}"` : 'SPY GONE!'}`);
    if (!s2) return;

    // Try moving to (30,47) — past the tree
    const r2 = await adapter.step(300, [{ cmd: 'move', unitIds: [s2.id], cx: 30, cy: 47 }]);
    const s3 = r2.state.units.find(u => u.t === 'SPY');
    console.log(`After move to (30,47): ${s3 ? `(${s3.cx},${s3.cy}) m="${s3.m}"` : 'SPY GONE!'}`);
    if (!s3) return;

    // Try moving to (31,48) — past the tree, back at y=48
    const r3 = await adapter.step(300, [{ cmd: 'move', unitIds: [s3.id], cx: 31, cy: 48 }]);
    const s4 = r3.state.units.find(u => u.t === 'SPY');
    console.log(`After move to (31,48): ${s4 ? `(${s4.cx},${s4.cy}) m="${s4.m}"` : 'SPY GONE!'}`);
    if (!s4) return;

    // If we got past tree, continue to WEAP
    const r4 = await adapter.step(600, [{ cmd: 'move', unitIds: [s4.id], cx: 44, cy: 48 }]);
    const s5 = r4.state.units.find(u => u.t === 'SPY');
    console.log(`After move to (44,48): ${s5 ? `(${s5.cx},${s5.cy}) m="${s5.m}"` : 'SPY GONE!'}`);
    if (!s5) return;

    // Infiltrate WEAP
    const weap = r4.state.structures.find(st => st.t === 'WEAP' && !st.ally);
    if (weap) {
      console.log(`\nSending spy to WEAP at (${weap.cx},${weap.cy})`);
      const r5 = await adapter.step(600, [{ cmd: 'attack_struct', unitIds: [s5.id], structIdx: weap.idx }]);
      const s6 = r5.state.units.find(u => u.t === 'SPY');
      console.log(`Result: ${s6 ? `SPY at (${s6.cx},${s6.cy})` : 'SPY INFILTRATED!'} globals=${r5.state.globals.join(',')}`);
    }

    expect(true).toBe(true);
  }, 300_000);
});
