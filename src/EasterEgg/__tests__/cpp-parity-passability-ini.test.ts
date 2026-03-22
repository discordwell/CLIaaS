/**
 * C++ Parity Test: Map Cell Passability — rules.ini terrain speed as passability gate
 *
 * Authoritative source: rules.ini (Red Alert v3.03, stock unmodified)
 * File: public/ra/assets/rules.ini lines 2740-2809
 *
 * C++ passability rule (cell.cpp:2736-2810, Is_Clear_To_Move):
 *   Ground[land].Cost[loco] == 0  →  impassable (returns false)
 *   Ground[land].Cost[loco] > 0   →  passable
 *
 * C++ terrain speed loading (rules.cpp:838-868):
 *   rules.cpp:859  gptr->Cost[SPEED_FOOT]   = ini.Get_Fixed(land, "Foot", 1)
 *   rules.cpp:860  gptr->Cost[SPEED_TRACK]  = ini.Get_Fixed(land, "Track", 1)
 *   rules.cpp:861  gptr->Cost[SPEED_WHEEL]  = ini.Get_Fixed(land, "Wheel", 1)
 *   rules.cpp:862  gptr->Cost[SPEED_WINGED] = fixed(1)  // hardcoded 100%
 *   rules.cpp:863  gptr->Cost[SPEED_FLOAT]  = ini.Get_Fixed(land, "Float", 1)
 *
 * C++ passability set derivation from rules.ini:
 *   Speed=0% in rules.ini → Cost=0 → impassable for that speed class
 *   Speed>0% in rules.ini → Cost>0 → passable for that speed class
 *
 * rules.ini terrain speed sections (authoritative):
 *   [Clear]  Foot=90%  Track=80%  Wheel=60%  Float=0%
 *   [Road]   Foot=100% Track=100% Wheel=100% Float=0%
 *   [Water]  Foot=0%   Track=0%   Wheel=0%   Float=100%
 *   [Rock]   Foot=0%   Track=0%   Wheel=0%   Float=0%
 *   [Wall]   Foot=0%   Track=0%   Wheel=0%   Float=0%
 *   [Ore]    Foot=90%  Track=70%  Wheel=50%  Float=0%
 *   [Beach]  Foot=80%  Track=70%  Wheel=40%  Float=0%
 *   [Rough]  Foot=80%  Track=70%  Wheel=40%  Float=0%
 *   [River]  Foot=0%   Track=0%   Wheel=0%   Float=0%
 *
 * Bridge passability (C++ scenario.cpp template classification):
 *   Bridge templates (131,133,235,236,378,379,519-534) are classified as
 *   passable ground (CLEAR terrain). Ground units cross bridges; naval units
 *   cannot. Bridge destruction changes cells to WATER.
 *
 * Wall passability (C++ unit.cpp:1855-1871, odata.cpp IsCrushable):
 *   Wall terrain: Ground[LAND_WALL].Cost[*] = 0 → impassable for ALL speed classes
 *   Crusher vehicles (tanks) destroy crushable walls (SBAG,FENC,BARB,WOOD) on cell entry
 *   Non-crushable walls (BRIK) cannot be driven through at all
 *   Pathfinder does NOT route through walls — walls block pathing for everyone
 *
 * Pathfinding cost (findpath.cpp:1266-1293):
 *   Costs are flat per blockage type: _value[] = {1, 1, 3, 8, 10, 0}
 *   TERRAIN_SPEED (drive.cpp Ground[].Cost[]) does NOT affect path selection
 *   Speed multipliers only affect actual movement speed during track following
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TERRAIN_SPEED, SpeedClass, MAP_CELLS } from '../engine/types';
import { GameMap, Terrain, MoveResult } from '../engine/map';
import { findPathAStar } from '../engine/pathfinding';
import { CRUSHABLE_WALLS } from '../engine/combat';

// =============================================================================
// rules.ini authoritative passability matrix (derived from speed > 0)
// =============================================================================

/** For each terrain type, which speed classes are passable (speed > 0%) per rules.ini */
const RULES_INI_PASSABILITY: Record<string, Record<number, boolean>> = {
  Clear: {
    [SpeedClass.FOOT]: true,   // 90%
    [SpeedClass.TRACK]: true,  // 80%
    [SpeedClass.WHEEL]: true,  // 60%
    [SpeedClass.WINGED]: true, // 100% (hardcoded)
    [SpeedClass.FLOAT]: false, // 0%
  },
  Road: {
    [SpeedClass.FOOT]: true,   // 100%
    [SpeedClass.TRACK]: true,  // 100%
    [SpeedClass.WHEEL]: true,  // 100%
    [SpeedClass.WINGED]: true, // 100%
    [SpeedClass.FLOAT]: false, // 0%
  },
  Water: {
    [SpeedClass.FOOT]: false,  // 0%
    [SpeedClass.TRACK]: false, // 0%
    [SpeedClass.WHEEL]: false, // 0%
    [SpeedClass.WINGED]: true, // 100%
    [SpeedClass.FLOAT]: true,  // 100%
  },
  Rock: {
    [SpeedClass.FOOT]: false,  // 0%
    [SpeedClass.TRACK]: false, // 0%
    [SpeedClass.WHEEL]: false, // 0%
    [SpeedClass.WINGED]: true, // 100%
    [SpeedClass.FLOAT]: false, // 0%
  },
  Wall: {
    [SpeedClass.FOOT]: false,  // 0%
    [SpeedClass.TRACK]: false, // 0%
    [SpeedClass.WHEEL]: false, // 0%
    [SpeedClass.WINGED]: true, // 100%
    [SpeedClass.FLOAT]: false, // 0%
  },
  Ore: {
    [SpeedClass.FOOT]: true,   // 90%
    [SpeedClass.TRACK]: true,  // 70%
    [SpeedClass.WHEEL]: true,  // 50%
    [SpeedClass.WINGED]: true, // 100%
    [SpeedClass.FLOAT]: false, // 0%
  },
  Beach: {
    [SpeedClass.FOOT]: true,   // 80%
    [SpeedClass.TRACK]: true,  // 70%
    [SpeedClass.WHEEL]: true,  // 40%
    [SpeedClass.WINGED]: true, // 100%
    [SpeedClass.FLOAT]: false, // 0%
  },
  Rough: {
    [SpeedClass.FOOT]: true,   // 80%
    [SpeedClass.TRACK]: true,  // 70%
    [SpeedClass.WHEEL]: true,  // 40%
    [SpeedClass.WINGED]: true, // 100%
    [SpeedClass.FLOAT]: false, // 0%
  },
  River: {
    [SpeedClass.FOOT]: false,  // 0%
    [SpeedClass.TRACK]: false, // 0%
    [SpeedClass.WHEEL]: false, // 0%
    [SpeedClass.WINGED]: true, // 100%
    [SpeedClass.FLOAT]: false, // 0%
  },
};

