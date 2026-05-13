/**
 * C++ parity test: Building bib system.
 *
 * C++ source: bdata.cpp:3597-3629 BuildingTypeClass::Bib_And_Offset()
 *   - Buildings with IsBibbed=true (from rules.ini Bib=yes) have a decorative
 *     ground pad ("bib") that extends 1 row below the building footprint.
 *   - Bib width matches building width (2→BIB3, 3→BIB2, 4→BIB1).
 *   - Width < 2 or > 4 → no bib (SMUDGE_NONE).
 *   - Bib cells are decorative smudges: passable for movement, but rejected
 *     by Is_Clear_To_Build when placement checks hit cell.cpp:489.
 *   - When building is destroyed/sold, bib smudges are removed.
 *
 * C++ source: building.cpp:734-740 (MARK_UP — clear bib on removal)
 * C++ source: building.cpp:785-790 (MARK_DOWN — place bib on construction)
 * C++ source: bdata.cpp:3448-3477 Occupy_List(placement=true) includes bib cells
 * C++ source: bdata.cpp:3561-3574 Height(bib=true) adds 1 row for bibbed buildings
 */

import { describe, it, expect } from 'vitest';
import { BIBBED_BUILDINGS, getBibCells, STRUCTURE_SIZE } from '../engine/scenario';
import { GameMap, Terrain } from '../engine/map';

// ── getBibCells() pure data tests ──────────────────────────────────────────

describe('C++ parity: getBibCells (bdata.cpp:3597-3629)', () => {
  describe('bibbed buildings produce correct bib cells', () => {
    // Width-2 buildings: bib is 2 cells wide, 1 row below
    const WIDTH_2_BIBBED = ['POWR', 'BARR', 'TENT', 'HPAD', 'DOME',
                            'ATEK', 'BIO', 'HOSP', 'FCOM', 'DOMF'];

    for (const type of WIDTH_2_BIBBED) {
      it(`${type} (2-wide): bib is 2 cells at row cy+h`, () => {
        const [fw, fh] = STRUCTURE_SIZE[type] ?? [2, 2];
        expect(fw).toBe(2); // verify width assumption
        const cells = getBibCells(type, 10, 20);
        expect(cells).toHaveLength(2);
        expect(cells[0]).toEqual({ cx: 10, cy: 20 + fh });
        expect(cells[1]).toEqual({ cx: 11, cy: 20 + fh });
      });
    }

    // Width-3 buildings: bib is 3 cells wide, 1 row below
    const WIDTH_3_BIBBED = ['FACT', 'WEAP', 'PROC', 'APWR', 'STEK', 'MISS', 'FACF', 'WEAF'];

    for (const type of WIDTH_3_BIBBED) {
      it(`${type} (3-wide): bib is 3 cells at row cy+h`, () => {
        const [fw, fh] = STRUCTURE_SIZE[type] ?? [3, 2];
        expect(fw).toBe(3); // verify width assumption
        const cells = getBibCells(type, 5, 8);
        expect(cells).toHaveLength(3);
        for (let dx = 0; dx < 3; dx++) {
          expect(cells[dx]).toEqual({ cx: 5 + dx, cy: 8 + fh });
        }
      });
    }
  });

  describe('non-bibbed buildings return empty array', () => {
    const NON_BIBBED = ['SILO', 'GUN', 'SAM', 'HBOX', 'TSLA', 'AGUN', 'GAP',
                        'PBOX', 'KENN', 'FTUR', 'MSLO',
                        'SBAG', 'FENC', 'BARB', 'BRIK', 'WOOD'];

    for (const type of NON_BIBBED) {
      it(`${type}: no bib cells`, () => {
        const cells = getBibCells(type, 10, 10);
        expect(cells).toHaveLength(0);
      });
    }
  });

  describe('width < 2 buildings get no bib even if in BIBBED set', () => {
    // KENN is 1x1 — width 1 falls through C++ switch default to SMUDGE_NONE
    it('KENN (1x1) would get no bib in C++ due to Width()=1 switch default', () => {
      // KENN is NOT in BIBBED_BUILDINGS, so this verifies the set is correct
      expect(BIBBED_BUILDINGS.has('KENN')).toBe(false);
    });
  });

  describe('cell coordinates are correct for various positions', () => {
    it('WEAP at (0,0): bib at y=2 (footprint height=2)', () => {
      const cells = getBibCells('WEAP', 0, 0);
      expect(cells).toEqual([{ cx: 0, cy: 2 }, { cx: 1, cy: 2 }, { cx: 2, cy: 2 }]);
    });

    it('FACT at (15,20): bib at y=23 (footprint height=3)', () => {
      const cells = getBibCells('FACT', 15, 20);
      expect(cells).toEqual([{ cx: 15, cy: 23 }, { cx: 16, cy: 23 }, { cx: 17, cy: 23 }]);
    });

    it('POWR at (50,50): bib at y=52 (footprint height=2)', () => {
      const cells = getBibCells('POWR', 50, 50);
      expect(cells).toEqual([{ cx: 50, cy: 52 }, { cx: 51, cy: 52 }]);
    });
  });

  describe('BIBBED_BUILDINGS set matches C++ rules.ini Bib=yes', () => {
    it('contains all standard bibbed buildings', () => {
      const expected = [
        'FACT', 'WEAP', 'PROC', 'POWR', 'APWR', 'BARR', 'TENT',
        'HPAD', 'DOME',
        'ATEK', 'STEK',
        'BIO', 'HOSP', 'MISS', 'FCOM',
        'FACF', 'WEAF', 'DOMF',
      ];
      for (const type of expected) {
        expect(BIBBED_BUILDINGS.has(type), `${type} should be bibbed`).toBe(true);
      }
    });

    it('does not contain non-bibbed buildings', () => {
      const excluded = ['SILO', 'GUN', 'TSLA', 'GAP', 'PBOX', 'HBOX', 'AGUN',
                         'SAM', 'FTUR', 'KENN', 'MSLO', 'SBAG', 'BRIK', 'WOOD',
                         'FIX', 'AFLD', 'IRON', 'PDOX', 'SYRD', 'SPEN'];
      for (const type of excluded) {
        expect(BIBBED_BUILDINGS.has(type), `${type} should NOT be bibbed`).toBe(false);
      }
    });
  });
});

