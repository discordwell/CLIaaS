/**
 * Generic SCG13EA WASM/TS unit trace.
 *
 * Env:
 *   WASM_ID=852056 TS_ID=258 START=90 END=105
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE_URL = process.env.TS_BASE_URL ?? BASE_URL;
const WASM_ID = Number(process.env.WASM_ID ?? '852056');
const TS_ID = Number(process.env.TS_ID ?? '258');
const START = Number(process.env.START ?? '90');
const END = Number(process.env.END ?? '105');

test(`SCG13EA unit trace WASM ${WASM_ID} / TS ${TS_ID}`, async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const wasmPage = await browser.newPage();
  const tsPage = await browser.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG13EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tsPage.goto(`${TS_BASE_URL}?anttest=agent&scenario=SCG13EA&difficulty=normal`, { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wasmPage.waitForFunction(() => {
      try {
        const M = (window as any).Module;
        return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0;
      } catch { return false; }
    }, { timeout: 180_000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);
  const wasmSeed = await wasmPage.evaluate(() => JSON.parse((window as any).Module.ccall('agent_get_state','string',[],[])).rngState);
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  let prev = '';
  for (let t = 0; t <= END; t++) {
    if (t > 0) {
      await Promise.all([
        wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
        tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
      ]);
    }
    if (t < START) continue;

    const wasm = await wasmPage.evaluate((id: number) => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      const all = [...(s.units ?? []), ...(s.enemies ?? [])];
      const u = all.find((x: { id: number }) => x.id === id);
      if (!u) return '?';
      return `m=${u.m} mt=${u.mt} arm=${u.arm ?? '?'} mq=${u.mq} drv=${u.drv} doing=${u.doing} c=(${u.cx},${u.cy}) ` +
        `pos=(${u.lx},${u.ly}) head=${u.hlx !== undefined ? `(${u.hlx},${u.hly})` : 'null'} ` +
        `nav=${u.nlx !== undefined ? `(${u.nlx},${u.nly})` : 'null'} ` +
        `path=${[u.p0,u.p1,u.p2,u.p3,u.p4,u.p5].join(',')} spd=${u.spd}`;
    }, WASM_ID);

    const ts = await tsPage.evaluate((id: number) => {
      const game = (window as any).__agentGame;
      const e = game?.entities?.find((x: { alive: boolean; id: number }) => x.alive && x.id === id);
      if (!e) return '?';
      const head = e.headToLX > 0 ? `(${e.headToLX},${e.headToLY})` : 'null';
      const nav = e.moveTarget ? `(${e.moveTarget.lx},${e.moveTarget.ly})` : 'null';
      const tgt = e.target ? `${e.target.id ?? '?'}@(${e.target.cell?.cx ?? '?'},${e.target.cell?.cy ?? '?'})` :
        e.targetStructure ? `${e.targetStructure.type}@(${e.targetStructure.cx},${e.targetStructure.cy})` : 'null';
      const path = `${e.pathIndex}/${e.path?.length ?? 0}:${(e.path ?? []).slice(e.pathIndex, e.pathIndex + 3)
        .map((p: { cx: number; cy: number }) => `${p.cx},${p.cy}`).join('|')}`;
      return `m=${e.mission} mt=${e.missionTimer} arm=${e.attackCooldown ?? 0} mq=${e.missionQueue ?? 'null'} drv=${e.isDriving} ` +
        `init=${e.teamInitiated} team=${e.teamRef?.typeName ?? '-'}#${e.teamRef?.id ?? '-'} ` +
        `nct=${e.navComClearedTick ?? -1} ` +
        `doing=${e.doing} c=(${e.cell.cx},${e.cell.cy}) pos=(${e.leptonX},${e.leptonY}) ` +
        `head=${head} nav=${nav} tgt=${tgt} path=${path}`;
    }, TS_ID);

    const line = `t=${t} W: ${wasm} | TS: ${ts}`;
    if (line !== prev) {
      console.log(line);
      prev = line;
    }
  }
});
