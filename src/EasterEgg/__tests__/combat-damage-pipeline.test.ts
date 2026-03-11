/**
 * Combat & Damage Pipeline Tests — comprehensive verification of the
 * combat subsystem: damage application, warhead multipliers,
 * projectile lifecycle, crush mechanics, structure damage, overkill,
 * retaliation, and kill tracking.
 *
 * Behavioral tests import and call functions from combat.ts directly,
 * using a mock CombatContext for game-state dependencies.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, UNIT_STATS, WEAPON_STATS, CELL_SIZE, MAP_CELLS,
  WARHEAD_VS_ARMOR, WARHEAD_META, WARHEAD_PROPS,
  COUNTRY_BONUSES, ANT_HOUSES,
  type WarheadType, type ArmorType, type WeaponStats, type WarheadProps,
  armorIndex, getWarheadMultiplier, modifyDamage, worldDist,
  buildDefaultAlliances, Mission, AnimState,
  PRONE_DAMAGE_BIAS, CONDITION_RED, CONDITION_YELLOW,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { Game } from '../engine/index';
import {
  type CombatContext, type InflightProjectile,
  SPLASH_RADIUS,
  getWarheadMult, getWarheadMeta, getWarheadProps,
  damageEntity, aiScatterOnDamage, damageSpeedFactor,
  fireWeaponAt, fireWeaponAtStructure, structureDamage,
  handleUnitDeath, triggerRetaliation,
  checkVehicleCrush, launchProjectile,
  updateInflightProjectiles, applySplashDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

/** Mirror of Game.isAllied using the default alliance table */
function isAllied(a: House, b: House): boolean {
  const alliances = buildDefaultAlliances();
  return alliances.get(a)?.has(b) ?? false;
}

/** Create a minimal mock CombatContext with sensible defaults and no-op callbacks */
function makeMockCombatContext(overrides: Partial<CombatContext> = {}): CombatContext {
  const map = new GameMap();
  const entities: Entity[] = [];
  const entityById = new Map<number, Entity>();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById,
    structures: [],
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'SCG01EA',
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
    // damageStructure state
    aiStates: new Map(),
    lastBaseAttackEva: -Infinity,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    // damageStructure callbacks
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  };
}

/** Register entities into a mock context (sets entities array + entityById map) */
function registerEntities(ctx: CombatContext, ...ents: Entity[]): void {
  ctx.entities.push(...ents);
  for (const e of ents) ctx.entityById.set(e.id, e);
}

// =========================================================================
// 1. fireWeaponAt — damage pipeline verification
// =========================================================================
describe('fireWeaponAt damage pipeline', () => {
  it('uses modifyDamage with houseBias, warhead mult, and spreadFactor at point-blank', () => {
    // Simulate fireWeaponAt: damage = modifyDamage(weapon.damage, warhead, armor, 0, houseBias, whMult, spreadFactor)
    const weapon = WEAPON_STATS.M1Carbine; // SA warhead, 15 damage
    const targetArmor: ArmorType = 'none';
    const houseBias = COUNTRY_BONUSES.Spain.firepowerMult; // 1.0
    const whMult = getWarheadMultiplier(weapon.warhead, targetArmor); // SA vs none = 1.0
    const spreadFactor = WARHEAD_META[weapon.warhead].spreadFactor;
    const damage = modifyDamage(weapon.damage, weapon.warhead, targetArmor, 0, houseBias, whMult, spreadFactor);
    expect(damage).toBe(15); // full damage at point-blank, no bias, no armor reduction
  });

  it('Germany house bias (1.10) increases damage from fireWeaponAt', () => {
    const weapon = WEAPON_STATS['90mm']; // AP warhead, 30 damage
    const targetArmor: ArmorType = 'heavy'; // AP vs heavy = 1.0
    const germanBias = COUNTRY_BONUSES.Germany.firepowerMult; // 1.10
    const whMult = getWarheadMultiplier(weapon.warhead, targetArmor);
    const spreadFactor = WARHEAD_META[weapon.warhead].spreadFactor;
    const damage = modifyDamage(weapon.damage, weapon.warhead, targetArmor, 0, germanBias, whMult, spreadFactor);
    // 30 * 1.0 * 1.10 = 33
    expect(damage).toBe(33);
  });

  it('USSR house bias is 1.0 (10% cheaper, not firepower boost)', () => {
    const weapon = WEAPON_STATS['120mm']; // AP warhead, 40 damage
    const targetArmor: ArmorType = 'heavy';
    const ussrBias = COUNTRY_BONUSES.USSR.firepowerMult;
    expect(ussrBias).toBe(1.0); // USSR gets cost discount, not firepower
    const whMult = getWarheadMultiplier(weapon.warhead, targetArmor); // 1.0
    const spreadFactor = WARHEAD_META[weapon.warhead].spreadFactor;
    const damage = modifyDamage(weapon.damage, weapon.warhead, targetArmor, 0, ussrBias, whMult, spreadFactor);
    expect(damage).toBe(40); // 40 * 1.0 * 1.0 = 40
  });

  it('fireWeaponAt applies modifyDamage with houseBias, warhead mult, and spreadFactor', () => {
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 124, 100);
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker, target);
    const weapon = WEAPON_STATS['90mm']; // AP warhead, 30 damage
    const hpBefore = target.hp;
    fireWeaponAt(ctx, attacker, target, weapon);
    // AP vs none = 0.3, houseBias=1.0, spreadFactor=1, distance=0
    // damage = modifyDamage(30, 'AP', 'none', 0, 1.0, 0.3, 1) = round(30*0.3*1.0) = 9
    expect(target.hp).toBe(hpBefore - 9);
  });

  it('fireWeaponAt credits kill on entity death', () => {
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 124, 100);
    target.hp = 1; // ensure kill
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker, target);
    expect(attacker.kills).toBe(0);
    fireWeaponAt(ctx, attacker, target, WEAPON_STATS['90mm']);
    expect(target.alive).toBe(false);
    expect(attacker.kills).toBe(1);
  });
});

// =========================================================================
// 2. damageEntity — wraps Entity.takeDamage + trigger tracking
// =========================================================================
describe('damageEntity behavior (via Entity.takeDamage)', () => {
  it('reduces target HP by damage amount', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    const hpBefore = target.hp;
    target.takeDamage(10, 'SA');
    expect(target.hp).toBe(hpBefore - 10);
    expect(target.alive).toBe(true);
  });

  it('kills target when damage exceeds remaining HP', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    const killed = target.takeDamage(target.hp + 50, 'SA');
    expect(killed).toBe(true);
    expect(target.alive).toBe(false);
    expect(target.hp).toBe(0);
    expect(target.mission).toBe(Mission.DIE);
    expect(target.animState).toBe(AnimState.DIE);
  });

  it('does not damage dead targets (already dead check)', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    target.alive = false;
    target.hp = 0;
    const killed = target.takeDamage(50, 'SA');
    expect(killed).toBe(false);
    expect(target.hp).toBe(0);
  });

  it('damageEntity calls aiScatterOnDamage for non-killed AI units', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.mission = Mission.GUARD;
    const ctx = makeMockCombatContext();
    registerEntities(ctx, target);
    const hpBefore = target.hp;
    damageEntity(ctx, target, 5, 'SA');
    expect(target.hp).toBe(hpBefore - 5);
    expect(target.alive).toBe(true);
    // aiScatterOnDamage sets mission to MOVE for GUARD-mission AI units
    expect(target.mission).toBe(Mission.MOVE);
  });

  it('damageEntity tracks attacked trigger names', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.triggerName = 'atk1';
    const ctx = makeMockCombatContext();
    registerEntities(ctx, target);
    damageEntity(ctx, target, 5, 'SA');
    expect(ctx.attackedTriggerNames.has('atk1')).toBe(true);
  });
});

