/**
 * Identify the WASM entity firing Mission_Move Random_Pick at SCG13EA tick 100.
 * Reads rngLog triplets [seed, source_tag, entity_tag] + logicLayer to resolve
 * entity_tag → infantry/unit type and cell.
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';

function tagName(tag: number): string {
  if (tag >= 16000 && tag < 20000) return `anim[${tag - 16000}]`;
  if (tag >= 15000 && tag < 16000) return `bullet[${tag - 15000}]`;
  if (tag >= 14000 && tag < 15000) return `vessel[${tag - 14000}]`;
  if (tag >= 13000 && tag < 14000) return `aircraft[${tag - 13000}]`;
  if (tag >= 12000 && tag < 13000) return `building[${tag - 12000}]`;
  if (tag >= 11000 && tag < 12000) return `unit[${tag - 11000}]`;
  if (tag >= 10000 && tag < 11000) return `infantry[${tag - 10000}]`;
  return `raw(${tag})`;
}

test('SCG13EA tick 100 who fires Mission_Move', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const wasmCtx = await browser.newContext();
  const wasmPage = await wasmCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG13EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' });
  await wasmPage.waitForFunction(() => {
    try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });

  // Step to tick 99 (bulk)
  await wasmPage.evaluate(async () => {
    const r = (window as any).__agentStep(99);
    if (r?.then) await r;
  });
  // Reset log
  await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    JSON.parse(M.ccall('agent_get_state','string',[],[]));
  });

  // Step 1 tick; capture rngLog + logicLayer
  const step = await wasmPage.evaluate(async () => {
    const r = (window as any).__agentStep(1);
    const res = r?.then ? await r : r;
    const s = res?.state ?? res;
    return {
      tick: s.tick,
      log: s.rngLog as Array<[number, number, number]>,
      logicLayer: s.logicLayer as Array<[number, string, string, number, number]>,
      units: (s.units ?? []).map((u: { id: number; t: string; house: string; cx: number; cy: number; m: number; mt: number; navX?: number; navY?: number }) => u),
      enemies: (s.enemies ?? []).map((u: { id: number; t: string; house: string; cx: number; cy: number; m: number; mt: number; navX?: number; navY?: number }) => u),
    };
  });

  console.log(`=== WASM tick ${step.tick}: ${step.log.length} RNG call(s) ===`);
  for (const [seed, srcTag, entTag] of step.log) {
    console.log(`  seed=${seed}, source_tag=${srcTag}, entity_tag=${entTag} (${tagName(entTag)})`);
  }

  // Decode entity_tag → logicLayer entry
  console.log(`\n=== WASM Logic layer sampled ===`);
  const entTagsInUse = new Set(step.log.map(e => e[2]));
  for (const [idx, t, h, cx, cy] of step.logicLayer) {
    // logicLayer is keyed on raw Logic layer index. The entity tag format is
    // 10000+infantryIdx / 11000+unitIdx / 13000+aircraftIdx / 14000+vesselIdx.
    // Logic index may differ from per-class index. Print ALL entries that match
    // any tag-in-use by cell/type joined with units/enemies.
    if (entTagsInUse.size === 0) break;
    console.log(`  [${idx}] ${t} (${h}) cell(${cx},${cy})`);
  }

  // All infantry/units in full with mission state — find those on MOVE
  const allMobile = [...step.units, ...step.enemies];
  const onMove = allMobile.filter((u) => u.m === 2); // Mission.MOVE = 2 in C++ MissionType
  console.log(`\n=== All entities on Mission.MOVE (m=2) at tick ${step.tick} (${onMove.length}) ===`);
  for (const u of onMove) {
    console.log(`  id=${u.id} t=${u.t} house=${u.house} cell(${u.cx},${u.cy}) mt=${u.mt} navX=${u.navX} navY=${u.navY}`);
  }

  await wasmCtx.close();
});