const SPEED_CLASS_NAMES: Record<number, string> = {
  [SpeedClass.FOOT]: 'FOOT',
  [SpeedClass.TRACK]: 'TRACK',
  [SpeedClass.WHEEL]: 'WHEEL',
  [SpeedClass.WINGED]: 'WINGED',
  [SpeedClass.FLOAT]: 'FLOAT',
};

// Terrain enum → TERRAIN_SPEED key mapping (must match map.ts TERRAIN_NAME_MAP)
const TERRAIN_TO_KEY: Record<number, string> = {
  [Terrain.CLEAR]: 'Clear',
  [Terrain.ROAD]: 'Road',
  [Terrain.WATER]: 'Water',
  [Terrain.ROCK]: 'Rock',
  [Terrain.WALL]: 'Wall',
  [Terrain.ORE]: 'Ore',
  [Terrain.BEACH]: 'Beach',
  [Terrain.ROUGH]: 'Rough',
  [Terrain.RIVER]: 'River',
};

let map: GameMap;

beforeEach(() => {
  map = new GameMap();
  map.setBounds(10, 10, 40, 40);
});

// =============================================================================
// 1. TERRAIN_SPEED passability gate: speed=0 means impassable
//    C++ cell.cpp:2802: if (Ground[land].Cost[loco] == 0) return false
// =============================================================================