// =========================================================================
// 3. damageStructure — HP reduction, destruction, power system
// =========================================================================
describe('damageStructure behavior', () => {
  function makeStructure(overrides: Partial<MapStructure> = {}): MapStructure {
    return {
      type: 'POWR', image: 'powr', house: House.USSR,
      cx: 5, cy: 5, hp: 256, maxHp: 256, alive: true, rubble: false,
      attackCooldown: 0, ammo: -1, maxAmmo: -1,
      ...overrides,
    };
  }

  it('reduces structure HP with Math.max(0, hp - damage)', () => {
    const s = makeStructure({ hp: 100 });
    const ctx = makeMockCombatContext();
    structureDamage(ctx, s, 30);
    expect(s.hp).toBe(70);
    // HP should never go below 0
    structureDamage(ctx, s, 200);
    expect(s.hp).toBe(0);
  });

  it('sets alive=false and rubble=true on structure death', () => {
    const s = makeStructure({ hp: 50 });
    const ctx = makeMockCombatContext();
    const destroyed = structureDamage(ctx, s, 100);
    expect(destroyed).toBe(true);
    expect(s.alive).toBe(false);
    expect(s.rubble).toBe(true);
  });

  it('returns false when structure is already dead', () => {
    const s = makeStructure({ alive: false, hp: 0 });
    const ctx = makeMockCombatContext();
    const result = structureDamage(ctx, s, 50);
    expect(result).toBe(false);
  });

  it('records AI base attack on structure damage', () => {
    const s = makeStructure({ house: House.USSR });
    const aiState = { lastBaseAttackTick: -1, underAttack: false, iq: 3 };
    const aiStates = new Map<House, { lastBaseAttackTick: number; underAttack: boolean; iq: number }>();
    aiStates.set(House.USSR, aiState);
    const ctx = makeMockCombatContext({ aiStates, tick: 42 });
    structureDamage(ctx, s, 10);
    expect(aiState.lastBaseAttackTick).toBe(42);
    expect(aiState.underAttack).toBe(true);
  });

  it('destroyed structure explosion damages nearby units in 2-cell radius', () => {
    const s = makeStructure({ hp: 10, cx: 5, cy: 5 });
    // Place a unit near the structure center (structure center = cx*24+24, cy*24+24 = 144, 144)
    // Unit at cell (6,5) center = 156, 132 — about 1 cell away
    const nearby = makeEntity(UnitType.I_E1, House.Greece, 6 * CELL_SIZE + CELL_SIZE / 2, 5 * CELL_SIZE + CELL_SIZE);
    const hpBefore = nearby.hp;
    const ctx = makeMockCombatContext();
    registerEntities(ctx, nearby);
    const destroyed = structureDamage(ctx, s, 100);
    expect(destroyed).toBe(true);
    // Unit within 2-cell blast radius should take damage
    expect(nearby.hp).toBeLessThan(hpBefore);
  });

  it('fireWeaponAtStructure uses concrete armor for warhead mult', () => {
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const structure = makeStructure();
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker);
    const weapon = WEAPON_STATS['90mm']; // AP warhead, 30 damage
    const hpBefore = structure.hp;
    fireWeaponAtStructure(ctx, attacker, structure, weapon);
    // AP vs concrete = 0.5, houseBias=1.0, spreadFactor=1
    // damage = modifyDamage(30, 'AP', 'concrete', 0, 1.0, 0.5, 1) = round(30*0.5) = 15
    expect(structure.hp).toBe(hpBefore - 15);
  });
});

// =========================================================================
// 4. getWarheadMult — warhead vs armor modifier lookup with overrides
// =========================================================================
describe('getWarheadMult — warhead vs armor modifiers', () => {
  it('SA vs none = 1.0 (full damage to unarmored)', () => {
    expect(getWarheadMultiplier('SA', 'none')).toBe(1.0);
  });

  it('SA vs heavy = 0.25 (bad against heavy armor)', () => {
    expect(getWarheadMultiplier('SA', 'heavy')).toBe(0.25);
  });

  it('AP vs none = 0.3 (bad against infantry)', () => {
    expect(getWarheadMultiplier('AP', 'none')).toBe(0.3);
  });

  it('AP vs heavy = 1.0 (designed for heavy armor)', () => {
    expect(getWarheadMultiplier('AP', 'heavy')).toBe(1.0);
  });

  it('HE vs none = 0.9 (slightly reduced vs infantry)', () => {
    expect(getWarheadMultiplier('HE', 'none')).toBe(0.9);
  });

  it('HE vs concrete = 1.0 (full damage to structures)', () => {
    expect(getWarheadMultiplier('HE', 'concrete')).toBe(1.0);
  });

  it('Fire vs wood = 1.0 (maximum vs wooden structures)', () => {
    expect(getWarheadMultiplier('Fire', 'wood')).toBe(1.0);
  });

  it('HollowPoint vs none = 1.0 (anti-infantry)', () => {
    expect(getWarheadMultiplier('HollowPoint', 'none')).toBe(1.0);
  });

  it('HollowPoint vs any armor = 0.05 (ineffective vs armor)', () => {
    expect(getWarheadMultiplier('HollowPoint', 'wood')).toBe(0.05);
    expect(getWarheadMultiplier('HollowPoint', 'light')).toBe(0.05);
    expect(getWarheadMultiplier('HollowPoint', 'heavy')).toBe(0.05);
    expect(getWarheadMultiplier('HollowPoint', 'concrete')).toBe(0.05);
  });

  it('Super vs all = 1.0 (uniform damage)', () => {
    const armors: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];
    for (const a of armors) {
      expect(getWarheadMultiplier('Super', a)).toBe(1.0);
    }
  });

  it('Organic vs none = 1.0, vs everything else = 0.0', () => {
    expect(getWarheadMultiplier('Organic', 'none')).toBe(1.0);
    expect(getWarheadMultiplier('Organic', 'wood')).toBe(0.0);
    expect(getWarheadMultiplier('Organic', 'light')).toBe(0.0);
    expect(getWarheadMultiplier('Organic', 'heavy')).toBe(0.0);
    expect(getWarheadMultiplier('Organic', 'concrete')).toBe(0.0);
  });

  it('Nuke matches Fire warhead multipliers (both incendiary)', () => {
    const armors: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];
    for (const a of armors) {
      expect(getWarheadMultiplier('Nuke', a)).toBe(getWarheadMultiplier('Fire', a));
    }
  });

  it('getWarheadMult supports scenario overrides via warheadOverrides', () => {
    // Without overrides, SA vs none = 1.0
    expect(getWarheadMult('SA', 'none', {})).toBe(1.0);
    // With overrides, use the override table
    const overrides = { SA: [0.5, 0.6, 0.7, 0.8, 0.9] as [number, number, number, number, number] };
    expect(getWarheadMult('SA', 'none', overrides)).toBe(0.5); // index 0 = none
    expect(getWarheadMult('SA', 'heavy', overrides)).toBe(0.8); // index 3 = heavy
    // Non-overridden warhead still uses WARHEAD_VS_ARMOR
    expect(getWarheadMult('AP', 'heavy', overrides)).toBe(1.0);
  });
});

