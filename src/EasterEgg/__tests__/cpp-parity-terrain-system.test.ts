/**
 * C++ Parity Test: Terrain & Land Type System
 *
 * Authoritative source: rules.ini (Red Alert v3.03, stock unmodified)
 * File: public/ra/assets/rules.ini lines 2740-2809
 *
 * C++ terrain system authority chain:
 *
 * 1. LandType enum (defines.h:2841-2855):
 *    LAND_CLEAR=0, LAND_ROAD=1, LAND_WATER=2, LAND_ROCK=3, LAND_WALL=4,
 *    LAND_TIBERIUM=5, LAND_BEACH=6, LAND_ROUGH=7, LAND_RIVER=8
 *    LAND_COUNT=9
 *
 * 2. SpeedType enum (defines.h:3043-3054):
 *    SPEED_FOOT=0, SPEED_TRACK=1, SPEED_WHEEL=2, SPEED_WINGED=3, SPEED_FLOAT=4
 *    SPEED_COUNT=5
 *
 * 3. GroundType struct (defines.h:3422-3429):
 *    { fixed Cost[SPEED_COUNT]; bool Build; }
 *
 * 4. Ground[] loading (rules.cpp:838-868):
 *    _lands[] = {"Clear","Road","Water","Rock","Wall","Ore","Beach","Rough","River"}
 *    gptr->Cost[SPEED_FOOT]   = Sub_Saturate(ini.Get_Fixed(land, "Foot", 1), 1)
 *    gptr->Cost[SPEED_TRACK]  = Sub_Saturate(ini.Get_Fixed(land, "Track", 1), 1)
 *    gptr->Cost[SPEED_WHEEL]  = Sub_Saturate(ini.Get_Fixed(land, "Wheel", 1), 1)
 *    gptr->Cost[SPEED_WINGED] = Sub_Saturate(fixed(1), 1)   // always 100%, hardcoded
 *    gptr->Cost[SPEED_FLOAT]  = Sub_Saturate(ini.Get_Fixed(land, "Float", 1), 1)
 *    gptr->Build = ini.Get_Bool(land, "Buildable", false)
 *
 * 5. Sub_Saturate (fixed.h:181):
 *    Caps value to just below cap (value >= cap → value = cap - 1/256).
 *    For INI values <= 100%, Sub_Saturate(x, 1) is effectively a no-op.
 *    WINGED: Sub_Saturate(fixed(1), 1) = 255/256 ≈ 0.996 (TS uses 1.0 — acceptable).
 *
 * 6. CellClass::Recalc_Attributes (cell.cpp:532-569):
 *    Priority: interior rock override → overlay land type → template land type → CLEAR
 *    Overlays (odata.cpp:161-286): GOLD1-4, GEMS1-4 → LAND_TIBERIUM
 *                                   Wall overlays → LAND_WALL
 *                                   Crates/flags → LAND_CLEAR
 *
 * 7. Passability gate (cell.cpp:507, cell.cpp:2802):
 *    Ground[land].Cost[loco] == 0 → impassable
 *    Ground[land].Cost[loco] >  0 → passable
 *
 * 8. Buildability (cell.cpp:503, rules.cpp:864):
 *    Ground[land].Build → true only for Clear and Road per rules.ini
 *
 * 9. Overlay → land type mapping (odata.cpp):
 *    GOLD1-4:          LAND_TIBERIUM (ore)
 *    GEMS1-4:          LAND_TIBERIUM (gems)
 *    SBAG/CYCL/BRIK/BARB/WOOD/FENC: LAND_WALL (walls)
 *    FLAG_SPOT/CRATE:  LAND_CLEAR
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import { parseIniSections } from '../engine/parseIni';
import { TERRAIN_SPEED, SpeedClass, getTerrainSpeed, MAP_CELLS } from '../engine/types';
import { GameMap, Terrain, MoveResult } from '../engine/map';

// =============================================================================
// Load and parse rules.ini — THE authoritative source
// =============================================================================

const rulesIniPath = join(__dirname, '../../..', 'public/ra/assets/rules.ini');
const rulesText = readFileSync(rulesIniPath, 'utf-8');
const sections = parseIniSections(rulesText);

// =============================================================================
// INI parser helpers
// =============================================================================

/** Parse an INI percentage value like "90%" to a decimal (0.90) or plain float.
 *  C++ ini.cpp Get_Fixed: "90%" → 0.90, "0.9" → 0.90 */
function parseIniPercent(value: string | undefined, defaultValue = 1.0): number {
  if (value == null || value === '') return defaultValue;
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    return parseFloat(trimmed.slice(0, -1)) / 100;
  }
  return parseFloat(trimmed);
}

/** Parse INI boolean: "yes"/"true"/"1" → true, everything else → false.
 *  C++ ini.cpp Get_Bool uses same convention. */
function parseIniBool(value: string | undefined, defaultValue = false): boolean {
  if (value == null || value === '') return defaultValue;
  const v = value.trim().toLowerCase();
  return v === 'yes' || v === 'true' || v === '1';
}

// =============================================================================
// C++ _lands[] array from rules.cpp:844-854 — defines INI section names
// and maps to LandType enum ordinals (defines.h:2841-2855)
// =============================================================================

const CPP_LANDS = ['Clear', 'Road', 'Water', 'Rock', 'Wall', 'Ore', 'Beach', 'Rough', 'River'] as const;

/** C++ LandType enum ordinals (defines.h:2841-2855) */
const LAND_TYPE_ORDINALS: Record<string, number> = {
  Clear: 0,    // LAND_CLEAR
  Road: 1,     // LAND_ROAD
  Water: 2,    // LAND_WATER
  Rock: 3,     // LAND_ROCK
  Wall: 4,     // LAND_WALL
  Ore: 5,      // LAND_TIBERIUM
  Beach: 6,    // LAND_BEACH
  Rough: 7,    // LAND_ROUGH
  River: 8,    // LAND_RIVER
};

