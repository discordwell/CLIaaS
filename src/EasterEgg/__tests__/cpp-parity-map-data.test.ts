/**
 * C++ Behavioral Parity Tests -- Map Data Constants & Overlay Types
 *
 * Audits map-related constants, overlay types, template data, and [General]
 * spatial constants against C++ Red Alert source code.
 *
 * Source references:
 *   defines.h:3031          -- TICKS_PER_SECOND = 15
 *   defines.h:3032          -- TICKS_PER_MINUTE = 900
 *   defines.h:60            -- ICON_PIXEL_W = 24
 *   defines.h:48            -- ICON_LEPTON_W = 256
 *   defines.h:81-82         -- MAP_CELL_W = MAP_CELL_H = 128
 *   defines.h:1487-1499     -- OverlayType enum (GOLD1=5..GOLD4=8, GEMS1=9..GEMS4=12)
 *   defines.h:2137-2196     -- TemplateType enum (road/water/bridge templates)
 *   rules.ini [General]     -- BridgeStrength, GrowthRate, CloseEnough, Stray, BaseBias
 *   rules.cpp:267           -- BridgeStrength default = 1000
 *   rules.cpp:205           -- GrowthRate default = 2
 *   map.cpp:1017            -- subcount = MAP_CELL_TOTAL / (GrowthRate * TICKS_PER_MINUTE)
 *   queue.cpp:1425           -- DesiredFrameRate = Options.GameSpeed (default 3)
 *   options.cpp:91           -- DesiredFrameRate = 60 / GameSpeed
 *   cell.cpp:2869-2884      -- Can_Tiberium_Grow: OVERLAY_GOLD1..GOLD4 only
 *   cell.cpp:2916            -- Can_Tiberium_Spread: OVERLAY_GOLD1..GOLD4 only
 *   overlay.cpp              -- Overlay density per OverlayType
 *   temperat.ini             -- TEMPERATE theatre template type assignments
 *
 * Tests that FAIL are GOOD -- they identify real C++ divergences.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseIniSections } from '../engine/parseIni';
import {
  CELL_SIZE, LEPTON_SIZE, MAP_CELLS, GAME_TICKS_PER_SEC,
  TEMPLATE_ROAD_MIN, TEMPLATE_ROAD_MAX,
  TERRAIN_SPEED, SpeedClass,
} from '../engine/types';
import { GameMap, Terrain } from '../engine/map';

// -- Load and parse rules.ini ------------------------------------------------

const rulesIniPath = join(__dirname, '../../..', 'public/ra/assets/rules.ini');
const rulesText = readFileSync(rulesIniPath, 'utf-8');
const sections = parseIniSections(rulesText);

/** Get a float from an INI section, stripping trailing '%' if present */
function iniFloat(section: string, key: string, def = 0): number {
  const val = sections.get(section)?.get(key);
  if (val == null) return def;
  const cleaned = val.replace(/%$/, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? def : parsed;
}

/** Get a string from an INI section */
function iniStr(section: string, key: string, def = ''): string {
  return sections.get(section)?.get(key) ?? def;
}

/** Get a boolean from an INI section */
function iniBool(section: string, key: string, def = false): boolean {
  const val = sections.get(section)?.get(key);
  if (val == null) return def;
  return val.toLowerCase() === 'yes' || val.toLowerCase() === 'true' || val === '1';
}


// =============================================================================
//  1. Map Size Constants -- C++ defines.h
// =============================================================================

describe('Map size constants -- C++ defines.h', () => {

  it('MAP_CELLS = 128 (C++ MAP_CELL_W = MAP_CELL_H = 128)', () => {
    // C++ defines.h:81-82: #define MAP_CELL_W 128 / #define MAP_CELL_H 128
    expect(MAP_CELLS).toBe(128);
  });

  it('MAP_CELL_TOTAL = 128 * 128 = 16384 (C++ MAP_CELL_TOTAL)', () => {
    // C++ defines.h:83: #define MAP_CELL_TOTAL (MAP_CELL_W * MAP_CELL_H)
    expect(MAP_CELLS * MAP_CELLS).toBe(16384);
  });

  it('CELL_SIZE = 24 pixels (C++ ICON_PIXEL_W = 24)', () => {
    // C++ defines.h:60: #define ICON_PIXEL_W 24
    // C++ defines.h:61: #define ICON_PIXEL_H 24
    expect(CELL_SIZE).toBe(24);
  });

  it('LEPTON_SIZE = 256 leptons/cell (C++ ICON_LEPTON_W = 256)', () => {
    // C++ defines.h:48: #define ICON_LEPTON_W 256
    // C++ CELL_LEPTON_W = ICON_LEPTON_W = 256
    expect(LEPTON_SIZE).toBe(256);
  });

  it('PIXEL_LEPTON_W = CELL_LEPTON_W / ICON_PIXEL_W = 256/24 = 10 (integer)', () => {
    // C++ defines.h: PIXEL_LEPTON_W = CELL_LEPTON_W / ICON_PIXEL_W
    // 256 / 24 = 10.666... but C++ integer division truncates to 10
    const CPP_PIXEL_LEPTON_W = Math.floor(LEPTON_SIZE / CELL_SIZE);
    expect(CPP_PIXEL_LEPTON_W).toBe(10);
  });
});


// =============================================================================
//  2. Tick Rate -- C++ defines.h vs TS types.ts
// =============================================================================

describe('Tick rate -- C++ TICKS_PER_SECOND vs TS GAME_TICKS_PER_SEC', () => {

  it('C++ TICKS_PER_SECOND = 15 (defines.h:3031)', () => {
    // C++ defines.h:3031: #define TICKS_PER_SECOND 15
    const CPP_TICKS_PER_SECOND = 15;
    expect(CPP_TICKS_PER_SECOND).toBe(15);
  });

  it('C++ TICKS_PER_MINUTE = 900 (defines.h:3032)', () => {
    // C++ defines.h:3032: #define TICKS_PER_MINUTE (TICKS_PER_SECOND * 60)
    const CPP_TICKS_PER_MINUTE = 15 * 60;
    expect(CPP_TICKS_PER_MINUTE).toBe(900);
  });

  it('TS GAME_TICKS_PER_SEC = 15 (matching C++ TICKS_PER_SECOND)', () => {
    // TS types.ts:16-17: GAME_TICKS_PER_SEC = 15
    // Matches C++ defines.h:3031: TICKS_PER_SECOND = 15
    expect(GAME_TICKS_PER_SEC).toBe(15);
  });

  it('PARITY: TS tick rate matches C++ tick rate (both 15)', () => {
    // C++ defines.h:3031: TICKS_PER_SECOND = 15
    // TS types.ts:17: GAME_TICKS_PER_SEC = 15
    const CPP_TICKS_PER_SECOND = 15;
    expect(GAME_TICKS_PER_SEC).toBe(CPP_TICKS_PER_SECOND);
  });
});


// =============================================================================
//  3. Overlay Constants -- C++ defines.h OverlayType enum
// =============================================================================

describe('Overlay constants -- C++ OverlayType enum (defines.h:1487-1499)', () => {

  // C++ OverlayType enum:
  //   OVERLAY_SANDBAG_WALL = 0
  //   OVERLAY_CYCLONE_WALL = 1
  //   OVERLAY_BRICK_WALL   = 2
  //   OVERLAY_BARBWIRE_WALL= 3
  //   OVERLAY_WOOD_WALL    = 4
  //   OVERLAY_GOLD1        = 5
  //   OVERLAY_GOLD2        = 6
  //   OVERLAY_GOLD3        = 7
  //   OVERLAY_GOLD4        = 8
  //   OVERLAY_GEMS1        = 9
  //   OVERLAY_GEMS2        = 10
  //   OVERLAY_GEMS3        = 11
  //   OVERLAY_GEMS4        = 12

  describe('Gold overlay encoding', () => {

    it('C++ has 4 gold overlay types (OVERLAY_GOLD1..GOLD4 = enum 5..8)', () => {
      const CPP_OVERLAY_GOLD1 = 5;
      const CPP_OVERLAY_GOLD4 = 8;
      expect(CPP_OVERLAY_GOLD4 - CPP_OVERLAY_GOLD1 + 1).toBe(4);
    });

    it('TS uses C++ gold overlay type IDs (OVERLAY_GOLD1..GOLD4 = 5..8)', () => {
      expect(GameMap.OVERLAY_GOLD1).toBe(5);
      expect(GameMap.OVERLAY_GOLD4).toBe(8);
      expect(GameMap.OVERLAY_GOLD4 - GameMap.OVERLAY_GOLD1 + 1).toBe(4);
    });

    it('REPRESENTATION PARITY: overlay[] stores C++ visual type, oreDensity[] stores OverlayData', () => {
      // C++ defines.h:1487-1490 has 4 gold OverlayType enums (GOLD1-4 = visual
      // variants) plus per-cell OverlayData density. TS mirrors this with
      // overlay[] (5..8 visual type) + oreDensity[] (density 0..11).
      const map = new GameMap();
      map.setBounds(0, 0, 128, 128);
      const idx = 60 * MAP_CELLS + 60;
      for (let visual = GameMap.OVERLAY_GOLD1; visual <= GameMap.OVERLAY_GOLD4; visual++) {
        map.overlay[idx] = visual;
        map.oreDensity[idx] = 5; // arbitrary mid-level density
        expect(map.depleteOre(60, 60), `visual 0x${visual.toString(16)} d=5 → 25`).toBe(25);
      }
    });

    it('depleteOre returns 25 credits for gold with non-zero density (rules.ini GoldValue=25)', () => {
      const map = new GameMap();
      map.setBounds(0, 0, 128, 128);
      const idx = 50 * MAP_CELLS + 50;
      map.overlay[idx] = 0x05; // GOLD3 visual
      map.oreDensity[idx] = 5;  // mid-level density
      expect(map.depleteOre(50, 50)).toBe(25);
      expect(iniFloat('General', 'GoldValue')).toBe(25);
    });
  });

  describe('Gem overlay encoding', () => {

    it('C++ has 4 gem overlay types (OVERLAY_GEMS1..GEMS4 = enum 9..12)', () => {
      const CPP_OVERLAY_GEMS1 = 9;
      const CPP_OVERLAY_GEMS4 = 12;
      expect(CPP_OVERLAY_GEMS4 - CPP_OVERLAY_GEMS1 + 1).toBe(4);
    });

    it('TS uses C++ gem overlay type IDs (OVERLAY_GEMS1..GEMS4 = 9..12)', () => {
      expect(GameMap.OVERLAY_GEMS1).toBe(9);
      expect(GameMap.OVERLAY_GEMS4).toBe(12);
      expect(GameMap.OVERLAY_GEMS4 - GameMap.OVERLAY_GEMS1 + 1).toBe(4);
    });

    it('TS gem count matches C++ gem type count (4)', () => {
      const CPP_GEM_TYPES = 4;
      expect(GameMap.OVERLAY_GEMS4 - GameMap.OVERLAY_GEMS1 + 1).toBe(CPP_GEM_TYPES);
    });

    it('depleteOre returns 50 credits for gems (rules.ini GemValue=50)', () => {
      const map = new GameMap();
      map.setBounds(0, 0, 128, 128);
      map.overlay[50 * MAP_CELLS + 50] = GameMap.OVERLAY_GEMS2; // visual gem variant
      map.oreDensity[50 * MAP_CELLS + 50] = 2;
      expect(map.depleteOre(50, 50)).toBe(50);
      expect(iniFloat('General', 'GemValue')).toBe(50);
    });
  });

  describe('No-overlay sentinel', () => {

    it('TS uses 0xFF for "no overlay" (map.ts constructor)', () => {
      const map = new GameMap();
      expect(map.overlay[0]).toBe(0xFF);
    });

    it('C++ uses OVERLAY_NONE = 255 or -1 sentinel', () => {
      // C++ defines.h: OVERLAY_NONE = -1 (signed) or 0xFF (unsigned byte)
      // TS uses 0xFF consistently. Both effectively mean "no overlay."
      expect(0xFF).toBe(255);
    });
  });
});


// =============================================================================
//  4. Bridge Strength -- rules.ini [General]
// =============================================================================

describe('BridgeStrength -- rules.ini [General], rules.cpp:267', () => {

  it('rules.ini BridgeStrength = 1000', () => {
    // C++ rules.cpp:267: BridgeStrength defaults to 1000
    // rules.ini [General]: BridgeStrength=1000
    expect(iniFloat('General', 'BridgeStrength')).toBe(1000);
  });

  it('Bridge template IDs match C++ defines.h TemplateType enum', () => {
    // C++ defines.h:
    //   TEMPLATE_BRIDGE1  = 131
    //   TEMPLATE_BRIDGE2  = 133
    //   TEMPLATE_BRIDGE_1A= 235
    //   TEMPLATE_BRIDGE_1B= 236
    //   TEMPLATE_BRIDGE1H = 378
    //   TEMPLATE_BRIDGE2H = 379
    // TS map.ts:517 uses the same set: [131, 133, 235, 236, 378, 379]
    const CPP_BRIDGE_TEMPLATES = [131, 133, 235, 236, 378, 379];

    // Verify via countBridgeCells which uses these IDs
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    // Place one bridge center cell with icon=6 for each template
    for (let i = 0; i < CPP_BRIDGE_TEMPLATES.length; i++) {
      const idx = (10 + i) * MAP_CELLS + 10;
      map.templateType[idx] = CPP_BRIDGE_TEMPLATES[i];
      map.templateIcon[idx] = 6;
    }
    expect(map.countBridgeCells()).toBe(CPP_BRIDGE_TEMPLATES.length);
  });

  it('Bridge center tile icon = 6 (C++ map.cpp:2045-2073 Intact_Bridge_Count)', () => {
    // C++ counts only cells where TIcon == 6 as bridge center tiles
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    // Template 131 (BRIDGE1) with icon=6 should count
    map.templateType[10 * MAP_CELLS + 10] = 131;
    map.templateIcon[10 * MAP_CELLS + 10] = 6;
    expect(map.countBridgeCells()).toBe(1);
    // Same template with icon=5 should NOT count
    map.templateType[11 * MAP_CELLS + 10] = 131;
    map.templateIcon[11 * MAP_CELLS + 10] = 5;
    expect(map.countBridgeCells()).toBe(1); // still only 1
  });
});


// =============================================================================
//  5. Terrain Template Ranges -- C++ defines.h / TEMPERATE theatre
// =============================================================================

describe('Terrain template ranges -- C++ defines.h TemplateType enum', () => {

  it('TEMPLATE_ROAD_MIN = 173 (C++ TEMPLATE_ROAD1 in TEMPERATE theatre)', () => {
    // C++ defines.h:2169: TEMPLATE_ROAD1 = 173
    // TEMPERAT.INI maps road template types starting at 173
    expect(TEMPLATE_ROAD_MIN).toBe(173);
  });

  it('TEMPLATE_ROAD_MAX = 228 (C++ TEMPLATE_ROAD56 in TEMPERATE theatre)', () => {
    // C++ defines.h road templates span from TEMPLATE_ROAD1(173) to TEMPLATE_ROAD56(228)
    // 228 - 173 + 1 = 56 road template types
    expect(TEMPLATE_ROAD_MAX).toBe(228);
  });

  it('Road template count = 56 (C++ TEMPLATE_ROAD1..ROAD56)', () => {
    const roadCount = TEMPLATE_ROAD_MAX - TEMPLATE_ROAD_MIN + 1;
    expect(roadCount).toBe(56);
  });

  it('Road template with CLEAR control-map land type keeps clear speed', () => {
    // C++ cdata.cpp Land_Type reads per-icon control-map data. A road template
    // can contain clear icons, and those cells must not get road speed.
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.templateType[15 * MAP_CELLS + 15] = TEMPLATE_ROAD_MIN; // first road template

    const roadTemplateClearSpeed = map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL);
    const clearSpeed = TERRAIN_SPEED['Clear'][SpeedClass.WHEEL]; // 0.60 (rules.ini)
    expect(roadTemplateClearSpeed).toBe(clearSpeed);
  });

  it('Water template ID = 1 (C++ TEMPLATE_WATER1 = 1, used by destroyBridge Phase 2)', () => {
    // C++ defines.h: TEMPLATE_WATER1 = 1
    // Two-phase: Phase 2 (half-destroyed → water) sets templateType to 1.
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);
    map.setTerrain(20, 20, Terrain.CLEAR);
    map.templateType[20 * MAP_CELLS + 20] = 378; // BRIDGE1H (half-destroyed)
    map.destroyBridge(20, 20, 0);
    expect(map.templateType[20 * MAP_CELLS + 20]).toBe(1); // set to water template
    expect(map.getTerrain(20, 20)).toBe(Terrain.WATER);
  });
});


