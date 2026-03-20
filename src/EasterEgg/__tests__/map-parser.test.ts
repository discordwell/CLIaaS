/**
 * MapPack parser tests — verifies LCW decompression and coastal cell detection.
 *
 * C++ source ref: CnC_and_Red_Alert/RA/lcwuncmp.cpp — LCW_Uncompress()
 * INI data: public/ra/assets/SCG11EA.ini [MapPack] section
 *
 * Tests the full pipeline:
 *   Base64 decode → LCW decompress → TType/TIcon split → water detection
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  lcwDecompress,
  decompressRASections,
  parseMapPack,
  findCoastalCells,
  isWaterCell,
  getCoastalCellsFromINI,
  clearMapCache,
} from '../oracle/mapParser';

const MAP_W = 128;
const MAP_CELL_TOTAL = MAP_W * MAP_W;

// ---------------------------------------------------------------------------
// LCW Decompression Unit Tests
// ---------------------------------------------------------------------------

/** Helper: decompress a single LCW chunk into a new buffer */
function lcwDecompressSimple(source: Uint8Array, length: number): Uint8Array {
  const dest = new Uint8Array(length);
  lcwDecompress(source, 0, dest, 0, length);
  return dest;
}

describe('lcwDecompress', () => {
  it('handles end-of-data marker (0x80)', () => {
    // opcode 0x80 = end of data immediately
    const source = new Uint8Array([0x80]);
    const result = lcwDecompressSimple(source, 100);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(100);
    // All zeros since nothing was written before the end marker
    expect(result.every((b) => b === 0)).toBe(true);
  });

  it('handles medium copy from source (opcode 0x81-0xBF)', () => {
    // 0x83 = 10_000011 → copy 3 bytes from source
    const source = new Uint8Array([0x83, 0xAA, 0xBB, 0xCC, 0x80]);
    const result = lcwDecompressSimple(source, 3);
    expect(result[0]).toBe(0xAA);
    expect(result[1]).toBe(0xBB);
    expect(result[2]).toBe(0xCC);
  });

  it('handles long run fill (opcode 0xFE)', () => {
    // 0xFE, count_lo, count_hi, fill_byte
    // Fill 10 bytes with 0x42
    const source = new Uint8Array([0xFE, 0x0A, 0x00, 0x42, 0x80]);
    const result = lcwDecompressSimple(source, 10);
    expect(result.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(result[i]).toBe(0x42);
    }
  });

  it('handles short copy from destination', () => {
    // First write 5 bytes from source: 0x85 = 10_000101 → copy 5 bytes
    // Then short copy: 0x00, 0x03 → count=(0>>4)+3=3, offset=3+((0x00&0x0f)<<8)=3
    // Copies 3 bytes from dest[dp-3]
    const source = new Uint8Array([
      0x85, 0x41, 0x42, 0x43, 0x44, 0x45,  // copy 5 from source: ABCDE
      0x00, 0x03,                              // short copy: count=3, offset=3
      0x80,                                    // end
    ]);
    const result = lcwDecompressSimple(source, 8);
    // First 5: A B C D E, then 3 copies from dp-3=CDE
    expect(result[0]).toBe(0x41); // A
    expect(result[1]).toBe(0x42); // B
    expect(result[2]).toBe(0x43); // C
    expect(result[3]).toBe(0x44); // D
    expect(result[4]).toBe(0x45); // E
    expect(result[5]).toBe(0x43); // C (copied from dest[5-3])
    expect(result[6]).toBe(0x44); // D
    expect(result[7]).toBe(0x45); // E
  });

  it('handles medium copy from destination (opcode 0xC0-0xFD)', () => {
    // First write 4 bytes, then medium copy from dest absolute offset
    // 0xC0 = 11_000000 → count = (0xC0 & 0x3F) + 3 = 3, offset = word
    const source = new Uint8Array([
      0x84, 0x10, 0x20, 0x30, 0x40,  // copy 4 from source
      0xC0, 0x01, 0x00,              // medium copy: count=3, abs offset=1
      0x80,                           // end
    ]);
    const result = lcwDecompressSimple(source, 7);
    expect(result[0]).toBe(0x10);
    expect(result[1]).toBe(0x20);
    expect(result[2]).toBe(0x30);
    expect(result[3]).toBe(0x40);
    // Copy 3 from dest[1]: 0x20, 0x30, 0x40
    expect(result[4]).toBe(0x20);
    expect(result[5]).toBe(0x30);
    expect(result[6]).toBe(0x40);
  });

  it('handles long copy from destination (opcode 0xFF)', () => {
    // First write 4 bytes, then long copy from dest absolute offset
    // 0xFF, count_lo, count_hi, offset_lo, offset_hi
    const source = new Uint8Array([
      0x84, 0xAA, 0xBB, 0xCC, 0xDD,  // copy 4 from source
      0xFF, 0x03, 0x00, 0x00, 0x00,   // long copy: count=3, abs offset=0
      0x80,                             // end
    ]);
    const result = lcwDecompressSimple(source, 7);
    expect(result[0]).toBe(0xAA);
    expect(result[1]).toBe(0xBB);
    expect(result[2]).toBe(0xCC);
    expect(result[3]).toBe(0xDD);
    // Copy 3 from dest[0]: 0xAA, 0xBB, 0xCC
    expect(result[4]).toBe(0xAA);
    expect(result[5]).toBe(0xBB);
    expect(result[6]).toBe(0xCC);
  });

  it('clamps long run to output buffer size', () => {
    // Request fill of 1000 bytes but output is only 5
    const source = new Uint8Array([0xFE, 0xE8, 0x03, 0xFF, 0x80]);
    const result = lcwDecompressSimple(source, 5);
    expect(result.length).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(result[i]).toBe(0xFF);
    }
  });
});