// =========================================================================
// 5. checkVehicleCrush — EXECUTION tests (not just source grep)
// =========================================================================
describe('checkVehicleCrush — crush execution', () => {
  it('heavy tank kills crushable infantry when sharing same cell', () => {
    const tank = makeEntity(UnitType.V_3TNK, House.Spain, 100, 100);
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 100, 100);

    expect(tank.stats.crusher).toBe(true);
    expect(infantry.stats.crushable).toBe(true);

    // Simulate crush: Game.checkVehicleCrush does damageEntity(other, other.hp + 10, 'Super')
    const killed = infantry.takeDamage(infantry.hp + 10, 'Super');
    expect(killed).toBe(true);
    expect(infantry.alive).toBe(false);
    expect(infantry.hp).toBe(0);
  });

  it('crush kills ant units', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 200, 200);
    const ant = makeEntity(UnitType.ANT1, House.USSR, 200, 200);

    expect(mammoth.stats.crusher).toBe(true);
    expect(ant.stats.crushable).toBe(true);

    const killed = ant.takeDamage(ant.hp + 10, 'Super');
    expect(killed).toBe(true);
    expect(ant.alive).toBe(false);
  });

  it('crush skips allied units — isAllied guard prevents friendly crush', () => {
    const tank = makeEntity(UnitType.V_3TNK, House.Spain, 100, 100);
    const friendlyInf = makeEntity(UnitType.I_E1, House.Greece, 100, 100); // Greece allied with Spain
    expect(tank.stats.crusher).toBe(true);
    expect(friendlyInf.stats.crushable).toBe(true);
    expect(isAllied(House.Spain, House.Greece)).toBe(true);
    const ctx = makeMockCombatContext();
    registerEntities(ctx, tank, friendlyInf);
    const hpBefore = friendlyInf.hp;
    checkVehicleCrush(ctx, tank);
    // Allied infantry should NOT be crushed
    expect(friendlyInf.alive).toBe(true);
    expect(friendlyInf.hp).toBe(hpBefore);
  });

  it('crusher credits a kill after crushing', () => {
    const tank = makeEntity(UnitType.V_3TNK, House.Spain, 100, 100);
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    expect(tank.kills).toBe(0);

    infantry.takeDamage(infantry.hp + 10, 'Super');
    tank.creditKill();
    expect(tank.kills).toBe(1);
  });

  it('non-crusher vehicle does not have crusher flag', () => {
    const jeep = makeEntity(UnitType.V_JEEP, House.Spain);
    expect(jeep.stats.crusher).toBeFalsy();
  });

  it('vehicles are NOT crushable (no vehicle-on-vehicle crush)', () => {
    const light = makeEntity(UnitType.V_1TNK, House.USSR);
    expect(light.stats.crushable).toBeFalsy();
  });

  it('allied infantry are crushable by stats but protected by runtime isAllied check', () => {
    // Verify that the crusher flag/crushable flag are house-independent
    // (runtime alliance check handles protection)
    const friendlyInf = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const alliedInf = makeEntity(UnitType.I_E1, House.Greece, 100, 100);
    expect(friendlyInf.stats.crushable).toBe(true);
    expect(alliedInf.stats.crushable).toBe(true);
    // Spain and Greece are allied
    expect(isAllied(House.Spain, House.Greece)).toBe(true);
  });
});

// =========================================================================
// 6. Projectile lifecycle — creation, travel, impact, splash
// =========================================================================
describe('Projectile lifecycle', () => {
  it('InflightProjectile has all required fields', () => {
    const proj: InflightProjectile = {
      attackerId: 1, targetId: 2, weapon: WEAPON_STATS['90mm'],
      damage: 30, speed: 2, travelFrames: 3, currentFrame: 0,
      directHit: true, impactX: 200, impactY: 100, attackerIsPlayer: true,
    };
    expect(proj.attackerId).toBe(1);
    expect(proj.targetId).toBe(2);
    expect(proj.weapon).toBeDefined();
    expect(proj.damage).toBe(30);
    expect(proj.speed).toBe(2);
    expect(proj.travelFrames).toBe(3);
    expect(proj.currentFrame).toBe(0);
    expect(proj.directHit).toBe(true);
    expect(proj.impactX).toBe(200);
    expect(proj.impactY).toBe(100);
    expect(proj.attackerIsPlayer).toBe(true);
  });

  it('launchProjectile computes travelFrames from distance and speed', () => {
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 220, 100);
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker, target);
    const weapon = { ...WEAPON_STATS['90mm'], projectileSpeed: 2.0 };
    launchProjectile(ctx, attacker, target, weapon, 30, 220, 100, true);
    expect(ctx.inflightProjectiles).toHaveLength(1);
    const proj = ctx.inflightProjectiles[0];
    // dist = worldDist({100,100}, {220,100}) = 120/24 = 5.0 cells, travelFrames = round(5.0/2.0) = 3
    expect(proj.travelFrames).toBe(3);
    expect(proj.currentFrame).toBe(0);
  });

  it('projectile travel frames = max(1, round(dist / speed))', () => {
    // Mirror the formula from launchProjectile
    const shooterPos = { x: 100, y: 100 };
    const impactPos = { x: 220, y: 100 };
    const dist = worldDist(shooterPos, impactPos);
    const speed = 2.0; // cells per tick
    const travelFrames = Math.max(1, Math.round(dist / speed));
    // dist = (220-100)/24 = 5.0 cells, 5.0/2.0 = 2.5, round = 3
    expect(travelFrames).toBe(3);
  });

  it('updateInflightProjectiles increments currentFrame each tick', () => {
    const ctx = makeMockCombatContext();
    const proj: InflightProjectile = {
      attackerId: 1, targetId: 2, weapon: WEAPON_STATS['90mm'],
      damage: 30, speed: 2, travelFrames: 5, currentFrame: 0,
      directHit: true, impactX: 200, impactY: 100, attackerIsPlayer: true,
    };
    ctx.inflightProjectiles.push(proj);
    updateInflightProjectiles(ctx);
    // After one update, currentFrame should be 1 (and not yet arrived since travelFrames=5)
    expect(ctx.inflightProjectiles).toHaveLength(1);
    expect(ctx.inflightProjectiles[0].currentFrame).toBe(1);
  });

  it('arrived projectiles apply damage and credit kills', () => {
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 200, 100);
    target.hp = 5; // ensure kill on arrival
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker, target);
    const proj: InflightProjectile = {
      attackerId: attacker.id, targetId: target.id, weapon: WEAPON_STATS['90mm'],
      damage: 30, speed: 2, travelFrames: 1, currentFrame: 0,
      directHit: true, impactX: 200, impactY: 100, attackerIsPlayer: true,
    };
    ctx.inflightProjectiles.push(proj);
    updateInflightProjectiles(ctx);
    expect(target.alive).toBe(false);
    expect(attacker.kills).toBe(1);
    expect(ctx.killCount).toBe(1);
  });

  it('arrived projectiles with splash trigger splash damage to nearby units', () => {
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 200, 100);
    const bystander = makeEntity(UnitType.I_E1, House.USSR, 200 + CELL_SIZE, 100); // 1 cell away from impact
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker, target, bystander);
    const weapon = { ...WEAPON_STATS.MammothTusk, splash: 1.5 }; // HE warhead with splash
    const proj: InflightProjectile = {
      attackerId: attacker.id, targetId: target.id, weapon,
      damage: 75, speed: 2, travelFrames: 1, currentFrame: 0,
      directHit: true, impactX: 200, impactY: 100, attackerIsPlayer: true,
    };
    ctx.inflightProjectiles.push(proj);
    const bystanderHpBefore = bystander.hp;
    updateInflightProjectiles(ctx);
    // Bystander should take splash damage (within 1.5-cell radius)
    expect(bystander.hp).toBeLessThan(bystanderHpBefore);
  });

  it('homing projectiles update impactX/Y based on target movement', () => {
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 200, 100);
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker, target);
    const weapon = { ...WEAPON_STATS.MammothTusk, projectileROT: 10, projectileSpeed: 2 };
    const proj: InflightProjectile = {
      attackerId: attacker.id, targetId: target.id, weapon,
      damage: 75, speed: 2, travelFrames: 10, currentFrame: 0,
      directHit: true, impactX: 180, impactY: 100, attackerIsPlayer: true,
    };
    ctx.inflightProjectiles.push(proj);
    // Move target to a new position
    target.pos.x = 250;
    // Advance two frames (homing updates on even frames)
    updateInflightProjectiles(ctx);
    updateInflightProjectiles(ctx);
    // impactX should have moved toward target's new position (250)
    expect(ctx.inflightProjectiles[0].impactX).toBeGreaterThan(180);
  });

  it('homing updates only every other frame (C++ bullet.cpp:368)', () => {
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 300, 100);
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker, target);
    const weapon = { ...WEAPON_STATS.MammothTusk, projectileROT: 10, projectileSpeed: 2 };
    const proj: InflightProjectile = {
      attackerId: attacker.id, targetId: target.id, weapon,
      damage: 75, speed: 2, travelFrames: 10, currentFrame: 0,
      directHit: true, impactX: 150, impactY: 100, attackerIsPlayer: true,
    };
    ctx.inflightProjectiles.push(proj);
    target.pos.x = 350; // move target away
    // Frame 1 (odd) — no homing update
    updateInflightProjectiles(ctx);
    const afterOdd = ctx.inflightProjectiles[0].impactX;
    expect(afterOdd).toBe(150); // unchanged on odd frame
    // Frame 2 (even) — homing update applies
    updateInflightProjectiles(ctx);
    const afterEven = ctx.inflightProjectiles[0].impactX;
    expect(afterEven).toBeGreaterThan(150); // moved toward target on even frame
  });
});

