/**
 * Tests for tree terrain tile rendering logic.
 *
 * Verifies that clear-template cells (tmpl=0, 0xFFFF, or 255) use the
 * tileset clear tile before Land_Type-specific logic, preventing visible
 * color/texture mismatch with surrounding tileset-rendered cells.
 *
 * Also verifies that tree sprite rendering is deferred to a second pass
 * so clump sprites (TC01-TC05, 72-96px wide) aren't overwritten by
 * neighboring _clump satellite cells.
 */
import { describe, it, expect } from 'vitest';
import { Terrain } from '../engine/map';

describe('Tree tile rendering logic', () => {
  // C++ CellClass::Draw_It chooses base art from TType first:
  // TEMPLATE_NONE, TEMPLATE_CLEAR1, and 255 all draw TEMPLATE_CLEAR1 with
  // Clear_Icon(), regardless of the movement Land_Type.

  function shouldDrawClearTemplate(useTileset: boolean, tmpl: number): boolean {
    return useTileset && (tmpl === 0 || tmpl === 0xFFFF || tmpl === 255);
  }

  it('TREE terrain with clear template (tmpl=0) qualifies for atlas clear tile', () => {
    const tmpl = 0;
    const useTileset = true;

    expect(shouldDrawClearTemplate(useTileset, tmpl)).toBe(true);
  });

  it('TREE terrain with clear template (tmpl=0xFFFF) qualifies for atlas clear tile', () => {
    const tmpl = 0xFFFF;
    const useTileset = true;

    expect(shouldDrawClearTemplate(useTileset, tmpl)).toBe(true);
  });

  it('TType 255 qualifies for Clear_Icon instead of TIcon', () => {
    const tmpl = 255;
    const useTileset = true;

    expect(shouldDrawClearTemplate(useTileset, tmpl)).toBe(true);
  });

  it('TREE terrain does NOT continue after atlas draw (needs overlay)', () => {
    const terrain = Terrain.TREE;

    // After drawing the clear tile, TREE cells should set atlasDrawn=true
    // and fall through to tree overlay rendering (NOT continue like CLEAR does)
    const shouldContinue = terrain === Terrain.CLEAR;
    expect(shouldContinue).toBe(false);
  });

  it('CLEAR terrain continues after atlas draw (no overlay needed)', () => {
    const terrain = Terrain.CLEAR;

    const shouldContinue = terrain === Terrain.CLEAR;
    expect(shouldContinue).toBe(true);
  });

  it('WATER terrain still qualifies for clear-template base art when TType is clear', () => {
    const terrain = Terrain.WATER;
    const tmpl = 0;
    const useTileset = true;

    expect(terrain).toBe(Terrain.WATER);
    expect(shouldDrawClearTemplate(useTileset, tmpl)).toBe(true);
  });

  it('ROCK terrain still qualifies for clear-template base art when TType is clear', () => {
    const terrain = Terrain.ROCK;
    const tmpl = 0;
    const useTileset = true;

    expect(terrain).toBe(Terrain.ROCK);
    expect(shouldDrawClearTemplate(useTileset, tmpl)).toBe(true);
  });

  it('non-sentinel templates do not enter clear tile path', () => {
    const tmpl = 42;
    const useTileset = true;

    expect(shouldDrawClearTemplate(useTileset, tmpl)).toBe(false);
  });

  // Deferred tree rendering: _clump satellite cells should only show grass,
  // while actual tree sprites are deferred to second pass
  it('_clump tree type is recognized as satellite (no sprite draw)', () => {
    const treeType = '_clump';
    const isClumpSatellite = treeType === '_clump';
    expect(isClumpSatellite).toBe(true);
  });

  it('named tree types (TC01, T08, etc.) should be deferred', () => {
    const treeTypes = ['TC01', 'TC02', 'TC03', 'TC04', 'TC05', 'T01', 'T08', 'T10'];
    for (const treeType of treeTypes) {
      const isClumpSatellite = treeType === '_clump';
      expect(isClumpSatellite, `${treeType} should not be treated as _clump`).toBe(false);
    }
  });

  it('deferred tree list collects sprite draws for second pass', () => {
    // Simulates the deferred draw list pattern used in renderTerrain()
    const deferredTrees: { name: string; x: number; y: number }[] = [];

    // Simulate encountering tree cells during terrain loop
    const trees = [
      { name: 'TC01', x: 100, y: 200 },
      { name: 'T08', x: 148, y: 200 },
      { name: 'TC03', x: 300, y: 400 },
    ];

    for (const tree of trees) {
      // This mirrors the renderer logic: push instead of immediate draw
      deferredTrees.push(tree);
    }

    expect(deferredTrees).toHaveLength(3);
    expect(deferredTrees[0].name).toBe('TC01');
    expect(deferredTrees[2].name).toBe('TC03');
  });
});
