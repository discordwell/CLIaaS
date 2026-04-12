/**
 * C++ Behavioral Parity: 2TNK — Medium Tank
 *
 * Tests verify Medium Tank behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with 2TNK (observable outcomes: HP, alive/dead,
 * mission, position changes, turret rotation, crush behavior, speed reduction),
 * not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
  CONDITION_YELLOW,
  buildDefaultAlliances, armorIndex,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  checkVehicleCrush,
  triggerRetaliation,
  damageSpeedFactor,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';
import { COUNTRY_BONUSES } from '../engine/types';

beforeEach(() => resetEntityIds());

// -- Helpers -----------------------------------------------------------------

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

// -- Stats Verification (udata.cpp / rules.ini) ------------------------------
// C++ udata.cpp (unit type data) — 2TNK entry and RULES.INI [2TNK] section

describe('2TNK stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS['2TNK'];
  const weapon = WEAPON_STATS['90mm'];
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === '2TNK');

  it('HP is 400 (Strength=400)', () => {
    expect(stats.strength).toBe(400);
  });

  it('Armor is heavy (Armor=heavy)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('Speed is 8 (Speed=8)', () => {
    expect(stats.speed).toBe(8);
  });

  it('isInfantry is false', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('crusher is true (heavy tracked vehicle)', () => {
    expect(stats.crusher).toBe(true);
  });

  it('ROT is 5 (rotation rate)', () => {
    expect(stats.rot).toBe(5);
  });

  it('sight is 5', () => {
    expect(stats.sight).toBe(5);
  });

  it('primary weapon is 90mm', () => {
    expect(stats.primaryWeapon).toBe('90mm');
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
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.hp).toBe(400);
    expect(tank.maxHp).toBe(400);
  });
});

// -- Weapon Stats: 90mm (weapon.cpp) -----------------------------------------
// C++ weapon.cpp — 90mm weapon entry from RULES.INI

describe('2TNK weapon — 90mm (weapon.cpp)', () => {
  const weapon = WEAPON_STATS['90mm'];

  it('damage is 30', () => {
    expect(weapon.damage).toBe(30);
  });

  it('warhead is AP', () => {
    expect(weapon.warhead).toBe('AP');
  });

  it('range is 4.75 cells', () => {
    expect(weapon.range).toBe(4.75);
  });

  it('ROF is 50', () => {
    expect(weapon.rof).toBe(50);
  });

  it('Entity resolves weapon correctly from stats', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.weapon).not.toBeNull();
    expect(tank.weapon!.name).toBe('90mm');
    expect(tank.weapon!.damage).toBe(30);
  });

  it('no secondary weapon', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.weapon2).toBeNull();
  });
});

// -- AP Warhead Effectiveness (combat.cpp warhead tables) ---------------------
// C++ combat.cpp — Modify_Damage uses WARHEAD_VS_ARMOR table

describe('2TNK AP warhead effectiveness (combat.cpp warhead tables)', () => {
  it('AP vs none armor: mult 0.3 (poor vs unarmored infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('none')];
    expect(mult).toBe(0.3);
  });

  it('AP vs light armor: mult 0.75', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    expect(mult).toBe(0.75);
  });

  it('AP vs heavy armor: mult 1.0 (full damage vs other tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('heavy')];
    expect(mult).toBe(1.0);
  });

  it('AP vs concrete: mult 0.5', () => {
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('concrete')];
    expect(mult).toBe(0.5);
  });

  it('2TNK deals full 30 base damage vs heavy armor targets at point blank', () => {
    const victim = entityAtCell(UnitType.V_2TNK, House.USSR, 11, 10);
    const hpBefore = victim.hp;
    // AP vs heavy = 1.0, so 30 * 1.0 = 30
    victim.takeDamage(30, 'AP');
    expect(hpBefore - victim.hp).toBe(30);
  });

  it('2TNK deals reduced damage vs unarmored infantry (AP vs none = 0.3)', () => {
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    const hpBefore = victim.hp;
    // AP vs none = 0.3, so 30 * 0.3 = 9
    const damage = Math.round(30 * WARHEAD_VS_ARMOR.AP[armorIndex('none')]);
    victim.takeDamage(damage, 'AP');
    expect(hpBefore - victim.hp).toBe(damage);
    expect(damage).toBe(9);
  });
});

// -- Turret (unit.cpp) -------------------------------------------------------
// C++ unit.cpp — turreted vehicles have independent turret rotation

describe('2TNK turret (unit.cpp)', () => {
  it('hasTurret is true', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.hasTurret).toBe(true);
  });

  it('turretFacing is independent of body facing', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.facing = Dir.N;
    tank.bodyFacing32 = Dir.N * 4;
    tank.turretFacing = Dir.E;
    tank.turretFacing32 = Dir.E * 4;
    // Body and turret can point in different directions
    expect(tank.facing).not.toBe(tank.turretFacing);
    expect(tank.facing).toBe(Dir.N);
    expect(tank.turretFacing).toBe(Dir.E);
  });

  it('turret rotation is gradual (ROT+1 per tick, 32-step)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.turretFacing = Dir.N;
    tank.turretFacing32 = Dir.N * 4;
    tank.desiredTurretFacing = Dir.E; // 90 degrees clockwise
    tank.turretRotAccumulator = 0;

    // First tick: accumulate ROT+1 = 5+1 = 6, threshold is 8, no step yet
    const aligned1 = tank.tickTurretRotation();
    expect(aligned1).toBe(false);

    // Reset double-tick guard
    tank.turretRotTickedThisFrame = false;

    // Second tick: 6 + 6 = 12 >= 8 => one step (subtract 8 => remainder 4)
    const aligned2 = tank.tickTurretRotation();
    // Turret should have advanced 1 step of 32 but not yet at Dir.E
    expect(tank.turretFacing32).toBeGreaterThan(0); // moved from 0
    expect(aligned2).toBe(false); // Dir.E = step 8, still far away
  });

  it('turretFrame getter produces offset 32+ range', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const frame = tank.turretFrame;
    // Turret frames are 32-63 in the SHP
    expect(frame).toBeGreaterThanOrEqual(32);
    expect(frame).toBeLessThan(64);
  });
});

// -- Crusher Behavior (drive.cpp:Ok_To_Move) ---------------------------------
// C++ drive.cpp — when a Crusher vehicle enters a cell with a Crushable unit,
// the crushable unit dies instantly. Allied units are not crushed.

describe('2TNK crusher (drive.cpp:Ok_To_Move)', () => {
  it('crushes enemy infantry on same cell', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, infantry]);
    checkVehicleCrush(ctx, tank);
    expect(infantry.alive).toBe(false);
  });

  it('does NOT crush allied infantry (IsAFriend check)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([tank, ally]);
    checkVehicleCrush(ctx, tank);
    expect(ally.alive).toBe(true);
    expect(ally.hp).toBe(ally.maxHp);
  });

  it('does NOT crush cross-allied infantry (Greece allied with Spain)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Greece, 10, 10);
    const ctx = makeCombatCtx([tank, ally]);
    checkVehicleCrush(ctx, tank);
    expect(ally.alive).toBe(true);
  });

  it('does NOT crush enemy vehicles (vehicles are not crushable)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const enemyTank = entityAtCell(UnitType.V_1TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, enemyTank]);
    checkVehicleCrush(ctx, tank);
    expect(enemyTank.alive).toBe(true);
    expect(enemyTank.hp).toBe(enemyTank.maxHp);
  });

  it('1TNK stats confirm vehicles are not crushable', () => {
    expect(UNIT_STATS['1TNK'].crushable).toBeFalsy();
  });

  it('E1 stats confirm infantry are crushable', () => {
    expect(UNIT_STATS.E1.crushable).toBe(true);
  });

  it('crush credits the kill to the crusher', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, infantry]);
    const killsBefore = tank.kills;
    checkVehicleCrush(ctx, tank);
    expect(tank.kills).toBe(killsBefore + 1);
  });

  it('crushing produces blood effect', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([tank, infantry]);
    checkVehicleCrush(ctx, tank);
    const bloodEffects = ctx.effects.filter(e => e.type === 'blood');
    expect(bloodEffects.length).toBeGreaterThanOrEqual(1);
  });
});

// -- Damage Speed Reduction (drive.cpp:1157-1161) ----------------------------
// C++ drive.cpp — vehicles at <= 50% HP move at 75% speed

describe('2TNK damage speed reduction (drive.cpp:1157-1161)', () => {
  it('full HP: speed factor is 1.0', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(damageSpeedFactor(tank)).toBe(1.0);
  });

  it('at exactly 50% HP: speed factor is 0.75 (CONDITION_YELLOW threshold)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.hp = tank.maxHp * CONDITION_YELLOW; // exactly 200 (50%)
    expect(damageSpeedFactor(tank)).toBe(0.75);
  });

  it('at 25% HP (below 50%): speed factor is 0.75', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.hp = 100; // 25% of 400
    expect(tank.hp / tank.maxHp).toBe(0.25);
    expect(damageSpeedFactor(tank)).toBe(0.75);
  });

  it('at 51% HP (above threshold): speed factor is 1.0', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.hp = 204; // 51%
    expect(tank.hp / tank.maxHp).toBeGreaterThan(CONDITION_YELLOW);
    expect(damageSpeedFactor(tank)).toBe(1.0);
  });

  it('at 1 HP: speed factor is 0.75', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.hp = 1;
    expect(damageSpeedFactor(tank)).toBe(0.75);
  });

  it('CONDITION_YELLOW is 0.5', () => {
    expect(CONDITION_YELLOW).toBe(0.5);
  });
});

// -- Stop-Rotate-Move (drive.cpp) -------------------------------------------
// C++ drive.cpp — vehicles stop, rotate to face destination, THEN move.
// Infantry are nimble and can move while rotating.

describe('2TNK stop-rotate-move (drive.cpp)', () => {
  it('facing N, target E: does NOT move until rotation completes', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.N;
    tank.bodyFacing32 = Dir.N * 4;

    const startX = tank.pos.x;
    const startY = tank.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // One moveToward tick — vehicle should stop to rotate
    const arrived = tank.moveToward(targetPos, tank.stats.speed);

    expect(arrived).toBe(false);
    // Position unchanged because vehicle stops to rotate
    expect(tank.pos.x).toBe(startX);
    expect(tank.pos.y).toBe(startY);
  });

  it('facing E, target E: moves immediately (already aligned)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.facing = Dir.E;
    tank.desiredFacing = Dir.E;
    tank.bodyFacing32 = Dir.E * 4;

    const startX = tank.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: tank.pos.y };

    tank.moveToward(targetPos, tank.stats.speed);

    // Should have moved east
    expect(tank.pos.x).toBeGreaterThan(startX);
  });

  it('vehicle rotation is gradual (rot=5, not instant like infantry rot=8)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.stats.rot).toBe(5);
    // rot < 8 means gradual 32-step rotation
    expect(tank.stats.rot).toBeLessThan(8);

    tank.facing = Dir.N;
    tank.desiredFacing = Dir.S; // opposite direction
    tank.bodyFacing32 = Dir.N * 4;
    const aligned = tank.tickRotation();
    // Should NOT snap instantly (rot=5 < 8)
    expect(aligned).toBe(false);
  });

  it('multiple ticks eventually complete rotation', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.E;
    tank.bodyFacing32 = Dir.N * 4;
    tank.rotAccumulator = 0;

    // Rotate until aligned (max 50 ticks to prevent infinite loop)
    let aligned = false;
    for (let i = 0; i < 50; i++) {
      tank.rotTickedThisFrame = false;
      aligned = tank.tickRotation();
      if (aligned) break;
    }
    expect(aligned).toBe(true);
    expect(tank.facing).toBe(Dir.E);
  });
});

// -- Stronger than 1TNK (udata.cpp comparison) --------------------------------
// C++ udata.cpp — 2TNK is a direct upgrade over 1TNK in all combat stats

describe('2TNK vs 1TNK comparison (udata.cpp)', () => {
  const stats2 = UNIT_STATS['2TNK'];
  const stats1 = UNIT_STATS['1TNK'];
  const weapon2 = WEAPON_STATS['90mm'];
  const weapon1 = WEAPON_STATS['75mm'];

  it('2TNK has more HP: 400 vs 300', () => {
    expect(stats2.strength).toBe(400);
    expect(stats1.strength).toBe(300);
    expect(stats2.strength).toBeGreaterThan(stats1.strength);
  });

  it('2TNK 90mm deals more damage: 30 vs 25', () => {
    expect(weapon2.damage).toBe(30);
    expect(weapon1.damage).toBe(25);
    expect(weapon2.damage).toBeGreaterThan(weapon1.damage);
  });

  it('2TNK has longer range: 4.75 vs 4.0', () => {
    expect(weapon2.range).toBe(4.75);
    expect(weapon1.range).toBe(4.0);
    expect(weapon2.range).toBeGreaterThan(weapon1.range);
  });

  it('both use AP warhead', () => {
    expect(weapon2.warhead).toBe('AP');
    expect(weapon1.warhead).toBe('AP');
  });

  it('both have heavy armor', () => {
    expect(stats2.armor).toBe('heavy');
    expect(stats1.armor).toBe('heavy');
  });

  it('both are crushers', () => {
    expect(stats2.crusher).toBe(true);
    expect(stats1.crusher).toBe(true);
  });

  it('2TNK is slower: speed 8 vs 9', () => {
    expect(stats2.speed).toBe(8);
    expect(stats1.speed).toBe(9);
    expect(stats2.speed).toBeLessThan(stats1.speed);
  });

  it('2TNK costs more: 800 vs 700', () => {
    const prod2 = PRODUCTION_ITEMS.find(p => p.type === '2TNK');
    const prod1 = PRODUCTION_ITEMS.find(p => p.type === '1TNK');
    expect(prod2!.cost).toBe(800);
    expect(prod1!.cost).toBe(700);
    expect(prod2!.cost).toBeGreaterThan(prod1!.cost);
  });

  it('same ROT: both 5', () => {
    expect(stats2.rot).toBe(5);
    expect(stats1.rot).toBe(5);
  });
});

// -- Retaliation (techno.cpp) ------------------------------------------------
// C++ techno.cpp — idle/moving units counter-attack when hit by enemy

describe('2TNK retaliation (techno.cpp)', () => {
  it('idle 2TNK on GUARD mission retaliates when hit by enemy', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    tank.mission = Mission.GUARD;
    tank.target = null;

    const ctx = makeCombatCtx([tank, attacker]);
    triggerRetaliation(ctx, tank, attacker);

    expect(tank.target).toBe(attacker);
    expect(tank.mission).toBe(Mission.ATTACK);
  });

  it('2TNK CAN retaliate (has weapon)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.weapon).not.toBeNull();
    expect(tank.weapon!.name).toBe('90mm');
  });

  it('does not retarget if already has a living target', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    tank.mission = Mission.ATTACK;
    tank.target = existingTarget;

    const ctx = makeCombatCtx([tank, existingTarget, newAttacker]);
    triggerRetaliation(ctx, tank, newAttacker);

    // Should keep existing target, not switch
    expect(tank.target).toBe(existingTarget);
  });

  it('does not retaliate against allies', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Greece, 11, 10);
    tank.mission = Mission.GUARD;
    tank.target = null;

    const ctx = makeCombatCtx([tank, ally]);
    triggerRetaliation(ctx, tank, ally);

    expect(tank.target).toBeNull();
    expect(tank.mission).toBe(Mission.GUARD);
  });

  it('retaliates when current target is dead', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const deadTarget = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    deadTarget.alive = false;
    const newAttacker = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    tank.mission = Mission.ATTACK;
    tank.target = deadTarget;

    const ctx = makeCombatCtx([tank, deadTarget, newAttacker]);
    triggerRetaliation(ctx, tank, newAttacker);

    // Should switch to new attacker since old target is dead
    expect(tank.target).toBe(newAttacker);
    expect(tank.mission).toBe(Mission.ATTACK);
  });
});

// -- Death / Destruction (techno.cpp) ----------------------------------------
// C++ techno.cpp — unit death when HP reaches 0

describe('2TNK death (techno.cpp)', () => {
  it('dies when HP reaches 0', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const killed = tank.takeDamage(400, 'AP');
    expect(killed).toBe(true);
    expect(tank.alive).toBe(false);
    expect(tank.hp).toBe(0);
  });

  it('mission becomes DIE on death', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    tank.takeDamage(400, 'AP');
    expect(tank.mission).toBe(Mission.DIE);
  });

  it('animState becomes DIE on death', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    tank.takeDamage(400, 'AP');
    expect(tank.animState).toBe(AnimState.DIE);
  });

  it('survives with 1 HP after taking 399 damage', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const killed = tank.takeDamage(399, 'AP');
    expect(killed).toBe(false);
    expect(tank.alive).toBe(true);
    expect(tank.hp).toBe(1);
  });

  it('overkill damage clamps HP to 0', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    tank.takeDamage(999, 'AP');
    expect(tank.hp).toBe(0);
    expect(tank.alive).toBe(false);
  });

  it('invulnerable 2TNK takes no damage', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.ironCurtainTick = 100; // invulnerable
    const killed = tank.takeDamage(400, 'AP');
    expect(killed).toBe(false);
    expect(tank.hp).toBe(400);
    expect(tank.alive).toBe(true);
  });
});

// -- Vehicle Animation (unit.cpp) --------------------------------------------
// C++ unit.cpp — vehicles use 32-frame body rotation via BODY_SHAPE

describe('2TNK vehicle animation (unit.cpp)', () => {
  it('isInfantry is false', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.stats.isInfantry).toBe(false);
  });

  it('isAnt is false', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.isAnt).toBe(false);
  });

  it('spriteFrame uses vehicle BODY_SHAPE system (valid frame number)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const frame = tank.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
    expect(frame).toBeLessThan(32); // body frames are 0-31
  });

  it('starts in IDLE animState', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.animState).toBe(AnimState.IDLE);
  });

  it('isAirUnit is false', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.isAirUnit).toBe(false);
  });

  it('isNavalUnit is false', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.isNavalUnit).toBe(false);
  });
});

// -- Range Check (entity.ts:inRange) -----------------------------------------
// C++ techno.cpp — Can_Fire range check

describe('2TNK range check (techno.cpp)', () => {
  it('target within 4.75 cells is in range', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.V_1TNK, House.USSR, 14, 10); // ~4 cells away
    expect(tank.inRange(target)).toBe(true);
  });

  it('target beyond 4.75 cells is out of range', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    // Place target > 4.75 cells away
    const target = new Entity(UnitType.V_1TNK, House.USSR,
      tank.pos.x + CELL_SIZE * 5.5, tank.pos.y);
    expect(tank.inRange(target)).toBe(false);
  });

  it('1TNK has shorter range than 2TNK (4.0 vs 4.75)', () => {
    const tank1 = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    // Target at 4.5 cells: in range for 2TNK (4.75) but out of range for 1TNK (4.0)
    const target = new Entity(UnitType.V_2TNK, House.USSR,
      tank1.pos.x + CELL_SIZE * 4.5, tank1.pos.y);
    const tank2 = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank1.inRange(target)).toBe(false); // 4.5 > 4.0
    expect(tank2.inRange(target)).toBe(true);  // 4.5 < 4.75
  });
});

// -- Crate Bias Effects (entity.ts) ------------------------------------------
// C++ techno.cpp — crate pickups modify unit stats via bias multipliers

describe('2TNK crate bias effects', () => {
  it('default speedBias is 1.0', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.speedBias).toBe(1.0);
  });

  it('default armorBias is 1.0', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.armorBias).toBe(1.0);
  });

  it('default firepowerBias is 1.0', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank.firepowerBias).toBe(1.0);
  });

  it('armorBias > 1.0 reduces damage taken', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    tank.armorBias = 2.0; // CR2: half damage
    const hpBefore = tank.hp;
    tank.takeDamage(30, 'AP');
    const damageTaken = hpBefore - tank.hp;
    // 30 / 2.0 = 15
    expect(damageTaken).toBe(15);
  });
});