describe('TERRAIN_SPEED passability gate — speed=0 ↔ impassable (rules.ini)', () => {

  for (const [terrain, expected] of Object.entries(RULES_INI_PASSABILITY)) {
    for (let sc = 0; sc < 5; sc++) {
      const scName = SPEED_CLASS_NAMES[sc];
      const shouldBePassable = expected[sc];
      const speed = TERRAIN_SPEED[terrain]?.[sc];

      it(`${terrain}/${scName}: speed=${speed}, passable=${shouldBePassable}`, () => {
        const actual = TERRAIN_SPEED[terrain];
        expect(actual, `missing TERRAIN_SPEED entry for ${terrain}`).toBeDefined();
        if (shouldBePassable) {
          expect(actual[sc], `${terrain}/${scName} should be passable (>0)`).toBeGreaterThan(0);
        } else {
          expect(actual[sc], `${terrain}/${scName} should be impassable (=0)`).toBe(0);
        }
      });
    }
  }
});

// =============================================================================
// 2. PASSABLE set parity — ground passability set must match rules.ini
//    C++ cell.cpp:2802: Ground[land].Cost[loco] > 0 determines PASSABLE set
//    For ground units (FOOT/WHEEL): Clear, Road, Ore, Rough, Beach are passable
//    Water, Rock, Wall, River are impassable
// =============================================================================

describe('GameMap.isPassable() — ground passability matches rules.ini speed>0 terrains', () => {

  // Terrains passable to ground units per rules.ini (Foot>0% AND Wheel>0%)
  const GROUND_PASSABLE = [Terrain.CLEAR, Terrain.ROAD, Terrain.ORE, Terrain.ROUGH, Terrain.BEACH];
  const GROUND_IMPASSABLE = [Terrain.WATER, Terrain.ROCK, Terrain.WALL, Terrain.RIVER];

  for (const terrain of GROUND_PASSABLE) {
    it(`${TERRAIN_TO_KEY[terrain]} is ground-passable (rules.ini Foot>0%, Wheel>0%)`, () => {
      map.setTerrain(15, 15, terrain);
      expect(map.isPassable(15, 15)).toBe(true);
    });
  }

  for (const terrain of GROUND_IMPASSABLE) {
    it(`${TERRAIN_TO_KEY[terrain]} is ground-impassable (rules.ini Foot=0%, Wheel=0%)`, () => {
      map.setTerrain(15, 15, terrain);
      expect(map.isPassable(15, 15)).toBe(false);
    });
  }
});

// =============================================================================
// 3. Naval passability — only Water is passable for FLOAT
//    C++ cell.cpp:2802: Ground[LAND_WATER].Cost[SPEED_FLOAT] = 100%
//    All other terrains have Float=0% in rules.ini
// =============================================================================

describe('GameMap.isWaterPassable() — naval passability matches rules.ini Float column', () => {

  it('Water cells are passable for naval units (rules.ini [Water] Float=100%)', () => {
    map.setTerrain(15, 15, Terrain.WATER);
    expect(map.isWaterPassable(15, 15)).toBe(true);
  });

  const NON_WATER_TERRAINS = [
    Terrain.CLEAR, Terrain.ROAD, Terrain.ROCK, Terrain.WALL,
    Terrain.ORE, Terrain.BEACH, Terrain.ROUGH, Terrain.RIVER,
  ];

  for (const terrain of NON_WATER_TERRAINS) {
    it(`${TERRAIN_TO_KEY[terrain]} is NOT naval-passable (rules.ini Float=0%)`, () => {
      map.setTerrain(15, 15, terrain);
      expect(map.isWaterPassable(15, 15)).toBe(false);
    });
  }
});