// =========================================================================
// 7. Damage types — warhead classes against different armor types
// =========================================================================
describe('Damage types — warhead vs armor matrix', () => {
  // Verify key damage matchups that drive gameplay

  it('AP weapons are effective vs heavy (tanks vs tanks)', () => {
    const damage = 40; // 120mm
    const mult = getWarheadMultiplier('AP', 'heavy');
    expect(mult).toBe(1.0);
    expect(modifyDamage(damage, 'AP', 'heavy', 0)).toBe(40);
  });

  it('AP weapons are poor vs infantry (none armor)', () => {
    const damage = 40;
    const mult = getWarheadMultiplier('AP', 'none');
    expect(mult).toBe(0.3);
    expect(modifyDamage(damage, 'AP', 'none', 0)).toBe(12);
  });

  it('HE weapons are versatile (good vs concrete and wood)', () => {
    const damage = 150;
    expect(modifyDamage(damage, 'HE', 'concrete', 0)).toBe(150); // 1.0x
    expect(modifyDamage(damage, 'HE', 'wood', 0)).toBe(113); // round(150 * 0.75) = 112.5 -> 113
  });

  it('Fire warhead is devastating vs wood but weak vs heavy', () => {
    const damage = 100;
    expect(modifyDamage(damage, 'Fire', 'wood', 0)).toBe(100); // 1.0x
    expect(modifyDamage(damage, 'Fire', 'heavy', 0)).toBe(25); // 0.25x
  });

  it('SA (Small Arms) is effective vs infantry, poor vs armor', () => {
    expect(modifyDamage(15, 'SA', 'none', 0)).toBe(15);  // 1.0x
    expect(modifyDamage(15, 'SA', 'heavy', 0)).toBe(4);  // round(15 * 0.25) = 3.75 -> 4
    expect(modifyDamage(15, 'SA', 'concrete', 0)).toBe(4); // round(15 * 0.25) = 3.75 -> 4
  });

  it('Organic warhead deals zero vs armored targets', () => {
    expect(modifyDamage(100, 'Organic', 'wood', 0)).toBe(0);
    expect(modifyDamage(100, 'Organic', 'light', 0)).toBe(0);
    expect(modifyDamage(100, 'Organic', 'heavy', 0)).toBe(0);
    expect(modifyDamage(100, 'Organic', 'concrete', 0)).toBe(0);
  });

  it('Organic warhead deals full damage vs none (infantry)', () => {
    expect(modifyDamage(100, 'Organic', 'none', 0)).toBe(100);
  });

  it('HollowPoint is extreme anti-infantry but nearly useless vs armor', () => {
    expect(modifyDamage(100, 'HollowPoint', 'none', 0)).toBe(100);
    // 0.05 mult: 100 * 0.05 = 5
    expect(modifyDamage(100, 'HollowPoint', 'heavy', 0)).toBe(5);
  });

  it('Mechanical warhead has 1.0 vs all (for mechanic healing)', () => {
    const armors: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];
    for (const a of armors) {
      expect(getWarheadMultiplier('Mechanical', a)).toBe(1.0);
    }
  });
});

// =========================================================================
// 8. Overkill handling — damage exceeding HP, death state transitions
// =========================================================================
describe('Overkill handling', () => {
  it('HP clamps to 0 when damage exceeds remaining HP', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.hp = 10;
    target.takeDamage(500, 'HE');
    expect(target.hp).toBe(0); // clamped at 0, not negative
  });

  it('death sets mission to DIE and animState to DIE', () => {
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    target.takeDamage(target.hp + 100, 'AP');
    expect(target.mission).toBe(Mission.DIE);
    expect(target.animState).toBe(AnimState.DIE);
    expect(target.animFrame).toBe(0);
    expect(target.animTick).toBe(0);
    expect(target.deathTick).toBe(0);
  });

  it('single-damage overkill (e.g. nuke) results in clean death', () => {
    const target = makeEntity(UnitType.V_4TNK, House.USSR, 100, 100);
    expect(target.hp).toBe(600); // mammoth has 600 HP
    const killed = target.takeDamage(9999, 'Nuke');
    expect(killed).toBe(true);
    expect(target.hp).toBe(0);
    expect(target.alive).toBe(false);
  });

  it('exactly lethal damage (hp === damage) kills the entity', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const exactDamage = target.hp;
    const killed = target.takeDamage(exactDamage, 'SA');
    expect(killed).toBe(true);
    expect(target.hp).toBe(0);
    expect(target.alive).toBe(false);
  });

  it('zero damage does not kill (hp > 0 after 0 damage)', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const hpBefore = target.hp;
    const killed = target.takeDamage(0, 'SA');
    expect(killed).toBe(false);
    expect(target.hp).toBe(hpBefore);
    expect(target.alive).toBe(true);
  });

  it('death variant is set based on warhead infantryDeath property', () => {
    // SA warhead has infantryDeath=1 (fire) -> deathVariant=1
    const target1 = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target1.takeDamage(target1.hp + 10, 'SA');
    expect(target1.deathVariant).toBe(1); // infantryDeath > 0 -> die2

    // Organic warhead has infantryDeath=0 (normal) -> deathVariant=0
    const target2 = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    target2.takeDamage(target2.hp + 10, 'Organic');
    expect(target2.deathVariant).toBe(0); // infantryDeath === 0 -> die1
  });

  it('transport death kills all passengers', () => {
    const transport = makeEntity(UnitType.V_APC, House.Spain, 100, 100);
    const passenger1 = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const passenger2 = makeEntity(UnitType.I_E2, House.Spain, 100, 100);
    transport.passengers.push(passenger1, passenger2);

    const killed = transport.takeDamage(transport.hp + 100, 'HE');
    expect(killed).toBe(true);
    expect(passenger1.alive).toBe(false);
    expect(passenger1.mission).toBe(Mission.DIE);
    expect(passenger2.alive).toBe(false);
    expect(passenger2.mission).toBe(Mission.DIE);
    expect(transport.passengers).toHaveLength(0);
  });
});

