#!/usr/bin/env tsx
/**
 * Generate procedural pixel-art barrel sprites as PNG sprite sheets.
 * Creates BARL (explosive barrel) and BRL3 (bridge barrel).
 *
 * 2 frames each:
 *   Frame 0: Intact barrel
 *   Frame 1: Damaged barrel (dented, darker)
 *
 * Uses pure Node.js — writes raw PNG with no dependencies.
 */

import { writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ASSETS_DIR = join(ROOT, 'public/ra/assets');

const FRAME_W = 24;
const FRAME_H = 24;
const COLS = 2;
const FRAME_COUNT = 2;
const ROWS = 1;
const SHEET_W = COLS * FRAME_W;
const SHEET_H = ROWS * FRAME_H;

// --- Pure PNG encoder (same as generate-ant-sprites.ts) ---
function encodePNG(rgba: Uint8Array, w: number, h: number): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const ihdrChunk = pngChunk('IHDR', ihdr);
  const rawSize = h * (1 + w * 4);
  const rawBuf = Buffer.alloc(rawSize);
  for (let y = 0; y < h; y++) {
    const rowOffset = y * (1 + w * 4);
    rawBuf[rowOffset] = 0;
    for (let x = 0; x < w * 4; x++) {
      rawBuf[rowOffset + 1 + x] = rgba[y * w * 4 + x];
    }
  }
  const compressed = deflateSync(rawBuf);
  const idatChunk = pngChunk('IDAT', compressed);
  const iendChunk = pngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeB, data]);
  const crc = crc32(crcData);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
  }
  return crc ^ 0xFFFFFFFF;
}

// --- Simple 2D pixel drawing ---
class PixelCanvas {
  w: number;
  h: number;
  data: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }

  setPixel(x: number, y: number, r: number, g: number, b: number, a = 255): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= this.w || iy < 0 || iy >= this.h) return;
    const idx = (iy * this.w + ix) * 4;
    this.data[idx] = r;
    this.data[idx + 1] = g;
    this.data[idx + 2] = b;
    this.data[idx + 3] = a;
  }

  fillRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a = 255): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.setPixel(x + dx, y + dy, r, g, b, a);
      }
    }
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, r: number, g: number, b: number, a = 255): void {
    for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
      for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
          this.setPixel(cx + dx, cy + dy, r, g, b, a);
        }
      }
    }
  }

  fillCircle(cx: number, cy: number, radius: number, r: number, g: number, b: number, a = 255): void {
    const r2 = radius * radius;
    for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy++) {
      for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
        if (dx * dx + dy * dy <= r2) {
          this.setPixel(cx + dx, cy + dy, r, g, b, a);
        }
      }
    }
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a = 255): void {
    let ix0 = Math.round(x0), iy0 = Math.round(y0);
    const ix1 = Math.round(x1), iy1 = Math.round(y1);
    const dx = Math.abs(ix1 - ix0);
    const dy = -Math.abs(iy1 - iy0);
    const sx = ix0 < ix1 ? 1 : -1;
    const sy = iy0 < iy1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
      this.setPixel(ix0, iy0, r, g, b, a);
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; ix0 += sx; }
      if (e2 <= dx) { err += dx; iy0 += sy; }
    }
  }

  toPNG(): Buffer {
    return encodePNG(this.data, this.w, this.h);
  }
}

// --- Color definitions ---
type RGB = [number, number, number];

interface BarrelColors {
  body: RGB;        // Main barrel body
  bodyDark: RGB;    // Dark shading on barrel
  bodyLight: RGB;   // Highlight on barrel
  rim: RGB;         // Top/bottom rim
  stripe: RGB;      // Hazard stripe
  stripeDark: RGB;  // Hazard stripe dark band
}

const BARL_COLORS: BarrelColors = {
  body:      [100, 90, 80],    // Gray-brown steel
  bodyDark:  [60, 55, 48],     // Dark shadow side
  bodyLight: [140, 130, 118],  // Highlight
  rim:       [70, 65, 58],     // Metal rim
  stripe:    [200, 180, 40],   // Yellow hazard stripe
  stripeDark:[180, 50, 30],    // Red hazard stripe band
};