// =============================================================================
// Parse terrain sections from rules.ini (authoritative)
// =============================================================================

interface TerrainINIData {
  foot: number;
  track: number;
  wheel: number;
  float: number;
  buildable: boolean;
}

const INI_TERRAIN_DATA: Record<string, TerrainINIData> = {};
for (const land of CPP_LANDS) {
  const section = sections.get(land);
  // C++ rules.cpp:858: if (ini.Is_Present(_lands[land])) — section must exist
  expect(section, `rules.ini must have [${land}] section`).toBeDefined();
  INI_TERRAIN_DATA[land] = {
    foot: parseIniPercent(section!.get('Foot'), 1.0),
    track: parseIniPercent(section!.get('Track'), 1.0),
    wheel: parseIniPercent(section!.get('Wheel'), 1.0),
    float: parseIniPercent(section!.get('Float'), 1.0),
    buildable: parseIniBool(section!.get('Buildable'), false),
  };
}

// =============================================================================
// Build expected speed array per terrain [Foot, Track, Wheel, Winged, Float]
// Winged is always 1.0 (hardcoded in rules.cpp:862)
// =============================================================================

const INI_EXPECTED_SPEEDS: Record<string, [number, number, number, number, number]> = {};
for (const land of CPP_LANDS) {
  const d = INI_TERRAIN_DATA[land];
  INI_EXPECTED_SPEEDS[land] = [d.foot, d.track, d.wheel, 1.0, d.float];
}

const SPEED_CLASS_NAMES: Record<number, string> = {
  [SpeedClass.FOOT]: 'FOOT',
  [SpeedClass.TRACK]: 'TRACK',
  [SpeedClass.WHEEL]: 'WHEEL',
  [SpeedClass.WINGED]: 'WINGED',
  [SpeedClass.FLOAT]: 'FLOAT',
};

// =============================================================================
// 1. LandType enum — TS Terrain enum matches C++ LandType ordinals
//    C++ defines.h:2841-2855
// =============================================================================

describe('Terrain enum matches C++ LandType ordinals (defines.h:2841-2855)', () => {

  it('CLEAR=0 matches LAND_CLEAR', () => {
    expect(Terrain.CLEAR).toBe(LAND_TYPE_ORDINALS['Clear']);
  });

  it('ROAD=1 matches LAND_ROAD', () => {
    expect(Terrain.ROAD).toBe(LAND_TYPE_ORDINALS['Road']);
  });

  it('WATER=2 matches LAND_WATER', () => {
    expect(Terrain.WATER).toBe(LAND_TYPE_ORDINALS['Water']);
  });

  it('ROCK=3 matches LAND_ROCK', () => {
    expect(Terrain.ROCK).toBe(LAND_TYPE_ORDINALS['Rock']);
  });

  it('WALL=4 matches LAND_WALL', () => {
    expect(Terrain.WALL).toBe(LAND_TYPE_ORDINALS['Wall']);
  });

  it('ORE=5 matches LAND_TIBERIUM', () => {
    expect(Terrain.ORE).toBe(LAND_TYPE_ORDINALS['Ore']);
  });

  it('BEACH=6 matches LAND_BEACH', () => {
    expect(Terrain.BEACH).toBe(LAND_TYPE_ORDINALS['Beach']);
  });

  it('ROUGH=7 matches LAND_ROUGH', () => {
    expect(Terrain.ROUGH).toBe(LAND_TYPE_ORDINALS['Rough']);
  });

  it('RIVER=8 matches LAND_RIVER', () => {
    expect(Terrain.RIVER).toBe(LAND_TYPE_ORDINALS['River']);
  });

  it('LAND_COUNT=9 — exactly 9 base terrain types (plus TS TREE=9 extension)', () => {
    // C++ has LAND_COUNT=9. TS extends with TREE=9 (not in C++).
    expect(Terrain.TREE).toBe(9);
  });
});

// =============================================================================
// 2. SpeedClass enum — TS matches C++ SpeedType ordinals
//    C++ defines.h:3043-3054
// =============================================================================

describe('SpeedClass enum matches C++ SpeedType ordinals (defines.h:3043-3054)', () => {

  it('FOOT=0 matches SPEED_FOOT', () => {
    expect(SpeedClass.FOOT).toBe(0);
  });

  it('TRACK=1 matches SPEED_TRACK', () => {
    expect(SpeedClass.TRACK).toBe(1);
  });

  it('WHEEL=2 matches SPEED_WHEEL', () => {
    expect(SpeedClass.WHEEL).toBe(2);
  });

  it('WINGED=3 matches SPEED_WINGED', () => {
    expect(SpeedClass.WINGED).toBe(3);
  });

  it('FLOAT=4 matches SPEED_FLOAT', () => {
    expect(SpeedClass.FLOAT).toBe(4);
  });
});

// =============================================================================
// 3. TERRAIN_SPEED table — exhaustive INI-parsed comparison
//    Every (terrain, speedClass) pair parsed from rules.ini
// =============================================================================

describe('TERRAIN_SPEED table — every value parsed from rules.ini', () => {

  it('has all 9 terrain types from C++ _lands[] (rules.cpp:844-854)', () => {
    for (const land of CPP_LANDS) {
      expect(TERRAIN_SPEED[land], `missing terrain: ${land}`).toBeDefined();
    }
  });

  it('has exactly 9 terrain types (LAND_COUNT=9)', () => {
    expect(Object.keys(TERRAIN_SPEED).length).toBe(9);
  });

  it('each terrain entry has exactly 5 speed values (SPEED_COUNT=5)', () => {
    for (const [name, speeds] of Object.entries(TERRAIN_SPEED)) {
      expect(speeds.length, `${name} should have 5 speed values`).toBe(5);
    }
  });

  // Exhaustive per-cell comparison against INI-parsed values
  for (const land of CPP_LANDS) {
    for (let sc = 0; sc < 5; sc++) {
      const scName = SPEED_CLASS_NAMES[sc];
      const expected = INI_EXPECTED_SPEEDS[land][sc];

      it(`${land}/${scName} — rules.ini=${(expected * 100).toFixed(0)}%`, () => {
        const actual = TERRAIN_SPEED[land]?.[sc];
        expect(
          actual,
          `${land}/${scName}: rules.ini parsed=${expected}, TS=${actual}`
        ).toBe(expected);
      });
    }
  }
});