describe('decompressRASections', () => {
  it('decompresses a single chunk with header', () => {
    // Chunk: compressedSize=5, decompressedSize=10
    // LCW data: 0xFE fill 10 bytes with 0x42, then 0x80 end
    const lcwData = new Uint8Array([0xFE, 0x0A, 0x00, 0x42, 0x80]);
    const chunked = new Uint8Array(4 + lcwData.length);
    chunked[0] = lcwData.length & 0xff; // compressedSize lo
    chunked[1] = (lcwData.length >> 8) & 0xff; // compressedSize hi
    chunked[2] = 10; // decompressedSize lo
    chunked[3] = 0;  // decompressedSize hi
    chunked.set(lcwData, 4);

    const dest = new Uint8Array(10);
    decompressRASections(chunked, 0, dest, 10);
    for (let i = 0; i < 10; i++) {
      expect(dest[i]).toBe(0x42);
    }
  });
});

// ---------------------------------------------------------------------------
// MapPack Parsing (full pipeline against real INI data)
// ---------------------------------------------------------------------------

const ASSETS_DIR = path.resolve(process.cwd(), 'public', 'ra', 'assets');
const SCG11EA_PATH = path.join(ASSETS_DIR, 'SCG11EA.ini');
const hasINI = fs.existsSync(SCG11EA_PATH);

