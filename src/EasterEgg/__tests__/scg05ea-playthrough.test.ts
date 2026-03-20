import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { TsAgentAdapter } from '../oracle/TsAgentAdapter.js';
import { SharedTsOracleStrategy } from '../oracle/SharedOracleBridge.js';
import type { AgentState } from '../engine/agentHarness.js';

/**
 * SCG05EA live playthrough — runs the oracle against the real TS engine.
 * Requires dev server at localhost:3001.
 */

const BASE_URL = process.env.RA_PARITY_BASE_URL ?? 'http://localhost:3001';
const STEP_TICKS_NORMAL = 15;
const STEP_TICKS_MICRO = 5; // Smaller steps when Tanya is alive for responsive micro
const MAX_ITERATIONS = 4000;
const LOG_EVERY = 10;

describe('SCG05EA live playthrough', () => {
  let adapter: TsAgentAdapter;
  let oracle: SharedTsOracleStrategy;

  beforeAll(async () => {
    adapter = new TsAgentAdapter({ url: BASE_URL, headless: true });
    await adapter.connect();
  }, 120_000);

  afterAll(async () => {
    await adapter.disconnect();
  }, 20_000);

  it('plays SCG05EA to completion or reveals failure point', async () => {
    oracle = new SharedTsOracleStrategy('SCG05EA');
    const state = await adapter.loadScenario('SCG05EA');
    console.log(`[START] tick=${state.tick} units=${state.units.length} structs=${state.structures.length}`);

    let lastState = state;
    let outcome = 'playing';

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const decision = oracle.decide(lastState);
      const note = oracle.summarize(lastState, i, decision);

      if (i % LOG_EVERY === 0 || note.includes('infiltrate') || note.includes('SAM') || note.includes('chinook')) {
        const spy = lastState.units.find((u) => u.t === 'SPY');
        const tanya = lastState.units.find((u) => u.t === 'E7');
        const dogs = lastState.enemies.filter((u: { t: string }) => u.t === 'DOG');
        console.log(
          `[${i}] tick=${lastState.tick} ` +
          `units=${lastState.units.length} enemies=${lastState.structures.filter(s => !s.ally).length}s ` +
          `spy=${spy ? `(${spy.cx},${spy.cy})` : 'none'} ` +
          `tanya=${tanya ? `(${tanya.cx},${tanya.cy})` : 'none'} ` +
          `lst=${lastState.units.find((u: {t:string}) => u.t === 'LST') ? `(${lastState.units.find((u: {t:string}) => u.t === 'LST')!.cx},${lastState.units.find((u: {t:string}) => u.t === 'LST')!.cy})` : ''} ` +
          `dogs=${dogs.length}` +
          (spy ? ` near=[${dogs.filter((d: { cx: number; cy: number }) => {
            const dx = d.cx - spy.cx, dy = d.cy - spy.cy;
            return dx*dx + dy*dy <= 36;
          }).map((d: { cx: number; cy: number }) => `(${d.cx},${d.cy})`).join(',')}]` : '') +
          ` | ${note}`,
        );
        if (decision.warnings.length > 0) {
          console.log(`  WARNINGS: ${decision.warnings.join(', ')}`);
        }
      }

      // Log infiltrate commands
      const hasAttack = decision.commands.some((c: { cmd: string }) => c.cmd === 'attack' || c.cmd === 'attack_struct');
      if (hasAttack) {
        console.log(`  CMD: ${JSON.stringify(decision.commands)}`);
      }
      // Use smaller steps when Tanya is alive for responsive micro
      const hasTanya = lastState.units.some((u: { t: string }) => u.t === 'E7');
      const stepTicks = hasTanya ? STEP_TICKS_MICRO : STEP_TICKS_NORMAL;
      const stepResult = await adapter.step(stepTicks, decision.commands);
      // After infiltrate command, dump browser console and enable trigger debug
      if (hasAttack) {
        const logs = adapter.getLogs();
        const harnessLogs = logs.filter(l => l.includes('HARNESS') || l.includes('SPY') || l.includes('infiltrat'));
        if (harnessLogs.length > 0) {
          for (const l of harnessLogs) console.log(`  BROWSER: ${l}`);
          // Dump trigger 42 and nearby triggers to verify indexing
          const allTrigs = (stepResult.state as unknown as { triggers?: Array<{ name: string; fired: boolean }> }).triggers ?? [];
          console.log(`  Total triggers: ${allTrigs.length}`);
          if (allTrigs.length > 42) {
            console.log(`  Trigger[42]: ${JSON.stringify(allTrigs[42])}`);
            console.log(`  Trigger[41]: ${JSON.stringify(allTrigs[41])}`);
            console.log(`  Trigger[43]: ${JSON.stringify(allTrigs[43])}`);
          }
          // Also find spy2 by name
          const spy2ByName = allTrigs.findIndex(t => t.name === 'spy2');
          console.log(`  spy2 index by name: ${spy2ByName}`);
          // Check SPYS action1 trigger field
          const spysTrig = allTrigs.find(t => t.name === 'SPYS') as { a1: number; a1d: number } | undefined;
          console.log(`  SPYS.a1=${spysTrig?.a1} (force-fires trigger idx: from INI field)`);
        }
        if (stepResult.state.globals.length > 1) {
          console.log(`  GLOBALS CHANGED: [${stepResult.state.globals.join(',')}]`);
        }
      }
      lastState = stepResult.state;

      // Check for command errors
      const errors = stepResult.results.filter((r) => !r.ok);
      if (errors.length > 0 && i % LOG_EVERY === 0) {
        console.log(`  CMD ERRORS: ${JSON.stringify(errors)}`);
      }

      if (lastState.state === 'won') {
        outcome = 'won';
        console.log(`[WIN] tick=${lastState.tick} iteration=${i}`);
        break;
      }
      if (lastState.state === 'lost') {
        outcome = 'lost';
        console.log(`[LOST] tick=${lastState.tick} iteration=${i}`);
        console.log(`  Units remaining: ${lastState.units.map(u => `${u.t}(${u.cx},${u.cy})`).join(', ')}`);
        break;
      }
    }

    if (outcome === 'playing') {
      console.log(`[TIMEOUT] tick=${lastState.tick} after ${MAX_ITERATIONS} iterations`);
      console.log(`  Units: ${lastState.units.map(u => `${u.t}(${u.cx},${u.cy})`).join(', ')}`);
      console.log(`  Enemy structs: ${lastState.structures.filter(s => !s.ally).map(s => `${s.t}(${s.cx},${s.cy})`).join(', ')}`);
    }

    // Log final state regardless
    console.log(`[FINAL] outcome=${outcome} tick=${lastState.tick} credits=${lastState.credits}`);

    // We don't assert win — this test is diagnostic, not pass/fail
    expect(outcome).toBeDefined();
  }, 600_000); // 10 min timeout
});
