/**
 * C++ Behavioral Parity Tests — Ore Regrowth & Spread Probability Mechanics
 *
 * Tests the TS ore growth system in map.ts against the original C++ implementation
 * in cell.cpp and map.cpp. Each test section quotes the C++ source with line numbers.
 *
 * === C++ Architecture Overview ===
 *
 * The C++ ore system separates growth/spread into distinct phases:
 *
 *   1. SCANNING (map.cpp:1017-1066): Each tick, scan `MAP_CELL_TOTAL / (GrowthRate * TICKS_PER_MINUTE)`
 *      cells using reservoir sampling into fixed-size arrays:
 *        - TiberiumGrowth[MAP_CELL_W/2] (64 slots) for growable cells
 *        - TiberiumSpread[MAP_CELL_W/2] (64 slots) for spreadable cells
 *
 *   2. GROWTH ACTION (map.cpp:1078-1084): When full map scan completes,
 *      Grow_Tiberium() is called on ALL collected cells — no random chance per cell.
 *
 *   3. SPREAD ACTION (map.cpp:1091-1094): When full map scan completes,
 *      Spread_Tiberium() is called on ALL collected cells — no random chance per cell.
 *
 * Growth eligibility — CellClass::Can_Tiberium_Grow() (cell.cpp:2869-2884):
 *   - Rule.IsTGrowth must be true                     (line 2871)
 *   - Land_Type() must be LAND_TIBERIUM               (line 2877)
 *   - OverlayData must be < 12 (i.e., <= 11)          (line 2879: "OverlayData >= 11" → false)
 *     CORRECTION: line 2879 says `>= 11`, so max growable OverlayData is 10.
 *     After growth, OverlayData becomes 11 (max).
 *   - Overlay must be OVERLAY_GOLD1..GOLD4 (no gems)  (line 2881)
 *
 * Spread eligibility — CellClass::Can_Tiberium_Spread() (cell.cpp:2904-2918):
 *   - Rule.IsTSpread must be true                      (line 2906)
 *   - Land_Type() must be LAND_TIBERIUM                (line 2912)
 *   - OverlayData must be > 6                          (line 2914)
 *   - Overlay must be OVERLAY_GOLD1..GOLD4 (no gems)   (line 2916)
 *
 * Spread mechanism — CellClass::Spread_Tiberium() (cell.cpp:2963-2979):
 *   - Random starting direction from FACING_N..FACING_NW (8 dirs)   (line 2968)
 *   - Iterates all 8 directions from random offset                   (line 2969)
 *   - First cell passing Can_Tiberium_Germinate() receives ore       (line 2972)
 *   - New overlay = Random_Pick(OVERLAY_GOLD1, OVERLAY_GOLD4)        (line 2973)
 *   - New OverlayData = 0 (minimum density)                          (line 2974)
 *
 * Germination — CellClass::Can_Tiberium_Germinate() (cell.cpp:2996-3015):
 *   - Must be In_Radar (within map bounds)              (line 2998)
 *   - Must NOT be a bridge cell                         (line 3000)
 *   - Must NOT have a visible building                  (line 3007-3008)
 *   - Ground[Land_Type()].Build must be true            (line 3010)
 *     C++ rules.cpp:864 — CLEAR and ROAD are buildable
 *   - Overlay must be OVERLAY_NONE                      (line 3012)
 *
 * Growth rate constants (rules.cpp:205-206):
 *   - GrowthRate = 2 (minutes to scan full map for growth)
 *   - ShroudRate = 4 (minutes between shroud regrow — unrelated)
 *
 * Overlay constants (defines.h:1487-1494):
 *   OVERLAY_GOLD1 = 5  (enum value after 5 wall types: 0-4)
 *   OVERLAY_GOLD2 = 6
 *   OVERLAY_GOLD3 = 7
 *   OVERLAY_GOLD4 = 8
 *   OVERLAY_GEMS1 = 9
 *   OVERLAY_GEMS2 = 10
 *   OVERLAY_GEMS3 = 11
 *   OVERLAY_GEMS4 = 12
 *
 * TS overlay encoding (map.ts:532-535):
 *   Gold ore: 0x03-0x0E (12 density levels, single-byte)
 *   Gems:     0x0F-0x12 (4 density levels)
 *   No overlay: 0xFF
 *
 * C++ model: OverlayType (GOLD1-4) + OverlayData (0-11) = 4 subtypes x 12 densities
 * TS model:  Single byte 0x03-0x0E = 12 density levels (subtype collapsed)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GameMap, Terrain } from '../engine/map';
import { MAP_CELLS } from '../engine/types';

// ============================================================
// Helpers
// ============================================================
function getOverlay(map: GameMap, cx: number, cy: number): number {
  return map.overlay[cy * MAP_CELLS + cx];
}

function setOverlay(map: GameMap, cx: number, cy: number, val: number): void {
  map.overlay[cy * MAP_CELLS + cx] = val;
}

// ============================================================
// Section 1: Growth eligibility — Can_Tiberium_Grow() (cell.cpp:2869-2884)
// ============================================================
describe('Growth eligibility — Can_Tiberium_Grow (cell.cpp:2869-2884)', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * C++ cell.cpp:2879 — "if (OverlayData >= 11) return(false);"
   *
   * In C++, OverlayData ranges 0-11 (12 levels per GOLD subtype).
   * OverlayData of 10 can grow to 11. OverlayData of 11 cannot grow.
   *
   * TS maps this as overlay values 0x03 (density 0) to 0x0E (density 11).
   * So 0x0D (density 10) should be the highest that can grow (to 0x0E=11).
   * 0x0E (density 11) should NOT grow further.
   */
  it('gold ore at max density 0x0E (OverlayData=11) cannot grow further', () => {
    setOverlay(map, 50, 50, 0x0E);
    vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger
    map.growOre(1821);
    expect(getOverlay(map, 50, 50)).toBe(0x0E);
  });

  it('gold ore at density 0x0D (OverlayData=10) CAN grow to 0x0E', () => {
    setOverlay(map, 50, 50, 0x0D);
    vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger
    map.growOre(1821);
    expect(getOverlay(map, 50, 50)).toBe(0x0E);
  });

  it('gold ore at min density 0x03 (OverlayData=0) CAN grow to 0x04', () => {
    setOverlay(map, 50, 50, 0x03);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);
    expect(getOverlay(map, 50, 50)).toBe(0x04);
  });

  /**
   * C++ cell.cpp:2881 — gems (OVERLAY_GEMS1..4) are excluded from growth.
   * "if (Overlay != OVERLAY_GOLD1 && ... OVERLAY_GOLD4) return(false);"
   *
   * In TS: gems are 0x0F-0x12. They should never change via growOre.
   */
  it('gem at 0x0F does NOT grow — C++ excludes non-GOLD overlays', () => {
    setOverlay(map, 50, 50, 0x0F);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);
    expect(getOverlay(map, 50, 50)).toBe(0x0F);
  });

  it('gem at 0x10 does NOT grow', () => {
    setOverlay(map, 50, 50, 0x10);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);
    expect(getOverlay(map, 50, 50)).toBe(0x10);
  });

  it('gem at 0x11 does NOT grow', () => {
    setOverlay(map, 50, 50, 0x11);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);
    expect(getOverlay(map, 50, 50)).toBe(0x11);
  });

  it('gem at max 0x12 does NOT grow', () => {
    setOverlay(map, 50, 50, 0x12);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);
    expect(getOverlay(map, 50, 50)).toBe(0x12);
  });

  /**
   * C++ cell.cpp:2879 — the max density check uses OverlayData, NOT overlay type.
   * Each GOLD1-4 subtype has 12 density levels (0-11). The C++ check is:
   *   if (OverlayData >= 11) return false;
   *
   * This means density=10 is the last growable level.
   * After growth: density becomes 11 (the maximum).
   *
   * TS has densities 0x03-0x0E (12 levels). 0x0D is growable (becomes 0x0E).
   * This is consistent, but the C++ ceiling check `>= 11` means the growth
   * ceiling is at OverlayData=11. Let's verify the TS doesn't have an off-by-one.
   */
  it('growth increments by exactly 1 for each mid-range density', () => {
    for (let ovl = 0x03; ovl <= 0x0D; ovl++) {
      const testMap = new GameMap();
      testMap.setBounds(40, 40, 50, 50);
      testMap.initDefault();
      setOverlay(testMap, 50, 50, ovl);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      testMap.growOre(1821);
      expect(getOverlay(testMap, 50, 50), `overlay 0x${ovl.toString(16)} should grow to 0x${(ovl + 1).toString(16)}`).toBe(ovl + 1);
      vi.restoreAllMocks();
    }
  });

  /**
   * C++ cell.cpp:2939 — Grow_Tiberium simply does OverlayData++
   * There is NO random check in Grow_Tiberium itself. The randomness is in
   * the reservoir sampling in map.cpp:1034. Once selected, growth is guaranteed.
   *
   * TS now matches C++: reservoir sampling selects cells, then growth is
   * deterministic (OverlayData++ unconditionally for all sampled cells).
   *
   * PARITY MATCH: Both C++ and TS grow all sampled cells deterministically.
   */
  it('C++ grows all sampled cells deterministically — TS now matches', () => {
    // In C++, if a cell is selected for growth, it ALWAYS grows (cell.cpp:2939: OverlayData++)
    // TS now uses the same reservoir sampling model — no per-cell random chance.
    // A single eligible cell always gets sampled (reservoir has 64 slots).
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // random value doesn't affect growth
    map.growOre(1821);
    // TS now deterministically grows sampled cells, matching C++
    expect(getOverlay(map, 50, 50)).toBe(0x06);
  });
});

