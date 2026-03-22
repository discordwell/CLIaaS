/**
 * C++ Parity Test: Terrain Speed Modifiers — rules.ini vs TS TERRAIN_SPEED table
 *
 * Authoritative source: rules.ini (Red Alert v3.03, stock unmodified)
 * Verified against: https://github.com/OpenRA/raclassic ref/Rules.ini
 *
 * C++ loading path:
 *   rules.cpp:838  RulesClass::Land_Types(CCINIClass & ini)
 *   rules.cpp:843    for (LandType land = LAND_FIRST; land < LAND_COUNT; land++)
 *   rules.cpp:844      _lands[] = {"Clear","Road","Water","Rock","Wall","Ore","Beach","Rough","River"}
 *   rules.cpp:859      gptr->Cost[SPEED_FOOT]   = Sub_Saturate(ini.Get_Fixed(land, "Foot", 1), 1)
 *   rules.cpp:860      gptr->Cost[SPEED_TRACK]  = Sub_Saturate(ini.Get_Fixed(land, "Track", 1), 1)
 *   rules.cpp:861      gptr->Cost[SPEED_WHEEL]  = Sub_Saturate(ini.Get_Fixed(land, "Wheel", 1), 1)
 *   rules.cpp:862      gptr->Cost[SPEED_WINGED] = Sub_Saturate(fixed(1), 1)   // always 100%
 *   rules.cpp:863      gptr->Cost[SPEED_FLOAT]  = Sub_Saturate(ini.Get_Fixed(land, "Float", 1), 1)
 *
 * C++ defines.h:3043-3054 SpeedType enum:
 *   SPEED_FOOT=0, SPEED_TRACK=1, SPEED_WHEEL=2, SPEED_WINGED=3, SPEED_FLOAT=4
 *
 * C++ defines.h:2841-2855 LandType enum:
 *   LAND_CLEAR=0, LAND_ROAD=1, LAND_WATER=2, LAND_ROCK=3, LAND_WALL=4,
 *   LAND_TIBERIUM=5, LAND_BEACH=6, LAND_ROUGH=7, LAND_RIVER=8
 *
 * Stock RULES.INI (authoritative):
 *   [Clear]  Foot=90%  Track=80%  Wheel=60%  Float=0%   Buildable=yes
 *   [Road]   Foot=100% Track=100% Wheel=100% Float=0%   Buildable=yes
 *   [Water]  Foot=0%   Track=0%   Wheel=0%   Float=100% Buildable=no
 *   [Rock]   Foot=0%   Track=0%   Wheel=0%   Float=0%   Buildable=no
 *   [Wall]   Foot=0%   Track=0%   Wheel=0%   Float=0%   Buildable=no
 *   [Ore]    Foot=90%  Track=70%  Wheel=50%  Float=0%   Buildable=no
 *   [Beach]  Foot=80%  Track=70%  Wheel=40%  Float=0%   Buildable=no
 *   [Rough]  Foot=80%  Track=70%  Wheel=40%  Float=0%   Buildable=no
 *   [River]  Foot=0%   Track=0%   Wheel=0%   Float=0%   Buildable=no
 */

import { describe, it, expect } from 'vitest';
import { TERRAIN_SPEED, SpeedClass, getTerrainSpeed } from '../engine/types';

// ============================================================================
// rules.ini authoritative values (percentage → decimal)
// Order: [Foot, Track, Wheel, Winged, Float]
// Winged is always 1.0 (hardcoded in C++ rules.cpp:862)
// ============================================================================
const RULES_INI_TERRAIN_SPEED: Record<string, [number, number, number, number, number]> = {
  //                      Foot  Track Wheel Winged Float
  Clear:               [0.90, 0.80, 0.60, 1.0,  0.0 ],   // rules.ini: Wheel=60%
  Road:                [1.00, 1.00, 1.00, 1.0,  0.0 ],
  Water:               [0.00, 0.00, 0.00, 1.0,  1.0 ],
  Rock:                [0.00, 0.00, 0.00, 1.0,  0.0 ],
  Wall:                [0.00, 0.00, 0.00, 1.0,  0.0 ],
  Ore:                 [0.90, 0.70, 0.50, 1.0,  0.0 ],   // rules.ini: Wheel=50%
  Beach:               [0.80, 0.70, 0.40, 1.0,  0.0 ],
  Rough:               [0.80, 0.70, 0.40, 1.0,  0.0 ],
  River:               [0.00, 0.00, 0.00, 1.0,  0.0 ],
};