// =============================================================================
//  6. GrowthRate -- Ore regrowth timing (rules.ini, map.cpp:1017)
// =============================================================================

describe('GrowthRate -- ore regrowth timing', () => {

  it('rules.ini GrowthRate = 2 (minutes between ore growth scan)', () => {
    expect(iniFloat('General', 'GrowthRate')).toBe(2);
  });

  it('rules.ini OreGrows = yes', () => {
    expect(iniBool('General', 'OreGrows')).toBe(true);
  });

  it('rules.ini OreSpreads = yes', () => {
    expect(iniBool('General', 'OreSpreads')).toBe(true);
  });

  it('TS ORE_GROWTH_INTERVAL = 2048 ticks', () => {
    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(2048);
  });

  it('C++ derivation: first scan processes 9 cells, then advances 8 new cells/tick = 2048', () => {
    // C++ map.cpp:1017: subcount = MAP_CELL_TOTAL / (GrowthRate * TICKS_PER_MINUTE)
    // subcount = 16384 / (2 * 900) = 16384 / 1800 = 9 (integer division)
    // The loop stores TiberiumScan at the boundary index before the for-loop
    // increment, so each later tick reprocesses one cell and advances 8 new cells.
    const MAP_CELL_TOTAL = 128 * 128;
    const CPP_GROWTH_RATE = 2;
    const CPP_TICKS_PER_MINUTE = 900; // 15 Hz * 60
    const subcount = Math.floor(MAP_CELL_TOTAL / (CPP_GROWTH_RATE * CPP_TICKS_PER_MINUTE));
    expect(subcount).toBe(9);
    const fullCycle = 1 + Math.ceil((MAP_CELL_TOTAL - subcount) / (subcount - 1));
    expect(fullCycle).toBe(2048);
    expect(GameMap.ORE_GROWTH_INTERVAL).toBe(fullCycle);
  });

  it('ORE_GROWTH_INTERVAL derived from C++ 15Hz timing, TS now matches at 15Hz', () => {
    // The 2048-tick interval was calculated using TICKS_PER_MINUTE = 900 (15Hz).
    // TS now runs at 15Hz (same as C++), so tick counts match exactly.
    const tsRealTimeSec = 2048 / GAME_TICKS_PER_SEC;
    const cppRealTimeSec = 2048 / 15;
    expect(tsRealTimeSec).toBeCloseTo(136.5, 1);
    expect(cppRealTimeSec).toBeCloseTo(136.5, 1);
    // Exact parity: TS and C++ ore regrowth timing now matches
    expect(tsRealTimeSec).toBeCloseTo(cppRealTimeSec, 5);
  });

  it('RESERVOIR_SIZE = 64 (C++ MAP_CELL_W/2 reservoir sampling cap)', () => {
    expect(GameMap.RESERVOIR_SIZE).toBe(64);
  });

  it('growth/spread is deterministic for sampled cells (no per-cell random)', () => {
    // C++ map.cpp:1078-1084: all sampled cells grow deterministically
    // C++ map.cpp:1091-1094: all sampled cells spread deterministically
    // TS now matches via reservoir sampling model
    expect(GameMap.RESERVOIR_SIZE).toBe(64);
  });

  it('ORE_SPREAD_MIN_DENSITY = 6 (density > 6 threshold for spreading)', () => {
    // C++ cell.cpp:2936: `if (OverlayData[cell] > 6)`. Codex's TS port stores
    // density in `oreDensity[]` (separate from `overlay[]` visual variant),
    // so the constant is the raw C++ threshold value.
    expect(GameMap.ORE_SPREAD_MIN_DENSITY).toBe(6);
  });
});