// ============================================================
// Section 2: Spread eligibility — Can_Tiberium_Spread() (cell.cpp:2904-2918)
// ============================================================
describe('Spread eligibility — Can_Tiberium_Spread (cell.cpp:2904-2918)', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * C++ cell.cpp:2914 — "if (OverlayData <= 6) return(false);"
   *
   * Spread requires OverlayData > 6, meaning OverlayData >= 7.
   * In TS overlay encoding: OverlayData=7 maps to overlay=0x0A (0x03 + 7).
   *
   * TS map.ts:551 — ORE_SPREAD_MIN_DENSITY = 0x09
   * TS map.ts:588 — "if (ovl <= ORE_SPREAD_MIN_DENSITY) continue;"
   * So TS requires ovl > 0x09, meaning ovl >= 0x0A.
   *
   * C++ requires OverlayData > 6, i.e., OverlayData >= 7.
   * OverlayData=7 → TS overlay = 0x03 + 7 = 0x0A.
   * So C++ threshold: overlay >= 0x0A. TS threshold: overlay >= 0x0A.
   * PARITY MATCH on the threshold value.
   */
  it('overlay 0x0A (OverlayData=7) CAN spread — threshold match', () => {
    setOverlay(map, 50, 50, 0x0A);
    const mockRandom = vi.spyOn(Math, 'random');
    // With reservoir sampling, single eligible cell goes directly into reservoir.
    // Only random call needed is the direction offset for spread.
    mockRandom.mockReturnValue(0.0); // direction: north (offset 0)
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0x03); // spread to north
  });

  it('overlay 0x09 (OverlayData=6) canNOT spread — below threshold', () => {
    setOverlay(map, 50, 50, 0x09);
    const mockRandom = vi.spyOn(Math, 'random');
    mockRandom.mockReturnValue(0); // always trigger everything
    map.growOre(1821);
    // Check all 8 adjacent cells — none should have ore
    const dirs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    for (const [dx, dy] of dirs) {
      // Note: density might have grown (0x09 -> 0x0A), but no spread should have occurred
      // because the spread check uses the ORIGINAL overlay value before growth
      expect(getOverlay(map, 50 + dx, 50 + dy), `no spread to (${50 + dx},${50 + dy})`).toBe(0xFF);
    }
  });

  /**
   * C++ cell.cpp:2914 — OverlayData <= 6 returns false.
   * Boundary: OverlayData=6 (overlay 0x09) → cannot spread.
   *           OverlayData=7 (overlay 0x0A) → can spread.
   *
   * PARITY MATCH on spread timing:
   * In C++, the spread check happens BEFORE growth (scanning phase collects
   * spread candidates, then growth acts, then spread acts). So a cell at
   * OverlayData=6 that grows to 7 during the growth phase could still NOT
   * spread because it was assessed during the scan phase when it was still 6.
   *
   * TS reads `const ovl = this.overlay[idx]` BEFORE the growth modification,
   * and the spread check uses `ovl` (the OLD value), not the potentially-grown
   * value. This matches C++ behavior where spread eligibility is checked during
   * scan, before growth actions fire.
   */
  it('density growth does NOT affect spread eligibility in same cycle — uses pre-growth value', () => {
    // Set density to 0x09 (OverlayData=6, just below spread threshold)
    // Growth should bump it to 0x0A, but spread should NOT trigger
    // because the spread check uses the pre-growth value (0x09)
    setOverlay(map, 50, 50, 0x09);
    vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger
    map.growOre(1821);
    // Cell should have grown to 0x0A
    expect(getOverlay(map, 50, 50)).toBe(0x0A);
    // But no spread should have occurred (0x09 <= 0x09)
    const dirs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    for (const [dx, dy] of dirs) {
      expect(getOverlay(map, 50 + dx, 50 + dy)).toBe(0xFF);
    }
  });

  /**
   * C++ cell.cpp:2916 — gems cannot spread.
   * "if (Overlay != OVERLAY_GOLD1 && ... OVERLAY_GOLD4) return(false);"
   */
  it('gems at any density cannot spread', () => {
    for (const gemOvl of [0x0F, 0x10, 0x11, 0x12]) {
      const testMap = new GameMap();
      testMap.setBounds(40, 40, 50, 50);
      testMap.initDefault();
      setOverlay(testMap, 50, 50, gemOvl);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      testMap.growOre(1821);
      // No adjacent cell should have any ore/gem
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          expect(getOverlay(testMap, 50 + dx, 50 + dy), `gem 0x${gemOvl.toString(16)} should not spread`).toBe(0xFF);
        }
      }
      vi.restoreAllMocks();
    }
  });
});

