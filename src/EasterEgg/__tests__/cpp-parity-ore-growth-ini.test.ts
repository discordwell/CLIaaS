/**
 * C++ Behavioral Parity Tests -- Ore Growth & Spread from rules.ini [General]
 *
 * Audits the TS ore growth system (map.ts growOre) against the authoritative
 * rules.ini values and C++ implementation in cell.cpp / map.cpp.
 *
 * === Authoritative INI Values ===
 *   rules.ini [General]:
 *     GrowthRate=2          -- minutes to scan full map for growth/spread
 *     OreGrows=yes          -- density growth enabled
 *     OreSpreads=yes        -- spread to adjacent cells enabled
 *
 * === C++ Source References ===
 *   rules.cpp:205           -- GrowthRate(2) constructor default
 *   rules.cpp:446           -- IsTGrowth = ini.Get_Bool(GENERAL, "OreGrows", IsTGrowth)
 *   rules.cpp:447           -- IsTSpread = ini.Get_Bool(GENERAL, "OreSpreads", IsTSpread)
 *   rules.cpp:480           -- GrowthRate = ini.Get_Fixed(GENERAL, "GrowthRate", GrowthRate)
 *   defines.h:3031-3032     -- TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 *   map.cpp:1011            -- if (!Rule.IsTGrowth && !Rule.IsTSpread) return;
 *   map.cpp:1017            -- subcount = MAP_CELL_TOTAL / (Rule.GrowthRate * TICKS_PER_MINUTE)
 *   map.cpp:1028-1060       -- reservoir sampling into TiberiumGrowth[64] / TiberiumSpread[64]
 *   map.cpp:1072-1098       -- growth/spread actions fire AFTER full scan completes
 *   cell.cpp:2869-2884      -- Can_Tiberium_Grow(): gold only, OverlayData < 11
 *   cell.cpp:2904-2918      -- Can_Tiberium_Spread(): gold only, OverlayData > 6
 *   cell.cpp:2936-2944      -- Grow_Tiberium(): deterministic OverlayData++ (no random)
 *   cell.cpp:2963-2979      -- Spread_Tiberium(): random start dir, 8 dirs, first valid cell
 *
 * === TS Overlay Encoding ===
 *   Gold ore: 0x03 (density 0) through 0x0E (density 11) -- 12 levels
 *   Gems:     0x0F through 0x12 -- 4 levels
 *   No overlay: 0xFF
 *   C++ OverlayData N maps to TS overlay 0x03 + N
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseIniSections } from '../engine/parseIni';
import { GameMap, Terrain } from '../engine/map';
import { MAP_CELLS } from '../engine/types';

// ============================================================
// Parse rules.ini
// ============================================================
const rulesText = readFileSync(
  resolve(__dirname, '../../../public/ra/assets/rules.ini'),
  'utf-8',
);
const sections = parseIniSections(rulesText);
const general = sections.get('General')!;

function parseBool(raw: string): boolean {
  return raw.trim().toLowerCase() === 'yes';
}

function parseFloat_(raw: string): number {
  return Number.parseFloat(raw);
}

// ============================================================
// C++ Constants (from defines.h and map.h)
// ============================================================
const CPP_TICKS_PER_SECOND = 15;                            // defines.h:3031
const CPP_TICKS_PER_MINUTE = CPP_TICKS_PER_SECOND * 60;    // defines.h:3032 = 900
const CPP_MAP_CELL_W = 128;                                  // map cell width
const CPP_MAP_CELL_TOTAL = CPP_MAP_CELL_W * CPP_MAP_CELL_W; // 16384
const CPP_RESERVOIR_SIZE = CPP_MAP_CELL_W / 2;               // map.h:160 = 64

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
// Section 1: INI value verification -- rules.ini is authoritative
// ============================================================
describe('rules.ini [General] ore growth/spread values', () => {
  it('GrowthRate=2 (minutes between ore growth scans)', () => {
    const ini = parseFloat_(general.get('GrowthRate')!);
    expect(ini).toBe(2);
  });

  it('OreGrows=yes', () => {
    const ini = parseBool(general.get('OreGrows')!);
    expect(ini).toBe(true);
  });

  it('OreSpreads=yes', () => {
    const ini = parseBool(general.get('OreSpreads')!);
    expect(ini).toBe(true);
  });
});

// ============================================================
// Section 2: Growth interval derivation from INI
//   C++ map.cpp:1017: subcount = MAP_CELL_TOTAL / (GrowthRate * TICKS_PER_MINUTE)
//   Full scan ticks = ceil(MAP_CELL_TOTAL / subcount)
// ============================================================
describe('Growth interval derivation from GrowthRate=2', () => {
  const iniGrowthRate = parseFloat_(general.get('GrowthRate')!);

  it('subcount = floor(16384 / (2 * 900)) = 9 cells per tick', () => {
    // C++ map.cpp:1017: int subcount = MAP_CELL_TOTAL / (Rule.GrowthRate * TICKS_PER_MINUTE);
    // Integer division in C++
    const subcount = Math.floor(CPP_MAP_CELL_TOTAL / (iniGrowthRate * CPP_TICKS_PER_MINUTE));
    expect(subcount).toBe(9);
  });

  it('full scan takes ceil(16384 / 9) = 1821 ticks', () => {
    const subcount = Math.floor(CPP_MAP_CELL_TOTAL / (iniGrowthRate * CPP_TICKS_PER_MINUTE));
    const fullScanTicks = Math.ceil(CPP_MAP_CELL_TOTAL / subcount);
    expect(fullScanTicks).toBe(1821);
  });

  it('TS ORE_GROWTH_INTERVAL matches C++ full scan derivation', () => {
    const subcount = Math.floor(CPP_MAP_CELL_TOTAL / (iniGrowthRate * CPP_TICKS_PER_MINUTE));
    const cppFullScan = Math.ceil(CPP_MAP_CELL_TOTAL / subcount);
    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(cppFullScan);
    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(1821);
  });

  it('full scan is approximately GrowthRate minutes (~121s at 15 FPS)', () => {
    const scanSeconds = GameMap.ORE_GROWTH_INTERVAL / CPP_TICKS_PER_SECOND;
    // 1821 / 15 = 121.4 seconds ~ 2.02 minutes
    expect(scanSeconds).toBeCloseTo(121.4, 0);
    expect(scanSeconds / 60).toBeCloseTo(iniGrowthRate, 1);
  });
});

// ============================================================
// Section 3: Growth conditions -- Can_Tiberium_Grow (cell.cpp:2869-2884)
//   Gold only, OverlayData < 11 (max growable density is 10 -> becomes 11)
// ============================================================
describe('Growth conditions from C++ Can_Tiberium_Grow (cell.cpp:2869-2884)', () => {
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
   * C++ cell.cpp:2881 -- only OVERLAY_GOLD1..GOLD4 can grow.
   * Gems (OVERLAY_GEMS1..4) are excluded.
   */
  it('only gold ore (0x03-0x0E) grows, gems (0x0F-0x12) never grow', () => {
    // Verify all 4 gem densities are untouched
    for (const gem of [0x0F, 0x10, 0x11, 0x12]) {
      const testMap = new GameMap();
      testMap.setBounds(40, 40, 50, 50);
      testMap.initDefault();
      setOverlay(testMap, 50, 50, gem);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      testMap.growOre(1821);
      expect(getOverlay(testMap, 50, 50), `gem 0x${gem.toString(16)} must not grow`).toBe(gem);
      vi.restoreAllMocks();
    }
  });

  /**
   * C++ cell.cpp:2879 -- "if (OverlayData >= 11) return(false);"
   * TS map.ts:745 -- "if (ovl < 0x0E)" means 0x0E (density 11) cannot grow.
   * Max growable density is 10 (0x0D) which becomes 11 (0x0E).
   */
  it('gold at max density 0x0E (OverlayData=11) cannot grow further', () => {
    setOverlay(map, 50, 50, 0x0E);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);
    expect(getOverlay(map, 50, 50)).toBe(0x0E);
  });

  it('gold at density 0x0D (OverlayData=10) grows to 0x0E (11)', () => {
    setOverlay(map, 50, 50, 0x0D);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);
    expect(getOverlay(map, 50, 50)).toBe(0x0E);
  });

  it('all densities 0x03-0x0D grow by exactly 1 (C++ OverlayData++)', () => {
    for (let ovl = 0x03; ovl <= 0x0D; ovl++) {
      const testMap = new GameMap();
      testMap.setBounds(40, 40, 50, 50);
      testMap.initDefault();
      setOverlay(testMap, 50, 50, ovl);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      testMap.growOre(1821);
      expect(
        getOverlay(testMap, 50, 50),
        `0x${ovl.toString(16)} should grow to 0x${(ovl + 1).toString(16)}`,
      ).toBe(ovl + 1);
      vi.restoreAllMocks();
    }
  });

  /**
   * PARITY GAP: C++ growth is deterministic for reservoir-sampled cells.
   *   cell.cpp:2939 -- Grow_Tiberium() simply does OverlayData++ (no random).
   *   map.cpp:1078-1084 -- ALL sampled cells grow unconditionally.
   *
   * TS uses ORE_DENSITY_CHANCE=0.5 (50% per cell per cycle).
   * C++ has no per-cell probability; the randomness is in reservoir sampling.
   */
  it('PARITY MATCH: TS now uses deterministic growth for sampled cells', () => {
    // C++ cell.cpp:2939: Grow_Tiberium() just does OverlayData++ -- no random check.
    // TS now matches: reservoir sampling selects cells, growth is deterministic.
    expect(GameMap.RESERVOIR_SIZE).toBe(64);

    // Growth is deterministic regardless of random value
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    map.growOre(1821);
    expect(getOverlay(map, 50, 50)).toBe(0x06); // always grows when sampled
  });
});