const BRL3_COLORS: BarrelColors = {
  body:      [85, 100, 85],    // Olive/military green-gray
  bodyDark:  [50, 65, 50],     // Dark shadow side
  bodyLight: [120, 138, 118],  // Highlight
  rim:       [60, 72, 58],     // Metal rim
  stripe:    [200, 180, 40],   // Yellow hazard stripe
  stripeDark:[180, 50, 30],    // Red hazard stripe band
};

/**
 * Draw a barrel onto the canvas at offset (ox, oy).
 * The barrel is drawn as a top-down cylindrical shape:
 * - Elliptical body viewed from isometric-ish overhead angle
 * - Central cylinder body with light/dark shading
 * - Top rim visible as an ellipse
 * - Hazard stripe band across the middle
 */
function drawBarrel(
  pc: PixelCanvas,
  ox: number, oy: number,
  colors: BarrelColors,
  damaged: boolean,
): void {
  const cx = ox + FRAME_W / 2;
  const cy = oy + FRAME_H / 2;

  // Barrel body: tall ellipse (top-down isometric view shows a rounded cylinder)
  // The barrel is slightly taller than wide when viewed from above at an angle
  const bodyRx = 7;  // horizontal radius
  const bodyRy = 9;  // vertical radius (taller = more 3D feel)

  // Shadow underneath
  pc.fillEllipse(cx + 1, cy + 2, bodyRx + 1, bodyRy - 1, 20, 18, 15, 80);

  // Main body fill
  for (let dy = -Math.ceil(bodyRy); dy <= Math.ceil(bodyRy); dy++) {
    for (let dx = -Math.ceil(bodyRx); dx <= Math.ceil(bodyRx); dx++) {
      const nx = dx / bodyRx;
      const ny = dy / bodyRy;
      if (nx * nx + ny * ny > 1) continue;

      // Shading: left-to-right gradient simulates cylindrical lighting
      const shade = nx; // -1 (dark left) to +1 (light right)
      let r: number, g: number, b: number;
      if (shade < -0.3) {
        // Dark side
        r = colors.bodyDark[0];
        g = colors.bodyDark[1];
        b = colors.bodyDark[2];
      } else if (shade > 0.3) {
        // Light side (highlight)
        r = colors.bodyLight[0];
        g = colors.bodyLight[1];
        b = colors.bodyLight[2];
      } else {
        // Mid-tone body
        r = colors.body[0];
        g = colors.body[1];
        b = colors.body[2];
      }

      // Hazard stripe band in the middle third
      const absNy = Math.abs(ny);
      if (absNy < 0.25) {
        // Yellow/red hazard stripe
        if (Math.abs(ny) < 0.1) {
          r = colors.stripeDark[0]; g = colors.stripeDark[1]; b = colors.stripeDark[2];
        } else {
          r = colors.stripe[0]; g = colors.stripe[1]; b = colors.stripe[2];
        }
        // Apply cylindrical shading to stripe too
        if (shade < -0.3) {
          r = Math.floor(r * 0.6); g = Math.floor(g * 0.6); b = Math.floor(b * 0.6);
        } else if (shade > 0.3) {
          r = Math.min(255, Math.floor(r * 1.2));
          g = Math.min(255, Math.floor(g * 1.2));
          b = Math.min(255, Math.floor(b * 1.2));
        }
      }

      // Damage: add random dark spots, dent effects
      if (damaged) {
        const hash = ((cx + dx) * 7 + (cy + dy) * 13) & 0xFF;
        if (hash < 40) {
          // Dark scorch/dent marks
          r = Math.floor(r * 0.4);
          g = Math.floor(g * 0.4);
          b = Math.floor(b * 0.4);
        } else if (hash < 60) {
          // Reddish rust/burn marks
          r = Math.min(255, Math.floor(r * 0.8) + 40);
          g = Math.floor(g * 0.5);
          b = Math.floor(b * 0.4);
        }
      }

      pc.setPixel(cx + dx, cy + dy, r, g, b);
    }
  }

  // Top rim: elliptical ring at the top of the barrel
  const rimY = cy - bodyRy + 1;
  const rimRx = bodyRx - 1;
  const rimRy = 2;
  for (let dx = -Math.ceil(rimRx); dx <= Math.ceil(rimRx); dx++) {
    for (let dy = -Math.ceil(rimRy); dy <= Math.ceil(rimRy); dy++) {
      const nx = dx / rimRx;
      const ny = dy / rimRy;
      const dist = nx * nx + ny * ny;
      // Draw rim as a ring (between 0.5 and 1.0)
      if (dist <= 1 && dist >= 0.35) {
        pc.setPixel(cx + dx, rimY + dy, ...colors.rim);
      }
    }
  }

  // Bottom rim
  const botRimY = cy + bodyRy - 1;
  for (let dx = -Math.ceil(rimRx); dx <= Math.ceil(rimRx); dx++) {
    for (let dy = -Math.ceil(rimRy); dy <= Math.ceil(rimRy); dy++) {
      const nx = dx / rimRx;
      const ny = dy / rimRy;
      const dist = nx * nx + ny * ny;
      if (dist <= 1 && dist >= 0.35) {
        // Bottom rim is darker
        pc.setPixel(
          cx + dx, botRimY + dy,
          Math.floor(colors.rim[0] * 0.7),
          Math.floor(colors.rim[1] * 0.7),
          Math.floor(colors.rim[2] * 0.7),
        );
      }
    }
  }

  // Top cap: small filled ellipse on top (barrel opening / cap)
  if (!damaged) {
    const capRx = 3;
    const capRy = 1;
    for (let dx = -capRx; dx <= capRx; dx++) {
      for (let dy = -capRy; dy <= capRy; dy++) {
        if ((dx * dx) / (capRx * capRx) + (dy * dy) / (capRy * capRy) <= 1) {
          pc.setPixel(cx + dx, rimY + dy, 45, 42, 38);
        }
      }
    }
  } else {
    // Damaged: cracked/bent cap - just a couple dark pixels
    pc.setPixel(cx - 1, rimY, 30, 25, 20);
    pc.setPixel(cx + 1, rimY, 30, 25, 20);
    pc.setPixel(cx, rimY - 1, 35, 28, 22);
  }

  // Barrel banding lines (horizontal metal bands) - 2 thin lines
  for (let dx = -bodyRx + 1; dx < bodyRx; dx++) {
    const nx = dx / bodyRx;
    if (nx * nx > 0.85) continue; // fade at edges
    const bandShade = nx < -0.3 ? 0.6 : nx > 0.3 ? 1.1 : 0.85;
    const br = Math.min(255, Math.floor(colors.rim[0] * bandShade));
    const bg = Math.min(255, Math.floor(colors.rim[1] * bandShade));
    const bb = Math.min(255, Math.floor(colors.rim[2] * bandShade));
    // Upper band
    pc.setPixel(cx + dx, cy - 4, br, bg, bb);
    // Lower band
    pc.setPixel(cx + dx, cy + 4, br, bg, bb);
  }
}

// --- Main ---
console.log('Generating barrel sprite sheets (2 frames each)...\n');

const BARREL_DEFS: Record<string, BarrelColors> = {
  barl: BARL_COLORS,
  brl3: BRL3_COLORS,
};

for (const [name, colors] of Object.entries(BARREL_DEFS)) {
  const pc = new PixelCanvas(SHEET_W, SHEET_H);

  // Frame 0: Intact
  drawBarrel(pc, 0, 0, colors, false);

  // Frame 1: Damaged
  drawBarrel(pc, FRAME_W, 0, colors, true);

  const outPath = join(ASSETS_DIR, `${name}.png`);
  writeFileSync(outPath, pc.toPNG());
  console.log(`  Generated ${name}.png (${SHEET_W}x${SHEET_H}, ${FRAME_COUNT} frames)`);
}

// Update manifest.json
const manifestPath = join(ASSETS_DIR, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

for (const name of Object.keys(BARREL_DEFS)) {
  manifest[name] = {
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
    frameCount: FRAME_COUNT,
    columns: COLS,
    rows: ROWS,
    sheetWidth: SHEET_W,
    sheetHeight: SHEET_H,
  };
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nUpdated manifest.json`);
console.log('Done!');
