/**
 * @vitest-environment jsdom
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { NodeAgentAdapter } from './node-agent-adapter.js';

/**
 * SCG05EA spy death analysis — tracks spy tick-by-tick through death zone.
 * Runs directly in Node.js via NodeAgentAdapter (no browser/dev server needed).
 */

describe('SCG05EA spy death analysis', () => {
  let adapter: NodeAgentAdapter;

  beforeAll(async () => {
    adapter = new NodeAgentAdapter();
  }, 30_000);

  afterAll(() => {
    adapter.disconnect();
  });

  it('tracks spy tick-by-tick through death zone', async () => {
    await adapter.loadScenario('SCG05EA');

    // Wait for spy
    let state = adapter.step(1).state;
    for (let i = 0; i < 40; i++) {
      state = adapter.step(15).state;
      if (state.units.find(u => u.t === 'SPY')) break;
    }
    const spy = state.units.find(u => u.t === 'SPY')!;
    console.log(`SPY starts at (${spy.cx},${spy.cy})`);

    // Send spy east toward (40,50)
    adapter.step(1, [
      { cmd: 'move', unitIds: [spy.id], cx: 40, cy: 50 },
    ]);

    // Track EVERY tick
    let lastCx = spy.cx, lastCy = spy.cy;
    for (let i = 0; i < 200; i++) {
      const r = adapter.step(5); // 5 ticks at a time for speed
      state = r.state;
      const s = state.units.find(u => u.t === 'SPY');

      if (!s) {
        // SPY DIED — dump all nearby units at time of death
        console.log(`\n!!! SPY DIED at tick ${state.tick} (was at ${lastCx},${lastCy}) !!!`);
        console.log(`State: ${state.state}`);
        // Show ALL units near the death point
        const allVisible = [...state.units, ...state.enemies];
        const nearUnits = allVisible.filter(u => {
          const dx = u.cx - lastCx; const dy = u.cy - lastCy;
          return dx*dx + dy*dy <= 100;
        });
        console.log(`Units near death (10 cells): ${nearUnits.map(u => `${u.t}(${u.cx},${u.cy},h=${u.h},ally=${u.ally})`).join(', ') || 'none'}`);
        const allEnemies = state.enemies;
        const closestEnemy = [...allEnemies].sort((a, b) => {
          const da = (a.cx-lastCx)**2 + (a.cy-lastCy)**2;
          const db = (b.cx-lastCx)**2 + (b.cy-lastCy)**2;
          return da - db;
        }).slice(0, 5);
        console.log(`Closest enemies: ${closestEnemy.map(u => `${u.t}(${u.cx},${u.cy}) d=${Math.sqrt((u.cx-lastCx)**2+(u.cy-lastCy)**2).toFixed(1)}`).join(', ')}`);
        break;
      }

      if (s.cx !== lastCx || s.cy !== lastCy) {
        // Spy moved — log position and nearby threats
        // Check both units AND enemies arrays
        const allVisible = [...state.units, ...state.enemies];
        const dogs = allVisible.filter(u => u.t === 'DOG');
        const nearDogs = dogs.filter(d => (d.cx-s.cx)**2 + (d.cy-s.cy)**2 <= 36);
        const allNear = allVisible.filter(u => u.h !== 'Greece' && (u.cx-s.cx)**2 + (u.cy-s.cy)**2 <= 36);
        console.log(`  tick ${state.tick}: spy (${s.cx},${s.cy}) hp=${s.hp}/${s.mhp} m="${s.m}" dogs=${nearDogs.length} near=${allNear.map(u=>`${u.t}(${u.cx},${u.cy})`).join(',') || 'none'}`);
        lastCx = s.cx;
        lastCy = s.cy;
      }
    }

    expect(true).toBe(true);
  }, 300_000);
});