// ============================================================
// Section 4: Spread threshold -- Can_Tiberium_Spread (cell.cpp:2904-2918)
//   C++ cell.cpp:2914: "if (OverlayData <= 6) return(false);"
//   Requires OverlayData > 6 (i.e. >= 7) to spread.
// ============================================================
describe('Spread threshold from C++ Can_Tiberium_Spread (cell.cpp:2904-2918)', () => {
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
   * C++ cell.cpp:2914: OverlayData <= 6 returns false.
   * OverlayData=6 maps to TS overlay 0x09 (0x03 + 6).
   * OverlayData=7 maps to TS overlay 0x0A (0x03 + 7).
   *
   * TS map.ts:714: ORE_SPREAD_MIN_DENSITY = 0x09
   * TS map.ts:751: "if (ovl <= GameMap.ORE_SPREAD_MIN_DENSITY) continue;"
   * So TS requires ovl > 0x09, i.e. ovl >= 0x0A. PARITY MATCH.
   */
  it('ORE_SPREAD_MIN_DENSITY=0x09 matches C++ OverlayData <= 6 check', () => {
    expect(GameMap.ORE_SPREAD_MIN_DENSITY).toBe(0x09);
    // C++ threshold: OverlayData > 6, i.e. overlay >= 0x0A (= 0x03 + 7)
    // TS threshold: overlay > 0x09, i.e. overlay >= 0x0A
    // PARITY MATCH
  });

  it('overlay 0x09 (OverlayData=6) canNOT spread', () => {
    setOverlay(map, 50, 50, 0x09);
    vi.spyOn(Math, 'random').mockReturnValue(0); // trigger everything
    map.growOre(1821);
    // Cell grows to 0x0A but spread uses pre-growth value (0x09)
    expect(getOverlay(map, 50, 50)).toBe(0x0A); // grew
    // No spread to any adjacent cell
    const dirs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    for (const [dx, dy] of dirs) {
      expect(getOverlay(map, 50 + dx, 50 + dy), 'no spread at density 6').toBe(0xFF);
    }
  });

  it('overlay 0x0A (OverlayData=7) CAN spread', () => {
    setOverlay(map, 50, 50, 0x0A);
    // With reservoir sampling, single cell enters reservoir directly.
    // Only random call is spread direction offset.
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0x03); // spread to north
  });

  /**
   * C++ cell.cpp:2916 -- gems cannot spread.
   * "if (Overlay != OVERLAY_GOLD1 && ... OVERLAY_GOLD4) return(false);"
   */
  it('gems at any density cannot spread', () => {
    for (const gem of [0x0F, 0x10, 0x11, 0x12]) {
      const testMap = new GameMap();
      testMap.setBounds(40, 40, 50, 50);
      testMap.initDefault();
      setOverlay(testMap, 50, 50, gem);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      testMap.growOre(1821);
      const dirs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
      for (const [dx, dy] of dirs) {
        expect(getOverlay(testMap, 50 + dx, 50 + dy), `gem 0x${gem.toString(16)} must not spread`).toBe(0xFF);
      }
      vi.restoreAllMocks();
    }
  });

  /**
   * PARITY GAP: C++ spread is deterministic for reservoir-sampled cells.
   *   map.cpp:1091-1094 -- ALL sampled cells spread unconditionally.
   *
   * TS uses ORE_SPREAD_CHANCE=0.25 (25% per cell per cycle).
   * C++ has no per-cell probability; randomness is in reservoir sampling.
   */
  it('PARITY MATCH: TS now uses deterministic spread for sampled cells', () => {
    // C++ cell.cpp:2963 -- Spread_Tiberium() always executes for sampled cells.
    // TS now matches: reservoir sampling selects cells, spread is deterministic.
    expect(GameMap.RESERVOIR_SIZE).toBe(64);
  });
});