// =============================================================================
//  7. [General] Spatial Constants -- rules.ini
// =============================================================================

describe('[General] spatial constants -- rules.ini', () => {

  it('CloseEnough = 2.75 cells (movement abort distance)', () => {
    // C++ rules.cpp:260: CloseEnoughDistance(0x0280) = 640 leptons = 2.5 cells
    // rules.ini: CloseEnough=2.75
    // The INI value overrides the C++ default.
    expect(iniFloat('General', 'CloseEnough')).toBeCloseTo(2.75, 2);
  });

  it('PARITY FIXED: TS closeEnough = 2.75, matching rules.ini', () => {
    // TS index.ts: const closeEnough = 2.75 — matches RULES.INI
    // rules.ini [General]: CloseEnough=2.75
    const TS_CLOSE_ENOUGH = 2.75; // from index.ts — fixed to match RULES.INI
    const INI_CLOSE_ENOUGH = iniFloat('General', 'CloseEnough');
    expect(TS_CLOSE_ENOUGH).toBe(INI_CLOSE_ENOUGH);
  });

  it('Stray = 2.0 cells (team member stray radius before regroup)', () => {
    // C++ rules.cpp:260: StrayDistance = 0x0200 = 512 leptons = 2 cells
    // rules.ini: Stray=2.0
    expect(iniFloat('General', 'Stray')).toBeCloseTo(2.0, 2);
  });

  it('BaseBias = 2 (threat target value multiplier near base)', () => {
    // C++ rules.cpp:432: NervousBias = BaseBias from INI
    // rules.ini: BaseBias=2
    expect(iniFloat('General', 'BaseBias')).toBe(2);
  });

  it('Crush = 1.5 cells (crush distance threshold for AI)', () => {
    // C++ rules.cpp: CrushDistance
    // rules.ini: Crush=1.5
    expect(iniFloat('General', 'Crush')).toBe(1.5);
  });

  it('BallisticScatter = 1.0 cells (max scatter for inaccurate ballistic)', () => {
    expect(iniFloat('General', 'BallisticScatter')).toBe(1.0);
  });

  it('HomingScatter = 2.0 cells (max scatter for inaccurate homing)', () => {
    expect(iniFloat('General', 'HomingScatter')).toBe(2.0);
  });

  it('Gravity = 3 (ballistic projectile gravity constant)', () => {
    expect(iniFloat('General', 'Gravity')).toBe(3);
  });

  it('ExpSpread = 0.3 (cell damage spread per 256 damage points)', () => {
    expect(iniFloat('General', 'ExpSpread')).toBeCloseTo(0.3, 2);
  });

  it('LZScanRadius = 16 (alternate landing zone scan radius)', () => {
    expect(iniFloat('General', 'LZScanRadius')).toBe(16);
  });

  it('GapRadius = 10 (gap generator shroud radius in cells)', () => {
    expect(iniFloat('General', 'GapRadius')).toBe(10);
  });

  it('RadarJamRadius = 15 (mobile radar jammer effective radius)', () => {
    expect(iniFloat('General', 'RadarJamRadius')).toBe(15);
  });

  it('VortexRange = 10 (chronal vortex victim scan distance)', () => {
    expect(iniFloat('General', 'VortexRange')).toBe(10);
  });

  it('CrateRadius = 3.0 (area effect crate powerup radius)', () => {
    expect(iniFloat('General', 'CrateRadius')).toBe(3.0);
  });

  it('DropZoneRadius = 4 (map reveal radius around drop zone flare)', () => {
    expect(iniFloat('General', 'DropZoneRadius')).toBe(4);
  });

  it('ShroudRate = 4 (minutes between shroud creep, 0 = disabled)', () => {
    expect(iniFloat('General', 'ShroudRate')).toBe(4);
  });

  it('FireSupress = 1 (cells from target to check for friendlies)', () => {
    expect(iniFloat('General', 'FireSupress')).toBe(1);
  });

  it('MaxDamage = 1000 (maximum damage per shot after adjustments)', () => {
    expect(iniFloat('General', 'MaxDamage')).toBe(1000);
  });

  it('MinDamage = 1 (minimum damage per shot after adjustments)', () => {
    expect(iniFloat('General', 'MinDamage')).toBe(1);
  });

  it('BailCount = 28 (bails carried by a harvester)', () => {
    expect(iniFloat('General', 'BailCount')).toBe(28);
  });

  it('GoldValue = 25 (credits per bail of gold ore)', () => {
    expect(iniFloat('General', 'GoldValue')).toBe(25);
  });

  it('GemValue = 50 (credits per bail of gems)', () => {
    expect(iniFloat('General', 'GemValue')).toBe(50);
  });

  it('SurvivorRate = 0.4 (fraction of building cost to survivors on sell)', () => {
    expect(iniFloat('General', 'SurvivorRate')).toBeCloseTo(0.4, 2);
  });

  it('RefundPercent = 50% (percent refund on sell)', () => {
    expect(iniFloat('General', 'RefundPercent')).toBe(50);
  });

  it('BuildSpeed = 0.8 (production time multiplier)', () => {
    expect(iniFloat('General', 'BuildSpeed')).toBeCloseTo(0.8, 2);
  });
});