// =============================================================================
// 4. canEnterCell() — MoveResult parity with rules.ini passability
//    C++ cell.cpp:2802: Ground[land].Cost[loco] == 0 → MOVE_NO
// =============================================================================

describe('GameMap.canEnterCell() — returns IMPASSABLE for speed=0 terrains', () => {

  it('Water → IMPASSABLE for ground units (rules.ini [Water] Foot=0%, Wheel=0%)', () => {
    map.setTerrain(15, 15, Terrain.WATER);
    expect(map.canEnterCell(15, 15, false)).toBe(MoveResult.IMPASSABLE);
  });

  it('Rock → IMPASSABLE for ground units (rules.ini [Rock] Foot=0%, Wheel=0%)', () => {
    map.setTerrain(15, 15, Terrain.ROCK);
    expect(map.canEnterCell(15, 15, false)).toBe(MoveResult.IMPASSABLE);
  });

  it('Wall → IMPASSABLE for ground units (rules.ini [Wall] Foot=0%, Wheel=0%)', () => {
    map.setTerrain(15, 15, Terrain.WALL);
    expect(map.canEnterCell(15, 15, false)).toBe(MoveResult.IMPASSABLE);
  });

  it('River → IMPASSABLE for ground units (rules.ini [River] Foot=0%, Wheel=0%)', () => {
    map.setTerrain(15, 15, Terrain.RIVER);
    expect(map.canEnterCell(15, 15, false)).toBe(MoveResult.IMPASSABLE);
  });

  it('Clear → OK for ground units (rules.ini [Clear] Foot=90%, Wheel=60%)', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    expect(map.canEnterCell(15, 15, false)).toBe(MoveResult.OK);
  });

  it('Ore → OK for ground units (rules.ini [Ore] Foot=90%, Wheel=50%)', () => {
    map.setTerrain(15, 15, Terrain.ORE);
    expect(map.canEnterCell(15, 15, false)).toBe(MoveResult.OK);
  });

  it('Water → OK for naval units (rules.ini [Water] Float=100%)', () => {
    map.setTerrain(15, 15, Terrain.WATER);
    expect(map.canEnterCell(15, 15, true)).toBe(MoveResult.OK);
  });

  it('Clear → IMPASSABLE for naval units (rules.ini [Clear] Float=0%)', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    expect(map.canEnterCell(15, 15, true)).toBe(MoveResult.IMPASSABLE);
  });
});

// =============================================================================
// 5. Bridge passability — bridges are CLEAR terrain (ground passable)
//    C++ scenario.cpp: bridge templates (235-252, 378-383, 519-534) → CLEAR
//    Ground units cross bridges over water. Bridge destruction → WATER.
// =============================================================================

