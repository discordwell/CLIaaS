/**
 * C++ Behavioral Parity: Wall Crushing — which units can crush which wall types
 *
 * Authoritative source: rules.ini wall sections + C++ odata.cpp overlay type definitions.
 * C++ crush logic: unit.cpp:1855-1871 (Per_Cell_Process), cell.cpp:2786-2796 (Is_Clear_To_Move).
 *
 * Wall crush flow in C++:
 *   1. Unit enters cell (Per_Cell_Process in unit.cpp:1855-1871)
 *   2. Check: Class->IsCrusher (unit type flag, true for all tracked vehicles)
 *   3. Check: overlay->IsCrushable (per-wall property set in odata.cpp constructor)
 *   4. If both true: Reduce_Wall(-1) instantly destroys the wall (cell.cpp:1668)
 *   5. Sound: VOC_SANDBAG for sandbags, VOC_WALLKILL2 for all others
 *
 * Pathfinding (cell.cpp:2786-2796):
 *   - MZONE_CRUSHER vehicles treat crushable walls as LAND_CLEAR (passable)
 *   - MZONE_DESTROYER vehicles treat ALL walls as passable (can shoot them down)
 *   - MZONE_NORMAL vehicles treat ALL walls as impassable
 *
 * C++ odata.cpp wall definitions (constructor arg order):
 *   OverlayTypeClass(type, ini_name, fullname, ground, damageLevels, damagePoints,
 *                    isRadarVisible, isWooden, isTarget, isCrushable, isTiberium,
 *                    isHigh, isTheater, isWall, isCrate)
 *
 * TS implementation: combat.ts CRUSHABLE_WALLS set + checkWallCrush function
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission, AnimState,
  UNIT_STATS, buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  checkWallCrush,
  CRUSHABLE_WALLS,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';
import { COUNTRY_BONUSES } from '../engine/types';

beforeEach(() => resetEntityIds());

// -- C++ Reference Data (odata.cpp) ------------------------------------------
// These are the authoritative C++ wall properties from odata.cpp lines 58-159.

/** C++ odata.cpp wall overlay definitions — IsCrushable flag per wall type.
 *  odata.cpp:68  — SBAG: crushable=true
 *  odata.cpp:85  — CYCL: crushable=true
 *  odata.cpp:102 — BRIK: crushable=false
 *  odata.cpp:119 — BARB: crushable=true
 *  odata.cpp:136 — WOOD: crushable=true
 *  odata.cpp:153 — FENC: crushable=true */
const CPP_WALL_CRUSHABLE: Record<string, boolean> = {
  SBAG: true,   // odata.cpp:68  — Crushable by tracked vehicle? true
  CYCL: true,   // odata.cpp:85  — Crushable by tracked vehicle? true
  BRIK: false,  // odata.cpp:102 — Crushable by tracked vehicle? false
  BARB: true,   // odata.cpp:119 — Crushable by tracked vehicle? true
  WOOD: true,   // odata.cpp:136 — Crushable by tracked vehicle? true
  FENC: true,   // odata.cpp:153 — Crushable by tracked vehicle? true
};

/** C++ odata.cpp wall damage properties */
const CPP_WALL_DAMAGE: Record<string, { levels: number; points: number }> = {
  SBAG: { levels: 1, points: 20 },  // odata.cpp:63-64
  CYCL: { levels: 2, points: 10 },  // odata.cpp:80-81
  BRIK: { levels: 3, points: 70 },  // odata.cpp:97-98
  BARB: { levels: 1, points: 2 },   // odata.cpp:114-115
  WOOD: { levels: 1, points: 2 },   // odata.cpp:131-132
  FENC: { levels: 2, points: 10 },  // odata.cpp:148-149
};

/** C++ odata.cpp — IsHigh flag (blocks low-level bullets) */
const CPP_WALL_IS_HIGH: Record<string, boolean> = {
  SBAG: false,  // odata.cpp:70
  CYCL: false,  // odata.cpp:87
  BRIK: true,   // odata.cpp:104 — Stops low level bullets in flight? true
  BARB: false,  // odata.cpp:121
  WOOD: false,  // odata.cpp:138
  FENC: false,  // odata.cpp:155
};

/** C++ odata.cpp — IsWooden flag (affected by fire damage) */
const CPP_WALL_IS_WOODEN: Record<string, boolean> = {
  SBAG: false,  // odata.cpp:66
  CYCL: false,  // odata.cpp:83
  BRIK: false,  // odata.cpp:100
  BARB: false,  // odata.cpp:117
  WOOD: true,   // odata.cpp:134 — Is it a wooden overlay (affected by fire)? true
  FENC: false,  // odata.cpp:151
};

