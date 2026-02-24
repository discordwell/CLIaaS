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
    page.on('console', msg => {
      const text = msg.text();
      logs.push(`[${msg.type()}] ${text}`);
      // Forward AUTOPLAY debug prints from C++ printf to test output
      if (text.includes('[AUTOPLAY]')) {
        console.log(`WASM: ${text}`);
      }
    });
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

    /**
     * Wait for the screen to stop changing (e.g. briefing text finished scrolling).
     * Polls __getScreenHash() and considers the screen stable when the hash
     * hasn't changed for `stableMs` milliseconds.
     */
    async function waitForScreenStability(stableMs = 3000, maxWaitMs = 30000): Promise<boolean> {
      const start = Date.now();
      let lastHash = await tryEval(() => {
        return (window as unknown as { __getScreenHash: () => string }).__getScreenHash();
      });
      let stableSince = Date.now();

      while (Date.now() - start < maxWaitMs) {
        await wait(1000);
        const hash = await tryEval(() => {
          return (window as unknown as { __getScreenHash: () => string }).__getScreenHash();
        });
        if (hash === null) continue; // evaluate failed, game busy

        if (hash !== lastHash) {
          lastHash = hash;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= stableMs) {
          console.log(`WASM: Screen stable for ${stableMs}ms`);
          return true;
        }
      }
      console.log(`WASM: Screen stability timeout after ${maxWaitMs}ms`);
      return false;
    }

    /**
     * Click at game coordinates via CDP mouse events.
     *
     * Emscripten's fillMouseEventData computes:
     *   canvasX = clientX - rect.left (where internal getBCR returns {left:0})
     * So canvasX = viewport clientX directly. Identity transform.
     *
     * Both move() and click() have timeouts because CDP calls to the renderer
     * can block indefinitely when WASM monopolizes the JS thread.
     */
    async function clickGame(gx: number, gy: number, label: string): Promise<boolean> {
      // Identity: game coords = viewport coords (rect.left=0, rect.top=0)
      console.log(`WASM: Mouse click at (${gx}, ${gy}) — ${label}`);
      try {
        // Move with timeout — CDP can block if WASM is in a tight loop
        const moved = await Promise.race([
          page.mouse.move(gx, gy).then(() => true),
          new Promise<boolean>(resolve => setTimeout(() => resolve(false), 10000)),
        ]);
        if (!moved) {
          console.log(`WASM: mouse.move timed out — ${label}`);
        }
        await wait(100);
        // Click with timeout
        const clicked = await Promise.race([
          page.mouse.click(gx, gy).then(() => true),
          new Promise<boolean>(resolve => setTimeout(() => resolve(false), 10000)),
        ]);
        if (!clicked) {
          console.log(`WASM: mouse.click timed out — ${label}`);
        }
        return moved || clicked; // at least one CDP event went through
      } catch {
        console.log(`WASM: Mouse click failed — ${label}`);
        return false;
      }
    }

    /**
     * Check if the screen changed after an action by comparing hashes.
     */
    async function screenChanged(previousHash: string | null): Promise<boolean> {
      const hash = await tryEval(() => {
        return (window as unknown as { __getScreenHash: () => string }).__getScreenHash();
      });
      return hash !== null && hash !== previousHash;
    }

    // === Input injection via WASM exports ===
    //
    // The WASM binary now exports C functions (via EMSCRIPTEN_KEEPALIVE) that
    // call Keyboard->Put() directly from C++. This bypasses all SDL event
    // handling and Asyncify constraints. original.html wraps these as:
    //   __injectKey(vkCode)                    → key press + release
    //   __injectMouseClick(gameX, gameY, btn)  → mouse press + release
    //   __injectMouseMove(gameX, gameY)        → cursor position update
    //   __inputReady()                         → true when exports available
    //
    // VK codes: VK_RETURN=40, VK_ESCAPE=41, VK_SPACE=44,
    //           VK_LBUTTON=1, VK_RBUTTON=2

    // Wait for initial content
    console.log('WASM: Waiting for content...');
    await wait(5000);

    const initiallyResponsive = await waitForResponsive(15000);
    if (!initiallyResponsive) {
      console.log('WASM: Game not responsive initially, skipping navigation');
    } else {
      console.log('WASM: Game responsive, waiting for input exports...');

      // Wait for Module._inject_key to be available
      let inputReady = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        const ready = await tryEval(() => {
          return (window as unknown as { __inputReady: () => boolean }).__inputReady();
        });
        if (ready) {
          inputReady = true;
          break;
        }
        await wait(1000);
      }

      if (!inputReady) {
        console.log('WASM: Input exports not available after 30s — falling back to CDP');
        // Fallback: just send CDP Enter presses and hope for the best
        for (let i = 0; i < 5; i++) {
          try {
            await Promise.race([
              page.keyboard.press('Enter'),
              new Promise<void>(resolve => setTimeout(resolve, 10000)),
            ]);
          } catch { break; }
          await wait(3000);
          await waitForResponsive(30000);
        }
      } else {
        console.log('WASM: Input injection ready (WASM exports available)');

        // --- Step 0: Enable autoplay mode ---
        // This sets a C++ flag (g_autoplay_mode) that causes BGMessageBox
        // to return immediately (as if OK was pressed). This bypasses the
        // briefing dialog's modal input loop which doesn't yield to Asyncify.
        const autoplaySet = await tryEval(() => {
          return (window as unknown as { __setAutoplay: (mode: boolean) => boolean }).__setAutoplay(true);
        });
        console.log(`WASM: Autoplay mode: ${autoplaySet}`);

        // --- Step 1: Navigate past main menu ---
        // Inject Enter to select "Start New Game" (default highlighted button).
        // With autoplay mode, the entire chain auto-completes:
        //   Main Menu → Enter → Fetch_Difficulty (auto: normal) →
        //   WWMessageBox "Choose your side" (auto: Allies) →
        //   Start_Scenario → BGMessageBox briefing (auto: OK) → Main game loop
        console.log('WASM: Injecting Enter to start new game...');

        const hashBefore = await tryEval(() => {
          return (window as unknown as { __getScreenHash: () => string }).__getScreenHash();
        });

        const enterResult = await tryEval(() => {
          return (window as unknown as { __injectKey: (vk: number) => boolean }).__injectKey(40);
        });
        console.log(`WASM: Enter inject result: ${enterResult}`);

        // --- Step 2: Wait for game to load into gameplay ---
        // The autoplay bypasses all dialogs. Call_Back() now yields via
        // emscripten_sleep(0) during heavy computation (scenario loading).
        // We poll until the game is responsive AND screen changes.
        console.log('WASM: Waiting up to 5min for game to reach gameplay...');
        const loadingStart = Date.now();
        let gameReady = false;
        let lastLog = 0;
        let enterRetries = 0;
        while (Date.now() - loadingStart < 300000) {
          const result = await tryEval(() => {
            return (window as unknown as { __wasmRenderCount: number }).__wasmRenderCount || 0;
          }, 5000);

          const elapsed = Math.round((Date.now() - loadingStart) / 1000);
          if (result !== null) {
            // Game is responsive — check if screen changed
            const hashNow = await tryEval(() => {
              return (window as unknown as { __getScreenHash: () => string }).__getScreenHash();
            });

            if (hashNow !== null && hashNow !== hashBefore) {
              console.log(`WASM: Screen changed after ${elapsed}s — game progressed! (renders=${result})`);
              gameReady = true;
              break;
            }

            // Responsive but screen unchanged — may need more Enter presses
            // (e.g. if the first Enter wasn't consumed yet, or a new dialog appeared)
            if (elapsed > 5 && enterRetries < 10) {
              enterRetries++;
              console.log(`WASM: Responsive but unchanged at ${elapsed}s — injecting Enter #${enterRetries}...`);
              await tryEval(() => {
                return (window as unknown as { __injectKey: (vk: number) => boolean }).__injectKey(40);
              });
              await wait(2000);
              continue;
            }
          }

          if (elapsed - lastLog >= 10) {
            console.log(`WASM: Loading... ${elapsed}s elapsed (responsive=${result !== null})`);
            lastLog = elapsed;
          }
          await wait(3000);
        }

        if (gameReady) {
          await saveCanvas(page, path.join(WASM_DIR, 'gameplay.png'));
          console.log('WASM: Game reached gameplay!');
        } else {
          await saveCanvas(page, path.join(WASM_DIR, 'timeout-state.png'));
          console.log('WASM: Game did not reach gameplay within timeout');
        }
      }

      // Check input system diagnostics
      const diag = await tryEval(() => {
        return (window as unknown as { __inputDiag: () => Record<string, unknown> }).__inputDiag();
      });
      console.log(`WASM: Input system: ${JSON.stringify(diag)}`);

      // Wait for scenario to finish loading
      console.log('WASM: Waiting 20s for scenario loading...');
      await wait(20000);
      await waitForResponsive(60000);
      await saveCanvas(page, path.join(WASM_DIR, 'post-menu.png'));
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
