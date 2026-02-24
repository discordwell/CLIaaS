/**
 * Playwright comparison test: TS engine vs WASM original.
 *
 * Two test modes:
 * 1. Static Map Comparison — fog off, paused, initial state. Compares terrain,
 *    units, buildings, ore at the same map regions.
 * 2. Legacy QA/WASM tests (preserved from original).
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
const STATIC_DIR = path.join(REPORT_DIR, 'static');

function ensureDirs() {
  fs.mkdirSync(TS_DIR, { recursive: true });
  fs.mkdirSync(WASM_DIR, { recursive: true });
  fs.mkdirSync(STATIC_DIR, { recursive: true });
}

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Save canvas content as PNG via toDataURL */
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

/** Try an evaluate with a short timeout */
async function tryEval<T>(page: Page, fn: () => T, timeoutMs = 5000): Promise<T | null> {
  try {
    return await Promise.race([
      page.evaluate(fn),
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

/** Wait until page.evaluate works (game main thread not blocked) */
async function waitForResponsive(page: Page, maxWaitMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const result = await tryEval(page, () => {
      return (window as unknown as { __wasmRenderCount: number }).__wasmRenderCount || 0;
    });
    if (result !== null) return true;
    await wait(3000);
  }
  return false;
}

// ────────────────────────────────────────────────────────────────

/** Comparison points for SCA01EA — map regions to capture */
const COMPARISON_POINTS = [
  { name: 'player-base',  desc: 'Player start / WP98 area',  wx: 65 * 24 + 12, wy: 65 * 24 + 12 },
  { name: 'ore-field',    desc: 'Ore field NW of base',       wx: 55 * 24 + 12, wy: 55 * 24 + 12 },
  { name: 'water-shore',  desc: 'Water/shore SE',             wx: 75 * 24 + 12, wy: 75 * 24 + 12 },
  { name: 'ant-spawn',    desc: 'Ant spawn area NE',          wx: 80 * 24 + 12, wy: 50 * 24 + 12 },
];

const TS_LAYERS = ['terrain', 'units', 'buildings', 'overlays', 'full-no-ui'] as const;

// ────────────────────────────────────────────────────────────────

test.describe('Static Map Comparison', () => {

  test('TS Engine: static initial state', async ({ page }) => {
    ensureDirs();

    const logs: string[] = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

    // Start TS engine in comparison mode: paused, fog off, SCA01EA
    await page.goto(`${BASE_URL}?anttest=compare&scenario=SCA01EA`, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { timeout: 30000 });
    console.log('TS Static: Canvas found, waiting for compare mode...');

    // Wait for comparison mode to be ready
    try {
      await page.waitForFunction(
        () => (window as unknown as { __tsCompareReady?: boolean }).__tsCompareReady === true,
        { timeout: 120000, polling: 1000 },
      );
      console.log('TS Static: Comparison mode ready');
    } catch {
      console.log('TS Static: Comparison mode timeout — capturing whatever state we have');
      await saveCanvas(page, path.join(STATIC_DIR, 'ts-timeout.png'));
      fs.writeFileSync(path.join(STATIC_DIR, 'ts-console.log'), logs.join('\n'));
      return;
    }

    let saved = 0;

    // For each comparison point, set camera and capture all layers
    for (const point of COMPARISON_POINTS) {
      console.log(`TS Static: Capturing ${point.name} (${point.desc})...`);

      // Set camera position
      await page.evaluate(([wx, wy]: [number, number]) => {
        (window as unknown as { __tsSetCamera: (x: number, y: number) => void }).__tsSetCamera(wx, wy);
        // Re-render after camera move
        (window as unknown as { __tsGame: { step: (n: number) => void } }).__tsGame.step(0);
      }, [point.wx, point.wy] as [number, number]);

      await wait(100); // let render settle

      // Capture each layer
      for (const layer of TS_LAYERS) {
        const dataUrl = await page.evaluate((l: string) => {
          return (window as unknown as { __tsCaptureLayer: (l: string) => string | null }).__tsCaptureLayer(l);
        }, layer);

        if (dataUrl) {
          const filename = `ts-${point.name}-${layer}.png`;
          saveDataUrl(dataUrl, path.join(STATIC_DIR, filename));
          saved++;
        }
      }
    }

    console.log(`TS Static: ${saved} screenshots saved`);
    fs.writeFileSync(path.join(STATIC_DIR, 'ts-console.log'), logs.join('\n'));
  });

  test('WASM Original: static initial state', async ({ page }) => {
    ensureDirs();

    const logs: string[] = [];
    page.on('console', msg => {
      const text = msg.text();
      logs.push(`[${msg.type()}] ${text}`);
      if (text.includes('[AUTOPLAY]')) console.log(`WASM Static: ${text}`);
    });
    page.on('dialog', async dialog => {
      console.log(`WASM Static: Dialog: ${dialog.type()} - ${dialog.message()}`);
      await dialog.accept();
    });

    // Navigate with autoplay — navigate to gameplay, then pause + capture
    await page.goto(`${BASE_URL}/ra/original.html?autoplay=ants`, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { timeout: 30000 });
    console.log('WASM Static: Canvas found, waiting for WASM load...');

    // Wait for WASM to finish loading
    try {
      await page.waitForFunction(
        () => {
          const status = document.getElementById('status');
          return status && (status.style.display === 'none' || status.innerHTML === 'All downloads complete.');
        },
        { timeout: 120000, polling: 2000 },
      );
      console.log('WASM Static: Loaded');
    } catch {
      console.log('WASM Static: Load timeout, continuing anyway');
    }

    // Wait for content + input readiness
    console.log('WASM Static: Waiting for content...');
    await wait(5000);

    const responsive = await waitForResponsive(page, 15000);
    if (!responsive) {
      console.log('WASM Static: Not responsive — aborting');
      fs.writeFileSync(path.join(STATIC_DIR, 'wasm-console.log'), logs.join('\n'));
      return;
    }

    // Wait for input injection to be ready
    let inputReady = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const ready = await tryEval(page, () => {
        return (window as unknown as { __inputReady: () => boolean }).__inputReady();
      });
      if (ready) { inputReady = true; break; }
      await wait(1000);
    }

    if (!inputReady) {
      console.log('WASM Static: Input exports not available — aborting');
      fs.writeFileSync(path.join(STATIC_DIR, 'wasm-console.log'), logs.join('\n'));
      return;
    }

    // Enable autoplay mode
    await tryEval(page, () => {
      return (window as unknown as { __setAutoplay: (m: boolean) => boolean }).__setAutoplay(true);
    });

    // Navigate to gameplay via Enter injection
    const hashBefore = await tryEval(page, () => {
      return (window as unknown as { __getScreenHash: () => string }).__getScreenHash();
    });

    await tryEval(page, () => {
      return (window as unknown as { __injectKey: (vk: number) => boolean }).__injectKey(40);
    });

    // Wait for gameplay
    console.log('WASM Static: Waiting for gameplay...');
    const loadStart = Date.now();
    let gameReady = false;
    let enterRetries = 0;

    while (Date.now() - loadStart < 300000) {
      const renders = await tryEval(page, () => {
        return (window as unknown as { __wasmRenderCount: number }).__wasmRenderCount || 0;
      }, 5000);

      const elapsed = Math.round((Date.now() - loadStart) / 1000);
      if (renders !== null) {
        const hashNow = await tryEval(page, () => {
          return (window as unknown as { __getScreenHash: () => string }).__getScreenHash();
        });
        if (hashNow !== null && hashNow !== hashBefore) {
          console.log(`WASM Static: Game reached gameplay after ${elapsed}s`);
          gameReady = true;
          break;
        }
        if (elapsed > 5 && enterRetries < 10) {
          enterRetries++;
          await tryEval(page, () => {
            return (window as unknown as { __injectKey: (vk: number) => boolean }).__injectKey(40);
          });
          await wait(2000);
          continue;
        }
      }
      if (elapsed % 10 === 0) console.log(`WASM Static: Loading... ${elapsed}s`);
      await wait(3000);
    }

    if (!gameReady) {
      console.log('WASM Static: Failed to reach gameplay');
      await saveCanvas(page, path.join(STATIC_DIR, 'wasm-timeout.png'));
      fs.writeFileSync(path.join(STATIC_DIR, 'wasm-console.log'), logs.join('\n'));
      return;
    }

    // Pause the game
    await tryEval(page, () => {
      (window as unknown as { __wasmSetPaused: (p: boolean) => void }).__wasmSetPaused(true);
    });
    await wait(500);

    // Capture initial gameplay frame using on-demand capture-on-render
    let saved = 0;

    for (const point of COMPARISON_POINTS) {
      console.log(`WASM Static: Capturing ${point.name}...`);

      // Unpause briefly for one render, then re-pause
      await page.evaluate((key: string) => {
        const w = window as unknown as {
          __wasmCaptureOnRender: (k: string) => void;
          __wasmPaused: boolean;
        };
        w.__wasmCaptureOnRender(key);
        // Briefly unpause to trigger one render cycle
        w.__wasmPaused = false;
      }, `wasm-${point.name}-full`);

      // Wait for the capture to complete
      await wait(500);

      // Re-pause
      await tryEval(page, () => {
        (window as unknown as { __wasmPaused: boolean }).__wasmPaused = true;
      });

      // Extract the captured screenshot
      const screenshot = await tryEval(page, () => {
        const w = window as unknown as {
          __wasmGetLastScreenshot: () => { key: string; dataUrl: string } | null;
        };
        return w.__wasmGetLastScreenshot();
      }, 10000);

      if (screenshot?.dataUrl) {
        const filename = `wasm-${point.name}-full.png`;
        if (saveDataUrl(screenshot.dataUrl, path.join(STATIC_DIR, filename))) {
          saved++;
          const size = fs.statSync(path.join(STATIC_DIR, filename)).size;
          console.log(`WASM Static: Saved ${filename} (${size} bytes)`);
        }
      }
    }

    // Also capture one full-canvas screenshot for reference
    await saveCanvas(page, path.join(STATIC_DIR, 'wasm-full-canvas.png'));
    saved++;

    console.log(`WASM Static: ${saved} screenshots saved`);
    fs.writeFileSync(path.join(STATIC_DIR, 'wasm-console.log'), logs.join('\n'));
  });
});

// ────────────────────────────────────────────────────────────────

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
    page.on('console', msg => {
      const text = msg.text();
      logs.push(`[${msg.type()}] ${text}`);
      if (text.includes('[AUTOPLAY]')) console.log(`WASM: ${text}`);
    });
    page.on('dialog', async dialog => {
      console.log(`WASM: Dialog: ${dialog.type()} - ${dialog.message()}`);
      await dialog.accept();
    });

    await page.goto(`${BASE_URL}/ra/original.html?autoplay=ants`, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { timeout: 30000 });
    console.log('WASM: Canvas found, waiting for WASM to load...');

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

    console.log('WASM: Waiting for content...');
    await wait(5000);

    const initiallyResponsive = await waitForResponsive(page, 15000);
    if (!initiallyResponsive) {
      console.log('WASM: Game not responsive initially, skipping navigation');
    } else {
      console.log('WASM: Game responsive, waiting for input exports...');

      let inputReady = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        const ready = await tryEval(page, () => {
          return (window as unknown as { __inputReady: () => boolean }).__inputReady();
        });
        if (ready) { inputReady = true; break; }
        await wait(1000);
      }

      if (!inputReady) {
        console.log('WASM: Input exports not available after 30s — falling back to CDP');
        for (let i = 0; i < 5; i++) {
          try {
            await Promise.race([
              page.keyboard.press('Enter'),
              new Promise<void>(resolve => setTimeout(resolve, 10000)),
            ]);
          } catch { break; }
          await wait(3000);
          await waitForResponsive(page, 30000);
        }
      } else {
        console.log('WASM: Input injection ready');

        const autoplaySet = await tryEval(page, () => {
          return (window as unknown as { __setAutoplay: (mode: boolean) => boolean }).__setAutoplay(true);
        });
        console.log(`WASM: Autoplay mode: ${autoplaySet}`);

        console.log('WASM: Injecting Enter to start new game...');

        const hashBefore = await tryEval(page, () => {
          return (window as unknown as { __getScreenHash: () => string }).__getScreenHash();
        });

        await tryEval(page, () => {
          return (window as unknown as { __injectKey: (vk: number) => boolean }).__injectKey(40);
        });

        console.log('WASM: Waiting up to 5min for gameplay...');
        const loadingStart = Date.now();
        let gameReady = false;
        let lastLog = 0;
        let enterRetries = 0;
        while (Date.now() - loadingStart < 300000) {
          const result = await tryEval(page, () => {
            return (window as unknown as { __wasmRenderCount: number }).__wasmRenderCount || 0;
          }, 5000);

          const elapsed = Math.round((Date.now() - loadingStart) / 1000);
          if (result !== null) {
            const hashNow = await tryEval(page, () => {
              return (window as unknown as { __getScreenHash: () => string }).__getScreenHash();
            });
            if (hashNow !== null && hashNow !== hashBefore) {
              console.log(`WASM: Screen changed after ${elapsed}s — gameplay!`);
              gameReady = true;
              break;
            }
            if (elapsed > 5 && enterRetries < 10) {
              enterRetries++;
              console.log(`WASM: Injecting Enter #${enterRetries}...`);
              await tryEval(page, () => {
                return (window as unknown as { __injectKey: (vk: number) => boolean }).__injectKey(40);
              });
              await wait(2000);
              continue;
            }
          }
          if (elapsed - lastLog >= 10) {
            console.log(`WASM: Loading... ${elapsed}s`);
            lastLog = elapsed;
          }
          await wait(3000);
        }

        if (gameReady) {
          // Use on-demand capture for reliable screenshots
          await tryEval(page, () => {
            (window as unknown as { __wasmCaptureOnRender: (k: string) => void }).__wasmCaptureOnRender('gameplay-initial');
          });
          await wait(500);
          await saveCanvas(page, path.join(WASM_DIR, 'gameplay.png'));
          console.log('WASM: Game reached gameplay!');
        } else {
          await saveCanvas(page, path.join(WASM_DIR, 'timeout-state.png'));
          console.log('WASM: Game did not reach gameplay');
        }
      }

      const diag = await tryEval(page, () => {
        return (window as unknown as { __inputDiag: () => Record<string, unknown> }).__inputDiag();
      });
      console.log(`WASM: Input system: ${JSON.stringify(diag)}`);

      console.log('WASM: Waiting 20s for scenario loading...');
      await wait(20000);
      await waitForResponsive(page, 60000);

      // Use on-demand capture
      await tryEval(page, () => {
        (window as unknown as { __wasmCaptureOnRender: (k: string) => void }).__wasmCaptureOnRender('post-menu');
      });
      await wait(500);
      await saveCanvas(page, path.join(WASM_DIR, 'post-menu.png'));
    }

    console.log('WASM: Menu navigation complete');

    // Capture periodic screenshots using on-demand capture every 5s for 30s
    console.log('WASM: Running game for 30s with periodic captures...');
    for (let i = 0; i < 6; i++) {
      await wait(5000);
      await tryEval(page, () => {
        const renderCount = (window as unknown as { __wasmRenderCount: number }).__wasmRenderCount;
        (window as unknown as { __wasmCaptureOnRender: (k: string) => void })
          .__wasmCaptureOnRender('gameplay-' + renderCount);
      });
    }

    // Extract metadata
    const meta = await tryEval(page, () => {
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
      console.log('WASM: Could not extract metadata');
      fs.writeFileSync(path.join(WASM_DIR, 'console.log'), logs.join('\n'));
      return;
    }

    console.log(`WASM: ${meta.frameCount} rAF, ${meta.renderCount} renders, ${meta.count} screenshots`);

    // Extract screenshots in batches
    const maxScreenshots = Math.min(meta.count, 30);
    let saved = 0;
    const fileSizes: number[] = [];
    const BATCH_SIZE = 10;

    for (let batch = 0; batch * BATCH_SIZE < maxScreenshots; batch++) {
      const start = batch * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, maxScreenshots);

      let batchData: Array<{ key: string; dataUrl: string }> | null = null;
      try {
        batchData = await Promise.race([
          page.evaluate(([s, e]: [number, number]) => {
            const w = window as unknown as {
              __wasmScreenshots: Array<{ key: string; dataUrl: string; frame: number }>;
            };
            return (w.__wasmScreenshots || []).slice(s, e).map(ss => ({
              key: ss.key, dataUrl: ss.dataUrl,
            }));
          }, [start, end] as [number, number]),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 30000)),
        ]);
      } catch {
        batchData = null;
      }

      if (!batchData) continue;

      for (const ss of batchData) {
        if (!ss?.dataUrl) continue;
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

    if (fileSizes.length >= 3) {
      const uniqueSizes = new Set(fileSizes);
      const varied = uniqueSizes.size > 1;
      console.log(`WASM: ${uniqueSizes.size} unique sizes — ${varied ? 'VARIED' : 'ALL IDENTICAL'}`);
    }

    const allLogs = [
      ...(meta.logs || []), '', '--- Autoplay ---',
      ...(meta.autoplayLog || []), '', '--- Diagnostics ---',
      JSON.stringify(meta.diag, null, 2), '', '--- Console ---', ...logs,
    ];
    fs.writeFileSync(path.join(WASM_DIR, 'console.log'), allLogs.join('\n'));
    console.log('WASM: Test complete');
  });
});