// ============================================================
// Section 3: Spread mechanism — Spread_Tiberium() (cell.cpp:2963-2979)
// ============================================================
describe('Spread mechanism — Spread_Tiberium (cell.cpp:2963-2979)', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * C++ cell.cpp:2968 — "FacingType offset = Random_Pick(FACING_N, FACING_NW);"
   * C++ cell.cpp:2969 — "for (FacingType index = FACING_N; index < FACING_COUNT; index++)"
   *
   * Spread picks a random starting direction and iterates all 8 directions.
   * It spreads to the FIRST valid cell it finds, then returns.
   *
   * TS map.ts:592-604 — Same mechanism: random offset, iterate 8 directions,
   * break on first valid spread. PARITY MATCH on direction iteration.
   */
  it('spread uses 8 directions including diagonals', () => {
    // Surround center with clear terrain, put ore in center at high density
    setOverlay(map, 50, 50, 0x0C); // high density gold
    // Block all directions except SW (-1, +1) using non-ore overlays (0x01)
    for (const [dx, dy] of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as [number, number][]) {
      if (dx === -1 && dy === 1) continue; // leave SW open
      setOverlay(map, 50 + dx, 50 + dy, 0x01); // non-gold overlay blocks germination
    }
    // With reservoir sampling, single cell goes directly into both reservoirs.
    // Growth is deterministic. Only random call is spread direction offset.
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction offset: 0 (start at N)
    map.growOre(1821);
    // SW cell (49, 51) should have new ore — N,NE,E,SE,S are blocked, SW is first valid
    expect(getOverlay(map, 49, 51)).toBe(0x03);
  });

  /**
   * C++ cell.cpp:2973-2974:
   *   new OverlayClass(Random_Pick(OVERLAY_GOLD1, OVERLAY_GOLD4), newcell->Cell_Number());
   *   newcell->OverlayData = 0;
   *
   * In C++, newly spread ore gets:
   *   - A random GOLD subtype (GOLD1-4) — purely cosmetic
   *   - OverlayData = 0 (minimum density)
   *
   * TS map.ts:602 always sets overlay = 0x03 (the first gold type).
   *
   * PARITY MATCH on density (both start at minimum).
   * Minor rendering difference: C++ randomizes GOLD1-4, TS always uses 0x03.
   * This is acceptable since the subtypes are cosmetic variations.
   */
  it('spread creates new ore at minimum density (0x03)', () => {
    setOverlay(map, 50, 50, 0x0C);
    // Reservoir sampling: single cell goes into both reservoirs directly.
    // Only random call is spread direction offset.
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north (offset 0)
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0x03); // minimum density
  });

  /**
   * C++ cell.cpp:2972 — "if (newcell != NULL && newcell->Can_Tiberium_Germinate())"
   * C++ cell.cpp:2975 — "return(true);" (only spread to ONE cell)
   *
   * Spread occurs to the first valid neighbor only, then stops.
   */
  it('spread only creates ore in ONE adjacent cell, not all valid cells', () => {
    setOverlay(map, 50, 50, 0x0C);
    // All 8 neighbors are clear — all valid for germination
    // Only random call is spread direction offset
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: start at 0 (N)
    map.growOre(1821);
    // Count how many neighbors got ore
    let oreCount = 0;
    for (const [dx, dy] of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]) {
      if (getOverlay(map, 50 + dx, 50 + dy) === 0x03) oreCount++;
    }
    expect(oreCount).toBe(1);
  });
});

