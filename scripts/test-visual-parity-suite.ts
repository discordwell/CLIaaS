/**
 * Visual parity harness for C++ WASM vs TS campaign missions.
 *
 * Captures real rendered frames from both engines, records nonblank/pixel
 * metrics, and keeps the pixel assertion opt-in because TS rendering is not
 * expected to be byte-identical to the SDL back buffer yet.
 *
 * Usage:
 *   BASE_URL=http://localhost:3001 TS_BASE_URL=http://localhost:3001 \
 *   SCENARIOS=SCG02EA,SCG09EA,SCU03EA TICKS=1,50,100 \
 *   pnpm exec playwright test scripts/test-visual-parity-suite.ts --reporter=line
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const ALL_SCENARIOS = [
  'SCG01EA', 'SCG02EA', 'SCG03EA', 'SCG04EA', 'SCG06EA', 'SCG07EA',
  'SCG08EA', 'SCG09EA', 'SCG10EA', 'SCG11EA', 'SCG12EA', 'SCG13EA',
];
const DEFAULT_TICKS = [1, 50, 100];
const BASE_URL = process.env.BASE_URL ?? 'https://cliaas.com';
const TS_BASE_URL = process.env.TS_BASE_URL ?? BASE_URL;
const OUT_DIR = process.env.OUT_DIR ?? path.join(process.cwd(), 'artifacts', 'visual-parity');
const HARNESS_SALT = process.env.HARNESS_SALT ?? 'anti-shim-visual-v1';
const EXPECT_PIXELS = process.env.EXPECT_PIXELS === '1';
const PIXEL_MISMATCH_THRESHOLD = Number(process.env.PIXEL_MISMATCH_THRESHOLD ?? 0.35);
const MIN_NONBLACK_RATIO = Number(process.env.MIN_NONBLACK_RATIO ?? 0.01);
const TS_FOG_MODE = process.env.TS_FOG_MODE ?? 'source';

const scenarios = process.env.SCENARIOS?.split(',') ?? ALL_SCENARIOS;
const ticks = process.env.TICKS?.split(',').map(Number) ?? DEFAULT_TICKS;

type Side = 'wasm' | 'ts';

interface CapturedFrame {
  dataUrl: string | null;
  width: number;
  height: number;
  nonBlackRatio: number;
  alphaRatio: number;
}

interface PixelMetrics {
  comparable: boolean;
  mismatchRatio: number | null;
  mismatchPixels: number | null;
  totalPixels: number | null;
  reason?: string;
}

interface VisualResult {
  tick: number;
  stateMatch: boolean;
  unitCountDelta: number;
  enemyCountDelta: number;
  structCountDelta: number;
  creditsDelta: number;
  timerDelta: number;
  tickDelta: number;
  wasmNonBlack: number;
  tsNonBlack: number;
  wasmSize: string;
  tsSize: string;
  pixelComparable: boolean;
  pixelMismatchRatio: number | null;
  pixelReason?: string;
}

function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function baseWithSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function addHarnessNoise(url: URL, scenario: string, side: Side): string {
  const hash = hashText(`${HARNESS_SALT}:${scenario}:${side}`);
  url.searchParams.set('__parityHarness', 'visual-salted');
  url.searchParams.set('__parityToken', hash.toString(36));
  url.searchParams.set('__paritySide', side);
  url.searchParams.set('__noop', `${(hash >>> 7) % 997}`);
  return url.toString();
}

function wasmUrl(scenario: string): string {
  const url = new URL('/ra/original.html', baseWithSlash(BASE_URL));
  url.searchParams.set('scenario', `${scenario}.INI`);
  url.searchParams.set('autoplay', '1');
  url.searchParams.set('agentharness', '1');
  url.searchParams.set('seed', '0');
  return addHarnessNoise(url, scenario, 'wasm');
}

function tsUrl(scenario: string): string {
  const url = new URL(TS_BASE_URL);
  url.searchParams.set('anttest', 'agent');
  url.searchParams.set('scenario', scenario);
  url.searchParams.set('difficulty', 'normal');
  if (TS_FOG_MODE) url.searchParams.set('fog', TS_FOG_MODE);
  return addHarnessNoise(url, scenario, 'ts');
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
}

function readPng(dataUrl: string): PNG {
  return PNG.sync.read(dataUrlToBuffer(dataUrl));
}

function analyzePng(png: PNG): Pick<CapturedFrame, 'nonBlackRatio' | 'alphaRatio'> {
  let nonBlack = 0;
  let alpha = 0;
  const total = png.width * png.height;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const a = png.data[i + 3];
    if (a > 0) alpha++;
    if (a > 0 && (r !== 0 || g !== 0 || b !== 0)) nonBlack++;
  }
  return {
    nonBlackRatio: total > 0 ? nonBlack / total : 0,
    alphaRatio: total > 0 ? alpha / total : 0,
  };
}

function compareFrames(wasm: CapturedFrame, ts: CapturedFrame, diffPath?: string): PixelMetrics {
  if (!wasm.dataUrl || !ts.dataUrl) {
    return { comparable: false, mismatchRatio: null, mismatchPixels: null, totalPixels: null, reason: 'missing frame' };
  }
  const wasmPng = readPng(wasm.dataUrl);
  const tsPng = readPng(ts.dataUrl);
  if (wasmPng.width !== tsPng.width || wasmPng.height !== tsPng.height) {
    return {
      comparable: false,
      mismatchRatio: null,
      mismatchPixels: null,
      totalPixels: null,
      reason: `dimension mismatch ${wasmPng.width}x${wasmPng.height} vs ${tsPng.width}x${tsPng.height}`,
    };
  }
  const diff = new PNG({ width: wasmPng.width, height: wasmPng.height });
  const mismatchPixels = pixelmatch(wasmPng.data, tsPng.data, diff.data, wasmPng.width, wasmPng.height, {
    threshold: 0.1,
    includeAA: true,
  });
  if (diffPath) {
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
  }
  const totalPixels = wasmPng.width * wasmPng.height;
  return {
    comparable: true,
    mismatchRatio: totalPixels > 0 ? mismatchPixels / totalPixels : 0,
    mismatchPixels,
    totalPixels,
  };
}

function saveFrame(scenario: string, tick: number, side: Side, frame: CapturedFrame): void {
  if (!frame.dataUrl) return;
  fs.writeFileSync(
    path.join(OUT_DIR, `${scenario}_t${tick}_${side}.png`),
    dataUrlToBuffer(frame.dataUrl),
  );
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function imageExists(fileName: string): boolean {
  return fs.existsSync(path.join(OUT_DIR, fileName));
}

function writeHtmlReport(): void {
  if (!fs.existsSync(OUT_DIR)) return;
  const reportFiles = fs.readdirSync(OUT_DIR)
    .filter(name => name.endsWith('_report.json'))
    .sort();
  const sections: string[] = [];
  for (const reportFile of reportFiles) {
    try {
      const report = JSON.parse(fs.readFileSync(path.join(OUT_DIR, reportFile), 'utf8')) as {
        scenario: string;
        results: VisualResult[];
      };
      const rows = report.results.map((r) => {
        const wasmImage = `${report.scenario}_t${r.tick}_wasm.png`;
        const tsImage = `${report.scenario}_t${r.tick}_ts.png`;
        const diffImage = `${report.scenario}_t${r.tick}_diff.png`;
        const diffCell = imageExists(diffImage)
          ? `<a href="${escapeHtml(diffImage)}"><img src="${escapeHtml(diffImage)}" alt="diff ${escapeHtml(report.scenario)} t${r.tick}"></a>`
          : `<span class="muted">${escapeHtml(r.pixelReason ?? 'not comparable')}</span>`;
        return `
          <tr class="${r.stateMatch ? '' : 'state-diff'}">
            <td>${r.tick}</td>
            <td>${r.stateMatch ? 'match-ish' : 'diff'}</td>
            <td>units ${r.unitCountDelta}, enemies ${r.enemyCountDelta}, structures ${r.structCountDelta}, credits ${r.creditsDelta}, timer ${r.timerDelta}</td>
            <td>${escapeHtml(r.wasmSize)} / ${escapeHtml(r.tsSize)}</td>
            <td>${r.pixelMismatchRatio === null ? escapeHtml(r.pixelReason ?? 'n/a') : `${(r.pixelMismatchRatio * 100).toFixed(2)}%`}</td>
            <td><a href="${escapeHtml(wasmImage)}"><img src="${escapeHtml(wasmImage)}" alt="wasm ${escapeHtml(report.scenario)} t${r.tick}"></a></td>
            <td><a href="${escapeHtml(tsImage)}"><img src="${escapeHtml(tsImage)}" alt="ts ${escapeHtml(report.scenario)} t${r.tick}"></a></td>
            <td>${diffCell}</td>
          </tr>`;
      }).join('\n');
      sections.push(`
        <section>
          <h2>${escapeHtml(report.scenario)}</h2>
          <table>
            <thead>
              <tr><th>Tick</th><th>State</th><th>Deltas</th><th>Frame Size</th><th>Pixels</th><th>WASM</th><th>TS</th><th>Diff</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </section>`);
    } catch (err) {
      sections.push(`<p>Could not read ${escapeHtml(reportFile)}: ${escapeHtml(String(err))}</p>`);
    }
  }

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>RA Visual Parity Sweep</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #1f2933; background: #f8fafc; }
    h1 { margin: 0 0 4px; font-size: 24px; }
    h2 { margin-top: 28px; font-size: 18px; }
    p { margin-top: 0; color: #52606d; }
    table { border-collapse: collapse; width: 100%; background: white; border: 1px solid #d9e2ec; }
    th, td { border: 1px solid #d9e2ec; padding: 8px; vertical-align: top; font-size: 12px; }
    th { text-align: left; background: #eef2f7; position: sticky; top: 0; }
    tr.state-diff { background: #fff7ed; }
    img { width: 220px; max-width: 100%; image-rendering: pixelated; border: 1px solid #bcccdc; background: #000; }
    .muted { color: #829ab1; }
  </style>
</head>
<body>
  <h1>RA Visual Parity Sweep</h1>
  <p>Generated by scripts/test-visual-parity-suite.ts. WASM and TS frames are real canvas captures at the same stepped ticks.</p>
  ${sections.join('\n')}
</body>
</html>
`;
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
}

test.describe('Visual Parity Suite', () => {
  test.setTimeout(10 * 60 * 1000);

  for (const scenario of scenarios) {
    test(`${scenario} state and render parity`, async ({ browser }) => {
      fs.mkdirSync(OUT_DIR, { recursive: true });

      const wasmCtx = await browser.newContext();
      const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      const wasmPage = await wasmCtx.newPage();
      const tsPage = await tsCtx.newPage();
      wasmPage.on('dialog', async d => { await d.accept(); });

      await Promise.all([
        wasmPage.goto(wasmUrl(scenario), { waitUntil: 'load' }),
        tsPage.goto(tsUrl(scenario), { waitUntil: 'load' }),
      ]);

      await Promise.all([
        wasmPage.waitForFunction(() => {
          try {
            const M = (window as any).Module;
            if (!M?.ccall) return false;
            const s = JSON.parse(M.ccall('agent_get_state', 'string', [], []));
            return (s.units?.length ?? 0) + (s.enemies?.length ?? 0) + (s.structures?.length ?? 0) > 0;
          } catch { return false; }
        }, { timeout: 180_000, polling: 2000 }),
        tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
      ]);

      const wasmSeed = await wasmPage.evaluate(() => {
        const M = (window as any).Module;
        return JSON.parse(M.ccall('agent_get_state', 'string', [], [])).rngState;
      });
      await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

      const results: VisualResult[] = [];
      let prevTick = 0;
      for (const targetTick of ticks) {
        const step = targetTick - prevTick;
        if (step > 0) {
          let remaining = step;
          while (remaining > 0) {
            const batch = Math.min(remaining, 300);
            remaining -= batch;
            await Promise.all([
              wasmPage.evaluate(async (n: number) => {
                const r = (window as any).__agentStep(n);
                if (r?.then) await r;
              }, batch),
              tsPage.evaluate((n: number) => { (window as any).__agentStep?.(n); }, batch),
            ]);
          }
        }
        prevTick = targetTick;

        const [wasmState, tsState] = await Promise.all([
          wasmPage.evaluate(() => {
            const M = (window as any).Module;
            const s = JSON.parse(M.ccall('agent_get_state', 'string', [], []));
            return {
              tick: s.tick, credits: s.credits, missionTimer: s.missionTimer ?? 0,
              unitCount: s.units?.length ?? 0, enemyCount: s.enemies?.length ?? 0,
              structCount: s.structures?.length ?? 0, gameState: s.gameState ?? 'unknown',
            };
          }),
          tsPage.evaluate(() => {
            const s = (window as any).__agentState();
            return {
              tick: s.tick, credits: s.credits, missionTimer: s.missionTimer ?? 0,
              unitCount: s.units?.length ?? 0, enemyCount: s.enemies?.length ?? 0,
              structCount: s.structures?.length ?? 0, gameState: s.state ?? 'unknown',
            };
          }),
        ]);

        const unitDelta = Math.abs(tsState.unitCount - wasmState.unitCount);
        const enemyDelta = Math.abs(tsState.enemyCount - wasmState.enemyCount);
        const structDelta = Math.abs(tsState.structCount - wasmState.structCount);
        const creditsDelta = Math.abs(tsState.credits - wasmState.credits);
        const timerDelta = Math.abs(tsState.missionTimer - wasmState.missionTimer);
        const tickDelta = Math.abs(tsState.tick - wasmState.tick);
        const stateMatch = unitDelta <= 2 && enemyDelta <= 2 && structDelta <= 1 &&
          creditsDelta <= 500 && (timerDelta <= 5 || tickDelta > 5);

        const wasmFrame = await wasmPage.evaluate((): CapturedFrame => {
          const M = (window as any).Module;
          M.ccall('agent_render', null, [], []);
          const ptr = (window as any).__agentFramePtr;
          if (!ptr || !M.HEAPU8) return { dataUrl: null, width: 0, height: 0, nonBlackRatio: 0, alphaRatio: 0 };
          const w = 640, h = 400;
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const ctx = c.getContext('2d')!;
          const img = ctx.createImageData(w, h);
          const heap = M.HEAPU8;
          for (let i = 0; i < w * h * 4; i++) img.data[i] = heap[ptr + i];
          ctx.putImageData(img, 0, 0);
          return { dataUrl: c.toDataURL('image/png'), width: w, height: h, nonBlackRatio: 0, alphaRatio: 0 };
        });
        const tsFrame = await tsPage.evaluate((): CapturedFrame => {
          // C++ agent_render reads the existing HidPage back buffer. TS
          // __agentStep(n) already leaves the equivalent pre-Logic frame on
          // canvas, so do not force a render-only step here or the capture
          // moves one logic frame ahead of the original.
          const c = document.querySelector('canvas');
          if (!c) return { dataUrl: null, width: 0, height: 0, nonBlackRatio: 0, alphaRatio: 0 };
          return { dataUrl: c.toDataURL('image/png'), width: c.width, height: c.height, nonBlackRatio: 0, alphaRatio: 0 };
        });

        saveFrame(scenario, targetTick, 'wasm', wasmFrame);
        saveFrame(scenario, targetTick, 'ts', tsFrame);

        const wasmStats = wasmFrame.dataUrl ? analyzePng(readPng(wasmFrame.dataUrl)) : wasmFrame;
        const tsStats = tsFrame.dataUrl ? analyzePng(readPng(tsFrame.dataUrl)) : tsFrame;
        const pixelMetrics = compareFrames(
          wasmFrame,
          tsFrame,
          path.join(OUT_DIR, `${scenario}_t${targetTick}_diff.png`),
        );

        results.push({
          tick: targetTick,
          stateMatch,
          unitCountDelta: unitDelta,
          enemyCountDelta: enemyDelta,
          structCountDelta: structDelta,
          creditsDelta,
          timerDelta,
          tickDelta,
          wasmNonBlack: Number(wasmStats.nonBlackRatio.toFixed(6)),
          tsNonBlack: Number(tsStats.nonBlackRatio.toFixed(6)),
          wasmSize: `${wasmFrame.width}x${wasmFrame.height}`,
          tsSize: `${tsFrame.width}x${tsFrame.height}`,
          pixelComparable: pixelMetrics.comparable,
          pixelMismatchRatio: pixelMetrics.mismatchRatio === null ? null : Number(pixelMetrics.mismatchRatio.toFixed(6)),
          pixelReason: pixelMetrics.reason,
        });

        const pixelSummary = pixelMetrics.comparable
          ? `pixels=${((pixelMetrics.mismatchRatio ?? 0) * 100).toFixed(2)}%`
          : `pixels=n/a(${pixelMetrics.reason})`;
        console.log(
          `  ${scenario} t${targetTick}: units+/-${unitDelta} enemies+/-${enemyDelta} ` +
          `structs+/-${structDelta} credits+/-${creditsDelta} timer+/-${timerDelta} ` +
          `tick=${tsState.tick}/${wasmState.tick}(+/-${tickDelta}) ` +
          `state=${tsState.gameState}/${wasmState.gameState} ${pixelSummary} ` +
          `nonblack=${(wasmStats.nonBlackRatio * 100).toFixed(1)}%/${(tsStats.nonBlackRatio * 100).toFixed(1)}% ` +
          `${stateMatch ? 'MATCH' : 'DIFF'}`,
        );

        expect(wasmStats.nonBlackRatio, `${scenario} t${targetTick} WASM frame should not be blank`).toBeGreaterThan(MIN_NONBLACK_RATIO);
        expect(tsStats.nonBlackRatio, `${scenario} t${targetTick} TS frame should not be blank`).toBeGreaterThan(MIN_NONBLACK_RATIO);
        if (EXPECT_PIXELS && pixelMetrics.comparable) {
          expect(pixelMetrics.mismatchRatio, `${scenario} t${targetTick} pixel mismatch ratio`).toBeLessThanOrEqual(PIXEL_MISMATCH_THRESHOLD);
        }
      }

      fs.writeFileSync(path.join(OUT_DIR, `${scenario}_report.json`), JSON.stringify({ scenario, results }, null, 2));
      writeHtmlReport();

      for (const r of results) {
        if (r.tickDelta <= 5) {
          expect(r.timerDelta, `${scenario} t${r.tick} timer delta`).toBeLessThanOrEqual(5);
        }
      }

      await wasmCtx.close();
      await tsCtx.close();
    });
  }
});