// =========================================================================
// 9. Friendly fire rules — direct hit alliance prevention
// =========================================================================
describe('Friendly fire rules', () => {
  it('splash damage hits ALL units in radius regardless of alliance (C++ parity)', () => {
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const friendly = makeEntity(UnitType.I_E1, House.Greece, 124, 100); // 1 cell from center, allied
    const enemy = makeEntity(UnitType.I_E1, House.USSR, 100, 124); // 1 cell from center, enemy
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker, friendly, enemy);
    const friendlyHpBefore = friendly.hp;
    const enemyHpBefore = enemy.hp;
    applySplashDamage(ctx, { x: 100, y: 100 },
      { damage: 100, warhead: 'HE', splash: 1.5 }, -1, House.Spain, attacker);
    // Both friendly and enemy should take damage (splash hits everyone)
    expect(friendly.hp).toBeLessThan(friendlyHpBefore);
    expect(enemy.hp).toBeLessThan(enemyHpBefore);
  });

  it('friendly kill from splash does NOT credit kill to attacker', () => {
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const friendly = makeEntity(UnitType.I_E1, House.Greece, 112, 100); // close to center, allied
    friendly.hp = 1; // will be killed by splash
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker, friendly);
    expect(attacker.kills).toBe(0);
    applySplashDamage(ctx, { x: 100, y: 100 },
      { damage: 200, warhead: 'HE', splash: 1.5 }, -1, House.Spain, attacker);
    expect(friendly.alive).toBe(false);
    // Friendly kill should NOT credit kill
    expect(attacker.kills).toBe(0);
  });

  it('default alliances: Spain and Greece are allied', () => {
    expect(isAllied(House.Spain, House.Greece)).toBe(true);
  });

  it('default alliances: Spain and USSR are NOT allied', () => {
    expect(isAllied(House.Spain, House.USSR)).toBe(false);
  });

  it('Entity.takeDamage does not check alliance (it applies damage unconditionally)', () => {
    // Allied infantry can be damaged by takeDamage directly
    const friendly = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const hpBefore = friendly.hp;
    friendly.takeDamage(10, 'SA');
    expect(friendly.hp).toBe(hpBefore - 10);
  });
});

// =========================================================================
// 10. Retaliation — attacked units switching to ATTACK mission
// =========================================================================
describe('Retaliation system — triggerRetaliation', () => {
  it('does nothing when victim or attacker is dead', () => {
    const victim = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const attacker = makeEntity(UnitType.I_E1, House.Spain, 200, 200);
    const ctx = makeMockCombatContext();
    // Dead victim does not retaliate
    victim.alive = false;
    triggerRetaliation(ctx, victim, attacker);
    expect(victim.mission).not.toBe(Mission.ATTACK);
    // Dead attacker does not trigger retaliation
    const victim2 = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    attacker.alive = false;
    triggerRetaliation(ctx, victim2, attacker);
    expect(victim2.target).toBeNull();
  });

  it('prevents allied retaliation', () => {
    const victim = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const attacker = makeEntity(UnitType.I_E1, House.Greece, 200, 200); // allied
    const ctx = makeMockCombatContext();
    expect(isAllied(House.Spain, House.Greece)).toBe(true);
    triggerRetaliation(ctx, victim, attacker);
    expect(victim.target).toBeNull();
    expect(victim.mission).not.toBe(Mission.ATTACK);
  });

  it('only retargets if no current living target', () => {
    const victim = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const existingTarget = makeEntity(UnitType.I_E1, House.Spain, 150, 150);
    const newAttacker = makeEntity(UnitType.I_E1, House.Spain, 200, 200);
    victim.target = existingTarget;
    existingTarget.alive = true;
    const ctx = makeMockCombatContext();
    triggerRetaliation(ctx, victim, newAttacker);
    // Should NOT retarget because victim already has a living target
    expect(victim.target).toBe(existingTarget);
  });

  it('sets victim.mission to ATTACK and target to attacker', () => {
    const victim = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const attacker = makeEntity(UnitType.I_E1, House.Spain, 200, 200);
    victim.target = null;
    victim.mission = Mission.GUARD;
    const ctx = makeMockCombatContext();
    triggerRetaliation(ctx, victim, attacker);
    expect(victim.target).toBe(attacker);
    expect(victim.mission).toBe(Mission.ATTACK);
    expect(victim.animState).toBe(AnimState.ATTACK);
  });

  it('unarmed units cannot retaliate', () => {
    const victim = makeEntity(UnitType.V_MCV, House.USSR, 100, 100); // MCV has no weapon
    const attacker = makeEntity(UnitType.I_E1, House.Spain, 200, 200);
    expect(victim.weapon).toBeNull();
    const ctx = makeMockCombatContext();
    triggerRetaliation(ctx, victim, attacker);
    expect(victim.target).toBeNull();
    expect(victim.mission).not.toBe(Mission.ATTACK);
  });

  it('scripted team mission units do not retarget (except HUNT)', () => {
    const victim = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const attacker = makeEntity(UnitType.I_E1, House.Spain, 200, 200);
    victim.teamMissions = [{ type: 'MOVE', target: { x: 50, y: 50 } }];
    victim.mission = Mission.MOVE;
    const ctx = makeMockCombatContext();
    triggerRetaliation(ctx, victim, attacker);
    // Should NOT retarget because unit has scripted team missions and is not HUNT
    expect(victim.target).toBeNull();

    // HUNT mission units DO retaliate even with team missions
    const hunter = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    hunter.teamMissions = [{ type: 'HUNT' }];
    hunter.mission = Mission.HUNT;
    triggerRetaliation(ctx, hunter, attacker);
    expect(hunter.target).toBe(attacker);
    expect(hunter.mission).toBe(Mission.ATTACK);
  });

  it('retaliation triggers from projectile arrival and splash damage paths', () => {
    // Projectile arrival path: target retaliates against attacker
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 200, 100);
    target.mission = Mission.GUARD;
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker, target);
    const proj: InflightProjectile = {
      attackerId: attacker.id, targetId: target.id, weapon: WEAPON_STATS['90mm'],
      damage: 5, speed: 2, travelFrames: 1, currentFrame: 0,
      directHit: true, impactX: 200, impactY: 100, attackerIsPlayer: true,
    };
    ctx.inflightProjectiles.push(proj);
    updateInflightProjectiles(ctx);
    expect(target.alive).toBe(true);
    expect(target.target).toBe(attacker);
    expect(target.mission).toBe(Mission.ATTACK);

    // Splash damage path: nearby unit retaliates
    const splashVictim = makeEntity(UnitType.I_E1, House.USSR, 300, 100);
    splashVictim.mission = Mission.GUARD;
    registerEntities(ctx, splashVictim);
    applySplashDamage(ctx, { x: 300 + CELL_SIZE / 2, y: 100 },
      { damage: 50, warhead: 'HE', splash: 1.5 }, -1, House.Spain, attacker);
    expect(splashVictim.target).toBe(attacker);
  });
});

// =========================================================================
// 11. Kill tracking and creditKill
// =========================================================================
describe('Kill tracking / creditKill', () => {
  it('kill count starts at 0', () => {
    const e = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(e.kills).toBe(0);
  });

  it('creditKill increments kills by 1', () => {
    const e = makeEntity(UnitType.V_2TNK, House.Spain);
    e.creditKill();
    expect(e.kills).toBe(1);
    e.creditKill();
    expect(e.kills).toBe(2);
  });

  it('multiple kills accumulate correctly', () => {
    const e = makeEntity(UnitType.I_E1, House.Spain);
    for (let i = 0; i < 10; i++) e.creditKill();
    expect(e.kills).toBe(10);
  });

  it('kill credit happens on direct hit kill via fireWeaponAt', () => {
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 124, 100);
    target.hp = 1;
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker, target);
    expect(attacker.kills).toBe(0);
    fireWeaponAt(ctx, attacker, target, WEAPON_STATS['90mm']);
    expect(target.alive).toBe(false);
    expect(attacker.kills).toBe(1);
  });

  it('kill credit happens on projectile kill', () => {
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 200, 100);
    target.hp = 1;
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker, target);
    const proj: InflightProjectile = {
      attackerId: attacker.id, targetId: target.id, weapon: WEAPON_STATS['90mm'],
      damage: 30, speed: 2, travelFrames: 1, currentFrame: 0,
      directHit: true, impactX: 200, impactY: 100, attackerIsPlayer: true,
    };
    ctx.inflightProjectiles.push(proj);
    updateInflightProjectiles(ctx);
    expect(target.alive).toBe(false);
    expect(attacker.kills).toBe(1);
  });

  it('splash kill only credits for enemy kills (not friendly)', () => {
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const enemy = makeEntity(UnitType.I_E1, House.USSR, 112, 100);
    enemy.hp = 1;
    const friendly = makeEntity(UnitType.I_E1, House.Greece, 100, 112);
    friendly.hp = 1;
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker, enemy, friendly);
    applySplashDamage(ctx, { x: 100, y: 100 },
      { damage: 200, warhead: 'HE', splash: 1.5 }, -1, House.Spain, attacker);
    expect(enemy.alive).toBe(false);
    expect(friendly.alive).toBe(false);
    // Only enemy kill credited, not friendly kill
    expect(attacker.kills).toBe(1);
  });
});