const SPEED_CLASS_NAMES: Record<number, string> = {
  [SpeedClass.FOOT]: 'FOOT',
  [SpeedClass.TRACK]: 'TRACK',
  [SpeedClass.WHEEL]: 'WHEEL',
  [SpeedClass.WINGED]: 'WINGED',
  [SpeedClass.FLOAT]: 'FLOAT',
};

// ============================================================================
// 1. Exhaustive per-terrain, per-speedclass comparison
// ============================================================================

describe('TERRAIN_SPEED table — exhaustive rules.ini parity (every terrain x speedclass)', () => {

  // Verify all 9 terrains exist in TS
  it('TS TERRAIN_SPEED has all 9 terrain types from C++ _lands[] (rules.cpp:844-854)', () => {
    const expectedTerrains = ['Clear', 'Road', 'Water', 'Rock', 'Wall', 'Ore', 'Beach', 'Rough', 'River'];
    for (const terrain of expectedTerrains) {
      expect(TERRAIN_SPEED[terrain], `missing terrain: ${terrain}`).toBeDefined();
    }
  });

  // Verify no extra terrains
  it('TS TERRAIN_SPEED has exactly 9 terrain types (LAND_COUNT=9 in C++)', () => {
    expect(Object.keys(TERRAIN_SPEED).length).toBe(9);
  });

  // Verify each tuple has 5 elements (one per SpeedClass)
  it('each terrain entry has exactly 5 speed values (SPEED_COUNT=5 in C++)', () => {
    for (const [name, speeds] of Object.entries(TERRAIN_SPEED)) {
      expect(speeds.length, `${name} should have 5 speed values`).toBe(5);
    }
  });

  // The exhaustive per-cell comparison
  for (const [terrain, expectedSpeeds] of Object.entries(RULES_INI_TERRAIN_SPEED)) {
    for (let sc = 0; sc < 5; sc++) {
      const scName = SPEED_CLASS_NAMES[sc];
      const expected = expectedSpeeds[sc];

      it(`${terrain}/${scName} — rules.ini=${(expected * 100).toFixed(0)}%, TS should be ${expected}`, () => {
        const actual = TERRAIN_SPEED[terrain]?.[sc];
        expect(actual, `${terrain}/${scName}: rules.ini=${expected}, TS=${actual}`).toBe(expected);
      });
    }
  }
});

// ============================================================================
// 2. Specific mismatch documentation
//    These tests assert the rules.ini values and will FAIL if TS diverges.
// ============================================================================

describe('PARITY GAPS: TS values that diverge from rules.ini', () => {

  // GAP 1: Clear/Wheel — rules.ini=60%, TS has 70%
  it('Clear/WHEEL — rules.ini=60% (0.60), TS has 0.70 → MISMATCH', () => {
    // C++ rules.cpp:861: gptr->Cost[SPEED_WHEEL] = ini.Get_Fixed("Clear", "Wheel", 1)
    // rules.ini [Clear] Wheel=60%
    // TS types.ts:411: Clear Wheel=0.70 (should be 0.60)
    expect(TERRAIN_SPEED['Clear'][SpeedClass.WHEEL]).toBe(0.60);
  });

  // GAP 2: Ore/Wheel — rules.ini=50%, TS has 60%
  it('Ore/WHEEL — rules.ini=50% (0.50), TS has 0.60 → MISMATCH', () => {
    // C++ rules.cpp:861: gptr->Cost[SPEED_WHEEL] = ini.Get_Fixed("Ore", "Wheel", 1)
    // rules.ini [Ore] Wheel=50%
    // TS types.ts:417: Ore Wheel=0.60 (should be 0.50)
    expect(TERRAIN_SPEED['Ore'][SpeedClass.WHEEL]).toBe(0.50);
  });
});

// ============================================================================
// 3. Structural invariants from C++ source
// ============================================================================