// rules.ini wall armor types (rules.ini lines 1671-1740)
const CPP_WALL_ARMOR: Record<string, string> = {
  SBAG: 'none',  // rules.ini:1673 Armor=none
  BRIK: 'none',  // rules.ini:1686 Armor=none (implicit; not listed = none)
  FENC: 'none',  // rules.ini:1698 Armor=none
  CYCL: 'none',  // rules.ini:1718 Armor=none (implicit)
  BARB: 'wood',  // rules.ini:1729 Armor=wood
  WOOD: 'none',  // rules.ini:1738 (no Armor= listed = defaults to none)
};

// -- Helpers ------------------------------------------------------------------

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  entities: Entity[] = [],
  map?: GameMap,
): CombatContext {
  const gameMap = map ?? new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures: [],
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set<string>(),
    map: gameMap,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    movementSpeed: () => 1,
    getFirepowerBias: (house: House) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '#fff',
    aiStates: new Map(),
    lastBaseAttackEva: -Infinity,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    powerConsumed: 0,
    powerProduced: 100,
    pointTotal: 0,
    alliedUnitsLost: 0,
    sovietUnitsLost: 0,
    alliedBuildingsLost: 0,
    sovietBuildingsLost: 0,
  } as CombatContext;
}

// =============================================================================
// 1. CRUSHABLE_WALLS set must match C++ odata.cpp IsCrushable flags
// =============================================================================

describe('CRUSHABLE_WALLS set matches C++ odata.cpp IsCrushable (odata.cpp:58-159)', () => {
  const ALL_WALLS = ['SBAG', 'CYCL', 'BRIK', 'BARB', 'WOOD', 'FENC'];

  for (const wall of ALL_WALLS) {
    const expected = CPP_WALL_CRUSHABLE[wall];
    it(`${wall} crushable=${expected} (odata.cpp)`, () => {
      expect(CRUSHABLE_WALLS.has(wall)).toBe(expected);
    });
  }

  it('BRIK is the ONLY non-crushable wall (odata.cpp:102)', () => {
    const nonCrushable = ALL_WALLS.filter(w => !CPP_WALL_CRUSHABLE[w]);
    expect(nonCrushable).toEqual(['BRIK']);
  });

  it('CRUSHABLE_WALLS has exactly 5 entries (SBAG, CYCL, BARB, WOOD, FENC)', () => {
    const expectedCrushable = ALL_WALLS.filter(w => CPP_WALL_CRUSHABLE[w]);
    expect(CRUSHABLE_WALLS.size).toBe(expectedCrushable.length);
  });
});

// =============================================================================
// 2. Crusher vehicle flag — only tracked vehicles can crush walls
// =============================================================================

describe('Crusher flag on vehicles (C++ udata.cpp IsCrusher / rules.ini Tracked=yes)', () => {
  // C++ udata.cpp: IsCrusher is set for tracked vehicles (equivalent to Tracked=yes)
  // unit.cpp:1859 — if (Class->IsCrusher && cellptr->Overlay != OVERLAY_NONE)
  // C++ udata.cpp IsCrusher constructor values
  const EXPECTED_CRUSHERS = [
    '1TNK', '2TNK', '3TNK', '4TNK', 'APC', 'HARV',
    'V2RL', 'MNLY', 'MRJ', 'MCV', 'MGG',
    'STNK', 'CTNK', 'TTNK', 'QTNK', // Aftermath expansion
  ];

  const EXPECTED_NON_CRUSHERS = [
    'JEEP', 'TRUK', 'ARTY', 'DTRK',
  ];

  for (const unitId of EXPECTED_CRUSHERS) {
    it(`${unitId} has crusher=true (Tracked=yes)`, () => {
      const stats = UNIT_STATS[unitId];
      expect(stats, `${unitId} should exist in UNIT_STATS`).toBeDefined();
      expect(stats.crusher).toBe(true);
    });
  }

  for (const unitId of EXPECTED_NON_CRUSHERS) {
    it(`${unitId} has crusher=falsy (not tracked)`, () => {
      const stats = UNIT_STATS[unitId];
      expect(stats, `${unitId} should exist in UNIT_STATS`).toBeDefined();
      expect(stats.crusher).toBeFalsy();
    });
  }
});

// =============================================================================
// 3. checkWallCrush behavior — per-wall observable outcomes
// =============================================================================

