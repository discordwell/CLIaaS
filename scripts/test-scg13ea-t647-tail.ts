/**
 * Probe the SCG13EA t647 replay-tail actors that over-consume six TS RNG calls.
 *
 * Run:
 *   BASE_URL=http://localhost:3004 npx playwright test scripts/test-scg13ea-t647-tail.ts --config playwright.no-server.config.ts --reporter=list
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TICK = Number(process.env.TICK ?? '646');

test(`SCG13EA t${TICK + 1} TS replay-tail actors`, async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const wasmPage = await browser.newPage();
  const page = await browser.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });
  await Promise.all([
    wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG13EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    page.goto(`${BASE_URL}?anttest=agent&scenario=SCG13EA&difficulty=normal`, { waitUntil: 'load' }),
  ]);
  await Promise.all([
    wasmPage.waitForFunction(() => {
      try {
        const M = (window as any).Module;
        return M?.ccall && JSON.parse(M.ccall('agent_get_state', 'string', [], [])).units?.length > 0;
      } catch {
        return false;
      }
    }, { timeout: 180_000, polling: 2000 }),
    page.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);
  const wasmSeed = await wasmPage.evaluate(() => JSON.parse((window as any).Module.ccall('agent_get_state', 'string', [], [])).rngState);
  await page.evaluate((seed: number) => { (window as any).__syncRngSeed?.(seed); }, wasmSeed);

  for (let i = 0; i < TICK; i++) {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      page.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  }

  const ids = [284, 285, 286, 288, 293, 294, 295, 297];
  const snapshot = async () => page.evaluate((wanted: number[]) => {
    const game = (window as any).__agentGame;
    return wanted.map(id => {
      const e = game.entities.find((x: { id: number }) => x.id === id);
      if (!e) return null;
      return {
        id: e.id,
        type: e.type,
        house: e.house,
        cell: `(${e.cell.cx},${e.cell.cy})`,
        pos: `(${e.leptonX},${e.leptonY})`,
        m: e.mission,
        mt: e.missionTimer,
        mq: e.missionQueue,
        drv: e.isDriving,
        doing: e.doing,
        arm: e.attackCooldown,
        target: e.target ? `${e.target.type}#${e.target.id}@(${e.target.cell.cx},${e.target.cell.cy})` : null,
        targetStructure: e.targetStructure ? `${e.targetStructure.type}@(${e.targetStructure.cx},${e.targetStructure.cy})` : null,
        moveTarget: e.moveTarget ? `(${e.moveTarget.lx},${e.moveTarget.ly})` : null,
        head: e.headToLX > 0 ? `(${e.headToLX},${e.headToLY})` : null,
        path: `${e.pathIndex}/${e.path?.length ?? 0}`,
      };
    });
  }, ids);

  const before = await snapshot();
  await page.evaluate(() => {
    (window as any).__rngTagControl?.('enable');
    (window as any).__rngTagControl?.('reset');
  });
  await page.evaluate(() => { (window as any).__agentStep?.(1); });
  const log = await page.evaluate(() => (window as any).__rngTagControl?.('read')?.seedLog ?? []);
  const after = await snapshot();

  console.log('before');
  for (const row of before) console.log(JSON.stringify(row));
  console.log('tail calls');
  for (const row of (log as Array<[number, number]>).filter(([, tag]) => tag >= 10128 && tag <= 10150)) {
    console.log(JSON.stringify(row));
  }
  console.log('after');
  for (const row of after) console.log(JSON.stringify(row));
});