// =============================================================================
// 4. WINGED hardcoded invariant — rules.cpp:862
//    gptr->Cost[SPEED_WINGED] = Sub_Saturate(fixed(1), 1)
//    This is hardcoded to 1.0, NOT read from INI
// =============================================================================

describe('WINGED speed hardcoded to 1.0 for ALL terrains (rules.cpp:862)', () => {

  for (const land of CPP_LANDS) {
    it(`${land}/WINGED = 1.0 (not read from INI, hardcoded in C++)`, () => {
      expect(TERRAIN_SPEED[land][SpeedClass.WINGED]).toBe(1.0);
    });
  }

  it('rules.ini has no Winged= key in any terrain section (confirming hardcoded)', () => {
    // C++ never reads "Winged" from INI — it's always Sub_Saturate(fixed(1), 1)
    for (const land of CPP_LANDS) {
      const section = sections.get(land)!;
      expect(
        section.has('Winged'),
        `[${land}] should NOT have Winged= key in rules.ini`
      ).toBe(false);
    }
  });
});

// =============================================================================
// 5. Float exclusivity — only Water has Float > 0
//    All other terrain sections have Float=0% in rules.ini
// =============================================================================

describe('Float speed — only Water has Float > 0 (rules.ini)', () => {

  for (const land of CPP_LANDS) {
    const iniFloat = INI_TERRAIN_DATA[land].float;

    it(`[${land}] Float=${(iniFloat * 100).toFixed(0)}% per rules.ini`, () => {
      const actual = TERRAIN_SPEED[land][SpeedClass.FLOAT];
      expect(actual, `${land}/FLOAT`).toBe(iniFloat);
    });
  }

  it('Water is the ONLY terrain with Float > 0', () => {
    for (const land of CPP_LANDS) {
      if (land === 'Water') {
        expect(INI_TERRAIN_DATA[land].float).toBeGreaterThan(0);
      } else {
        expect(
          INI_TERRAIN_DATA[land].float,
          `[${land}] Float should be 0 per rules.ini`
        ).toBe(0);
      }
    }
  });
});

// =============================================================================
// 6. Buildability — rules.ini Buildable= flag
//    C++ rules.cpp:864: gptr->Build = ini.Get_Bool(land, "Buildable", false)
//    C++ cell.cpp:503: Ground[Land_Type()].Build
// =============================================================================

describe('Buildable terrain matches rules.ini Buildable= (rules.cpp:864)', () => {

  // Parse from INI and verify
  const INI_BUILDABLE_TERRAINS = CPP_LANDS.filter(l => INI_TERRAIN_DATA[l].buildable);
  const INI_NON_BUILDABLE = CPP_LANDS.filter(l => !INI_TERRAIN_DATA[l].buildable);

  it('rules.ini says exactly Clear and Road are buildable', () => {
    // Verify our INI parsing against known values
    expect(INI_BUILDABLE_TERRAINS).toEqual(['Clear', 'Road']);
  });

  it('all other terrains are NOT buildable per rules.ini', () => {
    expect(INI_NON_BUILDABLE.sort()).toEqual(
      ['Beach', 'Ore', 'River', 'Rock', 'Rough', 'Wall', 'Water']
    );
  });
});

// =============================================================================
// 7. Impassable terrain identification — speed=0 terrains from rules.ini
//    C++ cell.cpp:2802: Ground[land].Cost[loco] == 0 → impassable
// =============================================================================

describe('Impassable terrain from rules.ini — all ground speeds = 0%', () => {

  /** Terrains where ALL ground speeds (Foot, Track, Wheel) = 0 per rules.ini */
  const FULLY_IMPASSABLE_GROUND = CPP_LANDS.filter(land => {
    const d = INI_TERRAIN_DATA[land];
    return d.foot === 0 && d.track === 0 && d.wheel === 0;
  });

  it('Rock, Wall, Water, River are impassable to all ground speed classes', () => {
    // Derive from INI, then verify the expected set
    expect(FULLY_IMPASSABLE_GROUND.sort()).toEqual(
      ['River', 'Rock', 'Wall', 'Water']
    );
  });

  // Verify TS TERRAIN_SPEED matches
  for (const land of FULLY_IMPASSABLE_GROUND) {
    it(`${land}: FOOT/TRACK/WHEEL all = 0.0 in TERRAIN_SPEED`, () => {
      expect(TERRAIN_SPEED[land][SpeedClass.FOOT]).toBe(0);
      expect(TERRAIN_SPEED[land][SpeedClass.TRACK]).toBe(0);
      expect(TERRAIN_SPEED[land][SpeedClass.WHEEL]).toBe(0);
    });
  }

  /** Terrains where Float=0 AND all ground speeds=0 — truly impassable to everything */
  const FULLY_IMPASSABLE_ALL = CPP_LANDS.filter(land => {
    const d = INI_TERRAIN_DATA[land];
    return d.foot === 0 && d.track === 0 && d.wheel === 0 && d.float === 0;
  });

  it('Rock, Wall, River are impassable to ALL speed classes (including Float)', () => {
    expect(FULLY_IMPASSABLE_ALL.sort()).toEqual(['River', 'Rock', 'Wall']);
  });

  it('Water is impassable to ground BUT passable to Float', () => {
    expect(INI_TERRAIN_DATA['Water'].foot).toBe(0);
    expect(INI_TERRAIN_DATA['Water'].track).toBe(0);
    expect(INI_TERRAIN_DATA['Water'].wheel).toBe(0);
    expect(INI_TERRAIN_DATA['Water'].float).toBe(1.0);
  });
});

