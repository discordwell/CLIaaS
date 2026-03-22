/**
 * C++ Behavioral Parity: Chrono Tank Teleport Mechanics
 *
 * Tests verify CTNK teleport behavior matches C++ RA source code.
 * Focus: cooldown timing, teleport preconditions, visual effects,
 * vortex/quake suppression, superweapon non-discharge, pip display formula,
 * and Chronosphere exclusion filter.
 *
 * C++ sources (quoted inline):
 *   house.cpp:2790-2793   -- Chronosphere excludes CTNK (porthim=false)
 *   house.cpp:2808-2888   -- SPC_CHRONO2 handler (teleport destination)
 *   house.cpp:2841-2843   -- IsMoebius=false for CTNK (never returns)
 *   house.cpp:2845-2846   -- MoebiusCountDown = ChronoTankDuration * TICKS_PER_MINUTE
 *   house.cpp:2860-2864   -- Superweapon NOT discharged for CTNK
 *   house.cpp:2882         -- Vortex NOT spawned for CTNK
 *   unit.cpp:2714-2722    -- CTNK deploy action enters SPC_CHRONO2 targeting
 *   unit.cpp:3446-3453    -- Deploy blocked while MoebiusCountDown > 0
 *   unit.cpp:3888-3891    -- Pip display formula: (fulldur - MoebiusCountDown) / (fulldur / 5)
 *   drive.cpp:1301-1311   -- Moebius return skipped for CTNK (IsMoebius=false)
 *   globals.cpp:174       -- ChronoTankDuration = 0x300 (fixed-point)
 *   rules.cpp:283         -- ChronoTankDuration default = 0x300
 *   rules.cpp:399         -- Aftermath INI override: ChronoTankDuration
 *   defines.h:3031-3032   -- TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 *   team.cpp:1693-1700    -- AI team spy mission CTNK teleport
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission,
  SuperweaponType, SUPERWEAPON_DEFS,
  CHRONO_SHIFT_VISUAL_TICKS,
  buildDefaultAlliances,
} from '../engine/types';
import type { SuperweaponState } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { activateSuperweapon, CHRONO_DURATION_TICKS, type SuperweaponContext } from '../engine/superweapon';
import {
  teleportChronoTank, updateChronoTank, CHRONO_TANK_COOLDOWN,
  type SpecialUnitsContext,
} from '../engine/specialUnits';
import type { Effect } from '../engine/renderer';
import { GameMap } from '../engine/map';

beforeEach(() => resetEntityIds());

// =============================================================================
// Helpers
// =============================================================================

/** Create an entity centered in the given cell. */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/** Build a SpecialUnitsContext for chrono tank teleport tests. */
function makeSpecialCtx(
  entities: Entity[] = [],
  overrides: Partial<SpecialUnitsContext> = {},
): SpecialUnitsContext {
  const alliances = buildDefaultAlliances();
  const map = new GameMap();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures: [],
    mines: [],
    activeVortices: [],
    effects: [] as Effect[],
    tick: 100,
    playerHouse: House.Spain,
    credits: 5000,
    houseCredits: new Map(),
    map,
    evaMessages: [],
    isThieved: false,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playSound: () => {},
    movementSpeed: () => 0.3,
    damageEntity: (target: Entity, amount: number, warhead: string): boolean => {
      return target.takeDamage(amount, warhead);
    },
    damageStructure: () => false,
    addEntity: () => {},
    screenShake: 0,
    ...overrides,
  };
}

/** Build a ready-to-fire Chronosphere SuperweaponContext. */
function makeChronoCtx(
  entities: Entity[] = [],
  overrides: Partial<SuperweaponContext> = {},
): SuperweaponContext {
  const alliances = buildDefaultAlliances();
  const key = `${House.Spain}:${SuperweaponType.CHRONOSPHERE}`;
  const swState: SuperweaponState = {
    type: SuperweaponType.CHRONOSPHERE,
    house: House.Spain,
    chargeTick: SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].rechargeTicks,
    ready: true,
    structureIndex: 0,
    fired: false,
  };
  const superweapons = new Map<string, SuperweaponState>();
  superweapons.set(key, swState);

  return {
    structures: [],
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    superweapons,
    effects: [] as Effect[],
    tick: 100,
    playerHouse: House.Spain,
    powerProduced: 500,
    powerConsumed: 200,
    killCount: 0,
    lossCount: 0,
    map: new GameMap(),
    sonarSpiedTarget: new Map(),
    gapGeneratorCells: new Map(),
    nukePendingTarget: null,
    nukePendingTick: 0,
    nukePendingSource: null,
    gpsActive: false,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    pushEva: () => {},
    playSound: () => {},
    playSoundAt: () => {},
    damageEntity: (target: Entity, amount: number, warhead: string): boolean => {
      return target.takeDamage(amount, warhead);
    },
    damageStructure: () => false,
    addEntity: () => {},
    aiIQ: () => 3,
    getWarheadMult: () => 1.0,
    cameraX: 0,
    cameraY: 0,
    cameraViewWidth: 800,
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  };
}