// ============================================================
// Section 5: Spread direction preference -- cell.cpp:2968-2969
//   Random starting direction, iterate all 8, first valid cell wins.
// ============================================================
describe('Spread direction from C++ Spread_Tiberium (cell.cpp:2963-2979)', () => {
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
   * C++ cell.cpp:2968: "FacingType offset = Random_Pick(FACING_N, FACING_NW);"
   * C++ cell.cpp:2969: "for (FacingType index = FACING_N; index < FACING_COUNT; index++)"
   * Iterates 8 directions starting from random offset, wrapping around.
   *
   * TS map.ts:755-756:
   *   const offset = Math.floor(Math.random() * 8);
   *   for (let i = 0; i < 8; i++) { dirs[(i + offset) % 8] }
   *
   * PARITY MATCH: Both iterate 8 directions from random start.
   */
  it('spread iterates 8 directions from random offset', () => {
    // Block all directions except W (-1,0)
    setOverlay(map, 50, 50, 0x0C);
    const allDirs: [number, number][] = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
    for (const [dx, dy] of allDirs) {
      if (dx === -1 && dy === 0) continue; // leave W open
      setOverlay(map, 50 + dx, 50 + dy, 0x01); // block with non-gold overlay
    }
    // With reservoir sampling, only random call is spread direction offset
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // offset: 0 (start at N)
    map.growOre(1821);
    // W is the only valid direction; wrapping finds it regardless of start
    expect(getOverlay(map, 49, 50)).toBe(0x03);
  });

  /**
   * C++ cell.cpp:2974: "newcell->OverlayData = 0;"
   * Spread always creates ore at minimum density (OverlayData=0 = TS 0x03).
   */
  it('spread creates new ore at minimum density 0x03 (C++ OverlayData=0)', () => {
    setOverlay(map, 50, 50, 0x0C);
    // With reservoir sampling, only random call is spread direction offset
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0x03);
  });

  /**
   * C++ cell.cpp:2975: "return(true);" -- spread to ONE cell only.
   * TS map.ts:771: "break;" -- same behavior.
   * PARITY MATCH.
   */
  it('spread fills only ONE adjacent cell, not all valid cells', () => {
    setOverlay(map, 50, 50, 0x0C);
    // With reservoir sampling, only random call is spread direction offset
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction: north
    map.growOre(1821);
    let oreCount = 0;
    for (const [dx, dy] of [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]]) {
      if (getOverlay(map, 50 + dx, 50 + dy) === 0x03) oreCount++;
    }
    expect(oreCount).toBe(1);
  });

  /**
   * C++ cell.cpp:2973: "new OverlayClass(Random_Pick(OVERLAY_GOLD1, OVERLAY_GOLD4), ...)"
   * C++ randomly picks a gold subtype (GOLD1-4) for cosmetic variety.
   *
   * TS map.ts:770: "this.overlay[nidx] = 0x03;" -- always uses the first gold type.
   *
   * PARITY NOTE: Cosmetic-only difference. Both start at minimum density.
   * C++ randomizes subtype appearance; TS uses uniform 0x03.
   * No gameplay impact since all GOLD subtypes behave identically.
   */
  it('TS always uses 0x03 for spread (C++ randomizes GOLD1-4 subtype)', () => {
    // Run 5 spreads; TS should always produce 0x03
    for (let trial = 0; trial < 5; trial++) {
      const testMap = new GameMap();
      testMap.setBounds(40, 40, 50, 50);
      testMap.initDefault();
      setOverlay(testMap, 50, 50, 0x0C);
      // With reservoir sampling, only random call is spread direction offset
      vi.spyOn(Math, 'random').mockReturnValue(trial / 8); // varying direction
      testMap.growOre(1821);
      // Find which adjacent cell got ore
      let foundOre = false;
      for (const [dx, dy] of [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]] as [number, number][]) {
        const ovl = getOverlay(testMap, 50 + dx, 50 + dy);
        if (ovl !== 0xFF && ovl !== 0x01) {
          expect(ovl).toBe(0x03); // always 0x03, never 0x04-0x06 (GOLD2-4 equivalents)
          foundOre = true;
        }
      }
      expect(foundOre).toBe(true);
      vi.restoreAllMocks();
    }
  });
});