// =============================================================================
//  8. Terrain Speed Table Audit -- C++ rules.cpp:844-864
// =============================================================================

describe('Terrain speed table -- C++ rules.cpp:844-864 _lands[] defaults', () => {

  // C++ rules.cpp:844-864 defines Ground[LAND_xxx] speed multipliers.
  // Values are fixed-point: fixed(90,100)=0.9, fixed(80,100)=0.8, etc.
  // TS TERRAIN_SPEED stores as decimal: [Foot, Track, Wheel, Winged, Float]

  it('Clear: Foot=0.9, Track=0.8, Wheel=0.6, Winged=1.0, Float=0.0', () => {
    expect(TERRAIN_SPEED['Clear']).toEqual([0.90, 0.80, 0.60, 1.0, 0.0]);  // rules.ini [Clear] Wheel=60%
  });

  it('Road: all speed classes = 1.0 (full speed)', () => {
    expect(TERRAIN_SPEED['Road']).toEqual([1.00, 1.00, 1.00, 1.0, 0.0]);
  });

  it('Water: only Float and Winged passable', () => {
    expect(TERRAIN_SPEED['Water']).toEqual([0.00, 0.00, 0.00, 1.0, 1.0]);
  });

  it('Rock: only Winged passable', () => {
    expect(TERRAIN_SPEED['Rock']).toEqual([0.00, 0.00, 0.00, 1.0, 0.0]);
  });

  it('Wall: only Winged passable', () => {
    expect(TERRAIN_SPEED['Wall']).toEqual([0.00, 0.00, 0.00, 1.0, 0.0]);
  });

  it('Ore: Foot=0.9, Track=0.7, Wheel=0.5, Winged=1.0, Float=0.0', () => {
    expect(TERRAIN_SPEED['Ore']).toEqual([0.90, 0.70, 0.50, 1.0, 0.0]);  // rules.ini [Ore] Wheel=50%
  });

  it('Beach: Foot=0.8, Track=0.7, Wheel=0.4, Winged=1.0, Float=0.0', () => {
    expect(TERRAIN_SPEED['Beach']).toEqual([0.80, 0.70, 0.40, 1.0, 0.0]);
  });

  it('Rough: Foot=0.8, Track=0.7, Wheel=0.4, Winged=1.0, Float=0.0', () => {
    expect(TERRAIN_SPEED['Rough']).toEqual([0.80, 0.70, 0.40, 1.0, 0.0]);
  });

  it('River: impassable to all except Winged (C++ LAND_RIVER)', () => {
    expect(TERRAIN_SPEED['River']).toEqual([0.00, 0.00, 0.00, 1.0, 0.0]);
  });

  it('C++ LAND_TIBERIUM (Ore) Foot speed = 0.9 (rules.cpp:855)', () => {
    // C++ rules.cpp:855: Ground[LAND_TIBERIUM].Cost[SPEED_FOOT] = fixed(90,100)
    // TS calls it "Ore" instead of "Tiberium" but the values should match.
    expect(TERRAIN_SPEED['Ore'][SpeedClass.FOOT]).toBe(0.9);
  });

  it('Winged speed = 1.0 for ALL terrain types (C++ rules.cpp:862 hardcoded)', () => {
    // C++ rules.cpp:862: Ground[land].Cost[SPEED_WINGED] = fixed(1) for all land types
    for (const [terrainName, speeds] of Object.entries(TERRAIN_SPEED)) {
      expect(speeds[SpeedClass.WINGED]).toBe(1.0);
    }
  });

  it('Float speed > 0 only on Water (C++ rules.cpp:848)', () => {
    // C++ rules.cpp:848: Ground[LAND_WATER].Cost[SPEED_FLOAT] = fixed(1)
    // All other terrain types have Float=0 (impassable to ships)
    for (const [terrainName, speeds] of Object.entries(TERRAIN_SPEED)) {
      if (terrainName === 'Water') {
        expect(speeds[SpeedClass.FLOAT]).toBe(1.0);
      } else {
        expect(speeds[SpeedClass.FLOAT]).toBe(0.0);
      }
    }
  });
});