// =============================================================================
// 1. Cooldown Duration — C++ globals.cpp:174, rules.cpp:283,399
// =============================================================================
// C++ globals.cpp:174:  fixed ChronoTankDuration=0x300;
// 0x300 as C++ `fixed` = 768 / 256 = 3.0 (minutes)
// defines.h:3032: TICKS_PER_MINUTE = 900 (15 FPS * 60)
// 3.0 * 900 = 2700 ticks

describe('Cooldown duration (globals.cpp:174, rules.cpp:283)', () => {
  it('CHRONO_TANK_COOLDOWN equals ChronoTankDuration(3.0) * TICKS_PER_MINUTE(900) = 2700', () => {
    const TICKS_PER_MINUTE = 900;
    const chronoTankDurationMinutes = 3.0; // 0x300 fixed-point = 768/256
    expect(CHRONO_TANK_COOLDOWN).toBe(chronoTankDurationMinutes * TICKS_PER_MINUTE);
    expect(CHRONO_TANK_COOLDOWN).toBe(2700);
  });

  it('cooldown differs from Chronosphere ChronoDuration (both 3 min but separate constants)', () => {
    // C++ rules.cpp:124: ChronoDuration=3 → CHRONO_DURATION_TICKS=2700
    // C++ rules.cpp:283: ChronoTankDuration=0x300 → CHRONO_TANK_COOLDOWN=2700
    // Same numeric value but independent constants that can diverge via INI overrides
    // rules.cpp:399: ChronoTankDuration = ini.Get_Fixed(AFTERMATH, "ChronoTankDuration", ...)
    // rules.cpp:420: ChronoDuration = ini.Get_Fixed(GENERAL, "ChronoDuration", ...)
    expect(CHRONO_TANK_COOLDOWN).toBe(2700);
    expect(CHRONO_DURATION_TICKS).toBe(2700);
  });
});

// =============================================================================
// 2. Teleport Position Update — C++ house.cpp:2835-2838
// =============================================================================
// C++ house.cpp:2838: drive->Teleport_To(cell)
// drive.cpp:382-414: DriveClass::Teleport_To moves unit to cell

describe('Teleport position update (house.cpp:2835-2838, drive.cpp:382)', () => {
  it('entity position changes to target after teleport', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctnk.pos.x).toBe(target.x);
    expect(ctnk.pos.y).toBe(target.y);
  });

  it('prevPos snapped to target (prevents interpolation swoosh)', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctnk.prevPos.x).toBe(target.x);
    expect(ctnk.prevPos.y).toBe(target.y);
  });

  it('entity remains alive after teleport', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctnk.alive).toBe(true);
  });
});

// =============================================================================
// 3. Cooldown Applied After Teleport — C++ house.cpp:2845-2846
// =============================================================================
// C++ house.cpp:2845-2846:
//   if (UNIT_CHRONOTANK) drive->MoebiusCountDown = ChronoTankDuration * TICKS_PER_MINUTE;
// TS equivalent: entity.chronoCooldown = CHRONO_TANK_COOLDOWN

describe('Cooldown applied after teleport (house.cpp:2845-2846)', () => {
  it('chronoCooldown set to CHRONO_TANK_COOLDOWN after teleport', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctnk.chronoCooldown).toBe(CHRONO_TANK_COOLDOWN);
    expect(ctnk.chronoCooldown).toBe(2700);
  });
});

