/**
 * Probe WASM logic-layer entities around SCG13EA tick 115 divergence.
 */
import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';

test('SCG13EA t115 logic-layer mapping', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const page = await browser.newPage();
  page.on('dialog', async d => { await d.accept(); });
  await page.goto(`${BASE_URL}/ra/original.html?scenario=SCG13EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    try {
      const M = (window as any).Module;
      return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0;
    } catch { return false; }
  }, { timeout: 180_000, polling: 2000 });

  for (let t = 0; t < 114; t++) {
    await page.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; });
  }

  const rows = await page.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    const all = [...(s.units ?? []), ...(s.enemies ?? [])];
    const wanted = new Set([152, 153, 174, 181, 188]);
    return (s.logicLayer ?? [])
      .filter((r: [number, string, string, number, number, string]) => wanted.has(r[0]) || (r[0] >= 145 && r[0] <= 190 && r[5] === 'I'))
      .map((r: [number, string, string, number, number, string]) => {
        const u = all.find((x: { t: string; house: string; cx: number; cy: number }) =>
          x.t === r[1] && x.house === r[2] && x.cx === r[3] && x.cy === r[4]);
        return {
          logic: r[0],
          type: r[1],
          house: r[2],
          cell: `(${r[3]},${r[4]})`,
          unit: u ? {
            id: u.id, m: u.m, mt: u.mt, mq: u.mq, drv: u.drv,
            pos: `(${u.lx},${u.ly})`,
            head: u.hlx !== undefined ? `(${u.hlx},${u.hly})` : null,
            nav: u.nlx !== undefined ? `(${u.nlx},${u.nly})` : null,
          } : null,
        };
      });
  });

  for (const row of rows) console.log(JSON.stringify(row));
});
