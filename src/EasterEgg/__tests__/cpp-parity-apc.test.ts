/**
 * C++ Behavioral Parity: APC — Armored Personnel Carrier
 *
 * Tests verify APC behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with APC (observable outcomes: HP, alive/dead,
 * transport passengers, crush, turret, movement), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
  COUNTRY_BONUSES,
  buildDefaultAlliances, armorIndex,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  checkVehicleCrush,
  triggerRetaliation,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

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

// ── Stats Verification (udata.cpp / rules.ini) ──────────────────────────────
// C++ udata.cpp (unit type data) — APC entry and RULES.INI [APC] section

describe('APC stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.APC;
  const weapon = WEAPON_STATS.M60mg;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'APC');

  it('HP is 200 (Strength=200)', () => {
    expect(stats.strength).toBe(200);
  });

  it('Armor is heavy (Armor=heavy)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('Speed is 10 (Speed=10)', () => {
    expect(stats.speed).toBe(10);
  });

  it('isInfantry is false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('crusher is true (C++ Crusher flag — tracked APC crushes infantry)', () => {
    expect(stats.crusher).toBe(true);
  });

  it('primary weapon is M60mg', () => {
    expect(stats.primaryWeapon).toBe('M60mg');
  });

  it('no secondary weapon', () => {
    expect(stats.secondaryWeapon).toBeUndefined();
  });

  it('passengers capacity is 5 (C++ Max_Passengers=5)', () => {
    expect(stats.passengers).toBe(5);
  });

  it('ROT is 5 (rotation rate — standard vehicle)', () => {
    expect(stats.rot).toBe(5);
  });

  it('sight is 5', () => {
    expect(stats.sight).toBe(5);
  });

  it('cost is 800 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(800);
  });

  it('faction is allied', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('allied');
  });

  it('Entity constructor initializes HP to strength', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.hp).toBe(200);
    expect(apc.maxHp).toBe(200);
  });
});

// ── Weapon — M60mg (weapon.cpp / rules.ini) ──────────────────────────────────
// C++ weapon.cpp — M60mg: SA warhead, 15 damage, range 4.0

describe('APC weapon — M60mg (weapon.cpp / rules.ini)', () => {
  const weapon = WEAPON_STATS.M60mg;

  it('M60mg warhead is SA', () => {
    expect(weapon.warhead).toBe('SA');
  });

  it('M60mg damage is 15', () => {
    expect(weapon.damage).toBe(15);
  });

  it('M60mg range is 4.0 cells', () => {
    expect(weapon.range).toBe(4.0);
  });

  it('M60mg ROF is 20', () => {
    expect(weapon.rof).toBe(20);
  });

  it('APC entity has M60mg as primary weapon', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.weapon).not.toBeNull();
    expect(apc.weapon!.name).toBe('M60mg');
    expect(apc.weapon!.damage).toBe(15);
  });

  it('APC has no secondary weapon', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.weapon2).toBeNull();
  });
});

// ── Weapon Effectiveness — SA warhead (combat.cpp warhead tables) ────────────
// C++ combat.cpp — Modify_Damage uses WARHEAD_VS_ARMOR table

describe('APC weapon effectiveness — SA warhead (combat.cpp warhead tables)', () => {
  it('SA vs none armor: mult 1.0 (full damage to infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('none')];
    expect(mult).toBe(1.0);
  });

  it('SA vs light armor: mult 0.6', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('light')];
    expect(mult).toBe(0.6);
  });

  it('SA vs heavy armor: mult 0.25 (bad vs tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('heavy')];
    expect(mult).toBe(0.25);
  });

  it('SA vs concrete: mult 0.25', () => {
    const mult = WARHEAD_VS_ARMOR.SA[armorIndex('concrete')];
    expect(mult).toBe(0.25);
  });

  it('APC M60mg deals full 15 base damage to unarmored infantry', () => {
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const hpBefore = victim.hp;
    victim.takeDamage(15, 'SA');
    expect(hpBefore - victim.hp).toBe(15);
  });

  it('APC M60mg deals reduced damage to heavy-armor vehicles', () => {
    const victim = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const hpBefore = victim.hp;
    const damage = Math.round(15 * WARHEAD_VS_ARMOR.SA[armorIndex('heavy')]);
    victim.takeDamage(damage, 'SA');
    expect(hpBefore - victim.hp).toBe(damage);
    expect(damage).toBeLessThan(15);
  });
});

// ── Transport (techno.cpp / unit.cpp) ────────────────────────────────────────
// C++ techno.cpp — isTransport, maxPassengers, passengers array

describe('APC transport (techno.cpp / unit.cpp)', () => {
  it('isTransport is true (passengers > 0)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.isTransport).toBe(true);
  });

  it('maxPassengers is 5', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.maxPassengers).toBe(5);
  });

  it('passengers array starts empty', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.passengers).toEqual([]);
    expect(apc.passengers.length).toBe(0);
  });

  it('can load infantry into passengers array', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    apc.passengers.push(e1);
    e1.transportRef = apc;
    expect(apc.passengers.length).toBe(1);
    expect(apc.passengers[0]).toBe(e1);
    expect(e1.transportRef).toBe(apc);
  });

  it('can load up to 5 passengers (maxPassengers)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    for (let i = 0; i < 5; i++) {
      const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
      apc.passengers.push(inf);
      inf.transportRef = apc;
    }
    expect(apc.passengers.length).toBe(5);
  });

  it('non-transport vehicle (2TNK) has isTransport=false and maxPassengers=0', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.isTransport).toBe(false);
    expect(tank.maxPassengers).toBe(0);
  });
});

// ── Passengers Killed on Death (entity.ts takeDamage) ────────────────────────
// C++ unit.cpp — when transport destroyed, all passengers are killed instantly.
// entity.ts: for (const p of this.passengers) { p.alive = false; ... }

describe('APC passengers killed on death (unit.cpp / entity.ts)', () => {
  it('when APC dies, all passengers die too', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const passengers: Entity[] = [];
    for (let i = 0; i < 3; i++) {
      const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
      apc.passengers.push(inf);
      inf.transportRef = apc;
      passengers.push(inf);
    }

    // Kill the APC with lethal damage
    const killed = apc.takeDamage(300, 'AP');
    expect(killed).toBe(true);
    expect(apc.alive).toBe(false);

    // All passengers must be dead
    for (const p of passengers) {
      expect(p.alive).toBe(false);
      expect(p.mission).toBe(Mission.DIE);
    }
  });

  it('passengers transportRef is cleared on APC death', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    apc.passengers.push(e1);
    e1.transportRef = apc;

    apc.takeDamage(300, 'AP');

    expect(e1.transportRef).toBeNull();
  });

  it('APC passengers array is cleared on death', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    for (let i = 0; i < 5; i++) {
      const inf = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
      apc.passengers.push(inf);
      inf.transportRef = apc;
    }
    expect(apc.passengers.length).toBe(5);

    apc.takeDamage(300, 'AP');
    expect(apc.passengers.length).toBe(0);
  });

  it('APC that takes non-lethal damage does NOT kill passengers', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    apc.passengers.push(e1);
    e1.transportRef = apc;

    const killed = apc.takeDamage(50, 'AP');
    expect(killed).toBe(false);
    expect(apc.alive).toBe(true);
    expect(e1.alive).toBe(true);
    expect(apc.passengers.length).toBe(1);
    expect(e1.transportRef).toBe(apc);
  });

  it('empty APC dying does not crash (no passengers to kill)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.passengers.length).toBe(0);

    const killed = apc.takeDamage(300, 'AP');
    expect(killed).toBe(true);
    expect(apc.alive).toBe(false);
    expect(apc.passengers.length).toBe(0);
  });

  it('APC sets death state correctly on kill (mission=DIE, animState=DIE)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    apc.takeDamage(300, 'AP');

    expect(apc.alive).toBe(false);
    expect(apc.mission).toBe(Mission.DIE);
    expect(apc.animState).toBe(AnimState.DIE);
    expect(apc.hp).toBe(0);
  });
});

// ── Crusher (drive.cpp:Ok_To_Move) ───────────────────────────────────────────
// C++ drive.cpp — APC has Crusher flag and can crush infantry on entering their cell

describe('APC crusher (drive.cpp:Ok_To_Move)', () => {
  it('APC crushes enemy infantry when entering its cell', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([apc, e1]);
    checkVehicleCrush(ctx, apc);
    expect(e1.alive).toBe(false);
  });

  it('APC does NOT crush allied infantry', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([apc, e1]);
    checkVehicleCrush(ctx, apc);
    expect(e1.alive).toBe(true);
    expect(e1.hp).toBe(e1.maxHp);
  });

  it('APC does NOT crush cross-allied infantry (Greece allied with Spain)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const e1 = entityAtCell(UnitType.I_E1, House.Greece, 10, 10);
    const ctx = makeCombatCtx([apc, e1]);
    checkVehicleCrush(ctx, apc);
    expect(e1.alive).toBe(true);
  });

  it('APC stats confirm crusher flag', () => {
    expect(UNIT_STATS.APC.crusher).toBe(true);
  });

  it('JEEP stats confirm no crusher flag (contrast with APC)', () => {
    // JEEP lacks the crusher flag — C++ drive.cpp:Ok_To_Move only allows
    // Tracks=true (crusher) vehicles to crush infantry. APC has it, JEEP does not.
    expect(UNIT_STATS.JEEP.crusher).toBeFalsy();
    expect(UNIT_STATS.APC.crusher).toBe(true);
  });
});

// ── No Turret (unit.cpp) ─────────────────────────────────────────────────────
// C++ udata.cpp — APC is in the hasTurret exclusion list (no separate turret)

describe('APC no turret (udata.cpp)', () => {
  it('APC hasTurret is false (in exclusion list)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.hasTurret).toBe(false);
  });

  it('2TNK hasTurret is true (has separate turret sprite)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.hasTurret).toBe(true);
  });

  it('APC type is V_APC in exclusion list', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.type).toBe(UnitType.V_APC);
    expect(apc.type).toBe('APC');
  });
});

// ── Movement — Fast Armored Transport (drive.cpp / unit.cpp) ─────────────────
// C++ drive.cpp — APC speed=10, heavy armor, vehicles stop-rotate-move

describe('APC movement — fast armored transport (drive.cpp)', () => {
  it('APC speed is 10 (fastest vehicle tier)', () => {
    expect(UNIT_STATS.APC.speed).toBe(10);
  });

  it('APC has heavy armor (survives while transporting)', () => {
    expect(UNIT_STATS.APC.armor).toBe('heavy');
  });

  it('APC stops to rotate before moving (vehicle behavior, not infantry)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    apc.facing = Dir.N;
    apc.desiredFacing = Dir.N;
    apc.bodyFacing32 = Dir.N * 4;

    const startX = apc.pos.x;
    const startY = apc.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // APC facing N, target is E — must rotate first before moving
    const arrived = apc.moveToward(targetPos, apc.stats.speed);
    expect(arrived).toBe(false);
    // Vehicle should NOT have moved (still rotating from N to E)
    expect(apc.pos.x).toBe(startX);
    expect(apc.pos.y).toBe(startY);
  });

  it('APC rot=5 requires multiple ticks to rotate 90 degrees', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(UNIT_STATS.APC.rot).toBe(5);
    // rot=5, need accumulator >= 8 for one 32-step visual rotation step
    // From N (facing32=0) to E (facing32=8) requires 8 steps
    // Each tick: accumulator += 5, step at >= 8.
    // So multiple ticks needed (not instant like infantry with rot>=8)
    apc.facing = Dir.N;
    apc.desiredFacing = Dir.E;
    apc.bodyFacing32 = Dir.N * 4;
    apc.rotAccumulator = 0;

    // First tick: accum=5 (<8), no rotation step yet
    const aligned = apc.tickRotation();
    expect(aligned).toBe(false);
    expect(apc.facing).toBe(Dir.N); // still N after one tick
  });

  it('APC is not infantry (vehicles use stop-rotate-move)', () => {
    expect(UNIT_STATS.APC.isInfantry).toBe(false);
  });

  it('APC is not aircraft', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.isAirUnit).toBe(false);
  });

  it('APC is not naval', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.isNavalUnit).toBe(false);
  });
});

// ── Retaliation (techno.cpp) ─────────────────────────────────────────────────
// C++ techno.cpp — APC retaliates with M60mg when hit by enemy

describe('APC retaliation (techno.cpp)', () => {
  it('idle APC on GUARD mission retaliates when hit by enemy', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    apc.mission = Mission.GUARD;
    apc.target = null;

    const ctx = makeCombatCtx([apc, attacker]);
    triggerRetaliation(ctx, apc, attacker);

    expect(apc.target).toBe(attacker);
    expect(apc.mission).toBe(Mission.ATTACK);
  });

  it('APC CAN retaliate (has M60mg weapon)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.weapon).not.toBeNull();
    expect(apc.weapon!.name).toBe('M60mg');
  });

  it('APC does not retaliate against allies', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    apc.mission = Mission.GUARD;
    apc.target = null;

    const ctx = makeCombatCtx([apc, ally]);
    triggerRetaliation(ctx, apc, ally);

    expect(apc.target).toBeNull();
    expect(apc.mission).toBe(Mission.GUARD);
  });

  it('APC does not retarget if already has a living target', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    apc.mission = Mission.ATTACK;
    apc.target = existingTarget;

    const ctx = makeCombatCtx([apc, existingTarget, newAttacker]);
    triggerRetaliation(ctx, apc, newAttacker);

    expect(apc.target).toBe(existingTarget);
  });
});

// ── Damage / Speed Interaction (techno.cpp) ──────────────────────────────────
// C++ techno.cpp — APC takes damage normally as a standard vehicle

describe('APC damage and speed interaction (techno.cpp)', () => {
  it('APC takes full damage (no prone reduction — only infantry)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const hpBefore = apc.hp;
    apc.takeDamage(50, 'AP');
    expect(hpBefore - apc.hp).toBe(50);
  });

  it('APC does not gain fear (fear is infantry-only)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.fear).toBe(0);
    apc.takeDamage(50, 'AP');
    expect(apc.fear).toBe(0);
  });

  it('APC shows damage flash when hit', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.damageFlash).toBe(0);
    apc.takeDamage(50, 'AP');
    expect(apc.damageFlash).toBe(4);
  });

  it('invulnerable APC takes no damage (Iron Curtain or crate)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    apc.ironCurtainTick = 100;
    const hpBefore = apc.hp;
    const killed = apc.takeDamage(999, 'AP');
    expect(killed).toBe(false);
    expect(apc.hp).toBe(hpBefore);
    expect(apc.alive).toBe(true);
  });

  it('APC armorBias crate reduces damage (CR2)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    apc.armorBias = 2.0; // crate doubles armor
    const hpBefore = apc.hp;
    apc.takeDamage(100, 'AP');
    const damageTaken = hpBefore - apc.hp;
    // 100 / 2.0 = 50, rounded
    expect(damageTaken).toBe(50);
  });
});

// ── Vehicle Animation (unit.cpp) ─────────────────────────────────────────────
// C++ unit.cpp — APC uses vehicle sprite system (32-frame body rotation)

describe('APC vehicle animation (unit.cpp)', () => {
  it('APC is not infantry (uses vehicle sprite system)', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.stats.isInfantry).toBe(false);
  });

  it('APC is not ant', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.isAnt).toBe(false);
  });

  it('APC spriteFrame returns a valid vehicle frame number', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    const frame = apc.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('APC starts in IDLE animState', () => {
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 10, 10);
    expect(apc.alive).toBe(true);
    expect(apc.animState).toBe(AnimState.IDLE);
  });
});