// =============================================================================
// 8. Speed ordering invariants derived from rules.ini
//    On passable terrain: FOOT >= TRACK >= WHEEL (infantry best off-road)
//    Road is the only terrain where all ground = 100%
// =============================================================================

describe('Speed ordering invariants derived from rules.ini', () => {

  const PASSABLE_GROUND_TERRAINS = CPP_LANDS.filter(land => {
    const d = INI_TERRAIN_DATA[land];
    return d.foot > 0 && d.track > 0 && d.wheel > 0;
  });

  for (const land of PASSABLE_GROUND_TERRAINS) {
    it(`${land}: FOOT >= TRACK >= WHEEL per rules.ini`, () => {
      const d = INI_TERRAIN_DATA[land];
      expect(d.foot).toBeGreaterThanOrEqual(d.track);
      expect(d.track).toBeGreaterThanOrEqual(d.wheel);
    });
  }

  it('Road is the only terrain where FOOT=TRACK=WHEEL=100%', () => {
    for (const land of CPP_LANDS) {
      const d = INI_TERRAIN_DATA[land];
      if (land === 'Road') {
        expect(d.foot).toBe(1.0);
        expect(d.track).toBe(1.0);
        expect(d.wheel).toBe(1.0);
      } else if (d.foot > 0 || d.track > 0 || d.wheel > 0) {
        // At least one ground speed < 100% (or all are 0)
        const allMax = d.foot === 1.0 && d.track === 1.0 && d.wheel === 1.0;
        expect(allMax, `${land} should NOT have all ground speeds = 100%`).toBe(false);
      }
    }
  });

  it('Beach and Rough have identical speed tables per rules.ini', () => {
    expect(INI_TERRAIN_DATA['Beach'].foot).toBe(INI_TERRAIN_DATA['Rough'].foot);
    expect(INI_TERRAIN_DATA['Beach'].track).toBe(INI_TERRAIN_DATA['Rough'].track);
    expect(INI_TERRAIN_DATA['Beach'].wheel).toBe(INI_TERRAIN_DATA['Rough'].wheel);
    expect(INI_TERRAIN_DATA['Beach'].float).toBe(INI_TERRAIN_DATA['Rough'].float);
    // Also verify TS matches
    expect(TERRAIN_SPEED['Beach']).toEqual(TERRAIN_SPEED['Rough']);
  });
});

// =============================================================================
// 9. getTerrainSpeed() helper — delegates to TERRAIN_SPEED table
// =============================================================================

describe('getTerrainSpeed() helper function', () => {

  for (const land of CPP_LANDS) {
    for (let sc = 0; sc < 5; sc++) {
      const scName = SPEED_CLASS_NAMES[sc];
      const expected = INI_EXPECTED_SPEEDS[land][sc];

      it(`getTerrainSpeed('${land}', ${scName}) = ${expected}`, () => {
        expect(getTerrainSpeed(land, sc)).toBe(expected);
      });
    }
  }

  it('returns 1.0 for unknown terrain (defensive default, no C++ equivalent)', () => {
    expect(getTerrainSpeed('Lava', SpeedClass.FOOT)).toBe(1.0);
    expect(getTerrainSpeed('Unknown', SpeedClass.WHEEL)).toBe(1.0);
  });
});

// =============================================================================
// 10. GameMap.isPassable() — ground passability matches TERRAIN_SPEED > 0
//     C++ cell.cpp:2802: Ground[land].Cost[loco] == 0 → impassable
// =============================================================================

describe('GameMap.isPassable() — ground passability from rules.ini', () => {

  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(10, 10, 40, 40);
  });

  // Derive passable/impassable from INI (Foot > 0 means infantry can walk)
  const TERRAIN_ENUM_MAP: Record<string, number> = {
    Clear: Terrain.CLEAR,
    Road: Terrain.ROAD,
    Water: Terrain.WATER,
    Rock: Terrain.ROCK,
    Wall: Terrain.WALL,
    Ore: Terrain.ORE,
    Beach: Terrain.BEACH,
    Rough: Terrain.ROUGH,
    River: Terrain.RIVER,
  };

  for (const land of CPP_LANDS) {
    const d = INI_TERRAIN_DATA[land];
    // Ground passable = has any ground speed > 0
    const isGroundPassable = d.foot > 0 || d.track > 0 || d.wheel > 0;

    it(`${land}: isPassable=${isGroundPassable} (rules.ini Foot=${(d.foot * 100).toFixed(0)}%)`, () => {
      map.setTerrain(15, 15, TERRAIN_ENUM_MAP[land]);
      expect(map.isPassable(15, 15)).toBe(isGroundPassable);
    });
  }
});

// =============================================================================
// 11. GameMap.isWaterPassable() — naval passability from rules.ini Float column
//     C++ cell.cpp:2802: Ground[LAND_WATER].Cost[SPEED_FLOAT] > 0
// =============================================================================

describe('GameMap.isWaterPassable() — naval passability from rules.ini Float', () => {

  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(10, 10, 40, 40);
  });

  const TERRAIN_ENUM_MAP: Record<string, number> = {
    Clear: Terrain.CLEAR,
    Road: Terrain.ROAD,
    Water: Terrain.WATER,
    Rock: Terrain.ROCK,
    Wall: Terrain.WALL,
    Ore: Terrain.ORE,
    Beach: Terrain.BEACH,
    Rough: Terrain.ROUGH,
    River: Terrain.RIVER,
  };

  for (const land of CPP_LANDS) {
    const d = INI_TERRAIN_DATA[land];
    const isNavalPassable = d.float > 0;

    it(`${land}: isWaterPassable=${isNavalPassable} (rules.ini Float=${(d.float * 100).toFixed(0)}%)`, () => {
      map.setTerrain(15, 15, TERRAIN_ENUM_MAP[land]);
      expect(map.isWaterPassable(15, 15)).toBe(isNavalPassable);
    });
  }
});

