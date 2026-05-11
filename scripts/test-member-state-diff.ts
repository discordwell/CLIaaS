/**
 * Per-member Mission state diff — compare WASM and TS entity states tick-by-tick.
 *
 * Usage:
 *   SCENARIO=SCG04EA MAX=10 TYPES=3TNK npx playwright test scripts/test-member-state-diff.ts
 */
import { test } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE = process.env.TS_BASE_URL ?? BASE;
const SCENARIO = process.env.SCENARIO ?? 'SCG04EA';
const START = Number(process.env.START ?? 0);
const MAX = Number(process.env.MAX ?? 5);
const TYPES = (process.env.TYPES ?? '3TNK,4TNK,MCV,SS,V_LST,TRAN,APC,1TNK,2TNK,ARTY,JEEP')
  .split(',').map(s => s.trim());

interface UnitState {
  id: number; type: string; house?: string; cell: [number, number];
  mission: number; mt: number; mq: number; drv: boolean;
  arm: number; tlx?: number; tly?: number; nlx?: number; nly?: number;
}

// C++ mission.h MissionType enum:
// 0=SLEEP, 1=ATTACK, 2=MOVE, 3=QMOVE, 4=RETREAT, 5=GUARD, 6=STICKY,
// 7=ENTER, 8=CAPTURE, 9=HARVEST, 10=AREA_GUARD, 11=RETURN, 12=STOP,
// 13=AMBUSH, 14=HUNT, 15=UNLOAD, 16=SABOTAGE, 17=CONSTRUCTION,
// 18=DECONSTRUCTION, 19=REPAIR, 20=RESCUE, 21=MISSILE, 22=HARMLESS
const MISSION_NAMES = ['SLEEP','ATTACK','MOVE','QMOVE','RETREAT','GUARD','STICKY',
  'ENTER','CAPTURE','HARVEST','AREA_GUARD','RETURN','STOP','AMBUSH','HUNT',
  'UNLOAD','SABOTAGE','CONSTRUCTION','DECONSTRUCTION','REPAIR','RESCUE','MISSILE','HARMLESS'];
function fmtMission(m: any): string {
  if (typeof m === 'string') return m;
  return MISSION_NAMES[m] ?? `?${m}`;
}

test(`${SCENARIO} per-member state diff ticks ${START}-${START + MAX}`, async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
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

  if (START > 0) {
    let remaining = START;
    while (remaining > 0) {
      const batch = Math.min(300, remaining);
      await Promise.all([
        wp.evaluate(async (n: number) => { const r = (window as any).__agentStep(n); if (r?.then) await r; }, batch),
        tp.evaluate((n: number) => { (window as any).__agentStep?.(n); }, batch),
      ]);
      remaining -= batch;
    }
  }

  const collect = async (page: any, engine: 'W'|'T'): Promise<UnitState[]> => {
    return await page.evaluate((isWasm: boolean) => {
      if (isWasm) {
        const M = (window as any).Module;
        const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
        return (s.units ?? [])
          .concat(s.infantry ?? [])
          .concat(s.vessels ?? [])
          .concat(s.enemies ?? [])
          .concat(s.aircraft ?? [])
          .concat(s.neutrals ?? [])
          .map((u: any) => ({
            id: u.id, type: u.t ?? '', house: String(u.h ?? u.house ?? ''), cell: [u.cx ?? 0, u.cy ?? 0],
            mission: u.m ?? 0, mt: u.mt ?? 0, mq: u.mq ?? -1, drv: u.drv ?? false,
            arm: u.arm ?? 0, tlx: u.tlx, tly: u.tly, nlx: u.nlx, nly: u.nly,
          }));
      } else {
        const g = (window as any).__agentGame;
        if (!g) return [];
        return g.entities.filter((e: any) => e.alive).map((e: any) => ({
          id: e.id, type: String(e.type ?? ''), house: String(e.house ?? ''), cell: [e.cell?.cx ?? 0, e.cell?.cy ?? 0],
          mission: e.mission ?? 0, mt: e.missionTimer ?? 0,
          mq: e.missionQueue ?? -1, drv: !!e.isDriving,
          arm: e.attackCooldown ?? 0,
          tlx: e.target?.leptonX, tly: e.target?.leptonY,
          nlx: e.moveTarget?.lx, nly: e.moveTarget?.ly,
        }));
      }
    }, engine === 'W');
  };

  console.log(`\n=== ${SCENARIO} per-member state diff ===\n`);

  for (let t = START + 1; t <= START + MAX; t++) {
    await Promise.all([
      wp.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tp.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
    const [wUnits, tUnits] = await Promise.all([collect(wp, 'W'), collect(tp, 'T')]);
    if (t === 1) {
      const uniqW = Array.from(new Set(wUnits.map(u => u.type)));
      const uniqT = Array.from(new Set(tUnits.map(u => u.type)));
      console.log('WASM types:', uniqW.join(', '));
      console.log('TS   types:', uniqT.join(', '));
    }
    const filtered = (us: UnitState[]) => us.filter(u => TYPES.some(ty => (u.type ?? '').includes(ty)));
    const wF = filtered(wUnits), tF = filtered(tUnits);
    console.log(`--- tick ${t} ---`);
    const maxN = Math.max(wF.length, tF.length);
    for (let i = 0; i < maxN; i++) {
      const w = wF[i], tS = tF[i];
      const fmt = (u?: UnitState) => u ? `#${u.id} ${u.type.padEnd(5)} ${String(u.house ?? '').padEnd(7)} c=(${u.cell[0]},${u.cell[1]}) m=${fmtMission(u.mission).padEnd(10)} mq=${u.mq<0?'--':fmtMission(u.mq).padEnd(5)} mt=${String(u.mt).padStart(3)} drv=${u.drv?'T':'F'} nlx=${u.nlx??'-'} nly=${u.nly??'-'}` : '---';
      console.log(`  W[${i}]: ${fmt(w)}`);
      console.log(`  T[${i}]: ${fmt(tS)}`);
    }
  }
  await wCtx.close(); await tCtx.close();
});
