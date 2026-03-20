import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { TsAgentAdapter } from '../oracle/TsAgentAdapter.js';

const BASE_URL = process.env.RA_PARITY_BASE_URL ?? 'http://localhost:3001';

describe('SCG05EA early game trace', () => {
  let adapter: TsAgentAdapter;

  beforeAll(async () => {
    adapter = new TsAgentAdapter({ url: BASE_URL, headless: true });
    await adapter.connect();
  }, 120_000);

  afterAll(async () => {
    await adapter.disconnect();
  }, 20_000);

  it('traces every unit change in first 300 ticks', async () => {
    const state0 = await adapter.loadScenario('SCG05EA');
    console.log(`[t=0] state=${state0.state} units=${state0.units.length} enemies=${state0.enemies.length}`);

    let prevUnitTypes = '';
    let prevGlobals = '';
    let prevState = state0.state;

    for (let i = 0; i < 100; i++) {
      const r = await adapter.step(5); // 5 ticks at a time for fine granularity
      const s = r.state;
      const unitTypes = s.units.map(u => `${u.t}(${u.cx},${u.cy})`).sort().join(',');
      const globals = s.globals.join(',');

      // Log whenever units change, globals change, or state changes
      if (unitTypes !== prevUnitTypes || globals !== prevGlobals || s.state !== prevState) {
        const spy = s.units.find(u => u.t === 'SPY');
        const lst = s.units.find(u => u.t === 'LST');
        const tanya = s.units.find(u => u.t === 'E7');
        console.log(
          `[t=${s.tick}] state=${s.state} ` +
          `units=[${s.units.map(u => `${u.t}(${u.cx},${u.cy},m=${u.m})`).join(', ')}] ` +
          `globals=[${globals}] ` +
          (lst ? `LST_cargo=${lst.cargo} ` : '') +
          (spy ? `SPY_hp=${spy.hp} ` : '') +
          (tanya ? 'TANYA! ' : ''),
        );
        prevUnitTypes = unitTypes;
        prevGlobals = globals;
        prevState = s.state;
      }
    }

    // Now try sending the spy to the WEAP
    let state = (await adapter.step(1)).state;
    const spy = state.units.find(u => u.t === 'SPY');
    const weap = state.structures.find(s => s.t === 'WEAP' && !s.ally);
    if (spy && weap) {
      console.log(`\n--- SENDING SPY TO WEAP (${weap.cx},${weap.cy}) idx=${weap.idx} ---`);
      await adapter.step(1, [
        { cmd: 'attack_struct', unitIds: [spy.id], structIdx: weap.idx },
      ]);

      for (let i = 0; i < 200; i++) {
        const r = await adapter.step(10);
        state = r.state;
        const s = state.units.find(u => u.t === 'SPY');
        if (!s) {
          console.log(`  [t=${state.tick}] SPY CONSUMED! globals=[${state.globals.join(',')}] state=${state.state}`);
          // Check for Tanya
          for (let j = 0; j < 30; j++) {
            state = (await adapter.step(30)).state;
            const t = state.units.find(u => u.t === 'E7');
            if (t) {
              console.log(`  [t=${state.tick}] TANYA SPAWNED at (${t.cx},${t.cy})!`);
              break;
            }
          }
          break;
        }
        if (i % 20 === 0) {
          console.log(`  [t=${state.tick}] spy (${s.cx},${s.cy}) hp=${s.hp} m="${s.m}"`);
        }
      }
    } else {
      console.log(`spy=${!!spy} weap=${!!weap} — can't test`);
    }

    // Also check enemies for spy (might be disguised and show as enemy)
    const finalState = (await adapter.step(1)).state;
    const enemySpy = finalState.enemies.find(u => u.t === 'SPY');
    if (enemySpy) {
      console.log(`\nSPY found in ENEMIES: (${enemySpy.cx},${enemySpy.cy}) h=${enemySpy.h} ally=${enemySpy.ally}`);
    }

    // Check if any TRUK appeared (briefing says spy hijacks a truck)
    const truk = finalState.units.find(u => u.t === 'TRUK');
    const enemyTruk = finalState.enemies.find(u => u.t === 'TRUK');
    console.log(`\nTRUK in units: ${truk ? `(${truk.cx},${truk.cy})` : 'none'}`);
    console.log(`TRUK in enemies: ${enemyTruk ? `(${enemyTruk.cx},${enemyTruk.cy})` : 'none'}`);

    expect(true).toBe(true);
  }, 120_000);
});