describe('C++ structural invariants', () => {

  // rules.cpp:862: WINGED always hardcoded to fixed(1) — never read from INI
  it('WINGED is always 1.0 for ALL terrains (rules.cpp:862 hardcoded)', () => {
    for (const [terrain, speeds] of Object.entries(TERRAIN_SPEED)) {
      expect(speeds[SpeedClass.WINGED], `${terrain}/WINGED`).toBe(1.0);
    }
  });

  // Only Water has Float > 0 — all other terrains have Float=0% in rules.ini
  it('FLOAT > 0 only on Water (rules.ini: only [Water] Float=100%)', () => {
    for (const [terrain, speeds] of Object.entries(TERRAIN_SPEED)) {
      if (terrain === 'Water') {
        expect(speeds[SpeedClass.FLOAT], `${terrain}/FLOAT`).toBe(1.0);
      } else {
        expect(speeds[SpeedClass.FLOAT], `${terrain}/FLOAT should be 0`).toBe(0.0);
      }
    }
  });

  // Rock, Wall, River: all ground speeds are 0 (impassable)
  it('Rock/Wall/River are fully impassable to ground units (Foot/Track/Wheel/Float all 0)', () => {
    for (const terrain of ['Rock', 'Wall', 'River']) {
      expect(TERRAIN_SPEED[terrain][SpeedClass.FOOT], `${terrain}/FOOT`).toBe(0.0);
      expect(TERRAIN_SPEED[terrain][SpeedClass.TRACK], `${terrain}/TRACK`).toBe(0.0);
      expect(TERRAIN_SPEED[terrain][SpeedClass.WHEEL], `${terrain}/WHEEL`).toBe(0.0);
      expect(TERRAIN_SPEED[terrain][SpeedClass.FLOAT], `${terrain}/FLOAT`).toBe(0.0);
    }
  });

  // Road is the fastest ground terrain (all ground speeds = 100%)
  it('Road: all ground speeds = 1.0 (100%), Float = 0 (rules.ini)', () => {
    expect(TERRAIN_SPEED['Road'][SpeedClass.FOOT]).toBe(1.0);
    expect(TERRAIN_SPEED['Road'][SpeedClass.TRACK]).toBe(1.0);
    expect(TERRAIN_SPEED['Road'][SpeedClass.WHEEL]).toBe(1.0);
    expect(TERRAIN_SPEED['Road'][SpeedClass.FLOAT]).toBe(0.0);
  });

  // Buildable terrains: only Clear and Road (not tested here, but noted)
  // C++ rules.cpp:864: gptr->Build = ini.Get_Bool(land, "Buildable", false)
});

// ============================================================================
// 4. getTerrainSpeed() helper function parity
// ============================================================================

describe('getTerrainSpeed() helper — delegates to TERRAIN_SPEED table', () => {

  it('returns correct value for known terrain/speedclass', () => {
    expect(getTerrainSpeed('Road', SpeedClass.FOOT)).toBe(1.0);
    expect(getTerrainSpeed('Water', SpeedClass.FLOAT)).toBe(1.0);
    expect(getTerrainSpeed('Water', SpeedClass.FOOT)).toBe(0.0);
    expect(getTerrainSpeed('Rough', SpeedClass.FOOT)).toBe(0.8);
  });

  it('returns 1.0 for unknown terrain (defensive default)', () => {
    expect(getTerrainSpeed('Lava', SpeedClass.FOOT)).toBe(1.0);
    expect(getTerrainSpeed('Unknown', SpeedClass.WHEEL)).toBe(1.0);
  });

  // Note: C++ has no "unknown terrain" path — Ground[] is always fully initialized.
  // The TS default of 1.0 is a divergence but acceptable as a safety net.
});

// ============================================================================
// 5. Speed ordering invariants (derived from rules.ini values)
// ============================================================================

describe('Speed ordering invariants from rules.ini', () => {

  it('on passable ground terrain, FOOT >= TRACK >= WHEEL (infantry best off-road)', () => {
    // This holds for Clear, Rough, Ore, Beach per rules.ini
    for (const terrain of ['Clear', 'Rough', 'Ore', 'Beach']) {
      const foot = TERRAIN_SPEED[terrain][SpeedClass.FOOT];
      const track = TERRAIN_SPEED[terrain][SpeedClass.TRACK];
      const wheel = TERRAIN_SPEED[terrain][SpeedClass.WHEEL];
      expect(foot, `${terrain}: FOOT >= TRACK`).toBeGreaterThanOrEqual(track);
      expect(track, `${terrain}: TRACK >= WHEEL`).toBeGreaterThanOrEqual(wheel);
    }
  });

  it('Road is the only terrain where WHEEL = 1.0 (rules.ini [Road] Wheel=100%)', () => {
    for (const [terrain, speeds] of Object.entries(TERRAIN_SPEED)) {
      if (terrain === 'Road') {
        expect(speeds[SpeedClass.WHEEL]).toBe(1.0);
      } else if (speeds[SpeedClass.WHEEL] > 0) {
        expect(speeds[SpeedClass.WHEEL], `${terrain} WHEEL < 1.0`).toBeLessThan(1.0);
      }
    }
  });

  // Beach and Rough have identical speeds in rules.ini
  it('Beach and Rough have identical speed tables (rules.ini)', () => {
    expect(TERRAIN_SPEED['Beach']).toEqual(TERRAIN_SPEED['Rough']);
  });
});
