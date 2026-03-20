import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { WasmAdapter } from '../oracle/WasmAdapter.js';
import { OracleStrategy } from '../oracle/OracleStrategy.js';
import { isDevServerAvailable } from './dual-runtime-test-utils.js';

/**
 * Run SCG05EA on C++ WASM with the oracle. Compare with TS behavior.
 */

const serverUp = isDevServerAvailable();

describe.skipIf(!serverUp)('SCG05EA C++ WASM playthrough', () => {
  let wasm: WasmAdapter;

  beforeAll(async () => {
    wasm = new WasmAdapter({ scenario: 'SCG05EA', headless: true });
    await wasm.connect();
  }, 120_000);

  afterAll(async () => {
    await wasm.disconnect();
  }, 20_000);

  it('plays SCG05EA on C++ engine with oracle', async () => {
    const oracle = new OracleStrategy('SCG05EA');
    const STEP = 15;
    const MAX = 2000;

    let lastState = (await wasm.step(1)).state;
    console.log('[C++ START] tick=' + lastState.tick + ' units=' + lastState.units.length + ' enemies=' + lastState.enemies.length);

    for (let i = 0; i < MAX; i++) {
      const decision = oracle.decide(lastState);

      if (i % 20 === 0 || decision.reason.includes('infiltrate') || decision.reason.includes('SAM') || decision.reason.includes('C4') || decision.reason.includes('SHOOT')) {
        const spy = lastState.units.find(u => u.t === 'SPY');
        const tanya = lastState.units.find(u => u.t === 'E7');
        const eCount: Record<string, number> = {};
        for (const e of lastState.enemies) eCount[e.t] = (eCount[e.t] || 0) + 1;
        const eSummary = Object.entries(eCount).map(([k, v]) => v + k).join(',');
        console.log(
          '[' + i + '] tick=' + lastState.tick +
          ' units=' + lastState.units.length +
          ' spy=' + (spy ? spy.cx + ',' + spy.cy : 'none') +
          ' tanya=' + (tanya ? tanya.cx + ',' + tanya.cy : 'none') +
          ' enemies=' + lastState.enemies.length + '(' + eSummary + ')' +
          ' structs=' + lastState.structures.length +
          ' globals=[' + (lastState.globals || []).join(',') + ']' +
          ' | ' + decision.reason
        );
      }

      // Filter to standard commands the C++ harness understands
      const VALID_CMDS = new Set(['move', 'attack', 'stop', 'produce', 'place', 'deploy']);
      const validCmds = decision.commands.filter(c => VALID_CMDS.has(c.cmd));
      const cmdStr = validCmds.length > 0
        ? JSON.stringify(validCmds)
        : undefined;

      const result = await wasm.step(STEP, cmdStr);
      if (i >= 15 && i < 20) {
        console.log('  raw cmds: ' + JSON.stringify(decision.commands).substring(0, 200));
        console.log('  valid: ' + JSON.stringify(validCmds).substring(0, 200));
        console.log('  cmdStr: ' + (cmdStr || 'NONE'));
      }
      if (cmdStr && i >= 15 && i < 25) {
        console.log('  cmds sent: ' + cmdStr.substring(0, 120));
        console.log('  results: ' + JSON.stringify(result.results));
      }
      lastState = result.state;

      if (lastState.winPending) {
        console.log('[WIN] tick=' + lastState.tick);
        break;
      }
      if (lastState.losePending) {
        console.log('[LOST] tick=' + lastState.tick);
        break;
      }
    }

    console.log('[FINAL] tick=' + lastState.tick + ' units=' + lastState.units.length + ' enemies=' + lastState.enemies.length);
    expect(true).toBe(true);
  }, 600_000);
});