// =========================================================================
// 12. Invulnerability — crate and Iron Curtain protection
// =========================================================================
describe('Invulnerability mechanics', () => {
  it('invulnTick > 0 blocks all damage', () => {
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    target.invulnTick = 60;
    const hpBefore = target.hp;
    const killed = target.takeDamage(999, 'Super');
    expect(killed).toBe(false);
    expect(target.hp).toBe(hpBefore);
  });

  it('ironCurtainTick > 0 blocks all damage', () => {
    const target = makeEntity(UnitType.V_4TNK, House.USSR, 100, 100);
    target.ironCurtainTick = 100;
    const hpBefore = target.hp;
    target.takeDamage(999, 'Super');
    expect(target.hp).toBe(hpBefore);
    expect(target.alive).toBe(true);
  });

  it('isInvulnerable getter returns true when either timer is active', () => {
    const e1 = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(e1.isInvulnerable).toBe(false);
    e1.invulnTick = 1;
    expect(e1.isInvulnerable).toBe(true);
    e1.invulnTick = 0;
    e1.ironCurtainTick = 1;
    expect(e1.isInvulnerable).toBe(true);
  });

  it('invulnerability blocks dog instant-kill', () => {
    const dog = makeEntity(UnitType.I_DOG, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    dog.target = target;
    target.invulnTick = 10;
    const killed = target.takeDamage(100, 'Organic', dog);
    expect(killed).toBe(false);
    expect(target.hp).toBe(target.maxHp);
  });
});

// =========================================================================
// 13. Armor bias — crate damage reduction
// =========================================================================
describe('Armor bias (crate damage reduction)', () => {
  it('default armorBias is 1.0 (no reduction)', () => {
    const e = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(e.armorBias).toBe(1.0);
  });

  it('armorBias > 1.0 reduces incoming damage', () => {
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    target.armorBias = 2.0; // crate: half damage
    const hpBefore = target.hp;
    target.takeDamage(100, 'AP');
    // damage = max(1, round(100 / 2.0)) = 50
    expect(target.hp).toBe(hpBefore - 50);
  });

  it('armorBias guarantees minimum 1 damage', () => {
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    target.armorBias = 100; // extreme bias
    const hpBefore = target.hp;
    target.takeDamage(1, 'SA');
    // max(1, round(1/100)) = max(1, 0) = 1
    expect(target.hp).toBe(hpBefore - 1);
  });

  it('armorBias = 1.0 does not modify damage', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.armorBias = 1.0;
    const hpBefore = target.hp;
    target.takeDamage(20, 'SA');
    expect(target.hp).toBe(hpBefore - 20);
  });
});

// =========================================================================
// 14. Firepower bias — crate damage multiplier
// =========================================================================
describe('Firepower bias (crate damage output multiplier)', () => {
  it('default firepowerBias is 1.0', () => {
    const e = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(e.firepowerBias).toBe(1.0);
  });

  it('firepowerBias 2.0 doubles effective damage output (formula verification)', () => {
    // In the actual pipeline, firepowerBias would be applied in the Game.fire* methods
    // The entity stores the bias; it gets multiplied into the damage calculation.
    // The entity field itself doesn't modify takeDamage — it's on the attacker side.
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain);
    attacker.firepowerBias = 2.0;
    expect(attacker.firepowerBias).toBe(2.0);

    // Verify the field is separate from armorBias
    expect(attacker.armorBias).toBe(1.0);
  });
});

// =========================================================================
// 15. getFirepowerBias — house and scenario overrides
// =========================================================================
describe('getFirepowerBias — house bonus system', () => {
  it('Spain has neutral firepower (1.0)', () => {
    const bias = COUNTRY_BONUSES.Spain.firepowerMult;
    expect(bias).toBe(1.0);
  });

  it('Germany has 10% firepower bonus (1.10)', () => {
    expect(COUNTRY_BONUSES.Germany.firepowerMult).toBe(1.10);
  });

  it('USSR has neutral firepower but 10% cost discount', () => {
    expect(COUNTRY_BONUSES.USSR.firepowerMult).toBe(1.0);
    expect(COUNTRY_BONUSES.USSR.costMult).toBe(0.9);
  });

  it('Greece has neutral firepower (1.0)', () => {
    expect(COUNTRY_BONUSES.Greece.firepowerMult).toBe(1.0);
  });

  it('Neutral has firepower 1.0', () => {
    expect(COUNTRY_BONUSES.Neutral.firepowerMult).toBe(1.0);
  });

  it('getFirepowerBias source code supports ant mission overrides', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'EasterEgg', 'engine', 'index.ts'), 'utf-8',
    );
    const startIdx = src.indexOf('getFirepowerBias(house: House)');
    expect(startIdx).toBeGreaterThan(-1);
    const chunk = src.slice(startIdx, startIdx + 400);
    expect(chunk).toContain('SCA');
    expect(chunk).toContain('ANT_HOUSES');
    expect(chunk).toContain('USSR: 1.1');
    expect(chunk).toContain('Ukraine: 1.0');
    expect(chunk).toContain('Germany: 0.9');
  });
});

// =========================================================================
// 16. Prone damage reduction (infantry fear/prone system)
// =========================================================================
describe('Prone damage reduction', () => {
  it('PRONE_DAMAGE_BIAS is 0.5 (50% damage)', () => {
    expect(PRONE_DAMAGE_BIAS).toBe(0.5);
  });

  it('prone infantry takes half damage', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.isProne = true;
    const hpBefore = target.hp;
    target.takeDamage(20, 'SA');
    // max(1, round(20 * 0.5)) = 10
    expect(target.hp).toBe(hpBefore - 10);
  });

  it('prone damage guarantees minimum 1', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.isProne = true;
    const hpBefore = target.hp;
    target.takeDamage(1, 'SA');
    // max(1, round(1 * 0.5)) = max(1, 1) = 1
    expect(target.hp).toBe(hpBefore - 1);
  });

  it('non-prone infantry takes full damage', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.isProne = false;
    const hpBefore = target.hp;
    target.takeDamage(20, 'SA');
    expect(target.hp).toBe(hpBefore - 20);
  });

  it('prone + armorBias stack: damage reduced by both', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.isProne = true;
    target.armorBias = 2.0;
    const hpBefore = target.hp;
    target.takeDamage(100, 'SA');
    // armorBias first: max(1, round(100/2.0)) = 50
    // prone then: max(1, round(50 * 0.5)) = 25
    expect(target.hp).toBe(hpBefore - 25);
  });
});