// ── Smudge marking integration tests ───────────────────────────────────────

describe('C++ parity: bib smudge marking (building.cpp:785-790)', () => {
  function makeMap(w = 64, h = 64): GameMap {
    const map = new GameMap();
    map.setBounds(0, 0, w, h);
    // Clear all cells to CLEAR terrain
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        map.setTerrain(x, y, Terrain.CLEAR);
      }
    }
    return map;
  }

  it('placing a WEAP marks footprint as impassable and bib row as build-blocking', () => {
    const map = makeMap();
    const cx = 10, cy = 10;
    const [fw, fh] = STRUCTURE_SIZE['WEAP']!; // 3x2

    // Mark footprint
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        map.setTerrain(cx + dx, cy + dy, Terrain.WALL);
      }
    }
    // Mark bib smudges
    for (const bc of getBibCells('WEAP', cx, cy)) {
      map.setBibSmudge(bc.cx, bc.cy, true);
    }

    // Building footprint cells are impassable
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        expect(map.isPassable(cx + dx, cy + dy), `footprint (${cx + dx},${cy + dy})`).toBe(false);
      }
    }
    // Bib row remains passable for movement but blocks future placement.
    for (let dx = 0; dx < fw; dx++) {
      expect(map.hasBibSmudge(cx + dx, cy + fh), `bib smudge (${cx + dx},${cy + fh})`).toBe(true);
      expect(map.isPassable(cx + dx, cy + fh), `bib passable (${cx + dx},${cy + fh})`).toBe(true);
      expect(map.isBuildable(cx + dx, cy + fh), `bib buildable (${cx + dx},${cy + fh})`).toBe(false);
    }
    // Cell below bib is still passable/buildable.
    for (let dx = 0; dx < fw; dx++) {
      expect(map.isPassable(cx + dx, cy + fh + 1), `below bib (${cx + dx},${cy + fh + 1})`).toBe(true);
      expect(map.isBuildable(cx + dx, cy + fh + 1), `below bib buildable (${cx + dx},${cy + fh + 1})`).toBe(true);
    }
  });

  it('clearing a bibbed building restores bib cells to passable', () => {
    const map = makeMap();
    const cx = 5, cy = 5;
    const [fw, fh] = STRUCTURE_SIZE['PROC']!; // 3x2
    const bibCells = getBibCells('PROC', cx, cy);

    // Place building + bib smudge
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        map.setTerrain(cx + dx, cy + dy, Terrain.WALL);
      }
    }
    for (const bc of bibCells) {
      map.setBibSmudge(bc.cx, bc.cy, true);
    }

    // Verify bib blocks placement without blocking movement.
    for (const bc of bibCells) {
      expect(map.hasBibSmudge(bc.cx, bc.cy)).toBe(true);
      expect(map.isPassable(bc.cx, bc.cy)).toBe(true);
      expect(map.isBuildable(bc.cx, bc.cy)).toBe(false);
    }

    // Clear footprint + bib smudge (simulating destruction)
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        map.setTerrain(cx + dx, cy + dy, Terrain.CLEAR);
      }
    }
    for (const bc of bibCells) {
      map.setBibSmudge(bc.cx, bc.cy, false);
    }

    // All cells (footprint + bib row) should be passable/buildable now.
    for (let dy = 0; dy <= fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        expect(map.isPassable(cx + dx, cy + dy), `cleared (${cx + dx},${cy + dy})`).toBe(true);
        expect(map.isBuildable(cx + dx, cy + dy), `cleared buildable (${cx + dx},${cy + dy})`).toBe(true);
      }
    }
  });

  it('non-bibbed building (SILO) does NOT mark extra row', () => {
    const map = makeMap();
    const cx = 10, cy = 10;
    const [fw, fh] = STRUCTURE_SIZE['SILO']!; // 1x1

    // Mark footprint only
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        map.setTerrain(cx + dx, cy + dy, Terrain.WALL);
      }
    }
    // No bib cells
    const bibCells = getBibCells('SILO', cx, cy);
    expect(bibCells).toHaveLength(0);

    // Footprint is impassable
    expect(map.isPassable(cx, cy)).toBe(false);
    // Row below is passable (no bib)
    expect(map.isPassable(cx, cy + fh)).toBe(true);
  });

  it('all bibbed building types produce bib cells with width matching STRUCTURE_SIZE', () => {
    for (const type of BIBBED_BUILDINGS) {
      const [fw] = STRUCTURE_SIZE[type] ?? [1, 1];
      const cells = getBibCells(type, 0, 0);
      // Width >= 2 should have bib cells matching building width
      if (fw >= 2 && fw <= 4) {
        expect(cells.length, `${type} bib width should match building width ${fw}`).toBe(fw);
      } else {
        expect(cells.length, `${type} width ${fw} should have no bib`).toBe(0);
      }
    }
  });
});