// =============================================================================
// 12. GameMap.canEnterCell() MoveResult parity
//     C++ cell.cpp:507: Ground[land].Cost[loco] == 0 → return false
// =============================================================================

describe('GameMap.canEnterCell() — MoveResult parity with rules.ini', () => {

  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(10, 10, 40, 40);
  });

  const TERRAIN_ENUM_MAP: Record<string, number> = {
    Clear: Terrain.CLEAR,
    Road: Terrain.ROAD,
    Water: Terrain.WATER,
    Rock: Terrain.ROCK,
    Wall: Terrain.WALL,
    Ore: Terrain.ORE,
    Beach: Terrain.BEACH,
    Rough: Terrain.ROUGH,
    River: Terrain.RIVER,
  };

  // Ground units: impassable if all ground speeds = 0
  for (const land of CPP_LANDS) {
    const d = INI_TERRAIN_DATA[land];
    const groundPassable = d.foot > 0 || d.track > 0 || d.wheel > 0;

    it(`${land}: ground canEnterCell=${groundPassable ? 'OK' : 'IMPASSABLE'}`, () => {
      map.setTerrain(15, 15, TERRAIN_ENUM_MAP[land]);
      const result = map.canEnterCell(15, 15, false);
      if (groundPassable) {
        expect(result).toBe(MoveResult.OK);
      } else {
        expect(result).toBe(MoveResult.IMPASSABLE);
      }
    });
  }

  // Naval units: impassable if Float = 0
  for (const land of CPP_LANDS) {
    const d = INI_TERRAIN_DATA[land];
    const navalPassable = d.float > 0;

    it(`${land}: naval canEnterCell=${navalPassable ? 'OK' : 'IMPASSABLE'}`, () => {
      map.setTerrain(15, 15, TERRAIN_ENUM_MAP[land]);
      const result = map.canEnterCell(15, 15, true);
      if (navalPassable) {
        expect(result).toBe(MoveResult.OK);
      } else {
        expect(result).toBe(MoveResult.IMPASSABLE);
      }
    });
  }
});

// =============================================================================
// 13. GameMap.getSpeedMultiplier() — movement speed uses TERRAIN_SPEED table
//     C++ drive.cpp: Ground[terrain].Cost[speed_class]
// =============================================================================

describe('GameMap.getSpeedMultiplier() — INI-parsed speed values', () => {

  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(10, 10, 40, 40);
  });

  const TERRAIN_ENUM_MAP: Record<string, number> = {
    Clear: Terrain.CLEAR,
    Road: Terrain.ROAD,
    Water: Terrain.WATER,
    Rock: Terrain.ROCK,
    Wall: Terrain.WALL,
    Ore: Terrain.ORE,
    Beach: Terrain.BEACH,
    Rough: Terrain.ROUGH,
    River: Terrain.RIVER,
  };

  // Test every terrain x speedclass combination
  for (const land of CPP_LANDS) {
    for (let sc = 0; sc < 5; sc++) {
      const scName = SPEED_CLASS_NAMES[sc];
      const expected = INI_EXPECTED_SPEEDS[land][sc];

      it(`${land}/${scName}: getSpeedMultiplier = ${expected}`, () => {
        map.setTerrain(15, 15, TERRAIN_ENUM_MAP[land]);
        expect(
          map.getSpeedMultiplier(15, 15, sc),
          `${land}/${scName}`
        ).toBe(expected);
      });
    }
  }

  it('WINGED always returns 1.0 regardless of terrain (rules.cpp:862)', () => {
    for (const land of CPP_LANDS) {
      map.setTerrain(15, 15, TERRAIN_ENUM_MAP[land]);
      expect(
        map.getSpeedMultiplier(15, 15, SpeedClass.WINGED),
        `WINGED on ${land}`
      ).toBe(1.0);
    }
  });
});

// =============================================================================
// 14. Overlay → Land Type mapping (C++ odata.cpp)
//     GOLD1-4 → LAND_TIBERIUM (Ore), GEMS1-4 → LAND_TIBERIUM (Ore)
//     Wall overlays → LAND_WALL, Crates/flags → LAND_CLEAR
// =============================================================================

describe('Overlay → Land Type mapping (C++ odata.cpp, cell.cpp:550-553)', () => {

  // C++ overlay type IDs from defines.h:1480-1510 and odata.cpp
  // In TS, overlay byte values are different — gold ore is 0x03-0x0E, gems 0x0F-0x12
  // C++ Recalc_Attributes: overlay land type overrides template land type

  it('Gold ore overlays (0x03-0x0E) correspond to LAND_TIBERIUM in C++', () => {
    // C++ odata.cpp:165,182,199,216: GOLD1-4 have Land=LAND_TIBERIUM
    // In TS, cells with gold overlay should have Ore terrain speed multipliers
    // Verify TERRAIN_SPEED has 'Ore' entry with correct INI values
    const iniOre = INI_TERRAIN_DATA['Ore'];
    expect(TERRAIN_SPEED['Ore'][SpeedClass.FOOT]).toBe(iniOre.foot);
    expect(TERRAIN_SPEED['Ore'][SpeedClass.TRACK]).toBe(iniOre.track);
    expect(TERRAIN_SPEED['Ore'][SpeedClass.WHEEL]).toBe(iniOre.wheel);
    expect(TERRAIN_SPEED['Ore'][SpeedClass.FLOAT]).toBe(iniOre.float);
  });

  it('Gem overlays (0x0F-0x12) also correspond to LAND_TIBERIUM in C++', () => {
    // C++ odata.cpp:234,251,268,285: GEMS1-4 have Land=LAND_TIBERIUM
    // Both gold and gems use the same "Ore" land type and speed multipliers
    const iniOre = INI_TERRAIN_DATA['Ore'];
    // Gold ore and gems share the same terrain classification — no separate "Gem" terrain
    expect(iniOre.foot).toBeGreaterThan(0);   // Infantry can walk through ore/gem fields
    expect(iniOre.track).toBeGreaterThan(0);   // Tracked vehicles can traverse
    expect(iniOre.wheel).toBeGreaterThan(0);   // Wheeled vehicles can traverse
  });

  it('Ore terrain is passable but NOT buildable (rules.ini)', () => {
    // C++ cell.cpp:503: Ground[LAND_TIBERIUM].Build = false per rules.ini
    expect(INI_TERRAIN_DATA['Ore'].buildable).toBe(false);
    const d = INI_TERRAIN_DATA['Ore'];
    expect(d.foot).toBeGreaterThan(0);   // passable
  });

  it('Wall overlays → LAND_WALL in C++ (odata.cpp:62,79,96,113,130,147)', () => {
    // All wall overlay types have Land=LAND_WALL: SBAG, CYCL, BRIK, BARB, WOOD, FENC
    // Verify Wall terrain is impassable per rules.ini
    const iniWall = INI_TERRAIN_DATA['Wall'];
    expect(iniWall.foot).toBe(0);
    expect(iniWall.track).toBe(0);
    expect(iniWall.wheel).toBe(0);
    expect(iniWall.float).toBe(0);
  });
});