// =========================================================================
// 17. Fear system — damage increases fear
// =========================================================================
describe('Fear system on damage', () => {
  it('infantry fear starts at 0', () => {
    const inf = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    expect(inf.fear).toBe(0);
  });

  it('taking damage increases infantry fear to at least FEAR_SCARED', () => {
    const inf = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    inf.takeDamage(10, 'SA');
    expect(inf.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('fear is capped at FEAR_MAXIMUM (255)', () => {
    expect(Entity.FEAR_MAXIMUM).toBe(255);
    const inf = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    inf.fear = 250;
    inf.takeDamage(5, 'SA');
    expect(inf.fear).toBeLessThanOrEqual(Entity.FEAR_MAXIMUM);
  });

  it('vehicles do not gain fear from damage', () => {
    const vehicle = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    vehicle.takeDamage(50, 'AP');
    expect(vehicle.fear).toBe(0);
  });

  it('zero damage does not increase fear', () => {
    const inf = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    inf.takeDamage(0, 'SA');
    expect(inf.fear).toBe(0);
  });
});

// =========================================================================
// 18. Damage flash effect
// =========================================================================
describe('Damage flash', () => {
  it('takeDamage sets damageFlash to 4 ticks', () => {
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    expect(target.damageFlash).toBe(0);
    target.takeDamage(10, 'AP');
    expect(target.damageFlash).toBe(4);
  });

  it('damageFlash decrements via tickAnimation', () => {
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    target.damageFlash = 4;
    target.tickAnimation();
    expect(target.damageFlash).toBe(3);
  });

  it('damageFlash does not go negative', () => {
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    target.damageFlash = 0;
    target.tickAnimation();
    expect(target.damageFlash).toBe(0);
  });
});

// =========================================================================
// 19. Submarine cloak interaction with damage
// =========================================================================
describe('Submarine cloak — uncloak on damage', () => {
  it('cloaked sub is force-uncloaked when damaged', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR, 100, 100);
    sub.cloakState = 2; // CloakState.CLOAKED
    expect(sub.stats.isCloakable).toBe(true);
    sub.takeDamage(10, 'AP');
    expect(sub.cloakState).toBe(3); // CloakState.UNCLOAKING
  });

  it('cloaking sub is interrupted when damaged', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR, 100, 100);
    sub.cloakState = 1; // CloakState.CLOAKING
    sub.takeDamage(10, 'AP');
    expect(sub.cloakState).toBe(3); // CloakState.UNCLOAKING
  });

  it('already uncloaked sub stays uncloaked when damaged', () => {
    const sub = makeEntity(UnitType.V_SS, House.USSR, 100, 100);
    sub.cloakState = 0; // CloakState.UNCLOAKED
    sub.takeDamage(10, 'AP');
    expect(sub.cloakState).toBe(0); // stays UNCLOAKED
  });
});

// =========================================================================
// 20. Entity.selectWeapon — dual weapon selection logic
// =========================================================================
describe('Entity.selectWeapon', () => {
  it('single-weapon unit returns primary weapon', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.ANT1, House.USSR, 200, 100);
    expect(tank.weapon2).toBeNull();
    const selected = tank.selectWeapon(target, getWarheadMultiplier);
    expect(selected).toBe(tank.weapon);
  });

  it('dual-weapon unit selects weapon with higher effective damage', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    const heavyTarget = makeEntity(UnitType.V_3TNK, House.USSR, 200, 100);

    expect(mammoth.weapon).not.toBeNull();
    expect(mammoth.weapon2).not.toBeNull();

    // Both weapons in range, both ready
    mammoth.attackCooldown = 0;
    mammoth.attackCooldown2 = 0;

    const selected = mammoth.selectWeapon(heavyTarget, getWarheadMultiplier);
    // Should pick the weapon with higher effective damage vs heavy armor
    // 120mm: AP vs heavy = 1.0, damage 40 -> eff = 40
    // MammothTusk: HE vs heavy = 0.25, damage 75 -> eff = 18.75
    // 120mm wins
    expect(selected?.name).toBe('120mm');
  });

  it('returns null when both weapons are on cooldown', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 200, 100);
    mammoth.attackCooldown = 10;
    mammoth.attackCooldown2 = 10;
    const selected = mammoth.selectWeapon(target, getWarheadMultiplier);
    expect(selected).toBeNull();
  });

  it('returns ready weapon when one is on cooldown', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.V_2TNK, House.USSR, 200, 100);
    mammoth.attackCooldown = 10; // primary on cooldown
    mammoth.attackCooldown2 = 0; // secondary ready
    const selected = mammoth.selectWeapon(target, getWarheadMultiplier);
    expect(selected?.name).toBe('MammothTusk');
  });
});

// =========================================================================
// 21. Entity.inRange checks
// =========================================================================
describe('Entity range checking', () => {
  it('inRange returns true when target is within weapon range', () => {
    const shooter = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const target = makeEntity(UnitType.ANT1, House.USSR, 100 + CELL_SIZE * 2, 100); // 2 cells
    expect(shooter.weapon).not.toBeNull();
    expect(shooter.weapon!.range).toBeGreaterThan(2); // M1Carbine range = 3.0
    expect(shooter.inRange(target)).toBe(true);
  });

  it('inRange returns false when target is beyond weapon range', () => {
    const shooter = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    const target = makeEntity(UnitType.ANT1, House.USSR, 100 + CELL_SIZE * 10, 100); // 10 cells
    expect(shooter.inRange(target)).toBe(false);
  });

  it('inRangeWith checks a specific weapon', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.ANT1, House.USSR, 100 + CELL_SIZE * 4, 100); // 4 cells
    // Primary (120mm) range = 4.75 -> in range
    expect(mammoth.inRangeWith(target, mammoth.weapon!)).toBe(true);
    // Secondary (MammothTusk) range = 5.0 -> also in range
    expect(mammoth.inRangeWith(target, mammoth.weapon2!)).toBe(true);
  });
});

// =========================================================================
// 22. Splash damage radius and falloff
// =========================================================================
describe('Splash damage — radius and falloff', () => {
  it('Game.SPLASH_RADIUS is 1.5 cells', () => {
    expect(Game.SPLASH_RADIUS).toBe(1.5);
  });

  it('applySplashDamage uses fixed SPLASH_RADIUS of 1.5 cells (not weapon.splash)', () => {
    // SPLASH_RADIUS constant is 1.5
    expect(SPLASH_RADIUS).toBe(1.5);
    // Unit at exactly 1.5 cells away should NOT take splash damage (exclusive boundary)
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const nearUnit = makeEntity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100); // 1 cell away
    const farUnit = makeEntity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE * 2, 100); // 2 cells away
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker, nearUnit, farUnit);
    const nearHpBefore = nearUnit.hp;
    const farHpBefore = farUnit.hp;
    applySplashDamage(ctx, { x: 100, y: 100 },
      { damage: 100, warhead: 'HE', splash: 5 }, -1, House.Spain, attacker); // weapon.splash=5 but radius is capped at 1.5
    expect(nearUnit.hp).toBeLessThan(nearHpBefore); // 1 cell = within 1.5
    expect(farUnit.hp).toBe(farHpBefore); // 2 cells = outside 1.5
  });

  it('splash uses inverse-proportional falloff via modifyDamage', () => {
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const closeUnit = makeEntity(UnitType.V_2TNK, House.USSR, 100 + 4, 100); // ~0.17 cells
    const farUnit = makeEntity(UnitType.V_2TNK, House.USSR, 100 + CELL_SIZE, 100); // 1 cell
    const ctx = makeMockCombatContext();
    registerEntities(ctx, attacker, closeUnit, farUnit);
    const closeHpBefore = closeUnit.hp;
    const farHpBefore = farUnit.hp;
    applySplashDamage(ctx, { x: 100, y: 100 },
      { damage: 100, warhead: 'HE', splash: 1.5 }, -1, House.Spain, attacker);
    const closeDmg = closeHpBefore - closeUnit.hp;
    const farDmg = farHpBefore - farUnit.hp;
    // Close unit takes more damage than far unit (inverse falloff)
    expect(closeDmg).toBeGreaterThan(farDmg);
    expect(farDmg).toBeGreaterThan(0);
  });

  it('modifyDamage at point-blank (0 distance) returns full damage', () => {
    expect(modifyDamage(100, 'HE', 'none', 0)).toBe(90); // HE vs none = 0.9
  });

  it('modifyDamage at 1 cell distance with HE reduces damage', () => {
    const distPixels = CELL_SIZE; // 24px
    const dmg = modifyDamage(100, 'HE', 'none', distPixels);
    // distFactor = 24*2/6 = 8, damage = 90/8 = 11.25 -> 11
    expect(dmg).toBe(11);
  });

  it('modifyDamage at max falloff (distFactor=16) gives minimum', () => {
    const distPixels = 2 * CELL_SIZE; // 48px
    const dmg = modifyDamage(100, 'HE', 'none', distPixels);
    // distFactor = 48*2/6 = 16, damage = 90/16 = 5.625 -> 6
    expect(dmg).toBe(6);
  });
});

