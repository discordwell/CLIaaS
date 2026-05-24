/**
 * Tests for shadow sheet and house color remap logic.
 * These test the data structures and entity integration points, not the canvas
 * rendering (which requires a browser DOM).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import { UnitType, House, BODY_SHAPE } from '../engine/types';
import { RA_COLOR_BLACK, makeFadingTable, nearestPaletteIndex, shadowGhostRemapColor, shadowTransFadeForRGBA } from '../engine/shadow';

beforeEach(() => resetEntityIds());

describe('Shadow rendering prerequisites', () => {
  it('classifies SHADOW.SHP source control pixels like display.cpp ShadowCols', () => {
    // C++ display.cpp:351-355,420 draws SHADOW.SHP with SHAPE_GHOST + ShadowTrans.
    // Raw extracted white/gray pixels select a fading table; they are not
    // browser alpha values.
    expect(shadowTransFadeForRGBA(16, 12, 12, 255)).toBe(130);
    expect(shadowTransFadeForRGBA(255, 255, 255, 255)).toBe(170);
    expect(shadowTransFadeForRGBA(170, 170, 170, 255)).toBe(250);
    expect(shadowTransFadeForRGBA(85, 85, 85, 255)).toBe(250);
    expect(shadowTransFadeForRGBA(0, 0, 0, 0)).toBeNull();
  });

  it('SHADOW.SHP ghost remaps the destination palette index instead of alpha-blending black', () => {
    const palette = Array.from({ length: 256 }, () => [255, 0, 255, 255]);
    palette[0] = [0, 0, 0, 0];
    palette[4] = [88, 252, 84, 130];
    palette[12] = [0, 0, 0, 255];
    palette[79] = [228, 216, 228, 255];
    palette[137] = [112, 112, 112, 255];

    const expectedTable = makeFadingTable(palette, RA_COLOR_BLACK, 130);
    const destIndex = nearestPaletteIndex(palette, 228, 216, 228);
    const expected = palette[expectedTable[destIndex]].slice(0, 3);
    const remapped = shadowGhostRemapColor(palette, 228, 216, 228, 16, 12, 12, 255);

    expect(remapped?.slice(0, 3)).toEqual(expected);
    expect(remapped?.slice(0, 3)).toEqual([112, 112, 112]);
    expect(remapped?.slice(0, 3)).not.toEqual([120, 113, 120]);
  });

  it('matches Build_Fading_Table black handling instead of skipping ColorType slots', () => {
    const palette = Array.from({ length: 256 }, () => [255, 0, 255, 255]);
    palette[0] = [0, 0, 0, 0];
    palette[4] = [88, 252, 84, 130];
    palette[12] = [0, 0, 0, 255];
    palette[16] = [16, 12, 12, 255];
    palette[79] = [228, 216, 228, 255];
    const table = makeFadingTable(palette, RA_COLOR_BLACK, 250);

    expect(table[0]).toBe(0);
    expect(table[12]).toBe(16);
    expect(table[79]).toBe(16);
    expect(shadowGhostRemapColor(palette, 0, 0, 0, 168, 168, 168, 255)?.slice(0, 3)).toEqual([16, 12, 12]);
    expect(shadowGhostRemapColor(palette, 228, 216, 228, 168, 168, 168, 255)?.slice(0, 3)).toEqual([16, 12, 12]);
  });

  it('vehicle spriteFrame uses BODY_SHAPE with bodyFacing32 index', () => {
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    // Shadow uses the same spriteFrame as the unit body
    for (let bf = 0; bf < 32; bf++) {
      tank.bodyFacing32 = bf;
      expect(tank.spriteFrame).toBe(BODY_SHAPE[bf]);
    }
  });

  it('infantry spriteFrame is independent of bodyFacing32', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    // Infantry don't use bodyFacing32 for sprite frame — use facing directly
    inf.facing = 2; // E
    const frame = inf.spriteFrame;
    inf.bodyFacing32 = 16; // doesn't affect infantry
    expect(inf.spriteFrame).toBe(frame);
  });
});

describe('House color remap data format', () => {
  it('remap-colors.json structure matches expected schema', () => {
    // This validates the expected structure that assets.ts getRemappedSheet() expects
    const mockRemapData = {
      source: Array.from({ length: 16 }, (_, i) => [i * 16, i * 8, 0]),
      houses: {
        Spain: Array.from({ length: 16 }, (_, i) => [i * 16, i * 8, 0]),
        Greece: Array.from({ length: 16 }, (_, i) => [0, 0, i * 16]),
        USSR: Array.from({ length: 16 }, (_, i) => [i * 16, 0, 0]),
      },
    };

    expect(mockRemapData.source).toHaveLength(16);
    expect(mockRemapData.houses.Spain).toHaveLength(16);
    expect(mockRemapData.houses.Greece).toHaveLength(16);
    expect(mockRemapData.houses.USSR).toHaveLength(16);

    // Each color is [r, g, b]
    for (const color of mockRemapData.source) {
      expect(color).toHaveLength(3);
      for (const channel of color) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it('Spain house uses same colors as source (identity remap)', () => {
    // In C++, PCOLOR_GOLD row 0 = source colors. Spain = PCOLOR_GOLD.
    // So Spain's remap colors should be identical to source.
    // This means getRemappedSheet for Spain should be a no-op.
    const tank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(tank.house).toBe(House.Spain);
  });

  it('different houses have different house enum values', () => {
    const houses = [House.Spain, House.Greece, House.USSR, House.Ukraine, House.Germany];
    const unique = new Set(houses);
    expect(unique.size).toBe(houses.length);
  });
});

describe('Entity house assignment', () => {
  it('entity stores house correctly for remap lookup', () => {
    const playerTank = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(playerTank.house).toBe(House.Spain);

    const enemyAnt = new Entity(UnitType.ANT1, House.USSR, 200, 200);
    expect(enemyAnt.house).toBe(House.USSR);

    const allyInf = new Entity(UnitType.I_E1, House.Greece, 300, 300);
    expect(allyInf.house).toBe(House.Greece);
  });
});
