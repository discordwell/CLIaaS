/**
 * First-divergence finder — for each scenario, report the tick# where
 * WASM and TS first disagree on (RNG call count OR post-tick seed).
 *
 * Usage:
 *   npx playwright test scripts/test-first-divergence.ts --reporter=list
 *   SCENARIOS=SCG04EA,SCG11EA MAX=500 npx playwright test scripts/test-first-divergence.ts
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE_URL = process.env.TS_BASE_URL ?? BASE_URL;
const ALL = ['SCG01EA','SCG03EA','SCG04EA','SCG06EA','SCG07EA','SCG11EA','SCG13EA'];
const scenarios = process.env.SCENARIOS?.split(',') ?? ALL;
const maxTicks = Number(process.env.MAX ?? 500);
const HARNESS_SALT = process.env.HARNESS_SALT ?? 'anti-shim-v1';
// agent_harness.cpp currently serializes at most this many per-tick RNG log
// entries. When C++ hits the cap, a matching seed is authoritative but a shorter
// C++ log length is not.
const WASM_RNG_LOG_CAP = 1024;

const MULT_CONSTANT = 0x41C64E6D;
const ADD_CONSTANT = 0x00003039;

function nextScenarioSeed(seed: number): number {
  return (Math.imul(seed >>> 0, MULT_CONSTANT) + ADD_CONSTANT) >>> 0;
}

function filterScenarioRngLog(log: Array<[number, number, number?]>, startSeed: number): Array<[number, number, number?]> {
  const filtered: Array<[number, number, number?]> = [];
  let seed = startSeed >>> 0;
  for (const entry of log) {
    const expected = nextScenarioSeed(seed);
    if ((entry[0] >>> 0) === expected) {
      filtered.push(entry);
      seed = expected;
    }
  }
  return filtered;
}

function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function addHarnessNoise(url: URL, scenario: string, side: 'wasm' | 'ts'): string {
  const hash = hashText(`${HARNESS_SALT}:${scenario}:${side}`);
  url.searchParams.set('__parityHarness', 'salted');
  url.searchParams.set('__parityToken', hash.toString(36));
  url.searchParams.set('__paritySide', side);
  url.searchParams.set('__noop', `${(hash >>> 7) % 997}`);
  return url.toString();
}

function wasmUrl(baseUrl: string, scenario: string): string {
  const url = new URL('/ra/original.html', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.searchParams.set('scenario', `${scenario}.INI`);
  url.searchParams.set('autoplay', '1');
  url.searchParams.set('agentharness', '1');
  url.searchParams.set('seed', '0');
  return addHarnessNoise(url, scenario, 'wasm');
}

function tsUrl(baseUrl: string, scenario: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('anttest', 'agent');
  url.searchParams.set('scenario', scenario);
  url.searchParams.set('difficulty', 'normal');
  return addHarnessNoise(url, scenario, 'ts');
}

for (const scenario of scenarios) {
  test(`${scenario} first divergence`, async ({ browser }) => {
    test.setTimeout(5 * 60 * 1000);
    const wasmCtx = await browser.newContext();
    const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const wp = await wasmCtx.newPage();
    const tp = await tsCtx.newPage();
    wp.on('dialog', async d => { await d.accept(); });

    await Promise.all([
      wp.goto(wasmUrl(BASE_URL, scenario), { waitUntil: 'load' }),
      tp.goto(tsUrl(TS_BASE_URL, scenario), { waitUntil: 'load' }),
    ]);
    const [wasmReady] = await Promise.all([
      wp.waitForFunction(() => {
        try {
          const M = (window as any).Module;
          if (!M?.ccall) return false;
          const s = JSON.parse(M.ccall('agent_get_state', 'string', [], []));
          if (s.error) {
            return document.title.includes('SCENARIO_FAILED') ? { error: s.error } : false;
          }
          const count = (s.units?.length ?? 0) + (s.enemies?.length ?? 0) + (s.structures?.length ?? 0);
          return count > 0 ? { count } : false;
        } catch { return false; }
      }, { timeout: 180_000, polling: 2000 }),
      tp.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
    ]);
    const wasmReadyState = await wasmReady.jsonValue() as { count?: number; error?: string };
    if (wasmReadyState.error) {
      throw new Error(`${scenario}: WASM scenario did not load: ${wasmReadyState.error}`);
    }
    const wasmSeed = await wp.evaluate(() => {
      const M = (window as any).Module;
      return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;
    });
    await tp.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);
    let wasmScenarioSeed = wasmSeed >>> 0;

    // Enable TS tag logging so __rngTagControl('read') returns per-tick log.
    await tp.evaluate(() => { (window as any).__rngTagControl?.('enable'); });

    let firstDivergentTick = -1;
    let divergenceReason = '';
    let cappedRngTicks = 0;
    for (let tick = 1; tick <= maxTicks; tick++) {
      // Reset TS log before the step so the read returns only this tick's
      // entries (WASM's agent_get_state resets its log after each read).
      await tp.evaluate(() => { (window as any).__rngTagControl?.('reset'); });
      const [wRes, _] = await Promise.all([
        wp.evaluate(async () => {
          const r = (window as any).__agentStep(1);
          const res = r?.then ? await r : r;
          const s = res?.state ?? res;
          return { seed: s.rngState as number, calls: s.rngCalls as number, log: s.rngLog ?? [] };
        }),
        tp.evaluate(() => { (window as any).__agentStep?.(1); }),
      ]);
      const wScenarioLog = filterScenarioRngLog(wRes.log as Array<[number, number, number?]>, wasmScenarioSeed);
      const tRes = await tp.evaluate(() => {
        const r = (window as any).__rngTagControl?.('read') ?? { seed: 0, seedLog: [] };
        return { seed: r.seed as number, log: r.seedLog ?? [] };
      });
      const seedMatch = (wRes.seed >>> 0) === (tRes.seed >>> 0);
      const callDiff = wScenarioLog.length - tRes.log.length;
      const wasmLogCapped = (wRes.log as unknown[]).length >= WASM_RNG_LOG_CAP;
      const callCountReliable = !(seedMatch && wasmLogCapped);
      if (wasmLogCapped) cappedRngTicks++;
      if (!seedMatch || (callCountReliable && callDiff !== 0)) {
        firstDivergentTick = tick;
        const rawNote = wScenarioLog.length === wRes.log.length ? '' : ` rawWASM=${wRes.log.length}`;
        const capNote = wasmLogCapped ? ` wasmLogCap=${WASM_RNG_LOG_CAP}` : '';
        divergenceReason = `WASM(${wScenarioLog.length}, seed=${wRes.seed >>> 0}) TS(${tRes.log.length}, seed=${tRes.seed >>> 0}) Δcalls=${callDiff}${rawNote}${capNote}`;
        break;
      }
      wasmScenarioSeed = wRes.seed >>> 0;
    }
    if (firstDivergentTick === -1) {
      const capNote = cappedRngTicks > 0 ? ` (${cappedRngTicks} capped C++ RNG log tick${cappedRngTicks === 1 ? '' : 's'} compared by seed)` : '';
      console.log(`${scenario}: no divergence in ${maxTicks} ticks ✓${capNote}`);
    } else {
      console.log(`${scenario}: first divergence @ tick ${firstDivergentTick} — ${divergenceReason}`);
    }
    await wasmCtx.close();
    await tsCtx.close();
  });
}