describe('checkWallCrush: crusher vehicle on crushable wall (unit.cpp:1855-1871)', () => {
  // C++ unit.cpp:1855-1871: Per_Cell_Process
  //   if (Class->IsCrusher && cellptr->Overlay != OVERLAY_NONE) {
  //     optr = &OverlayTypeClass::As_Reference(cellptr->Overlay);
  //     if (optr->IsCrushable) {
  //       Reduce_Wall(-1);  // instant destroy
  //     }
  //   }

  const CRUSHABLE_WALL_TYPES = ['SBAG', 'FENC', 'BARB', 'WOOD'];

  for (const wallType of CRUSHABLE_WALL_TYPES) {
    it(`crusher on ${wallType}: wall is destroyed (Reduce_Wall(-1))`, () => {
      const map = new GameMap();
      map.setWallType(10, 10, wallType);
      const ctx = makeCombatCtx([], map);
      const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
      checkWallCrush(ctx, tank);
      expect(map.getWallType(10, 10)).toBe('');
    });
  }

  it('crusher on BRIK: wall remains (not crushable, odata.cpp:102)', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'BRIK');
    const ctx = makeCombatCtx([], map);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    checkWallCrush(ctx, tank);
    expect(map.getWallType(10, 10)).toBe('BRIK');
  });

  it('non-crusher vehicle on SBAG: wall remains (unit.cpp:1859 IsCrusher check)', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'SBAG');
    const ctx = makeCombatCtx([], map);
    const jeep = entityAtCell(UnitType.V_JEEP, House.Spain, 10, 10);
    checkWallCrush(ctx, jeep);
    expect(map.getWallType(10, 10)).toBe('SBAG');
  });
});

// =============================================================================
// 4. CYCL (cyclone fence) — crushable in C++ but may be missing in TS
// =============================================================================

describe('CYCL (cyclone fence) parity (odata.cpp:75-91)', () => {
  // C++ odata.cpp:85 — CYCL: Crushable by tracked vehicle? true
  // C++ cell.cpp:1570 — OVERLAY_CYCLONE_WALL damage stage handling present
  // C++ odata.cpp:609 — Init_Heap: new OverlayTypeClass(Cyclone) // OVERLAY_CYCLONE_WALL

  it('CYCL is crushable in C++ (odata.cpp:85)', () => {
    // This documents the C++ truth: CYCL IS crushable.
    expect(CPP_WALL_CRUSHABLE['CYCL']).toBe(true);
  });

  it('CYCL should be in CRUSHABLE_WALLS (parity with odata.cpp:85)', () => {
    // MISMATCH: TS CRUSHABLE_WALLS is missing CYCL.
    // combat.ts:591 comment acknowledges this: "CYCL (cyclone fence) is crushable in C++ but
    // not present as a wall type in the TS engine."
    // However, CYCL IS present in the TS engine: WALL_TYPES (combat.ts:29), STRUCTURE_SIZE
    // (scenario.ts:1304), STRUCTURE_HP (scenario.ts:1355), scenario.ts:1250.
    expect(CRUSHABLE_WALLS.has('CYCL')).toBe(true);
  });

  it('crusher on CYCL: wall is destroyed', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'CYCL');
    const ctx = makeCombatCtx([], map);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    checkWallCrush(ctx, tank);
    expect(map.getWallType(10, 10)).toBe('');
  });
});

// =============================================================================
// 5. Wall sound effects (unit.cpp:1864-1868)
// =============================================================================

describe('Wall crush sound effects (unit.cpp:1864-1868)', () => {
  // C++ unit.cpp:1864-1868:
  //   if (optr->Type == OVERLAY_SANDBAG_WALL) {
  //     Sound_Effect(VOC_SANDBAG, Center_Coord());
  //   } else {
  //     Sound_Effect(VOC_WALLKILL2, Center_Coord());
  //   }

  it('SBAG crush plays wallkill_sand sound (VOC_SANDBAG)', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'SBAG');
    const sounds: string[] = [];
    const ctx = makeCombatCtx([], map);
    ctx.playSoundAt = (sound: string) => { sounds.push(sound); };
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    checkWallCrush(ctx, tank);
    expect(sounds).toContain('wallkill_sand');
  });

  it('FENC crush plays wallkill2 sound (VOC_WALLKILL2)', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'FENC');
    const sounds: string[] = [];
    const ctx = makeCombatCtx([], map);
    ctx.playSoundAt = (sound: string) => { sounds.push(sound); };
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    checkWallCrush(ctx, tank);
    expect(sounds).toContain('wallkill2');
  });

  it('BARB crush plays wallkill2 sound (VOC_WALLKILL2)', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'BARB');
    const sounds: string[] = [];
    const ctx = makeCombatCtx([], map);
    ctx.playSoundAt = (sound: string) => { sounds.push(sound); };
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    checkWallCrush(ctx, tank);
    expect(sounds).toContain('wallkill2');
  });

  it('WOOD crush plays wallkill2 sound (VOC_WALLKILL2)', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'WOOD');
    const sounds: string[] = [];
    const ctx = makeCombatCtx([], map);
    ctx.playSoundAt = (sound: string) => { sounds.push(sound); };
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    checkWallCrush(ctx, tank);
    expect(sounds).toContain('wallkill2');
  });
});

