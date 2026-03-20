import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { TsAgentAdapter } from '../oracle/TsAgentAdapter.js';
import type { AgentState, AgentUnit } from '../engine/agentHarness.js';

/**
 * SCG05EA spy diagnostic — figure out why the spy gets stuck at (14,54).
 */

const BASE_URL = process.env.RA_PARITY_BASE_URL ?? 'http://localhost:3001';

describe('SCG05EA spy debug', () => {
  let adapter: TsAgentAdapter;

  beforeAll(async () => {
    adapter = new TsAgentAdapter({ url: BASE_URL, headless: true });
    await adapter.connect();
  }, 120_000);

  afterAll(async () => {
    await adapter.disconnect();
  }, 20_000);

  it('dumps spy state over time to find stuck cause', async () => {
    const state0 = await adapter.loadScenario('SCG05EA');
    console.log(`[t=0] units=${state0.units.length} state=${state0.state}`);

    // Step until spy appears
    let state = state0;
    for (let i = 0; i < 40; i++) {
      const result = await adapter.step(15);
      state = result.state;
      const spy = state.units.find((u) => u.t === 'SPY');
      const lst = state.units.find((u) => u.t === 'LST');
      if (spy) {
        console.log(`[t=${state.tick}] SPY found: pos=(${spy.cx},${spy.cy}) mission="${spy.m}" hp=${spy.hp} ally=${spy.ally} house="${spy.h}"`);
        if (lst) console.log(`  LST at (${lst.cx},${lst.cy}) mission="${lst.m}" cargo=${lst.cargo}`);
        // Dump ALL spy fields
        console.log(`  SPY full:`, JSON.stringify(spy));
        break;
      }
      if (i % 10 === 0) {
        console.log(`[t=${state.tick}] no spy yet, units=${state.units.length} (${state.units.map(u=>u.t).join(',')})`);
      }
    }

    // Now track spy movement for 100 steps
    for (let i = 0; i < 100; i++) {
      const result = await adapter.step(15);
      state = result.state;
      const spy = state.units.find((u) => u.t === 'SPY');
      if (!spy) {
        console.log(`[t=${state.tick}] SPY GONE (infiltrated or dead?)`);
        console.log(`  globals=${state.globals.join(',')}`);
        break;
      }
      if (i % 5 === 0) {
        const dogs = state.units.filter((u) => !u.ally && u.t === 'DOG');
        const nearDogs = dogs.filter(d => {
          const dx = d.cx - spy.cx;
          const dy = d.cy - spy.cy;
          return dx*dx + dy*dy <= 100;
        });
        console.log(`[t=${state.tick}] SPY (${spy.cx},${spy.cy}) m="${spy.m}" target=(${spy.mtx},${spy.mty}) tid=${spy.tid} dogs_near=${nearDogs.length} dogs_total=${dogs.length}`);
      }
    }

    // Probe passable terrain — try moving in all directions with enough time
    const spy = state.units.find((u) => u.t === 'SPY');
    if (spy) {
      console.log(`\n--- Terrain probe from (${spy.cx},${spy.cy}) ---`);

      // Test east route (the likely correct path)
      // Send spy to WEAP in one shot and track tick by tick
      const eastTargets = [
        { cx: 43, cy: 48, label: 'WEAP approach' },
      ];

      // Send move command once, then track spy position each tick
      // Test multiple routes: south→east, direct east at y=52
      const routes = [
        { label: 'south to y=55', cx: 18, cy: 55 },
        { label: 'direct to WEAP', cx: 43, cy: 50 },
      ];
      // Route: south past dogs (y≥57), east inland, north to WEAP
      // Dogs at (24,54) and (23,55) — need y≥58 to clear them by >3 cells
      const legs = [
        { cx: 18, cy: 58, label: 'south past dogs' },
        { cx: 30, cy: 58, label: 'east at y=58' },
        { cx: 40, cy: 55, label: 'NE toward base' },
        { cx: 43, cy: 50, label: 'WEAP' },
      ];

      for (const leg of legs) {
        console.log(`--- Leg: ${leg.label} → (${leg.cx},${leg.cy}) ---`);
        await adapter.step(1, [
          { cmd: 'move', unitIds: [spy.id], cx: leg.cx, cy: leg.cy },
        ]);
        let arrived = false;
        for (let j = 0; j < 40; j++) {
          const r = await adapter.step(15);
          const s2 = r.state.units.find((u) => u.t === 'SPY');
          if (!s2) {
            console.log(`  SPY GONE at step ${j}! state=${r.state.state} globals=${r.state.globals.join(',')}`);
            break;
          }
          if (j % 5 === 0) {
            const enemies = r.state.units.filter((u) => !u.ally);
            const near = enemies.filter(e => {
              const dx = e.cx - s2.cx; const dy = e.cy - s2.cy;
              return dx*dx + dy*dy <= 49;
            });
            console.log(`  [${j}] (${s2.cx},${s2.cy}) m="${s2.m}" near=[${near.map(e=>`${e.t}(${e.cx},${e.cy})`).join(',')}]`);
          }
          if (s2.m === 'GUARD' || s2.m === 'AREA_GUARD') {
            console.log(`  Arrived at (${s2.cx},${s2.cy})`);
            arrived = true;
            break;
          }
        }
        if (!arrived) {
          const s3 = (await adapter.step(1)).state.units.find((u) => u.t === 'SPY');
          if (!s3) { console.log('  SPY GONE during wait'); break; }
          console.log(`  Timeout at (${s3.cx},${s3.cy})`);
        }
      }

      for (let i = 0; i < 5; i++) {
        const result = await adapter.step(15);
        const s = result.state.units.find((u) => u.t === 'SPY');
        if (!s) {
          // Check if any enemy structure was infiltrated (spy consumed)
          const globals = result.state.globals;
          console.log(`  [+${(i+1)*15}] SPY GONE! globals=${globals.join(',')} state=${result.state.state}`);
          // Check which structures still exist near the spy's last known position
          const nearStructs = result.state.structures.filter(st => !st.ally);
          console.log(`  Enemy structs near death: ${nearStructs.filter(st => st.cx < 30 && st.cy < 55).map(st => `${st.t}(${st.cx},${st.cy})`).join(', ')}`);
          break;
        }
        if (i % 3 === 0) {
          console.log(`  [+${(i+1)*15}] spy (${s.cx},${s.cy}) m="${s.m}" tid=${s.tid} mtx=${s.mtx} mty=${s.mty}`);
        }
      }
    }

    expect(true).toBe(true);
  }, 300_000);
});