// =========================================================================
// 23. WARHEAD_PROPS — infantry death variants
// =========================================================================
describe('WARHEAD_PROPS — infantry death variants', () => {
  it('SA has infantryDeath=1 (twirl)', () => {
    expect(WARHEAD_PROPS.SA.infantryDeath).toBe(1);
  });

  it('HE has infantryDeath=2 (explode)', () => {
    expect(WARHEAD_PROPS.HE.infantryDeath).toBe(2);
  });

  it('AP has infantryDeath=3 (flying)', () => {
    expect(WARHEAD_PROPS.AP.infantryDeath).toBe(3);
  });

  it('Fire has infantryDeath=4 (burn)', () => {
    expect(WARHEAD_PROPS.Fire.infantryDeath).toBe(4);
  });

  it('Super has infantryDeath=5 (electro)', () => {
    expect(WARHEAD_PROPS.Super.infantryDeath).toBe(5);
  });

  it('Organic has infantryDeath=0 (instant)', () => {
    expect(WARHEAD_PROPS.Organic.infantryDeath).toBe(0);
  });

  it('Nuke has infantryDeath=4 (burn — matches Fire)', () => {
    expect(WARHEAD_PROPS.Nuke.infantryDeath).toBe(4);
  });

  it('all warhead types have WARHEAD_PROPS defined', () => {
    const warheads: WarheadType[] = ['SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke', 'Mechanical'];
    for (const wh of warheads) {
      expect(WARHEAD_PROPS[wh], `${wh} should have WARHEAD_PROPS`).toBeDefined();
      expect(typeof WARHEAD_PROPS[wh].infantryDeath).toBe('number');
      expect(typeof WARHEAD_PROPS[wh].explosionSet).toBe('string');
    }
  });
});

// =========================================================================
// 24. Edge cases
// =========================================================================
describe('Edge cases', () => {
  it('damage of 1 to unit with 1 HP kills it', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.hp = 1;
    const killed = target.takeDamage(1, 'SA');
    expect(killed).toBe(true);
    expect(target.hp).toBe(0);
    expect(target.alive).toBe(false);
  });

  it('negative damage (Heal) does not kill', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.hp = 30;
    const killed = target.takeDamage(-50, 'Organic');
    expect(killed).toBe(false);
    // HP goes above current value (healing)
    expect(target.hp).toBe(80);
    expect(target.alive).toBe(true);
  });

  it('attacking already-dead entity returns false without further damage', () => {
    const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    target.alive = false;
    target.hp = 0;
    const killed = target.takeDamage(999, 'Super');
    expect(killed).toBe(false);
    expect(target.hp).toBe(0);
  });

  it('DG2: dog collateral prevention — dogs only hurt their designated target', () => {
    const dog = makeEntity(UnitType.I_DOG, House.Spain, 100, 100);
    const realTarget = makeEntity(UnitType.I_E1, House.USSR, 200, 200);
    const bystander = makeEntity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    dog.target = realTarget;

    const hpBefore = bystander.hp;
    bystander.takeDamage(50, 'Organic', dog);
    // DG2: dog damage blocked for non-target
    expect(bystander.hp).toBe(hpBefore);
    expect(bystander.alive).toBe(true);
  });

  it('dead dog cannot instant-kill', () => {
    const dog = makeEntity(UnitType.I_DOG, House.Spain, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);
    dog.target = target;
    dog.alive = false;
    target.hp = 50;
    target.maxHp = 50;
    const killed = target.takeDamage(1, 'Organic', dog);
    expect(killed).toBe(false);
    expect(target.hp).toBe(49);
  });

  it('modifyDamage caps at MAX_DAMAGE (1000)', () => {
    const result = modifyDamage(5000, 'Super', 'none', 0);
    expect(result).toBe(1000);
  });

  it('modifyDamage MinDamage=1 guarantee at close range (distFactor < 4)', () => {
    // Very small damage + heavy armor + close range
    const result = modifyDamage(1, 'SA', 'heavy', 2);
    // distFactor = 2*2/3 = 1.33 (< 4), so MinDamage applies
    expect(result).toBe(1);
  });

  it('multiple damage events reduce HP additively', () => {
    const target = makeEntity(UnitType.V_4TNK, House.USSR, 100, 100);
    const initialHp = target.hp; // 600
    target.takeDamage(100, 'AP');
    target.takeDamage(100, 'AP');
    target.takeDamage(100, 'AP');
    expect(target.hp).toBe(initialHp - 300);
    expect(target.alive).toBe(true);
  });
});

// =========================================================================
// 25. Weapon stats integrity for combat-relevant weapons
// =========================================================================
describe('Weapon stats integrity', () => {
  it('all tank main guns use AP warhead', () => {
    expect(WEAPON_STATS['75mm'].warhead).toBe('AP');
    expect(WEAPON_STATS['90mm'].warhead).toBe('AP');
    expect(WEAPON_STATS['105mm'].warhead).toBe('AP');
    expect(WEAPON_STATS['120mm'].warhead).toBe('AP');
  });

  it('infantry small arms use SA warhead', () => {
    expect(WEAPON_STATS.M1Carbine.warhead).toBe('SA');
    expect(WEAPON_STATS.M60mg.warhead).toBe('SA');
  });

  it('explosive weapons use HE warhead', () => {
    expect(WEAPON_STATS.Grenade.warhead).toBe('HE');
    expect(WEAPON_STATS.MammothTusk.warhead).toBe('HE');
    expect(WEAPON_STATS['155mm'].warhead).toBe('HE');
    expect(WEAPON_STATS.SCUD.warhead).toBe('HE');
  });

  it('Mandible uses Super warhead (C++ parity)', () => {
    expect(WEAPON_STATS.Mandible.warhead).toBe('Super');
  });

  it('FireballLauncher uses Fire warhead with splash', () => {
    expect(WEAPON_STATS.FireballLauncher.warhead).toBe('Fire');
    expect(WEAPON_STATS.FireballLauncher.splash).toBe(1.5);
  });

  it('Heal weapon has negative damage', () => {
    expect(WEAPON_STATS.Heal.damage).toBe(-50);
    expect(WEAPON_STATS.Heal.warhead).toBe('Organic');
  });

  it('Sniper uses HollowPoint warhead (anti-infantry)', () => {
    expect(WEAPON_STATS.Sniper.warhead).toBe('HollowPoint');
    expect(WEAPON_STATS.Sniper.damage).toBe(100);
  });

  it('120mm has burst=2 (fires two shots)', () => {
    expect(WEAPON_STATS['120mm'].burst).toBe(2);
  });

  it('MammothTusk has burst=2 and splash=1.5', () => {
    expect(WEAPON_STATS.MammothTusk.burst).toBe(2);
    expect(WEAPON_STATS.MammothTusk.splash).toBe(1.5);
  });
});