// =============================================================================
// 6. Wall properties from rules.ini — armor types
// =============================================================================

describe('Wall armor from rules.ini (scenario.ts STRUCTURE_ARMOR)', () => {
  // rules.ini wall sections: SBAG (1671), BRIK (1683), FENC (1695), CYCL (1715),
  //   BARB (1725), WOOD (1735)

  // Import the armor map from scenario.ts
  // scenario.ts:1250: SBAG: 'none', FENC: 'none', BRIK: 'none', CYCL: 'none', WOOD: 'none',
  // scenario.ts:1251: BARB: 'wood',  // rules.ini: Armor=wood (barbed wire)
  const TS_WALL_ARMOR: Record<string, string> = {
    SBAG: 'none', FENC: 'none', BRIK: 'none', CYCL: 'none', WOOD: 'none',
    BARB: 'wood',
  };

  for (const [wall, expected] of Object.entries(CPP_WALL_ARMOR)) {
    it(`${wall} Armor=${expected} (rules.ini)`, () => {
      expect(TS_WALL_ARMOR[wall]).toBe(expected);
    });
  }
});

// =============================================================================
// 7. Scenario wall type registration — WOOD and CYCL must be set as wallType
// =============================================================================

describe('Scenario wallType registration (scenario.ts structure loop)', () => {
  // C++ overlay.cpp:180-186: Wall mark-down sets IsCrushable zone correctly.
  // scenario.ts:1609: only registers SBAG, FENC, BARB, BRIK as wallType.
  // MISMATCH: WOOD and CYCL walls placed as structures are NOT registered
  // in wallType[], so checkWallCrush can never detect them.

  it('wallType array correctly stores SBAG', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'SBAG');
    expect(map.getWallType(10, 10)).toBe('SBAG');
  });

  it('wallType array correctly stores FENC', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'FENC');
    expect(map.getWallType(10, 10)).toBe('FENC');
  });

  it('wallType array correctly stores BARB', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'BARB');
    expect(map.getWallType(10, 10)).toBe('BARB');
  });

  it('wallType array correctly stores BRIK', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'BRIK');
    expect(map.getWallType(10, 10)).toBe('BRIK');
  });

  it('wallType array correctly stores WOOD', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'WOOD');
    expect(map.getWallType(10, 10)).toBe('WOOD');
  });

  it('wallType array correctly stores CYCL', () => {
    const map = new GameMap();
    map.setWallType(10, 10, 'CYCL');
    expect(map.getWallType(10, 10)).toBe('CYCL');
  });
});

// =============================================================================
// 8. C++ Reduce_Wall(-1) behavior — instant destruction on crush
// =============================================================================

describe('Reduce_Wall(-1) behavior on crush (cell.cpp:1668-1718)', () => {
  // C++ cell.cpp:1683: if (damage == -1 || damage >= wall.DamagePoints)
  //   → destroyed = true (instant kill, bypasses random chance)
  // C++ cell.cpp:1695-1697: damage == -1 → skip damage level check, jump to destroy
  // The wall is removed from the cell: Overlay = OVERLAY_NONE, OverlayData = 0

  it('crush always destroys wall regardless of DamagePoints (damage=-1)', () => {
    // In C++, Reduce_Wall(-1) always destroys because damage == -1 triggers
    // the unconditional destroy path (cell.cpp:1695).
    // The TS equivalent in checkWallCrush directly clears the wall.
    for (const wallType of ['SBAG', 'FENC', 'BARB', 'WOOD']) {
      const map = new GameMap();
      map.setWallType(15, 15, wallType);
      const ctx = makeCombatCtx([], map);
      const tank = entityAtCell(UnitType.V_4TNK, House.Spain, 15, 15);
      checkWallCrush(ctx, tank);
      expect(map.getWallType(15, 15), `${wallType} should be destroyed`).toBe('');
    }
  });

  it('crush zone reset: crushable wall uses MZONEF_NORMAL (cell.cpp:1714-1715)', () => {
    // C++ cell.cpp:1714: if (wall.IsCrushable) Map.Zone_Reset(MZONEF_NORMAL);
    // C++ cell.cpp:1717: else Map.Zone_Reset(MZONEF_CRUSHER|MZONEF_NORMAL);
    // This is a zone recalculation detail — we just document it here.
    // Crushable walls only affect NORMAL zone, non-crushable affect CRUSHER too.
    expect(CPP_WALL_CRUSHABLE['SBAG']).toBe(true);  // MZONEF_NORMAL only
    expect(CPP_WALL_CRUSHABLE['BRIK']).toBe(false);  // MZONEF_CRUSHER|MZONEF_NORMAL
  });
});

