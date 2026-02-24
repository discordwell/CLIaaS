#!/usr/bin/env tsx
/**
 * Generate an HTML comparison report from screenshots in test-results/comparison/.
 *
 * Reads:
 *   - test-results/comparison/static/ts-*.png  (TS engine layer captures)
 *   - test-results/comparison/static/wasm-*.png (WASM original captures)
 *   - test-results/comparison/differences.json  (known differences catalog)
 *
 * Outputs:
 *   - test-results/comparison/report.html (self-contained, base64-embedded images)
 *
 * Usage: pnpm compare:report
 */

import * as fs from 'fs';
import * as path from 'path';

const REPORT_DIR = path.join(process.cwd(), 'test-results', 'comparison');
const STATIC_DIR = path.join(REPORT_DIR, 'static');
const DIFF_FILE = path.join(REPORT_DIR, 'differences.json');
const OUTPUT = path.join(REPORT_DIR, 'report.html');

interface Difference {
  id: string;
  category: string;
  description: string;
  status: 'open' | 'fixed' | 'wontfix';
  notes: string;
}

interface ImagePair {
  name: string;
  point: string;
  layer: string;
  tsPath: string | null;
  wasmPath: string | null;
}

function toBase64DataUrl(filePath: string): string | null {
  try {
    const data = fs.readFileSync(filePath);
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

function findPairs(): ImagePair[] {
  if (!fs.existsSync(STATIC_DIR)) return [];

  const files = fs.readdirSync(STATIC_DIR).filter(f => f.endsWith('.png'));
  const tsFiles = files.filter(f => f.startsWith('ts-'));
  const wasmFiles = files.filter(f => f.startsWith('wasm-'));

  // Extract comparison points from TS filenames: ts-{point}-{layer}.png
  const pointLayers = new Map<string, ImagePair>();

  for (const f of tsFiles) {
    const m = f.match(/^ts-(.+)-(terrain|units|buildings|overlays|full-no-ui)\.png$/);
    if (!m) continue;
    const [, point, layer] = m;
    const key = `${point}-${layer}`;
    pointLayers.set(key, {
      name: key,
      point,
      layer,
      tsPath: path.join(STATIC_DIR, f),
      wasmPath: null,
    });
  }

  // Match WASM files (wasm-{point}-full.png maps to all TS layers for that point)
  for (const f of wasmFiles) {
    const m = f.match(/^wasm-(.+)-full\.png$/);
    if (!m) continue;
    const point = m[1];
    // WASM only has full captures — pair with each TS layer for this point
    for (const [key, pair] of pointLayers) {
      if (pair.point === point) {
        pair.wasmPath = path.join(STATIC_DIR, f);
      }
    }
  }

  return Array.from(pointLayers.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function loadDifferences(): Difference[] {
  try {
    const raw = fs.readFileSync(DIFF_FILE, 'utf-8');
    return JSON.parse(raw).differences || [];
  } catch {
    return [];
  }
}

function generateHtml(pairs: ImagePair[], diffs: Difference[]): string {
  const categories = ['terrain', 'units', 'buildings', 'overlays', 'full-no-ui'];

  function renderPair(pair: ImagePair): string {
    const tsData = pair.tsPath ? toBase64DataUrl(pair.tsPath) : null;
    const wasmData = pair.wasmPath ? toBase64DataUrl(pair.wasmPath) : null;
    const tsSize = pair.tsPath && fs.existsSync(pair.tsPath)
      ? `${(fs.statSync(pair.tsPath).size / 1024).toFixed(1)}KB` : 'missing';
    const wasmSize = pair.wasmPath && fs.existsSync(pair.wasmPath)
      ? `${(fs.statSync(pair.wasmPath).size / 1024).toFixed(1)}KB` : 'missing';

    return `
      <div class="pair" data-category="${pair.layer}" data-point="${pair.point}">
        <h3>${pair.point} / ${pair.layer}</h3>
        <div class="side-by-side">
          <div class="side">
            <div class="label">TS Engine <span class="size">(${tsSize})</span></div>
            ${tsData
              ? `<img src="${tsData}" class="zoomable" title="TS: ${pair.name}" />`
              : '<div class="placeholder">No TS capture</div>'}
          </div>
          <div class="side">
            <div class="label">WASM Original <span class="size">(${wasmSize})</span></div>
            ${wasmData
              ? `<img src="${wasmData}" class="zoomable wasm-img" title="WASM: ${pair.name}" />`
              : '<div class="placeholder">No WASM capture</div>'}
          </div>
          <div class="notes-col">
            <textarea placeholder="Notes..." rows="3" data-pair="${pair.name}"></textarea>
          </div>
        </div>
      </div>`;
  }

  function renderDiffs(diffs: Difference[]): string {
    if (diffs.length === 0) return '<p>No known differences cataloged yet.</p>';
    return `
      <table class="diff-table">
        <thead>
          <tr><th>ID</th><th>Category</th><th>Description</th><th>Status</th><th>Notes</th></tr>
        </thead>
        <tbody>
          ${diffs.map(d => `
            <tr class="status-${d.status}">
              <td><code>${d.id}</code></td>
              <td>${d.category}</td>
              <td>${d.description}</td>
              <td><span class="badge badge-${d.status}">${d.status}</span></td>
              <td>${d.notes || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  }

  const pairsByCategory: Record<string, ImagePair[]> = {};
  for (const p of pairs) {
    (pairsByCategory[p.layer] ??= []).push(p);
  }

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>TS vs WASM Comparison Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, monospace; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
  h1 { color: #ff4400; margin-bottom: 4px; }
  .timestamp { color: #888; font-size: 13px; margin-bottom: 20px; }
  h2 { color: #ffa500; margin-top: 30px; border-bottom: 1px solid #333; padding-bottom: 6px; }
  h3 { color: #ccc; margin: 12px 0 6px; font-size: 14px; }

  .filters { margin: 16px 0; display: flex; gap: 8px; flex-wrap: wrap; }
  .filters button { background: #2a2a4e; color: #ddd; border: 1px solid #444; padding: 4px 12px;
    border-radius: 4px; cursor: pointer; font-size: 13px; }
  .filters button.active { background: #ff4400; color: #fff; border-color: #ff4400; }

  .pair { margin-bottom: 24px; border: 1px solid #333; border-radius: 6px; padding: 12px; background: #16213e; }
  .side-by-side { display: flex; gap: 12px; align-items: flex-start; }
  .side { flex: 1; min-width: 0; }
  .notes-col { width: 200px; flex-shrink: 0; }
  .notes-col textarea { width: 100%; background: #0f3460; color: #ddd; border: 1px solid #444;
    border-radius: 4px; padding: 6px; font-size: 12px; resize: vertical; }
  .label { font-size: 12px; color: #aaa; margin-bottom: 4px; }
  .label .size { color: #666; }
  .placeholder { background: #222; color: #666; padding: 40px; text-align: center; border-radius: 4px; }

  img.zoomable { width: 100%; height: auto; image-rendering: pixelated; cursor: zoom-in;
    border: 1px solid #333; border-radius: 4px; transition: transform 0.1s; }
  img.zoomable.zoomed-2x { transform: scale(2); transform-origin: top left; cursor: zoom-in; }
  img.zoomable.zoomed-4x { transform: scale(4); transform-origin: top left; cursor: zoom-out; }
  img.wasm-img { image-rendering: pixelated; } /* WASM is 320x200 displayed at container width */

  .diff-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  .diff-table th { background: #2a2a4e; padding: 6px 10px; text-align: left; }
  .diff-table td { padding: 6px 10px; border-bottom: 1px solid #333; }
  .diff-table code { color: #ff8c00; }
  .badge { padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
  .badge-open { background: #c0392b; color: #fff; }
  .badge-fixed { background: #27ae60; color: #fff; }
  .badge-wontfix { background: #7f8c8d; color: #fff; }
  .status-fixed { opacity: 0.6; }

  .section { display: block; }
  .section.hidden { display: none; }
</style>
</head>
<body>
<h1>TS Engine vs WASM Original — Visual Comparison</h1>
<p class="timestamp">Generated: ${timestamp} | Pairs: ${pairs.length} | Known differences: ${diffs.length}</p>

<h2>Known Differences</h2>
${renderDiffs(diffs)}

<h2>Screenshot Comparisons</h2>
<div class="filters">
  <button class="filter-btn active" data-filter="all">All</button>
  ${categories.map(c => `<button class="filter-btn" data-filter="${c}">${c}</button>`).join('\n  ')}
</div>

${pairs.length === 0 ? '<p style="color:#888">No screenshot pairs found. Run <code>pnpm compare</code> first.</p>' : ''}

${categories.map(cat => {
  const catPairs = pairsByCategory[cat] || [];
  if (catPairs.length === 0) return '';
  return `
<div class="section" data-section="${cat}">
  <h2>${cat.charAt(0).toUpperCase() + cat.slice(1)}</h2>
  ${catPairs.map(renderPair).join('\n')}
</div>`;
}).join('\n')}

<script>
// Zoom toggle: click cycles 1x → 2x → 4x → 1x
document.querySelectorAll('.zoomable').forEach(img => {
  img.addEventListener('click', () => {
    if (img.classList.contains('zoomed-4x')) {
      img.classList.remove('zoomed-4x');
    } else if (img.classList.contains('zoomed-2x')) {
      img.classList.remove('zoomed-2x');
      img.classList.add('zoomed-4x');
    } else {
      img.classList.add('zoomed-2x');
    }
  });
});

// Category filter
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const filter = btn.dataset.filter;
    document.querySelectorAll('.pair').forEach(pair => {
      if (filter === 'all' || pair.dataset.category === filter) {
        pair.style.display = 'block';
      } else {
        pair.style.display = 'none';
      }
    });
    document.querySelectorAll('.section').forEach(sec => {
      if (filter === 'all' || sec.dataset.section === filter) {
        sec.classList.remove('hidden');
      } else {
        sec.classList.add('hidden');
      }
    });
  });
});
</script>
</body>
</html>`;
}

// ── Main ────────────────────────────────────────────────────────

console.log('Generating comparison report...');
const pairs = findPairs();
const diffs = loadDifferences();
console.log(`Found ${pairs.length} screenshot pairs, ${diffs.length} known differences`);

const html = generateHtml(pairs, diffs);
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, html);
console.log(`Report written to: ${OUTPUT}`);
console.log(`Open: file://${OUTPUT}`);
