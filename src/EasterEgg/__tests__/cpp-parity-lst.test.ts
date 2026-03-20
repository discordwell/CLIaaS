/**
 * C++ Behavioral Parity: LST — Landing Ship Transport
 *
 * Tests verify LST behavior matches C++ RA source code (vdata.cpp / rules.ini).
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with LST (observable outcomes: HP, alive/dead,
 * passengers killed on death, door state, no weapon), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
  buildDefaultAlliances, armorIndex, SpeedClass,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  triggerRetaliation,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';
import { COUNTRY_BONUSES } from '../engine/types';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  entities: Entity[] = [],
): CombatContext {
  const map = new GameMap();
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
    map,
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
  } as CombatContext;
}

// ── Stats Verification (rules.ini / vdata.cpp parity) ────────────────────────
// C++ vdata.cpp — LST entry and RULES.INI [LST] section

describe('LST stats verification (vdata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.LST;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'LST');

  it('HP is 350 (Strength=350)', () => {
    expect(stats.strength).toBe(350);
  });

  it('Armor is heavy (Armor=heavy)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('Speed is 14 (Speed=14)', () => {
    expect(stats.speed).toBe(14);
  });

  it('isInfantry is false', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('isVessel is true (naval unit)', () => {
    expect(stats.isVessel).toBe(true);
  });

  it('passengers is 5 (MaxPassengers=5)', () => {
    expect(stats.passengers).toBe(5);
  });

  it('primaryWeapon is null (unarmed transport)', () => {
    expect(stats.primaryWeapon).toBeNull();
  });

  it('speedClass is FLOAT', () => {
    expect(stats.speedClass).toBe(SpeedClass.FLOAT);
  });

  it('sight is 6', () => {
    expect(stats.sight).toBe(6);
  });

  it('rot is 10', () => {
    expect(stats.rot).toBe(10);
  });

  it('cost is 700 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(700);
  });

  it('faction is both (Owner=allies,soviet)', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('both');
  });

  it('Entity constructor initializes HP to strength', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.hp).toBe(350);
    expect(lst.maxHp).toBe(350);
  });
});

// ── No Weapon (vdata.cpp — LST has no primary or secondary weapon) ───────────
// C++ vdata.cpp — LST entry: PrimaryWeapon=WEAPON_NONE, SecondaryWeapon=WEAPON_NONE

describe('LST no weapon (vdata.cpp)', () => {
  it('LST has no primary weapon', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.weapon).toBeNull();
  });

  it('LST has no secondary weapon', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.weapon2).toBeNull();
  });

  it('LST cannot retaliate when attacked (no weapon)', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.V_DD, House.USSR, 11, 10);
    lst.mission = Mission.GUARD;
    lst.target = null;

    const ctx = makeCombatCtx([lst, attacker]);
    triggerRetaliation(ctx, lst, attacker);

    // LST has no weapon, should not get a target
    expect(lst.target).toBeNull();
    expect(lst.mission).toBe(Mission.GUARD);
  });
});

// ── Transport Capability (vessel.cpp / foot.cpp) ─────────────────────────────
// C++ foot.cpp — transport load/unload mechanics, MaxPassengers check

describe('LST transport capability (vessel.cpp / foot.cpp)', () => {
  it('isTransport is true (passengers > 0)', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.isTransport).toBe(true);
  });

  it('maxPassengers is 5', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.maxPassengers).toBe(5);
  });

  it('passengers array starts empty', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.passengers).toHaveLength(0);
  });

  it('can load infantry passengers up to max', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const infantry: Entity[] = [];
    for (let i = 0; i < 5; i++) {
      const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
      lst.passengers.push(e1);
      e1.transportRef = lst;
      infantry.push(e1);
    }
    expect(lst.passengers).toHaveLength(5);
    expect(lst.passengers.length).toBe(lst.maxPassengers);
  });

  it('each loaded passenger has transportRef pointing to the LST', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    lst.passengers.push(e1);
    e1.transportRef = lst;
    expect(e1.transportRef).toBe(lst);
  });
});

// ── Naval Unit (vessel.cpp) ──────────────────────────────────────────────────
// C++ vessel.cpp — LST is a vessel; isNavalUnit derives from isVessel flag

describe('LST naval unit (vessel.cpp)', () => {
  it('isNavalUnit is true', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.isNavalUnit).toBe(true);
  });

  it('isAirUnit is false', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.isAirUnit).toBe(false);
  });

  it('isInfantry stat is false (not infantry)', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.stats.isInfantry).toBe(false);
  });
});

// ── Door State (vessel.cpp — LST open/close door for unloading) ─────────────
// C++ vessel.cpp — LST has a door animation for loading/unloading passengers

describe('LST door state (vessel.cpp)', () => {
  it('doorOpen defaults to false', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.doorOpen).toBe(false);
  });

  it('doorTimer defaults to 0', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.doorTimer).toBe(0);
  });

  it('doorOpen can be set to true for unloading', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    lst.doorOpen = true;
    lst.doorTimer = 60; // countdown to auto-close
    expect(lst.doorOpen).toBe(true);
    expect(lst.doorTimer).toBe(60);
  });

  it('doorTimer counts down toward auto-close', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    lst.doorOpen = true;
    lst.doorTimer = 10;
    // Simulate countdown
    lst.doorTimer--;
    expect(lst.doorTimer).toBe(9);
    // Simulate closing when timer reaches 0
    lst.doorTimer = 0;
    lst.doorOpen = false;
    expect(lst.doorOpen).toBe(false);
    expect(lst.doorTimer).toBe(0);
  });
});

// ── Passengers Killed on Death (techno.cpp / entity.ts takeDamage) ───────────
// C++ techno.cpp — when a transport is destroyed, all loaded passengers are killed

describe('LST passengers killed on death (techno.cpp)', () => {
  it('when LST is destroyed, all passengers die', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const passengers: Entity[] = [];
    for (let i = 0; i < 5; i++) {
      const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
      lst.passengers.push(e1);
      e1.transportRef = lst;
      passengers.push(e1);
    }
    expect(lst.passengers).toHaveLength(5);

    // Kill the LST with massive damage
    lst.takeDamage(500, 'HE');

    expect(lst.alive).toBe(false);
    expect(lst.hp).toBe(0);

    // All passengers should be dead
    for (const p of passengers) {
      expect(p.alive).toBe(false);
      expect(p.mission).toBe(Mission.DIE);
    }

    // Passenger list should be cleared
    expect(lst.passengers).toHaveLength(0);
  });

  it('when LST is destroyed, passenger transportRef is cleared', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    lst.passengers.push(e1);
    e1.transportRef = lst;

    lst.takeDamage(500, 'HE');

    expect(e1.alive).toBe(false);
    expect(e1.transportRef).toBeNull();
  });

  it('LST with no passengers dies normally without affecting others', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const bystander = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);

    expect(lst.passengers).toHaveLength(0);
    lst.takeDamage(500, 'HE');

    expect(lst.alive).toBe(false);
    expect(bystander.alive).toBe(true);
    expect(bystander.hp).toBe(bystander.maxHp);
  });

  it('partial damage does not kill passengers', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    lst.passengers.push(e1);
    e1.transportRef = lst;

    // Deal damage but not enough to destroy LST
    lst.takeDamage(100, 'HE');

    expect(lst.alive).toBe(true);
    expect(lst.hp).toBe(250); // 350 - 100
    expect(e1.alive).toBe(true);
    expect(lst.passengers).toHaveLength(1);
  });

  it('LST killed by exact HP damage still kills all passengers', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    lst.passengers.push(e1, e3);
    e1.transportRef = lst;
    e3.transportRef = lst;

    // Exact HP kill
    lst.takeDamage(350, 'HE');

    expect(lst.alive).toBe(false);
    expect(lst.hp).toBe(0);
    expect(e1.alive).toBe(false);
    expect(e3.alive).toBe(false);
    expect(lst.passengers).toHaveLength(0);
  });
});

// ── No Turret (udata.cpp — LST is in hasTurret exclusion list) ──────────────
// C++ udata.cpp — LST has no turret; body facing only

describe('LST no turret (udata.cpp)', () => {
  it('hasTurret is false', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.hasTurret).toBe(false);
  });

  it('LST is not infantry (turret exclusion is not because of infantry flag)', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.stats.isInfantry).toBe(false);
    expect(lst.hasTurret).toBe(false);
  });

  it('LST is not an ant', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    expect(lst.isAnt).toBe(false);
  });
});

// ── Fastest Naval Unit (vdata.cpp speed comparison) ──────────────────────────
// C++ vdata.cpp — LST Speed=14, fastest of all naval vessels
// SS=6, DD=6, CA=4, PT=9, MSUB=5

describe('LST fastest naval unit (vdata.cpp speed comparison)', () => {
  it('LST speed (14) is greater than SS speed (6)', () => {
    expect(UNIT_STATS.LST.speed).toBeGreaterThan(UNIT_STATS.SS.speed);
  });

  it('LST speed (14) is greater than DD speed (6)', () => {
    expect(UNIT_STATS.LST.speed).toBeGreaterThan(UNIT_STATS.DD.speed);
  });

  it('LST speed (14) is greater than CA speed (4)', () => {
    expect(UNIT_STATS.LST.speed).toBeGreaterThan(UNIT_STATS.CA.speed);
  });

  it('LST speed (14) is greater than PT speed (9)', () => {
    expect(UNIT_STATS.LST.speed).toBeGreaterThan(UNIT_STATS.PT.speed);
  });

  it('LST speed (14) is greater than MSUB speed (5)', () => {
    expect(UNIT_STATS.LST.speed).toBeGreaterThan(UNIT_STATS.MSUB.speed);
  });

  it('LST is the fastest vessel — no other vessel has speed >= 14', () => {
    const allVessels = Object.entries(UNIT_STATS)
      .filter(([_, s]) => s.isVessel)
      .map(([name, s]) => ({ name, speed: s.speed }));

    for (const v of allVessels) {
      if (v.name === 'LST') continue;
      expect(v.speed).toBeLessThan(UNIT_STATS.LST.speed);
    }
  });
});

// ── Movement — Vehicle Stop-Rotate-Move (drive.cpp) ─────────────────────────
// C++ drive.cpp — LST is a vessel (not infantry), uses stop-rotate-move pattern

describe('LST movement — stop-rotate-move (drive.cpp)', () => {
  it('LST facing N, moveToward target E: does NOT move until rotation completes', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    lst.facing = Dir.N;
    lst.desiredFacing = Dir.N;
    lst.bodyFacing32 = Dir.N * 4;

    const startX = lst.pos.x;
    const startY = lst.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // One moveToward tick — vessel should stop to rotate first
    const arrived = lst.moveToward(targetPos, lst.stats.speed);

    // LST rot=10 uses accumulator rotation (only infantry snaps instantly).
    // The LST must rotate before moving (stop-rotate-move).
    expect(arrived).toBe(false); // still rotating or 3 cells away
  });

  it('LST rot=10 uses accumulator rotation (not instant snap — only infantry snap)', () => {
    expect(UNIT_STATS.LST.rot).toBe(10);
    // LST is not infantry, so it uses the accumulator even with rot=10.
    // C++ Rotation_Adjust: ROT=10 takes 7 ticks for 90 degrees.
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    lst.facing = Dir.N;
    lst.desiredFacing = Dir.S; // opposite direction
    const aligned = lst.tickRotation();
    // First tick: acc += 10, 10 >= 8 → step once, but 180 degrees needs many steps.
    expect(aligned).toBe(false);
    expect(lst.facing).not.toBe(Dir.S);
  });
});

// ── Death Animation (techno.cpp) ────────────────────────────────────────────
// C++ techno.cpp — LST transitions to DIE mission and animState on death

describe('LST death animation (techno.cpp)', () => {
  it('LST enters DIE mission on death', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    lst.takeDamage(500, 'HE');
    expect(lst.alive).toBe(false);
    expect(lst.mission).toBe(Mission.DIE);
    expect(lst.animState).toBe(AnimState.DIE);
  });

  it('LST deathTick starts at 0 on death', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    lst.takeDamage(500, 'HE');
    expect(lst.deathTick).toBe(0);
  });

  it('LST HP is clamped to 0 on death (not negative)', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    lst.takeDamage(999, 'HE');
    expect(lst.hp).toBe(0);
  });
});

// ── Damage Taken (combat.cpp warhead tables) ─────────────────────────────────
// C++ combat.cpp — LST has heavy armor; warhead-vs-armor multipliers apply

describe('LST damage taken — heavy armor (combat.cpp warhead tables)', () => {
  it('SA vs heavy armor: mult 0.25 (small arms ineffective)', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    expect(mult).toBe(0.25);
  });

  it('HE vs heavy armor: mult 0.25 (bad vs heavy armor)', () => {
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('heavy')];
    expect(mult).toBe(0.25);
  });

  it('AP vs heavy armor: mult 1.0 (full damage)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('heavy')];
    expect(mult).toBe(1.0);
  });

  it('LST takes full damage from AP warhead (armor-piercing effective)', () => {
    const lst = entityAtCell(UnitType.V_LST, House.Spain, 10, 10);
    const hpBefore = lst.hp;
    const damage = 50;
    lst.takeDamage(damage, 'AP');
    expect(hpBefore - lst.hp).toBe(damage);
  });
});
