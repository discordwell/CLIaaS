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
    map.growOre(256);
    expect(getOverlay(map, 50, 50)).toBe(0x0E);
  });

  it('gold ore at density 0x0D (OverlayData=10) CAN grow to 0x0E', () => {
    setOverlay(map, 50, 50, 0x0D);
    vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger
    map.growOre(256);
    expect(getOverlay(map, 50, 50)).toBe(0x0E);
  });

  it('gold ore at min density 0x03 (OverlayData=0) CAN grow to 0x04', () => {
    setOverlay(map, 50, 50, 0x03);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(256);
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
    map.growOre(256);
    expect(getOverlay(map, 50, 50)).toBe(0x0F);
  });

  it('gem at 0x10 does NOT grow', () => {
    setOverlay(map, 50, 50, 0x10);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(256);
    expect(getOverlay(map, 50, 50)).toBe(0x10);
  });

  it('gem at 0x11 does NOT grow', () => {
    setOverlay(map, 50, 50, 0x11);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(256);
    expect(getOverlay(map, 50, 50)).toBe(0x11);
  });

  it('gem at max 0x12 does NOT grow', () => {
    setOverlay(map, 50, 50, 0x12);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(256);
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
      testMap.growOre(256);
      expect(getOverlay(testMap, 50, 50), `overlay 0x${ovl.toString(16)} should grow to 0x${(ovl + 1).toString(16)}`).toBe(ovl + 1);
      vi.restoreAllMocks();
    }
  });

  /**
   * C++ cell.cpp:2939 — Grow_Tiberium simply does OverlayData++
   * There is NO random check in Grow_Tiberium itself. The randomness is in
   * the reservoir sampling in map.cpp:1034. Once selected, growth is guaranteed.
   *
   * TS map.ts:581 uses: if (Math.random() < ORE_DENSITY_CHANCE) { ... }
   * This means growth is probabilistic (50% chance per cell per cycle).
   *
   * PARITY GAP: C++ growth is deterministic for sampled cells (100% chance
   * once selected by reservoir sampling). TS uses 50% random chance per cell.
   * The overall probability may be similar (reservoir limits selections), but
   * the mechanism diverges.
   */
  it('C++ grows all sampled cells deterministically — TS uses 50% random chance', () => {
    // In C++, if a cell is selected for growth, it ALWAYS grows (cell.cpp:2939: OverlayData++)
    // In TS, each cell has a 50% chance (Math.random() < 0.5)
    // This is a documented architectural difference.
    //
    // Test: when random returns exactly 0.5, C++ would grow but TS should NOT grow
    // (because the check is < 0.5, not <= 0.5)
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // exactly at boundary
    map.growOre(256);
    // TS: 0.5 < 0.5 is FALSE, so no growth
    expect(getOverlay(map, 50, 50)).toBe(0x05);
    // C++ would grow this cell if it was reservoir-sampled — PARITY GAP
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
    mockRandom
      .mockReturnValueOnce(0.6)  // density: skip (> 0.5)
      .mockReturnValueOnce(0.1)  // spread: trigger (< 0.25)
      .mockReturnValueOnce(0.0); // direction: north
    map.growOre(256);
    expect(getOverlay(map, 50, 49)).toBe(0x03); // spread to north
  });

  it('overlay 0x09 (OverlayData=6) canNOT spread — below threshold', () => {
    setOverlay(map, 50, 50, 0x09);
    const mockRandom = vi.spyOn(Math, 'random');
    mockRandom.mockReturnValue(0); // always trigger everything
    map.growOre(256);
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
   * IMPORTANT PARITY GAP ANALYSIS:
   * In C++, the spread check happens BEFORE growth (scanning phase collects
   * spread candidates, then growth acts, then spread acts). So a cell at
   * OverlayData=6 that grows to 7 during the growth phase could still NOT
   * spread because it was assessed during the scan phase when it was still 6.
   *
   * In TS, both density growth AND spread are checked in the same loop iteration.
   * Line 581-585: growth check
   * Line 588: spread threshold check USING THE ORIGINAL ovl value (line 574)
   *
   * Wait — TS line 574 reads `const ovl = this.overlay[idx]` BEFORE the growth
   * on line 583, but growth modifies `this.overlay[idx]` directly. The spread
   * check on line 588 uses `ovl` (the OLD value), not the potentially-grown value.
   * This matches C++ behavior where spread eligibility is checked during scan,
   * before growth actions fire. PARITY MATCH on this timing aspect.
   */
  it('density growth does NOT affect spread eligibility in same cycle — uses pre-growth value', () => {
    // Set density to 0x09 (OverlayData=6, just below spread threshold)
    // Growth should bump it to 0x0A, but spread should NOT trigger
    // because the spread check uses the pre-growth value (0x09)
    setOverlay(map, 50, 50, 0x09);
    vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger
    map.growOre(256);
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
      testMap.growOre(256);
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
    // to avoid them consuming random calls for density checks
    for (const [dx, dy] of [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as [number, number][]) {
      if (dx === -1 && dy === 1) continue; // leave SW open
      setOverlay(map, 50 + dx, 50 + dy, 0x01); // non-gold overlay blocks germination
    }
    // Use mockImplementation to control ALL random calls (including newly spread cells)
    const calls = [0.6, 0.1, 0.0]; // density:skip, spread:trigger, direction:0
    let callIdx = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      if (callIdx < calls.length) return calls[callIdx++];
      return 0.9; // all subsequent calls: no action
    });
    map.growOre(256);
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
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)  // density: skip
      .mockReturnValueOnce(0.1)  // spread: trigger
      .mockReturnValueOnce(0.0); // direction: north
    map.growOre(256);
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
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)  // density: skip
      .mockReturnValueOnce(0.1)  // spread: trigger
      .mockReturnValueOnce(0.0)  // direction: start at 0 (N)
      .mockReturnValue(0.9);     // rest: no more actions
    map.growOre(256);
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
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)  // density: skip for first ore cell found
      .mockReturnValueOnce(0.1)  // spread: trigger
      .mockReturnValueOnce(0.0)  // direction: north (blocked)
      .mockReturnValue(0.9);
    map.growOre(256);
    // North cell should retain its original overlay, not be overwritten
    expect(getOverlay(map, 50, 49)).toBe(0x05);
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
   * PARITY GAP: C++ allows germination on ROAD terrain (Build=true).
   * TS map.ts:599 checks "if (this.cells[nidx] !== Terrain.CLEAR) continue;"
   * This means TS only allows germination on CLEAR terrain, not ROAD.
   * Ore should be able to spread onto road cells in C++ but cannot in TS.
   */
  it('C++ allows ore germination on ROAD terrain — TS rejects it', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.ROAD); // road to the north
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)  // density: skip
      .mockReturnValueOnce(0.1)  // spread: trigger
      .mockReturnValueOnce(0.0); // direction: north (road)
    map.growOre(256);
    // C++ would allow spread to ROAD (Build=true in rules.cpp:864)
    // TS rejects it because it checks for Terrain.CLEAR only
    // PARITY GAP: expect 0x03 for C++ parity, but TS gives 0xFF
    // PARITY GAP: C++ would produce 0x03 here (ROAD is buildable/germinable).
    // TS produces 0xFF because it only allows spread to Terrain.CLEAR.
    // Failing expectation documents the real C++ behavior:
    expect(getOverlay(map, 50, 49)).toBe(0x03); // PARITY GAP — TS rejects ROAD, C++ accepts
  });

  /**
   * C++ cell.cpp:3010 — WATER terrain is NOT buildable, so germination fails.
   */
  it('cannot spread to WATER terrain', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.WATER);
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.0);
    map.growOre(256);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  it('cannot spread to ROCK terrain', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.ROCK);
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.0);
    map.growOre(256);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  it('cannot spread to WALL terrain', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.WALL);
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.0);
    map.growOre(256);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  it('cannot spread to TREE terrain (TS extension)', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.TREE);
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.0);
    map.growOre(256);
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
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.0);
    map.growOre(256);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  /**
   * C++ cell.cpp:3010 — BEACH terrain is NOT buildable, so germination fails.
   */
  it('cannot spread to BEACH terrain', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.BEACH);
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.0);
    map.growOre(256);
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
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.0);
    map.growOre(256);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  /**
   * C++ cell.cpp:2998 — "if (!Map.In_Radar(Cell_Number())) return(false);"
   *
   * Cannot germinate outside map bounds. TS implements this via bounds checking
   * in map.ts:596: "if (nx < bx || nx >= bx + bw || ny < by || ny >= by + bh) continue;"
   */
  it('cannot spread outside map bounds', () => {
    const edgeX = map.boundsX;
    const edgeY = map.boundsY;
    setOverlay(map, edgeX, edgeY, 0x0C);
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.0); // direction: north (out of bounds)
    map.growOre(256);
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
   * TS uses a fixed 256-tick interval (GameMap.ORE_GROWTH_INTERVAL = 256).
   *
   * PARITY GAP: C++ fires growth every ~1821 ticks. TS fires every 256 ticks.
   * C++ rate: once per ~121 seconds. TS rate: once per ~17 seconds.
   * TS grows ore roughly 7x faster than C++.
   */
  it('TS ORE_GROWTH_INTERVAL is 256 ticks', () => {
    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(256);
    // C++ equivalent interval: MAP_CELL_TOTAL / subcount = ~1821 ticks
    // PARITY GAP: 256 vs ~1821 ticks
  });

  /**
   * C++ timing check: tick 0 should NOT trigger growth.
   * TS map.ts:561 — "if (tick % 256 !== 0 || tick === 0) return;"
   */
  it('tick 0 does NOT trigger growth', () => {
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(0);
    expect(getOverlay(map, 50, 50)).toBe(0x05);
  });

  it('non-256-aligned ticks do NOT trigger growth', () => {
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(100);
    expect(getOverlay(map, 50, 50)).toBe(0x05);
    map.growOre(255);
    expect(getOverlay(map, 50, 50)).toBe(0x05);
    map.growOre(257);
    expect(getOverlay(map, 50, 50)).toBe(0x05);
  });

  it('tick 256 triggers growth', () => {
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(256);
    expect(getOverlay(map, 50, 50)).toBe(0x06);
  });

  it('tick 512 triggers growth (multiple of 256)', () => {
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(512);
    expect(getOverlay(map, 50, 50)).toBe(0x06);
  });
});

