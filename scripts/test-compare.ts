/**
 * Playwright comparison test: TS engine vs WASM original.
 *
 * Captures screenshots from both the TypeScript Red Alert engine
 * and the original C++ WASM build for visual comparison.
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

/** Save canvas content as PNG via toDataURL (works for WebGL) */
async function saveCanvas(page: Page, filePath: string): Promise<boolean> {
  try {
    const dataUrl = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      // For WebGL, need preserveDrawingBuffer or readPixels
      // Try toDataURL first
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
    // Fallback to page screenshot
    await page.screenshot({ path: filePath, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
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

  test('WASM Original: ant mission screenshots', async ({ page, context }) => {
    ensureDirs();

    const logs: string[] = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

    // Dismiss any dialogs automatically
    page.on('dialog', async dialog => {
      console.log(`WASM: Dialog: ${dialog.type()} - ${dialog.message()}`);
      await dialog.accept();
    });

    // Navigate to WASM original
    await page.goto(`${BASE_URL}/ra/original.html`, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { timeout: 30000 });
    console.log('WASM: Canvas found, waiting for WASM to load...');

    // Wait for WASM to finish loading
    try {
      await page.waitForFunction(
        () => {
          const status = document.getElementById('status');
          return status && (status.style.display === 'none' || status.innerHTML === 'All downloads complete.');
        },
        { timeout: 120000, polling: 1000 },
      );
    } catch {
      console.log('WASM: Load detection timed out, continuing anyway');
    }

    console.log('WASM: Taking screenshots');
    await wait(3000); // Give WASM time to render first frames

    // Capture via canvas toDataURL for WebGL content
    await saveCanvas(page, path.join(WASM_DIR, '01-loaded.png'));

    // Click canvas to focus
    const canvas = await page.$('canvas');
    if (canvas) {
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
    }
    await wait(2000);
    await saveCanvas(page, path.join(WASM_DIR, '02-focused.png'));

    // Try navigating menus with mouse clicks at various positions
    // The original RA menu buttons are typically centered
    if (canvas) {
      const box = await canvas.boundingBox();
      if (box) {
        // Click center (typical menu button position)
        for (let i = 0; i < 5; i++) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4 + i * 30);
          await wait(1500);
          await saveCanvas(page, path.join(WASM_DIR, `03-click-${i}.png`));
        }
      }
    }

    // Try keyboard navigation
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Enter');
      await wait(2000);
      await saveCanvas(page, path.join(WASM_DIR, `04-enter-${i}.png`));
    }

    // Take gameplay screenshots at intervals
    for (let i = 0; i < 10; i++) {
      await wait(3000);
      await saveCanvas(page, path.join(WASM_DIR, `05-gameplay-${String(i).padStart(2, '0')}.png`));
    }

    fs.writeFileSync(path.join(WASM_DIR, 'console.log'), logs.join('\n'));
    console.log('WASM: All screenshots captured');
  });
});