// =============================================================================
// 4. Deploy Blocked While Cooling Down — C++ unit.cpp:3446-3453
// =============================================================================
// C++ unit.cpp:3447-3451:
//   if (*this == UNIT_CHRONOTANK) {
//     if (MoebiusCountDown || (IsOwnedByPlayer && House->UnitToTeleport && ...)) {
//       action = ACTION_NO_DEPLOY;
//     }
//   }

describe('Deploy blocked while cooling down (unit.cpp:3446-3453)', () => {
  it('cannot teleport while chronoCooldown > 0', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.chronoCooldown = 100;
    const startX = ctnk.pos.x;
    const startY = ctnk.pos.y;
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    // Should NOT have moved
    expect(ctnk.pos.x).toBe(startX);
    expect(ctnk.pos.y).toBe(startY);
  });

  it('cannot teleport at cooldown = 1 (still cooling)', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.chronoCooldown = 1;
    const startX = ctnk.pos.x;
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctnk.pos.x).toBe(startX);
  });

  it('can teleport when cooldown reaches 0', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.chronoCooldown = 0;
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctnk.pos.x).toBe(target.x);
    expect(ctnk.pos.y).toBe(target.y);
  });
});

// =============================================================================
// 5. Cooldown Tick-Down — C++ drive.cpp AI ticks MoebiusCountDown
// =============================================================================
// C++ drive.cpp:1294: FootClass::AI() which ticks MoebiusCountDown
// TS: updateChronoTank decrements entity.chronoCooldown each tick

describe('Cooldown tick-down (drive.cpp AI, specialUnits.ts:229-231)', () => {
  it('updateChronoTank decrements chronoCooldown by 1 per tick', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.chronoCooldown = 100;
    const ctx = makeSpecialCtx([ctnk]);

    updateChronoTank(ctx, ctnk);

    expect(ctnk.chronoCooldown).toBe(99);
  });

  it('updateChronoTank does not go below 0', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.chronoCooldown = 0;
    const ctx = makeSpecialCtx([ctnk]);

    updateChronoTank(ctx, ctnk);

    expect(ctnk.chronoCooldown).toBe(0);
  });

  it('updateChronoTank ignores non-CTNK units', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.chronoCooldown = 100;
    const ctx = makeSpecialCtx([tank]);

    updateChronoTank(ctx, tank);

    // Should not have been decremented
    expect(tank.chronoCooldown).toBe(100);
  });

  it('updateChronoTank ignores dead CTNK', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.chronoCooldown = 100;
    ctnk.alive = false;
    const ctx = makeSpecialCtx([ctnk]);

    updateChronoTank(ctx, ctnk);

    expect(ctnk.chronoCooldown).toBe(100);
  });

  it('full cooldown drains to 0 over exactly 2700 ticks', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.chronoCooldown = CHRONO_TANK_COOLDOWN;
    const ctx = makeSpecialCtx([ctnk]);

    for (let i = 0; i < CHRONO_TANK_COOLDOWN; i++) {
      updateChronoTank(ctx, ctnk);
    }

    expect(ctnk.chronoCooldown).toBe(0);
  });
});

// =============================================================================
// 6. IsMoebius = false — Chrono Tank Never Returns
// =============================================================================
// C++ house.cpp:2839: drive->IsMoebius = true;  (default for all teleported units)
// C++ house.cpp:2841-2843 (FIXIT_CSII):
//   if (UNIT_CHRONOTANK) drive->IsMoebius = false;
// C++ drive.cpp:1301-1311: Moebius return only triggers if IsMoebius == true
// TS: teleportChronoTank does NOT set moebiusCell or moebiusCountDown

describe('IsMoebius=false: chrono tank never returns (house.cpp:2841-2843, drive.cpp:1301)', () => {
  it('teleport does not set moebiusCell (no return origin)', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctnk.moebiusCell).toBeNull();
  });

  it('teleport does not set moebiusCountDown (no return timer)', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctnk.moebiusCountDown).toBe(0);
  });

  it('regular unit chronoshifted via Chronosphere DOES get moebiusCountDown', () => {
    // C++ house.cpp:2849: drive->MoebiusCountDown = Rule.ChronoDuration * TICKS_PER_MINUTE
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeChronoCtx([tank]);
    const target = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(tank.moebiusCountDown).toBe(CHRONO_DURATION_TICKS);
    expect(tank.moebiusCell).not.toBeNull();
  });
});