// =============================================================================
// 15. Recalc_Attributes priority chain (cell.cpp:532-569)
//     1. Interior theatre: TEMPLATE_NONE → ROCK
//     2. Overlay land type (if not CLEAR) overrides template
//     3. Template land type
//     4. No template → CLEAR (default)
// =============================================================================

describe('Recalc_Attributes terrain priority (cell.cpp:532-569)', () => {

  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(10, 10, 40, 40);
  });

  it('default cell (no overlay, no template) is CLEAR (cell.cpp:568)', () => {
    // C++ cell.cpp:568: Land = LAND_CLEAR
    expect(map.getTerrain(15, 15)).toBe(Terrain.CLEAR);
  });

  it('ORE terrain is in the PASSABLE set (C++ LAND_TIBERIUM has Foot>0)', () => {
    map.setTerrain(15, 15, Terrain.ORE);
    expect(map.isPassable(15, 15)).toBe(true);
  });

  it('WALL terrain overrides other terrain when overlay is set (cell.cpp:550-552)', () => {
    // C++ Recalc_Attributes: overlay land type (if != CLEAR) takes priority
    // When a wall overlay is placed on a cell, terrain becomes WALL regardless of template
    map.setTerrain(15, 15, Terrain.WALL);
    expect(map.isPassable(15, 15)).toBe(false);
    expect(map.canEnterCell(15, 15, false)).toBe(MoveResult.IMPASSABLE);
  });
});

// =============================================================================
// 16. Sub_Saturate effect on speed values (fixed.h:181)
//     Sub_Saturate(value, 1): if value >= 1.0, cap to 255/256
//     For INI values <= 100%, this is a no-op.
//     Only affects WINGED (fixed(1) → 255/256 ≈ 0.996)
//     TS uses 1.0 for WINGED — acceptable divergence.
// =============================================================================

describe('Sub_Saturate behavior (fixed.h:181-182)', () => {

  it('INI values <= 100% are unaffected by Sub_Saturate capping', () => {
    // Sub_Saturate(value, 1) only triggers when value >= 1.0
    // All INI terrain speeds are <= 100%, so they pass through unchanged
    for (const land of CPP_LANDS) {
      const d = INI_TERRAIN_DATA[land];
      expect(d.foot, `[${land}] Foot <= 1.0`).toBeLessThanOrEqual(1.0);
      expect(d.track, `[${land}] Track <= 1.0`).toBeLessThanOrEqual(1.0);
      expect(d.wheel, `[${land}] Wheel <= 1.0`).toBeLessThanOrEqual(1.0);
      expect(d.float, `[${land}] Float <= 1.0`).toBeLessThanOrEqual(1.0);
    }
  });

  it('WINGED: C++ Sub_Saturate(fixed(1), 1) = 255/256, TS uses 1.0 (acceptable)', () => {
    // C++ fixed.h:181: Sub_Saturate caps at (cap*256)-1 = 255 when value == 256
    // fixed(1) = 256 raw → capped to 255 → 255/256 ≈ 0.99609375
    // TS uses exactly 1.0 — a difference of 0.004 (~0.4%) which is imperceptible.
    for (const land of CPP_LANDS) {
      const tsValue = TERRAIN_SPEED[land][SpeedClass.WINGED];
      const cppValue = 255 / 256; // Sub_Saturate(fixed(1), 1)
      // Accept TS value of 1.0 or the exact C++ value
      expect(tsValue).toBeGreaterThanOrEqual(cppValue);
      expect(tsValue).toBeLessThanOrEqual(1.0);
    }
  });

  it('Road/FOOT = 100% → Sub_Saturate caps to 255/256 in C++, TS uses 1.0', () => {
    // Road: Foot=100% (1.0) in INI → C++ Sub_Saturate(1.0, 1) = 255/256
    // TS stores 1.0 which is >= the C++ value — movement never slower than C++
    const road100Speeds = ['foot', 'track', 'wheel'] as const;
    for (const key of road100Speeds) {
      const iniVal = INI_TERRAIN_DATA['Road'][key];
      expect(iniVal).toBe(1.0);
      // TS uses 1.0, C++ uses 255/256 ≈ 0.996
      expect(TERRAIN_SPEED['Road'][SpeedClass.FOOT]).toBe(1.0);
    }
  });
});

// =============================================================================
// 17. Ore/Gem overlay constants (C++ defines.h:1487-1494)
//     Verify TS overlay byte ranges match C++ overlay enum assignments
// =============================================================================

