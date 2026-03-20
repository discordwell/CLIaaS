import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { TsAgentAdapter } from '../oracle/TsAgentAdapter.js';
import { SharedTsOracleStrategy } from '../oracle/SharedOracleBridge.js';

const BASE_URL = process.env.RA_PARITY_BASE_URL ?? 'http://localhost:3001';

describe('SCG05EA final approach dog analysis', () => {
  let adapter: TsAgentAdapter;

  beforeAll(async () => {
    adapter = new TsAgentAdapter({ url: BASE_URL, headless: true });
    await adapter.connect();
  }, 120_000);

  afterAll(async () => {
    await adapter.disconnect();
  }, 20_000);

  it('tracks dogs near WEAP during spy approach', async () => {
    const oracle = new SharedTsOracleStrategy('SCG05EA');
    let state = await adapter.loadScenario('SCG05EA');

    // Run oracle until spy reaches x>=40
    for (let i = 0; i < 300; i++) {
      const decision = oracle.decide(state);
      const step = await adapter.step(15, decision.commands);
      state = step.state;
      const spy = state.units.find(u => u.t === 'SPY');

      if (spy && spy.cx >= 40) {
        console.log(`\nSpy at (${spy.cx},${spy.cy}) tick=${state.tick} — tracking dogs`);

        // Log ALL dogs and their positions for the next 200 ticks
        for (let j = 0; j < 400; j++) {
          const d2 = oracle.decide(state);
          const s2 = await adapter.step(5, d2.commands);
          state = s2.state;
          const sp = state.units.find(u => u.t === 'SPY');
          const dogs = state.enemies.filter(e => e.t === 'DOG');
          const nearDogs = dogs.filter(d =>
            sp && Math.sqrt((d.cx - sp.cx) ** 2 + (d.cy - sp.cy) ** 2) <= 6
          );

          if (!sp) {
            console.log(`  t=${state.tick}: SPY GONE! state=${state.state} globals=[${state.globals.join(',')}]`);
            const tanya = state.units.find(u => u.t === 'E7');
            console.log(`    Tanya: ${tanya ? `(${tanya.cx},${tanya.cy})` : 'not yet'}`);
            console.log(`    Dogs nearby WEAP: ${dogs.filter(d =>
              Math.sqrt((d.cx - 44) ** 2 + (d.cy - 50) ** 2) <= 8
            ).map(d => `(${d.cx},${d.cy})`).join(', ')}`);
            // Wait for Tanya
            for (let k = 0; k < 30; k++) {
              const dk = oracle.decide(state);
              state = (await adapter.step(30, dk.commands)).state;
              const t = state.units.find(u => u.t === 'E7');
              if (t) {
                console.log(`    TANYA SPAWNED at (${t.cx},${t.cy}) tick=${state.tick}!`);
                break;
              }
            }
            break;
          }

          if (j % 3 === 0 || nearDogs.length > 0) {
            console.log(
              `  t=${state.tick}: spy(${sp.cx},${sp.cy}) hp=${sp.hp} ` +
              `dogs_6=[${nearDogs.map(d => `(${d.cx},${d.cy})`).join(',')}]`
            );
          }
        }
        break;
      }

      if (state.state === 'lost') {
        console.log(`LOST at tick ${state.tick} before reaching x=40`);
        break;
      }
    }

    expect(true).toBe(true);
  }, 300_000);
});
