/**
 * Phase 0.1: Per-cell entity matching diff.
 *
 * Replaces test-member-state-diff.ts's index-based pairing. Matches TS/WASM
 * entities by (type, cell.cx, cell.cy) so iteration order differences don't
 * mislead the comparison. (Round-2 SCG11 showed W[1]=MCV vs T[1]=4TNK
 * because TS/WASM iterate the units array in different orders.)
 *
 * Usage:
 *   SCENARIO=SCG04EA MAX=25 TYPES=3TNK npx playwright test scripts/test-per-cell-diff.ts
 *   SCENARIO=SCG04EA MAX=25 OUT=artifacts/scg04-states.json npx playwright test scripts/test-per-cell-diff.ts
 *
 * When OUT is set, structured JSON is written: {scenario, ticks: [{tick, paired, ts_only, wasm_only}]}.
 */
import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE = process.env.TS_BASE_URL ?? BASE;
const SCENARIO = process.env.SCENARIO ?? 'SCG04EA';
const MAX = Number(process.env.MAX ?? 5);
const TYPES = (process.env.TYPES ?? '3TNK,4TNK,MCV,SS,V_LST,TRAN,APC,1TNK,2TNK,ARTY,JEEP,V_HARV,LST,MNLY,DD,SUB,MSUB,GBOAT,CRUISER,CARRIER')
  .split(',').map(s => s.trim()).filter(Boolean);
const OUT = process.env.OUT;

interface UnitState {
  id: number; type: string; cx: number; cy: number;
  mission: number; mt: number; mq: number; drv: boolean;
  arm: number; tlx?: number; tly?: number; nlx?: number; nly?: number;
}

const MISSION_NAMES = ['SLEEP','ATTACK','MOVE','QMOVE','RETREAT','GUARD','STICKY',
  'ENTER','CAPTURE','HARVEST','AREA_GUARD','RETURN','STOP','AMBUSH','HUNT',
  'UNLOAD','SABOTAGE','CONSTRUCTION','DECONSTRUCTION','REPAIR','RESCUE','MISSILE','HARMLESS'];
const fmtMission = (m: any): string =>
  typeof m === 'string' ? m : (MISSION_NAMES[m] ?? `?${m}`);

function key(u: UnitState): string {
  return `${u.type}@${u.cx},${u.cy}`;
}

test(`${SCENARIO} per-cell state diff ticks 1-${MAX}`, async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);
  const wCtx = await browser.newContext();
  const tCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wp = await wCtx.newPage();
  const tp = await tCtx.newPage();
  wp.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wp.goto(`${BASE}/ra/original.html?scenario=${SCENARIO}.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tp.goto(`${TS_BASE}?anttest=agent&scenario=${SCENARIO}&difficulty=normal`, { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wp.waitForFunction(() => { try { const M=(window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; } }, { timeout: 180_000, polling: 2000 }),
    tp.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);
  const wSeed = await wp.evaluate(() => {
    const M = (window as any).Module;
    return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;
  });
  await tp.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wSeed);

  const collect = async (page: any, isWasm: boolean): Promise<UnitState[]> => {
    return await page.evaluate((wasm: boolean) => {
      if (wasm) {
        const M = (window as any).Module;
        const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
        return (s.units ?? [])
          .concat(s.infantry ?? [])
          .concat(s.vessels ?? [])
          .concat(s.enemies ?? [])
          .concat(s.aircraft ?? [])
          .concat(s.neutrals ?? [])
          .map((u: any) => ({
            id: u.id, type: u.t ?? '', cx: u.cx ?? 0, cy: u.cy ?? 0,
            mission: u.m ?? 0, mt: u.mt ?? 0, mq: u.mq ?? -1, drv: u.drv ?? false,
            arm: u.arm ?? 0, tlx: u.tlx, tly: u.tly, nlx: u.nlx, nly: u.nly,
          }));
      } else {
        const g = (window as any).__agentGame;
        if (!g) return [];
        return g.entities.filter((e: any) => e.alive).map((e: any) => ({
          id: e.id, type: String(e.type ?? ''), cx: e.cell?.cx ?? 0, cy: e.cell?.cy ?? 0,
          mission: e.mission ?? 0, mt: e.missionTimer ?? 0,
          mq: e.missionQueue ?? -1, drv: !!e.isDriving,
          arm: e.attackCooldown ?? 0,
          tlx: e.target?.leptonX, tly: e.target?.leptonY,
          nlx: e.moveTarget?.lx, nly: e.moveTarget?.ly,
        }));
      }
    }, isWasm);
  };

  const out: any = { scenario: SCENARIO, types: TYPES, ticks: [] };

  console.log(`\n=== ${SCENARIO} per-cell state diff (cell-keyed) ===\n`);

  for (let t = 1; t <= MAX; t++) {
    await Promise.all([
      wp.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tp.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
    const [wUnits, tUnits] = await Promise.all([collect(wp, true), collect(tp, false)]);

    const filtered = (us: UnitState[]) =>
      TYPES.length === 0 ? us : us.filter(u => TYPES.some(ty => (u.type ?? '').includes(ty)));

    const wF = filtered(wUnits);
    const tF = filtered(tUnits);

    const wMap = new Map<string, UnitState>();
    for (const u of wF) wMap.set(key(u), u);
    const tMap = new Map<string, UnitState>();
    for (const u of tF) tMap.set(key(u), u);

    const allKeys = new Set<string>([...wMap.keys(), ...tMap.keys()]);
    const sortedKeys = [...allKeys].sort();

    const paired: any[] = [];
    const wasmOnly: UnitState[] = [];
    const tsOnly: UnitState[] = [];

    console.log(`--- tick ${t} ---`);
    for (const k of sortedKeys) {
      const w = wMap.get(k);
      const tt = tMap.get(k);
      if (w && tt) {
        const diff =
          w.mission !== tt.mission ||
          w.mq !== tt.mq ||
          w.drv !== tt.drv ||
          (w.nlx ?? -1) !== (tt.nlx ?? -1) ||
          (w.nly ?? -1) !== (tt.nly ?? -1);
        const fmt = (u: UnitState) =>
          `m=${fmtMission(u.mission).padEnd(10)} mq=${u.mq<0?'--':fmtMission(u.mq).padEnd(6)} mt=${String(u.mt).padStart(3)} drv=${u.drv?'T':'F'} nav=${u.nlx??'-'},${u.nly??'-'}`;
        if (diff) {
          console.log(`  ${k.padEnd(20)}  W: ${fmt(w)}`);
          console.log(`  ${''.padEnd(20)}  T: ${fmt(tt)}  << DIFFER`);
        }
        paired.push({ key: k, wasm: w, ts: tt, diff });
      } else if (w) {
        wasmOnly.push(w);
        console.log(`  ${k.padEnd(20)}  WASM-only`);
      } else if (tt) {
        tsOnly.push(tt);
        console.log(`  ${k.padEnd(20)}  TS-only`);
      }
    }

    out.ticks.push({
      tick: t,
      paired_count: paired.length,
      diff_count: paired.filter(p => p.diff).length,
      wasm_only_count: wasmOnly.length,
      ts_only_count: tsOnly.length,
      paired: paired.filter(p => p.diff),
      wasm_only: wasmOnly,
      ts_only: tsOnly,
    });
  }

  if (OUT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(`\nWrote ${OUT} (${out.ticks.length} ticks)`);
  }

  await wCtx.close(); await tCtx.close();
});
