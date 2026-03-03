/**
 * Tests for bug fixes:
 * 1. Green shadows — palette index 4 must be transparent (shadow/remap marker)
 * 2. Production filtering — expansion units need techPrereq so they don't appear in ant missions
 */
import { describe, it, expect } from 'vitest';
import { PRODUCTION_ITEMS } from '../engine/types';

// ============================================================
// Palette index 4 transparency (green shadow fix)
// Inline parsePalette logic since scripts/ is outside tsconfig
// ============================================================
describe('Palette index 4 transparency', () => {
  /** Minimal parsePalette matching scripts/ra-assets/palette.ts */
  function parsePalette(data: Buffer): { colors: Uint8Array } {
    const colors = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const r6 = data[i * 3];
      const g6 = data[i * 3 + 1];
      const b6 = data[i * 3 + 2];
      colors[i * 4] = (r6 << 2) | (r6 >> 4);
      colors[i * 4 + 1] = (g6 << 2) | (g6 >> 4);
      colors[i * 4 + 2] = (b6 << 2) | (b6 >> 4);
      // Index 0 = transparent background, Index 4 = shadow/remap marker
      colors[i * 4 + 3] = (i === 0 || i === 4) ? 0 : 255;
    }
    return { colors };
  }

  function makePalette(): Buffer {
    const buf = Buffer.alloc(768);
    buf[0] = 0; buf[1] = 0; buf[2] = 0;         // Index 0: black
    buf[12] = 22; buf[13] = 63; buf[14] = 21;    // Index 4: shadow green (6-bit VGA)
    buf[15] = 63; buf[16] = 0; buf[17] = 0;      // Index 5: red
    return buf;
  }

  it('index 0 is transparent', () => {
    const pal = parsePalette(makePalette());
    expect(pal.colors[0 * 4 + 3]).toBe(0);
  });

  it('index 4 is transparent (shadow/remap marker)', () => {
    const pal = parsePalette(makePalette());
    expect(pal.colors[4 * 4 + 3]).toBe(0);
  });

  it('index 5 (regular color) is opaque', () => {
    const pal = parsePalette(makePalette());
    expect(pal.colors[5 * 4 + 3]).toBe(255);
  });

  it('index 1 through 3 are opaque', () => {
    const pal = parsePalette(makePalette());
    for (let i = 1; i <= 3; i++) {
      expect(pal.colors[i * 4 + 3]).toBe(255);
    }
  });
});

// ============================================================
// Production filtering — expansion units need techPrereq
// ============================================================
describe('Production items techPrereq for expansion units', () => {
  const expansionUnits = ['E7', 'THF', 'V2RL', 'MNLY', 'MRLS'];

  for (const unitType of expansionUnits) {
    it(`${unitType} has a techPrereq set`, () => {
      const item = PRODUCTION_ITEMS.find(p => p.type === unitType);
      expect(item).toBeDefined();
      expect(item!.techPrereq).toBeDefined();
      expect(item!.techPrereq).toBeTruthy();
    });
  }

  it('E7 (Tanya) requires ATEK', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'E7')!;
    expect(item.techPrereq).toBe('ATEK');
  });

  it('THF (Thief) requires ATEK', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'THF')!;
    expect(item.techPrereq).toBe('ATEK');
  });

  it('V2RL requires STEK (Soviet tech center, not DOME)', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'V2RL')!;
    expect(item.techPrereq).toBe('STEK');
  });

  it('MNLY (Minelayer) requires ATEK', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MNLY')!;
    expect(item.techPrereq).toBe('ATEK');
  });

  it('MRLS requires ATEK', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'MRLS')!;
    expect(item.techPrereq).toBe('ATEK');
  });

  // Other expansion units that already had techPrereq should still have them
  it('SHOK still requires STEK', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'SHOK')!;
    expect(item.techPrereq).toBe('STEK');
  });

  it('STNK (Phase Transport) still requires ATEK', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'STNK')!;
    expect(item.techPrereq).toBe('ATEK');
  });

  it('CTNK (Chrono Tank) still requires ATEK', () => {
    const item = PRODUCTION_ITEMS.find(p => p.type === 'CTNK')!;
    expect(item.techPrereq).toBe('ATEK');
  });
});