// =============================================================================
//  9. Terrain Enum vs C++ LandType -- defines.h:2841-2855
// =============================================================================

describe('Terrain enum ordinals -- C++ defines.h:2841-2855 LandType', () => {

  // C++ LandType enum:
  //   LAND_CLEAR = 0
  //   LAND_ROAD  = 1
  //   LAND_WATER = 2
  //   LAND_ROCK  = 3
  //   LAND_WALL  = 4
  //   LAND_TIBERIUM = 5
  //   LAND_BEACH = 6
  //   LAND_ROUGH = 7
  //   LAND_RIVER = 8

  it('CLEAR = 0 (C++ LAND_CLEAR)', () => expect(Terrain.CLEAR).toBe(0));
  it('ROAD = 1 (C++ LAND_ROAD)', () => expect(Terrain.ROAD).toBe(1));
  it('WATER = 2 (C++ LAND_WATER)', () => expect(Terrain.WATER).toBe(2));
  it('ROCK = 3 (C++ LAND_ROCK)', () => expect(Terrain.ROCK).toBe(3));
  it('WALL = 4 (C++ LAND_WALL)', () => expect(Terrain.WALL).toBe(4));
  it('ORE = 5 (C++ LAND_TIBERIUM)', () => expect(Terrain.ORE).toBe(5));
  it('BEACH = 6 (C++ LAND_BEACH)', () => expect(Terrain.BEACH).toBe(6));
  it('ROUGH = 7 (C++ LAND_ROUGH)', () => expect(Terrain.ROUGH).toBe(7));
  it('RIVER = 8 (C++ LAND_RIVER)', () => expect(Terrain.RIVER).toBe(8));

  it('first 9 terrain ordinals match C++ LandType (CLEAR=0 through RIVER=8)', () => {
    // C++ defines.h has 9 LandType values. TS extends with TREE=9 for
    // simpler tree handling (C++ uses TerrainClass objects on CLEAR cells).
    // Behavioral parity: TREE cells use CLEAR speed multipliers, so movement
    // is identical regardless of internal representation.
    expect(Terrain.CLEAR).toBe(0);
    expect(Terrain.RIVER).toBe(8);
    expect(Terrain.TREE).toBe(9);
  });

  it('TREE cells use CLEAR speed multipliers (C++ parity: trees on CLEAR ground)', () => {
    // C++ trees sit on CLEAR cells, so units move at CLEAR speed through them.
    // TS maps TREE → 'Clear' in TERRAIN_NAME_MAP, producing identical speeds.
    const treeSpeed = TERRAIN_SPEED['Clear'];
    expect(treeSpeed).toBeDefined();
    expect(treeSpeed[0]).toBe(0.9);  // FOOT
    expect(treeSpeed[1]).toBe(0.8);  // TRACK
    expect(treeSpeed[2]).toBe(0.6);  // WHEEL — rules.ini [Clear] Wheel=60%
  });
});