// ============================================================
// Section 4: Germination checks — Can_Tiberium_Germinate() (cell.cpp:2996-3015)
// ============================================================
describe('Germination checks — Can_Tiberium_Germinate (cell.cpp:2996-3015)', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * C++ cell.cpp:3012 — "if (Overlay != OVERLAY_NONE) return(false);"
   *
   * Cannot germinate on a cell that already has an overlay.
   */
  it('cannot spread to cell with existing overlay', () => {
    setOverlay(map, 50, 50, 0x0C);
    setOverlay(map, 50, 49, 0x05); // existing ore to the north
    // With reservoir sampling, both cells are eligible for growth/spread.
    // Direction offset 0 = start at N for spread. North is blocked (existing overlay).
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north (blocked)
    map.growOre(1821);
    // North cell should retain its original overlay (grew from 0x05 to 0x06), not be overwritten
    expect(getOverlay(map, 50, 49)).toBe(0x06);
  });

  /**
   * C++ cell.cpp:3010 — "if (!Ground[Land_Type()].Build) return(false);"
   *
   * In C++ rules.cpp:864, the buildable land types are determined by the
   * [LandType] sections in RULES.INI. By default:
   *   - LAND_CLEAR: Build=true  (rules.cpp:858, Clear section)
   *   - LAND_ROAD:  Build=true  (rules.cpp:858, Road section)
   *   - LAND_WATER: Build=false
   *   - LAND_ROCK:  Build=false
   *   - LAND_WALL:  Build=false
   *   - LAND_TIBERIUM: Build=false (ore terrain itself isn't buildable)
   *   - LAND_BEACH: Build=false
   *   - LAND_ROUGH: Build=false
   *   - LAND_RIVER: Build=false
   *
   * PARITY FIXED: TS map.ts:847 uses BUILDABLE set which includes both
   * CLEAR and ROAD terrain, matching C++ rules.cpp:864 Ground[land].Build.
   * Ore can spread onto road cells in both C++ and TS.
   */
  it('C++ allows ore germination on ROAD terrain — TS matches', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.ROAD); // road to the north
    // With reservoir sampling, single cell goes directly into reservoir.
    // Only random call is spread direction offset.
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north (road)
    map.growOre(1821);
    // C++ allows spread to ROAD (Build=true in rules.cpp:864)
    // TS uses BUILDABLE set which includes ROAD — PARITY MATCH
    expect(getOverlay(map, 50, 49)).toBe(0x03);
  });

  /**
   * C++ cell.cpp:3010 — WATER terrain is NOT buildable, so germination fails.
   */
  it('cannot spread to WATER terrain', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.WATER);
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  it('cannot spread to ROCK terrain', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.ROCK);
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  it('cannot spread to WALL terrain', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.WALL);
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  it('cannot spread to TREE terrain (TS extension)', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.TREE);
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  /**
   * C++ cell.cpp:3010 — ROUGH terrain is NOT buildable, so germination fails.
   *
   * TS map.ts:599 checks for Terrain.CLEAR, which already excludes ROUGH.
   * PARITY MATCH — both reject ROUGH.
   */
  it('cannot spread to ROUGH terrain', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.ROUGH);
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  /**
   * C++ cell.cpp:3010 — BEACH terrain is NOT buildable, so germination fails.
   */
  it('cannot spread to BEACH terrain', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.BEACH);
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  /**
   * TS map.ts:600 — "if (this.wallType[nidx] !== '') continue;"
   * This blocks spread to cells with wall structures, matching
   * C++ behavior where walls have a non-NONE overlay (wall overlays
   * are OVERLAY_SANDBAG_WALL through OVERLAY_WOOD_WALL).
   */
  it('cannot spread to cell with wall structure', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setWallType(50, 49, 'BRIK');
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  /**
   * C++ cell.cpp:2998 — "if (!Map.In_Radar(Cell_Number())) return(false);"
   *
   * Cannot germinate outside map bounds. TS implements this via bounds checking.
   */
  it('cannot spread outside map bounds', () => {
    const edgeX = map.boundsX;
    const edgeY = map.boundsY;
    setOverlay(map, edgeX, edgeY, 0x0C);
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north (out of bounds)
    map.growOre(1821);
    expect(getOverlay(map, edgeX, edgeY - 1)).toBe(0xFF);
  });
});

// ============================================================
// Section 5: Growth timing — map.cpp:1017-1072
// ============================================================
describe('Growth timing — map.cpp:1017-1072', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * C++ map.cpp:1017 — "int subcount = MAP_CELL_TOTAL / (Rule.GrowthRate * TICKS_PER_MINUTE);"
   *
   * MAP_CELL_TOTAL = 128*128 = 16384
   * GrowthRate = 2 (rules.cpp:205)
   * TICKS_PER_MINUTE = 15 * 60 = 900 (defines.h:3032)
   * subcount = 16384 / (2 * 900) = 16384 / 1800 = 9 cells per tick (integer division)
   *
   * Full scan takes 16384 / 9 = 1821 ticks to complete (~121 seconds = ~2 minutes).
   * Growth/spread actions fire ONCE per full scan completion (map.cpp:1072-1098).
   *
   * TS uses a fixed 1821-tick interval (GameMap.ORE_GROWTH_INTERVAL = 1821).
   *
   * PARITY MATCH: Both C++ and TS fire growth every ~1821 ticks (~121 seconds).
   */
  it('TS ORE_GROWTH_INTERVAL is 1821 ticks (C++ parity)', () => {
    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(1821);
    // C++ equivalent interval: MAP_CELL_TOTAL / subcount = ~1821 ticks
    // PARITY MATCH: both fire every ~1821 ticks
  });

  /**
   * C++ timing check: tick 0 should NOT trigger growth.
   * TS map.ts:561 — "if (tick % 1821 !== 0 || tick === 0) return;"
   */
  it('tick 0 does NOT trigger growth', () => {
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(0);
    expect(getOverlay(map, 50, 50)).toBe(0x05);
  });

  it('non-1821-aligned ticks do NOT trigger growth', () => {
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(100);
    expect(getOverlay(map, 50, 50)).toBe(0x05);
    map.growOre(1820);
    expect(getOverlay(map, 50, 50)).toBe(0x05);
    map.growOre(1822);
    expect(getOverlay(map, 50, 50)).toBe(0x05);
  });

  it('tick 1821 triggers growth', () => {
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);
    expect(getOverlay(map, 50, 50)).toBe(0x06);
  });

  it('tick 3642 triggers growth (multiple of 1821)', () => {
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(3642);
    expect(getOverlay(map, 50, 50)).toBe(0x06);
  });
});

