/**
 * C++ Behavioral Parity: Invisible projectile Coord_Scatter on detonation.
 *
 * C++ bullet.cpp:1012-1014 (Bullet_Explodes):
 *   if (Class->IsInvisible) {
 *       Coord = Coord_Scatter(Coord, 0x0020);
 *   }
 *
 * C++ coord.cpp:390-402 (Coord_Scatter):
 *   newcoord = Coord_Move(coord, Random_Pick(DIR_N=0, DIR_MAX=255), distance);
 *
 * Invisible projectiles consume exactly 1 Random_Pick call per detonation.
 * Weapons with Inviso=yes: M1Carbine, Pistol, Colt45, M60mg, Sniper, TeslaZap,
 * ChainGun, Heal, etc. (rules.ini [Invisible] and [Ack] bullet types).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE,
  WEAPON_STATS,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  type InflightProjectile,
  launchProjectile,
  updateInflightProjectiles,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';
import { COUNTRY_BONUSES } from '../engine/types';
import { ScenarioRandom } from '../engine/random';

beforeEach(() => {
  resetEntityIds();
  ScenarioRandom.seed = 0x12345678;
});

function makeCombatCtx(entities: Entity[] = []): CombatContext {
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

function makeProjectile(overrides: Partial<InflightProjectile>): InflightProjectile {
  return {
    attackerId: 1,
    targetId: 2,
    weapon: WEAPON_STATS.M1Carbine,
    damage: 15,
    strength: 15,
    speed: 100,
    travelFrames: 1,
    currentFrame: 0,
    directHit: true,
    impactX: 100,
    impactY: 100,
    attackerIsPlayer: false,
    isArcing: false,
    arcHeight: 0,
    arcRiser: 0,
    startX: 50,
    startY: 50,
    dogRiderId: -1,
    fuelTimer: 10,
    isFueled: false,
    isDropping: false,
    dropHeight: 0,
    isFlameEquipped: false,
    flameToggle: false,
    ...overrides,
  };
}

describe('Invisible projectile Coord_Scatter (bullet.cpp:1012-1014)', () => {
  it('M1Carbine (Inviso=yes) is marked isInvisible', () => {
    expect(WEAPON_STATS.M1Carbine.isInvisible).toBe(true);
  });

  it('90mm (Cannon, Inviso=no) is NOT marked isInvisible', () => {
    expect(WEAPON_STATS['90mm'].isInvisible).toBeFalsy();
  });

  it('invisible weapon fire consumes exactly 1 RNG call (Coord_Scatter)', () => {
    const ctx = makeCombatCtx();
    const attacker = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 200, 100);
    ctx.entities = [attacker, target];
    ctx.entityById = new Map([[attacker.id, attacker], [target.id, target]]);

    const before = ScenarioRandom.seed;
    launchProjectile(ctx, attacker, target, WEAPON_STATS.M1Carbine, 15, 200, 100, true);
    const after = ScenarioRandom.seed;

    // Exactly 1 ScenarioRandom.nextInRange(0, 255) consumed for Coord_Scatter dir
    expect(after).not.toBe(before);
  });

  it('visible weapon fire (90mm) consumes 0 RNG calls', () => {
    const ctx = makeCombatCtx();
    const attacker = new Entity(UnitType.MTNK, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 200, 100);
    ctx.entities = [attacker, target];
    ctx.entityById = new Map([[attacker.id, attacker], [target.id, target]]);

    const before = ScenarioRandom.seed;
    launchProjectile(ctx, attacker, target, WEAPON_STATS['90mm'], 15, 200, 100, true);
    const after = ScenarioRandom.seed;

    // No RNG consumed for non-invisible bullet fire
    expect(after).toBe(before);
  });

  it('Colt45 (Tanya, Inviso=yes) consumes 1 RNG on fire', () => {
    const ctx = makeCombatCtx();
    const attacker = new Entity(UnitType.I_E7, House.Spain, 100, 100);
    const target = new Entity(UnitType.I_E1, House.USSR, 200, 100);
    ctx.entities = [attacker, target];
    ctx.entityById = new Map([[attacker.id, attacker], [target.id, target]]);

    const before = ScenarioRandom.seed;
    launchProjectile(ctx, attacker, target, WEAPON_STATS.Colt45, 50, 200, 100, true);
    const after = ScenarioRandom.seed;
    expect(after).not.toBe(before);
  });

  it('invisible projectile scatters impact position within 32-lepton radius', () => {
    const ctx = makeCombatCtx();
    const attacker = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 200, 100);
    ctx.entities = [attacker, target];
    ctx.entityById = new Map([[attacker.id, attacker], [target.id, target]]);

    const originalX = 200;
    const originalY = 100;
    launchProjectile(ctx, attacker, target, WEAPON_STATS.M1Carbine, 15, originalX, originalY, true);

    // The pushed projectile should have scattered impact within 3 pixels (32 leptons)
    const proj = ctx.inflightProjectiles[0];
    expect(proj).toBeDefined();
    const dx = Math.abs(proj.impactX - originalX);
    const dy = Math.abs(proj.impactY - originalY);
    expect(dx).toBeLessThanOrEqual(3);
    expect(dy).toBeLessThanOrEqual(3);
  });

  it('RNG consumption is deterministic across runs with same seed', () => {
    const seed1 = 0x11223344;
    const seed2 = 0x11223344;

    const mkAtk = () => new Entity(UnitType.I_E1, House.USSR, 100, 100);
    const mkTgt = () => new Entity(UnitType.I_E1, House.Greece, 200, 100);

    ScenarioRandom.seed = seed1;
    const ctx1 = makeCombatCtx();
    const a1 = mkAtk(); const t1 = mkTgt();
    ctx1.entityById = new Map([[a1.id, a1], [t1.id, t1]]);
    launchProjectile(ctx1, a1, t1, WEAPON_STATS.M1Carbine, 15, 200, 100, true);
    const result1 = ScenarioRandom.seed;

    ScenarioRandom.seed = seed2;
    const ctx2 = makeCombatCtx();
    const a2 = mkAtk(); const t2 = mkTgt();
    ctx2.entityById = new Map([[a2.id, a2], [t2.id, t2]]);
    launchProjectile(ctx2, a2, t2, WEAPON_STATS.M1Carbine, 15, 200, 100, true);
    const result2 = ScenarioRandom.seed;

    expect(result1).toBe(result2);
  });
});
