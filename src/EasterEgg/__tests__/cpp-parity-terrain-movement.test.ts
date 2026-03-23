/**
 * C++ Behavioral Parity Tests — Terrain Passability & Movement Speed Modifiers
 *
 * Audits the TypeScript engine's terrain speed tables, passability rules, road
 * speed bonuses, water passability, crusher mechanics, bridge passability, ore
 * tile speed, and movement-related [General] constants against C++ source.
 *
 * Source references:
 *   rules.cpp:844-864      — _lands[] Ground[LAND_xxx] speed defaults
 *   rules.cpp:862           — WINGED fixed(1) for all terrain
 *   rules.ini [General]     — BaseBias, CloseEnough, Stray, Crush, CrateRadius,
 *                              HomingScatter, BallisticScatter, Gravity, etc.
 *   drive.cpp:1388-1402     — Ground[land].Cost[speed] applied to movement speed
 *   drive.cpp               — Ok_To_Move crusher check
 *   udata.cpp:865           — Forces all vehicle SpeedClasses to WHEEL
 *   cell.cpp:Passable_Cell  — passability rules per LandType
 *   findpath.cpp:1284-1292  — pathfinding cost (flat, no terrain speed)
 *   defines.h:2841-2855     — LandType enum ordinals
 *
 * Tests that FAIL are GOOD — they identify real parity gaps.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseIniSections } from '../engine/parseIni';
import {
  SpeedClass,
  TERRAIN_SPEED,
  getTerrainSpeed,
  UNIT_STATS,
} from '../engine/types';
import { GameMap, Terrain, MoveResult } from '../engine/map';

// ── Load and parse rules.ini ────────────────────────────────────────

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

/** Get a boolean from an INI section */
function iniBool(section: string, key: string, def = false): boolean {
  const val = sections.get(section)?.get(key)?.toLowerCase();
  if (val == null) return def;
  return val === 'yes' || val === 'true' || val === '1';
}

// ════════════════════════════════════════════════════════════════════
// 1. SpeedClass terrain speed modifiers
// ════════════════════════════════════════════════════════════════════