// ============================================================
// Section 6: Reservoir sampling model — C++ parity (map.cpp:1028-1060)
// ============================================================
describe('Reservoir sampling model — C++ parity (map.cpp:1028-1060)', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * C++ map.h:160 — TiberiumGrowth[MAP_CELL_W/2] = 64 slots.
   * TS now matches: RESERVOIR_SIZE = 64.
   * PARITY MATCH: Both cap growth/spread to 64 cells per cycle.
   */
  it('TS RESERVOIR_SIZE is 64 (C++ MAP_CELL_W/2)', () => {
    expect(GameMap.RESERVOIR_SIZE).toBe(64);
  });

  /**
   * C++ map.cpp:1078-1084 — ALL sampled cells grow deterministically.
   * TS now matches: no per-cell random chance, all reservoir cells grow.
   */
  it('growth is deterministic for sampled cells (no per-cell random)', () => {
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    map.growOre(1821);
    // Even with high random value, growth is deterministic
    expect(getOverlay(map, 50, 50)).toBe(0x06);
  });

  /**
   * C++ map.cpp:1028-1060 — reservoir sampling caps at 64 cells.
   * With 100 eligible cells, only 64 should grow per cycle.
   * PARITY MATCH: Both C++ and TS now cap at 64.
   */
  it('with 100 eligible cells, at most 64 grow per cycle (reservoir cap)', () => {
    // Place 100 gold ore cells at density 0x05
    let count = 0;
    for (let y = 45; y < 55; y++) {
      for (let x = 45; x < 55; x++) {
        setOverlay(map, x, y, 0x05);
        count++;
      }
    }
    expect(count).toBe(100);

    vi.spyOn(Math, 'random').mockReturnValue(0); // reservoir sampling always replaces slot 0
    map.growOre(1821);

    // Count how many cells grew to 0x06
    let grownCount = 0;
    for (let y = 45; y < 55; y++) {
      for (let x = 45; x < 55; x++) {
        if (getOverlay(map, x, y) === 0x06) grownCount++;
      }
    }
    // Reservoir sampling caps at 64 cells — PARITY MATCH with C++
    expect(grownCount).toBeLessThanOrEqual(64);
    expect(grownCount).toBeGreaterThan(0);
  });

  /**
   * With fewer than 64 eligible cells, ALL grow (no sampling needed).
   */
  it('with fewer than 64 eligible cells, all grow', () => {
    // Place 30 gold ore cells
    let count = 0;
    for (let y = 45; y < 50; y++) {
      for (let x = 45; x < 51; x++) {
        setOverlay(map, x, y, 0x05);
        count++;
      }
    }
    expect(count).toBe(30);

    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);

    let grownCount = 0;
    for (let y = 45; y < 50; y++) {
      for (let x = 45; x < 51; x++) {
        if (getOverlay(map, x, y) === 0x06) grownCount++;
      }
    }
    expect(grownCount).toBe(30); // All 30 grow (< 64 cap)
  });
});

// ============================================================
// Section 7: Fully depleted areas — seed cell requirement
// ============================================================
describe('Fully depleted areas — seed cell requirement', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * C++ behavior: Grow_Tiberium and Spread_Tiberium both require existing ore.
   * Can_Tiberium_Grow: Land_Type() must be LAND_TIBERIUM (cell.cpp:2877)
   * Can_Tiberium_Spread: Land_Type() must be LAND_TIBERIUM (cell.cpp:2912)
   *
   * A cell only has LAND_TIBERIUM if it has a gold/gem overlay.
   * Fully depleted areas (all OVERLAY_NONE) have LAND_CLEAR, so they
   * can never spontaneously generate ore.
   */
  it('fully depleted area (all 0xFF) never regrows', () => {
    // 5x5 area all empty
    for (let y = 48; y <= 52; y++) {
      for (let x = 48; x <= 52; x++) {
        setOverlay(map, x, y, 0xFF);
      }
    }
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);
    for (let y = 48; y <= 52; y++) {
      for (let x = 48; x <= 52; x++) {
        expect(getOverlay(map, x, y)).toBe(0xFF);
      }
    }
  });

  /**
   * C++ behavior: A single seed cell CAN spread to neighbors.
   * Requires OverlayData > 6 for spread (cell.cpp:2914).
   */
  it('single high-density seed cell can spread outward', () => {
    setOverlay(map, 50, 50, 0x0C); // density 9 (> 6 threshold)
    // With reservoir sampling, single cell always enters reservoir.
    // Only random call is spread direction offset.
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0x03);
  });

  it('single LOW-density seed cell canNOT spread', () => {
    setOverlay(map, 50, 50, 0x05); // density 2 (< 7 threshold)
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);
    // Cell grows to 0x06 but no spread (density 2 < 7)
    expect(getOverlay(map, 50, 50)).toBe(0x06);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      expect(getOverlay(map, 50 + dx, 50 + dy)).toBe(0xFF);
    }
  });
});

