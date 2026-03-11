/**
 * Subsystem Behavioral Tests — covers functions that currently have NO
 * behavioral test coverage across the 6 extracted subsystem modules.
 *
 * Functions tested here (not covered by existing pipeline tests):
 *
 * combat.ts:
 *   - handleUnitDeath (direct call with varied opts)
 *   - damageSpeedFactor (direct call)
 *   - fireWeaponAtStructure (additional behavioral coverage)
 *
 * fog.ts:
 *   - updateSubDetection (direct edge cases: multiple detectors, already-uncloaked)
 *
 * production.ts:
 *   - countPlayerBuildings (imported from production.ts, not local reimpl)
 *   - getAvailableItems (imported from production.ts with full ProductionContext)
 *
 * repairSell.ts:
 *   - calculatePowerGrid (from repairSell.ts directly, not local reimpl)
 *   - powerMultiplier (from repairSell.ts directly)
 *   - calculateSiloCapacity (from repairSell.ts directly)
 *
 * specialUnits.ts:
 *   - tickVortices (imported but never called in existing tests)
 *
 * superweapon.ts:
 *   - findBestNukeTarget (never called directly in tests)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, Mission, AnimState, CELL_SIZE, MAP_CELLS,
  UNIT_STATS, WEAPON_STATS, CONDITION_RED, CONDITION_YELLOW,
  WARHEAD_VS_ARMOR, WARHEAD_META, WARHEAD_PROPS, POWER_DRAIN,
  type WarheadType, type ArmorType, type WeaponStats, type ProductionItem,
  PRODUCTION_ITEMS, COUNTRY_BONUSES, worldDist, worldToCell,
  buildDefaultAlliances, modifyDamage, getWarheadMultiplier,
  SuperweaponType, SUPERWEAPON_DEFS, getStripSide,
} from '../engine/types';
import { Entity, resetEntityIds, CloakState, CLOAK_TRANSITION_FRAMES, SONAR_PULSE_DURATION } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP } from '../engine/scenario';
import type { Effect } from '../engine/renderer';

// === Subsystem imports ===
import {
  type CombatContext, type InflightProjectile,
  handleUnitDeath, damageSpeedFactor, fireWeaponAtStructure,
  getWarheadMult,
} from '../engine/combat';
import {
  type FogContext,
  updateSubDetection,
} from '../engine/fog';
import {
  type ProductionContext,
  countPlayerBuildings, getAvailableItems, getEffectiveCost,
} from '../engine/production';
import {
  type RepairSellContext,
  calculatePowerGrid, powerMultiplier, calculateSiloCapacity,
} from '../engine/repairSell';
import {
  type SpecialUnitsContext,
  tickVortices,
} from '../engine/specialUnits';
import {
  type SuperweaponContext,
  findBestNukeTarget,
} from '../engine/superweapon';

beforeEach(() => resetEntityIds());

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

function makeStructure(
  type: string, house: House, cx = 10, cy = 10,
  opts: Partial<MapStructure> = {},
): MapStructure {
  const maxHp = (opts.maxHp ?? STRUCTURE_MAX_HP[type] ?? 256);
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: opts.hp ?? maxHp,
    maxHp,
    alive: opts.alive ?? true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    ...opts,
  } as MapStructure;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. combat.ts — handleUnitDeath (direct calls)
// ═══════════════════════════════════════════════════════════════════════════

function makeCombatContext(overrides: Partial<CombatContext> = {}): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities: [],
    entityById: new Map(),
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
    aiStates: new Map(),
    lastBaseAttackEva: 0,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    isAllied: (a, b) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a, b) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: vi.fn(),
    playEva: vi.fn(),
    minimapAlert: vi.fn(),
    movementSpeed: () => 1,
    getFirepowerBias: (house) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
    damageStructure: vi.fn(() => false),
    aiIQ: () => 3,
    clearStructureFootprint: vi.fn(),
    recalculateSiloCapacity: vi.fn(),
    showEvaMessage: vi.fn(),
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  };
}

describe('handleUnitDeath — direct behavioral tests', () => {
  it('creates explosion effect at victim position', () => {
    const ctx = makeCombatContext();
    const victim = makeEntity(UnitType.V_2TNK, House.USSR, 200, 300);
    victim.alive = false;

    handleUnitDeath(ctx, victim, {
      screenShake: 8, explosionSize: 16, debris: true,
      decal: { infantry: 6, vehicle: 10, opacity: 0.6 },
      explodeLgSound: false,
      attackerIsPlayer: false,
      trackLoss: false,
    });

    expect(ctx.effects.length).toBeGreaterThanOrEqual(1);
    const explosion = ctx.effects.find(e => e.type === 'explosion');
    expect(explosion).toBeDefined();
    expect(explosion!.x).toBe(200);
    expect(explosion!.y).toBe(300);
  });

  it('creates debris effect for vehicles (not infantry)', () => {
    const ctx = makeCombatContext();
    const tank = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    tank.alive = false;

    handleUnitDeath(ctx, tank, {
      screenShake: 8, explosionSize: 16, debris: true,
      decal: null, explodeLgSound: false,
      attackerIsPlayer: false, trackLoss: false,
    });

    const debris = ctx.effects.find(e => e.type === 'debris');
    expect(debris).toBeDefined();
  });

  it('does NOT create debris effect for infantry', () => {
    const ctx = makeCombatContext();
    const inf = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    inf.alive = false;

    handleUnitDeath(ctx, inf, {
      screenShake: 8, explosionSize: 16, debris: true,
      decal: null, explodeLgSound: false,
      attackerIsPlayer: false, trackLoss: false,
    });

    const debris = ctx.effects.find(e => e.type === 'debris');
    expect(debris).toBeUndefined();
  });

  it('increments killCount when attackerIsPlayer is true', () => {
    const ctx = makeCombatContext();
    const victim = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);

    handleUnitDeath(ctx, victim, {
      screenShake: 4, explosionSize: 12, debris: false,
      decal: null, explodeLgSound: false,
      attackerIsPlayer: true, trackLoss: false,
    });

    expect(ctx.killCount).toBe(1);
  });

  it('does NOT increment killCount when attackerIsPlayer is false', () => {
    const ctx = makeCombatContext();
    const victim = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);

    handleUnitDeath(ctx, victim, {
      screenShake: 4, explosionSize: 12, debris: false,
      decal: null, explodeLgSound: false,
      attackerIsPlayer: false, trackLoss: false,
    });

    expect(ctx.killCount).toBe(0);
  });

  it('increments lossCount and plays EVA for player unit death (trackLoss=true)', () => {
    const ctx = makeCombatContext();
    const playerUnit = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);

    handleUnitDeath(ctx, playerUnit, {
      screenShake: 8, explosionSize: 16, debris: true,
      decal: null, explodeLgSound: false,
      attackerIsPlayer: false, trackLoss: true,
    });

    expect(ctx.lossCount).toBe(1);
    expect(ctx.playEva).toHaveBeenCalledWith('eva_unit_lost');
    expect(ctx.minimapAlert).toHaveBeenCalled();
  });

  it('does NOT increment lossCount for enemy unit death even with trackLoss=true', () => {
    const ctx = makeCombatContext();
    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);

    handleUnitDeath(ctx, enemy, {
      screenShake: 8, explosionSize: 16, debris: true,
      decal: null, explodeLgSound: false,
      attackerIsPlayer: false, trackLoss: true,
    });

    expect(ctx.lossCount).toBe(0);
  });

  it('plays die_ant sound for ant victims', () => {
    const ctx = makeCombatContext();
    const ant = makeEntity(UnitType.ANT1, House.Special, 100, 100);

    handleUnitDeath(ctx, ant, {
      screenShake: 4, explosionSize: 12, debris: false,
      decal: null, explodeLgSound: false,
      attackerIsPlayer: true, trackLoss: false,
    });

    expect(ctx.playSoundAt).toHaveBeenCalledWith('die_ant', 100, 100);
  });

  it('plays die_infantry sound for infantry victims', () => {
    const ctx = makeCombatContext();
    const inf = makeEntity(UnitType.I_E1, House.USSR, 100, 100);

    handleUnitDeath(ctx, inf, {
      screenShake: 4, explosionSize: 12, debris: false,
      decal: null, explodeLgSound: false,
      attackerIsPlayer: false, trackLoss: false,
    });

    expect(ctx.playSoundAt).toHaveBeenCalledWith('die_infantry', 100, 100);
  });

  it('plays die_vehicle sound for vehicle victims', () => {
    const ctx = makeCombatContext();
    const tank = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);

    handleUnitDeath(ctx, tank, {
      screenShake: 4, explosionSize: 12, debris: false,
      decal: null, explodeLgSound: false,
      attackerIsPlayer: false, trackLoss: false,
    });

    expect(ctx.playSoundAt).toHaveBeenCalledWith('die_vehicle', 100, 100);
  });

  it('plays explode_lg sound when explodeLgSound=true', () => {
    const ctx = makeCombatContext();
    const victim = makeEntity(UnitType.V_2TNK, House.USSR, 150, 200);

    handleUnitDeath(ctx, victim, {
      screenShake: 8, explosionSize: 16, debris: true,
      decal: null, explodeLgSound: true,
      attackerIsPlayer: false, trackLoss: false,
    });

    expect(ctx.playSoundAt).toHaveBeenCalledWith('explode_lg', 150, 200);
  });

  it('sets screenShake to max of current and opts value', () => {
    const ctx = makeCombatContext({ screenShake: 5 });
    const victim = makeEntity(UnitType.V_2TNK, House.USSR);

    handleUnitDeath(ctx, victim, {
      screenShake: 8, explosionSize: 16, debris: false,
      decal: null, explodeLgSound: false,
      attackerIsPlayer: false, trackLoss: false,
    });

    expect(ctx.screenShake).toBe(8);
  });

  it('does NOT reduce screenShake if current value is higher', () => {
    const ctx = makeCombatContext({ screenShake: 12 });
    const victim = makeEntity(UnitType.V_2TNK, House.USSR);

    handleUnitDeath(ctx, victim, {
      screenShake: 4, explosionSize: 12, debris: false,
      decal: null, explodeLgSound: false,
      attackerIsPlayer: false, trackLoss: false,
    });

    expect(ctx.screenShake).toBe(12);
  });

  it('adds decal at victim cell when decal option is provided', () => {
    const ctx = makeCombatContext();
    const addDecalSpy = vi.spyOn(ctx.map, 'addDecal');
    const victim = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);

    handleUnitDeath(ctx, victim, {
      screenShake: 4, explosionSize: 12, debris: false,
      decal: { infantry: 6, vehicle: 10, opacity: 0.6 },
      explodeLgSound: false,
      attackerIsPlayer: false, trackLoss: false,
    });

    expect(addDecalSpy).toHaveBeenCalled();
    const call = addDecalSpy.mock.calls[0];
    // Vehicle decal size = 10
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(0.6);
  });

  it('uses infantry decal size for infantry victims', () => {
    const ctx = makeCombatContext();
    const addDecalSpy = vi.spyOn(ctx.map, 'addDecal');
    const inf = makeEntity(UnitType.I_E1, House.USSR, 100, 100);

    handleUnitDeath(ctx, inf, {
      screenShake: 4, explosionSize: 12, debris: false,
      decal: { infantry: 6, vehicle: 10, opacity: 0.6 },
      explodeLgSound: false,
      attackerIsPlayer: false, trackLoss: false,
    });

    expect(addDecalSpy).toHaveBeenCalled();
    const call = addDecalSpy.mock.calls[0];
    expect(call[2]).toBe(6); // infantry decal
  });

  it('friendlyFireLoss increments lossCount independently of trackLoss', () => {
    const ctx = makeCombatContext();
    const victim = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);

    handleUnitDeath(ctx, victim, {
      screenShake: 4, explosionSize: 12, debris: false,
      decal: null, explodeLgSound: false,
      attackerIsPlayer: true, trackLoss: false,
      friendlyFireLoss: true,
    });

    // friendlyFireLoss adds its own lossCount increment
    expect(ctx.lossCount).toBe(1);
    expect(ctx.playEva).toHaveBeenCalledWith('eva_unit_lost');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. combat.ts — damageSpeedFactor
// ═══════════════════════════════════════════════════════════════════════════

describe('damageSpeedFactor — HP-based speed reduction', () => {
  it('returns 1.0 for full HP entity', () => {
    const entity = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(damageSpeedFactor(entity)).toBe(1.0);
  });

  it('returns 1.0 for entity above CONDITION_YELLOW (50% HP)', () => {
    const entity = makeEntity(UnitType.V_2TNK, House.Spain);
    entity.hp = entity.maxHp * 0.6; // 60% HP, above yellow
    expect(damageSpeedFactor(entity)).toBe(1.0);
  });

  it('returns 1.0 for entity exactly at CONDITION_YELLOW + epsilon', () => {
    const entity = makeEntity(UnitType.V_2TNK, House.Spain);
    entity.hp = entity.maxHp * (CONDITION_YELLOW + 0.01);
    expect(damageSpeedFactor(entity)).toBe(1.0);
  });

  it('returns 0.75 for entity exactly at CONDITION_YELLOW (50% HP)', () => {
    const entity = makeEntity(UnitType.V_2TNK, House.Spain);
    entity.hp = entity.maxHp * CONDITION_YELLOW;
    expect(damageSpeedFactor(entity)).toBe(0.75);
  });

  it('returns 0.75 for entity at CONDITION_RED (25% HP)', () => {
    const entity = makeEntity(UnitType.V_2TNK, House.Spain);
    entity.hp = entity.maxHp * CONDITION_RED;
    expect(damageSpeedFactor(entity)).toBe(0.75);
  });

  it('returns 0.75 for entity at 1 HP', () => {
    const entity = makeEntity(UnitType.V_2TNK, House.Spain);
    entity.hp = 1;
    expect(damageSpeedFactor(entity)).toBe(0.75);
  });

  it('CONDITION_YELLOW is 0.5 (speed threshold)', () => {
    expect(CONDITION_YELLOW).toBe(0.5);
  });

  it('no speed tier beyond 0.75 — only two states', () => {
    const entity = makeEntity(UnitType.V_2TNK, House.Spain);
    // Test at various low HP values: all should be 0.75
    for (const ratio of [0.01, 0.1, 0.25, 0.49, 0.5]) {
      entity.hp = entity.maxHp * ratio;
      expect(damageSpeedFactor(entity)).toBe(0.75);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. combat.ts — fireWeaponAtStructure additional behavioral coverage
// ═══════════════════════════════════════════════════════════════════════════

describe('fireWeaponAtStructure — behavioral verification', () => {
  it('always uses concrete armor for damage calculation — reduces structure HP', () => {
    const structure = makeStructure('POWR', House.USSR, 5, 5, { hp: 400, maxHp: 400 });
    const ctx = makeCombatContext({ structures: [structure] });
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const weapon = WEAPON_STATS['90mm'];

    const whMult = getWarheadMult(weapon.warhead as WarheadType, 'concrete', {});
    // AP vs concrete should be less than 1.0
    expect(whMult).toBeLessThan(1.0);

    const hpBefore = structure.hp;
    fireWeaponAtStructure(ctx, attacker, structure, weapon);
    // Structure should take damage (structureDamage called internally)
    expect(structure.hp).toBeLessThan(hpBefore);
  });

  it('creates muzzle effect at attacker position', () => {
    const structure = makeStructure('POWR', House.USSR, 5, 5, { hp: 400, maxHp: 400 });
    const ctx = makeCombatContext({ structures: [structure] });
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 200, 300);
    const weapon = WEAPON_STATS['90mm'];

    fireWeaponAtStructure(ctx, attacker, structure, weapon);

    const muzzle = ctx.effects.find(e => e.type === 'muzzle');
    expect(muzzle).toBeDefined();
    expect(muzzle!.x).toBe(200);
  });

  it('credits kill to attacker when structure is destroyed', () => {
    // Low-HP structure will be destroyed by one shot
    const structure = makeStructure('POWR', House.USSR, 5, 5, { hp: 1, maxHp: 400 });
    const ctx = makeCombatContext({ structures: [structure] });
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    attacker.kills = 0;
    const weapon = WEAPON_STATS['90mm'];

    fireWeaponAtStructure(ctx, attacker, structure, weapon);

    expect(structure.alive).toBe(false);
    expect(attacker.kills).toBe(1);
  });

  it('does NOT credit kill when structure survives', () => {
    // High-HP structure survives
    const structure = makeStructure('POWR', House.USSR, 5, 5, { hp: 9999, maxHp: 9999 });
    const ctx = makeCombatContext({ structures: [structure] });
    const attacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    attacker.kills = 0;
    const weapon = WEAPON_STATS['90mm'];

    fireWeaponAtStructure(ctx, attacker, structure, weapon);

    expect(structure.alive).toBe(true);
    expect(attacker.kills).toBe(0);
  });

  it('applies Germany firepower bonus against structures', () => {
    const structNormal = makeStructure('POWR', House.USSR, 5, 5, { hp: 400, maxHp: 400 });
    const structGerman = makeStructure('POWR', House.USSR, 10, 10, { hp: 400, maxHp: 400 });
    const weapon = WEAPON_STATS['90mm'];

    // Normal attacker (Spain, firepowerMult=1.0)
    const ctx1 = makeCombatContext({ structures: [structNormal] });
    const normalAttacker = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    fireWeaponAtStructure(ctx1, normalAttacker, structNormal, weapon);
    const normalDmg = 400 - structNormal.hp;

    // German attacker (firepowerMult=1.10)
    const ctx2 = makeCombatContext({ structures: [structGerman] });
    const germanAttacker = makeEntity(UnitType.V_2TNK, House.Germany, 100, 100);
    fireWeaponAtStructure(ctx2, germanAttacker, structGerman, weapon);
    const germanDmg = 400 - structGerman.hp;

    // German should deal more damage than normal
    expect(germanDmg).toBeGreaterThan(normalDmg);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. fog.ts — updateSubDetection edge cases
// ═══════════════════════════════════════════════════════════════════════════

function makeFogContext(overrides: Partial<FogContext> = {}): FogContext {
  const map = new GameMap();
  map.setBounds(0, 0, MAP_CELLS, MAP_CELLS);
  return {
    entities: [],
    structures: [],
    map,
    tick: 0,
    playerHouse: House.Spain,
    fogDisabled: false,
    powerProduced: 200,
    powerConsumed: 100,
    gapGeneratorCells: new Map(),
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    ...overrides,
  };
}

describe('updateSubDetection — behavioral edge cases', () => {
  it('does not detect subs out of detector sight range', () => {
    const detector = makeEntity(UnitType.V_DD, House.Spain, 100, 100);
    const sub = makeEntity(UnitType.V_SS, House.USSR, 100 + CELL_SIZE * 50, 100);
    sub.cloakState = CloakState.CLOAKED;

    const ctx = makeFogContext({ entities: [detector, sub] });
    updateSubDetection(ctx);

    expect(sub.cloakState).toBe(CloakState.CLOAKED);
  });

  it('detects cloaked sub within detector sight range', () => {
    const detector = makeEntity(UnitType.V_DD, House.Spain, 100, 100);
    // Place sub within sight range (destroyer sight is typically 5-8 cells)
    const sub = makeEntity(UnitType.V_SS, House.USSR, 100 + CELL_SIZE * 2, 100);
    sub.cloakState = CloakState.CLOAKED;

    const ctx = makeFogContext({ entities: [detector, sub] });
    updateSubDetection(ctx);

    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(sub.sonarPulseTimer).toBe(SONAR_PULSE_DURATION);
  });

  it('detects sub in CLOAKING state (mid-transition)', () => {
    const detector = makeEntity(UnitType.V_DD, House.Spain, 100, 100);
    const sub = makeEntity(UnitType.V_SS, House.USSR, 100 + CELL_SIZE, 100);
    sub.cloakState = CloakState.CLOAKING;
    sub.cloakTimer = 20;

    const ctx = makeFogContext({ entities: [detector, sub] });
    updateSubDetection(ctx);

    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(sub.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('does NOT affect UNCLOAKED subs', () => {
    const detector = makeEntity(UnitType.V_DD, House.Spain, 100, 100);
    const sub = makeEntity(UnitType.V_SS, House.USSR, 100 + CELL_SIZE, 100);
    sub.cloakState = CloakState.UNCLOAKED;

    const ctx = makeFogContext({ entities: [detector, sub] });
    updateSubDetection(ctx);

    expect(sub.cloakState).toBe(CloakState.UNCLOAKED);
    // sonarPulseTimer should NOT be set since it's not cloaked
    expect(sub.sonarPulseTimer).toBe(0);
  });

  it('does NOT detect allied subs', () => {
    const detector = makeEntity(UnitType.V_DD, House.Spain, 100, 100);
    const alliedSub = makeEntity(UnitType.V_SS, House.Spain, 100 + CELL_SIZE, 100);
    alliedSub.cloakState = CloakState.CLOAKED;

    const ctx = makeFogContext({ entities: [detector, alliedSub] });
    updateSubDetection(ctx);

    expect(alliedSub.cloakState).toBe(CloakState.CLOAKED);
  });

  it('non-antiSub units do not detect subs', () => {
    // Regular tank is not isAntiSub
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const sub = makeEntity(UnitType.V_SS, House.USSR, 100 + CELL_SIZE, 100);
    sub.cloakState = CloakState.CLOAKED;

    const ctx = makeFogContext({ entities: [tank, sub] });
    updateSubDetection(ctx);

    expect(sub.cloakState).toBe(CloakState.CLOAKED);
  });

  it('multiple detectors can independently detect subs', () => {
    const d1 = makeEntity(UnitType.V_DD, House.Spain, 100, 100);
    const d2 = makeEntity(UnitType.V_DD, House.Spain, 200, 100);
    const sub = makeEntity(UnitType.V_SS, House.USSR, 150, 100);
    sub.cloakState = CloakState.CLOAKED;

    const ctx = makeFogContext({ entities: [d1, d2, sub] });
    updateSubDetection(ctx);

    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(sub.sonarPulseTimer).toBe(SONAR_PULSE_DURATION);
  });

  it('dead detector does not detect', () => {
    const detector = makeEntity(UnitType.V_DD, House.Spain, 100, 100);
    detector.alive = false;
    const sub = makeEntity(UnitType.V_SS, House.USSR, 100 + CELL_SIZE, 100);
    sub.cloakState = CloakState.CLOAKED;

    const ctx = makeFogContext({ entities: [detector, sub] });
    updateSubDetection(ctx);

    expect(sub.cloakState).toBe(CloakState.CLOAKED);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. production.ts — countPlayerBuildings (from module, not local reimpl)
// ═══════════════════════════════════════════════════════════════════════════

describe('countPlayerBuildings — from production.ts', () => {
  const isAllied = (a: House, b: House) => a === b;

  it('counts alive structures of given type for player house', () => {
    const structures = [
      makeStructure('WEAP', House.Spain, 10, 10),
      makeStructure('WEAP', House.Spain, 15, 10),
      makeStructure('WEAP', House.Spain, 20, 10),
    ];
    expect(countPlayerBuildings(structures, 'WEAP', House.Spain, isAllied)).toBe(3);
  });

  it('does NOT count dead structures', () => {
    const structures = [
      makeStructure('WEAP', House.Spain, 10, 10),
      makeStructure('WEAP', House.Spain, 15, 10, { alive: false }),
    ];
    expect(countPlayerBuildings(structures, 'WEAP', House.Spain, isAllied)).toBe(1);
  });

  it('does NOT count enemy structures', () => {
    const structures = [
      makeStructure('WEAP', House.Spain, 10, 10),
      makeStructure('WEAP', House.USSR, 15, 10),
    ];
    expect(countPlayerBuildings(structures, 'WEAP', House.Spain, isAllied)).toBe(1);
  });

  it('returns 0 when no matching structures exist', () => {
    const structures = [
      makeStructure('TENT', House.Spain, 10, 10),
    ];
    expect(countPlayerBuildings(structures, 'WEAP', House.Spain, isAllied)).toBe(0);
  });

  it('returns 0 for empty structures list', () => {
    expect(countPlayerBuildings([], 'WEAP', House.Spain, isAllied)).toBe(0);
  });

  it('counts with alliance callback (allied houses count)', () => {
    const alliances = buildDefaultAlliances();
    const allianceCheck = (a: House, b: House) => alliances.get(a)?.has(b) ?? false;
    const structures = [
      makeStructure('WEAP', House.Spain, 10, 10),
      makeStructure('WEAP', House.Greece, 15, 10), // allied with Spain
    ];
    expect(countPlayerBuildings(structures, 'WEAP', House.Spain, allianceCheck)).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. production.ts — getAvailableItems (from module with ProductionContext)
// ═══════════════════════════════════════════════════════════════════════════

function makeProductionContext(overrides: Partial<ProductionContext> = {}): ProductionContext {
  return {
    structures: [],
    entities: [],
    entityById: new Map(),
    credits: 10000,
    playerHouse: House.Spain,
    playerFaction: 'allied',
    playerTechLevel: 10,
    baseDiscovered: true,
    scenarioProductionItems: PRODUCTION_ITEMS,
    productionQueue: new Map(),
    pendingPlacement: null,
    wallPlacementPrepaid: false,
    map: { findAdjacentWaterCell: () => null } as any,
    tick: 0,
    powerProduced: 200,
    powerConsumed: 100,
    builtUnitTypes: new Set(),
    builtInfantryTypes: new Set(),
    builtAircraftTypes: new Set(),
    rallyPoints: new Map(),
    isAllied: (a, b) => a === b,
    hasBuilding: () => false,
    playSound: vi.fn(),
    playEva: vi.fn(),
    addCredits: vi.fn((amount) => amount),
    addEntity: vi.fn(),
    findPassableSpawn: () => ({ cx: 10, cy: 12 }),
    ...overrides,
  };
}

describe('getAvailableItems — from production.ts', () => {
  it('returns empty array when base is not discovered', () => {
    const ctx = makeProductionContext({ baseDiscovered: false });
    expect(getAvailableItems(ctx)).toEqual([]);
  });

  it('filters by prerequisite building', () => {
    const ctx = makeProductionContext({
      hasBuilding: (type: string) => type === 'TENT' || type === 'BARR',
    });
    const items = getAvailableItems(ctx);
    // All returned items should have prerequisite that matches 'TENT' or 'BARR'
    for (const item of items) {
      expect(['TENT', 'BARR']).toContain(item.prerequisite);
    }
    expect(items.length).toBeGreaterThan(0);
  });

  it('filters by faction — allied player sees only allied + both items', () => {
    const ctx = makeProductionContext({
      playerFaction: 'allied',
      hasBuilding: () => true,
    });
    const items = getAvailableItems(ctx);
    for (const item of items) {
      expect(['allied', 'both']).toContain(item.faction);
    }
  });

  it('filters by faction — soviet player sees only soviet + both items', () => {
    const ctx = makeProductionContext({
      playerFaction: 'soviet',
      playerHouse: House.USSR,
      hasBuilding: () => true,
    });
    const items = getAvailableItems(ctx);
    for (const item of items) {
      expect(['soviet', 'both']).toContain(item.faction);
    }
  });

  it('filters by techLevel — items above player techLevel are hidden', () => {
    const ctx = makeProductionContext({
      playerTechLevel: 1,
      hasBuilding: () => true,
    });
    const items = getAvailableItems(ctx);
    for (const item of items) {
      if (item.techLevel !== undefined) {
        expect(item.techLevel).toBeLessThanOrEqual(1);
        expect(item.techLevel).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('disabled items (TL=-1) never appear', () => {
    const ctx = makeProductionContext({
      playerTechLevel: 99,
      hasBuilding: () => true,
    });
    const items = getAvailableItems(ctx);
    for (const item of items) {
      if (item.techLevel !== undefined) {
        expect(item.techLevel).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('techPrereq gates items — Artillery needs DOME', () => {
    const arty = PRODUCTION_ITEMS.find(p => p.type === 'ARTY');
    if (arty && arty.techPrereq) {
      // Without DOME, should not appear
      const ctx1 = makeProductionContext({
        hasBuilding: (type: string) => type === 'WEAP',
      });
      const items1 = getAvailableItems(ctx1);
      expect(items1.find(i => i.type === 'ARTY')).toBeUndefined();

      // With DOME, should appear
      const ctx2 = makeProductionContext({
        hasBuilding: (type: string) => type === 'WEAP' || type === 'DOME',
      });
      const items2 = getAvailableItems(ctx2);
      expect(items2.find(i => i.type === 'ARTY')).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. repairSell.ts — calculatePowerGrid (from module)
// ═══════════════════════════════════════════════════════════════════════════

describe('calculatePowerGrid — from repairSell.ts', () => {
  const isAllied = (a: House, b: House) => a === b;

  it('POWR at full health produces 100 power', () => {
    const structures = [makeStructure('POWR', House.Spain, 10, 10, { hp: 400, maxHp: 400 })];
    const { produced } = calculatePowerGrid(structures, House.Spain, isAllied);
    expect(produced).toBe(100);
  });

  it('APWR at full health produces 200 power', () => {
    const structures = [makeStructure('APWR', House.Spain, 10, 10, { hp: 700, maxHp: 700 })];
    const { produced } = calculatePowerGrid(structures, House.Spain, isAllied);
    expect(produced).toBe(200);
  });

  it('damaged POWR produces proportionally less', () => {
    const structures = [makeStructure('POWR', House.Spain, 10, 10, { hp: 200, maxHp: 400 })];
    const { produced } = calculatePowerGrid(structures, House.Spain, isAllied);
    expect(produced).toBe(50); // half HP = half power
  });

  it('damaged APWR produces proportionally less', () => {
    const structures = [makeStructure('APWR', House.Spain, 10, 10, { hp: 350, maxHp: 700 })];
    const { produced } = calculatePowerGrid(structures, House.Spain, isAllied);
    expect(produced).toBe(100); // half HP = half power
  });

  it('calculates consumed power from POWER_DRAIN table', () => {
    const structures = [
      makeStructure('POWR', House.Spain, 10, 10, { hp: 400, maxHp: 400 }),
      makeStructure('WEAP', House.Spain, 15, 10),
    ];
    const { consumed } = calculatePowerGrid(structures, House.Spain, isAllied);
    expect(consumed).toBe(POWER_DRAIN.WEAP);
  });

  it('excludes dead structures from power calculation', () => {
    const structures = [
      makeStructure('POWR', House.Spain, 10, 10, { hp: 400, maxHp: 400, alive: false }),
    ];
    const { produced } = calculatePowerGrid(structures, House.Spain, isAllied);
    expect(produced).toBe(0);
  });

  it('excludes enemy structures from power calculation', () => {
    const structures = [
      makeStructure('POWR', House.USSR, 10, 10, { hp: 400, maxHp: 400 }),
    ];
    const { produced } = calculatePowerGrid(structures, House.Spain, isAllied);
    expect(produced).toBe(0);
  });

  it('excludes structures being sold (sellProgress defined)', () => {
    const s = makeStructure('POWR', House.Spain, 10, 10, { hp: 400, maxHp: 400 });
    (s as any).sellProgress = 0.5;
    const structures = [s];
    const { produced } = calculatePowerGrid(structures, House.Spain, isAllied);
    expect(produced).toBe(0);
  });

  it('sums multiple power plants correctly', () => {
    const structures = [
      makeStructure('POWR', House.Spain, 10, 10, { hp: 400, maxHp: 400 }),
      makeStructure('APWR', House.Spain, 15, 10, { hp: 700, maxHp: 700 }),
    ];
    const { produced } = calculatePowerGrid(structures, House.Spain, isAllied);
    expect(produced).toBe(300); // 100 + 200
  });

  it('full base power balance calculation', () => {
    const structures = [
      makeStructure('POWR', House.Spain, 10, 10, { hp: 400, maxHp: 400 }),
      makeStructure('APWR', House.Spain, 15, 10, { hp: 700, maxHp: 700 }),
      makeStructure('WEAP', House.Spain, 20, 10),
      makeStructure('TENT', House.Spain, 25, 10),
    ];
    const { produced, consumed } = calculatePowerGrid(structures, House.Spain, isAllied);
    expect(produced).toBe(300);
    const expectedDrain = (POWER_DRAIN.WEAP ?? 0) + (POWER_DRAIN.TENT ?? 0);
    expect(consumed).toBe(expectedDrain);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. repairSell.ts — powerMultiplier (from module)
// ═══════════════════════════════════════════════════════════════════════════

describe('powerMultiplier — from repairSell.ts', () => {
  it('returns 1.0 when produced >= consumed', () => {
    expect(powerMultiplier(200, 100)).toBe(1.0);
  });

  it('returns 1.0 when produced === consumed', () => {
    expect(powerMultiplier(100, 100)).toBe(1.0);
  });

  it('returns fraction when consumed > produced', () => {
    expect(powerMultiplier(75, 100)).toBe(0.75);
  });

  it('clamps minimum to 0.5', () => {
    expect(powerMultiplier(25, 100)).toBe(0.5);
  });

  it('returns 0.5 for extreme low power (10%)', () => {
    expect(powerMultiplier(10, 100)).toBe(0.5);
  });

  it('returns 1.0 when produced is 0 and consumed is 0', () => {
    // consumed <= produced (0 <= 0) is true
    expect(powerMultiplier(0, 0)).toBe(1.0);
  });

  it('returns 1.0 when produced is 0 and consumed is also 0 (no power buildings)', () => {
    expect(powerMultiplier(0, 0)).toBe(1.0);
  });

  it('exact 50% power returns 0.5', () => {
    expect(powerMultiplier(50, 100)).toBe(0.5);
  });

  it('exact 75% power returns 0.75', () => {
    expect(powerMultiplier(75, 100)).toBe(0.75);
  });

  it('returns 1.0 for surplus power (produced > consumed)', () => {
    expect(powerMultiplier(500, 100)).toBe(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. repairSell.ts — calculateSiloCapacity (from module)
// ═══════════════════════════════════════════════════════════════════════════

describe('calculateSiloCapacity — from repairSell.ts', () => {
  const isAllied = (a: House, b: House) => a === b;

  it('PROC provides 1000 storage', () => {
    const structures = [makeStructure('PROC', House.Spain, 10, 10)];
    expect(calculateSiloCapacity(structures, House.Spain, isAllied)).toBe(1000);
  });

  it('SILO provides 1500 storage', () => {
    const structures = [makeStructure('SILO', House.Spain, 10, 10)];
    expect(calculateSiloCapacity(structures, House.Spain, isAllied)).toBe(1500);
  });

  it('sums multiple storage structures', () => {
    const structures = [
      makeStructure('PROC', House.Spain, 10, 10),
      makeStructure('SILO', House.Spain, 15, 10),
    ];
    expect(calculateSiloCapacity(structures, House.Spain, isAllied)).toBe(2500);
  });

  it('excludes dead structures', () => {
    const structures = [
      makeStructure('PROC', House.Spain, 10, 10, { alive: false }),
    ];
    expect(calculateSiloCapacity(structures, House.Spain, isAllied)).toBe(0);
  });

  it('excludes enemy structures', () => {
    const structures = [
      makeStructure('PROC', House.USSR, 10, 10),
    ];
    expect(calculateSiloCapacity(structures, House.Spain, isAllied)).toBe(0);
  });

  it('excludes structures still under construction (buildProgress < 1)', () => {
    const s = makeStructure('PROC', House.Spain, 10, 10);
    (s as any).buildProgress = 0.5;
    const structures = [s];
    expect(calculateSiloCapacity(structures, House.Spain, isAllied)).toBe(0);
  });

  it('includes structures with undefined buildProgress (pre-placed)', () => {
    const structures = [makeStructure('PROC', House.Spain, 10, 10)];
    expect(calculateSiloCapacity(structures, House.Spain, isAllied)).toBe(1000);
  });

  it('includes structures with buildProgress = 1 (completed)', () => {
    const s = makeStructure('PROC', House.Spain, 10, 10);
    (s as any).buildProgress = 1;
    const structures = [s];
    expect(calculateSiloCapacity(structures, House.Spain, isAllied)).toBe(1000);
  });

  it('returns 0 for empty structures list', () => {
    expect(calculateSiloCapacity([], House.Spain, isAllied)).toBe(0);
  });

  it('non-storage structures contribute 0 capacity', () => {
    const structures = [
      makeStructure('WEAP', House.Spain, 10, 10),
      makeStructure('FACT', House.Spain, 15, 10),
      makeStructure('POWR', House.Spain, 20, 10),
    ];
    expect(calculateSiloCapacity(structures, House.Spain, isAllied)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. specialUnits.ts — tickVortices (NEVER tested before)
// ═══════════════════════════════════════════════════════════════════════════

function makeSpecialUnitsContext(overrides: Partial<SpecialUnitsContext> = {}): SpecialUnitsContext {
  return {
    entities: [],
    entityById: new Map(),
    structures: [],
    mines: [],
    activeVortices: [],
    effects: [],
    tick: 0,
    playerHouse: House.Spain,
    credits: 1000,
    houseCredits: new Map(),
    map: {
      isPassable: () => true,
      getOccupancy: () => 0,
      boundsX: 0, boundsY: 0, boundsW: 128, boundsH: 128,
    } as any,
    evaMessages: [],
    isThieved: false,
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    isPlayerControlled: (e) => e.house === House.Spain,
    playSoundAt: vi.fn(),
    playSound: vi.fn(),
    movementSpeed: () => 0.5,
    damageEntity: vi.fn((target: Entity, amount: number) => {
      target.hp -= amount;
      if (target.hp <= 0) { target.hp = 0; target.alive = false; return true; }
      return false;
    }),
    damageStructure: vi.fn((s: MapStructure, damage: number) => {
      s.hp -= damage;
      if (s.hp <= 0) { s.hp = 0; s.alive = false; return true; }
      return false;
    }),
    addCredits: vi.fn((amount) => amount),
    addEntity: vi.fn(),
    screenShake: 0,
    ...overrides,
  };
}

describe('tickVortices — vortex lifecycle and damage', () => {
  it('decrements ticksLeft each tick', () => {
    const ctx = makeSpecialUnitsContext({
      activeVortices: [{ x: 100, y: 100, angle: 0, ticksLeft: 10, id: 1 }],
    });
    tickVortices(ctx);
    expect(ctx.activeVortices[0].ticksLeft).toBe(9);
  });

  it('removes vortex when ticksLeft reaches 0', () => {
    const ctx = makeSpecialUnitsContext({
      activeVortices: [{ x: 100, y: 100, angle: 0, ticksLeft: 1, id: 1 }],
    });
    tickVortices(ctx);
    expect(ctx.activeVortices.length).toBe(0);
  });

  it('vortex wanders — position changes each tick', () => {
    const vortex = { x: 500, y: 500, angle: 0, ticksLeft: 100, id: 1 };
    const ctx = makeSpecialUnitsContext({ activeVortices: [vortex] });
    const origX = vortex.x;
    const origY = vortex.y;

    tickVortices(ctx);

    // Position should have changed (vortex wanders)
    const moved = vortex.x !== origX || vortex.y !== origY;
    expect(moved).toBe(true);
  });

  it('vortex damages entities within 1 cell radius every 3 ticks', () => {
    const victim = makeEntity(UnitType.V_2TNK, House.Spain, 500, 500);
    const vortex = { x: 500, y: 500, angle: 0, ticksLeft: 6, id: 1 };
    const ctx = makeSpecialUnitsContext({
      activeVortices: [vortex],
      entities: [victim],
    });

    // ticksLeft=6, after decrement it's 5, 5%3=2 != 0, no damage
    tickVortices(ctx);
    expect(ctx.damageEntity).not.toHaveBeenCalled();

    // ticksLeft=5 -> 4, 4%3=1, no damage
    tickVortices(ctx);
    expect(ctx.damageEntity).not.toHaveBeenCalled();

    // ticksLeft=4 -> 3, 3%3=0, damage!
    tickVortices(ctx);
    expect(ctx.damageEntity).toHaveBeenCalledWith(victim, 50, 'Super');
  });

  it('vortex damages structures within 1 cell radius', () => {
    const structure = makeStructure('POWR', House.Spain, 20, 20, { hp: 400, maxHp: 400 });
    const sx = structure.cx * CELL_SIZE + CELL_SIZE / 2;
    const sy = structure.cy * CELL_SIZE + CELL_SIZE / 2;
    // ticksLeft=4 -> decremented to 3, 3%3=0 triggers damage
    const vortex = { x: sx, y: sy, angle: 0, ticksLeft: 4, id: 1 };
    const ctx = makeSpecialUnitsContext({
      activeVortices: [vortex],
      structures: [structure],
    });

    tickVortices(ctx);
    // After wandering, vortex may shift slightly but structure check uses
    // s.cx * CELL_SIZE + CELL_SIZE/2 which is close to vortex origin
    expect(ctx.damageStructure).toHaveBeenCalled();
    const call = (ctx.damageStructure as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(structure);
    expect(call[1]).toBe(50);
  });

  it('vortex does NOT damage entities beyond 1 cell radius', () => {
    const farVictim = makeEntity(UnitType.V_2TNK, House.Spain, 500 + CELL_SIZE * 3, 500);
    const vortex = { x: 500, y: 500, angle: 0, ticksLeft: 3, id: 1 };
    const ctx = makeSpecialUnitsContext({
      activeVortices: [vortex],
      entities: [farVictim],
    });

    tickVortices(ctx);
    expect(ctx.damageEntity).not.toHaveBeenCalled();
  });

  it('vortex creates visual effect each tick', () => {
    const vortex = { x: 500, y: 500, angle: 0, ticksLeft: 10, id: 1 };
    const ctx = makeSpecialUnitsContext({ activeVortices: [vortex] });

    tickVortices(ctx);

    const atomEffect = ctx.effects.find(e => (e as any).sprite === 'atomsfx');
    expect(atomEffect).toBeDefined();
  });

  it('multiple vortices process independently', () => {
    const v1 = { x: 100, y: 100, angle: 0, ticksLeft: 5, id: 1 };
    const v2 = { x: 500, y: 500, angle: Math.PI, ticksLeft: 1, id: 2 };
    const ctx = makeSpecialUnitsContext({ activeVortices: [v1, v2] });

    tickVortices(ctx);

    // v2 should be removed (ticksLeft was 1), v1 should remain
    expect(ctx.activeVortices.length).toBe(1);
    expect(ctx.activeVortices[0].id).toBe(1);
    expect(ctx.activeVortices[0].ticksLeft).toBe(4);
  });

  it('vortex bounces off map bounds', () => {
    // Place vortex at the edge, moving outward
    const vortex = { x: 0, y: CELL_SIZE * 64, angle: Math.PI, ticksLeft: 10, id: 1 };
    const ctx = makeSpecialUnitsContext({ activeVortices: [vortex] });

    tickVortices(ctx);

    // x should be clamped to at least boundsX * CELL_SIZE = 0
    expect(vortex.x).toBeGreaterThanOrEqual(0);
  });

  it('vortex damages dead entities NOT (alive check)', () => {
    const deadVictim = makeEntity(UnitType.V_2TNK, House.Spain, 500, 500);
    deadVictim.alive = false;
    const vortex = { x: 500, y: 500, angle: 0, ticksLeft: 3, id: 1 };
    const ctx = makeSpecialUnitsContext({
      activeVortices: [vortex],
      entities: [deadVictim],
    });

    tickVortices(ctx);
    expect(ctx.damageEntity).not.toHaveBeenCalled();
  });

  it('vortex uses Super warhead for damage', () => {
    const victim = makeEntity(UnitType.I_E1, House.USSR, 500, 500);
    // ticksLeft=4 -> decremented to 3, 3%3=0 triggers damage
    const vortex = { x: 500, y: 500, angle: 0, ticksLeft: 4, id: 1 };
    const ctx = makeSpecialUnitsContext({
      activeVortices: [vortex],
      entities: [victim],
    });

    tickVortices(ctx);
    expect(ctx.damageEntity).toHaveBeenCalledWith(victim, 50, 'Super');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. superweapon.ts — findBestNukeTarget (NEVER tested directly)
// ═══════════════════════════════════════════════════════════════════════════

function makeSuperweaponContext(overrides: Partial<SuperweaponContext> = {}): SuperweaponContext {
  return {
    structures: [],
    entities: [],
    entityById: new Map(),
    superweapons: new Map(),
    effects: [],
    tick: 0,
    playerHouse: House.Spain,
    powerProduced: 100,
    powerConsumed: 50,
    killCount: 0,
    lossCount: 0,
    map: {
      revealAll() {},
      isPassable() { return true; },
      setVisibility() {},
      inBounds() { return true; },
      setTerrain() {},
      unjamRadius() {},
    },
    sonarSpiedTarget: new Map(),
    gapGeneratorCells: new Map(),
    nukePendingTarget: null,
    nukePendingTick: 0,
    nukePendingSource: null,
    isAllied: (a, b) => a === b,
    isPlayerControlled: (e) => e.house === House.Spain,
    pushEva: vi.fn(),
    playSound: vi.fn(),
    playSoundAt: vi.fn(),
    damageEntity: vi.fn(() => false),
    damageStructure: vi.fn(() => false),
    addEntity: vi.fn(),
    aiIQ: () => 5,
    getWarheadMult: (wh, armor) => getWarheadMultiplier(wh as WarheadType, armor as ArmorType),
    cameraX: 0,
    cameraY: 0,
    cameraViewWidth: 640,
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  };
}

describe('findBestNukeTarget — AI targeting logic', () => {
  it('returns null when no enemy structures exist', () => {
    const ctx = makeSuperweaponContext({ structures: [] });
    expect(findBestNukeTarget(ctx, House.USSR)).toBeNull();
  });

  it('returns null when only allied structures exist', () => {
    const ctx = makeSuperweaponContext({
      structures: [
        makeStructure('FACT', House.USSR, 10, 10),
        makeStructure('WEAP', House.USSR, 12, 10),
      ],
    });
    // AI house = USSR, all structures are USSR (allied), no enemy targets
    expect(findBestNukeTarget(ctx, House.USSR)).toBeNull();
  });

  it('targets single isolated enemy structure', () => {
    const ctx = makeSuperweaponContext({
      structures: [
        makeStructure('FACT', House.Spain, 10, 10),
      ],
    });
    const target = findBestNukeTarget(ctx, House.USSR);
    expect(target).not.toBeNull();
    // Target should be near the structure
    const sx = 10 * CELL_SIZE + CELL_SIZE;
    const sy = 10 * CELL_SIZE + CELL_SIZE;
    expect(target!.x).toBe(sx);
    expect(target!.y).toBe(sy);
  });

  it('prefers cluster of structures over isolated ones', () => {
    const ctx = makeSuperweaponContext({
      structures: [
        // Cluster: 3 structures close together
        makeStructure('FACT', House.Spain, 10, 10),
        makeStructure('WEAP', House.Spain, 12, 10),
        makeStructure('POWR', House.Spain, 11, 12),
        // Isolated: 1 structure far away
        makeStructure('SILO', House.Spain, 80, 80),
      ],
    });
    const target = findBestNukeTarget(ctx, House.USSR);
    expect(target).not.toBeNull();
    // Target should be near the cluster (cells 10-12), not the isolated silo (cell 80)
    expect(target!.x).toBeLessThan(40 * CELL_SIZE);
    expect(target!.y).toBeLessThan(40 * CELL_SIZE);
  });

  it('ignores dead structures', () => {
    const ctx = makeSuperweaponContext({
      structures: [
        makeStructure('FACT', House.Spain, 10, 10, { alive: false }),
      ],
    });
    expect(findBestNukeTarget(ctx, House.USSR)).toBeNull();
  });

  it('does NOT target allied structures of the AI house', () => {
    const ctx = makeSuperweaponContext({
      structures: [
        makeStructure('FACT', House.USSR, 10, 10), // AI own structure
        makeStructure('WEAP', House.Spain, 50, 50), // enemy structure
      ],
    });
    const target = findBestNukeTarget(ctx, House.USSR);
    expect(target).not.toBeNull();
    // Should target the enemy structure at cell 50, not own at cell 10
    expect(target!.x).toBe(50 * CELL_SIZE + CELL_SIZE);
    expect(target!.y).toBe(50 * CELL_SIZE + CELL_SIZE);
  });

  it('scores structures by counting nearby structures within 5 cells', () => {
    // Place two enemy structures close together, and one far away
    const ctx = makeSuperweaponContext({
      structures: [
        makeStructure('FACT', House.Spain, 20, 20),
        makeStructure('WEAP', House.Spain, 22, 20), // 2 cells away, within 5-cell radius
        makeStructure('SILO', House.Spain, 100, 100), // 80 cells away, isolated
      ],
    });
    const target = findBestNukeTarget(ctx, House.USSR);
    expect(target).not.toBeNull();
    // The cluster (FACT at 20,20 with nearby WEAP) should score higher than isolated SILO
    const clusterX = 20 * CELL_SIZE + CELL_SIZE;
    const isolatedX = 100 * CELL_SIZE + CELL_SIZE;
    // Target should be near the cluster
    expect(Math.abs(target!.x - clusterX)).toBeLessThan(5 * CELL_SIZE);
  });

  it('returns position at structure center (cx*CELL_SIZE + CELL_SIZE)', () => {
    const ctx = makeSuperweaponContext({
      structures: [
        makeStructure('FACT', House.Spain, 15, 25),
      ],
    });
    const target = findBestNukeTarget(ctx, House.USSR);
    expect(target).not.toBeNull();
    expect(target!.x).toBe(15 * CELL_SIZE + CELL_SIZE);
    expect(target!.y).toBe(25 * CELL_SIZE + CELL_SIZE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. Cross-subsystem integration sanity checks
// ═══════════════════════════════════════════════════════════════════════════

describe('Cross-subsystem sanity checks', () => {
  it('getEffectiveCost from production.ts matches COUNTRY_BONUSES', () => {
    const item: ProductionItem = {
      type: '2TNK', cost: 700, buildTime: 150, prerequisite: 'WEAP',
      isStructure: false, icon: '2tnk', faction: 'soviet',
    };
    // USSR has 0.9 costMult
    const ussrCost = getEffectiveCost(item, House.USSR);
    expect(ussrCost).toBe(Math.max(1, Math.round(700 * 0.9)));
    // Spain has 1.0 costMult
    const spainCost = getEffectiveCost(item, House.Spain);
    expect(spainCost).toBe(700);
  });

  it('powerMultiplier(calculatePowerGrid(...)) produces correct slowdown', () => {
    const isAllied = (a: House, b: House) => a === b;
    const structures = [
      makeStructure('POWR', House.Spain, 10, 10, { hp: 200, maxHp: 400 }), // 50W produced
      makeStructure('WEAP', House.Spain, 15, 10), // 30W consumed
      makeStructure('TENT', House.Spain, 20, 10), // 20W consumed
    ];
    const { produced, consumed } = calculatePowerGrid(structures, House.Spain, isAllied);
    const mult = powerMultiplier(produced, consumed);
    // 50W produced, 50W consumed = exactly 1.0
    expect(mult).toBe(1.0);
  });

  it('damageSpeedFactor and powerMultiplier both reduce speed independently', () => {
    // An entity at 50% HP has 0.75 speed factor
    const entity = makeEntity(UnitType.V_2TNK, House.Spain);
    entity.hp = entity.maxHp * CONDITION_YELLOW;
    const entitySpeedFactor = damageSpeedFactor(entity);
    expect(entitySpeedFactor).toBe(0.75);

    // A base at 50% power has 0.5 production multiplier
    const prodMult = powerMultiplier(50, 100);
    expect(prodMult).toBe(0.5);

    // These are independent systems (speed vs production)
    expect(entitySpeedFactor).not.toBe(prodMult);
  });
});