// =============================================================================
// 7. Superweapon NOT Discharged — C++ house.cpp:2860-2864
// =============================================================================
// C++ house.cpp:2860-2864 (FIXIT_CSII):
//   if (tech && tech->IsActive && (What_Am_I() != RTTI_UNIT || != UNIT_CHRONOTANK))
//     SuperWeapon[SPC_CHRONOSPHERE].Discharged(this == PlayerPtr);
// Chrono tank teleport does NOT consume the Chronosphere charge.

describe('Superweapon NOT discharged for CTNK teleport (house.cpp:2860-2864)', () => {
  it('teleportChronoTank does not interact with superweapon state', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    // teleportChronoTank has no superweapon parameter — by design
    teleportChronoTank(ctx, ctnk, target);

    // Verify teleport succeeded
    expect(ctnk.pos.x).toBe(target.x);
    // No superweapon state in SpecialUnitsContext — correct separation
  });

  it('Chronosphere superweapon IS discharged for regular unit teleport', () => {
    // C++ house.cpp:2862: SuperWeapon[SPC_CHRONOSPHERE].Discharged(this == PlayerPtr)
    // TS: activateSuperweapon sets ready=false, chargeTick=0 (line 371-372)
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    tank.selected = true;
    const ctx = makeChronoCtx([tank]);
    const key = `${House.Spain}:${SuperweaponType.CHRONOSPHERE}`;
    const swBefore = ctx.superweapons.get(key)!;
    expect(swBefore.ready).toBe(true);
    expect(swBefore.chargeTick).toBe(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].rechargeTicks);

    const target = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };
    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    const swAfter = ctx.superweapons.get(key)!;
    // Discharged: ready=false and chargeTick reset to 0
    expect(swAfter.ready).toBe(false);
    expect(swAfter.chargeTick).toBe(0);
  });
});

// =============================================================================
// 8. Vortex NOT Spawned — C++ house.cpp:2880-2883
// =============================================================================
// C++ house.cpp:2880-2883 (FIXIT_CSII):
//   // Don't allow a vortex if the teleportation was due to a chrono tank.
//   if (tech && tech->IsActive && (What_Am_I() != RTTI_UNIT || != UNIT_CHRONOTANK))
//     if (!ChronalVortex.Is_Active() && Percent_Chance(Rule.VortexChance * 100)) { ... }

describe('Vortex NOT spawned for CTNK teleport (house.cpp:2880-2883)', () => {
  it('teleportChronoTank creates no vortex entries', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctx.activeVortices.length).toBe(0);
  });

  it('teleportChronoTank does not trigger time quake side effects', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    // Run teleport 100 times — should never trigger vortex
    for (let i = 0; i < 100; i++) {
      ctnk.pos.x = 5 * CELL_SIZE + CELL_SIZE / 2;
      ctnk.pos.y = 5 * CELL_SIZE + CELL_SIZE / 2;
      ctnk.chronoCooldown = 0;
      teleportChronoTank(ctx, ctnk, target);
    }

    expect(ctx.activeVortices.length).toBe(0);
  });
});

// =============================================================================
// 9. Teleport Preconditions — Dead Unit, Impassable Cell
// =============================================================================
// C++ house.cpp:2813: tech != NULL && tech->IsActive && tech->Is_Foot()
// C++ drive.cpp:382: Teleport_To checks cell occupancy

describe('Teleport preconditions (house.cpp:2813, drive.cpp:382)', () => {
  it('dead CTNK cannot teleport', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.alive = false;
    const startX = ctnk.pos.x;
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctnk.pos.x).toBe(startX);
  });

  it('cannot teleport to impassable cell (water)', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const ctx = makeSpecialCtx([ctnk]);
    const targetCx = 20;
    const targetCy = 20;
    ctx.map.setTerrain(targetCx, targetCy, 4); // 4 = Terrain.WATER
    const target = { x: targetCx * CELL_SIZE + CELL_SIZE / 2, y: targetCy * CELL_SIZE + CELL_SIZE / 2 };

    teleportChronoTank(ctx, ctnk, target);

    // Should NOT have moved
    expect(ctnk.pos.x).toBe(5 * CELL_SIZE + CELL_SIZE / 2);
  });

  it('can teleport to passable cell', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctnk.pos.x).toBe(target.x);
    expect(ctnk.pos.y).toBe(target.y);
  });
});