// ============================================================
// Section 8: Growth rate constants — rules.cpp:205-206
// ============================================================
describe('Growth rate constants — rules.cpp:205-206', () => {
  /**
   * C++ rules.cpp:205 — GrowthRate(2)
   * Default growth rate is 2 (minutes to complete one full map scan).
   * Meaning it takes 2 * 900 = 1800 ticks to scan all 16384 cells.
   *
   * C++ rules.cpp:206 — ShroudRate(4)
   * Default shroud regrow rate is 4 minutes. (Unrelated to ore growth.)
   *
   * C++ rules.cpp:480 — GrowthRate is configurable via RULES.INI:
   *   GrowthRate = ini.Get_Fixed(GENERAL, "GrowthRate", GrowthRate);
   *
   * C++ rules.cpp:498 — ShroudRate is configurable:
   *   ShroudRate = ini.Get_Fixed(GENERAL, "ShroudRate", ShroudRate);
   *
   * TS does not expose a configurable growth rate — it's hardcoded to 256 ticks.
   */
  it('C++ GrowthRate default is 2 minutes (rules.cpp:205)', () => {
    // This is a documentation test. C++ uses GrowthRate=2 meaning
    // the full map is scanned in 2 minutes = 1800 ticks.
    // Full scan completes every ~1821 ticks (due to integer division rounding).
    // TS uses 256 ticks. These are not meant to be equal.
    const CPP_TICKS_PER_MINUTE = 15 * 60; // 900
    const CPP_MAP_CELLS_TOTAL = 128 * 128; // 16384
    const CPP_GROWTH_RATE = 2;
    const CPP_SUBCOUNT = Math.floor(CPP_MAP_CELLS_TOTAL / (CPP_GROWTH_RATE * CPP_TICKS_PER_MINUTE));
    const CPP_FULL_SCAN_TICKS = Math.ceil(CPP_MAP_CELLS_TOTAL / CPP_SUBCOUNT);

    expect(CPP_SUBCOUNT).toBe(9); // 16384 / 1800 = 9 cells/tick
    expect(CPP_FULL_SCAN_TICKS).toBe(1821); // 16384 / 9 rounded up
    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(1821); // TS interval matches C++
    // PARITY MATCH: both fire every ~1821 ticks
  });
});

// ============================================================
// Section 9: Overlay value encoding — defines.h:1481-1494
// ============================================================
describe('Overlay value encoding — defines.h:1481-1494', () => {
  /**
   * C++ defines.h:1481-1494:
   *   OVERLAY_NONE = -1  (int8_t)
   *   OVERLAY_SANDBAG_WALL = 0
   *   OVERLAY_CYCLONE_WALL = 1
   *   OVERLAY_BRICK_WALL = 2
   *   OVERLAY_BARBWIRE_WALL = 3
   *   OVERLAY_WOOD_WALL = 4
   *   OVERLAY_GOLD1 = 5
   *   OVERLAY_GOLD2 = 6
   *   OVERLAY_GOLD3 = 7
   *   OVERLAY_GOLD4 = 8
   *   OVERLAY_GEMS1 = 9
   *   OVERLAY_GEMS2 = 10
   *   OVERLAY_GEMS3 = 11
   *   OVERLAY_GEMS4 = 12
   *
   * C++ uses OverlayType (the enum above) + OverlayData (0-11 density per subtype).
   * Each GOLD subtype has 12 density frames.
   *
   * TS collapses this to a single byte:
   *   0x03-0x0E = gold ore (12 density levels)
   *   0x0F-0x12 = gems (4 density levels)
   *   0xFF = no overlay
   *
   * The C++ model has 4 gold subtypes (GOLD1-4) x 12 densities = 48 visual states.
   * TS collapses to 12 visual states for gold.
   *
   * For growth/spread mechanics, this compression doesn't affect observable behavior:
   * - Growth: OverlayData++ is equivalent to overlay++ in TS
   * - Spread: new cell gets OverlayData=0, which is overlay 0x03 in TS
   * - Max density: OverlayData=11 → overlay 0x0E in TS
   */
  it('TS gold ore range 0x03-0x0E has 12 density levels', () => {
    const goldMin = 0x03;
    const goldMax = 0x0E;
    const levels = goldMax - goldMin + 1;
    expect(levels).toBe(12);
  });

  it('TS gem range 0x0F-0x12 has 4 levels', () => {
    const gemMin = 0x0F;
    const gemMax = 0x12;
    const levels = gemMax - gemMin + 1;
    expect(levels).toBe(4);
  });

  it('TS uses 0xFF for no overlay, C++ uses -1 (OVERLAY_NONE)', () => {
    // TS: 0xFF stored in Uint8Array means 255 (unsigned)
    // C++: OVERLAY_NONE = -1 stored as int8_t (-1 unsigned = 0xFF in uint8)
    // Both represent "no overlay" — encoding difference but semantically equivalent
    const map = new GameMap();
    const idx = 50 * MAP_CELLS + 50;
    expect(map.overlay[idx]).toBe(0xFF);
  });
});

// ============================================================
// Section 10: IsTGrowth / IsTSpread flags — rules.cpp:195-196, 447-448
// ============================================================
describe('IsTGrowth / IsTSpread flags — rules.cpp:195-196', () => {
  /**
   * C++ rules.cpp:195-196:
   *   IsTGrowth(true),
   *   IsTSpread(true),
   *
   * These are checked at the top of Can_Tiberium_Grow and Can_Tiberium_Spread:
   *   cell.cpp:2871 — "if (!Rule.IsTGrowth) return(false);"
   *   cell.cpp:2906 — "if (!Rule.IsTSpread) return(false);"
   *
   * Additionally, map.cpp:1011 checks both before the scanning loop:
   *   "if (!Rule.IsTGrowth && !Rule.IsTSpread) return;"
   *
   * TS hardcodes growth as always enabled. There are no flags to disable it.
   *
   * BLOCKED (minor): C++ can disable growth/spread via IsTGrowth/IsTSpread rules.
   * TS hardcodes growth as always enabled. Acceptable since all standard game
   * scenarios have these enabled — no shipping mission uses the disable flags.
   */
  it('TS always enables ore growth (no IsTGrowth flag)', () => {
    // The growOre function has no parameter to disable growth.
    // This is a structural difference from C++ but acceptable for gameplay.
    const map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);
    expect(getOverlay(map, 50, 50)).toBe(0x06); // always grows
    vi.restoreAllMocks();
  });
});