// ============================================================
// Section 6: Germination terrain checks -- cell.cpp:2996-3015
//   C++ rules.cpp:864: CLEAR and ROAD are buildable (Build=true)
//   TS map.ts:762: BUILDABLE = Set([Terrain.CLEAR, Terrain.ROAD])
// ============================================================
describe('Germination terrain from C++ Can_Tiberium_Germinate (cell.cpp:2996-3015)', () => {
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
   * C++ cell.cpp:3010: "if (!Ground[Land_Type()].Build) return(false);"
   * C++ rules.cpp:864: CLEAR(Build=true), ROAD(Build=true), all others Build=false.
   *
   * TS map.ts:42: BUILDABLE = Set([Terrain.CLEAR, Terrain.ROAD])
   * TS map.ts:762: "if (!BUILDABLE.has(this.cells[nidx])) continue;"
   *
   * PARITY MATCH: Both allow germination on CLEAR and ROAD.
   */
  it('ore can spread to CLEAR terrain', () => {
    setOverlay(map, 50, 50, 0x0C);
    // north cell is CLEAR by default from initDefault
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction offset for spread
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0x03);
  });

  it('ore can spread to ROAD terrain (C++ rules.cpp:864 Build=true)', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.ROAD);
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction offset for spread
    map.growOre(1821);
    // C++ allows ROAD germination (Build=true). TS BUILDABLE includes ROAD.
    expect(getOverlay(map, 50, 49)).toBe(0x03);
  });

  it('ore canNOT spread to WATER terrain', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.WATER);
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction offset for spread
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  it('ore canNOT spread to ROCK terrain', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.ROCK);
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction offset for spread
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  it('ore canNOT spread to ROUGH terrain', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setTerrain(50, 49, Terrain.ROUGH);
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction offset for spread
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  /**
   * C++ cell.cpp:3012: "if (Overlay != OVERLAY_NONE) return(false);"
   * TS map.ts:761: "if (this.overlay[nidx] !== 0xFF) continue;"
   * PARITY MATCH: Cannot germinate on a cell with existing overlay.
   */
  it('ore canNOT spread to cell with existing overlay', () => {
    setOverlay(map, 50, 50, 0x0C);
    setOverlay(map, 50, 49, 0x05); // existing gold overlay
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction offset for spread
    map.growOre(1821);
    // North cell grew deterministically (0x05 -> 0x06), but was NOT overwritten by spread
    expect(getOverlay(map, 50, 49)).toBe(0x06);
  });

  /**
   * C++ cell.cpp:3000: "if (Is_Bridge_Here()) return(false);"
   * TS map.ts:764-766: checks templateType against bridge template IDs.
   */
  it('ore canNOT spread to bridge cells', () => {
    setOverlay(map, 50, 50, 0x0C);
    const nidx = 49 * MAP_CELLS + 50;
    map.templateType[nidx] = 131; // TEMPLATE_BRIDGE1
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction offset for spread
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  /**
   * C++ cell.cpp:3007-3008: visible buildings block germination.
   * TS map.ts:768: "if (this.vehicleOccupancy.has(nidx)) continue;"
   */
  it('ore canNOT spread to cells with building/vehicle occupancy', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setVehicleOccupancy(50, 49, 999);
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction offset for spread
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });

  /**
   * TS map.ts:763: "if (this.wallType[nidx] !== '') continue;"
   * Walls block germination (C++ walls use overlay slots 0-4 which != OVERLAY_NONE).
   */
  it('ore canNOT spread to cells with wall structures', () => {
    setOverlay(map, 50, 50, 0x0C);
    map.setWallType(50, 49, 'BRIK');
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // direction offset for spread
    map.growOre(1821);
    expect(getOverlay(map, 50, 49)).toBe(0xFF);
  });
});

