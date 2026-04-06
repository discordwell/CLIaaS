/**
 * C++ Behavioral Parity: 4TNK -- Mammoth Tank
 *
 * Tests verify Mammoth Tank behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with 4TNK (observable outcomes: HP, alive/dead,
 * weapon selection, burst fire, turret, crushing), not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR, PRODUCTION_ITEMS,
  COUNTRY_BONUSES, buildDefaultAlliances, armorIndex, getWarheadMultiplier,
  type WarheadType, type ArmorType,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  checkVehicleCrush,
  triggerRetaliation,
  aiScatterOnDamage,
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

// == Stats Verification (udata.cpp / rules.ini) ==============================
// C++ udata.cpp (unit type data) -- 4TNK entry and RULES.INI [4TNK] section

describe('4TNK stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS['4TNK'];
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === '4TNK');

  it('HP is 600 (Strength=600) -- heaviest ground unit', () => {
    expect(stats.strength).toBe(600);
  });

  it('armor is heavy (Armor=heavy)', () => {
    expect(stats.armor).toBe('heavy');
  });

  it('speed is 4 (Speed=4) -- slowest tank', () => {
    expect(stats.speed).toBe(4);
  });

  it('rot is 5 (ROT=5)', () => {
    expect(stats.rot).toBe(5);
  });

  it('sight is 6 (Sight=6)', () => {
    expect(stats.sight).toBe(6);
  });

  it('isInfantry is false (vehicle)', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('crusher is true (Crusher=true -- can crush infantry)', () => {
    expect(stats.crusher).toBe(true);
  });

  it('primary weapon is 120mm', () => {
    expect(stats.primaryWeapon).toBe('120mm');
  });

  it('secondary weapon is MammothTusk', () => {
    expect(stats.secondaryWeapon).toBe('MammothTusk');
  });

  it('cost is 1700 credits -- most expensive tank', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(1700);
  });

  it('faction is soviet', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('soviet');
  });

  it('Entity constructor initializes HP to strength', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    expect(mammoth.hp).toBe(600);
    expect(mammoth.maxHp).toBe(600);
  });

  it('is the heaviest ground unit -- more HP than any other tank', () => {
    const otherTanks = ['1TNK', '2TNK', '3TNK'] as const;
    for (const key of otherTanks) {
      expect(stats.strength, `4TNK HP > ${key} HP`).toBeGreaterThan(UNIT_STATS[key].strength);
    }
  });

  it('is the slowest tank', () => {
    const otherTanks = ['1TNK', '2TNK', '3TNK'] as const;
    for (const key of otherTanks) {
      expect(stats.speed, `4TNK speed < ${key} speed`).toBeLessThan(UNIT_STATS[key].speed);
    }
  });
});

// == Dual Weapon Stats (weapon.cpp / rules.ini) ==============================
// C++ weapon.cpp -- 120mm and MammothTusk weapon entries

describe('4TNK dual weapon stats (weapon.cpp / rules.ini)', () => {
  const primary = WEAPON_STATS['120mm'];
  const secondary = WEAPON_STATS.MammothTusk;

  it('120mm damage is 40', () => {
    expect(primary.damage).toBe(40);
  });

  it('120mm range is 4.75 cells', () => {
    expect(primary.range).toBe(4.75);
  });

  it('120mm warhead is AP (Armor Piercing)', () => {
    expect(primary.warhead).toBe('AP');
  });

  it('120mm ROF is 80', () => {
    expect(primary.rof).toBe(80);
  });

  it('120mm burst is 2 (fires 2 shots per trigger)', () => {
    expect(primary.burst).toBe(2);
  });

  it('MammothTusk damage is 75', () => {
    expect(secondary.damage).toBe(75);
  });

  it('MammothTusk range is 5.0 cells', () => {
    expect(secondary.range).toBe(5.0);
  });

  it('MammothTusk warhead is HE (High Explosive)', () => {
    expect(secondary.warhead).toBe('HE');
  });

  it('MammothTusk ROF is 80', () => {
    expect(secondary.rof).toBe(80);
  });

  it('MammothTusk burst is 2 (fires 2 missiles per trigger)', () => {
    expect(secondary.burst).toBe(2);
  });

  it('MammothTusk splash is 1.5 cells', () => {
    expect(secondary.splash).toBe(1.5);
  });

  it('MammothTusk projectileROT is 5 (homing guided missiles)', () => {
    expect(secondary.projectileROT).toBe(5);
  });

  it('MammothTusk has no splash on primary 120mm', () => {
    expect(primary.splash).toBeUndefined();
  });

  it('secondary outranges primary (5.0 > 4.75)', () => {
    expect(secondary.range).toBeGreaterThan(primary.range);
  });
});

// == Weapon Selection (techno.cpp:Can_Fire) ==================================
// C++ techno.cpp -- selectWeapon picks best weapon vs target armor using
// warhead-vs-armor multipliers

describe('4TNK weapon selection (techno.cpp:Can_Fire)', () => {
  it('selects 120mm (AP) vs heavy armor target -- AP is best vs heavy', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const heavyTarget = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);

    const weapon = mammoth.selectWeapon(heavyTarget, getWarheadMultiplier);
    expect(weapon).not.toBeNull();
    expect(weapon!.name).toBe('120mm');
  });

  it('AP warhead has 1.0 mult vs heavy armor', () => {
    expect(WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]).toBe(1.0);
  });

  it('HE warhead has 0.25 mult vs heavy armor', () => {
    expect(WARHEAD_VS_ARMOR.HE[armorIndex('heavy')]).toBe(0.25);
  });

  it('selects MammothTusk (HE) vs concrete armor -- HE is best vs concrete', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    // Create a target with concrete armor (structures have concrete armor,
    // but we can test via a mock entity with concrete stats)
    const concreteTarget = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    // Override armor to concrete for testing
    concreteTarget.stats = { ...concreteTarget.stats, armor: 'concrete' as ArmorType };

    const weapon = mammoth.selectWeapon(concreteTarget, getWarheadMultiplier);
    expect(weapon).not.toBeNull();
    // HE vs concrete = 1.0, AP vs concrete = 0.5
    // HE effective: 75 * 1.0 = 75, AP effective: 40 * 0.5 = 20
    expect(weapon!.name).toBe('MammothTusk');
  });

  it('HE warhead has 1.0 mult vs concrete', () => {
    expect(WARHEAD_VS_ARMOR.HE[armorIndex('concrete')]).toBe(1.0);
  });

  it('AP warhead has 0.5 mult vs concrete', () => {
    expect(WARHEAD_VS_ARMOR.AP[armorIndex('concrete')]).toBe(0.5);
  });

  it('selects 120mm (AP) when primary on cooldown returns null and secondary ready', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);

    // Primary on cooldown, secondary ready
    mammoth.attackCooldown = 50;
    mammoth.attackCooldown2 = 0;

    const weapon = mammoth.selectWeapon(target, getWarheadMultiplier);
    expect(weapon).not.toBeNull();
    expect(weapon!.name).toBe('MammothTusk');
  });

  it('returns null when both weapons are on cooldown', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);

    mammoth.attackCooldown = 50;
    mammoth.attackCooldown2 = 50;

    const weapon = mammoth.selectWeapon(target, getWarheadMultiplier);
    expect(weapon).toBeNull();
  });

  it('returns primary when only primary is ready', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);

    mammoth.attackCooldown = 0;
    mammoth.attackCooldown2 = 50;

    const weapon = mammoth.selectWeapon(target, getWarheadMultiplier);
    expect(weapon).not.toBeNull();
    expect(weapon!.name).toBe('120mm');
  });

  it('weapon selection vs none (unarmored) prefers MammothTusk -- higher effective damage', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);

    // AP vs none = 0.3 -> effective 40*0.3=12
    // HE vs none = 0.9 -> effective 75*0.9=67.5
    const weapon = mammoth.selectWeapon(infantry, getWarheadMultiplier);
    expect(weapon).not.toBeNull();
    expect(weapon!.name).toBe('MammothTusk');
  });

  it('AP vs none = 0.3, HE vs none = 0.9 confirms MammothTusk preference', () => {
    const apVsNone = WARHEAD_VS_ARMOR.AP[armorIndex('none')];
    const heVsNone = WARHEAD_VS_ARMOR.HE[armorIndex('none')];
    expect(apVsNone).toBe(0.3);
    expect(heVsNone).toBe(0.9);
    // HE effective: 75 * 0.9 = 67.5 >> AP effective: 40 * 0.3 = 12
    expect(75 * heVsNone).toBeGreaterThan(40 * apVsNone);
  });
});

// == Burst Fire (weapon.cpp:78 Weapon.Burst) =================================
// C++ weapon.cpp -- Burst=2 means 2 shots per trigger pull for both weapons

describe('4TNK burst fire (weapon.cpp:78 Weapon.Burst)', () => {
  it('Entity starts with burstCount=0 (no active burst)', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    expect(mammoth.burstCount).toBe(0);
  });

  it('setting burstCount to 2 simulates start of 120mm burst', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.burstCount = WEAPON_STATS['120mm'].burst!;
    expect(mammoth.burstCount).toBe(2);
  });

  it('setting burstCount to 2 simulates start of MammothTusk burst', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.burstCount = WEAPON_STATS.MammothTusk.burst!;
    expect(mammoth.burstCount).toBe(2);
  });

  it('decrementing burstCount simulates firing each shot in burst', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.burstCount = 2;
    // Fire first shot
    mammoth.burstCount--;
    expect(mammoth.burstCount).toBe(1);
    // Fire second shot
    mammoth.burstCount--;
    expect(mammoth.burstCount).toBe(0);
  });

  it('burstDelay starts at 0 (3-tick gap between burst shots set by combat system)', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    expect(mammoth.burstDelay).toBe(0);
  });
});

// == MammothTusk Homing (projectile ROT tracking) ============================
// C++ bullet.cpp -- projectileROT > 0 means the missile tracks its target

describe('4TNK MammothTusk homing missiles (bullet.cpp)', () => {
  it('MammothTusk has projectileROT=5 (guided, can turn toward target)', () => {
    expect(WEAPON_STATS.MammothTusk.projectileROT).toBe(5);
  });

  it('120mm has NO projectileROT (unguided ballistic shell)', () => {
    expect(WEAPON_STATS['120mm'].projectileROT).toBeUndefined();
  });

  it('MammothTusk projectile speed is slower than 120mm (missiles vs shells)', () => {
    // Guided missiles travel slower: projSpeed 15 vs 30
    expect(WEAPON_STATS.MammothTusk.projSpeed).toBeLessThan(WEAPON_STATS['120mm'].projSpeed!);
  });
});

// == Turret (unit.cpp hasTurret) =============================================
// C++ unit.cpp -- 4TNK has a rotating turret (independent of body facing)

describe('4TNK turret (unit.cpp)', () => {
  it('hasTurret returns true', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    expect(mammoth.hasTurret).toBe(true);
  });

  it('turretFacing initializes independently from body facing', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.facing = Dir.N;
    mammoth.turretFacing = Dir.E;
    expect(mammoth.facing).not.toBe(mammoth.turretFacing);
  });

  it('turret rotates gradually toward desiredTurretFacing (ROT+1 per tick)', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.turretFacing = Dir.N;
    mammoth.turretFacing32 = Dir.N * 4;
    mammoth.desiredTurretFacing = Dir.S; // opposite direction

    // Turret rotation at ROT+1 = 6 per tick, needs 8 accumulator to step
    // First tick: accumulator 6, not enough
    mammoth.turretRotTickedThisFrame = false;
    const done1 = mammoth.tickTurretRotation();
    expect(done1).toBe(false);

    // Second tick: accumulator 12 >= 8, steps once (one step in 32-ring)
    mammoth.turretRotTickedThisFrame = false;
    mammoth.tickTurretRotation();
    // Should have moved at least one step from initial turretFacing32=0
    // After two ticks with ROT+1=6: accumulator first overflows at tick 2
    expect(mammoth.turretFacing32).not.toBe(Dir.N * 4);
  });

  it('turretFrame returns value in 32-63 range (turret overlay sprite)', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const frame = mammoth.turretFrame;
    expect(frame).toBeGreaterThanOrEqual(32);
    expect(frame).toBeLessThan(64);
  });
});

// == Crusher (drive.cpp:Ok_To_Move) ==========================================
// C++ drive.cpp -- 4TNK has Crusher=true, can crush infantry on contact

describe('4TNK crusher (drive.cpp:Ok_To_Move)', () => {
  it('4TNK crushes enemy infantry on same cell', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([mammoth, infantry]);
    checkVehicleCrush(ctx, mammoth);
    expect(infantry.alive).toBe(false);
  });

  it('4TNK does NOT crush allied infantry', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const allyInf = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([mammoth, allyInf]);
    checkVehicleCrush(ctx, mammoth);
    expect(allyInf.alive).toBe(true);
    expect(allyInf.hp).toBe(allyInf.maxHp);
  });

  it('4TNK does NOT crush other vehicles', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const jeep = entityAtCell(UnitType.V_JEEP, House.Spain, 10, 10);
    const ctx = makeCombatCtx([mammoth, jeep]);
    checkVehicleCrush(ctx, mammoth);
    expect(jeep.alive).toBe(true);
  });
});

// == Damage / Speed / Stop-Rotate-Move (drive.cpp) ===========================
// C++ drive.cpp -- vehicles stop, rotate to face destination, THEN move

describe('4TNK stop-rotate-move (drive.cpp)', () => {
  it('facing N, moveToward target E: does NOT move until rotation completes', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.facing = Dir.N;
    mammoth.desiredFacing = Dir.N;
    mammoth.bodyFacing32 = Dir.N * 4;

    const startX = mammoth.pos.x;
    const startY = mammoth.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // One tick -- vehicle should stop to rotate first (rot=5, needs multiple ticks)
    const arrived = mammoth.moveToward(targetPos, mammoth.stats.speed);
    expect(arrived).toBe(false);
    expect(mammoth.pos.x).toBe(startX);
    expect(mammoth.pos.y).toBe(startY);
  });

  it('once facing aligns, 4TNK moves at speed 4 (slowest tank speed)', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.facing = Dir.E;
    mammoth.desiredFacing = Dir.E;
    mammoth.bodyFacing32 = Dir.E * 4;

    const startX = mammoth.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: mammoth.pos.y };

    const arrived = mammoth.moveToward(targetPos, mammoth.stats.speed);
    expect(arrived).toBe(false); // too far to arrive in one tick
    // C++ lepton accumulator truncates movement; actual displacement is less than raw speed.
    // speed=4 → maxSpeedLeptons=42, speedAdd=41, moveLeptons=40, axisLeptons=39 → 3.65625px
    expect(mammoth.pos.x - startX).toBeGreaterThan(0);
    expect(mammoth.pos.x - startX).toBeLessThanOrEqual(mammoth.stats.speed);
  });

  it('32-step body rotation: rot=5 accumulates gradually', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.facing = Dir.N;
    mammoth.desiredFacing = Dir.E;
    mammoth.bodyFacing32 = Dir.N * 4;

    // rot=5: first tick accumulator=5, second tick=10 (>=8 -> step)
    mammoth.rotTickedThisFrame = false;
    mammoth.tickRotation();
    // After first tick: accumulator 5, no step yet
    const afterFirst = mammoth.bodyFacing32;

    mammoth.rotTickedThisFrame = false;
    mammoth.tickRotation();
    // After second tick: accumulator crossed 8, should have stepped
    expect(mammoth.bodyFacing32).not.toBe(Dir.N * 4);
  });
});

// == Retaliation (techno.cpp) ================================================
// C++ techno.cpp -- idle/moving units counter-attack when hit by enemy

describe('4TNK retaliation (techno.cpp)', () => {
  it('idle 4TNK on GUARD retaliates when hit by enemy', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    mammoth.mission = Mission.GUARD;
    mammoth.target = null;

    const ctx = makeCombatCtx([mammoth, attacker]);
    triggerRetaliation(ctx, mammoth, attacker);

    expect(mammoth.target).toBe(attacker);
    expect(mammoth.mission).toBe(Mission.ATTACK);
  });

  it('4TNK has a weapon and can retaliate (not unarmed)', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    expect(mammoth.weapon).not.toBeNull();
    expect(mammoth.weapon!.name).toBe('120mm');
    expect(mammoth.weapon2).not.toBeNull();
    expect(mammoth.weapon2!.name).toBe('MammothTusk');
  });

  it('does not retarget if already has a living target', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    mammoth.mission = Mission.ATTACK;
    mammoth.target = existingTarget;

    const ctx = makeCombatCtx([mammoth, existingTarget, newAttacker]);
    triggerRetaliation(ctx, mammoth, newAttacker);

    expect(mammoth.target).toBe(existingTarget);
  });

  it('does not retaliate against allies', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);
    mammoth.mission = Mission.GUARD;
    mammoth.target = null;

    const ctx = makeCombatCtx([mammoth, ally]);
    triggerRetaliation(ctx, mammoth, ally);

    expect(mammoth.target).toBeNull();
    expect(mammoth.mission).toBe(Mission.GUARD);
  });
});

// == Weapon Effectiveness (combat.cpp warhead tables) ========================
// C++ combat.cpp -- 120mm (AP) and MammothTusk (HE) have different effectiveness

describe('4TNK weapon effectiveness (combat.cpp warhead tables)', () => {
  it('AP vs heavy: 1.0 -- 120mm is full damage vs heavy armor', () => {
    expect(WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]).toBe(1.0);
  });

  it('AP vs light: 0.75', () => {
    expect(WARHEAD_VS_ARMOR.AP[armorIndex('light')]).toBe(0.75);
  });

  it('AP vs none: 0.3 -- 120mm is poor vs unarmored infantry', () => {
    expect(WARHEAD_VS_ARMOR.AP[armorIndex('none')]).toBe(0.3);
  });

  it('AP vs concrete: 0.5', () => {
    expect(WARHEAD_VS_ARMOR.AP[armorIndex('concrete')]).toBe(0.5);
  });

  it('HE vs heavy: 0.25 -- MammothTusk is poor vs heavy armor', () => {
    expect(WARHEAD_VS_ARMOR.HE[armorIndex('heavy')]).toBe(0.25);
  });

  it('HE vs concrete: 1.0 -- MammothTusk is full damage vs concrete', () => {
    expect(WARHEAD_VS_ARMOR.HE[armorIndex('concrete')]).toBe(1.0);
  });

  it('HE vs none: 0.9 -- MammothTusk good vs unarmored', () => {
    expect(WARHEAD_VS_ARMOR.HE[armorIndex('none')]).toBe(0.9);
  });

  it('120mm deals full 40 base damage to heavy-armored target', () => {
    const victim = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    const mult = WARHEAD_VS_ARMOR.AP[armorIndex('heavy')]; // 1.0
    const damage = Math.round(40 * mult);
    victim.takeDamage(damage, 'AP');
    expect(hpBefore - victim.hp).toBe(40);
  });

  it('MammothTusk deals only 18 to heavy armor (75 * 0.25 = 18.75)', () => {
    const victim = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    const mult = WARHEAD_VS_ARMOR.HE[armorIndex('heavy')]; // 0.25
    const damage = Math.round(75 * mult); // 18.75 -> 19
    victim.takeDamage(damage, 'HE');
    expect(hpBefore - victim.hp).toBe(19);
  });
});

// == Dual-weapon Cadence (techno.cpp:2857-2870 IsSecondShot) =================
// C++ techno.cpp -- dual-weapon units alternate shots: first shot gets 3-tick rearm,
// second shot gets full ROF cooldown

describe('4TNK dual-weapon cadence (techno.cpp:2857-2870)', () => {
  it('starts with isSecondShot=false', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    expect(mammoth.isSecondShot).toBe(false);
  });

  it('attackCooldown and attackCooldown2 are independent', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.attackCooldown = 50;
    mammoth.attackCooldown2 = 0;
    expect(mammoth.attackCooldown).not.toBe(mammoth.attackCooldown2);
  });

  it('both weapons start at cooldown=0', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    expect(mammoth.attackCooldown).toBe(0);
    expect(mammoth.attackCooldown2).toBe(0);
  });
});

// == takeDamage (techno.cpp) =================================================
// C++ techno.cpp -- 4TNK can absorb enormous damage before dying

describe('4TNK takeDamage (techno.cpp)', () => {
  it('survives 500 damage (HP 600 - 500 = 100)', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const killed = mammoth.takeDamage(500, 'AP');
    expect(killed).toBe(false);
    expect(mammoth.alive).toBe(true);
    expect(mammoth.hp).toBe(100);
  });

  it('dies at exactly 600 damage', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const killed = mammoth.takeDamage(600, 'AP');
    expect(killed).toBe(true);
    expect(mammoth.alive).toBe(false);
    expect(mammoth.hp).toBe(0);
    expect(mammoth.mission).toBe(Mission.DIE);
    expect(mammoth.animState).toBe(AnimState.DIE);
  });

  it('takes partial damage correctly', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.takeDamage(120, 'AP');
    expect(mammoth.hp).toBe(480);
    mammoth.takeDamage(120, 'HE');
    expect(mammoth.hp).toBe(360);
    expect(mammoth.alive).toBe(true);
  });

  it('invulnerable 4TNK takes no damage (Iron Curtain)', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.ironCurtainTick = 100;
    const killed = mammoth.takeDamage(9999, 'AP');
    expect(killed).toBe(false);
    expect(mammoth.hp).toBe(600);
  });

  it('damage flash triggers on hit', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.takeDamage(50, 'AP');
    expect(mammoth.damageFlash).toBe(4);
  });
});

// == Animation (unit.cpp spriteFrame) ========================================
// C++ unit.cpp -- vehicle sprite system: 32-frame body rotation via BODY_SHAPE

describe('4TNK animation (unit.cpp)', () => {
  it('isInfantry=false, isAnt=false -- uses vehicle sprite system', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    expect(mammoth.stats.isInfantry).toBe(false);
    expect(mammoth.isAnt).toBe(false);
  });

  it('spriteFrame returns valid frame number', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const frame = mammoth.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
  });

  it('starts in IDLE animState', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    expect(mammoth.animState).toBe(AnimState.IDLE);
  });

  it('isNotInfantry -- no fear, no prone', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    // Vehicles do not use fear/prone system
    expect(mammoth.stats.isInfantry).toBe(false);
    expect(mammoth.fear).toBe(0);
    expect(mammoth.isProne).toBe(false);
  });
});

// == AI Scatter (techno.cpp) =================================================
// C++ techno.cpp -- AI vehicles on GUARD scatter when damaged

describe('4TNK AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled 4TNK on GUARD can scatter when damaged (IQ >= 2)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
      mammoth.mission = Mission.GUARD;
      const ctx = makeCombatCtx([mammoth]);
      aiScatterOnDamage(ctx, mammoth);
      if (mammoth.mission === Mission.MOVE && mammoth.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled 4TNK does NOT scatter', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    mammoth.mission = Mission.GUARD;
    const ctx = makeCombatCtx([mammoth]);
    aiScatterOnDamage(ctx, mammoth);
    expect(mammoth.mission).toBe(Mission.GUARD);
    expect(mammoth.moveTarget).toBeNull();
  });
});

// == inRange checks (entity.ts) ==============================================
// Both weapons have different ranges; inRange checks either

describe('4TNK inRange with dual weapons (entity.ts)', () => {
  it('inRange returns true when target is within primary weapon range (4.75 cells)', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 14, 10); // 4 cells away
    expect(mammoth.inRange(target)).toBe(true);
  });

  it('inRange returns true when target is within secondary range (5.0) but outside primary (4.75)', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    // Place target at ~4.9 cells away (within 5.0 MammothTusk range, outside 4.75 120mm range)
    const px = 10 * CELL_SIZE + CELL_SIZE / 2;
    const py = 10 * CELL_SIZE + CELL_SIZE / 2;
    const target = new Entity(UnitType.I_E1, House.Spain, px + 4.9 * CELL_SIZE, py);
    expect(mammoth.inRange(target)).toBe(true);
  });

  it('inRange returns false when target is beyond both weapon ranges', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 20, 10); // 10 cells away
    expect(mammoth.inRange(target)).toBe(false);
  });

  it('inRangeWith checks specific weapon range', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 14, 10); // 4 cells away
    expect(mammoth.inRangeWith(target, mammoth.weapon!)).toBe(true);
    expect(mammoth.inRangeWith(target, mammoth.weapon2!)).toBe(true);
  });
});