// ============================================================
// Section 11: Direction wrapping and iteration order
// ============================================================
describe('Direction iteration — cell.cpp:2968-2969', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * C++ cell.cpp:2968-2969:
   *   FacingType offset = Random_Pick(FACING_N, FACING_NW);
   *   for (FacingType index = FACING_N; index < FACING_COUNT; index++) {
   *     CellClass * newcell = &Adjacent_Cell(index+offset);
   *
   * C++ FACING enum (defines.h:2943-2953):
   *   FACING_N=0, NE=1, E=2, SE=3, S=4, SW=5, W=6, NW=7
   *
   * The C++ code wraps around with (index+offset) mod 8 via the FacingType
   * arithmetic. It tries all 8 directions starting from a random offset.
   *
   * TS map.ts:566-569 dirs array:
   *   [0,-1]=N, [1,-1]=NE, [1,0]=E, [1,1]=SE,
   *   [0,1]=S, [-1,1]=SW, [-1,0]=W, [-1,-1]=NW
   *
   * TS map.ts:592-604:
   *   const offset = Math.floor(Math.random() * 8);
   *   for (let i = 0; i < 8; i++) {
   *     const [dx, dy] = dirs[(i + offset) % 8];
   *
   * PARITY MATCH: Both iterate 8 directions from a random starting point.
   */
  it('direction order matches C++ FACING enum', () => {
    // Test that spread with offset=0 goes N first
    setOverlay(map, 50, 50, 0x0C);
    // With reservoir sampling, only random call is spread direction offset
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // offset: 0 (start at N)
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0x03); // N is (50, 49)
  });

  it('direction offset=4 starts at S', () => {
    setOverlay(map, 50, 50, 0x0C);
    // Block N, NE, E, SE using non-gold overlays
    setOverlay(map, 50, 49, 0x01); // N blocked
    setOverlay(map, 51, 49, 0x01); // NE blocked
    setOverlay(map, 51, 50, 0x01); // E blocked
    setOverlay(map, 51, 51, 0x01); // SE blocked
    // With reservoir sampling, only random call is spread direction offset
    vi.spyOn(Math, 'random').mockReturnValue(4.0 / 8); // offset: 4 (S)
    map.growOre(1821);
    // S is (50, 51) — should be the first valid cell found with offset=4
    expect(getOverlay(map, 50, 51)).toBe(0x03);
  });

  it('wraps around to find valid cell after passing blocked directions', () => {
    setOverlay(map, 50, 50, 0x0C);
    // Block all directions except W (-1, 0) using non-gold overlays
    setOverlay(map, 50, 49, 0x01);  // N
    setOverlay(map, 51, 49, 0x01);  // NE
    setOverlay(map, 51, 50, 0x01);  // E
    setOverlay(map, 51, 51, 0x01);  // SE
    setOverlay(map, 50, 51, 0x01);  // S
    setOverlay(map, 49, 51, 0x01);  // SW
    // W (49, 50) left open
    setOverlay(map, 49, 49, 0x01);  // NW

    // With reservoir sampling, only random call is spread direction offset
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // offset: 0 (start at N)
    map.growOre(1821);
    // Only W is valid, so ore should spread there regardless of start direction
    expect(getOverlay(map, 49, 50)).toBe(0x03);
  });
});

// ============================================================
// Section 12: Multiple ore cells processing order
// ============================================================
describe('Multiple ore cells — processing order', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * C++ map.cpp:1020-1066 scans cells sequentially by CELL index (0 to MAP_CELL_TOTAL).
   * CELL index = y * MAP_CELL_W + x (row-major order).
   *
   * TS now matches C++ two-phase model:
   *   Phase 1: Scan all cells, collect eligible into growth/spread reservoirs
   *   Phase 2: Apply growth to all sampled cells, then apply spread to all sampled cells
   *
   * PARITY MATCH: Both C++ and TS apply growth/spread AFTER the full scan.
   * Newly spread ore is NOT in the scan results and won't be processed.
   */
  it('newly spread ore does NOT get processed in the same cycle', () => {
    // Place high-density ore at (45, 50) — during scan phase it is collected.
    // After scan, spread creates ore at (45, 49). That new cell was NOT scanned.
    setOverlay(map, 45, 50, 0x0C);
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north → (45, 49)
    map.growOre(1821);
    // (45, 49) should have ore at minimum density (0x03), NOT grown
    // C++ parity: newly spread ore is not in the reservoir, so it's deferred
    expect(getOverlay(map, 45, 49)).toBe(0x03);
  });

  /**
   * PARITY MATCH: With the two-phase model, newly spread ore is never
   * processed in the same cycle. The scan collects candidates first,
   * then growth/spread execute on the collected set.
   *
   * C++ map.cpp:1072-1098: growth fires, then spread fires.
   * Newly spread ore wasn't in the scan, so it's deferred to next cycle.
   */
  it('newly spread ore is deferred to next cycle — PARITY MATCH with C++', () => {
    // Cell at (45, 45) will be collected during scan, then spread south to (45, 46)
    setOverlay(map, 45, 45, 0x0C);
    vi.spyOn(Math, 'random').mockReturnValue(4.0 / 8); // direction: S (index 4)
    map.growOre(1821);

    // The new ore at (45, 46) was created during the spread phase.
    // Since it wasn't in the scan, it stays at 0x03 (not grown).
    // PARITY MATCH: C++ would also leave it at 0x03 until next cycle.
    expect(getOverlay(map, 45, 46)).toBe(0x03);
  });
});

// ============================================================
// Section 13: OverlayData max check — off-by-one analysis
// ============================================================
describe('OverlayData max check — cell.cpp:2879', () => {
  /**
   * C++ cell.cpp:2879 — "if (OverlayData >= 11) return(false);"
   *
   * This means:
   *   OverlayData=10: Can grow → becomes 11 (cell.cpp:2939: OverlayData++)
   *   OverlayData=11: Cannot grow (11 >= 11 is true)
   *   OverlayData=12+: Cannot grow (would be invalid anyway)
   *
   * Maximum gold density is OverlayData=11 (the 12th level, 0-indexed).
   * 12 frames per GOLD subtype.
   *
   * TS map.ts:582: "if (ovl < 0x0E)"
   *   ovl=0x0D: Can grow → becomes 0x0E (0x0D < 0x0E is true)
   *   ovl=0x0E: Cannot grow (0x0E < 0x0E is false)
   *
   * TS gold range: 0x03 to 0x0E = 12 levels.
   * Growth from 0x0D (density 10) to 0x0E (density 11): allowed. ✓
   * Growth from 0x0E (density 11): blocked. ✓
   *
   * PARITY MATCH on the boundary check.
   */
  it('0x0D grows to 0x0E (density 10 → 11, C++ OverlayData: 10 → 11)', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
    setOverlay(map, 50, 50, 0x0D);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);
    expect(getOverlay(map, 50, 50)).toBe(0x0E);
    vi.restoreAllMocks();
  });

  it('0x0E cannot grow (density 11 is maximum)', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
    setOverlay(map, 50, 50, 0x0E);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);
    expect(getOverlay(map, 50, 50)).toBe(0x0E);
    vi.restoreAllMocks();
  });
});

