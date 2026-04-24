/**
 * Phase 0.2: Divergence catalog builder.
 *
 * Runs all 7 scenarios (or SCENARIOS env var override) tick-by-tick to MAX
 * (default 100) and emits artifacts/divergence-catalog.json with per-tick
 * RNG diff data. Used as the source of truth for Phase 1 identification.
 *
 * Usage:
 *   SCENARIOS=SCG04EA MAX=30 npx playwright test scripts/build-divergence-catalog.ts
 *   MAX=300 npx playwright test scripts/build-divergence-catalog.ts          # all 7 scenarios
 *   OUT=artifacts/divergence-catalog-postfix-1.json npx playwright test ...
 *
 * Emits structured JSON the planner can diff against future runs:
 *   {
 *     "generated_at": "<iso>",
 *     "scenarios": {
 *       "SCG04EA": {
 *         "first_divergence": 24,
 *         "total_divergent_ticks": N,
 *         "ticks": [
 *           {"tick": 24, "wasm_calls": 0, "ts_calls": 1,
 *            "ts_extra": [{"tag": 11002, "tag_name": "unit[2]", "seed": ...}],
 *            "wasm_extra": []}
 *         ]
 *       }
 *     }
 *   }
 */
import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE_URL = process.env.TS_BASE_URL ?? BASE_URL;
const SCENARIOS = (process.env.SCENARIOS ?? 'SCG01EA,SCG03EA,SCG04EA,SCG06EA,SCG07EA,SCG11EA,SCG13EA').split(',');
const MAX = Number(process.env.MAX ?? 100);
const OUT = process.env.OUT ?? 'artifacts/divergence-catalog.json';

function tagName(tag: number): string {
  if (tag >= 16000 && tag < 17000) return `anim[${tag - 16000}]`;
  if (tag >= 15000 && tag < 16000) return `bullet[${tag - 15000}]`;
  if (tag >= 14000 && tag < 15000) return `vessel[${tag - 14000}]`;
  if (tag >= 13000 && tag < 14000) return `aircraft[${tag - 13000}]`;
  if (tag >= 12000 && tag < 13000) return `building[${tag - 12000}]`;
  if (tag >= 11000 && tag < 12000) return `unit[${tag - 11000}]`;
  if (tag >= 10000 && tag < 11000) return `infantry[${tag - 10000}]`;
  if (tag >= 2000 && tag < 10000) return `logic[${tag - 2000}]`;
  const granular: Record<number, string> = {
    30000: 'Mission_Guard_Area', 30001: 'RandomAnim_IdleTimer',
    30002: 'RandomAnim_switch', 30003: 'RandomAnim_facing',
    40050: 'Mission_Attack_air', 40060: 'Paradrop_Cargo',
    50001: 'Wide_Area_Damage', 50002: 'Coord_Scatter',
    60010: 'Mission_Move_foot', 60040: 'Mission_Guard_general',
    60043: 'Mission_Guard_infantry_E1E3', 60050: 'FootAI_60050',
    70003: 'Building_AI_70003',
  };
  if (granular[tag] !== undefined) return granular[tag];
  if (tag === 200) return 'Expert_AI';
  if (tag >= 100 && tag < 200) return `House_AI[${tag}]`;
  const base: Record<number, string> = {
    0: 'untagged', 1: 'TeamAI', 3: 'Map.Logic', 4: 'FactoryAI',
    5: 'House_AI_preamble', 20: 'Do_Fade_AI', 21: 'LogicTrigger',
  };
  return base[tag] ?? `tag[${tag}]`;
}

interface RngEntry { seed: number; tag: number; tag_name: string; ent_tag?: number; ent_name?: string; }
interface TickRow {
  tick: number;
  wasm_calls: number;
  ts_calls: number;
  wasm_seed: number;
  ts_seed: number;
  delta: number;          // wasm - ts
  ts_extra: RngEntry[];   // entries TS fires but WASM doesn't (at the divergent positions)
  wasm_extra: RngEntry[]; // entries WASM fires but TS doesn't
  tag_mismatches: { idx: number; wasm: RngEntry; ts: RngEntry }[];
}
interface ScenarioCatalog {
  first_divergence: number | null;
  total_divergent_ticks: number;
  total_ticks: number;
  ticks: TickRow[];
}
interface Catalog {
  generated_at: string;
  max: number;
  scenarios: Record<string, ScenarioCatalog>;
}

const catalog: Catalog = {
  generated_at: new Date().toISOString(),
  max: MAX,
  scenarios: {},
};