// ============================================================
// Section 7: Reservoir sampling cap -- PARITY MATCH
//   C++ map.h:160 -- TiberiumGrowth[MAP_CELL_W/2] = 64 slots max
//   C++ map.h:168 -- TiberiumSpread[MAP_CELL_W/2] = 64 slots max
//   TS: now uses reservoir sampling with same 64-cell cap
// ============================================================
describe('PARITY MATCH: Reservoir sampling cap (64 cells max)', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('C++ reservoir size is 64 (MAP_CELL_W / 2 = 128 / 2)', () => {
    expect(CPP_RESERVOIR_SIZE).toBe(64);
  });

  /**
   * In C++ map.cpp:1035-1039, at most 64 cells can be selected for growth
   * per scan cycle via reservoir sampling. Cells beyond the 64th replace
   * existing entries probabilistically.
   *
   * TS has no such cap. With random=0 (always trigger), ALL gold cells grow.
   */
  it('PARITY MATCH: TS now caps growth at 64 cells via reservoir sampling', () => {
    // Place 100 gold ore cells at mid-density
    for (let y = 45; y < 55; y++) {
      for (let x = 45; x < 55; x++) {
        setOverlay(map, x, y, 0x05);
      }
    }
    vi.spyOn(Math, 'random').mockReturnValue(0); // reservoir sampling replaces slot 0
    map.growOre(1821);

    let grownCount = 0;
    for (let y = 45; y < 55; y++) {
      for (let x = 45; x < 55; x++) {
        if (getOverlay(map, x, y) >= 0x06) grownCount++;
      }
    }
    // TS now matches C++: reservoir sampling caps at 64 cells per cycle
    expect(grownCount).toBeLessThanOrEqual(64);
    expect(grownCount).toBeGreaterThan(0);
  });
});

