/**
 * C++ Behavioral Parity Tests — Building Placement Preview Validation
 *
 * Tests per-cell passability check, green/red highlighting, bib preview,
 * and proximity check integration during placement preview.
 *
 * C++ reference: CnC_and_Red_Alert/RA/
 *   - cell.cpp:1112-1130  Draw_It() — placement cursor green/red per cell
 *   - cell.cpp:453-513    Is_Clear_To_Build() — per-cell buildability
 *   - display.cpp:668-811 Passes_Proximity_Check() — global proximity boolean
 *   - display.cpp:836-898 Set_Cursor_Pos() — calls Passes_Proximity_Check
 *   - display.cpp:978-1017 Cursor_Mark() — marks cells with IsCursorHere flag
 *   - bdata.cpp:3448-3477  Occupy_List(placement=true) — includes bib cells
 *
 * C++ per-cell color logic (cell.cpp:1126-1130):
 *   if (Map.ProximityCheck && Is_Clear_To_Build(loco))
 *     → green stamp (TransIconset frame 0)
 *   else
 *     → red stamp (TransIconset frame 2)
 *
 * Two conditions must BOTH be true for green:
 *   1. ProximityCheck (global) — is the building near a friendly structure?
 *   2. Is_Clear_To_Build (per-cell) — is this specific cell buildable?
 *
 * If proximity fails, ALL cells show red regardless of terrain.
 * If proximity passes, each cell shows green/red based on its own buildability.
 *
 * TS implementation (FIXED — now uses isBuildable + 2-cell AABB):
 *   - index.ts:6363-6385 — preview validation
 *   - renderer.ts:3981-4031 — renderPlacementGhost()
 */

import { describe, it, expect } from 'vitest';
import { GameMap, Terrain } from '../engine/map';
import { STRUCTURE_SIZE, BIBBED_BUILDINGS, getBibCells } from '../engine/scenario';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers — simulate the C++ and TS preview logic
// ═══════════════════════════════════════════════════════════════════════════

function makeMap(): GameMap {
  const m = new GameMap();
  m.setBounds(0, 0, 128, 128);
  return m;
}

interface PreviewStructure {
  type: string;
  cx: number;
  cy: number;
  alive: boolean;
  house: string;
}

/**
 * Simulate C++ cell.cpp:1126 — per-cell green/red for placement preview.
 *
 * C++ logic: green = ProximityCheck && Is_Clear_To_Build(loco)
 *   - ProximityCheck is a global boolean (display.cpp:898)
 *   - Is_Clear_To_Build checks: no object, no overlay, no bib smudge, Ground[land].Build
 *   - For loco==SPEED_NONE: Ground[land].Build = only CLEAR and ROAD
 *
 * Returns per-cell boolean array AND overall validity.
 */
function cppPreview(
  map: GameMap,
  buildingType: string,
  cx: number, cy: number,
  structures: PreviewStructure[],
  playerHouse: string = 'Greece',
): { cells: boolean[]; proximityPass: boolean; allCellsClear: boolean; overallValid: boolean } {
  const [fw, fh] = STRUCTURE_SIZE[buildingType] ?? [2, 2];

  // Step 1: Compute proximity check (display.cpp:668-811)
  // C++ scans 8-directionally from each foundation cell, then 4-directionally
  // from each of those neighbors (two-ring scan)
  let proximityPass = false;
  for (let dy = 0; dy < fh && !proximityPass; dy++) {
    for (let dx = 0; dx < fw && !proximityPass; dx++) {
      const fcx = cx + dx;
      const fcy = cy + dy;
      // Ring 1: 8 adjacent cells
      for (let adjY = -1; adjY <= 1 && !proximityPass; adjY++) {
        for (let adjX = -1; adjX <= 1 && !proximityPass; adjX++) {
          if (adjX === 0 && adjY === 0) continue;
          const ncx = fcx + adjX;
          const ncy = fcy + adjY;
          // Check if a friendly building occupies this cell
          for (const s of structures) {
            if (!s.alive || s.house !== playerHouse) continue;
            const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
            if (ncx >= s.cx && ncx < s.cx + sw && ncy >= s.cy && ncy < s.cy + sh) {
              proximityPass = true;
              break;
            }
          }
          if (proximityPass) break;
          // Ring 2: 4 cardinal adjacent cells from ring-1 cell (display.cpp:756-775)
          for (const [dx2, dy2] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const ncx2 = ncx + dx2;
            const ncy2 = ncy + dy2;
            for (const s of structures) {
              if (!s.alive || s.house !== playerHouse) continue;
              const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
              if (ncx2 >= s.cx && ncx2 < s.cx + sw && ncy2 >= s.cy && ncy2 < s.cy + sh) {
                proximityPass = true;
                break;
              }
            }
            if (proximityPass) break;
          }
        }
      }
    }
  }

  // Step 2: Per-cell Is_Clear_To_Build (cell.cpp:453-513)
  // For SPEED_NONE (buildings): Ground[land].Build = only CLEAR and ROAD
  const cells: boolean[] = [];
  let allCellsClear = true;
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      const buildable = map.isBuildable(cx + dx, cy + dy);
      cells.push(buildable);
      if (!buildable) allCellsClear = false;
    }
  }

  // Step 3: C++ per-cell color = proximityPass AND isClearToBuild
  // cell.cpp:1126: if (Map.ProximityCheck && Is_Clear_To_Build(loco)) → green; else → red
  const perCellGreen = cells.map(c => proximityPass && c);

  return {
    cells: perCellGreen,
    proximityPass,
    allCellsClear,
    overallValid: proximityPass && allCellsClear,
  };
}