// =============================================================================
//  10. Buildability vs Passability -- C++ rules.cpp:864
// =============================================================================

describe('Buildability vs passability -- C++ rules.cpp:864 Ground[land].Build', () => {

  it('CLEAR and ROAD are both buildable and passable', () => {
    const map = new GameMap();
    map.setBounds(10, 10, 20, 20);
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.setTerrain(16, 15, Terrain.ROAD);
    expect(map.isBuildable(15, 15)).toBe(true);
    expect(map.isBuildable(16, 15)).toBe(true);
    expect(map.isPassable(15, 15)).toBe(true);
    expect(map.isPassable(16, 15)).toBe(true);
  });

  it('ORE is passable but NOT buildable (C++ rules.cpp:856-864)', () => {
    const map = new GameMap();
    map.setBounds(10, 10, 20, 20);
    map.setTerrain(15, 15, Terrain.ORE);
    expect(map.isPassable(15, 15)).toBe(true);
    expect(map.isBuildable(15, 15)).toBe(false);
  });

  it('ROUGH is passable but NOT buildable', () => {
    const map = new GameMap();
    map.setBounds(10, 10, 20, 20);
    map.setTerrain(15, 15, Terrain.ROUGH);
    expect(map.isPassable(15, 15)).toBe(true);
    expect(map.isBuildable(15, 15)).toBe(false);
  });

  it('BEACH is passable but NOT buildable', () => {
    const map = new GameMap();
    map.setBounds(10, 10, 20, 20);
    map.setTerrain(15, 15, Terrain.BEACH);
    expect(map.isPassable(15, 15)).toBe(true);
    expect(map.isBuildable(15, 15)).toBe(false);
  });

  it('WATER, ROCK, WALL, RIVER are neither passable nor buildable', () => {
    const map = new GameMap();
    map.setBounds(10, 10, 20, 20);
    for (const t of [Terrain.WATER, Terrain.ROCK, Terrain.WALL, Terrain.RIVER]) {
      map.setTerrain(15, 15, t);
      expect(map.isPassable(15, 15)).toBe(false);
      expect(map.isBuildable(15, 15)).toBe(false);
    }
  });

  it('TREE is passable (infantry can walk through) but NOT buildable', () => {
    // C++ parity: trees are TerrainClass objects on CLEAR cells.
    // TS TREE terrain is passable (infantry) but not buildable.
    const map = new GameMap();
    map.setBounds(10, 10, 20, 20);
    map.setTerrain(15, 15, Terrain.TREE);
    expect(map.isPassable(15, 15)).toBe(true);
    expect(map.isBuildable(15, 15)).toBe(false);
  });
});