describe('parseMapPack', () => {
  it.skipIf(!hasINI)('parses SCG11EA.ini and returns correct array sizes', () => {
    const iniText = fs.readFileSync(SCG11EA_PATH, 'utf-8');
    const { ttype, ticon, bounds } = parseMapPack(iniText);

    expect(ttype).toBeInstanceOf(Uint16Array);
    expect(ttype.length).toBe(MAP_CELL_TOTAL);

    expect(ticon).toBeInstanceOf(Uint8Array);
    expect(ticon.length).toBe(MAP_CELL_TOTAL);

    // SCG11EA map bounds: X=17, Y=19, Width=90, Height=85
    expect(bounds.x).toBe(17);
    expect(bounds.y).toBe(19);
    expect(bounds.w).toBe(90);
    expect(bounds.h).toBe(85);
  });

  it.skipIf(!hasINI)('SCG11EA contains water cells (template 1 or 2)', () => {
    const iniText = fs.readFileSync(SCG11EA_PATH, 'utf-8');
    const { ttype } = parseMapPack(iniText);

    let waterCount = 0;
    for (let i = 0; i < MAP_CELL_TOTAL; i++) {
      if (ttype[i] === 1 || ttype[i] === 2) waterCount++;
    }

    // SCG11EA is a naval mission — there MUST be substantial water
    expect(waterCount).toBeGreaterThan(100);
  });

  it.skipIf(!hasINI)('SCG11EA contains non-water cells', () => {
    const iniText = fs.readFileSync(SCG11EA_PATH, 'utf-8');
    const { ttype } = parseMapPack(iniText);

    let landCount = 0;
    for (let i = 0; i < MAP_CELL_TOTAL; i++) {
      if (ttype[i] !== 1 && ttype[i] !== 2) landCount++;
    }

    // There must also be land for the player's base
    expect(landCount).toBeGreaterThan(100);
  });

  it('throws on unsupported NewINIFormat', () => {
    const iniText = '[Basic]\nNewINIFormat=1\n[MapPack]\n1=AAAA\n';
    expect(() => parseMapPack(iniText)).toThrow(/Unsupported NewINIFormat/);
  });

  it('throws on missing NewINIFormat', () => {
    const iniText = '[Basic]\n[MapPack]\n1=AAAA\n';
    expect(() => parseMapPack(iniText)).toThrow(/Unsupported NewINIFormat/);
  });
});

// ---------------------------------------------------------------------------
// Water Detection
// ---------------------------------------------------------------------------

