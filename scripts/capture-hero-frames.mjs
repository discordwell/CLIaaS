/**
 * Capture the hero demo animation as individual PNG frames using Puppeteer.
 * Run with: node scripts/capture-hero-frames.mjs
 * Requires a Next.js server running on port 3456.
 */
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = '/tmp/hero-demo-frames';
const URL = 'http://localhost:3456/demo-recording?autostart=true&speed=1';
const FPS = 10;
const FRAME_INTERVAL = 1000 / FPS; // 100ms between frames
const MAX_DURATION_S = 40; // safety cap

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 500, deviceScaleFactor: 2 });

  // Navigate and wait for page load
  await page.goto(URL, { waitUntil: 'networkidle0' });

  // Dismiss PWA install prompt by setting localStorage flag
  await page.evaluate(() => {
    localStorage.setItem('cliaas-pwa-dismissed', '1');
  });
  // Reload to apply the dismissed state
  await page.goto(URL, { waitUntil: 'networkidle0' });

  // Wait a moment for autostart delay (1s in the component)
  await new Promise(r => setTimeout(r, 500));

  console.log('Starting frame capture...');

  let frameNum = 0;
  const maxFrames = MAX_DURATION_S * FPS;
  let lastContent = '';
  let stableCount = 0;

  for (let i = 0; i < maxFrames; i++) {
    const filename = path.join(FRAMES_DIR, `frame-${String(frameNum).padStart(4, '0')}.png`);
    await page.screenshot({ path: filename, type: 'png' });
    frameNum++;

    // Check if content has stopped changing (animation complete)
    const content = await page.evaluate(() => document.body.innerText);
    if (content === lastContent) {
      stableCount++;
      // After 3 seconds of no change, we're done (but capture a few extra frames)
      if (stableCount >= FPS * 3) {
        console.log(`Animation stable for 3s, capturing ${FPS * 2} more frames...`);
        // Capture 2 more seconds of the final state
        for (let j = 0; j < FPS * 2; j++) {
          const extraFile = path.join(FRAMES_DIR, `frame-${String(frameNum).padStart(4, '0')}.png`);
          await page.screenshot({ path: extraFile, type: 'png' });
          frameNum++;
          await new Promise(r => setTimeout(r, FRAME_INTERVAL));
        }
        break;
      }
    } else {
      stableCount = 0;
      lastContent = content;
    }

    await new Promise(r => setTimeout(r, FRAME_INTERVAL));
  }

  console.log(`Captured ${frameNum} frames`);
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
