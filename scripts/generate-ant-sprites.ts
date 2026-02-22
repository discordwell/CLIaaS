#!/usr/bin/env tsx
/**
 * Generate procedural pixel-art ant sprites as PNG sprite sheets.
 * Creates ANT1 (warrior/red), ANT2 (fire/orange), ANT3 (scout/green).
 * Each sprite has 32 rotation frames like vehicles.
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
const COLS = 16;
const FRAME_COUNT = 32;
const ROWS = Math.ceil(FRAME_COUNT / COLS);
const SHEET_W = COLS * FRAME_W;
const SHEET_H = ROWS * FRAME_H;

// --- Pure PNG encoder ---
function encodePNG(rgba: Uint8Array, w: number, h: number): Buffer {
  // PNG structure: signature + IHDR + IDAT + IEND
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = pngChunk('IHDR', ihdr);

  // IDAT — raw image data with filter bytes
  const rawSize = h * (1 + w * 4); // filter byte per row + RGBA pixels
  const rawBuf = Buffer.alloc(rawSize);
  for (let y = 0; y < h; y++) {
    const rowOffset = y * (1 + w * 4);
    rawBuf[rowOffset] = 0; // filter: none
    for (let x = 0; x < w * 4; x++) {
      rawBuf[rowOffset + 1 + x] = rgba[y * w * 4 + x];
    }
  }
  const compressed = deflateSync(rawBuf);
  const idatChunk = pngChunk('IDAT', compressed);

  // IEND
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

  fillEllipse(cx: number, cy: number, rx: number, ry: number, r: number, g: number, b: number, a = 255): void {
    for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
      for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
          this.setPixel(cx + dx, cy + dy, r, g, b, a);
        }
      }
    }
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a = 255): void {
    // Bresenham's line
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

// --- Color parsing ---
function hexToRGB(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF];
}

// --- Ant drawing ---
interface AntColor {
  body: [number, number, number];
  head: [number, number, number];
  legs: [number, number, number];
  eyes: [number, number, number];
  accent: [number, number, number];
}

const ANT_DEFS: Record<string, AntColor> = {
  ant1: { // Warrior — dark red/brown
    body: hexToRGB('#8B2500'),
    head: hexToRGB('#6B1800'),
    legs: hexToRGB('#5A1200'),
    eyes: hexToRGB('#FF4444'),
    accent: hexToRGB('#AA3300'),
  },
  ant2: { // Fire — orange/flame
    body: hexToRGB('#CC5500'),
    head: hexToRGB('#AA4400'),
    legs: hexToRGB('#884400'),
    eyes: hexToRGB('#FFFF00'),
    accent: hexToRGB('#FF6600'),
  },
  ant3: { // Scout — dark green/electric
    body: hexToRGB('#2A6B2A'),
    head: hexToRGB('#1A5A1A'),
    legs: hexToRGB('#0A4A0A'),
    eyes: hexToRGB('#44FFFF'),
    accent: hexToRGB('#33CC33'),
  },
};

function drawAntOnCanvas(
  pc: PixelCanvas,
  ox: number, oy: number,  // frame top-left
  angle: number,            // rotation in radians (0 = north)
  colors: AntColor,
): void {
  const cx = ox + FRAME_W / 2;
  const cy = oy + FRAME_H / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Helper: rotate point around center
  const rot = (lx: number, ly: number): [number, number] => {
    return [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos];
  };

  // Draw from back to front (abdomen → thorax → head)
  // All coordinates are in local space (x=right, y=down), origin=center

  // Abdomen (rear, largest)
  const abd = rot(0, 3);
  pc.fillEllipse(abd[0], abd[1], 3.5, 4, ...colors.body);

  // Thorax (middle)
  const thx = rot(0, -1);
  pc.fillCircle(thx[0], thx[1], 2.5, ...colors.body);

  // Head (front)
  const hd = rot(0, -4.5);
  pc.fillCircle(hd[0], hd[1], 2.5, ...colors.head);

  // Legs — 3 pairs
  const legPairs = [
    { y: -1, outLen: 5, outAngle: -0.5 },  // front
    { y: 1, outLen: 5, outAngle: 0 },        // middle
    { y: 3, outLen: 5, outAngle: 0.5 },      // rear
  ];
  for (const leg of legPairs) {
    // Left leg
    const lBase = rot(-2, leg.y);
    const lTip = rot(-2 - leg.outLen * Math.cos(leg.outAngle), leg.y - leg.outLen * Math.sin(leg.outAngle));
    pc.drawLine(lBase[0], lBase[1], lTip[0], lTip[1], ...colors.legs);

    // Right leg
    const rBase = rot(2, leg.y);
    const rTip = rot(2 + leg.outLen * Math.cos(leg.outAngle), leg.y - leg.outLen * Math.sin(leg.outAngle));
    pc.drawLine(rBase[0], rBase[1], rTip[0], rTip[1], ...colors.legs);
  }

  // Mandibles
  const mL = rot(-1.5, -6.5);
  const mLtip = rot(-3, -8);
  pc.drawLine(mL[0], mL[1], mLtip[0], mLtip[1], ...colors.accent);

  const mR = rot(1.5, -6.5);
  const mRtip = rot(3, -8);
  pc.drawLine(mR[0], mR[1], mRtip[0], mRtip[1], ...colors.accent);

  // Antennae
  const aL = rot(-1, -6.5);
  const aLtip = rot(-3.5, -9.5);
  pc.drawLine(aL[0], aL[1], aLtip[0], aLtip[1], ...colors.legs);

  const aR = rot(1, -6.5);
  const aRtip = rot(3.5, -9.5);
  pc.drawLine(aR[0], aR[1], aRtip[0], aRtip[1], ...colors.legs);

  // Eyes
  const eL = rot(-1.5, -5);
  const eR = rot(1.5, -5);
  pc.setPixel(eL[0], eL[1], ...colors.eyes);
  pc.setPixel(eR[0], eR[1], ...colors.eyes);
}

// --- Main ---
console.log('Generating ant sprite sheets...\n');

for (const [name, colors] of Object.entries(ANT_DEFS)) {
  const pc = new PixelCanvas(SHEET_W, SHEET_H);

  for (let i = 0; i < FRAME_COUNT; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const ox = col * FRAME_W;
    const oy = row * FRAME_H;

    // 32 rotation frames: 0=N, 8=E, 16=S, 24=W (clockwise)
    const angle = (i / 32) * Math.PI * 2;
    drawAntOnCanvas(pc, ox, oy, angle, colors);
  }

  const outPath = join(ASSETS_DIR, `${name}.png`);
  writeFileSync(outPath, pc.toPNG());
  console.log(`  Generated ${name}.png (${SHEET_W}×${SHEET_H}, ${FRAME_COUNT} frames)`);
}

// Update manifest.json
const manifestPath = join(ASSETS_DIR, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

for (const name of Object.keys(ANT_DEFS)) {
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