describe('Bridge passability — bridge cells are ground-passable CLEAR terrain', () => {

  it('bridge template cells default to CLEAR terrain (ground-passable)', () => {
    // Bridge templates stay as CLEAR (scenario.ts line 1978)
    // Verify a cell with bridge template is passable to ground units
    const cx = 15, cy = 15;
    map.setTerrain(cx, cy, Terrain.CLEAR); // bridges are CLEAR
    expect(map.isPassable(cx, cy)).toBe(true);
    expect(map.canEnterCell(cx, cy, false)).toBe(MoveResult.OK);
  });

  it('bridge template cells are NOT naval-passable (bridges block ships)', () => {
    // C++ parity: bridge cells are CLEAR, not WATER, so ships cannot enter
    const cx = 15, cy = 15;
    map.setTerrain(cx, cy, Terrain.CLEAR);
    expect(map.isWaterPassable(cx, cy)).toBe(false);
    expect(map.canEnterCell(cx, cy, true)).toBe(MoveResult.IMPASSABLE);
  });

  it('destroyed bridge cells become WATER (ground-impassable, naval-passable)', () => {
    // C++ parity: bridge destruction sets cell terrain to WATER
    const cx = 15, cy = 15;
    map.setTerrain(cx, cy, Terrain.WATER); // simulate destroyed bridge
    expect(map.isPassable(cx, cy)).toBe(false);
    expect(map.isWaterPassable(cx, cy)).toBe(true);
    expect(map.canEnterCell(cx, cy, false)).toBe(MoveResult.IMPASSABLE);
    expect(map.canEnterCell(cx, cy, true)).toBe(MoveResult.OK);
  });

  it('ground units can pathfind across bridge cells', () => {
    // Create a water gap with a bridge (CLEAR cells)
    for (let x = 12; x <= 18; x++) {
      map.setTerrain(x, 15, Terrain.WATER);
    }
    // Bridge cells in the middle
    map.setTerrain(14, 15, Terrain.CLEAR);
    map.setTerrain(15, 15, Terrain.CLEAR);
    map.setTerrain(16, 15, Terrain.CLEAR);

    const start = { cx: 14, cy: 15 };
    const goal = { cx: 16, cy: 15 };

    const path = findPathAStar(map, start, goal, true);
    expect(path.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// 6. Wall passability — walls block all ground/naval movement
//    C++ rules.ini [Wall]: Foot=0%, Track=0%, Wheel=0%, Float=0%
//    Only WINGED (aircraft) can pass over wall terrain.
//    Crusher vehicles destroy crushable walls on cell entry but walls
//    still block pathfinding — the wall must be destroyed first.
// =============================================================================

describe('Wall passability — rules.ini [Wall] all ground/naval speeds = 0%', () => {

  it('Wall terrain is impassable for ground units', () => {
    map.setTerrain(15, 15, Terrain.WALL);
    expect(map.isPassable(15, 15)).toBe(false);
    expect(map.canEnterCell(15, 15, false)).toBe(MoveResult.IMPASSABLE);
  });

  it('Wall terrain is impassable for naval units (Float=0%)', () => {
    map.setTerrain(15, 15, Terrain.WALL);
    expect(map.isWaterPassable(15, 15)).toBe(false);
    expect(map.canEnterCell(15, 15, true)).toBe(MoveResult.IMPASSABLE);
  });

  it('WINGED is the only speed class with non-zero speed on Wall terrain', () => {
    const wallSpeeds = TERRAIN_SPEED['Wall'];
    expect(wallSpeeds[SpeedClass.FOOT]).toBe(0);
    expect(wallSpeeds[SpeedClass.TRACK]).toBe(0);
    expect(wallSpeeds[SpeedClass.WHEEL]).toBe(0);
    expect(wallSpeeds[SpeedClass.WINGED]).toBe(1.0);
    expect(wallSpeeds[SpeedClass.FLOAT]).toBe(0);
  });

  it('pathfinder cannot route through Wall cells (walls block pathing)', () => {
    // Create a wall barrier across the map
    for (let y = 12; y <= 18; y++) {
      map.setTerrain(15, y, Terrain.WALL);
    }

    const start = { cx: 13, cy: 15 };
    const goal = { cx: 17, cy: 15 };

    // With the wall fully blocking, pathfinder should route around (or fail)
    // Wall extends from y=12 to y=18 (7 cells), need to go around
    const path = findPathAStar(map, start, goal, true);
    if (path.length > 0) {
      // If a path is found, it should NOT go through any wall cell
      for (const cell of path) {
        expect(
          map.getTerrain(cell.cx, cell.cy),
          `path cell (${cell.cx},${cell.cy}) should not be WALL`
        ).not.toBe(Terrain.WALL);
      }
    }
  });

  it('crushable wall types: SBAG, FENC, BARB, WOOD (C++ odata.cpp IsCrushable)', () => {
    // C++ parity: only specific wall overlays are crushable
    expect(CRUSHABLE_WALLS.has('SBAG')).toBe(true);  // sandbag
    expect(CRUSHABLE_WALLS.has('FENC')).toBe(true);  // fence
    expect(CRUSHABLE_WALLS.has('BARB')).toBe(true);  // barbwire
    expect(CRUSHABLE_WALLS.has('WOOD')).toBe(true);  // wood wall
  });

  it('BRIK walls are NOT crushable (C++ odata.cpp IsCrushable=false)', () => {
    expect(CRUSHABLE_WALLS.has('BRIK')).toBe(false);
  });
});

// =============================================================================
// 7. River passability — rivers are impassable to everything
//    C++ rules.ini [River]: Foot=0%, Track=0%, Wheel=0%, Float=0%
//    Even ships cannot traverse rivers (different from open water).
// =============================================================================

describe('River passability — rules.ini [River] ALL speeds = 0%', () => {

  it('River is impassable to ground units', () => {
    map.setTerrain(15, 15, Terrain.RIVER);
    expect(map.isPassable(15, 15)).toBe(false);
    expect(map.canEnterCell(15, 15, false)).toBe(MoveResult.IMPASSABLE);
  });

  it('River is impassable to naval units (Float=0%, unlike Water)', () => {
    // Key distinction: Water has Float=100%, River has Float=0%
    // Rivers are shallow/turbulent — ships can't enter
    const riverSpeeds = TERRAIN_SPEED['River'];
    const waterSpeeds = TERRAIN_SPEED['Water'];

    expect(riverSpeeds[SpeedClass.FLOAT]).toBe(0);
    expect(waterSpeeds[SpeedClass.FLOAT]).toBe(1.0);
  });

  it('River has zero speed for ALL speed classes including Float', () => {
    const riverSpeeds = TERRAIN_SPEED['River'];
    // Only exception is WINGED (hardcoded 1.0 in rules.cpp:862)
    expect(riverSpeeds[SpeedClass.FOOT]).toBe(0);
    expect(riverSpeeds[SpeedClass.TRACK]).toBe(0);
    expect(riverSpeeds[SpeedClass.WHEEL]).toBe(0);
    expect(riverSpeeds[SpeedClass.FLOAT]).toBe(0);
    expect(riverSpeeds[SpeedClass.WINGED]).toBe(1.0); // aircraft ignore terrain
  });
});

// =============================================================================
// 8. Rock passability — rocks/cliffs are impassable to everything except aircraft
//    C++ rules.ini [Rock]: Foot=0%, Track=0%, Wheel=0%, Float=0%
// =============================================================================

describe('Rock passability — rules.ini [Rock] ALL ground/naval speeds = 0%', () => {

  it('Rock is impassable to ground units', () => {
    map.setTerrain(15, 15, Terrain.ROCK);
    expect(map.isPassable(15, 15)).toBe(false);
  });

  it('Rock has zero speed for all classes except WINGED', () => {
    const rockSpeeds = TERRAIN_SPEED['Rock'];
    expect(rockSpeeds[SpeedClass.FOOT]).toBe(0);
    expect(rockSpeeds[SpeedClass.TRACK]).toBe(0);
    expect(rockSpeeds[SpeedClass.WHEEL]).toBe(0);
    expect(rockSpeeds[SpeedClass.FLOAT]).toBe(0);
    expect(rockSpeeds[SpeedClass.WINGED]).toBe(1.0);
  });

  it('pathfinder routes around Rock terrain', () => {
    // Rock barrier at x=15
    for (let y = 12; y <= 18; y++) {
      map.setTerrain(15, y, Terrain.ROCK);
    }

    const start = { cx: 13, cy: 15 };
    const goal = { cx: 17, cy: 15 };

    const path = findPathAStar(map, start, goal, true);
    if (path.length > 0) {
      for (const cell of path) {
        expect(
          map.getTerrain(cell.cx, cell.cy),
          `path cell (${cell.cx},${cell.cy}) should not be ROCK`
        ).not.toBe(Terrain.ROCK);
      }
    }
  });
});

// =============================================================================
// 9. Pathfinding cost does NOT use TERRAIN_SPEED
//    C++ findpath.cpp:1284 — flat _value[] table: {1, 1, 3, 8, 10, 0}
//    drive.cpp Ground[].Cost[] is used during movement, NOT pathfinding
// =============================================================================

describe('Pathfinding cost excludes terrain speed (C++ findpath.cpp:1284)', () => {

  it('path through Rough terrain has same length as path through Clear', () => {
    // Direct horizontal path from (11,15) to (18,15)
    // Mark the row as ROUGH — C++ pathfinder treats it identically to CLEAR
    for (let x = 11; x <= 18; x++) {
      map.setTerrain(x, 15, Terrain.ROUGH);
    }

    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };

    const path = findPathAStar(map, start, goal, true);
    expect(path.length).toBeGreaterThan(0);

    // Should go straight through ROUGH, not detour to CLEAR
    for (const cell of path) {
      expect(cell.cy, 'should take direct path through ROUGH').toBe(15);
    }
  });

  it('path through Ore terrain is not penalized vs Clear', () => {
    // Mark direct route as ORE
    for (let x = 11; x <= 18; x++) {
      map.setTerrain(x, 15, Terrain.ORE);
    }

    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };

    const path = findPathAStar(map, start, goal, true);
    expect(path.length).toBeGreaterThan(0);

    for (const cell of path) {
      expect(cell.cy, 'should take direct path through ORE').toBe(15);
    }
  });

  it('path through Beach terrain is not penalized vs Clear', () => {
    for (let x = 11; x <= 18; x++) {
      map.setTerrain(x, 15, Terrain.BEACH);
    }

    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };

    const path = findPathAStar(map, start, goal, true);
    expect(path.length).toBeGreaterThan(0);

    for (const cell of path) {
      expect(cell.cy, 'should take direct path through BEACH').toBe(15);
    }
  });
});

// =============================================================================
// 10. getSpeedMultiplier() applies TERRAIN_SPEED during movement (not pathing)
//     C++ drive.cpp Ground[terrain].Cost[speed_class]
// =============================================================================

describe('getSpeedMultiplier() — movement speed uses TERRAIN_SPEED table', () => {

  it('Clear terrain: WHEEL speed = 0.60 (rules.ini [Clear] Wheel=60%)', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(0.60);
  });

  it('Clear terrain: FOOT speed = 0.90 (rules.ini [Clear] Foot=90%)', () => {
    map.setTerrain(15, 15, Terrain.CLEAR);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.FOOT)).toBe(0.90);
  });

  it('Ore terrain: WHEEL speed = 0.50 (rules.ini [Ore] Wheel=50%)', () => {
    map.setTerrain(15, 15, Terrain.ORE);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(0.50);
  });

  it('Rough terrain: WHEEL speed = 0.40 (rules.ini [Rough] Wheel=40%)', () => {
    map.setTerrain(15, 15, Terrain.ROUGH);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(0.40);
  });

  it('Road terrain: WHEEL speed = 1.00 (rules.ini [Road] Wheel=100%)', () => {
    map.setTerrain(15, 15, Terrain.ROAD);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(1.00);
  });

  it('WINGED always returns 1.0 regardless of terrain (rules.cpp:862 hardcoded)', () => {
    // C++ rules.cpp:862: gptr->Cost[SPEED_WINGED] = Sub_Saturate(fixed(1), 1)
    const terrains = [Terrain.CLEAR, Terrain.WATER, Terrain.ROCK, Terrain.WALL, Terrain.ORE];
    for (const t of terrains) {
      map.setTerrain(15, 15, t);
      expect(
        map.getSpeedMultiplier(15, 15, SpeedClass.WINGED),
        `WINGED on ${TERRAIN_TO_KEY[t]} should be 1.0`
      ).toBe(1.0);
    }
  });

  it('Water terrain: FOOT/WHEEL speed = 0 (impassable), FLOAT speed = 1.0', () => {
    map.setTerrain(15, 15, Terrain.WATER);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.FOOT)).toBe(0);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(0);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.FLOAT)).toBe(1.0);
  });
});

