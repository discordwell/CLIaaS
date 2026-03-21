import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { WasmAdapter } from '../oracle/WasmAdapter.js';
import { isDevServerAvailable } from './dual-runtime-test-utils.js';

const serverUp = isDevServerAvailable();

describe.skipIf(!serverUp)('SCG05EA C++ terrain passability', () => {
  let wasm: WasmAdapter;

  beforeAll(async () => {
    wasm = new WasmAdapter({ scenario: 'SCG05EA', headless: true });
    await wasm.connect();
  }, 120_000);

  afterAll(async () => {
    await wasm.disconnect();
  }, 20_000);

  it('probes passability by moving a unit to each cell', async () => {
    // Get initial state
    let s = (await wasm.step(300)).state;
    const spy = s.units.find(u => u.t === 'SPY');
    if (!spy) { console.log('NO SPY'); return; }

    console.log('Spy at: ' + spy.cx + ',' + spy.cy);

    // For each cell in the blocked zone, try to move the spy there
    // and see if it arrives (indicating passable) or stays (blocked)
    console.log('\nC++ passability probe (y=95-108, x=14-25):');
    console.log('P = passable (spy moved), X = blocked, . = not tested');

    for (let y = 95; y <= 108; y++) {
      let row = 'y=' + String(y).padStart(3) + ': ';
      for (let x = 14; x <= 25; x++) {
        // Move spy to (x, y)
        const cmd = JSON.stringify([{cmd: 'move', ids: [spy.id], cx: x, cy: y}]);
        await wasm.step(1, cmd);
        // Wait 200 ticks for it to arrive
        s = (await wasm.step(200)).state;
        const sp = s.units.find(u => u.t === 'SPY');
        if (!sp) { row += 'D '; continue; } // died
        const arrived = Math.abs(sp.cx - x) <= 1 && Math.abs(sp.cy - y) <= 1;
        row += arrived ? 'P ' : 'X ';
        // Move spy back to starting position for next test
        const reset = JSON.stringify([{cmd: 'move', ids: [sp.id], cx: 16, cy: 49}]);
        await wasm.step(1, reset);
        s = (await wasm.step(300)).state; // wait to return
      }
      console.log(row);
    }

    expect(true).toBe(true);
  }, 600_000);
});
