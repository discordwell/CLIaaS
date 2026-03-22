/**
 * C++ Behavioral Parity: TTNK — Tesla Tank
 *
 * Tests verify Tesla Tank behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * These tests describe WHAT happens with TTNK (observable outcomes: HP, alive/dead,
 * mission, position changes, crush behavior, damage, warhead effectiveness),
 * not HOW the code implements it.
 * The same scenarios should produce identical results in C++ and TypeScript.
 *
 * Key Tesla Tank traits:
 * - Glass cannon: only 110 HP with light armor, but 100 damage Super warhead
 * - Long range: 7.0 cells (most tanks are 4-5)
 * - Super warhead: 1.0 multiplier vs ALL armor types — universal damage
 * - No turret: body-aim only (in hasTurret exclusion list)
 * - Soviet faction, Counterstrike/Aftermath expansion unit
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
  aiScatterOnDamage,
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

// -- Stats Verification (udata.cpp / rules.ini) ------------------------------
// C++ udata.cpp (unit type data) — TTNK entry and RULES.INI [TTNK] section

describe('TTNK stats verification (udata.cpp / rules.ini)', () => {
  const stats = UNIT_STATS.TTNK;
  const weapon = WEAPON_STATS.TTankZap;
  const prodItem = PRODUCTION_ITEMS.find(p => p.type === 'TTNK');

  it('HP is 110 (Strength=110)', () => {
    expect(stats.strength).toBe(110);
  });

  it('Armor is light (Armor=light)', () => {
    expect(stats.armor).toBe('light');
  });

  it('Speed is 8 (Speed=8)', () => {
    expect(stats.speed).toBe(8);
  });

  it('isInfantry is false', () => {
    expect(stats.isInfantry).toBe(false);
  });

  it('crusher is true (tracked vehicle)', () => {
    expect(stats.crusher).toBe(true);
  });

  it('ROT is 5 (rotation rate)', () => {
    expect(stats.rot).toBe(5);
  });

  it('sight is 7', () => {
    expect(stats.sight).toBe(7);
  });

  it('primary weapon is TTankZap', () => {
    expect(stats.primaryWeapon).toBe('TTankZap');
  });

  it('cost is 1500 credits', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.cost).toBe(1500);
  });

  it('faction is soviet', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.faction).toBe('soviet');
  });

  it('prerequisite requires Tesla Coil (techPrereq=TSLA)', () => {
    expect(prodItem).toBeDefined();
    expect(prodItem!.techPrereq).toBe('TSLA');
  });

  it('Entity constructor initializes HP to strength', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    expect(ttnk.hp).toBe(110);
    expect(ttnk.maxHp).toBe(110);
  });
});

// -- Weapon Stats: TTankZap (weapon.cpp) -------------------------------------
// C++ weapon.cpp — TTankZap weapon entry from RULES.INI

describe('TTNK weapon — TTankZap (weapon.cpp)', () => {
  const weapon = WEAPON_STATS.TTankZap;

  it('damage is 100', () => {
    expect(weapon.damage).toBe(100);
  });

  it('warhead is Super', () => {
    expect(weapon.warhead).toBe('Super');
  });

  it('range is 7.0 cells', () => {
    expect(weapon.range).toBe(7.0);
  });

  it('ROF is 120 (slow fire rate)', () => {
    expect(weapon.rof).toBe(120);
  });

  it('splash is 1.0', () => {
    expect(weapon.splash).toBe(1.0);
  });

  it('Entity resolves weapon correctly from stats', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    expect(ttnk.weapon).not.toBeNull();
    expect(ttnk.weapon!.name).toBe('TTankZap');
    expect(ttnk.weapon!.damage).toBe(100);
  });

  it('no secondary weapon', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    expect(ttnk.weapon2).toBeNull();
  });
});

// -- Super Warhead Effectiveness (combat.cpp warhead tables) -----------------
// C++ combat.cpp — Super warhead deals 1.0 multiplier vs ALL armor types

describe('TTNK Super warhead effectiveness (combat.cpp warhead tables)', () => {
  it('Super vs none armor: mult 1.0 (full damage to infantry)', () => {
    const mult = WARHEAD_VS_ARMOR.Super[armorIndex('none')];
    expect(mult).toBe(1.0);
  });

  it('Super vs wood armor: mult 1.0', () => {
    const mult = WARHEAD_VS_ARMOR.Super[armorIndex('wood')];
    expect(mult).toBe(1.0);
  });

  it('Super vs light armor: mult 1.0', () => {
    const mult = WARHEAD_VS_ARMOR.Super[armorIndex('light')];
    expect(mult).toBe(1.0);
  });

  it('Super vs heavy armor: mult 1.0 (equally good vs heavy tanks)', () => {
    const mult = WARHEAD_VS_ARMOR.Super[armorIndex('heavy')];
    expect(mult).toBe(1.0);
  });

  it('Super vs concrete: mult 1.0 (equally good vs buildings)', () => {
    const mult = WARHEAD_VS_ARMOR.Super[armorIndex('concrete')];
    expect(mult).toBe(1.0);
  });

  it('all five armor multipliers are exactly 1.0 (universal damage)', () => {
    const verses = WARHEAD_VS_ARMOR.Super;
    for (let i = 0; i < verses.length; i++) {
      expect(verses[i]).toBe(1.0);
    }
  });

  it('TTNK deals full 100 damage to heavy-armor target (unlike AP/SA warheads)', () => {
    const victim = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    // Super vs heavy = 1.0, so 100 * 1.0 = 100
    const damage = Math.round(100 * WARHEAD_VS_ARMOR.Super[armorIndex('heavy')]);
    victim.takeDamage(damage, 'Super');
    expect(hpBefore - victim.hp).toBe(100);
  });

  it('TTNK deals full 100 damage to unarmored infantry (unlike AP warhead)', () => {
    const victim = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    const hpBefore = victim.hp;
    // Super vs none = 1.0, so 100 * 1.0 = 100
    const damage = Math.round(100 * WARHEAD_VS_ARMOR.Super[armorIndex('none')]);
    victim.takeDamage(damage, 'Super');
    // E1 has 50 HP, takes 100 damage = dead
    expect(victim.alive).toBe(false);
  });

  it('TTNK deals full 100 damage to light-armor target', () => {
    const victim = entityAtCell(UnitType.V_TTNK, House.Spain, 11, 10);
    const hpBefore = victim.hp; // 110
    const damage = Math.round(100 * WARHEAD_VS_ARMOR.Super[armorIndex('light')]);
    victim.takeDamage(damage, 'Super');
    expect(hpBefore - victim.hp).toBe(100);
    expect(victim.hp).toBe(10);
    expect(victim.alive).toBe(true);
  });
});

// -- Glass Cannon Profile (udata.cpp comparison) -----------------------------
// C++ udata.cpp — TTNK has 110 HP light armor but devastating 100-damage Super weapon

describe('TTNK glass cannon profile (udata.cpp)', () => {
  const ttnkStats = UNIT_STATS.TTNK;
  const tankStats = UNIT_STATS['2TNK'];
  const ttnkWeapon = WEAPON_STATS.TTankZap;
  const tankWeapon = WEAPON_STATS['90mm'];

  it('TTNK has much less HP than 2TNK: 110 vs 400', () => {
    expect(ttnkStats.strength).toBe(110);
    expect(tankStats.strength).toBe(400);
    expect(ttnkStats.strength).toBeLessThan(tankStats.strength);
  });

  it('TTNK has weaker armor (light vs heavy)', () => {
    expect(ttnkStats.armor).toBe('light');
    expect(tankStats.armor).toBe('heavy');
  });

  it('TTNK deals far more damage per shot: 100 vs 30', () => {
    expect(ttnkWeapon.damage).toBe(100);
    expect(tankWeapon.damage).toBe(30);
    expect(ttnkWeapon.damage).toBeGreaterThan(tankWeapon.damage);
  });

  it('TTNK has longer range: 7.0 vs 4.75', () => {
    expect(ttnkWeapon.range).toBe(7.0);
    expect(tankWeapon.range).toBe(4.75);
    expect(ttnkWeapon.range).toBeGreaterThan(tankWeapon.range);
  });

  it('TTNK costs almost double: 1500 vs 800', () => {
    const ttnkProd = PRODUCTION_ITEMS.find(p => p.type === 'TTNK');
    const tankProd = PRODUCTION_ITEMS.find(p => p.type === '2TNK');
    expect(ttnkProd!.cost).toBe(1500);
    expect(tankProd!.cost).toBe(800);
    expect(ttnkProd!.cost).toBeGreaterThan(tankProd!.cost);
  });

  it('TTNK fires slower: ROF 120 vs 50', () => {
    expect(ttnkWeapon.rof).toBe(120);
    expect(tankWeapon.rof).toBe(50);
    expect(ttnkWeapon.rof).toBeGreaterThan(tankWeapon.rof);
  });

  it('Super warhead negates armor advantage that AP warhead gives tanks', () => {
    // AP vs heavy = 1.0, but AP vs light = 0.75 — 2TNK shooting TTNK gets penalized
    const apVsLight = WARHEAD_VS_ARMOR.AP[armorIndex('light')];
    // Super vs heavy = 1.0 — TTNK shooting 2TNK gets full damage
    const superVsHeavy = WARHEAD_VS_ARMOR.Super[armorIndex('heavy')];
    expect(superVsHeavy).toBe(1.0);
    expect(apVsLight).toBeLessThan(1.0);
  });
});

// -- No Turret (unit.cpp — hasTurret exclusion list) -------------------------
// C++ udata.cpp — TTNK has Turret=no; body rotates to aim

describe('TTNK no turret (unit.cpp)', () => {
  it('hasTurret is false (in exclusion list)', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    expect(ttnk.hasTurret).toBe(false);
  });

  it('must rotate body to aim (no independent turret facing)', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.facing = Dir.N;
    ttnk.bodyFacing32 = Dir.N * 4;
    // Since no turret, the TTNK must rotate entire body to face target
    // This is different from turreted tanks like 2TNK
    expect(ttnk.hasTurret).toBe(false);
    const tank2 = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    expect(tank2.hasTurret).toBe(true);
  });

  it('other non-turreted expansion vehicles also lack turrets', () => {
    // CTNK, QTNK, DTRK are in the exclusion list with TTNK
    // Note: STNK has IsTurretEquipped=true in C++ (udata.cpp:762)
    const stnk = entityAtCell(UnitType.V_STNK, House.USSR, 10, 10);
    const ctnk = entityAtCell(UnitType.V_CTNK, House.Spain, 10, 10);
    const qtnk = entityAtCell(UnitType.V_QTNK, House.USSR, 10, 10);
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    expect(stnk.hasTurret).toBe(true);
    expect(ctnk.hasTurret).toBe(false);
    expect(qtnk.hasTurret).toBe(false);
    expect(dtrk.hasTurret).toBe(false);
  });
});

// -- Crusher Behavior (drive.cpp:Ok_To_Move) ---------------------------------
// C++ drive.cpp — TTNK is a crusher vehicle, can crush enemy infantry

describe('TTNK crusher (drive.cpp:Ok_To_Move)', () => {
  it('crushes enemy infantry on same cell', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([ttnk, infantry]);
    checkVehicleCrush(ctx, ttnk);
    expect(infantry.alive).toBe(false);
  });

  it('does NOT crush allied infantry (IsAFriend check)', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([ttnk, ally]);
    checkVehicleCrush(ctx, ttnk);
    expect(ally.alive).toBe(true);
    expect(ally.hp).toBe(ally.maxHp);
  });

  it('does NOT crush enemy vehicles (vehicles are not crushable)', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    const enemyTank = entityAtCell(UnitType.V_1TNK, House.Spain, 10, 10);
    const ctx = makeCombatCtx([ttnk, enemyTank]);
    checkVehicleCrush(ctx, ttnk);
    expect(enemyTank.alive).toBe(true);
    expect(enemyTank.hp).toBe(enemyTank.maxHp);
  });

  it('crush credits the kill to the crusher', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([ttnk, infantry]);
    const killsBefore = ttnk.kills;
    checkVehicleCrush(ctx, ttnk);
    expect(ttnk.kills).toBe(killsBefore + 1);
  });

  it('crushing produces blood effect', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    const ctx = makeCombatCtx([ttnk, infantry]);
    checkVehicleCrush(ctx, ttnk);
    const bloodEffects = ctx.effects.filter(e => e.type === 'blood');
    expect(bloodEffects.length).toBeGreaterThanOrEqual(1);
  });
});

// -- Damage Speed Reduction (drive.cpp:1157-1161) ----------------------------
// C++ drive.cpp — vehicles at <= 50% HP move at 75% speed

describe('TTNK damage speed reduction (drive.cpp:1157-1161)', () => {
  it('full HP: speed factor is 1.0', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    expect(damageSpeedFactor(ttnk)).toBe(1.0);
  });

  it('at exactly 50% HP (55): speed factor is 0.75 (CONDITION_YELLOW threshold)', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.hp = Math.floor(ttnk.maxHp * CONDITION_YELLOW); // 55
    expect(damageSpeedFactor(ttnk)).toBe(0.75);
  });

  it('at 25% HP: speed factor is 0.75', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.hp = Math.floor(ttnk.maxHp * 0.25); // ~27
    expect(damageSpeedFactor(ttnk)).toBe(0.75);
  });

  it('above 50% HP: speed factor is 1.0', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.hp = 60; // ~55% of 110
    expect(ttnk.hp / ttnk.maxHp).toBeGreaterThan(CONDITION_YELLOW);
    expect(damageSpeedFactor(ttnk)).toBe(1.0);
  });

  it('at 1 HP: speed factor is 0.75', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.hp = 1;
    expect(damageSpeedFactor(ttnk)).toBe(0.75);
  });
});

// -- Stop-Rotate-Move (drive.cpp) -------------------------------------------
// C++ drive.cpp — vehicles stop, rotate to face destination, THEN move.

describe('TTNK stop-rotate-move (drive.cpp)', () => {
  it('facing N, target E: does NOT move until rotation completes', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.facing = Dir.N;
    ttnk.desiredFacing = Dir.N;
    ttnk.bodyFacing32 = Dir.N * 4;

    const startX = ttnk.pos.x;
    const startY = ttnk.pos.y;
    const targetPos = { x: startX + CELL_SIZE * 3, y: startY }; // due East

    // One moveToward tick — vehicle should stop to rotate
    const arrived = ttnk.moveToward(targetPos, ttnk.stats.speed);

    expect(arrived).toBe(false);
    // Position unchanged because vehicle stops to rotate
    expect(ttnk.pos.x).toBe(startX);
    expect(ttnk.pos.y).toBe(startY);
  });

  it('facing E, target E: moves immediately (already aligned)', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.facing = Dir.E;
    ttnk.desiredFacing = Dir.E;
    ttnk.bodyFacing32 = Dir.E * 4;

    const startX = ttnk.pos.x;
    const targetPos = { x: startX + CELL_SIZE * 3, y: ttnk.pos.y };

    ttnk.moveToward(targetPos, ttnk.stats.speed);

    // Should have moved east
    expect(ttnk.pos.x).toBeGreaterThan(startX);
  });

  it('vehicle rotation is gradual (rot=5, not instant like infantry rot=8)', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    expect(ttnk.stats.rot).toBe(5);
    // rot < 8 means gradual 32-step rotation
    expect(ttnk.stats.rot).toBeLessThan(8);

    ttnk.facing = Dir.N;
    ttnk.desiredFacing = Dir.S; // opposite direction
    ttnk.bodyFacing32 = Dir.N * 4;
    const aligned = ttnk.tickRotation();
    // Should NOT snap instantly (rot=5 < 8)
    expect(aligned).toBe(false);
  });

  it('multiple ticks eventually complete rotation', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.facing = Dir.N;
    ttnk.desiredFacing = Dir.E;
    ttnk.bodyFacing32 = Dir.N * 4;
    ttnk.rotAccumulator = 0;

    // Rotate until aligned (max 50 ticks to prevent infinite loop)
    let aligned = false;
    for (let i = 0; i < 50; i++) {
      ttnk.rotTickedThisFrame = false;
      aligned = ttnk.tickRotation();
      if (aligned) break;
    }
    expect(aligned).toBe(true);
    expect(ttnk.facing).toBe(Dir.E);
  });
});

// -- Retaliation (techno.cpp) ------------------------------------------------
// C++ techno.cpp — idle/moving units counter-attack when hit by enemy

describe('TTNK retaliation (techno.cpp)', () => {
  it('idle TTNK on GUARD mission retaliates when hit by enemy', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    ttnk.mission = Mission.GUARD;
    ttnk.target = null;

    const ctx = makeCombatCtx([ttnk, attacker]);
    triggerRetaliation(ctx, ttnk, attacker);

    expect(ttnk.target).toBe(attacker);
    expect(ttnk.mission).toBe(Mission.ATTACK);
  });

  it('TTNK CAN retaliate (has weapon)', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    expect(ttnk.weapon).not.toBeNull();
    expect(ttnk.weapon!.name).toBe('TTankZap');
  });

  it('does not retarget if already has a living target', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    const existingTarget = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    const newAttacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    ttnk.mission = Mission.ATTACK;
    ttnk.target = existingTarget;

    const ctx = makeCombatCtx([ttnk, existingTarget, newAttacker]);
    triggerRetaliation(ctx, ttnk, newAttacker);

    // Should keep existing target, not switch
    expect(ttnk.target).toBe(existingTarget);
  });

  it('does not retaliate against allies', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    const ally = entityAtCell(UnitType.I_E1, House.Ukraine, 11, 10);
    ttnk.mission = Mission.GUARD;
    ttnk.target = null;

    const ctx = makeCombatCtx([ttnk, ally]);
    triggerRetaliation(ctx, ttnk, ally);

    expect(ttnk.target).toBeNull();
    expect(ttnk.mission).toBe(Mission.GUARD);
  });

  it('retaliates when current target is dead', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    const deadTarget = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    deadTarget.alive = false;
    const newAttacker = entityAtCell(UnitType.I_E1, House.Spain, 11, 10);
    ttnk.mission = Mission.ATTACK;
    ttnk.target = deadTarget;

    const ctx = makeCombatCtx([ttnk, deadTarget, newAttacker]);
    triggerRetaliation(ctx, ttnk, newAttacker);

    // Should switch to new attacker since old target is dead
    expect(ttnk.target).toBe(newAttacker);
    expect(ttnk.mission).toBe(Mission.ATTACK);
  });
});

// -- Death / Destruction (techno.cpp) ----------------------------------------
// C++ techno.cpp — unit death when HP reaches 0

describe('TTNK death (techno.cpp)', () => {
  it('dies when HP reaches 0', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    const killed = ttnk.takeDamage(110, 'AP');
    expect(killed).toBe(true);
    expect(ttnk.alive).toBe(false);
    expect(ttnk.hp).toBe(0);
  });

  it('mission becomes DIE on death', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.takeDamage(110, 'AP');
    expect(ttnk.mission).toBe(Mission.DIE);
  });

  it('animState becomes DIE on death', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.takeDamage(110, 'AP');
    expect(ttnk.animState).toBe(AnimState.DIE);
  });

  it('survives with 1 HP after taking 109 damage', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    const killed = ttnk.takeDamage(109, 'AP');
    expect(killed).toBe(false);
    expect(ttnk.alive).toBe(true);
    expect(ttnk.hp).toBe(1);
  });

  it('overkill damage clamps HP to 0', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.takeDamage(999, 'AP');
    expect(ttnk.hp).toBe(0);
    expect(ttnk.alive).toBe(false);
  });

  it('invulnerable TTNK takes no damage', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.ironCurtainTick = 100; // invulnerable
    const killed = ttnk.takeDamage(110, 'AP');
    expect(killed).toBe(false);
    expect(ttnk.hp).toBe(110);
    expect(ttnk.alive).toBe(true);
  });

  it('TTNK dies to a single hit from another TTNK (110 HP < 100 + second shot)', () => {
    // Tesla Tank vs Tesla Tank: 100 damage leaves 10 HP, second shot kills
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.takeDamage(100, 'Super'); // first TTankZap hit
    expect(ttnk.alive).toBe(true);
    expect(ttnk.hp).toBe(10);
    ttnk.takeDamage(100, 'Super'); // second TTankZap hit
    expect(ttnk.alive).toBe(false);
  });
});

// -- Vehicle Animation (unit.cpp) --------------------------------------------
// C++ unit.cpp — vehicles use 32-frame body rotation via BODY_SHAPE

describe('TTNK vehicle animation (unit.cpp)', () => {
  it('isInfantry is false', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    expect(ttnk.stats.isInfantry).toBe(false);
  });

  it('isAnt is false', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    expect(ttnk.isAnt).toBe(false);
  });

  it('spriteFrame uses vehicle BODY_SHAPE system (valid frame number)', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    const frame = ttnk.spriteFrame;
    expect(typeof frame).toBe('number');
    expect(frame).toBeGreaterThanOrEqual(0);
    expect(frame).toBeLessThan(32); // body frames are 0-31
  });

  it('starts in IDLE animState', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    expect(ttnk.animState).toBe(AnimState.IDLE);
  });

  it('isAirUnit is false', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    expect(ttnk.isAirUnit).toBe(false);
  });

  it('isNavalUnit is false', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    expect(ttnk.isNavalUnit).toBe(false);
  });
});

// -- Range Check (entity.ts:inRange) -----------------------------------------
// C++ techno.cpp — Can_Fire range check; TTNK has long 7.0 cell range

describe('TTNK range check (techno.cpp)', () => {
  it('target within 7.0 cells is in range', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 16, 10); // ~6 cells away
    expect(ttnk.inRange(target)).toBe(true);
  });

  it('target beyond 7.0 cells is out of range', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    // Place target > 7.0 cells away
    const target = new Entity(UnitType.V_2TNK, House.Spain,
      ttnk.pos.x + CELL_SIZE * 8.0, ttnk.pos.y);
    expect(ttnk.inRange(target)).toBe(false);
  });

  it('TTNK outranges 2TNK (7.0 vs 4.75)', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    const tank2 = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    // Target at 6.0 cells: in range for TTNK (7.0) but out of range for 2TNK (4.75)
    const target = new Entity(UnitType.V_1TNK, House.Spain,
      ttnk.pos.x + CELL_SIZE * 6.0, ttnk.pos.y);
    expect(ttnk.inRange(target)).toBe(true);   // 6.0 < 7.0
    expect(tank2.inRange(target)).toBe(false);  // 6.0 > 4.75
  });

  it('TTNK outranges most other tanks (4TNK range 5.5)', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    const mammoth = entityAtCell(UnitType.V_4TNK, House.Spain, 10, 10);
    // Target at 6.5 cells
    const target = new Entity(UnitType.V_1TNK, House.Spain,
      ttnk.pos.x + CELL_SIZE * 6.5, ttnk.pos.y);
    expect(ttnk.inRange(target)).toBe(true);      // 6.5 < 7.0
    expect(mammoth.inRange(target)).toBe(false);   // 6.5 > MammothTusk range 5.0
  });
});

// -- AI Scatter on Damage (techno.cpp) ----------------------------------------
// C++ techno.cpp — AI-controlled TTNK on GUARD moves to adjacent cell when damaged

describe('TTNK AI scatter on damage (techno.cpp)', () => {
  it('AI-controlled TTNK on GUARD scatters when damaged (IQ >= 2)', () => {
    // Run scatter multiple times — it's probabilistic (random dx/dy can be 0,0 = no move)
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
      ttnk.mission = Mission.GUARD;
      const ctx = makeCombatCtx([ttnk]);
      aiScatterOnDamage(ctx, ttnk);
      if (ttnk.mission === Mission.MOVE && ttnk.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  it('player-controlled TTNK does NOT scatter', () => {
    // Spain is player-controlled
    const ttnk = entityAtCell(UnitType.V_TTNK, House.Spain, 10, 10);
    ttnk.mission = Mission.GUARD;

    const ctx = makeCombatCtx([ttnk]);
    aiScatterOnDamage(ctx, ttnk);

    // Should remain on GUARD, no scatter
    expect(ttnk.mission).toBe(Mission.GUARD);
    expect(ttnk.moveTarget).toBeNull();
  });

  it('AI TTNK on ATTACK mission does NOT scatter (only GUARD/AREA_GUARD scatter)', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.mission = Mission.ATTACK;

    const ctx = makeCombatCtx([ttnk]);
    aiScatterOnDamage(ctx, ttnk);

    expect(ttnk.mission).toBe(Mission.ATTACK);
  });
});

// -- Crate Bias Effects (entity.ts) ------------------------------------------
// C++ techno.cpp — crate pickups modify unit stats via bias multipliers

describe('TTNK crate bias effects', () => {
  it('default speedBias is 1.0', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    expect(ttnk.speedBias).toBe(1.0);
  });

  it('default armorBias is 1.0', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    expect(ttnk.armorBias).toBe(1.0);
  });

  it('default firepowerBias is 1.0', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    expect(ttnk.firepowerBias).toBe(1.0);
  });

  it('armorBias > 1.0 reduces damage taken (critical for glass cannon survival)', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.armorBias = 2.0; // CR2: half damage
    const hpBefore = ttnk.hp;
    ttnk.takeDamage(100, 'Super');
    const damageTaken = hpBefore - ttnk.hp;
    // 100 / 2.0 = 50
    expect(damageTaken).toBe(50);
  });

  it('armorBias 2.0 lets TTNK survive a TTankZap hit that would nearly kill it', () => {
    const ttnk = entityAtCell(UnitType.V_TTNK, House.USSR, 10, 10);
    ttnk.armorBias = 2.0;
    ttnk.takeDamage(100, 'Super'); // 100/2 = 50 damage
    expect(ttnk.alive).toBe(true);
    expect(ttnk.hp).toBe(60); // 110 - 50 = 60
  });
});