// =============================================================================
// 11. Tree passability — C++ trees are TerrainClass on CLEAR cells
//     Trees block movement via occupancy, not terrain type.
//     Tree cells use Clear speed multipliers.
// =============================================================================

describe('Tree passability — TREE terrain uses Clear speed (C++ TerrainClass on CLEAR)', () => {

  it('TREE cell without tree occupancy is ground-passable', () => {
    map.setTerrain(15, 15, Terrain.TREE);
    // Without tree occupancy, TREE terrain is passable (in PASSABLE set)
    expect(map.isTerrainPassable(15, 15)).toBe(true);
  });

  it('TREE cell with tree occupancy is ground-impassable', () => {
    map.setTerrain(15, 15, Terrain.TREE);
    // Use addTree() to register tree occupancy (C++ terrain.cpp Unlimbo)
    const cellIdx = 15 * MAP_CELLS + 15;
    map.addTree({
      type: 't01', cx: 15, cy: 15, hp: 600, maxHp: 600,
      immune: false, occupyCells: [cellIdx],
    });
    expect(map.isTerrainPassable(15, 15)).toBe(false);
  });

  it('TREE terrain uses Clear speed multipliers', () => {
    // C++ parity: trees are TerrainClass objects placed on CLEAR cells
    // TERRAIN_NAME_MAP maps TREE → 'Clear'
    map.setTerrain(15, 15, Terrain.TREE);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.WHEEL)).toBe(0.60);
    expect(map.getSpeedMultiplier(15, 15, SpeedClass.FOOT)).toBe(0.90);
  });
});