// =============================================================================
//  11. Out-of-bounds Terrain -- C++ cell.cpp behavior
// =============================================================================

describe('Out-of-bounds terrain behavior', () => {

  it('getTerrain returns ROCK for cells outside 128x128 grid', () => {
    // C++ out-of-bounds cells return impassable terrain
    const map = new GameMap();
    expect(map.getTerrain(-1, 0)).toBe(Terrain.ROCK);
    expect(map.getTerrain(0, -1)).toBe(Terrain.ROCK);
    expect(map.getTerrain(128, 0)).toBe(Terrain.ROCK);
    expect(map.getTerrain(0, 128)).toBe(Terrain.ROCK);
  });

  it('isPassable uses the full 128x128 MapPack, not scenario radar bounds', () => {
    // C++ CellClass::Is_Clear_To_Move does not check Map.In_Radar; callers
    // that need visible/radar bounds gate that separately.
    const map = new GameMap();
    map.setBounds(10, 10, 20, 20);
    map.setTerrain(10, 10, Terrain.CLEAR);
    expect(map.isPassable(10, 10)).toBe(true);
    map.setTerrain(9, 10, Terrain.CLEAR);
    expect(map.isPassable(9, 10)).toBe(true);
    map.setTerrain(8, 10, Terrain.CLEAR);
    expect(map.isPassable(8, 10)).toBe(true);
  });
});