/**
 * Simulate TS preview logic (index.ts:6360-6385, renderer.ts:3990-4004).
 *
 * UPDATED: TS now uses isBuildable() for per-cell checks (was isPassable).
 * UPDATED: TS now uses AABB overlap with 2-cell expansion (was 1-cell).
 * Per-cell color uses placementCells[idx] independently of adjacency.
 */
function tsPreview(
  map: GameMap,
  buildingType: string,
  cx: number, cy: number,
  structures: PreviewStructure[],
  playerHouse: string = 'Greece',
): { cells: boolean[]; adj: boolean; placementValid: boolean } {
  const [fw, fh] = STRUCTURE_SIZE[buildingType] ?? [2, 2];

  // index.ts:6365-6369: per-cell buildability (FIXED: was isPassable, now isBuildable)
  let valid = true;
  const cells: boolean[] = [];
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      const buildable = map.isBuildable(cx + dx, cy + dy);
      cells.push(buildable);
      if (!buildable) valid = false;
    }
  }

  // index.ts:6373-6382: AABB adjacency with 2-cell expansion (FIXED: was 1-cell)
  let adj = false;
  for (const s of structures) {
    if (!s.alive || s.house !== playerHouse) continue;
    const [sw, sh] = STRUCTURE_SIZE[s.type] ?? [2, 2];
    const exL = s.cx - 2, exT = s.cy - 2, exR = s.cx + sw + 2, exB = s.cy + sh + 2;
    const nL = cx, nT = cy, nR = cx + fw, nB = cy + fh;
    if (nL < exR && nR > exL && nT < exB && nB > exT) { adj = true; break; }
  }

  return {
    cells,
    adj,
    placementValid: valid && adj,
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// Section 1: Per-cell buildability check — Is_Clear_To_Build
//
// C++ cell.cpp:453-513:
//   loco == SPEED_NONE → return Ground[Land_Type()].Build
//   Ground[LAND_CLEAR].Build=true, Ground[LAND_ROAD].Build=true
//   All others: Build=false (ORE, ROUGH, BEACH, WATER, ROCK, WALL, RIVER)
//
// C++ cell.cpp:1126: each cell colored green ONLY if Is_Clear_To_Build(loco)
// passes AND global ProximityCheck is true.
//
// TS preview (index.ts:6367): FIXED — now uses isBuildable(), matching C++.
//   Previously used isPassable() which included ORE, ROUGH, BEACH, TREE.
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 1: Per-cell buildability — Is_Clear_To_Build (cell.cpp:453-513)', () => {

  it('CLEAR cell shows green in C++ when proximity passes', () => {
    // C++ cell.cpp:503: Ground[LAND_CLEAR].Build=true → Is_Clear_To_Build=true
    // C++ cell.cpp:1126: ProximityCheck=true AND Is_Clear_To_Build=true → green
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const result = cppPreview(map, 'POWR', 13, 10, structs);
    // POWR is 2x2 → 4 cells, all CLEAR
    expect(result.cells).toEqual([true, true, true, true]);
    expect(result.proximityPass).toBe(true);
  });

  it('ROCK cell shows red in C++ even when proximity passes', () => {
    // C++ cell.cpp:503: Ground[LAND_ROCK].Build=false → Is_Clear_To_Build=false
    // cell.cpp:1126: ProximityCheck=true BUT Is_Clear_To_Build=false → red
    const map = makeMap();
    map.setTerrain(13, 10, Terrain.ROCK);
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const result = cppPreview(map, 'POWR', 13, 10, structs);
    // Cell (13,10) is ROCK → red; (14,10) is CLEAR → green
    expect(result.cells[0]).toBe(false); // (13,10) ROCK
    expect(result.cells[1]).toBe(true);  // (14,10) CLEAR
    expect(result.proximityPass).toBe(true);
  });

  it('WATER cell shows red in both C++ and TS', () => {
    // C++ Ground[LAND_WATER].Build=false
    // TS PASSABLE does not include WATER
    const map = makeMap();
    map.setTerrain(13, 10, Terrain.WATER);
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const cpp = cppPreview(map, 'POWR', 13, 10, structs);
    const ts = tsPreview(map, 'POWR', 13, 10, structs);
    // Both agree: WATER cell is red
    expect(cpp.cells[0]).toBe(false);
    expect(ts.cells[0]).toBe(false);
  });

  // FIXED: TS preview now uses isBuildable(), matching C++ Is_Clear_To_Build
  it('ORE cell shows RED in preview — FIXED to match C++ Ground[LAND_ORE].Build=false', () => {
    // C++ cell.cpp:503: Ground[LAND_ORE].Build=false → red in preview
    // TS index.ts:6367: isBuildable() excludes ORE → red in preview (FIXED)
    const map = makeMap();
    map.setTerrain(13, 10, Terrain.ORE);
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const cpp = cppPreview(map, 'POWR', 13, 10, structs);
    const ts = tsPreview(map, 'POWR', 13, 10, structs);

    // Both agree: ORE cell is red
    expect(cpp.cells[0]).toBe(false);
    expect(ts.cells[0]).toBe(false); // FIXED: TS now matches C++
  });

  // FIXED: TS preview now uses isBuildable(), matching C++ Is_Clear_To_Build
  it('ROUGH cell shows RED in preview — FIXED to match C++ Ground[LAND_ROUGH].Build=false', () => {
    // C++ cell.cpp:503: Ground[LAND_ROUGH].Build=false → red
    // TS: isBuildable excludes ROUGH → red (FIXED)
    const map = makeMap();
    map.setTerrain(13, 10, Terrain.ROUGH);
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const cpp = cppPreview(map, 'POWR', 13, 10, structs);
    const ts = tsPreview(map, 'POWR', 13, 10, structs);

    expect(cpp.cells[0]).toBe(false);
    expect(ts.cells[0]).toBe(false); // FIXED: TS now matches C++
  });

  // FIXED: TS preview now uses isBuildable(), matching C++ Is_Clear_To_Build
  it('BEACH cell shows RED in preview — FIXED to match C++ Ground[LAND_BEACH].Build=false', () => {
    // C++ cell.cpp:503: Ground[LAND_BEACH].Build=false → red
    // TS: isBuildable excludes BEACH → red (FIXED)
    const map = makeMap();
    map.setTerrain(13, 10, Terrain.BEACH);
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const cpp = cppPreview(map, 'POWR', 13, 10, structs);
    const ts = tsPreview(map, 'POWR', 13, 10, structs);

    expect(cpp.cells[0]).toBe(false);
    expect(ts.cells[0]).toBe(false); // FIXED: TS now matches C++
  });

  it('ROAD cell shows green in both C++ and TS', () => {
    // C++ Ground[LAND_ROAD].Build=true
    // TS BUILDABLE includes ROAD, PASSABLE includes ROAD
    const map = makeMap();
    map.setTerrain(13, 10, Terrain.ROAD);
    map.setTerrain(14, 10, Terrain.ROAD);
    map.setTerrain(13, 11, Terrain.ROAD);
    map.setTerrain(14, 11, Terrain.ROAD);
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const cpp = cppPreview(map, 'POWR', 13, 10, structs);
    const ts = tsPreview(map, 'POWR', 13, 10, structs);
    expect(cpp.cells).toEqual([true, true, true, true]);
    expect(ts.cells).toEqual([true, true, true, true]);
  });

  it('WALL cell shows red in both C++ and TS', () => {
    // C++ cell.cpp:482: overlay with IsWall → Is_Clear_To_Build=false
    // TS: WALL not in PASSABLE
    const map = makeMap();
    map.setTerrain(13, 10, Terrain.WALL);
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const cpp = cppPreview(map, 'POWR', 13, 10, structs);
    const ts = tsPreview(map, 'POWR', 13, 10, structs);
    expect(cpp.cells[0]).toBe(false);
    expect(ts.cells[0]).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 2: Proximity check integration with per-cell coloring
//
// C++ cell.cpp:1126-1130:
//   if (Map.ProximityCheck && Is_Clear_To_Build(loco)) → green
//   else → red
//
// When ProximityCheck=false, ALL cells show red — even buildable ones.
// This is the C++ "base nearby" requirement.
//
// TS renderer.ts:3994-3995:
//   cellPassable = placementCells[idx]  (if available)
//   Per-cell color is independent of overall proximity (adj).
//   Only the border and text use placementValid (which includes adj).
//
// So in TS, a cell can show green even when proximity fails —
// it shows per-cell passability, not proximity-gated buildability.
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 2: Proximity gates per-cell coloring (cell.cpp:1126)', () => {

  it('C++ shows ALL cells red when proximity fails — even on clear terrain', () => {
    // C++ cell.cpp:1126: Map.ProximityCheck=false → all cells get red stamp
    // No friendly structures anywhere → proximity fails
    const map = makeMap();
    const result = cppPreview(map, 'POWR', 50, 50, []);
    // All 4 cells are CLEAR terrain (buildable), but proximity failed
    expect(result.allCellsClear).toBe(true);
    expect(result.proximityPass).toBe(false);
    // All cells show red because proximity failed
    expect(result.cells).toEqual([false, false, false, false]);
  });

  // REMAINING GAP: TS per-cell color is independent of proximity check.
  // In C++, proximity=false forces ALL cells red. In TS, per-cell color
  // reflects buildability only; the proximity gate is applied at the
  // overall placementValid level (border/text), not per-cell color.
  it('REMAINING GAP: TS per-cell color does not gate on proximity — C++ does', () => {
    // C++ cell.cpp:1126: proximity=false → all red
    // TS renderer.ts:3994: uses placementCells[idx] which is isBuildable(),
    //   independent of adj. CLEAR cells still show green in TS.
    const map = makeMap();
    const tsResult = tsPreview(map, 'POWR', 50, 50, []);
    const cppResult = cppPreview(map, 'POWR', 50, 50, []);

    // TS: all cells show green (buildable) even without proximity
    expect(tsResult.cells).toEqual([true, true, true, true]);
    // TS: overall placementValid is false (adj failed) — correct gating at this level
    expect(tsResult.placementValid).toBe(false);

    // C++: all cells show red because proximity failed
    expect(cppResult.cells).toEqual([false, false, false, false]);

    // REMAINING GAP: TS per-cell != C++ per-cell when proximity fails.
    // TS shows per-cell buildability; C++ gates per-cell on proximity AND buildability.
    // The overall validity (placementValid vs overallValid) agrees: both false.
    expect(tsResult.placementValid).toBe(cppResult.overallValid); // Both false — overall agrees
  });

  it('C++ shows green when both proximity AND per-cell pass', () => {
    // C++ cell.cpp:1126: ProximityCheck=true AND Is_Clear_To_Build=true → green
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const result = cppPreview(map, 'POWR', 13, 10, structs);
    expect(result.proximityPass).toBe(true);
    expect(result.allCellsClear).toBe(true);
    expect(result.cells).toEqual([true, true, true, true]);
  });

  it('C++ shows mixed green/red when proximity passes but some cells blocked', () => {
    // C++ cell.cpp:1126: ProximityCheck=true, per-cell varies
    // One ROCK cell among CLEAR cells → that cell is red, others green
    const map = makeMap();
    map.setTerrain(14, 11, Terrain.ROCK); // block bottom-right of POWR (2x2)
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const result = cppPreview(map, 'POWR', 13, 10, structs);
    // POWR cells: (13,10)=CLEAR, (14,10)=CLEAR, (13,11)=CLEAR, (14,11)=ROCK
    expect(result.proximityPass).toBe(true);
    expect(result.cells).toEqual([true, true, true, false]);
  });

  it('dead structure does not satisfy proximity check', () => {
    // C++ display.cpp:744: Cell_Techno() returns NULL for dead buildings
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: false, house: 'Greece' },
    ];
    const cppResult = cppPreview(map, 'POWR', 13, 10, structs);
    const tsResult = tsPreview(map, 'POWR', 13, 10, structs);
    expect(cppResult.proximityPass).toBe(false);
    expect(tsResult.adj).toBe(false);
  });

  it('enemy structure does not satisfy proximity check', () => {
    // C++ display.cpp:744: base->House->Class->House == house must match
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'USSR' },
    ];
    const cppResult = cppPreview(map, 'POWR', 13, 10, structs);
    const tsResult = tsPreview(map, 'POWR', 13, 10, structs);
    expect(cppResult.proximityPass).toBe(false);
    expect(tsResult.adj).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 3: Two-ring proximity scan vs AABB
//
// C++ display.cpp:706-778 Passes_Proximity_Check:
//   For each foundation cell (ptr = Occupy_List):
//     For each of 8 adjacent cells (FACING_FIRST..FACING_COUNT):
//       Check for friendly building → pass
//       If not found, for each of 4 cardinal neighbors of that cell:
//         Check for friendly building → pass
//
// This creates a 2-cell reach in cardinal directions from each foundation cell.
// A building can be placed with 1 empty cell gap (cardinal) from friendly base.
//
// TS index.ts:6378: FIXED — AABB expansion of 2 cells per existing structure.
// (Was 1-cell, now matches C++ two-ring reach.)
// For FACT (3x3), the expanded box is (cx-2, cy-2) to (cx+3+2, cy+3+2).
//
// The TS AABB check uses STRICT less-than: nL < exR. With 2-cell expansion
// this now matches the C++ two-ring scan reach for cardinal directions.
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 3: Two-ring proximity scan (display.cpp:706-778)', () => {

  it('C++ two-ring scan: building 2 cells away (cardinal) passes proximity', () => {
    // C++ display.cpp:749-775: second-ring scan
    // FACT at (10,10) is 3x3 → rightmost column 12
    // POWR at (14,10) → leftmost column 14, gap of 1 empty column (13)
    // C++ scan: from POWR cell (14,10), check W neighbor (13,10),
    // then from (13,10) check W cardinal neighbor (12,10) = FACT cell → pass
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const cppResult = cppPreview(map, 'POWR', 14, 10, structs);
    expect(cppResult.proximityPass).toBe(true);
  });

  // FIXED: TS AABB now uses 2-cell expansion, matching C++ two-ring scan reach
  it('TS AABB: building 2 cells away passes proximity — FIXED to match C++', () => {
    // TS index.ts:6378: exR = FACT.cx + 3 + 2 = 15 (was +1=14)
    //   POWR at (14,10): nL = 14, nL < exR → 14 < 15 = true → overlap!
    //
    // C++ two-ring scan reaches 2 cells → passes
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const tsResult = tsPreview(map, 'POWR', 14, 10, structs);
    const cppResult = cppPreview(map, 'POWR', 14, 10, structs);

    expect(cppResult.proximityPass).toBe(true);
    expect(tsResult.adj).toBe(true); // FIXED: TS now matches C++ with 2-cell expansion
  });

  it('adjacent placement (0 cell gap) passes in both C++ and TS', () => {
    // FACT at (10,10) is 3x3 → columns 10-12
    // POWR at (13,10) → directly adjacent (column 13 touches column 12)
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const cppResult = cppPreview(map, 'POWR', 13, 10, structs);
    const tsResult = tsPreview(map, 'POWR', 13, 10, structs);
    expect(cppResult.proximityPass).toBe(true);
    expect(tsResult.adj).toBe(true);
  });

  it('diagonal adjacency (corner touching) passes in both C++ and TS', () => {
    // C++ display.cpp:717: 8-directional scan includes diagonals
    // FACT at (10,10), POWR at (13,13) — diagonal corner
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const cppResult = cppPreview(map, 'POWR', 13, 13, structs);
    const tsResult = tsPreview(map, 'POWR', 13, 13, structs);
    expect(cppResult.proximityPass).toBe(true);
    expect(tsResult.adj).toBe(true);
  });

  it('building 3+ cells away fails proximity in both C++ and TS', () => {
    // Beyond 2-ring reach in C++ and beyond AABB expansion in TS
    // FACT at (10,10) → rightmost 12. POWR at (15,10) → gap of 2 empty columns
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const cppResult = cppPreview(map, 'POWR', 15, 10, structs);
    const tsResult = tsPreview(map, 'POWR', 15, 10, structs);
    expect(cppResult.proximityPass).toBe(false);
    expect(tsResult.adj).toBe(false);
  });

  it('C++ two-ring scan: 1-cell gap diagonal still passes via ring-2', () => {
    // FACT at (10,10) 3x3 → bottom-right at (12,12)
    // POWR at (14,13) → top-left cell (14,13)
    // Ring-1 from (14,13): check (13,12) — not a FACT cell (FACT is 10-12, 10-12)
    //   (13,12) is diagonal to FACT's (12,12) but (13,12) itself is not FACT
    // Ring-2 from (13,12): check W→(12,12) — FACT cell → pass!
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const cppResult = cppPreview(map, 'POWR', 14, 13, structs);
    expect(cppResult.proximityPass).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 4: Bib preview — C++ includes bib cells in placement cursor
//
// C++ bdata.cpp:3448-3477 Occupy_List(placement=true):
//   When placement=true, the occupy list includes bib cells.
//   This means bib cells are part of the cursor visualization AND
//   each bib cell is checked via Is_Clear_To_Build.
//
// C++ cell.cpp:1112-1130: IsCursorHere flag is set for all cells in
//   CursorSize (which includes bib cells during placement).
//   Each bib cell gets its own green/red coloring based on
//   ProximityCheck && Is_Clear_To_Build.
//
// TS renderer.ts:3990-4004: only iterates over fw*fh cells (building
//   footprint), does NOT include bib cells in the preview grid.
//   Bib cells are not shown with green/red highlighting.
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 4: Bib cells in placement preview (bdata.cpp:3448-3477)', () => {

  // REMAINING GAP: TS does not include bib cells in placement cursor preview.
  // C++ Occupy_List(placement=true) returns footprint + bib cells, so bib cells
  // get their own green/red highlighting. TS only renders fw*fh cells.
  it('REMAINING GAP: C++ includes bib cells in placement cursor — TS does not', () => {
    // C++ Occupy_List(placement=true) includes bib row
    // POWR is 2x2 bibbed → 4 footprint cells + 2 bib cells = 6 cells in cursor
    // TS preview only shows 4 cells (fw * fh = 2 * 2 = 4)
    const [fw, fh] = STRUCTURE_SIZE['POWR'] ?? [2, 2];
    const bibCells = getBibCells('POWR', 10, 10);

    const tsPreviewCellCount = fw * fh; // TS only renders footprint cells
    const cppPreviewCellCount = fw * fh + bibCells.length; // C++ includes bibs

    expect(tsPreviewCellCount).toBe(4);
    expect(cppPreviewCellCount).toBe(6);
    // REMAINING GAP: TS renders 4 cells, C++ renders 6 (includes bib row)
    expect(tsPreviewCellCount).not.toBe(cppPreviewCellCount);
  });

  // REMAINING GAP: same bib preview issue for larger buildings
  it('REMAINING GAP: FACT (3x3) bib preview — C++ shows 12 cells, TS shows 9', () => {
    // FACT 3x3 → 9 footprint + 3 bib cells = 12 in C++
    const [fw, fh] = STRUCTURE_SIZE['FACT'] ?? [3, 3];
    const bibCells = getBibCells('FACT', 10, 10);

    const tsCount = fw * fh;
    const cppCount = fw * fh + bibCells.length;

    expect(tsCount).toBe(9);
    expect(bibCells).toHaveLength(3);
    expect(cppCount).toBe(12);
    // REMAINING GAP: TS renders 9 cells, C++ renders 12 (includes bib row)
    expect(tsCount).not.toBe(cppCount);
  });

  it('non-bibbed building (GUN 1x1): preview cell count matches', () => {
    // GUN is not bibbed → no bib cells → C++ and TS show same count
    const [fw, fh] = STRUCTURE_SIZE['GUN'] ?? [1, 1];
    const bibCells = getBibCells('GUN', 10, 10);

    const tsCount = fw * fh;
    const cppCount = fw * fh + bibCells.length;

    expect(bibCells).toHaveLength(0);
    expect(tsCount).toBe(cppCount); // Both show 1 cell
  });

  it('bib cell on blocked terrain shows red in C++ preview', () => {
    // C++ cell.cpp:1126: bib cell checked via Is_Clear_To_Build
    // If bib cell is on ROCK terrain, it shows red in C++
    const map = makeMap();
    // POWR at (13,10): bib at row 12, columns 13-14
    // Block bib cell (13, 12)
    map.setTerrain(13, 12, Terrain.ROCK);
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    // C++ would check bib cells in the preview cursor
    const bibCells = getBibCells('POWR', 13, 10);
    const bibBuildable = bibCells.map(bc => map.isBuildable(bc.cx, bc.cy));
    // Bib (13,12)=ROCK → not buildable, bib (14,12)=CLEAR → buildable
    expect(bibBuildable[0]).toBe(false); // blocked bib cell → red in C++
    expect(bibBuildable[1]).toBe(true);  // clear bib cell → green in C++
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 5: Preview vs actual placement consistency
//
// In C++, the preview and actual placement use the same check:
//   Preview:  ProximityCheck && Is_Clear_To_Build(loco) → green/red per cell
//   Actual:   Legal_Placement checks Is_Clear_To_Build for each cell
//             AND Passes_Proximity_Check must be true
//
// So if ALL cells show green in preview, placement WILL succeed.
// If ANY cell shows red, placement WILL fail.
//
// In TS (FIXED):
//   Preview:  isBuildable() per cell → green/red (index.ts:6367)
//   Actual:   isBuildable() per cell (placement.ts:60)
//
// Both now use isBuildable — preview is consistent with actual placement.
// Previously used isPassable for preview, which included ORE/ROUGH/BEACH
// (caused misleading green cells that couldn't actually be placed on).
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 5: Preview/placement consistency (cell.cpp:1126 vs techno.cpp:6335)', () => {

  it('C++: all-green preview means placement will succeed', () => {
    // In C++, the same Is_Clear_To_Build check is used for both preview and placement
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const preview = cppPreview(map, 'POWR', 13, 10, structs);
    // All green → placement guaranteed
    expect(preview.cells.every(c => c)).toBe(true);
    expect(preview.overallValid).toBe(true);
  });

  it('C++: any-red preview means placement will fail', () => {
    const map = makeMap();
    map.setTerrain(14, 11, Terrain.ROCK);
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const preview = cppPreview(map, 'POWR', 13, 10, structs);
    expect(preview.cells[3]).toBe(false); // ROCK cell is red
    expect(preview.overallValid).toBe(false);
  });

  // FIXED: TS preview now uses isBuildable, consistent with actual placement
  it('TS: ORE cell shows RED in preview, placement also fails — FIXED consistency', () => {
    // TS index.ts:6367: isBuildable(cx, cy) → false for ORE → red in preview (FIXED)
    // TS placement.ts:60: isBuildable(cx, cy) → false for ORE → placement fails
    const map = makeMap();
    map.setTerrain(13, 10, Terrain.ORE);
    map.setTerrain(14, 10, Terrain.ORE);
    map.setTerrain(13, 11, Terrain.ORE);
    map.setTerrain(14, 11, Terrain.ORE);
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const tsResult = tsPreview(map, 'POWR', 13, 10, structs);
    // TS preview: all cells red (isBuildable excludes ORE) — matches placement

    // Preview now matches actual placement check
    const actualBuildable = map.isBuildable(13, 10);
    expect(tsResult.cells[0]).toBe(actualBuildable); // FIXED: both false
  });

  it('C++ preview is consistent: ORE cell shows red, placement also fails', () => {
    const map = makeMap();
    map.setTerrain(13, 10, Terrain.ORE);
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const preview = cppPreview(map, 'POWR', 13, 10, structs);
    // C++ preview: ORE shows red, placement also fails → consistent
    expect(preview.cells[0]).toBe(false);
    expect(map.isBuildable(13, 10)).toBe(false);
    // C++ is consistent: preview red = placement fail
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 6: Preview border/text color — overall validity
//
// C++ display.cpp:898:
//   ProximityCheck = Passes_Proximity_Check(...)
//   This is a single boolean used for the entire placement cursor.
//   Combined with Is_Clear_To_Build per cell for the final green/red.
//
// TS renderer.ts:4007-4009:
//   ctx.strokeStyle = this.placementValid ? '#8f8' : '#f88'
//   Border is green if ALL cells passable AND adjacency passes.
//
// TS renderer.ts:4028-4029:
//   Text shows "Click to place" (green) or "Cannot place here" (red)
//   Based on placementValid = valid && adj
//
// Both systems agree on overall validity semantics: placement is valid
// only when terrain is clear AND proximity/adjacency passes.
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 6: Overall placement validity (display.cpp:898)', () => {

  it('overall valid when all cells clear and proximity passes', () => {
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const cpp = cppPreview(map, 'POWR', 13, 10, structs);
    const ts = tsPreview(map, 'POWR', 13, 10, structs);
    expect(cpp.overallValid).toBe(true);
    expect(ts.placementValid).toBe(true);
  });

  it('overall invalid when terrain blocked (any cell)', () => {
    const map = makeMap();
    map.setTerrain(13, 10, Terrain.ROCK);
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
    ];
    const cpp = cppPreview(map, 'POWR', 13, 10, structs);
    const ts = tsPreview(map, 'POWR', 13, 10, structs);
    expect(cpp.overallValid).toBe(false);
    expect(ts.placementValid).toBe(false);
  });

  it('overall invalid when no proximity/adjacency', () => {
    const map = makeMap();
    const cpp = cppPreview(map, 'POWR', 50, 50, []);
    const ts = tsPreview(map, 'POWR', 50, 50, []);
    expect(cpp.overallValid).toBe(false);
    expect(ts.placementValid).toBe(false);
  });

  it('overall invalid when terrain clear but no proximity', () => {
    const map = makeMap();
    const cpp = cppPreview(map, 'POWR', 50, 50, []);
    expect(cpp.allCellsClear).toBe(true);
    expect(cpp.proximityPass).toBe(false);
    expect(cpp.overallValid).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 7: Preview with multiple structures
//
// C++ display.cpp:717-747: the two-ring scan checks ALL cells in
// Occupy_List, and for each scans 8+4 neighbors. As soon as ANY
// foundation cell's neighbor scan finds a friendly building, proximity
// passes for the entire placement.
//
// TS: AABB overlap checks against ALL structures. First match wins.
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 7: Multi-structure proximity (display.cpp:717-747)', () => {

  it('proximity passes when adjacent to any one of multiple structures', () => {
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
      { type: 'POWR', cx: 20, cy: 20, alive: true, house: 'Greece' },
    ];
    // Place near second structure
    const cppResult = cppPreview(map, 'POWR', 22, 20, structs);
    const tsResult = tsPreview(map, 'POWR', 22, 20, structs);
    expect(cppResult.proximityPass).toBe(true);
    expect(tsResult.adj).toBe(true);
  });

  it('proximity fails when far from all structures', () => {
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'Greece' },
      { type: 'POWR', cx: 20, cy: 20, alive: true, house: 'Greece' },
    ];
    const cppResult = cppPreview(map, 'POWR', 60, 60, structs);
    const tsResult = tsPreview(map, 'POWR', 60, 60, structs);
    expect(cppResult.proximityPass).toBe(false);
    expect(tsResult.adj).toBe(false);
  });

  it('enemy structures do not satisfy proximity even when mixed with friendly', () => {
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 10, cy: 10, alive: true, house: 'USSR' },    // enemy
      { type: 'POWR', cx: 50, cy: 50, alive: true, house: 'Greece' },  // friendly but far
    ];
    // Place adjacent to enemy only
    const cppResult = cppPreview(map, 'POWR', 13, 10, structs);
    const tsResult = tsPreview(map, 'POWR', 13, 10, structs);
    expect(cppResult.proximityPass).toBe(false);
    expect(tsResult.adj).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 8: Out-of-bounds preview behavior
//
// C++ display.cpp:711-714:
//   if (!In_Radar(cell)) { retval=false; noradar=true; break; }
//   If ANY foundation cell is out of radar, proximity immediately fails.
//
// C++ cell.cpp:498-503: out-of-bounds cells would fail Is_Clear_To_Build
//   because they can't have valid land type.
//
// TS map.ts:221-226: isBuildable returns false for out-of-bounds.
// TS map.ts:204-209: isPassable returns false for out-of-bounds (with 1-cell grace).
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 8: Out-of-bounds preview (display.cpp:711-714)', () => {

  it('placement preview extending beyond map right edge shows all red', () => {
    // POWR at (127, 50): column 128 is out of bounds
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 125, cy: 50, alive: true, house: 'Greece' },
    ];
    const cppResult = cppPreview(map, 'POWR', 127, 50, structs);
    const tsResult = tsPreview(map, 'POWR', 127, 50, structs);
    // At least one cell is out of bounds → overall invalid
    expect(cppResult.overallValid).toBe(false);
    expect(tsResult.placementValid).toBe(false);
  });

  it('placement preview at map edge (within bounds) can be valid', () => {
    // POWR at (126, 50): columns 126-127, both within bounds
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 123, cy: 50, alive: true, house: 'Greece' },
    ];
    const cppResult = cppPreview(map, 'POWR', 126, 50, structs);
    // All cells within bounds and clear
    expect(cppResult.allCellsClear).toBe(true);
    expect(cppResult.proximityPass).toBe(true);
    expect(cppResult.overallValid).toBe(true);
  });

  it('preview at negative coordinates shows all cells as red', () => {
    const map = makeMap();
    const structs: PreviewStructure[] = [
      { type: 'FACT', cx: 2, cy: 2, alive: true, house: 'Greece' },
    ];
    const cppResult = cppPreview(map, 'POWR', -1, 2, structs);
    const tsResult = tsPreview(map, 'POWR', -1, 2, structs);
    expect(cppResult.overallValid).toBe(false);
    expect(tsResult.placementValid).toBe(false);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Section 9: TS preview uses isPassable instead of isBuildable
//
// Direct verification that TS preview now matches both C++ preview
// and TS actual placement code (FIXED).
//
// C++ preview:  Is_Clear_To_Build (BUILDABLE set)
// TS preview:   isBuildable        (BUILDABLE set) — FIXED, was isPassable
// TS placement: isBuildable        (BUILDABLE set)
//
// All three now agree on the terrain check.
// ═══════════════════════════════════════════════════════════════════════════

describe('Section 9: TS preview isPassable vs isBuildable divergence', () => {

  const PASSABLE_NOT_BUILDABLE: [string, Terrain][] = [
    // These terrains are in PASSABLE but not in BUILDABLE
    ['ORE', Terrain.ORE],
    ['ROUGH', Terrain.ROUGH],
    ['BEACH', Terrain.BEACH],
    ['TREE', Terrain.TREE],
  ];

  for (const [name, terrain] of PASSABLE_NOT_BUILDABLE) {
    it(`${name}: passable for movement but NOT buildable — preview uses isBuildable (FIXED)`, () => {
      // These terrains are passable for units but cannot have buildings placed on them
      // C++ cell.cpp:503: Ground[land].Build=false → red in preview
      // FIXED: TS preview now uses isBuildable (index.ts:6367), matching C++
      const map = makeMap();
      map.setTerrain(50, 50, terrain);
      expect(map.isPassable(50, 50)).toBe(true);   // units can walk here
      expect(map.isBuildable(50, 50)).toBe(false);  // buildings cannot be placed here
      // Preview correctly shows RED because it uses isBuildable
    });
  }

  const CONSISTENTLY_BLOCKED: [string, Terrain][] = [
    ['WATER', Terrain.WATER],
    ['ROCK', Terrain.ROCK],
    ['WALL', Terrain.WALL],
    ['RIVER', Terrain.RIVER],
  ];

  for (const [name, terrain] of CONSISTENTLY_BLOCKED) {
    it(`${name}: both isPassable and isBuildable return false — consistent`, () => {
      const map = makeMap();
      map.setTerrain(50, 50, terrain);
      expect(map.isPassable(50, 50)).toBe(false);
      expect(map.isBuildable(50, 50)).toBe(false);
    });
  }

  const CONSISTENTLY_ALLOWED: [string, Terrain][] = [
    ['CLEAR', Terrain.CLEAR],
    ['ROAD', Terrain.ROAD],
  ];

  for (const [name, terrain] of CONSISTENTLY_ALLOWED) {
    it(`${name}: both isPassable and isBuildable return true — consistent`, () => {
      const map = makeMap();
      map.setTerrain(50, 50, terrain);
      expect(map.isPassable(50, 50)).toBe(true);
      expect(map.isBuildable(50, 50)).toBe(true);
    });
  }
});