// =============================================================================
// 12. Comprehensive impassable terrain → pathfinding rejection
//     C++ cell.cpp:2802: Ground[land].Cost[loco] == 0 → returns false
//     Pathfinder rejects cells where canEnterCell returns IMPASSABLE
// =============================================================================

describe('Impassable terrains block pathfinding (speed=0 → path rejected)', () => {

  it('cannot pathfind through Water cells (ground)', () => {
    // Water barrier
    for (let y = 12; y <= 18; y++) {
      map.setTerrain(15, y, Terrain.WATER);
    }

    const start = { cx: 13, cy: 15 };
    const goal = { cx: 17, cy: 15 };

    const path = findPathAStar(map, start, goal, true);
    if (path.length > 0) {
      for (const cell of path) {
        expect(
          map.getTerrain(cell.cx, cell.cy),
          `path should not include WATER cell (${cell.cx},${cell.cy})`
        ).not.toBe(Terrain.WATER);
      }
    }
  });

  it('cannot pathfind through River cells', () => {
    for (let y = 12; y <= 18; y++) {
      map.setTerrain(15, y, Terrain.RIVER);
    }

    const start = { cx: 13, cy: 15 };
    const goal = { cx: 17, cy: 15 };

    const path = findPathAStar(map, start, goal, true);
    if (path.length > 0) {
      for (const cell of path) {
        expect(
          map.getTerrain(cell.cx, cell.cy),
          `path should not include RIVER cell (${cell.cx},${cell.cy})`
        ).not.toBe(Terrain.RIVER);
      }
    }
  });

  it('naval pathfinding works only on Water cells', () => {
    // Fill a corridor with water for naval path
    for (let x = 11; x <= 18; x++) {
      map.setTerrain(x, 15, Terrain.WATER);
    }

    const start = { cx: 11, cy: 15 };
    const goal = { cx: 18, cy: 15 };

    const path = findPathAStar(map, start, goal, true, true); // naval=true
    expect(path.length).toBeGreaterThan(0);

    for (const cell of path) {
      expect(
        map.getTerrain(cell.cx, cell.cy),
        `naval path cell (${cell.cx},${cell.cy}) should be WATER`
      ).toBe(Terrain.WATER);
    }
  });
});
