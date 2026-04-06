import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SCENARIO = process.env.SCENARIO || 'SCG01EA';
const TICK = parseInt(process.env.TICK || '50');
const OUT_DIR = '/tmp/visual-compare';
const BASE_URL = 'https://cliaas.com';

test.describe('Visual Compare', () => {
  test.setTimeout(5 * 60 * 1000);

  test(`${SCENARIO} t${TICK}`, async ({ browser }) => {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    // Launch both engines
    const wasmCtx = await browser.newContext();
    const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const wasmPage = await wasmCtx.newPage();
    const tsPage = await tsCtx.newPage();
    wasmPage.on('dialog', async d => { await d.accept(); });

    await Promise.all([
      wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=${SCENARIO}.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
      tsPage.goto(`${BASE_URL}?anttest=agent&scenario=${SCENARIO}&difficulty=normal`, { waitUntil: 'load' }),
    ]);

    // Wait for both
    await Promise.all([
      wasmPage.waitForFunction(() => {
        try {
          const A = (window as any).Asyncify;
          if (A && A.state !== 0) return false;
          const M = (window as any).Module;
          return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0;
        } catch { return false; }
      }, { timeout: 180_000, polling: 2000 }),
      tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
    ]);

    // Sync RNG
    const wasmSeed = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;
    });
    await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

    // Step both
    console.log(`Stepping to tick ${TICK}...`);
    await Promise.all([
      (async () => {
        let rem = TICK;
        while (rem > 0) {
          const chunk = Math.min(rem, 10);
          rem -= chunk;
          try {
            await wasmPage.evaluate(async (n: number) => {
              const r = (window as any).__agentStep(n);
              if (r?.then) await r;
            }, chunk);
          } catch { break; }
        }
      })(),
      tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, TICK),
    ]);

    // Capture WASM via agent_render + HEAPU8
    console.log('Capturing WASM frame...');
    const wasmUrl = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      M.ccall('agent_render', null, [], []);
      const ptr = (window as any).__agentFramePtr;
      if (!ptr || !M.HEAPU8) return null;
      const w = 640, h = 400;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d')!;
      const img = ctx.createImageData(w, h);
      const heap = M.HEAPU8;
      for (let i = 0; i < w * h * 4; i++) img.data[i] = heap[ptr + i];
      ctx.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    });
    if (wasmUrl) {
      fs.writeFileSync(path.join(OUT_DIR, `${SCENARIO}_t${TICK}_wasm.png`),
        Buffer.from(wasmUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
    }

    // Capture TS canvas
    console.log('Capturing TS frame...');
    const tsUrl = await tsPage.evaluate(() => {
      const c = document.querySelector('canvas');
      return c?.toDataURL('image/png') || null;
    });
    if (tsUrl) {
      fs.writeFileSync(path.join(OUT_DIR, `${SCENARIO}_t${TICK}_ts.png`),
        Buffer.from(tsUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
    }

    console.log(`Saved to ${OUT_DIR}/`);
    await wasmCtx.close();
    await tsCtx.close();
  });
});