describe('isWaterCell', () => {
  it('returns true for template 1 (TEMPLATE_WATER)', () => {
    const ttype = new Uint16Array(MAP_CELL_TOTAL);
    ttype[100] = 1;
    expect(isWaterCell(ttype, 100)).toBe(true);
  });

  it('returns true for template 2 (TEMPLATE_WATER2)', () => {
    const ttype = new Uint16Array(MAP_CELL_TOTAL);
    ttype[200] = 2;
    expect(isWaterCell(ttype, 200)).toBe(true);
  });

  it('returns false for template 0 (clear)', () => {
    const ttype = new Uint16Array(MAP_CELL_TOTAL);
    ttype[300] = 0;
    expect(isWaterCell(ttype, 300)).toBe(false);
  });

  it('returns false for non-water templates', () => {
    const ttype = new Uint16Array(MAP_CELL_TOTAL);
    ttype[400] = 180; // road
    expect(isWaterCell(ttype, 400)).toBe(false);
  });

  it('returns false for 0xFFFF without bounds', () => {
    const ttype = new Uint16Array(MAP_CELL_TOTAL);
    ttype[500] = 0xFFFF;
    expect(isWaterCell(ttype, 500)).toBe(false);
  });

  it('returns true for 0xFFFF within map bounds', () => {
    const ttype = new Uint16Array(MAP_CELL_TOTAL);
    const cell = 50 * MAP_W + 50; // (50, 50)
    ttype[cell] = 0xFFFF;
    const bounds = { x: 10, y: 10, w: 100, h: 100 };
    expect(isWaterCell(ttype, cell, bounds)).toBe(true);
  });

  it('returns false for 0xFFFF outside map bounds', () => {
    const ttype = new Uint16Array(MAP_CELL_TOTAL);
    const cell = 5 * MAP_W + 5; // (5, 5)
    ttype[cell] = 0xFFFF;
    const bounds = { x: 10, y: 10, w: 100, h: 100 };
    expect(isWaterCell(ttype, cell, bounds)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Coastal Cell Detection
// ---------------------------------------------------------------------------

describe('findCoastalCells', () => {
  it('finds cells adjacent to water', () => {
    const ttype = new Uint16Array(MAP_CELL_TOTAL);
    // Create a water body at (64,64)
    ttype[64 * MAP_W + 64] = 1;
    ttype[64 * MAP_W + 65] = 1;
    ttype[64 * MAP_W + 66] = 1;
    ttype[65 * MAP_W + 64] = 1;
    ttype[65 * MAP_W + 65] = 1;
    ttype[65 * MAP_W + 66] = 1;

    const coastal = findCoastalCells(ttype, 64, 64, 5);
    expect(coastal.length).toBeGreaterThan(0);

    // Every coastal cell must NOT be water
    for (const { cx, cy } of coastal) {
      expect(ttype[cy * MAP_W + cx]).not.toBe(1);
      expect(ttype[cy * MAP_W + cx]).not.toBe(2);
    }

    // Every coastal cell must have at least one water cell within 3-cell radius
    for (const { cx, cy } of coastal) {
      let hasWater = false;
      for (let wy = -3; wy <= 3 && !hasWater; wy++) {
        for (let wx = -3; wx <= 3 && !hasWater; wx++) {
          const nc = (cy + wy) * MAP_W + (cx + wx);
          if (nc >= 0 && nc < MAP_W * MAP_W && (ttype[nc] === 1 || ttype[nc] === 2)) {
            hasWater = true;
          }
        }
      }
      expect(hasWater).toBe(true);
    }
  });

  it('returns empty array when no water exists', () => {
    const ttype = new Uint16Array(MAP_CELL_TOTAL); // all clear
    const coastal = findCoastalCells(ttype, 64, 64, 20);
    expect(coastal).toEqual([]);
  });

  it('returns at most 30 results', () => {
    const ttype = new Uint16Array(MAP_CELL_TOTAL);
    // Fill a long water strip — many coastal cells possible
    for (let x = 10; x < 100; x++) {
      ttype[64 * MAP_W + x] = 1;
    }
    const coastal = findCoastalCells(ttype, 55, 64, 40);
    expect(coastal.length).toBeLessThanOrEqual(30);
  });

  it('excludes edge cells (cx < 1 or cy < 1)', () => {
    const ttype = new Uint16Array(MAP_CELL_TOTAL);
    // Water at (0, 5) — edge of map
    ttype[5 * MAP_W + 0] = 1;
    const coastal = findCoastalCells(ttype, 1, 5, 5);
    // Cell (0, 5) is water, (1, 5) could be coastal but (0, 5) neighbor is at edge
    for (const { cx, cy } of coastal) {
      expect(cx).toBeGreaterThanOrEqual(1);
      expect(cy).toBeGreaterThanOrEqual(1);
      expect(cx).toBeLessThan(MAP_W - 1);
      expect(cy).toBeLessThan(MAP_W - 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: real SCG11EA coastal detection
// ---------------------------------------------------------------------------

describe('SCG11EA coastal detection', () => {
  it.skipIf(!hasINI)('finds coastal cells near player base at (24, 96)', () => {
    clearMapCache();
    const cells = getCoastalCellsFromINI(SCG11EA_PATH, 24, 96);

    // SCG11EA is a naval mission — there MUST be coastal cells near the base
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThanOrEqual(30);

    // All results should be within reasonable distance of the search center
    for (const { cx, cy } of cells) {
      expect(Math.abs(cx - 24)).toBeLessThanOrEqual(20);
      expect(Math.abs(cy - 96)).toBeLessThanOrEqual(20);
    }
  });

  it.skipIf(!hasINI)('caches results across calls', () => {
    clearMapCache();
    const cells1 = getCoastalCellsFromINI(SCG11EA_PATH, 24, 96);
    const cells2 = getCoastalCellsFromINI(SCG11EA_PATH, 24, 96);
    // Same center → same results
    expect(cells1).toEqual(cells2);
  });
});

// ---------------------------------------------------------------------------
// Cross-scenario: verify SCG07EA has coastal cells too
// ---------------------------------------------------------------------------

const SCG07EA_PATH = path.join(ASSETS_DIR, 'SCG07EA.ini');
const hasSCG07EA = fs.existsSync(SCG07EA_PATH);

describe('SCG07EA coastal detection', () => {
  it.skipIf(!hasSCG07EA)('finds coastal cells near center (52, 50)', () => {
    clearMapCache();
    const cells = getCoastalCellsFromINI(SCG07EA_PATH, 52, 50);
    // SCG07EA also has naval elements
    expect(cells.length).toBeGreaterThan(0);
  });
});