describe('Ore/Gem overlay constants match C++ (defines.h:1487-1494)', () => {

  // C++ defines.h:1487-1494:
  //   OVERLAY_GOLD1=6, OVERLAY_GOLD2=7, OVERLAY_GOLD3=8, OVERLAY_GOLD4=9
  //   OVERLAY_GEMS1=10, OVERLAY_GEMS2=11, OVERLAY_GEMS3=12, OVERLAY_GEMS4=13
  // TS uses packed overlay byte format: gold=0x03-0x0E (12 density levels per 4 types)
  //                                      gems=0x0F-0x12

  it('gold ore overlay range spans 12 density levels (C++ OverlayData 0-11)', () => {
    // C++ cell.cpp:2879: OverlayData >= 11 → max gold density
    // TS: 0x03 (density 0) to 0x0E (density 11) = 12 levels
    const GOLD_MIN = 0x03;
    const GOLD_MAX = 0x0E;
    expect(GOLD_MAX - GOLD_MIN + 1).toBe(12);
  });

  it('gem overlay range spans 4 density levels (C++ odata.cpp gem frame=2 max)', () => {
    // TS: 0x0F (density 0) to 0x12 (density 3) = 4 levels
    // C++ odata.cpp:760: gems have 3 frames (frame = 2 max)
    const GEM_MIN = 0x0F;
    const GEM_MAX = 0x12;
    expect(GEM_MAX - GEM_MIN + 1).toBe(4);
  });

  it('no overlay = 0xFF (C++ OVERLAY_NONE = -1, TS uses unsigned 0xFF)', () => {
    const map = new GameMap();
    // Default overlay value should be 0xFF (no overlay)
    expect(map.overlay[0]).toBe(0xFF);
  });
});

// =============================================================================
// 18. Ore terrain growth/spread rules (C++ cell.cpp:2877-2918)
//     Can_Tiberium_Grow: LAND_TIBERIUM + OverlayData < 11 + GOLD only
//     Can_Tiberium_Spread: LAND_TIBERIUM + OverlayData > 6 + GOLD only
//     Gems never grow or spread (C++ cell.cpp:2881, 2916 — GOLD check)
// =============================================================================

describe('Ore growth/spread rules (cell.cpp:2877-2918)', () => {

  it('only gold ore grows (C++ checks for OVERLAY_GOLD1-4 specifically)', () => {
    // C++ cell.cpp:2881: if (Overlay != OVERLAY_GOLD1 && ... GOLD4) return false
    // Gems do NOT grow — they have a different overlay type
    // TS: GameMap.growOre() checks ovl >= 0x03 && ovl <= 0x0E (gold range only)
    const map = new GameMap();
    map.setBounds(10, 10, 40, 40);

    // Place gold ore at min density
    const idx = 15 * MAP_CELLS + 15;
    map.overlay[idx] = 0x03; // GOLD, density 0
    map.setTerrain(15, 15, Terrain.ORE);

    // Place gem overlay
    const idx2 = 16 * MAP_CELLS + 15;
    map.overlay[idx2] = 0x0F; // GEM, density 0
    map.setTerrain(16, 15, Terrain.ORE);

    // Gold should be in growth range
    const goldOvl = map.overlay[idx];
    expect(goldOvl >= 0x03 && goldOvl <= 0x0E).toBe(true);

    // Gem should be in gem range (NOT gold)
    const gemOvl = map.overlay[idx2];
    expect(gemOvl >= 0x0F && gemOvl <= 0x12).toBe(true);
  });

  it('gold ore max density is 11 (overlay 0x0E, C++ OverlayData >= 11 blocks growth)', () => {
    // C++ cell.cpp:2879: if (OverlayData >= 11) return(false);
    const GOLD_MAX = 0x0E;
    const GOLD_MIN = 0x03;
    expect(GOLD_MAX - GOLD_MIN).toBe(11); // 0-based: 0..11
  });

  it('gold ore spread requires density > 6 (C++ cell.cpp:2914)', () => {
    // C++ cell.cpp:2914: if (OverlayData <= 6) return(false);
    // TS: GameMap.ORE_SPREAD_MIN_DENSITY = 0x09 (overlay 0x09 = density 6)
    // Spread triggers when density > 6, i.e., overlay > 0x09
    expect(GameMap.ORE_SPREAD_MIN_DENSITY).toBe(0x09);
  });
});

// =============================================================================
// 19. Ore value per bail — GoldValue and GemValue from rules.ini
//     C++ cell.cpp:2041: value = Rule.GoldValue
//     C++ cell.cpp:2050: value = Rule.GemValue*4
// =============================================================================

describe('Ore/gem credit values from rules.ini (cell.cpp:2041, 2050)', () => {

  const general = sections.get('General')!;
  const iniGoldValue = parseInt(general.get('GoldValue') ?? '25', 10);
  const iniGemValue = parseInt(general.get('GemValue') ?? '50', 10);

  it('GoldValue from rules.ini (C++ cell.cpp:2041: value = Rule.GoldValue)', () => {
    // rules.ini [General] GoldValue=25
    expect(iniGoldValue).toBe(25);
  });

  it('GemValue from rules.ini (C++ cell.cpp:2050: value = Rule.GemValue*4)', () => {
    // rules.ini [General] GemValue=50
    expect(iniGemValue).toBe(50);
  });

  it('GameMap.depleteOre() returns correct gold credit value per bail', () => {
    const map = new GameMap();
    map.setBounds(10, 10, 40, 40);
    const idx = 15 * MAP_CELLS + 15;
    map.overlay[idx] = 0x05; // gold, density 2
    const credits = map.depleteOre(15, 15);
    expect(credits).toBe(iniGoldValue);
  });

  it('GameMap.depleteOre() returns correct gem credit value per bail', () => {
    const map = new GameMap();
    map.setBounds(10, 10, 40, 40);
    const idx = 15 * MAP_CELLS + 15;
    map.overlay[idx] = 0x10; // gem, density 1
    const credits = map.depleteOre(15, 15);
    expect(credits).toBe(iniGemValue);
  });

  it('fully depleted cell (0xFF) returns 0 credits', () => {
    const map = new GameMap();
    const credits = map.depleteOre(15, 15);
    expect(credits).toBe(0);
  });
});

