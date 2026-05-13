/**
 * C++ parity for aircraft Fire_At projectile launch scatter.
 *
 * Aircraft fire through TechnoClass::Fire_At in C++, so BulletClass::Unlimbo
 * applies the same inaccurate projectile target adjustment as ground weapons.
 */
import { describe, expect, it } from 'vitest';

import {
  fireWeaponAtCoord,
  type CombatContext,
} from '../engine/combat';
import { Entity } from '../engine/entity';
import {
  CELL_SIZE,
  House,
  LEPTON_SIZE,
  UnitType,
  WEAPON_STATS,
} from '../engine/types';
import { ScenarioRandom } from '../engine/random';

function makeCombatCtx(attacker: Entity): CombatContext {
  return {
    entities: [attacker],
    entityById: new Map([[attacker.id, attacker]]),
    structures: [],
    inflightProjectiles: [],
    effects: [],
    logicAnims: [],
    tick: 136,
    playerHouse: House.GoodGuy,
    scenarioId: 'SCU12EA',
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
    map: {} as CombatContext['map'],
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

function leptonWorld(lx: number, ly: number): { x: number; y: number } {
  return {
    x: lx * CELL_SIZE / LEPTON_SIZE,
    y: ly * CELL_SIZE / LEPTON_SIZE,
  };
}

describe('C++ parity: aircraft projectile launch scatter', () => {
  it('Maverick coordinate shots consume BulletClass::Unlimbo scatter RNG before the next mission jitter', () => {
    const mig = new Entity(UnitType.V_MIG, House.BadGuy, 0, 0);
    mig.leptonX = 9935;
    mig.leptonY = 10897;
    mig.syncPosFromLeptons();
    mig.facing256 = 129;
    mig.turretFacing256 = 129;
    mig.desiredFacing256 = 129;
    mig.desiredTurretFacing256 = 129;
    mig.prevPos = { ...mig.pos };

    const ctx = makeCombatCtx(mig);
    const target = leptonWorld(9864, 11912);

    ScenarioRandom.seed = 98720251;
    ScenarioRandom._tagLogging = true;
    ScenarioRandom._seedLog = [];
    ScenarioRandom._sourceTag = 40001;

    mig.isSecondShot = false;
    fireWeaponAtCoord(ctx, mig, WEAPON_STATS.Maverick, target);
    mig.isSecondShot = true;
    fireWeaponAtCoord(ctx, mig, WEAPON_STATS.Maverick, target);

    expect(ScenarioRandom.seed >>> 0).toBe(4210203351);
    expect(ScenarioRandom._seedLog.map(([seed]) => seed)).toEqual([
      3421305368,
      2393504881,
      2041649750,
      4210203351,
    ]);
    expect(ctx.inflightProjectiles).toHaveLength(2);
    expect(ctx.inflightProjectiles[0].headToLY).not.toBe(11912);

    ScenarioRandom._tagLogging = false;
    ScenarioRandom._seedLog = [];
  });
});
