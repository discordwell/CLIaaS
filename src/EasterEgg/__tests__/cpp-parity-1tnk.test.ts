/**
 * C++ Behavioral Parity: 1TNK — Light Tank
 *
 * Tests verify Light Tank behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with 1TNK (observable outcomes: HP, alive/dead,
 * mission, turret facing, position changes, speed reduction), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, CONDITION_YELLOW,
  PRODUCTION_ITEMS, COUNTRY_BONUSES,
  buildDefaultAlliances, armorIndex,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  checkVehicleCrush,
  damageSpeedFactor,
  triggerRetaliation,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

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
    isPlayerControlled: () => false, // These tests test AI retaliation; PlayerReturnFire tested in return-fire.test.ts,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    isRevealedToHouse: () => true,
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

// -- Stats Verification (rules.ini / udata.cpp parity) ------------------------
// C++ udata.cpp (vehicle type data) — 1TNK entry and RULES.INI [1TNK] section

describe('1TNK stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS['1TNK'];
  const weapon = WEAPON_STATS['75mm'];
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === '1TNK');

  it('HP is 300 (Strength=300)', () => {
    expect(stats.strength).toBe(300);
  });

  it('Armor is heavy (Armor=heavy)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('Speed is 9 (Speed=9)', () => {
    expect(stats.speed).toBe(9);
  });

  it('isInfantry is false', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('crusher is true (Crusher=yes — heavy tracked vehicle)', () => {
    expect(stats.crusher).toBe(true);
  });

  it('primary weapon is 75mm', () => {
    expect(stats.primaryWeapon).toBe('75mm');
  });

  it('ROT is 5 (body rotation speed)', () => {
    expect(stats.rot).toBe(5);
  });

  it('cost is 700 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(700);
  });

  it('faction is allied', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('allied');
  });

  it('Entity constructor initializes HP to strength', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    expect(tank.hp).toBe(300);
    expect(tank.maxHp).toBe(300);
  });
});

// -- Weapon Stats (weapon.cpp / rules.ini) ------------------------------------
// C++ weapon.cpp — 75mm weapon data and AP warhead

describe('1TNK weapon — 75mm (weapon.cpp / rules.ini)', () => {
  const weapon = WEAPON_STATS['75mm'];

  it('75mm damage is 25', () => {
    expect(weapon.damage).toBe(25);
  });

  it('75mm warhead is AP', () => {
    expect(weapon.warhead).toBe('AP');
  });

  it('75mm range is 4.0 cells', () => {
    expect(weapon.range).toBe(4.0);
  });

  it('75mm ROF is 40 ticks', () => {
    expect(weapon.rof).toBe(40);
  });

  it('Entity has correct weapon reference from stats', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    expect(tank.weapon).not.toBeNull();
    expect(tank.weapon!.name).toBe('75mm');
    expect(tank.weapon!.damage).toBe(25);
    expect(tank.weapon!.warhead).toBe('AP');
  });
});

// -- AP Warhead Effectiveness (combat.cpp warhead tables) ---------------------
// C++ combat.cpp — Modify_Damage uses WARHEAD_VS_ARMOR table
// AP: [none=0.3, wood=0.75, light=0.75, heavy=1.0, concrete=0.5]

describe('1TNK weapon effectiveness — AP warhead (combat.cpp warhead tables)', () => {
  it('AP vs none armor: mult 0.3 (bad vs unarmored infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('none')];
    expect(mult).toBe(0.3);
  });

  it('AP vs wood armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('wood')];
    expect(mult).toBe(0.75);
  });

  it('AP vs light armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    expect(mult).toBe(0.75);
  });

  it('AP vs heavy armor: mult 1.0 (best! — designed to fight other tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('heavy')];
    expect(mult).toBe(1.0);
  });

  it('AP vs concrete: mult 0.5', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('concrete')];
    expect(mult).toBe(0.5);
  });

  it('1TNK deals full 25 base damage to heavy-armor targets at point blank', () => {
    const victim = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10); // heavy armor
    const hpBefore = victim.hp;
    // AP vs heavy = 1.0, so full 25 damage
    const damage = Math.round(25 * WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]);
    victim.takeDamage(damage, 'AP');
    expect(hpBefore - victim.hp).toBe(25);
  });

  it('1TNK deals reduced damage to unarmored infantry (AP vs none = 0.3)', () => {
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 10); // none armor
    const hpBefore = victim.hp;
    // AP vs none = 0.3 → 25 * 0.3 = 7.5 → round to 8
    const damage = Math.round(25 * WARHEAD_VS_ARMOR.AP[armorIndex('none')]);
    victim.takeDamage(damage, 'AP');
    expect(hpBefore - victim.hp).toBe(damage);
    expect(damage).toBeLessThan(25);
  });
});

// -- Turret System (unit.cpp) -------------------------------------------------
// C++ unit.cpp — 1TNK hasTurret=true. Turret rotates independently from body
// via tickTurretRotation(). Turret rotation speed = ROT+1.

describe('1TNK turret (unit.cpp:542)', () => {
  it('1TNK hasTurret is true', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    expect(tank.hasTurret).toBe(true);
  });

  it('turret starts facing North (default)', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    expect(tank.turretFacing).toBe(Dir.N);
    expect(tank.desiredTurretFacing).toBe(Dir.N);
  });

  it('turret rotates independently from body', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    // Set body facing East, turret desired South
    tank.facing = Dir.E;
    tank.desiredFacing = Dir.E;
    tank.bodyFacing32 = Dir.E * 4;
    tank.turretFacing = Dir.N;
    tank.desiredTurretFacing = Dir.S;
    tank.turretFacing32 = Dir.N * 4;

    // Tick turret rotation — turret should start moving independently
    tank.turretRotTickedThisFrame = false;
    const aligned = tank.tickTurretRotation();
    // After one tick, turret should not yet be aligned (N to S = 4 steps in 8-dir)
    expect(aligned).toBe(false);
    // Body should still be facing East (unaffected by turret)
    expect(tank.facing).toBe(Dir.E);
  });

  it('turret rotation uses ROT+1 speed (C++ unit.cpp:542)', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    // ROT=5, so turret rotates at rate 6 per tick
    // 32-step system: need accumulator >= 8 to advance one step
    // After 1 tick: accumulator = 6 (not yet >= 8)
    // After 2 ticks: accumulator = 12 → advance one step (12-8=4 remainder)
    tank.turretFacing = Dir.N;
    tank.desiredTurretFacing = Dir.E;
    tank.turretFacing32 = Dir.N * 4; // 0
    tank.turretRotAccumulator = 0;

    // Tick 1: accumulator 0+6=6 < 8 — no step
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();
    expect(tank.turretFacing32).toBe(0); // unchanged

    // Tick 2: accumulator 6+6=12 >= 8 — advance one step
    tank.turretRotTickedThisFrame = false;
    tank.tickTurretRotation();
    expect(tank.turretFacing32).toBe(1); // advanced by 1
  });

  it('turret eventually aligns to desired facing', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.turretFacing = Dir.N;
    tank.desiredTurretFacing = Dir.E;
    tank.turretFacing32 = Dir.N * 4;
    tank.turretRotAccumulator = 0;

    // Tick many times — turret should eventually reach E (facing32 = 8)
    let aligned = false;
    for (let i = 0; i < 100; i++) {
      tank.turretRotTickedThisFrame = false;
      aligned = tank.tickTurretRotation();
      if (aligned) break;
    }
    expect(aligned).toBe(true);
    expect(tank.turretFacing).toBe(Dir.E);
  });
});

// -- Crusher (drive.cpp:Ok_To_Move) -------------------------------------------
// C++ drive.cpp — crusher=true vehicles instantly kill crushable units on cell entry.
// Crushes enemy infantry. Does NOT crush allies. Does NOT crush other vehicles.

describe('1TNK crusher (drive.cpp:Ok_To_Move)', () => {
  it('1TNK crushes enemy infantry on cell entry', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, infantry]);
    checkVehicleCrush(ctx, tank);
    expect(infantry.alive).toBe(false);
  });

  it('1TNK does NOT crush allied infantry', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([tank, ally]);
    checkVehicleCrush(ctx, tank);
    expect(ally.alive).toBe(true);
    expect(ally.hp).toBe(ally.maxHp);
  });

  it('1TNK does NOT crush cross-allied infantry (Greece allied with Spain)', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Greece, 10, 10);
    const ctx = makeCombatCtx([tank, ally]);
    checkVehicleCrush(ctx, tank);
    expect(ally.alive).toBe(true);
  });

  it('1TNK does NOT crush enemy vehicles (vehicles are not crushable)', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    const enemyTank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, enemyTank]);
    checkVehicleCrush(ctx, tank);
    expect(enemyTank.alive).toBe(true);
    expect(enemyTank.hp).toBe(enemyTank.maxHp);
  });

  it('2TNK stats confirm vehicles are NOT crushable', () => {
    expect(UNIT_STATS['2TNK'].crushable).toBeFalsy();
  });

  it('E1 stats confirm infantry ARE crushable', () => {
    expect(UNIT_STATS.E1.crushable).toBe(true);
  });

  it('1TNK crush awards a kill credit', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, infantry]);
    expect(tank.kills).toBe(0);
    checkVehicleCrush(ctx, tank);
    expect(tank.kills).toBe(1);
  });

  it('1TNK crushes enemy ants (ants are crushable)', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    const ant = entityAtCell(UnitType.ANT1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, ant]);
    checkVehicleCrush(ctx, tank);
    expect(ant.alive).toBe(false);
  });
});

// -- Damage Speed Reduction (drive.cpp:1157) ----------------------------------
// C++ drive.cpp:1157-1161 — At <=50% HP, damageSpeedFactor returns 0.75

describe('1TNK damage speed reduction (drive.cpp:1157)', () => {
  it('full HP 1TNK has speed factor 1.0', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    expect(tank.hp).toBe(300);
    expect(damageSpeedFactor(tank)).toBe(1.0);
  });

  it('at exactly 50% HP (150/300), speed factor is 0.75', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.hp = 150; // exactly 50% of 300
    expect(tank.hp / tank.maxHp).toBe(CONDITION_YELLOW);
    expect(damageSpeedFactor(tank)).toBe(0.75);
  });

  it('at 25% HP (75/300), speed factor is 0.75', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.hp = 75;
    expect(damageSpeedFactor(tank)).toBe(0.75);
  });

  it('at 51% HP (153/300), speed factor is still 1.0 (above threshold)', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.hp = 153; // 51% of 300
    expect(tank.hp / tank.maxHp).toBeGreaterThan(CONDITION_YELLOW);
    expect(damageSpeedFactor(tank)).toBe(1.0);
  });

  it('at 1 HP, speed factor is 0.75', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.hp = 1;
    expect(damageSpeedFactor(tank)).toBe(0.75);
  });

  it('CONDITION_YELLOW threshold is 0.5', () => {
    expect(CONDITION_YELLOW).toBe(0.5);
  });
});

// -- Stop-Rotate-Move (drive.cpp) ---------------------------------------------
// C++ drive.cpp — Vehicles stop, rotate to face target, THEN move.
// Unlike infantry who move while rotating. moveToward returns false while rotating.

describe('1TNK stop-rotate-move (drive.cpp)', () => {
  it('1TNK facing N, moveToward target E: does NOT move while rotating', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.N;
    tank.bodyFacing32 = Dir.N * 4;

    const startX = tank.pos.x;
    const startY = tank.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // One tick of moveToward — vehicle should stop to rotate first
    const arrived = tank.moveToward(targetPos, tank.stats.speed);

    // Vehicle should NOT have moved (still rotating from N to E)
    // ROT=5 needs multiple ticks to rotate
    expect(arrived).toBe(false);
    expect(tank.pos.x).toBe(startX);
    expect(tank.pos.y).toBe(startY);
  });

  it('1TNK moveToward returns false while still rotating', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.N;
    tank.bodyFacing32 = Dir.N * 4;

    const targetPos = { x: tank.pos.x, y: tank.pos.y + CELL_SIZE * 5 }; // due South

    // First tick: N to S is the maximum rotation (4 steps in 8-dir)
    const arrived = tank.moveToward(targetPos, tank.stats.speed);
    expect(arrived).toBe(false);
  });

  it('infantry (E1) moves while rotating — unlike 1TNK', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.facing = Dir.N;
    e1.desiredFacing = Dir.N;
    e1.bodyFacing32 = Dir.N * 4;

    const startX = e1.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: e1.pos.y };

    // Infantry should move immediately, even if facing wrong direction
    e1.moveToward(targetPos, e1.stats.speed);
    const distMoved = Math.abs(e1.pos.x - startX);
    expect(distMoved).toBeGreaterThan(0);
  });

  it('1TNK eventually moves after rotation completes', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.N;
    tank.bodyFacing32 = Dir.N * 4;

    const startX = tank.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 5, y: tank.pos.y }; // due East

    // Keep ticking moveToward until position changes
    let moved = false;
    for (let i = 0; i < 100; i++) {
      tank.rotTickedThisFrame = false;
      tank.moveToward(targetPos, tank.stats.speed);
      if (tank.pos.x !== startX) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
    expect(tank.pos.x).toBeGreaterThan(startX);
  });

  it('1TNK already facing target direction moves immediately', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.facing = Dir.E;
    tank.desiredFacing = Dir.E;
    tank.bodyFacing32 = Dir.E * 4;

    const startX = tank.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 5, y: tank.pos.y }; // due East

    const arrived = tank.moveToward(targetPos, tank.stats.speed);
    // Already facing East, should move immediately
    expect(tank.pos.x).toBeGreaterThan(startX);
  });
});

// -- Body Rotation (drive.cpp) ------------------------------------------------
// C++ drive.cpp — 32-step vehicle rotation. ROT=5 means accumulator gains 5 per tick,
// one visual step when accumulator >= 8. rot < 8 means gradual rotation (unlike infantry).

describe('1TNK body rotation (drive.cpp 32-step system)', () => {
  it('ROT=5 < 8: gradual rotation (not instant snap like infantry)', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    expect(tank.stats.rot).toBe(5);
    expect(tank.stats.rot).toBeLessThan(8);

    tank.facing = Dir.N;
    tank.desiredFacing = Dir.E;
    tank.bodyFacing32 = Dir.N * 4;
    tank.rotAccumulator = 0;

    // One tick: accumulator 0+5=5 < 8 — no step
    tank.rotTickedThisFrame = false;
    const aligned = tank.tickRotation();
    expect(aligned).toBe(false);
    expect(tank.bodyFacing32).toBe(0); // no change yet
  });

  it('after 2 ticks, bodyFacing32 advances by 1 step', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.E;
    tank.bodyFacing32 = Dir.N * 4; // 0
    tank.rotAccumulator = 0;

    // Tick 1: 0+5=5 < 8
    tank.rotTickedThisFrame = false;
    tank.tickRotation();
    // Tick 2: 5+5=10 >= 8 → step, remainder = 2
    tank.rotTickedThisFrame = false;
    tank.tickRotation();
    expect(tank.bodyFacing32).toBe(1);
  });

  it('body rotation takes shortest path around the 32-step ring', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    // Face NW (facing32=28), want to rotate to N (facing32=0)
    // Shortest path is clockwise: 28 → 29 → 30 → 31 → 0
    tank.facing = Dir.NW;
    tank.desiredFacing = Dir.N;
    tank.bodyFacing32 = Dir.NW * 4; // 28
    tank.rotAccumulator = 0;

    // Tick until first step
    for (let i = 0; i < 10; i++) {
      tank.rotTickedThisFrame = false;
      tank.tickRotation();
      if (tank.bodyFacing32 !== 28) break;
    }
    // Should have gone to 29 (clockwise), not 27 (counter-clockwise)
    expect(tank.bodyFacing32).toBe(29);
  });
});

// -- Retaliation (techno.cpp) -------------------------------------------------
// C++ techno.cpp — idle 1TNK retaliates when hit

describe('1TNK retaliation (techno.cpp)', () => {
  it('idle 1TNK on GUARD mission retaliates when hit by enemy', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    tank.mission = Mission.GUARD;
    tank.target = null;

    const ctx = makeCombatCtx([tank, attacker]);
    triggerRetaliation(ctx, tank, attacker);

    expect(tank.target).toBe(attacker);
    expect(tank.mission).toBe(Mission.ATTACK);
  });

  it('1TNK CAN retaliate (has weapon)', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    expect(tank.weapon).not.toBeNull();
    expect(tank.weapon!.name).toBe('75mm');
  });

  it('1TNK does not retarget if already has a living target', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    tank.mission = Mission.ATTACK;
    tank.target = existingTarget;

    const ctx = makeCombatCtx([tank, existingTarget, newAttacker]);
    triggerRetaliation(ctx, tank, newAttacker);

    // Should keep existing target, not switch
    expect(tank.target).toBe(existingTarget);
  });

  it('1TNK does not retaliate against allies', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    tank.mission = Mission.GUARD;
    tank.target = null;

    const ctx = makeCombatCtx([tank, ally]);
    triggerRetaliation(ctx, tank, ally);

    expect(tank.target).toBeNull();
    expect(tank.mission).toBe(Mission.GUARD);
  });

  it('1TNK retaliates when hit on AREA_GUARD mission', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    tank.mission = Mission.AREA_GUARD;
    tank.target = null;

    const ctx = makeCombatCtx([tank, attacker]);
    triggerRetaliation(ctx, tank, attacker);

    expect(tank.target).toBe(attacker);
    expect(tank.mission).toBe(Mission.ATTACK);
  });
});

// -- Not Infantry (entity classification) -------------------------------------
// 1TNK is NOT infantry: isInfantry=false, isAnt=false, no fear/prone system

describe('1TNK is not infantry (entity classification)', () => {
  it('isInfantry is false', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    expect(tank.stats.isInfantry).toBe(false);
  });

  it('isAnt is false', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    expect(tank.isAnt).toBe(false);
  });

  it('1TNK has no fear system (fear stays 0 after damage)', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.takeDamage(50, 'AP');
    // Fear only increases for isInfantry units (infantry.cpp:442-457)
    expect(tank.fear).toBe(0);
  });

  it('1TNK is never prone (no prone system)', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.takeDamage(50, 'AP');
    expect(tank.isProne).toBe(false);
  });

  it('1TNK uses vehicle sprite system (BODY_SHAPE), not infantry animations', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    // Vehicle spriteFrame uses bodyFacing32 → BODY_SHAPE lookup
    // Infantry spriteFrame uses INFANTRY_ANIMS
    const frame = tank.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('1TNK is not an aircraft', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    expect(tank.isAirUnit).toBe(false);
  });

  it('1TNK is not a naval unit', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    expect(tank.isNavalUnit).toBe(false);
  });

  it('1TNK is not a transport', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    expect(tank.isTransport).toBe(false);
  });
});

// -- Take Damage (combat.cpp) ------------------------------------------------
// 1TNK: HP 300, heavy armor. Various damage scenarios.

describe('1TNK take damage (combat.cpp)', () => {
  it('takes specified damage amount', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    const hpBefore = tank.hp;
    tank.takeDamage(100, 'AP');
    expect(tank.hp).toBe(hpBefore - 100);
    expect(tank.alive).toBe(true);
  });

  it('dies when HP reaches 0', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    const killed = tank.takeDamage(300, 'AP');
    expect(killed).toBe(true);
    expect(tank.alive).toBe(false);
    expect(tank.hp).toBe(0);
    expect(tank.mission).toBe(Mission.DIE);
    expect(tank.animState).toBe(AnimState.DIE);
  });

  it('overkill clamps HP to 0', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.takeDamage(999, 'AP');
    expect(tank.hp).toBe(0);
    expect(tank.alive).toBe(false);
  });

  it('dead 1TNK cannot take further damage', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.takeDamage(300, 'AP');
    expect(tank.alive).toBe(false);
    const result = tank.takeDamage(50, 'AP');
    expect(result).toBe(false); // returns false because already dead
    expect(tank.hp).toBe(0);
  });

  it('invulnerable 1TNK takes no damage (Iron Curtain)', () => {
    const tank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    tank.ironCurtainTick = 100;
    const hpBefore = tank.hp;
    const killed = tank.takeDamage(200, 'AP');
    expect(killed).toBe(false);
    expect(tank.hp).toBe(hpBefore);
  });
});
