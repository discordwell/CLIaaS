/**
 * Playwright comparison test: TS engine vs WASM original.
 *
 * Captures screenshots from both the TypeScript Red Alert engine
 * and the original C++ WASM build for visual comparison.
 *
 * The WASM test uses a self-capture system embedded in original.html
 * that grabs frames from inside requestAnimationFrame, bypassing
 * Playwright's screenshot mechanism which hangs on WebGL canvases.
 *
 * Run: npx playwright test scripts/test-compare.ts
 */

import { test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:3001';
const REPORT_DIR = path.join(process.cwd(), 'test-results', 'comparison');
const TS_DIR = path.join(REPORT_DIR, 'ts-engine');
const WASM_DIR = path.join(REPORT_DIR, 'wasm-original');

function ensureDirs() {
  fs.mkdirSync(TS_DIR, { recursive: true });
  fs.mkdirSync(WASM_DIR, { recursive: true });
}

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Save canvas content as PNG via toDataURL (works for WebGL with preserveDrawingBuffer) */
async function saveCanvas(page: Page, filePath: string): Promise<boolean> {
  try {
    const dataUrl = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      try {
        return canvas.toDataURL('image/png');
      } catch {
        return null;
      }
    });
    if (dataUrl && dataUrl.startsWith('data:image/png;base64,')) {
      const base64 = dataUrl.replace('data:image/png;base64,', '');
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Save a base64 data URL to a file */
function saveDataUrl(dataUrl: string, filePath: string): boolean {
  if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) return false;
  const base64 = dataUrl.replace('data:image/png;base64,', '');
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return true;
}

test.describe('Visual Comparison: TS Engine vs WASM Original', () => {

  test('TS Engine: QA pipeline screenshots', async ({ page }) => {
    ensureDirs();

    const logs: string[] = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

    await page.goto(`${BASE_URL}?anttest=qa`, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { timeout: 30000 });
    console.log('TS Engine: Canvas found');

    await saveCanvas(page, path.join(TS_DIR, '01-initial.png'));

    try {
      await page.waitForFunction(
        () => (window as unknown as { __qaComplete?: boolean }).__qaComplete === true,
        { timeout: 5 * 60 * 1000, polling: 2000 },
      );
      console.log('TS Engine: QA pipeline complete');
    } catch {
      console.log('TS Engine: QA pipeline timed out');
    }

    await saveCanvas(page, path.join(TS_DIR, '02-final.png'));

    const report = await page.evaluate(() => {
      return (window as unknown as { __qaReport?: unknown }).__qaReport;
    });

    if (report) {
      fs.writeFileSync(path.join(TS_DIR, 'qa-report.json'), JSON.stringify(report, null, 2));

      const screenshots = (report as { screenshots?: Array<{ key: string; dataUrl: string }> })?.screenshots ?? [];
      for (const ss of screenshots) {
        if (!ss.dataUrl.startsWith('data:image/png;base64,')) continue;
        const base64 = ss.dataUrl.replace('data:image/png;base64,', '');
        const fileName = ss.key.replace(/[^a-zA-Z0-9._-]/g, '_') + '.png';
        fs.writeFileSync(path.join(TS_DIR, fileName), Buffer.from(base64, 'base64'));
      }
      console.log(`TS Engine: ${screenshots.length} screenshots saved`);

      const summary = (report as { summary: { bySeverity: { critical: number; warning: number; info: number } } }).summary;
      console.log(`TS Engine: ${summary.bySeverity.critical} critical, ${summary.bySeverity.warning} warnings, ${summary.bySeverity.info} info`);
    }

    fs.writeFileSync(path.join(TS_DIR, 'console.log'), logs.join('\n'));
  });

  test('WASM Original: ant mission screenshots', async ({ page }) => {
    ensureDirs();

    const logs: string[] = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

    // Dismiss any dialogs automatically (WASM may trigger alert() dialogs)
    page.on('dialog', async dialog => {
      console.log(`WASM: Dialog: ${dialog.type()} - ${dialog.message()}`);
      await dialog.accept();
    });

    // Navigate to WASM original (self-capture system is embedded in the page)
    await page.goto(`${BASE_URL}/ra/original.html`, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { timeout: 30000 });
    console.log('WASM: Canvas found, waiting for WASM to load...');

    // Wait for WASM to finish loading (gamedata.data is 43MB)
    try {
      await page.waitForFunction(
        () => {
          const status = document.getElementById('status');
          return status && (status.style.display === 'none' || status.innerHTML === 'All downloads complete.');
        },
        { timeout: 120000, polling: 1000 },
      );
      console.log('WASM: Loaded');
    } catch {
      console.log('WASM: Load detection timed out, continuing anyway');
    }

    // The WASM game may block the main thread once it starts its synchronous
    // main loop. All page.evaluate() and page.screenshot() calls will hang.
    // Strategy: use short timeouts on each operation, and collect whatever
    // data we can before the game blocks.

    /** Try an evaluate with a short timeout, return null on failure */
    async function tryEval<T>(fn: () => T, timeoutMs = 3000): Promise<T | null> {
      try {
        return await Promise.race([
          page.evaluate(fn),
          new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
        ]);
      } catch {
        return null;
      }
    }

    // Capture pre-game-loop data
    await wait(2000);
    const preLoopData = await tryEval(() => {
      const w = window as unknown as {
        __wasmRenderCount: number;
        __wasmFrameCount: number;
        __wasmRenderSamples: Array<Record<string, unknown>>;
        __wasmLogs: string[];
      };
      return {
        renderCount: w.__wasmRenderCount || 0,
        frameCount: w.__wasmFrameCount || 0,
        samples: w.__wasmRenderSamples || [],
        logs: w.__wasmLogs || [],
      };
    });

    if (preLoopData) {
      console.log(`WASM: Pre-loop: ${preLoopData.renderCount} putImageData calls, ${preLoopData.frameCount} rAF frames`);
      if (preLoopData.samples.length > 0) {
        for (const s of preLoopData.samples.slice(0, 5)) {
          console.log(`  render#${s.render}: ${s.w}x${s.h} center=${JSON.stringify(s.centerPx)} nonBlack=${s.nonBlack}/${s.totalSampled}`);
        }
      }
    }

    // Try to request a capture before the game blocks
    await tryEval(() => {
      (window as unknown as { __wasmRequestCapture: (k: string) => void }).__wasmRequestCapture('pre-game');
    });

    // Wait for game to start rendering
    console.log('WASM: Waiting for rendering to begin...');
    let hasContent = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      await wait(2000);
      const check = await tryEval(() => ({
        hasContent: (window as unknown as { __wasmHasContent: boolean }).__wasmHasContent,
        renders: (window as unknown as { __wasmRenderCount: number }).__wasmRenderCount,
      }), 2000);
      if (!check) { console.log('WASM: Main thread blocked'); break; }
      if (check.hasContent) { hasContent = true; break; }
      console.log(`WASM: [${attempt + 1}/15] renders=${check.renders} content=${check.hasContent}`);
    }

    if (!hasContent) {
      console.log('WASM: No content rendered, saving what we have');
    } else {
      console.log('WASM: Game is rendering! Navigating to ant mission...');
    }

    // Navigate the menus to reach the ant mission.
    // Menu flow: Main Menu → "Start New Game" → "CHOOSE YOUR SIDE" → allies/soviet
    // For ant missions, we need to reach the counterstrike expansion content.
    // The menu buttons are positioned at specific pixel locations.
    //
    // Main screen shows "CHOOSE YOUR SIDE" with ALLIES (left) and SOVIET (right).
    // The game auto-navigates to this screen from the title.
    // Viewport is 640x400, canvas fills it.

    async function clickCanvas(xRatio: number, yRatio: number, label: string) {
      const el = await page.$('canvas');
      if (!el) return;
      const box = await el.boundingBox();
      if (!box) return;
      const x = box.x + box.width * xRatio;
      const y = box.y + box.height * yRatio;
      console.log(`WASM: Click ${label} at (${Math.round(x)}, ${Math.round(y)})`);
      await page.mouse.click(x, y);
      await wait(2000);
      await tryEval(() => {
        (window as unknown as { __wasmRequestCapture: (s: string) => void }).__wasmRequestCapture('after-click');
      }, 2000);
    }

    // The "CHOOSE YOUR SIDE" screen: ALLIES button at ~35% x, SOVIET at ~65% x, ~70% y
    await clickCanvas(0.35, 0.70, 'allies-button');
    await wait(1000);

    // After choosing side, mission select screen appears.
    // Try clicking through several screens to advance.
    for (let i = 0; i < 8; i++) {
      await clickCanvas(0.5, 0.6, `menu-advance-${i}`);
      await wait(1500);
    }

    // Request captures every few seconds during gameplay
    console.log('WASM: Running game, capturing periodically...');
    for (let i = 0; i < 20; i++) {
      await wait(3000);
      const status = await tryEval(() => ({
        renders: (window as unknown as { __wasmRenderCount: number }).__wasmRenderCount,
        screenshots: (window as unknown as { __wasmScreenshots: unknown[] }).__wasmScreenshots?.length || 0,
      }), 2000);
      if (!status) {
        console.log(`WASM: Main thread blocked at iteration ${i}`);
        break;
      }
      // Request a named capture
      await tryEval(() => {
        (window as unknown as { __wasmRequestCapture: (s: string) => void }).__wasmRequestCapture('gameplay');
      }, 1000);
      if (i % 5 === 0) {
        console.log(`WASM: [${i}/20] renders=${status.renders} screenshots=${status.screenshots}`);
      }
    }

    // Extract all screenshots
    const result = await tryEval(() => {
      const w = window as unknown as {
        __wasmScreenshots: Array<{ key: string; dataUrl: string; frame: number }>;
        __wasmFrameCount: number;
        __wasmHasContent: boolean;
        __wasmLogs: string[];
        __wasmDiag: Record<string, unknown>;
        __wasmRenderCount: number;
        __wasmRenderSamples: Array<Record<string, unknown>>;
      };
      return {
        screenshots: w.__wasmScreenshots || [],
        frameCount: w.__wasmFrameCount || 0,
        hasContent: w.__wasmHasContent || false,
        logs: w.__wasmLogs || [],
        diag: w.__wasmDiag || {},
        renderCount: w.__wasmRenderCount || 0,
        renderSamples: (w.__wasmRenderSamples || []).slice(0, 20),
      };
    }, 10000);

    if (result) {
      console.log(`WASM: ${result.frameCount} rAF, ${result.renderCount} renders, content=${result.hasContent}`);
      console.log(`WASM: ${result.screenshots.length} total screenshots`);
      console.log(`WASM: diagnostics: ${JSON.stringify(result.diag, null, 2)}`);

      let saved = 0;
      for (let i = 0; i < result.screenshots.length; i++) {
        const ss = result.screenshots[i];
        if (!ss || !ss.dataUrl) continue;
        const key = ss.key || `unnamed-${i}`;
        const fileName = key.replace(/[^a-zA-Z0-9._-]/g, '_') + '.png';
        if (saveDataUrl(ss.dataUrl, path.join(WASM_DIR, fileName))) saved++;
      }
      console.log(`WASM: ${saved} screenshots saved`);

      const allLogs = [...result.logs, '', '--- Console logs ---', ...logs];
      fs.writeFileSync(path.join(WASM_DIR, 'console.log'), allLogs.join('\n'));
    } else {
      console.log('WASM: Could not extract results (main thread blocked)');
      fs.writeFileSync(path.join(WASM_DIR, 'console.log'), logs.join('\n'));
    }

    console.log('WASM: Test complete');
  });
});