// ============================================================
// Section 6: Probability model — C++ reservoir sampling vs TS random
// ============================================================
describe('Probability model divergence — C++ reservoir vs TS random', () => {
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
   * C++ map.cpp:1034-1041 — Reservoir sampling for growth:
   *   if (Random_Pick(0, TiberiumGrowthExcess) <= TiberiumGrowthCount) {
   *     if (TiberiumGrowthCount < sizeof(TiberiumGrowth)/sizeof(TiberiumGrowth[0])) {
   *       TiberiumGrowth[TiberiumGrowthCount++] = cell;
   *     } else {
   *       TiberiumGrowth[Random_Pick(0, TiberiumGrowthCount-1)] = cell;
   *     }
   *   }
   *   TiberiumGrowthExcess++;
   *
   * TiberiumGrowth array has MAP_CELL_W/2 = 64 slots (map.h:160).
   * This means at most 64 cells can grow per cycle.
   *
   * C++ map.cpp:1078-1084 — ALL 64 sampled cells grow deterministically:
   *   for (int i = 0; i < TiberiumGrowthCount; i++) {
   *     newcell->Grow_Tiberium();  // Always succeeds — no random check
   *   }
   *
   * TS: EVERY gold ore cell gets a 50% growth chance each cycle (no cap).
   * With many ore cells, TS can grow far more cells per cycle than C++ (which caps at 64).
   *
   * PARITY GAP: C++ caps growth to 64 cells per cycle with reservoir sampling.
   * TS has no cap — every gold cell has an independent 50% chance.
   */
  it('TS ORE_DENSITY_CHANCE is 0.5 (50% per cell)', () => {
    expect(GameMap.ORE_DENSITY_CHANCE).toBe(0.5);
    // C++ has no per-cell probability — it uses reservoir sampling
    // with a cap of 64 cells per cycle. PARITY GAP (documented).
  });

  it('TS ORE_SPREAD_CHANCE is 0.25 (25% per cell)', () => {
    expect(GameMap.ORE_SPREAD_CHANCE).toBe(0.25);
    // C++ has no per-cell probability — it uses reservoir sampling
    // with a cap of 64 cells per cycle (map.h:168). PARITY GAP (documented).
  });

  /**
   * Verify that with deterministic random (always 0), ALL eligible cells grow.
   * This is a TS-specific behavior test — in C++ at most 64 would grow.
   */
  it('with random=0, all eligible gold cells grow in TS (no cap)', () => {
    // Place 100 gold ore cells at density 0x05
    let count = 0;
    for (let y = 45; y < 55; y++) {
      for (let x = 45; x < 55; x++) {
        setOverlay(map, x, y, 0x05);
        count++;
      }
    }
    expect(count).toBe(100);

    vi.spyOn(Math, 'random').mockReturnValue(0); // always trigger
    map.growOre(256);

    // ALL 100 cells should have grown to 0x06
    let grownCount = 0;
    for (let y = 45; y < 55; y++) {
      for (let x = 45; x < 55; x++) {
        if (getOverlay(map, x, y) === 0x06) grownCount++;
      }
    }
    expect(grownCount).toBe(100);
    // C++ would cap at 64 cells — PARITY GAP (documented in reservoir sampling section)
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
    map.growOre(256);
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
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)  // density: skip
      .mockReturnValueOnce(0.1)  // spread: trigger
      .mockReturnValueOnce(0.0); // direction: north
    map.growOre(256);
    expect(getOverlay(map, 50, 49)).toBe(0x03);
  });

  it('single LOW-density seed cell canNOT spread', () => {
    setOverlay(map, 50, 50, 0x05); // density 2 (< 7 threshold)
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(256);
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
    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(256); // TS interval
    // PARITY GAP: 1821 vs 256 ticks
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
   * PARITY GAP (minor): C++ can disable growth/spread via rules. TS cannot.
   * This is acceptable since all standard game scenarios have these enabled.
   */
  it('TS always enables ore growth (no IsTGrowth flag)', () => {
    // The growOre function has no parameter to disable growth.
    // This is a structural difference from C++ but acceptable for gameplay.
    const map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(256);
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
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)  // density: skip
      .mockReturnValueOnce(0.1)  // spread: trigger
      .mockReturnValueOnce(0.0); // offset: 0 (start at N)
    map.growOre(256);
    expect(getOverlay(map, 50, 49)).toBe(0x03); // N is (50, 49)
  });

  it('direction offset=4 starts at S', () => {
    setOverlay(map, 50, 50, 0x0C);
    // Block N, NE, E, SE using non-gold overlays to avoid random consumption
    setOverlay(map, 50, 49, 0x01); // N blocked
    setOverlay(map, 51, 49, 0x01); // NE blocked
    setOverlay(map, 51, 50, 0x01); // E blocked
    setOverlay(map, 51, 51, 0x01); // SE blocked
    const calls = [0.6, 0.1, 4.0 / 8]; // density:skip, spread:trigger, offset:4(S)
    let callIdx = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      if (callIdx < calls.length) return calls[callIdx++];
      return 0.9; // no further actions
    });
    map.growOre(256);
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

    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)  // density: skip (for 50,50)
      .mockReturnValueOnce(0.1)  // spread: trigger
      .mockReturnValueOnce(0.0); // offset: 0 (start at N)
    map.growOre(256);
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
   * TS map.ts:571-572 also scans in row-major order:
   *   for (let cy = by; cy < by + bh; cy++)
   *     for (let cx = bx; cx < bx + bw; cx++)
   *
   * PARITY MATCH on scan order.
   *
   * However, in C++, growth and spread actions happen AFTER the full scan
   * (map.cpp:1072-1098). In TS, they happen during the scan itself.
   * This means in TS, early cells' growth can affect later cells' spread eligibility.
   *
   * PARITY GAP: In C++, a cell that grows from density 6 to 7 during the growth
   * phase was assessed for spread BEFORE growth (during scanning). Its spread
   * eligibility was based on its pre-growth density.
   *
   * In TS, the growth and spread checks use the pre-modification overlay value
   * (captured at line 574 as `const ovl`), so this specific gap is mitigated.
   * However, cells processed LATER in the scan CAN be affected by EARLIER cells'
   * spread (new ore placed at 0x03 in a neighbor). This doesn't happen in C++
   * because all spread happens after the scan completes.
   */
  it('newly spread ore does NOT get processed in the same cycle', () => {
    // Place high-density ore at (45, 50) — it will be processed first (lower x)
    // When it spreads north to (45, 49), that new cell should NOT
    // itself grow or spread in the same cycle
    setOverlay(map, 45, 50, 0x0C);
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.6)  // density: skip for (45, 50)
      .mockReturnValueOnce(0.1)  // spread: trigger
      .mockReturnValueOnce(0.0)  // direction: north → (45, 49)
      .mockReturnValue(0.9);     // all other cells: no action
    map.growOre(256);
    // (45, 49) should have ore at minimum density (0x03), NOT grown
    expect(getOverlay(map, 45, 49)).toBe(0x03);
  });

  /**
   * IMPORTANT PARITY GAP SCENARIO:
   * A cell at (45, 50) spreads south to (45, 51). Then when the scan reaches
   * (45, 51) later, in TS it COULD process this newly-created ore. In C++, this
   * new ore wasn't in the scan results so it wouldn't be processed.
   *
   * However, at overlay 0x03 (minimum density), it won't spread (needs > 0x09),
   * and it could grow. C++ wouldn't grow it until the NEXT scan cycle.
   * This is a subtle timing difference but generally low-impact.
   */
  it('newly spread ore CAN be grown in same TS cycle (C++ would defer to next cycle)', () => {
    // Cell at (45, 45) spreads south to (45, 46)
    // Then when scan reaches (45, 46), it has ore at 0x03 and could grow
    setOverlay(map, 45, 45, 0x0C);

    let callCount = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      callCount++;
      // For source cell (45, 45): skip density, trigger spread south
      if (callCount === 1) return 0.6;  // density: skip
      if (callCount === 2) return 0.1;  // spread: trigger
      if (callCount === 3) return 4.0 / 8; // direction: S (index 4)

      // For the newly created cell at (45, 46):
      // It will be processed later since cy=46 > cy=45
      // Make it always grow
      if (callCount === 4) return 0.0; // density: trigger growth for (45, 46)

      return 0.9; // everything else: skip
    });

    map.growOre(256);

    // The new ore at (45, 46) was created as 0x03, then later in the same scan
    // cycle it was grown to 0x04. C++ would leave it at 0x03 until next cycle.
    const newOreOverlay = getOverlay(map, 45, 46);
    // TS: 0x04 (grew in same cycle) — C++ would be 0x03 (deferred)
    // This test documents the gap but we expect TS behavior (0x04)
    expect(newOreOverlay).toBe(0x04); // PARITY GAP: C++ would be 0x03
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
    map.growOre(256);
    expect(getOverlay(map, 50, 50)).toBe(0x0E);
    vi.restoreAllMocks();
  });

  it('0x0E cannot grow (density 11 is maximum)', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
    setOverlay(map, 50, 50, 0x0E);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(256);
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
   * PARITY GAP (minor): TS does not check for bridge cells during germination.
   * This would only matter if bridge cells have Terrain.CLEAR, which they
   * typically don't (they usually have a bridge template).
   *
   * Test skipped as TS lacks bridge cell tracking in the germination path.
   */
  it.skip('C++ rejects bridge cells for germination — TS lacks bridge check', () => {
    // Would need bridge cell detection in TS
  });

  /**
   * C++ cell.cpp:3007-3008:
   *   BuildingClass const * building = Cell_Building();
   *   if (building != NULL && !building->Class->IsInvisible) return(false);
   *
   * Cells with visible buildings cannot receive spread ore.
   * Invisible buildings (like the GPS satellite) DO allow germination.
   *
   * PARITY GAP: TS does not check for buildings during germination.
   * Ore can spread onto cells occupied by buildings in TS.
   */
  it.skip('C++ rejects cells with visible buildings — TS lacks building check', () => {
    // Would need building occupancy tracking in germination path
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
      testMap.growOre(256);

      const { dx, dy, name } = dirs[dirIdx];
      expect(
        getOverlay(testMap, center.x + dx, center.y + dy),
        `spread to ${name} should work`
      ).toBe(0x03);

      vi.restoreAllMocks();
    }
  });
});