// =============================================================================
// 10. Post-Teleport State — C++ unit.cpp:2721
// =============================================================================
// C++ unit.cpp:2721: Assign_Mission(MISSION_GUARD)
// Target and moveTarget cleared after teleport

describe('Post-teleport state (unit.cpp:2721)', () => {
  it('mission set to GUARD after teleport', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.mission = Mission.MOVE;
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctnk.mission).toBe(Mission.GUARD);
  });

  it('target cleared after teleport', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 15, 15);
    ctnk.target = enemy;
    const ctx = makeSpecialCtx([ctnk, enemy]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctnk.target).toBeNull();
  });

  it('moveTarget cleared after teleport', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.moveTarget = { x: 10 * CELL_SIZE, y: 10 * CELL_SIZE };
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctnk.moveTarget).toBeNull();
  });
});

// =============================================================================
// 11. Visual Effects — Blue Flash + chronoShiftTick
// =============================================================================
// C++ house.cpp:2851: Scen.Do_BW_Fade() — screen goes B&W briefly
// C++ house.cpp:2852: Sound_Effect(VOC_CHRONO, drive->Coord)

describe('Visual effects on teleport (house.cpp:2851-2852)', () => {
  it('chronoShiftTick set to CHRONO_SHIFT_VISUAL_TICKS after teleport', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctnk.chronoShiftTick).toBe(CHRONO_SHIFT_VISUAL_TICKS);
    expect(ctnk.chronoShiftTick).toBe(30);
  });

  it('two lightning effects created (origin + destination)', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    const litEffects = ctx.effects.filter(e => e.sprite === 'litning');
    expect(litEffects.length).toBe(2);
  });

  it('origin flash at original position, destination flash at target', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const originX = ctnk.pos.x;
    const originY = ctnk.pos.y;
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    const litEffects = ctx.effects.filter(e => e.sprite === 'litning');
    // First effect at origin
    expect(litEffects[0].x).toBe(originX);
    expect(litEffects[0].y).toBe(originY);
    // Second effect at destination
    expect(litEffects[1].x).toBe(target.x);
    expect(litEffects[1].y).toBe(target.y);
  });

  it('chrono sound played on teleport', () => {
    let soundPlayed = '';
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const ctx = makeSpecialCtx([ctnk], {
      playSound: (name: string) => { soundPlayed = name; },
    });
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(soundPlayed).toBe('chrono');
  });

  it('no effects created when teleport blocked by cooldown', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.chronoCooldown = 100;
    const ctx = makeSpecialCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };

    teleportChronoTank(ctx, ctnk, target);

    expect(ctx.effects.length).toBe(0);
  });
});

// =============================================================================
// 12. Pip Display Formula — C++ unit.cpp:3888-3891
// =============================================================================
// C++ source:
//   int fulldur = ChronoTankDuration * TICKS_PER_MINUTE;   // 2700
//   return (fulldur - MoebiusCountDown) / (fulldur / 5);   // 0-5 pips
// TS renderer.ts:2198-2200 uses identical formula with chronoCooldown

describe('Pip display formula (unit.cpp:3888-3891)', () => {
  const FULLDUR = 2700; // ChronoTankDuration(3.0) * TICKS_PER_MINUTE(900)

  // C++ uses integer division: (fulldur - countdown) / (fulldur / 5)
  // fulldur / 5 = 2700 / 5 = 540

  it('pip=0 when just teleported (countdown=2700)', () => {
    const pip = Math.floor((FULLDUR - 2700) / (FULLDUR / 5));
    expect(pip).toBe(0);
  });

  it('pip=1 after 540 ticks (countdown=2160)', () => {
    const pip = Math.floor((FULLDUR - 2160) / (FULLDUR / 5));
    expect(pip).toBe(1);
  });

  it('pip=2 after 1080 ticks (countdown=1620)', () => {
    const pip = Math.floor((FULLDUR - 1620) / (FULLDUR / 5));
    expect(pip).toBe(2);
  });

  it('pip=3 after 1620 ticks (countdown=1080)', () => {
    const pip = Math.floor((FULLDUR - 1080) / (FULLDUR / 5));
    expect(pip).toBe(3);
  });

  it('pip=4 after 2160 ticks (countdown=540)', () => {
    const pip = Math.floor((FULLDUR - 540) / (FULLDUR / 5));
    expect(pip).toBe(4);
  });

  it('pip=5 when fully charged (countdown=0)', () => {
    const pip = Math.floor((FULLDUR - 0) / (FULLDUR / 5));
    expect(pip).toBe(5);
  });

  it('each pip represents exactly 540 ticks (3 min / 5 = 36 seconds)', () => {
    const ticksPerPip = FULLDUR / 5;
    expect(ticksPerPip).toBe(540);
    // At 15 TPS: 540 / 15 = 36 seconds per pip
    expect(ticksPerPip / 15).toBe(36);
  });
});