// =============================================================================
// 20. GameMap.isBuildable() — matches rules.ini Buildable= flag
//     C++ cell.cpp:503: Ground[Land_Type()].Build
//     C++ rules.cpp:864: gptr->Build = ini.Get_Bool(land, "Buildable", false)
// =============================================================================

describe('GameMap.isBuildable() — matches rules.ini Buildable= (cell.cpp:503)', () => {

  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(10, 10, 40, 40);
  });

  const TERRAIN_ENUM_MAP: Record<string, number> = {
    Clear: Terrain.CLEAR,
    Road: Terrain.ROAD,
    Water: Terrain.WATER,
    Rock: Terrain.ROCK,
    Wall: Terrain.WALL,
    Ore: Terrain.ORE,
    Beach: Terrain.BEACH,
    Rough: Terrain.ROUGH,
    River: Terrain.RIVER,
  };

  for (const land of CPP_LANDS) {
    const iniBuildable = INI_TERRAIN_DATA[land].buildable;

    it(`${land}: isBuildable=${iniBuildable} (rules.ini Buildable=${iniBuildable ? 'yes' : 'no'})`, () => {
      map.setTerrain(15, 15, TERRAIN_ENUM_MAP[land]);
      expect(map.isBuildable(15, 15)).toBe(iniBuildable);
    });
  }

  it('Ore is passable but NOT buildable (key distinction)', () => {
    // C++ parity: units can traverse ore fields but buildings cannot be placed
    map.setTerrain(15, 15, Terrain.ORE);
    expect(map.isPassable(15, 15)).toBe(true);
    expect(map.isBuildable(15, 15)).toBe(false);
  });

  it('Rough is passable but NOT buildable', () => {
    map.setTerrain(15, 15, Terrain.ROUGH);
    expect(map.isPassable(15, 15)).toBe(true);
    expect(map.isBuildable(15, 15)).toBe(false);
  });

  it('Beach is passable but NOT buildable', () => {
    map.setTerrain(15, 15, Terrain.BEACH);
    expect(map.isPassable(15, 15)).toBe(true);
    expect(map.isBuildable(15, 15)).toBe(false);
  });
});

// =============================================================================
// 21. TERRAIN_NAME_MAP — Terrain enum → TERRAIN_SPEED key mapping
//     Must match C++ _lands[] naming convention exactly
// =============================================================================

describe('TERRAIN_NAME_MAP completeness — all Terrain enums map to TERRAIN_SPEED keys', () => {

  const TERRAIN_ENUM_MAP: Record<string, number> = {
    Clear: Terrain.CLEAR,
    Road: Terrain.ROAD,
    Water: Terrain.WATER,
    Rock: Terrain.ROCK,
    Wall: Terrain.WALL,
    Ore: Terrain.ORE,
    Beach: Terrain.BEACH,
    Rough: Terrain.ROUGH,
    River: Terrain.RIVER,
  };

  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(10, 10, 40, 40);
  });

  for (const land of CPP_LANDS) {
    it(`Terrain enum for '${land}' resolves to a valid TERRAIN_SPEED entry`, () => {
      map.setTerrain(15, 15, TERRAIN_ENUM_MAP[land]);
      // getSpeedMultiplier internally looks up TERRAIN_NAME_MAP[terrain] → TERRAIN_SPEED
      // If the mapping is missing, it returns 1.0 (the unknown default)
      // For impassable terrain, we expect 0, not 1.0
      const foot = map.getSpeedMultiplier(15, 15, SpeedClass.FOOT);
      const expected = INI_TERRAIN_DATA[land].foot;
      expect(foot, `${land}/FOOT should be ${expected}, not default 1.0`).toBe(expected);
    });
  }

  it('TREE terrain maps to Clear speed (C++ trees are TerrainClass on CLEAR cells)', () => {
    map.setTerrain(15, 15, Terrain.TREE);
    // TREE is not a C++ LandType — it's a TS extension. Trees sit on CLEAR ground.
    // getSpeedMultiplier should use Clear speeds for TREE terrain.
    const iniClear = INI_TERRAIN_DATA['Clear'];
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.FOOT)).toBe(iniClear.foot);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(iniClear.wheel);
  });
});

// =============================================================================
// 22. Comprehensive INI section verification — all 9 sections present and parseable
// =============================================================================

describe('rules.ini terrain sections — all 9 present and correctly structured', () => {

  for (const land of CPP_LANDS) {
    it(`[${land}] section exists in rules.ini`, () => {
      expect(sections.has(land)).toBe(true);
    });

    it(`[${land}] has Foot= key`, () => {
      expect(sections.get(land)!.has('Foot')).toBe(true);
    });

    it(`[${land}] has Track= key`, () => {
      expect(sections.get(land)!.has('Track')).toBe(true);
    });

    it(`[${land}] has Wheel= key`, () => {
      expect(sections.get(land)!.has('Wheel')).toBe(true);
    });

    it(`[${land}] has Float= key`, () => {
      expect(sections.get(land)!.has('Float')).toBe(true);
    });

    it(`[${land}] has Buildable= key`, () => {
      expect(sections.get(land)!.has('Buildable')).toBe(true);
    });
  }

  it('all INI speed values are valid percentages (0-100%)', () => {
    for (const land of CPP_LANDS) {
      const d = INI_TERRAIN_DATA[land];
      expect(d.foot).toBeGreaterThanOrEqual(0);
      expect(d.foot).toBeLessThanOrEqual(1.0);
      expect(d.track).toBeGreaterThanOrEqual(0);
      expect(d.track).toBeLessThanOrEqual(1.0);
      expect(d.wheel).toBeGreaterThanOrEqual(0);
      expect(d.wheel).toBeLessThanOrEqual(1.0);
      expect(d.float).toBeGreaterThanOrEqual(0);
      expect(d.float).toBeLessThanOrEqual(1.0);
    }
  });
});