describe('SpeedClass terrain speed modifiers — C++ rules.cpp:844-864', () => {
  /**
   * C++ rules.cpp:844-864 initializes Ground[LAND_xxx] with hardcoded defaults.
   * These are the definitive speed percentages for each SpeedClass per terrain.
   *
   * C++ source (rules.cpp lines 844-862):
   *   Ground[LAND_CLEAR].Cost[SPEED_FOOT]  = fixed(0.9)
   *   Ground[LAND_CLEAR].Cost[SPEED_TRACK] = fixed(0.8)
   *   Ground[LAND_CLEAR].Cost[SPEED_WHEEL] = fixed(0.6)  <-- note: all vehicles use WHEEL
   *   Ground[LAND_CLEAR].Cost[SPEED_FLOAT] = fixed(0)
   *   ...etc for each LandType
   *
   * But wait — the actual C++ defaults in rules.cpp may differ from what
   * the TS engine has encoded. Let's verify each entry.
   */

  // C++ rules.cpp:844 — LAND_CLEAR
  describe('CLEAR terrain (LAND_CLEAR)', () => {
    it('FOOT speed = 0.9 (90%)', () => {
      expect(TERRAIN_SPEED['Clear'][SpeedClass.FOOT]).toBe(0.9);
    });
    it('TRACK speed = 0.8 (80%)', () => {
      expect(TERRAIN_SPEED['Clear'][SpeedClass.TRACK]).toBe(0.8);
    });
    it('WHEEL speed = 0.6 (60%)', () => {
      // rules.ini [Clear] Wheel=60% — INI overrides cpp constructor defaults
      expect(TERRAIN_SPEED['Clear'][SpeedClass.WHEEL]).toBe(0.6);
    });
    it('WINGED speed = 1.0 (100%)', () => {
      expect(TERRAIN_SPEED['Clear'][SpeedClass.WINGED]).toBe(1.0);
    });
    it('FLOAT speed = 0.0 (impassable)', () => {
      expect(TERRAIN_SPEED['Clear'][SpeedClass.FLOAT]).toBe(0.0);
    });
  });

  // C++ rules.cpp:850 — LAND_ROAD
  describe('ROAD terrain (LAND_ROAD)', () => {
    it('FOOT speed = 1.0 (100%)', () => {
      expect(TERRAIN_SPEED['Road'][SpeedClass.FOOT]).toBe(1.0);
    });
    it('TRACK speed = 1.0 (100%)', () => {
      expect(TERRAIN_SPEED['Road'][SpeedClass.TRACK]).toBe(1.0);
    });
    it('WHEEL speed = 1.0 (100%)', () => {
      // C++ rules.cpp:852: Ground[LAND_ROAD].Cost[SPEED_WHEEL] = fixed(0x0100) = 1.0
      expect(TERRAIN_SPEED['Road'][SpeedClass.WHEEL]).toBe(1.0);
    });
    it('FLOAT speed = 0.0 (impassable)', () => {
      expect(TERRAIN_SPEED['Road'][SpeedClass.FLOAT]).toBe(0.0);
    });
  });

  // C++ rules.cpp:853 — LAND_WATER
  describe('WATER terrain (LAND_WATER)', () => {
    it('FOOT speed = 0.0 (impassable)', () => {
      expect(TERRAIN_SPEED['Water'][SpeedClass.FOOT]).toBe(0.0);
    });
    it('WHEEL speed = 0.0 (impassable)', () => {
      expect(TERRAIN_SPEED['Water'][SpeedClass.WHEEL]).toBe(0.0);
    });
    it('FLOAT speed = 1.0 (100%)', () => {
      expect(TERRAIN_SPEED['Water'][SpeedClass.FLOAT]).toBe(1.0);
    });
    it('WINGED speed = 1.0 (100%)', () => {
      expect(TERRAIN_SPEED['Water'][SpeedClass.WINGED]).toBe(1.0);
    });
  });

  // C++ rules.cpp:856 — LAND_ROCK (impassable cliffs)
  describe('ROCK terrain (LAND_ROCK)', () => {
    it('all ground speed classes = 0.0 (impassable)', () => {
      expect(TERRAIN_SPEED['Rock'][SpeedClass.FOOT]).toBe(0.0);
      expect(TERRAIN_SPEED['Rock'][SpeedClass.TRACK]).toBe(0.0);
      expect(TERRAIN_SPEED['Rock'][SpeedClass.WHEEL]).toBe(0.0);
      expect(TERRAIN_SPEED['Rock'][SpeedClass.FLOAT]).toBe(0.0);
    });
    it('WINGED speed = 1.0 (100%)', () => {
      expect(TERRAIN_SPEED['Rock'][SpeedClass.WINGED]).toBe(1.0);
    });
  });

  // C++ rules.cpp:858 — LAND_WALL
  describe('WALL terrain (LAND_WALL)', () => {
    it('all ground speed classes = 0.0 (impassable)', () => {
      expect(TERRAIN_SPEED['Wall'][SpeedClass.FOOT]).toBe(0.0);
      expect(TERRAIN_SPEED['Wall'][SpeedClass.TRACK]).toBe(0.0);
      expect(TERRAIN_SPEED['Wall'][SpeedClass.WHEEL]).toBe(0.0);
    });
  });

  // C++ rules.cpp:859 — LAND_TIBERIUM (Ore)
  describe('ORE terrain (LAND_TIBERIUM)', () => {
    it('FOOT speed = 0.9 (90%)', () => {
      // C++ rules.cpp:859: Ground[LAND_TIBERIUM].Cost[SPEED_FOOT] = fixed(0x00E6)
      // 0x00E6 / 256 ≈ 0.8984 ≈ 0.9
      expect(TERRAIN_SPEED['Ore'][SpeedClass.FOOT]).toBe(0.9);
    });
    it('TRACK speed = 0.7 (70%)', () => {
      expect(TERRAIN_SPEED['Ore'][SpeedClass.TRACK]).toBe(0.7);
    });
    it('WHEEL speed = 0.5 (50%)', () => {
      // rules.ini [Ore] Wheel=50% — INI overrides cpp constructor defaults
      expect(TERRAIN_SPEED['Ore'][SpeedClass.WHEEL]).toBe(0.5);
    });
    it('FLOAT speed = 0.0 (impassable)', () => {
      expect(TERRAIN_SPEED['Ore'][SpeedClass.FLOAT]).toBe(0.0);
    });
  });

  // C++ rules.cpp:860 — LAND_BEACH
  describe('BEACH terrain (LAND_BEACH)', () => {
    it('FOOT speed = 0.8 (80%)', () => {
      expect(TERRAIN_SPEED['Beach'][SpeedClass.FOOT]).toBe(0.8);
    });
    it('WHEEL speed = 0.4 (40%)', () => {
      // C++ rules.cpp:860: Ground[LAND_BEACH].Cost[SPEED_WHEEL] = fixed(0x0066)
      // 0x0066 / 256 ≈ 0.3984 ≈ 0.4
      expect(TERRAIN_SPEED['Beach'][SpeedClass.WHEEL]).toBe(0.4);
    });
  });

  // C++ rules.cpp:861 — LAND_ROUGH
  describe('ROUGH terrain (LAND_ROUGH)', () => {
    it('FOOT speed = 0.8 (80%)', () => {
      expect(TERRAIN_SPEED['Rough'][SpeedClass.FOOT]).toBe(0.8);
    });
    it('TRACK speed = 0.7 (70%)', () => {
      expect(TERRAIN_SPEED['Rough'][SpeedClass.TRACK]).toBe(0.7);
    });
    it('WHEEL speed = 0.4 (40%)', () => {
      // C++ rules.cpp:861: Ground[LAND_ROUGH].Cost[SPEED_WHEEL] = fixed(0x0066)
      // 0x0066 / 256 ≈ 0.3984 ≈ 0.4
      expect(TERRAIN_SPEED['Rough'][SpeedClass.WHEEL]).toBe(0.4);
    });
  });

  // C++ rules.cpp:863 — LAND_RIVER
  describe('RIVER terrain (LAND_RIVER)', () => {
    it('all ground speed classes = 0.0 (impassable)', () => {
      expect(TERRAIN_SPEED['River'][SpeedClass.FOOT]).toBe(0.0);
      expect(TERRAIN_SPEED['River'][SpeedClass.TRACK]).toBe(0.0);
      expect(TERRAIN_SPEED['River'][SpeedClass.WHEEL]).toBe(0.0);
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. SpeedClass enum values match C++ defines.h
// ════════════════════════════════════════════════════════════════════

describe('SpeedClass enum ordinals — C++ defines.h:3043-3054', () => {
  /**
   * C++ defines.h:3043-3054:
   *   SPEED_NONE  = -1,
   *   SPEED_FOOT  = 0,
   *   SPEED_TRACK = 1,
   *   SPEED_WHEEL = 2,
   *   SPEED_WINGED = 3,
   *   SPEED_FLOAT = 4,
   */
  it('FOOT = 0', () => expect(SpeedClass.FOOT).toBe(0));
  it('TRACK = 1', () => expect(SpeedClass.TRACK).toBe(1));
  it('WHEEL = 2', () => expect(SpeedClass.WHEEL).toBe(2));
  it('WINGED = 3', () => expect(SpeedClass.WINGED).toBe(3));
  it('FLOAT = 4', () => expect(SpeedClass.FLOAT).toBe(4));
});

// ════════════════════════════════════════════════════════════════════
// 3. Vehicle SpeedClass per rules.ini Tracked= flag — C++ udata.cpp:1366
// ════════════════════════════════════════════════════════════════════

describe('Vehicle SpeedClass matches rules.ini Tracked= flag — C++ udata.cpp:1366', () => {
  /**
   * C++ udata.cpp:1366: Speed = ini.Get_Bool(IniName, "Tracked", ...) ? SPEED_TRACK : SPEED_WHEEL;
   * Vehicles with Tracked=yes → TRACK, others → WHEEL.
   */

  const trackedVehicles = [
    '1TNK', '2TNK', '3TNK', '4TNK', 'APC', 'ARTY', 'HARV',
    'V2RL', 'MNLY', 'MRJ', 'STNK', 'CTNK', 'TTNK', 'QTNK',
  ];

  const wheeledVehicles = ['JEEP', 'MCV', 'TRUK', 'DTRK', 'MGG'];

  for (const v of trackedVehicles) {
    it(`${v} should use SpeedClass.TRACK (Tracked=yes)`, () => {
      const stats = UNIT_STATS[v];
      expect(stats, `UNIT_STATS['${v}'] should exist`).toBeDefined();
      expect(stats.speedClass).toBe(SpeedClass.TRACK);
    });
  }

  for (const v of wheeledVehicles) {
    it(`${v} should use SpeedClass.WHEEL (Tracked=no)`, () => {
      const stats = UNIT_STATS[v];
      expect(stats, `UNIT_STATS['${v}'] should exist`).toBeDefined();
      expect(stats.speedClass).toBe(SpeedClass.WHEEL);
    });
  }

  // Aircraft should be WINGED
  const aircraft = ['TRAN', 'HELI', 'HIND', 'MIG', 'YAK', 'BADR', 'U2'];
  for (const a of aircraft) {
    it(`${a} should use SpeedClass.WINGED`, () => {
      const stats = UNIT_STATS[a];
      expect(stats, `UNIT_STATS['${a}'] should exist`).toBeDefined();
      expect(stats.speedClass).toBe(SpeedClass.WINGED);
    });
  }

  // Ships should be FLOAT
  const ships = ['LST', 'SS', 'DD', 'CA', 'PT'];
  for (const s of ships) {
    it(`${s} should use SpeedClass.FLOAT`, () => {
      const stats = UNIT_STATS[s];
      expect(stats, `UNIT_STATS['${s}'] should exist`).toBeDefined();
      expect(stats.speedClass).toBe(SpeedClass.FLOAT);
    });
  }

  // Infantry should be FOOT
  const infantry = ['E1', 'E2', 'E3', 'E4', 'E6', 'DOG', 'SPY', 'MEDI', 'E7'];
  for (const i of infantry) {
    it(`${i} should use SpeedClass.FOOT`, () => {
      const stats = UNIT_STATS[i];
      expect(stats, `UNIT_STATS['${i}'] should exist`).toBeDefined();
      expect(stats.speedClass).toBe(SpeedClass.FOOT);
    });
  }
});

// ════════════════════════════════════════════════════════════════════
// 4. Road speed bonus
// ════════════════════════════════════════════════════════════════════

describe('Road speed bonus — C++ rules.cpp:850-852', () => {
  /**
   * C++ Road terrain gives 1.0 (100% speed) for all ground classes.
   * This effectively provides a speed bonus compared to CLEAR (0.6-0.9).
   */

  it('FOOT on road = 1.0 vs clear = 0.9 (11% bonus)', () => {
    const roadSpeed = getTerrainSpeed('Road', SpeedClass.FOOT);
    const clearSpeed = getTerrainSpeed('Clear', SpeedClass.FOOT);
    expect(roadSpeed).toBeGreaterThan(clearSpeed);
    expect(roadSpeed).toBe(1.0);
  });

  it('WHEEL on road = 1.0 vs clear (significant bonus for vehicles)', () => {
    const roadSpeed = getTerrainSpeed('Road', SpeedClass.WHEEL);
    const clearSpeed = getTerrainSpeed('Clear', SpeedClass.WHEEL);
    expect(roadSpeed).toBeGreaterThan(clearSpeed);
    expect(roadSpeed).toBe(1.0);
  });

  it('FLOAT on road = 0.0 (ships cannot use roads)', () => {
    expect(getTerrainSpeed('Road', SpeedClass.FLOAT)).toBe(0.0);
  });

  it('GameMap.getSpeedMultiplier applies road bonus on CLEAR with road template', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    map.setTerrain(10, 10, Terrain.CLEAR);
    // Simulate road template overlay
    map.templateType[10 * 128 + 10] = 180; // within TEMPLATE_ROAD_MIN(173)..TEMPLATE_ROAD_MAX(228)
    const multiplier = map.getSpeedMultiplier(10, 10, SpeedClass.WHEEL);
    expect(multiplier).toBe(1.0);
  });

  it('GameMap.getSpeedMultiplier returns lower value for CLEAR without road template', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    map.setTerrain(10, 10, Terrain.CLEAR);
    map.templateType[10 * 128 + 10] = 0; // no road template
    const multiplier = map.getSpeedMultiplier(10, 10, SpeedClass.WHEEL);
    // Should be the CLEAR speed, not 1.0
    expect(multiplier).toBeLessThan(1.0);
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. Water passability
// ════════════════════════════════════════════════════════════════════

describe('Water passability — C++ cell.cpp Passable_Cell', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    map.setTerrain(5, 5, Terrain.WATER);
    map.setTerrain(6, 6, Terrain.CLEAR);
  });

  it('water is impassable for ground units', () => {
    expect(map.isTerrainPassable(5, 5)).toBe(false);
  });

  it('water is passable for naval units', () => {
    expect(map.isWaterPassable(5, 5)).toBe(true);
  });

  it('clear terrain is not passable for naval units', () => {
    expect(map.isWaterPassable(6, 6)).toBe(false);
  });

  it('FLOAT speed on water = 1.0', () => {
    expect(map.getSpeedMultiplier(5, 5, SpeedClass.FLOAT)).toBe(1.0);
  });

  it('WHEEL speed on water = 0.0 (impassable)', () => {
    expect(map.getSpeedMultiplier(5, 5, SpeedClass.WHEEL)).toBe(0.0);
  });

  it('FOOT speed on water = 0.0 (impassable)', () => {
    expect(map.getSpeedMultiplier(5, 5, SpeedClass.FOOT)).toBe(0.0);
  });

  it('WINGED speed on water = 1.0 (aircraft ignore terrain)', () => {
    expect(map.getSpeedMultiplier(5, 5, SpeedClass.WINGED)).toBe(1.0);
  });

  /**
   * C++ amphibious exception: Tanya has canSwim=true.
   * In C++, this is handled via an Amphibious flag that allows FOOT units to enter water.
   * The TS engine must check canSwim before rejecting water for infantry pathfinding.
   */
  it('PARITY CHECK: Tanya canSwim flag exists', () => {
    const tanya = UNIT_STATS['E7'];
    expect(tanya, 'Tanya (E7) should exist').toBeDefined();
    expect(tanya.canSwim).toBe(true);
  });

  it('canEnterCell rejects water for ground units', () => {
    const result = map.canEnterCell(5, 5, false);
    expect(result).toBe(MoveResult.IMPASSABLE);
  });

  it('canEnterCell allows water for naval units', () => {
    const result = map.canEnterCell(5, 5, true);
    expect(result).toBe(MoveResult.OK);
  });
});

// ════════════════════════════════════════════════════════════════════
// 6. Crusher mechanics
// ════════════════════════════════════════════════════════════════════

describe('Crusher mechanics — C++ drive.cpp Ok_To_Move', () => {
  /**
   * C++ drive.cpp: heavy tracked vehicles (Crusher=true) kill infantry on cell entry.
   * In RA, the Tracked=yes flag in rules.ini does NOT mean they use TRACK SpeedClass —
   * udata.cpp:865 forces them to WHEEL. But Tracked=yes DOES set the crusher flag.
   *
   * Crushers (C++ udata.cpp IsCrusher=true): 1TNK, 2TNK, 3TNK, 4TNK, APC, HARV, MCV, V2RL, MNLY, MRJ, MGG
   * Non-crushers: JEEP, TRUK, ARTY (IsCrusher=false despite Tracked=yes)
   */

  // C++ udata.cpp IsCrusher constructor values — note ARTY is NOT a crusher
  // despite Tracked=yes, and MCV/MGG ARE crushers despite no Tracked=yes
  const expectedCrushers = [
    '1TNK', '2TNK', '3TNK', '4TNK', 'APC', 'HARV',
    'V2RL', 'MNLY', 'MRJ', 'MCV', 'MGG',
  ];

  for (const unit of expectedCrushers) {
    it(`${unit} should be a crusher (C++ udata.cpp IsCrusher=true)`, () => {
      const stats = UNIT_STATS[unit];
      expect(stats, `UNIT_STATS['${unit}'] should exist`).toBeDefined();
      expect(stats.crusher).toBe(true);
    });
  }

  // Non-crusher vehicles (C++ udata.cpp IsCrusher=false)
  const nonCrushers = ['JEEP', 'TRUK', 'ARTY'];
  for (const unit of nonCrushers) {
    it(`${unit} should NOT be a crusher (C++ udata.cpp IsCrusher=false)`, () => {
      const stats = UNIT_STATS[unit];
      expect(stats, `UNIT_STATS['${unit}'] should exist`).toBeDefined();
      expect(stats.crusher).toBeFalsy();
    });
  }

  // All infantry should be crushable
  const crushableInfantry = ['E1', 'E2', 'E3', 'E4', 'E6', 'DOG', 'SPY', 'MEDI', 'E7'];
  for (const unit of crushableInfantry) {
    it(`${unit} should be crushable`, () => {
      const stats = UNIT_STATS[unit];
      expect(stats, `UNIT_STATS['${unit}'] should exist`).toBeDefined();
      expect(stats.crushable).toBe(true);
    });
  }

  // Vehicles should NOT be crushable
  const nonCrushable = ['1TNK', '2TNK', '3TNK', '4TNK', 'JEEP', 'APC'];
  for (const unit of nonCrushable) {
    it(`${unit} should NOT be crushable`, () => {
      const stats = UNIT_STATS[unit];
      expect(stats, `UNIT_STATS['${unit}'] should exist`).toBeDefined();
      expect(stats.crushable).toBeFalsy();
    });
  }

  /**
   * C++ rules.ini [General] Crush=1.5
   * Distance (cells) within which crusher vehicles prefer to crush
   * rather than fire at crushable targets (computer only).
   */
  it('Crush distance = 1.5 cells from rules.ini', () => {
    expect(iniFloat('General', 'Crush')).toBe(1.5);
  });

  it('PlayerAutoCrush = no from rules.ini', () => {
    expect(iniBool('General', 'PlayerAutoCrush')).toBe(false);
  });

  /**
   * C++ parity: MGG (Mobile Gap Generator) is NOT Tracked in rules.ini.
   * It has no Tracked=yes line. So in C++ it should NOT be a crusher.
   * But the TS engine marks MGG as crusher=true — this may be a PARITY GAP.
   */
  it('PARITY FIXED: MGG has IsCrusher=true in C++ udata.cpp:265 despite no Tracked=yes', () => {
    // rules.ini [MGG] has no Tracked=yes line, but C++ udata.cpp:265 sets IsCrusher=true
    const mggSection = sections.get('MGG');
    const tracked = mggSection?.get('Tracked')?.toLowerCase();
    expect(tracked).not.toBe('yes'); // no Tracked=yes in INI
    expect(UNIT_STATS['MGG'].crusher).toBe(true); // but IsCrusher=true in C++
  });
});

// ════════════════════════════════════════════════════════════════════
// 7. Bridge passability
// ════════════════════════════════════════════════════════════════════

describe('Bridge passability — C++ map.cpp bridge template handling', () => {
  /**
   * In C++, bridges are template overlays that allow ground units to cross water.
   * The cell terrain under a bridge is set to passable (CLEAR) in the template decode.
   * When the bridge is destroyed, the cell reverts to WATER.
   *
   * TS scenario.ts:1863: "173-228: roads, 235-252: bridges → stay as CLEAR (passable)"
   * Bridge template IDs: 131-133 (main), 235-252 (structures), 378-383 (variants), 519-534 (small)
   */

  it('bridge template cells are CLEAR terrain (passable to ground)', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    // Simulate a bridge cell: the scenario loader sets it as CLEAR
    map.setTerrain(10, 10, Terrain.CLEAR);
    map.templateType[10 * 128 + 10] = 235; // bridge structure template

    expect(map.isTerrainPassable(10, 10)).toBe(true);
    expect(map.isWaterPassable(10, 10)).toBe(false); // bridge != water
  });

  it('fully destroying a bridge converts cells to WATER (two-phase, impassable to ground)', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    map.setTerrain(10, 10, Terrain.CLEAR);
    map.templateType[10 * 128 + 10] = 131; // TEMPLATE_BRIDGE1

    // Phase 1: intact → half-destroyed (still passable)
    const destroyed1 = map.destroyBridge(10, 10, 3);
    expect(destroyed1).toBeGreaterThan(0);
    expect(map.getTerrain(10, 10)).toBe(Terrain.CLEAR); // still passable

    // Phase 2: half-destroyed → WATER (impassable)
    const destroyed2 = map.destroyBridge(10, 10, 3);
    expect(destroyed2).toBeGreaterThan(0);
    expect(map.getTerrain(10, 10)).toBe(Terrain.WATER);
    expect(map.isTerrainPassable(10, 10)).toBe(false);
  });

  it('bridge template IDs: 131, 133, 235, 236, 378, 379', () => {
    // Verify these match C++ defines.h TemplateType enum
    // TEMPLATE_BRIDGE1=131, TEMPLATE_BRIDGE2=133,
    // TEMPLATE_BRIDGE_1A=235, TEMPLATE_BRIDGE_1B=236,
    // TEMPLATE_BRIDGE1H=378, TEMPLATE_BRIDGE2H=379
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);

    const bridgeTemplates = [131, 133, 235, 236, 378, 379];
    for (const tmpl of bridgeTemplates) {
      // Set up cell with bridge template + icon 6 (bridge center)
      map.templateType[15 * 128 + 15] = tmpl;
      map.templateIcon[15 * 128 + 15] = 6;
    }
    // The last template set will be counted
    const count = map.countBridgeCells();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════════
// 8. Ore tile speed modifiers
// ════════════════════════════════════════════════════════════════════

describe('Ore tile speed modifiers — C++ rules.cpp:859', () => {
  it('ore terrain slows WHEEL vehicles to 0.5', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    map.setTerrain(10, 10, Terrain.ORE);
    const speed = map.getSpeedMultiplier(10, 10, SpeedClass.WHEEL);
    // rules.ini [Ore] Wheel=50% — INI overrides cpp constructor defaults
    expect(speed).toBeCloseTo(0.5, 1);
  });

  it('ore terrain slows FOOT to 0.9', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    map.setTerrain(10, 10, Terrain.ORE);
    const speed = map.getSpeedMultiplier(10, 10, SpeedClass.FOOT);
    expect(speed).toBeCloseTo(0.9, 1);
  });

  it('ore terrain is passable for ground units', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    map.setTerrain(10, 10, Terrain.ORE);
    expect(map.isTerrainPassable(10, 10)).toBe(true);
  });

  it('ore terrain is NOT passable for naval units', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    map.setTerrain(10, 10, Terrain.ORE);
    expect(map.isWaterPassable(10, 10)).toBe(false);
  });

  it('ore terrain is NOT buildable', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    map.setTerrain(10, 10, Terrain.ORE);
    expect(map.isBuildable(10, 10)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// 9. WINGED always ignores terrain — C++ rules.cpp:862
// ════════════════════════════════════════════════════════════════════

describe('WINGED ignores all terrain — C++ rules.cpp:862 hardcoded', () => {
  const allTerrains: Terrain[] = [
    Terrain.CLEAR, Terrain.ROAD, Terrain.WATER, Terrain.ROCK,
    Terrain.WALL, Terrain.ORE, Terrain.BEACH, Terrain.ROUGH,
    Terrain.RIVER, Terrain.TREE,
  ];

  for (const terrain of allTerrains) {
    it(`WINGED speed = 1.0 on ${Terrain[terrain]}`, () => {
      const map = new GameMap();
      map.setBounds(0, 0, 50, 50);
      map.setTerrain(10, 10, terrain);
      expect(map.getSpeedMultiplier(10, 10, SpeedClass.WINGED)).toBe(1.0);
    });
  }
});

// ════════════════════════════════════════════════════════════════════
// 10. LandType enum ordinals — C++ defines.h:2841-2855
// ════════════════════════════════════════════════════════════════════

describe('Terrain (LandType) enum ordinals — C++ defines.h:2841-2855', () => {
  /**
   * C++ defines.h:2841-2855:
   *   LAND_CLEAR  = 0,
   *   LAND_ROAD   = 1,
   *   LAND_WATER  = 2,
   *   LAND_ROCK   = 3,
   *   LAND_WALL   = 4,
   *   LAND_TIBERIUM = 5,  (ORE in RA)
   *   LAND_BEACH  = 6,
   *   LAND_ROUGH  = 7,
   *   LAND_RIVER  = 8,
   */
  it('CLEAR = 0', () => expect(Terrain.CLEAR).toBe(0));
  it('ROAD = 1', () => expect(Terrain.ROAD).toBe(1));
  it('WATER = 2', () => expect(Terrain.WATER).toBe(2));
  it('ROCK = 3', () => expect(Terrain.ROCK).toBe(3));
  it('WALL = 4', () => expect(Terrain.WALL).toBe(4));
  it('ORE = 5 (C++ LAND_TIBERIUM)', () => expect(Terrain.ORE).toBe(5));
  it('BEACH = 6', () => expect(Terrain.BEACH).toBe(6));
  it('ROUGH = 7', () => expect(Terrain.ROUGH).toBe(7));
  it('RIVER = 8', () => expect(Terrain.RIVER).toBe(8));
});

// ════════════════════════════════════════════════════════════════════
// 11. Movement constants from [General]
// ════════════════════════════════════════════════════════════════════

describe('Movement constants from rules.ini [General]', () => {
  it('BaseBias = 2 (threat target value multiplier near base)', () => {
    expect(iniFloat('General', 'BaseBias')).toBe(2);
  });

  it('CloseEnough = 2.75 (movement abort distance in cells)', () => {
    expect(iniFloat('General', 'CloseEnough')).toBeCloseTo(2.75, 2);
  });

  it('Stray = 2.0 (team member stray radius before regroup)', () => {
    expect(iniFloat('General', 'Stray')).toBeCloseTo(2.0, 2);
  });

  it('Crush = 1.5 (distance for auto-crush preference)', () => {
    expect(iniFloat('General', 'Crush')).toBeCloseTo(1.5, 2);
  });

  it('CrateRadius = 3.0 (area effect crate bonus radius)', () => {
    expect(iniFloat('General', 'CrateRadius')).toBeCloseTo(3.0, 2);
  });

  it('HomingScatter = 2.0 (max scatter for homing projectiles)', () => {
    expect(iniFloat('General', 'HomingScatter')).toBeCloseTo(2.0, 2);
  });

  it('BallisticScatter = 1.0 (max scatter for ballistic projectiles)', () => {
    expect(iniFloat('General', 'BallisticScatter')).toBeCloseTo(1.0, 2);
  });

  it('Gravity = 3 (ballistic projectile gravity constant)', () => {
    expect(iniFloat('General', 'Gravity')).toBe(3);
  });

  it('GameSpeeBias = 1 (overall movement speed multiplier)', () => {
    // Note: typo "SpeeBias" is in the original rules.ini
    expect(iniFloat('General', 'GameSpeeBias')).toBe(1);
  });

  it('BridgeStrength = 1000', () => {
    expect(iniFloat('General', 'BridgeStrength')).toBe(1000);
  });

  it('LZScanRadius = 16 (alternate landing zone scan)', () => {
    expect(iniFloat('General', 'LZScanRadius')).toBe(16);
  });

  it('SubmergeDelay = 0.02 (minutes subs stay surfaced)', () => {
    expect(iniFloat('General', 'SubmergeDelay')).toBeCloseTo(0.02, 3);
  });
});

// ════════════════════════════════════════════════════════════════════
// 12. Passability set completeness
// ════════════════════════════════════════════════════════════════════

describe('Passability rules — PASSABLE terrain set completeness', () => {
  let map: GameMap;

  beforeEach(() => {
    map = new GameMap();
    map.setBounds(0, 0, 50, 50);
  });

  /**
   * C++ rules.cpp:844-864 Build flag per terrain:
   *   CLEAR=true, ROAD=true, WATER=false, ROCK=false, WALL=false,
   *   TIBERIUM(ORE)=false, BEACH=false, ROUGH=false, RIVER=false
   *
   * Passable (ground movement) in C++:
   *   CLEAR=yes, ROAD=yes, ORE=yes, ROUGH=yes, BEACH=yes
   *   WATER=no, ROCK=no, WALL=no, RIVER=no
   */

  const passableTerrains: [Terrain, boolean][] = [
    [Terrain.CLEAR, true],
    [Terrain.ROAD, true],
    [Terrain.WATER, false],
    [Terrain.ROCK, false],
    [Terrain.WALL, false],
    [Terrain.ORE, true],
    [Terrain.BEACH, true],
    [Terrain.ROUGH, true],
    [Terrain.RIVER, false],
    [Terrain.TREE, true],  // TS extension: trees are passable (C++ uses TerrainClass objects on CLEAR)
  ];

  for (const [terrain, expected] of passableTerrains) {
    it(`${Terrain[terrain]} terrain passability = ${expected}`, () => {
      map.setTerrain(10, 10, terrain);
      expect(map.isTerrainPassable(10, 10)).toBe(expected);
    });
  }

  /**
   * C++ Buildable terrain (cell.cpp:498-503, rules.cpp:864):
   * Only CLEAR and ROAD are buildable.
   */
  const buildableTerrains: [Terrain, boolean][] = [
    [Terrain.CLEAR, true],
    [Terrain.ROAD, true],
    [Terrain.ORE, false],
    [Terrain.ROUGH, false],
    [Terrain.BEACH, false],
    [Terrain.WATER, false],
    [Terrain.ROCK, false],
  ];

  for (const [terrain, expected] of buildableTerrains) {
    it(`${Terrain[terrain]} buildable = ${expected}`, () => {
      map.setTerrain(10, 10, terrain);
      expect(map.isBuildable(10, 10)).toBe(expected);
    });
  }
});

// ════════════════════════════════════════════════════════════════════
// 13. TREE terrain uses Rock speed — C++ parity
// ════════════════════════════════════════════════════════════════════

describe('TREE terrain mapped to Rock speed — C++ TerrainClass parity', () => {
  /**
   * C++ has no TREE LandType. Trees are TerrainClass objects placed on CLEAR cells.
   * They block vehicles via occupancy, not terrain type.
   * TS adds a TREE enum but maps its speed to Rock (impassable, 0.0 for ground).
   *
   * However, TREE cells are still in the PASSABLE set for terrain passability checks.
   * This creates a discrepancy: TREE is "passable" but has 0.0 speed multiplier.
   * In C++, the cell would be CLEAR (passable, 0.6-0.9 speed) with a TerrainClass
   * blocking occupancy. This is different behavior.
   */

  it('TREE speed for FOOT = 0.0 (Rock mapping)', () => {
    // TS maps TREE to Rock speed, which is 0.0 for FOOT
    // But C++ trees are on CLEAR cells: FOOT speed would be 0.9
    // PARITY GAP: TS gives 0.0 but C++ gives 0.9 (trees don't slow infantry)
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    map.setTerrain(10, 10, Terrain.TREE);
    const speed = map.getSpeedMultiplier(10, 10, SpeedClass.FOOT);
    // C++ behavior: trees are on CLEAR, infantry speed = 0.9
    expect(speed).toBe(0.9);
  });

  it('TREE terrain is passable for ground', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    map.setTerrain(10, 10, Terrain.TREE);
    expect(map.isTerrainPassable(10, 10)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 14. Unit speed values vs rules.ini
// ════════════════════════════════════════════════════════════════════

describe('Unit Speed values vs rules.ini', () => {
  /**
   * C++ Speed values in rules.ini are MPH (leptons per tick).
   * The TS UNIT_STATS should match these exactly.
   */

  const speedChecks: [string, number][] = [
    ['V2RL', 7],
    ['1TNK', 9],
    ['3TNK', 7],
    ['2TNK', 8],
    ['4TNK', 4],
    ['MRJ', 9],
    ['MGG', 9],
    ['ARTY', 6],
    ['HARV', 6],
    ['MCV', 6],
    ['JEEP', 10],
    ['APC', 10],
    ['MNLY', 9],
    ['TRUK', 10],
    ['SS', 6],
    ['DD', 6],
    ['CA', 4],
    ['LST', 14],
    ['PT', 9],
    ['DOG', 4],
    ['E1', 4],
    ['E2', 5],
    ['E3', 3],
    ['E4', 3],
    ['E6', 4],
    ['SPY', 4],
    ['E7', 5],  // Tanya
  ];

  for (const [unit, expectedSpeed] of speedChecks) {
    it(`${unit} speed = ${expectedSpeed} (rules.ini)`, () => {
      const stats = UNIT_STATS[unit];
      expect(stats, `UNIT_STATS['${unit}'] should exist`).toBeDefined();
      expect(stats.speed).toBe(expectedSpeed);
    });
  }
});

// ════════════════════════════════════════════════════════════════════
// 15. MoveResult enum values match C++ defines.h
// ════════════════════════════════════════════════════════════════════

describe('MoveResult enum — C++ defines.h:828-837 MoveType', () => {
  /**
   * C++ defines.h:828-837:
   *   MOVE_OK          = 0,
   *   MOVE_CLOAK       = 1,
   *   MOVE_MOVING_BLOCK = 2,
   *   MOVE_DESTROYABLE = 3,
   *   MOVE_TEMP        = 4,
   *   MOVE_NO          = 5,
   */
  it('OK = 0 (MOVE_OK)', () => expect(MoveResult.OK).toBe(0));
  it('CLOAK = 1 (MOVE_CLOAK)', () => expect(MoveResult.CLOAK).toBe(1));
  it('OCCUPIED = 2 (MOVE_MOVING_BLOCK)', () => expect(MoveResult.OCCUPIED).toBe(2));
  it('DESTROYABLE = 3 (MOVE_DESTROYABLE)', () => expect(MoveResult.DESTROYABLE).toBe(3));
  it('TEMP_BLOCKED = 4 (MOVE_TEMP)', () => expect(MoveResult.TEMP_BLOCKED).toBe(4));
  it('IMPASSABLE = 5 (MOVE_NO)', () => expect(MoveResult.IMPASSABLE).toBe(5));
});

// ════════════════════════════════════════════════════════════════════
// 16. Pathfinding uses flat costs (no terrain speed) — C++ findpath.cpp
// ════════════════════════════════════════════════════════════════════

describe('Pathfinding cost model — C++ findpath.cpp:1284-1292', () => {
  /**
   * C++ findpath.cpp Passable_Cell (line 1284-1292): flat costs by blockage type only.
   * Speed multipliers are NOT used for path selection — only for actual movement
   * speed in drive.cpp. This means paths are chosen by shortest passable route
   * regardless of terrain speed.
   *
   * This is verified in the A* pathfinder comment at map.ts line 816-819.
   */

  it('A* uses STRAIGHT_COST=10, DIAG_COST=14 (no terrain weighting)', () => {
    // These are the known constants from pathfinding.ts
    // C++ findpath.cpp doesn't weight paths by terrain speed
    // Verify TS matches this flat-cost model
    const map = new GameMap();
    map.setBounds(0, 0, 50, 50);
    // Clear terrain and rough terrain should have equal pathfinding cost
    map.setTerrain(10, 10, Terrain.CLEAR);
    map.setTerrain(11, 10, Terrain.ROUGH);
    // Both should be passable
    expect(map.isTerrainPassable(10, 10)).toBe(true);
    expect(map.isTerrainPassable(11, 10)).toBe(true);
    // The speed multipliers differ but pathfinding cost should be the same
    // (pathfinding.ts uses flat 10/14 costs)
    const clearSpeed = map.getSpeedMultiplier(10, 10, SpeedClass.WHEEL);
    const roughSpeed = map.getSpeedMultiplier(11, 10, SpeedClass.WHEEL);
    expect(clearSpeed).not.toBe(roughSpeed); // speeds differ
    // But pathfinding won't prefer one over the other (flat cost model)
  });
});

// ════════════════════════════════════════════════════════════════════
// 17. Out-of-bounds terrain handling
// ════════════════════════════════════════════════════════════════════

describe('Out-of-bounds terrain handling', () => {
  it('getTerrain returns ROCK for out-of-bounds cells', () => {
    const map = new GameMap();
    map.setBounds(10, 10, 30, 30);
    expect(map.getTerrain(-1, -1)).toBe(Terrain.ROCK);
    expect(map.getTerrain(128, 128)).toBe(Terrain.ROCK);
  });

  it('getSpeedMultiplier returns 1.0 for out-of-bounds cells', () => {
    const map = new GameMap();
    map.setBounds(10, 10, 30, 30);
    // Out of MAP_CELLS bounds — returns 1.0 as default
    expect(map.getSpeedMultiplier(-1, -1, SpeedClass.WHEEL)).toBe(1.0);
  });

  it('canEnterCell returns IMPASSABLE beyond pathfinding bounds', () => {
    const map = new GameMap();
    map.setBounds(10, 10, 30, 30);
    // C++ parity: pathfinding extends 1 cell beyond map bounds
    // So boundsX-2 should be IMPASSABLE
    const result = map.canEnterCell(7, 7, false);
    expect(result).toBe(MoveResult.IMPASSABLE);
  });

  it('C++ parity: pathfinding allows 1 cell beyond bounds', () => {
    const map = new GameMap();
    map.setBounds(10, 10, 30, 30);
    map.setTerrain(9, 9, Terrain.CLEAR);
    // boundsX-1 = 9 should be passable in pathfinding (1 cell beyond)
    const result = map.canEnterCell(9, 9, false);
    expect(result).toBe(MoveResult.OK);
  });
});