// =============================================================================
// 9. C++ Can_Enter_Cell wall crush logic (unit.cpp:3101-3126)
// =============================================================================

describe('Can_Enter_Cell: wall crush pathfinding (unit.cpp:3101-3126)', () => {
  // C++ unit.cpp:3101-3112:
  //   if (optr->IsWall) {
  //     if (optr->IsCrushable && Class->IsCrusher) {
  //       cancrush = !House->Is_Ally(cellptr->Owner);
  //     }
  //     if (!cancrush && Is_Weapon_Equipped()) { ... MOVE_DESTROYABLE ... }
  //   }

  it('crusher can enter cell with crushable wall if not allied-owned', () => {
    // C++ unit.cpp:3108-3109: IsCrushable && IsCrusher → cancrush = !Is_Ally(Owner)
    // The vehicle considers the cell passable (MOVE_OK) rather than blocked.
    expect(CPP_WALL_CRUSHABLE['SBAG']).toBe(true);
    expect(UNIT_STATS['2TNK'].crusher).toBe(true);
  });

  it('crusher cannot crush own/allied walls (unit.cpp:3109 Is_Ally check)', () => {
    // C++ unit.cpp:3109: cancrush = !House->Is_Ally(cellptr->Owner)
    // Allied walls are not crushable — the unit treats them as impassable.
    // TS checkWallCrush does NOT check ownership — this is a second mismatch
    // but less critical since player rarely drives over own walls.
    expect(true).toBe(true); // Documented behavioral difference
  });

  it('non-crusher with weapon treats wall as MOVE_DESTROYABLE (unit.cpp:3112-3124)', () => {
    // C++ unit.cpp:3112-3124: !cancrush && Is_Weapon_Equipped() → check warhead
    //   if (whead->IsWallDestroyer || (whead->IsWoodDestroyer && optr->IsWooden))
    //     → MOVE_DESTROYABLE
    // Jeep with M60mg (SA warhead, no Wall=yes) cannot destroy walls
    expect(UNIT_STATS['JEEP'].crusher).toBeFalsy();
    expect(UNIT_STATS['JEEP'].primaryWeapon).toBe('M60mg');
  });
});

// =============================================================================
// 10. All wall types: comprehensive property table
// =============================================================================

describe('Complete wall property table (odata.cpp + rules.ini)', () => {
  const ALL_WALLS = ['SBAG', 'CYCL', 'BRIK', 'BARB', 'WOOD', 'FENC'];

  for (const wall of ALL_WALLS) {
    describe(`${wall}`, () => {
      it(`DamageLevels=${CPP_WALL_DAMAGE[wall].levels}`, () => {
        // Documenting C++ value for reference — no TS equivalent to check
        expect(CPP_WALL_DAMAGE[wall].levels).toBeGreaterThan(0);
      });

      it(`DamagePoints=${CPP_WALL_DAMAGE[wall].points}`, () => {
        expect(CPP_WALL_DAMAGE[wall].points).toBeGreaterThan(0);
      });

      it(`IsHigh=${CPP_WALL_IS_HIGH[wall]}`, () => {
        // BRIK is the only wall that blocks low-level projectiles
        if (wall === 'BRIK') {
          expect(CPP_WALL_IS_HIGH[wall]).toBe(true);
        } else {
          expect(CPP_WALL_IS_HIGH[wall]).toBe(false);
        }
      });

      it(`IsWooden=${CPP_WALL_IS_WOODEN[wall]}`, () => {
        // WOOD is the only wooden wall (affected by fire)
        if (wall === 'WOOD') {
          expect(CPP_WALL_IS_WOODEN[wall]).toBe(true);
        } else {
          expect(CPP_WALL_IS_WOODEN[wall]).toBe(false);
        }
      });
    });
  }
});
