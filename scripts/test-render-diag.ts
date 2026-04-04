import { test } from '@playwright/test';
import * as fs from 'fs';
test.describe('Render', () => {
  test.setTimeout(5 * 60 * 1000);
  test('capture C++ frame', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('dialog', async d => { await d.accept(); });
    await page.goto('https://cliaas.com/ra/original.html?scenario=SCG01EA.INI&autoplay=1&agentharness=1&seed=0', { waitUntil: 'load' });
    await page.waitForFunction(() => {
      try {
        const A = (window as unknown as any).Asyncify;
        if (A && A.state !== 0) return false;
        const M = (window as unknown as any).Module;
        return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0;
      } catch { return false; }
    }, { timeout: 180_000, polling: 2000 });
    
    await page.evaluate(async () => { await (window as any).__agentStep(50); });
    
    const dataUrl = await page.evaluate(() => {
      const M = (window as any).Module;
      // Call agent_render to populate the RGBA buffer
      M.ccall('agent_render', null, [], []);
      const ptr = (window as any).__agentFramePtr;
      if (!ptr) return null;
      // Read RGBA via HEAPU8
      const heap = M.HEAPU8;
      if (!heap) return null;
      const w = 320, h = 200;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx2 = c.getContext('2d')!;
      const img = ctx2.createImageData(w, h);
      for (let i = 0; i < w * h * 4; i++) img.data[i] = heap[ptr + i];
      ctx2.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    });
    
    if (dataUrl && dataUrl.length > 5000) {
      fs.mkdirSync('/tmp/visual-compare', { recursive: true });
      fs.writeFileSync('/tmp/visual-compare/SCG01EA_t50_wasm.png',
        Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
      console.log('SAVED! len=' + dataUrl.length);
    } else {
      console.log('NO FRAME: len=' + (dataUrl?.length || 0));
    }
    await ctx.close();
  });
});
