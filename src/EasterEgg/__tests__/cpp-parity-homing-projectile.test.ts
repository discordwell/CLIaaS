/**
 * C++ parity for BulletClass homing flight.
 *
 * BulletClass stores two distinct coordinates:
 * - FuseClass::HeadTo: the possibly scattered impact/fuse coordinate.
 * - TarCom: the target used by ROT homing to update PrimaryFacing.
 */
import { describe, expect, it } from 'vitest';

import {
  type CombatContext,
  type InflightProjectile,
  updateInflightProjectiles,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  House,
  WEAPON_STATS,
} from '../engine/types';

function makeCombatCtx(projectile: InflightProjectile): CombatContext {
  return {
    entities: [],
    entityById: new Map(),
    structures: [],
    inflightProjectiles: [projectile],
    effects: [],
    logicAnims: [],
    tick: 172,
    playerHouse: House.GoodGuy,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    pointTotal: 0,
    alliedUnitsLost: 0,
    sovietUnitsLost: 0,
    alliedBuildingsLost: 0,
    sovietBuildingsLost: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set(),
    map: new GameMap(),
    aiStates: new Map(),
    lastBaseAttackEva: -1,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    powerConsumed: 0,
    powerProduced: 0,
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    isPlayerControlled: (e) => e.house === House.GoodGuy,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    movementSpeed: () => 20,
    getFirepowerBias: () => 1,
    getArmorBias: () => 1,
    getROFBias: () => 1,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '#fff',
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
  } as CombatContext;
}

function maverick(overrides: Partial<InflightProjectile>): InflightProjectile {
  return {
    attackerId: 1,
    targetId: -1,
    weapon: WEAPON_STATS.Maverick,
    damage: 50,
    strength: 50,
    speed: 76,
    travelFrames: 20,
    currentFrame: 15,
    directHit: true,
    impactX: 924.75,
    impactY: 1188.84375,
    attackerIsPlayer: false,
    isArcing: false,
    arcHeight: 0,
    arcRiser: 0,
    startX: 900,
    startY: 1100,
    dogRiderId: -1,
    fuelTimer: 5,
    isFueled: true,
    isDropping: false,
    dropHeight: 0,
    isFlameEquipped: false,
    flameToggle: false,
    logicalLX: 9867,
    logicalLY: 12651,
    headToLX: 9864,
    headToLY: 12681,
    homingTargetLX: 9736,
    homingTargetLY: 12488,
    facing256: 121,
    desiredFacing256: 126,
    speedAccum: 0,
    speedAdd: 76,
    fuseTimer: 5,
    armingTimer: 0,
    proximity: 50,
    ...overrides,
  };
}

describe('C++ parity: homing projectile flight', () => {
  it('rotates a HeatSeeker toward TarCom before physics while the fuse still checks HeadTo', () => {
    const projectile = maverick({});
    const ctx = makeCombatCtx(projectile);

    updateInflightProjectiles(ctx);

    expect(ctx.inflightProjectiles).toHaveLength(1);
    expect(projectile.currentFrame).toBe(16);
    expect(projectile.facing256).toBe(126);
    expect(projectile.proximity).toBe(42);
  });
});