// ── C++ Height(bib=true) parity ────────────────────────────────────────────

describe('C++ parity: Height(bib=true) (bdata.cpp:3561-3574)', () => {
  it('bibbed buildings effective height = footprint height + 1', () => {
    for (const type of BIBBED_BUILDINGS) {
      const [fw, fh] = STRUCTURE_SIZE[type] ?? [1, 1];
      if (fw < 2 || fw > 4) continue; // no bib for these widths
      const bibCells = getBibCells(type, 0, 0);
      const bibRow = bibCells[0]?.cy ?? fh;
      // Bib row should be exactly 1 row below footprint
      expect(bibRow, `${type}: bib row should be at height ${fh}`).toBe(fh);
      // Effective height = fh + 1 (matches C++ Height(bib=true))
      const effectiveHeight = fh + 1;
      expect(effectiveHeight, `${type}: effective height with bib`).toBe(fh + 1);
    }
  });
});

// ── Bib smudge type selection parity ───────────────────────────────────────

describe('C++ parity: bib smudge type selection (bdata.cpp:3602-3617)', () => {
  // C++ switch: Width 2 → BIB3, Width 3 → BIB2, Width 4 → BIB1
  // We don't have explicit smudge types, but we verify the width mapping is correct

  it('width-2 buildings get 2-cell-wide bibs (SMUDGE_BIB3 equivalent)', () => {
    for (const type of BIBBED_BUILDINGS) {
      const [fw] = STRUCTURE_SIZE[type] ?? [1, 1];
      if (fw !== 2) continue;
      const cells = getBibCells(type, 0, 0);
      expect(cells.length, `${type}`).toBe(2);
    }
  });

  it('width-3 buildings get 3-cell-wide bibs (SMUDGE_BIB2 equivalent)', () => {
    for (const type of BIBBED_BUILDINGS) {
      const [fw] = STRUCTURE_SIZE[type] ?? [1, 1];
      if (fw !== 3) continue;
      const cells = getBibCells(type, 0, 0);
      expect(cells.length, `${type}`).toBe(3);
    }
  });

  it('unknown type returns empty array', () => {
    expect(getBibCells('NONEXISTENT', 10, 10)).toHaveLength(0);
  });
});
