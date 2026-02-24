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

    // Extract report metadata (without the massive screenshot data URLs)
    const meta = await page.evaluate(() => {
      const r = (window as unknown as { __qaReport?: {
        summary: { bySeverity: { critical: number; warning: number; info: number } };
        screenshots?: Array<{ key: string; dataUrl: string }>;
      } }).__qaReport;
      if (!r) return null;
      return {
        summary: r.summary,
        screenshotCount: r.screenshots?.length ?? 0,
      };
    });

    if (meta) {
      console.log(`TS Engine: ${meta.summary.bySeverity.critical} critical, ${meta.summary.bySeverity.warning} warnings, ${meta.summary.bySeverity.info} info`);

      // Extract screenshots in batches of 10 to avoid massive transfers
      const BATCH = 10;
      const total = Math.min(meta.screenshotCount, 30);
      let saved = 0;
      for (let i = 0; i < total; i += BATCH) {
        const batch = await page.evaluate(([start, end]: [number, number]) => {
          const r = (window as unknown as { __qaReport?: {
            screenshots?: Array<{ key: string; dataUrl: string }>;
          } }).__qaReport;
          return (r?.screenshots ?? []).slice(start, end).map(ss => ({
            key: ss.key,
            dataUrl: ss.dataUrl,
          }));
        }, [i, Math.min(i + BATCH, total)] as [number, number]);

        for (const ss of batch) {
          if (!ss || !ss.dataUrl || !ss.dataUrl.startsWith('data:image/png;base64,')) continue;
          const base64 = ss.dataUrl.replace('data:image/png;base64,', '');
          const fileName = ss.key.replace(/[^a-zA-Z0-9._-]/g, '_') + '.png';
          fs.writeFileSync(path.join(TS_DIR, fileName), Buffer.from(base64, 'base64'));
          saved++;
        }
      }
      console.log(`TS Engine: ${saved} screenshots saved (of ${meta.screenshotCount} total)`);
    }

    fs.writeFileSync(path.join(TS_DIR, 'console.log'), logs.join('\n'));
  });

  test('WASM Original: ant mission screenshots', async ({ page }) => {
    ensureDirs();

    const logs: string[] = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('dialog', async dialog => {
      console.log(`WASM: Dialog: ${dialog.type()} - ${dialog.message()}`);
      await dialog.accept();
    });

    // Navigate with ?autoplay=ants — original.html provides screen detection.
    // Menu navigation uses Playwright CDP keyboard events (trusted).
    // Dispatched (non-trusted) keyboard events don't work because ASYNCIFY
    // prevents WASM calls during JS execution windows. Trusted CDP events
    // are processed by Chrome's input pipeline at a lower level.
    await page.goto(`${BASE_URL}/ra/original.html?autoplay=ants`, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { timeout: 30000 });
    console.log('WASM: Canvas found, waiting for WASM to load...');

    // Wait for WASM to finish loading (gamedata.data is 43MB)
    try {
      await page.waitForFunction(
        () => {
          const status = document.getElementById('status');
          return status && (status.style.display === 'none' || status.innerHTML === 'All downloads complete.');
        },
        { timeout: 120000, polling: 2000 },
      );
      console.log('WASM: Loaded');
    } catch {
      console.log('WASM: Load detection timed out, continuing anyway');
    }

    /** Try an evaluate with a short timeout, return null on failure */
    async function tryEval<T>(fn: () => T, timeoutMs = 5000): Promise<T | null> {
      try {
        return await Promise.race([
          page.evaluate(fn),
          new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
        ]);
      } catch {
        return null;
      }
    }


    // === Menu navigation strategy ===
    // Key findings from testing:
    // 1. Without keyboard input: game renders at ~73fps, evaluate works fine,
    //    but game stuck at "CHOOSE YOUR SIDE" (screenshots identical).
    // 2. Page-dispatched (non-trusted) keyboard events BLOCK the main thread
    //    entirely — even evaluate() stops working for minutes.
    // 3. Playwright CDP keyboard.press() works initially, but after the first
    //    Enter the game enters a blocking movie/transition state.
    //
    // Approach: Send one CDP Enter at a time. After each, wait for the game
    // to become responsive again (evaluate succeeds) before sending the next.
    // This lets us navigate menus without permanently blocking the main thread.

    // Helper: wait until evaluate works (game is responsive)
    async function waitForResponsive(maxWaitMs: number): Promise<boolean> {
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        const result = await tryEval(() => {
          return (window as unknown as { __wasmRenderCount: number }).__wasmRenderCount || 0;
        });
        if (result !== null) return true;
        await wait(3000);
      }
      return false;
    }

    // Wait for initial content
    console.log('WASM: Waiting for content...');
    await wait(5000);

    const initiallyResponsive = await waitForResponsive(15000);
    if (!initiallyResponsive) {
      console.log('WASM: Game not responsive initially, skipping keyboard navigation');
    } else {
      console.log('WASM: Game responsive, navigating menus via CDP keyboard...');

      const keyLabels = [
        'choose-side',   // Select ALLIES at "CHOOSE YOUR SIDE"
        'advance-1',     // Skip movie / advance
        'start-game',    // Start New Game at main menu
        'briefing-1',    // Continue through briefing
        'briefing-2',    // More advances (briefing animation takes time)
        'briefing-3',
        'advance-4',     // Get past "OK" dialogs
        'advance-5',
        'advance-6',     // Additional presses to ensure we reach gameplay
        'advance-7',
        'advance-8',
        'advance-9',
        'advance-10',
      ];

      for (const label of keyLabels) {
        console.log(`WASM: Pressing Enter (${label})...`);
        let keyOk = false;
        try {
          await Promise.race([
            page.keyboard.press('Enter').then(() => { keyOk = true; }),
            new Promise<void>(resolve => setTimeout(resolve, 10000)),
          ]);
        } catch {
          console.log(`WASM: Page closed during ${label}`);
          break;
        }

        if (keyOk) {
          console.log(`WASM: Enter delivered (${label})`);
        } else {
          console.log(`WASM: CDP timed out (${label}) — game in transition`);
        }

        // Wait for game to become responsive again (up to 90s per transition)
        console.log(`WASM: Waiting for game to recover...`);
        const recovered = await waitForResponsive(90000);
        if (recovered) {
          console.log(`WASM: Game responsive after ${label}`);
          // Save a screenshot
          await Promise.race([
            saveCanvas(page, path.join(WASM_DIR, `screen-${label}.png`)),
            new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000)),
          ]);
        } else {
          console.log(`WASM: Game still blocked after 90s — may be permanently stuck`);
          break;
        }
      }
    }

    console.log('WASM: Menu navigation complete');

    // Let the game run for 30s to accumulate varied screenshots
    console.log('WASM: Running game for 30s...');
    await wait(30000);

    // Extract metadata
    const meta = await tryEval(() => {
      const w = window as unknown as {
        __wasmScreenshots: Array<{ key: string; frame: number }>;
        __wasmFrameCount: number;
        __wasmRenderCount: number;
        __wasmHasContent: boolean;
        __wasmLogs: string[];
        __wasmDiag: Record<string, unknown>;
        __autoplayLog: string[];
        __autoplayState: string;
        __autoplayScreenChanges: number;
      };
      return {
        count: (w.__wasmScreenshots || []).length,
        frameCount: w.__wasmFrameCount || 0,
        renderCount: w.__wasmRenderCount || 0,
        hasContent: w.__wasmHasContent || false,
        logs: w.__wasmLogs || [],
        diag: w.__wasmDiag || {},
        autoplayLog: w.__autoplayLog || [],
        autoplayState: w.__autoplayState || 'unknown',
        screenChanges: w.__autoplayScreenChanges || 0,
      };
    }, 10000);

    if (!meta) {
      console.log('WASM: Could not extract metadata (main thread blocked)');
      fs.writeFileSync(path.join(WASM_DIR, 'console.log'), logs.join('\n'));
      console.log('WASM: Test complete');
      return;
    }

    console.log(`WASM: ${meta.frameCount} rAF, ${meta.renderCount} renders, ${meta.count} screenshots, autoplay=${meta.autoplayState}, screenChanges=${meta.screenChanges}`);

    // Extract screenshots in batches of 10
    const maxScreenshots = Math.min(meta.count, 30);
    let saved = 0;
    const fileSizes: number[] = [];
    const BATCH_SIZE = 10;

    for (let batch = 0; batch * BATCH_SIZE < maxScreenshots; batch++) {
      const start = batch * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, maxScreenshots);
      console.log(`WASM: Extracting screenshots ${start}-${end - 1}...`);

      let batchData: Array<{ key: string; dataUrl: string }> | null = null;
      try {
        batchData = await Promise.race([
          page.evaluate(([s, e]: [number, number]) => {
            const w = window as unknown as {
              __wasmScreenshots: Array<{ key: string; dataUrl: string; frame: number }>;
            };
            const screenshots = w.__wasmScreenshots || [];
            return screenshots.slice(s, e).map(ss => ({
              key: ss.key,
              dataUrl: ss.dataUrl,
            }));
          }, [start, end] as [number, number]),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 30000)),
        ]);
      } catch {
        batchData = null;
      }

      if (!batchData) {
        console.log(`WASM: Batch ${batch} extraction failed, skipping`);
        continue;
      }

      for (const ss of batchData) {
        if (!ss || !ss.dataUrl) continue;
        const key = ss.key || `unnamed-${saved}`;
        const fileName = key.replace(/[^a-zA-Z0-9._-]/g, '_') + '.png';
        const filePath = path.join(WASM_DIR, fileName);
        if (saveDataUrl(ss.dataUrl, filePath)) {
          saved++;
          fileSizes.push(fs.statSync(filePath).size);
        }
      }
    }

    console.log(`WASM: ${saved} screenshots saved`);

    // Verify screenshots are not all identical
    if (fileSizes.length >= 3) {
      const uniqueSizes = new Set(fileSizes);
      const varied = uniqueSizes.size > 1;
      console.log(`WASM: Screenshot variance: ${uniqueSizes.size} unique sizes out of ${fileSizes.length} files — ${varied ? 'VARIED (good)' : 'ALL IDENTICAL (bad)'}`);
      if (!varied) {
        console.warn('WASM: WARNING — all screenshots are identical, game may not have progressed past menu');
      }
    }

    // Save logs
    const allLogs = [
      ...(meta.logs || []),
      '',
      '--- Autoplay log ---',
      ...(meta.autoplayLog || []),
      '',
      `--- Diagnostics ---`,
      JSON.stringify(meta.diag, null, 2),
      '',
      '--- Console logs ---',
      ...logs,
    ];
    fs.writeFileSync(path.join(WASM_DIR, 'console.log'), allLogs.join('\n'));
    console.log('WASM: Test complete');
  });
});