// ============================================================
// Section 14: Terrain-mine spread — terrain.cpp:497-498
// ============================================================
describe('Terrain-mine forced spread — terrain.cpp:497-498', () => {
  /**
   * C++ terrain.cpp:497-498:
   *   if ((*this == TERRAIN_MINE) && (Frame % (Rule.GrowthRate * TICKS_PER_MINUTE)) == 0) {
   *     Map[::As_Cell(As_Target())].Spread_Tiberium(true);
   *   }
   *
   * Ore mine terrain objects (TERRAIN_MINE) force Spread_Tiberium(true) on their
   * cell periodically. The `forced=true` parameter bypasses Can_Tiberium_Spread()
   * (cell.cpp:2965-2967), meaning the mine can spread ore regardless of the cell's
   * current overlay density.
   *
   * TS does not implement ore mine terrain objects. This is a MISSING FEATURE,
   * not a parity gap in the growOre implementation itself.
   * Documenting for completeness.
   */
  it('TS does not implement ore mine terrain forcing — feature gap', () => {
    // This is a documentation test. The TS growOre function does not
    // have special handling for ore mine terrain objects.
    // C++ ore mines bypass the OverlayData > 6 spread check.
    expect(true).toBe(true);
  });
});

// ============================================================
// Section 15: Comprehensive spread → germination integration
// ============================================================
describe('Spread → germination integration', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * C++ cell.cpp:3000 — "if (Is_Bridge_Here()) return(false);"
   *
   * Bridge cells cannot receive spread ore. TS does not have a bridge check
   * in the spread logic — it only checks terrain type and wall type.
   *
   * PARITY FIXED: TS now checks templateType against bridge template IDs
   * (131, 133, 235, 236, 378, 379) during germination (map.ts:850-852).
   */
  it('C++ rejects bridge cells for germination — TS lacks bridge check', () => {
    // C++ cell.cpp:3000 — bridge cells cannot receive spread ore
    // TS now checks templateType against bridge template IDs (131, 133, 235, 236, 378, 379)
    setOverlay(map, 50, 50, 0x0C);
    // Set north cell to a bridge template but keep terrain as CLEAR
    const nidx = 49 * MAP_CELLS + 50;
    map.templateType[nidx] = 131; // TEMPLATE_BRIDGE1
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)  // density: skip
      .mockReturnValueOnce(0.1)  // spread: trigger
      .mockReturnValueOnce(0.0); // direction: north (bridge cell)
    map.growOre(1821);
    // Bridge cell should NOT receive ore
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  /**
   * C++ cell.cpp:3007-3008:
   *   BuildingClass const * building = Cell_Building();
   *   if (building != NULL && !building->Class->IsInvisible) return(false);
   *
   * Cells with visible buildings cannot receive spread ore.
   * Invisible buildings (like the GPS satellite) DO allow germination.
   *
   * PARITY FIXED: TS now checks vehicleOccupancy during germination (map.ts:854).
   * Building footprint cells are marked as vehicle-occupied and rejected.
   */
  it('C++ rejects cells with visible buildings — TS lacks building check', () => {
    // C++ cell.cpp:3007-3008 — cells with visible buildings cannot receive spread ore
    // TS now checks vehicleOccupancy (building footprint cells are marked as vehicle-occupied)
    setOverlay(map, 50, 50, 0x0C);
    // Mark north cell as occupied by a building (vehicle occupancy)
    map.setVehicleOccupancy(50, 49, 999); // entity ID 999 = a building
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)  // density: skip
      .mockReturnValueOnce(0.1)  // spread: trigger
      .mockReturnValueOnce(0.0); // direction: north (building cell)
    map.growOre(1821);
    // Building-occupied cell should NOT receive ore
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  it('all 8 directions can receive spread when valid', () => {
    // Place 8 separate high-density ore cells, each with only one clear neighbor
    const center = { x: 50, y: 50 };
    const dirs = [
      { dx: 0, dy: -1, name: 'N' },
      { dx: 1, dy: -1, name: 'NE' },
      { dx: 1, dy: 0, name: 'E' },
      { dx: 1, dy: 1, name: 'SE' },
      { dx: 0, dy: 1, name: 'S' },
      { dx: -1, dy: 1, name: 'SW' },
      { dx: -1, dy: 0, name: 'W' },
      { dx: -1, dy: -1, name: 'NW' },
    ];

    // Test each direction independently
    for (let dirIdx = 0; dirIdx < dirs.length; dirIdx++) {
      const testMap = new GameMap();
      testMap.setBounds(40, 40, 50, 50);
      testMap.initDefault();

      setOverlay(testMap, center.x, center.y, 0x0C);
      // Block all directions except the one we're testing with non-gold overlays
      for (let i = 0; i < dirs.length; i++) {
        if (i === dirIdx) continue;
        setOverlay(testMap, center.x + dirs[i].dx, center.y + dirs[i].dy, 0x01); // non-gold
      }

      const calls = [0.6, 0.1, 0.0]; // density:skip, spread:trigger, offset:0
      let callIdx = 0;
      vi.spyOn(Math, 'random').mockImplementation(() => {
        if (callIdx < calls.length) return calls[callIdx++];
        return 0.9; // no further actions on newly spread cells
      });
      testMap.growOre(1821);

      const { dx, dy, name } = dirs[dirIdx];
      expect(
        getOverlay(testMap, center.x + dx, center.y + dy),
        `spread to ${name} should work`
      ).toBe(0x03);

      vi.restoreAllMocks();
    }
  });
});