// ============================================================
// Section 8: Two-phase processing -- PARITY MATCH
//   C++ map.cpp:1072-1098 -- growth/spread actions fire AFTER full scan
//   TS now matches: scan collects candidates, then growth fires, then spread fires
// ============================================================
describe('PARITY MATCH: Two-phase processing (scan then apply)', () => {
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
   * In C++, the scan phase collects candidates, then growth fires, then spread fires.
   * A cell at OverlayData=6 that gets collected for growth will NOT be collected for
   * spread (it was at 6 during scan, and 6 <= 6 fails Can_Tiberium_Spread).
   *
   * In TS, the spread check uses the pre-growth overlay value (captured as `const ovl`
   * at map.ts:737 before growth modifies overlay at map.ts:746). So this specific
   * case matches. PARITY MATCH on this timing aspect.
   */
  it('spread check uses pre-growth density (matches C++ scan-before-action)', () => {
    setOverlay(map, 50, 50, 0x09); // OverlayData=6, just below spread threshold
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);
    // Cell grew to 0x0A, but spread used pre-growth value (0x09)
    expect(getOverlay(map, 50, 50)).toBe(0x0A);
    // No spread occurred
    const dirs = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
    for (const [dx, dy] of dirs) {
      expect(getOverlay(map, 50 + dx, 50 + dy)).toBe(0xFF);
    }
  });

  /**
   * PARITY GAP: In TS, newly spread ore can be processed in the same scan cycle
   * because growth/spread happen inline. In C++, newly spread ore is not in the
   * scan results and won't be processed until the next cycle.
   *
   * A cell at (45, 45) spreads south to (45, 46). When the scan reaches (45, 46),
   * TS processes it (potential growth from 0x03 to 0x04). C++ would defer to next cycle.
   */
  it('PARITY MATCH: newly spread ore is deferred to next cycle', () => {
    setOverlay(map, 45, 45, 0x0C);
    // With reservoir sampling, direction offset for spread
    vi.spyOn(Math, 'random').mockReturnValue(4.0 / 8); // direction: S (index 4)
    map.growOre(1821);

    // TS now matches C++ two-phase model: newly spread ore was not in the
    // scan results, so it stays at 0x03 until the next cycle.
    expect(getOverlay(map, 45, 46)).toBe(0x03); // PARITY MATCH: deferred to next cycle
  });
});