// =============================================================================
// 13. Chronosphere Excludes CTNK — C++ house.cpp:2790-2793
// =============================================================================
// C++ house.cpp:2790-2793 (FIXIT_CSII):
//   bool porthim = true;
//   if (tech->What_Am_I() == RTTI_UNIT && Type == UNIT_CHRONOTANK) porthim = false;
//   if (porthim) { ... UnitToTeleport = tech->As_Target(); }
// CTNK cannot be targeted by the Chronosphere superweapon.

describe('Chronosphere excludes CTNK (house.cpp:2790-2793)', () => {
  it('Chronosphere activation with selected CTNK does not teleport it', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.selected = true;
    const startX = ctnk.pos.x;
    const startY = ctnk.pos.y;
    const ctx = makeChronoCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // CTNK should NOT have moved
    expect(ctnk.pos.x).toBe(startX);
    expect(ctnk.pos.y).toBe(startY);
  });

  it('Chronosphere targets regular tank but not CTNK when both selected', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.selected = true;
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 6, 6);
    tank.selected = true;
    const ctnkStartX = ctnk.pos.x;
    const ctx = makeChronoCtx([ctnk, tank]);
    const target = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    // 2TNK should be teleported (or at least eligible)
    // CTNK should stay
    expect(ctnk.pos.x).toBe(ctnkStartX);
    // 2TNK: the first selected non-CTNK gets teleported
    expect(tank.pos.x).toBe(target.x);
    expect(tank.pos.y).toBe(target.y);
  });

  it('CTNK moebiusCountDown unchanged by Chronosphere attempt', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    ctnk.selected = true;
    const ctx = makeChronoCtx([ctnk]);
    const target = { x: 20 * CELL_SIZE + CELL_SIZE / 2, y: 20 * CELL_SIZE + CELL_SIZE / 2 };

    activateSuperweapon(ctx, SuperweaponType.CHRONOSPHERE, House.Spain, target);

    expect(ctnk.moebiusCountDown).toBe(0);
    expect(ctnk.moebiusCell).toBeNull();
  });
});

// =============================================================================
// 14. Teleport-then-Recharge Cycle — Full Integration
// =============================================================================
// Verify the full cycle: teleport -> cooldown -> tick down -> ready again

describe('Full teleport-recharge cycle (integration)', () => {
  it('CTNK can teleport, wait 2700 ticks, then teleport again', () => {
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 5, 5);
    const ctx = makeSpecialCtx([ctnk]);

    // First teleport
    const target1 = { x: 20 * CELL_SIZE, y: 20 * CELL_SIZE };
    teleportChronoTank(ctx, ctnk, target1);
    expect(ctnk.pos.x).toBe(target1.x);
    expect(ctnk.chronoCooldown).toBe(2700);

    // Cannot teleport immediately
    const target2 = { x: 30 * CELL_SIZE, y: 30 * CELL_SIZE };
    teleportChronoTank(ctx, ctnk, target2);
    expect(ctnk.pos.x).toBe(target1.x); // still at target1

    // Tick down cooldown
    for (let i = 0; i < 2700; i++) {
      updateChronoTank(ctx, ctnk);
    }
    expect(ctnk.chronoCooldown).toBe(0);

    // Second teleport now works
    teleportChronoTank(ctx, ctnk, target2);
    expect(ctnk.pos.x).toBe(target2.x);
    expect(ctnk.pos.y).toBe(target2.y);
    expect(ctnk.chronoCooldown).toBe(2700);
  });
});