for (const scenario of SCENARIOS) {
  test(`build catalog: ${scenario}`, async ({ browser }) => {
    test.setTimeout(20 * 60 * 1000);

    const wasmCtx = await browser.newContext();
    const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const wasmPage = await wasmCtx.newPage();
    const tsPage = await tsCtx.newPage();
    wasmPage.on('dialog', async d => { await d.accept(); });

    console.log(`\n[${scenario}] launching engines...`);
    await Promise.all([
      wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=${scenario}.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
      tsPage.goto(`${TS_BASE_URL}?anttest=agent&scenario=${scenario}&difficulty=normal`, { waitUntil: 'load' }),
    ]);
    await Promise.all([
      wasmPage.waitForFunction(() => { try { const M=(window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; } }, { timeout: 180_000, polling: 2000 }),
      tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
    ]);
    const wasmSeed = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;
    });
    await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);
    await tsPage.evaluate(() => { (window as any).__rngTagControl('enable'); });

    const sc: ScenarioCatalog = {
      first_divergence: null,
      total_divergent_ticks: 0,
      total_ticks: MAX,
      ticks: [],
    };

    for (let tick = 1; tick <= MAX; tick++) {
      await tsPage.evaluate(() => { (window as any).__rngTagControl('reset'); });

      const [wasmStepResult] = await Promise.all([
        wasmPage.evaluate(async () => {
          const r = (window as any).__agentStep(1);
          const result = r?.then ? await r : r;
          const s = result?.state ?? result;
          return {
            tick: s.tick as number,
            seed: s.rngState as number,
            calls: s.rngCalls as number,
            log: (s.rngLog ?? []) as [number, number, number?][],
          };
        }),
        tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
      ]);

      const tsData = await tsPage.evaluate(() => {
        const r = (window as any).__rngTagControl('read');
        return {
          seed: r.seed as number,
          calls: r.callCount as number,
          log: (r.seedLog ?? []) as [number, number, number?][],
        };
      });

      const wasmLog = wasmStepResult.log;
      const tsLog = tsData.log;
      const wSeed = wasmStepResult.seed >>> 0;
      const tSeed = tsData.seed >>> 0;
      const seedMatch = wSeed === tSeed;
      const callDiff = wasmLog.length - tsLog.length;

      if (!seedMatch || callDiff !== 0) {
        if (sc.first_divergence === null) sc.first_divergence = tick;
        sc.total_divergent_ticks++;

        const wasm_extra: RngEntry[] = [];
        const ts_extra: RngEntry[] = [];
        const tag_mismatches: { idx: number; wasm: RngEntry; ts: RngEntry }[] = [];
        const maxLen = Math.max(wasmLog.length, tsLog.length);
        for (let i = 0; i < maxLen; i++) {
          const w = wasmLog[i];
          const t = tsLog[i];
          if (w && !t) {
            wasm_extra.push({ seed: w[0] >>> 0, tag: w[1], tag_name: tagName(w[1]), ent_tag: w[2], ent_name: w[2] !== undefined ? tagName(w[2]) : undefined });
          } else if (t && !w) {
            ts_extra.push({ seed: t[0] >>> 0, tag: t[1], tag_name: tagName(t[1]), ent_tag: t[2], ent_name: t[2] !== undefined ? tagName(t[2]) : undefined });
          } else if (w && t && (w[1] !== t[1] || ((w[0] >>> 0) !== (t[0] >>> 0)))) {
            tag_mismatches.push({
              idx: i,
              wasm: { seed: w[0] >>> 0, tag: w[1], tag_name: tagName(w[1]), ent_tag: w[2], ent_name: w[2] !== undefined ? tagName(w[2]) : undefined },
              ts:   { seed: t[0] >>> 0, tag: t[1], tag_name: tagName(t[1]), ent_tag: t[2], ent_name: t[2] !== undefined ? tagName(t[2]) : undefined },
            });
          }
        }

        sc.ticks.push({
          tick, wasm_calls: wasmLog.length, ts_calls: tsLog.length,
          wasm_seed: wSeed, ts_seed: tSeed, delta: callDiff,
          ts_extra, wasm_extra, tag_mismatches,
        });
      }
    }

    catalog.scenarios[scenario] = sc;
    console.log(`[${scenario}] first_divergence=${sc.first_divergence ?? 'none'}, total_divergent=${sc.total_divergent_ticks}/${MAX}`);
    await wasmCtx.close();
    await tsCtx.close();

    // Write incrementally so we don't lose all data on partial failure
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2));
  });
}