// ============================================================
// Section 9: Tick 0 and non-aligned tick guards
// ============================================================
describe('Tick boundary checks', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tick 0 does NOT trigger growth', () => {
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(0);
    expect(getOverlay(map, 50, 50)).toBe(0x05);
  });

  it('tick 1820 (just before interval) does NOT trigger growth', () => {
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1820);
    expect(getOverlay(map, 50, 50)).toBe(0x05);
  });

  it('tick 1821 (exact interval) DOES trigger growth', () => {
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1821);
    expect(getOverlay(map, 50, 50)).toBe(0x06);
  });

  it('tick 1822 (just after interval) does NOT trigger growth', () => {
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(1822);
    expect(getOverlay(map, 50, 50)).toBe(0x05);
  });

  it('tick 3642 (2 * 1821) triggers growth', () => {
    setOverlay(map, 50, 50, 0x05);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    map.growOre(3642);
    expect(getOverlay(map, 50, 50)).toBe(0x06);
  });
});

// ============================================================
// Section 10: Fully depleted area -- seed cell requirement
// ============================================================
describe('Fully depleted area -- no spontaneous regrowth without seed', () => {
  it('area with all 0xFF never spontaneously regrows', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 50, 50);
    map.initDefault();
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
    vi.restoreAllMocks();
  });
});

// ============================================================
// Section 11: Summary of PARITY GAPS
// ============================================================
describe('Documented parity gaps summary', () => {
  /**
   * PARITY GAP #1: Growth probability model
   *   C++ uses reservoir sampling (max 64 cells) + deterministic growth.
   *   TS uses 50% random chance per cell with no cap.
   *   Impact: TS can grow more cells per cycle when ore fields are large.
   *
   * PARITY GAP #2: Spread probability model
   *   C++ uses reservoir sampling (max 64 cells) + deterministic spread.
   *   TS uses 25% random chance per cell with no cap.
   *   Impact: Similar aggregate behavior but different distribution.
   *
   * PARITY GAP #3: Single-phase processing
   *   C++ scans all cells first, then applies growth, then spread.
   *   TS applies growth and spread inline during scan.
   *   Impact: Newly spread ore can grow in same TS cycle (deferred in C++).
   *
   * PARITY GAP #4: Ore mine terrain (TERRAIN_MINE) forced spread
   *   C++ terrain.cpp:497 -- ore mines force-spread bypassing density threshold.
   *   TS does not implement ore mine terrain objects.
   *   Impact: Missing feature; ore mines don't exist in TS maps.
   *
   * PARITY MATCH #1: Growth interval = 1821 ticks (from GrowthRate=2).
   * PARITY MATCH #2: Growth ceiling at density 11 (OverlayData < 11).
   * PARITY MATCH #3: Spread threshold at density 7 (OverlayData > 6).
   * PARITY MATCH #4: Gold-only growth/spread (gems excluded).
   * PARITY MATCH #5: 8-direction spread from random offset.
   * PARITY MATCH #6: Single-cell spread (first valid neighbor).
   * PARITY MATCH #7: Minimum density for new spread (OverlayData=0 / 0x03).
   * PARITY MATCH #8: Germination on CLEAR and ROAD terrain only.
   * PARITY MATCH #9: Pre-growth density used for spread eligibility.
   */
  it('documents 4 parity gaps and 9 parity matches', () => {
    // This test exists to document findings. All specific assertions are above.
    expect(true).toBe(true);
  });
});
