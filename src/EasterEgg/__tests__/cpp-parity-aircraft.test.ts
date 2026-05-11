/**
 * C++ Behavioral Parity: Aircraft Combat
 *
 * Tests verify fixed-wing attack runs and AA targeting behavior match
 * C++ RA source code. Each describe block documents the C++ source
 * reference (file:line).
 *
 * Observable outcomes: HP changes, state transitions, ammo counts,
 * fire events, targeting decisions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, Dir, CELL_SIZE, COUNTRY_BONUSES,
  Mission, AnimState, buildDefaultAlliances,
  UNIT_STATS, WEAPON_STATS, worldDist, directionTo,
  LEPTON_SIZE, leptonDist, MPH_TO_PX,
  COS_TABLE_256, SIN_TABLE_256, pixelToLepton, coordTargetRoundTripLepton,
} from '../engine/types';
import { Entity, resetEntityIds, dir256ToFacing8, dir256ToFacing32 } from '../engine/entity';
import {
  type AircraftContext,
  updateFixedWingAttackRun,
  updateAircraft,
  TICKS_PER_SECOND,
} from '../engine/aircraft';
import {
  type CombatContext,
  damageSpeedFactor,
  setStructureTurretDesired,
  updateStructureCombat,
  updateInflightProjectiles,
} from '../engine/combat';
import {
  STRUCTURE_WEAPONS,
  type MapStructure,
} from '../engine/scenario';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';
import { ScenarioRandom } from '../engine/random';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

const HUNT_FLY_TO_TARGET = 2;
const HUNT_DROP_BOMBS = 3;
const HUNT_REGROUP = 4;

function setFixedWingAttackPhase(entity: Entity, phase: Entity['attackRunPhase']): void {
  entity.attackRunPhase = phase;
  entity.aircraftAttackStatus =
    phase === 'dropBombs' ? HUNT_DROP_BOMBS :
    phase === 'regroup' ? HUNT_REGROUP :
    HUNT_FLY_TO_TARGET;
}

function setLeptonPos(entity: Entity, lx: number, ly: number): void {
  entity.leptonX = lx;
  entity.leptonY = ly;
  entity.syncPosFromLeptons();
}

function setAircraftFacing256(entity: Entity, facing256: number): void {
  const dir = facing256 & 0xff;
  entity.facing256 = dir;
  entity.desiredFacing256 = dir;
  entity.bodyFacing256 = dir;
  entity.facing = dir256ToFacing8(dir);
  entity.desiredFacing = entity.facing;
  entity.bodyFacing32 = dir256ToFacing32(dir);
  entity.turretFacing256 = dir;
  entity.desiredTurretFacing256 = dir;
  entity.turretFacing = entity.facing;
  entity.desiredTurretFacing = entity.facing;
  entity.turretFacing32 = dir256ToFacing32(dir);
}

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeAircraftCtx(overrides: Partial<AircraftContext> = {}): AircraftContext {
  return {
    structures: [],
    map: new GameMap(),
    unitsLeftMap: 0,
    civiliansEvacuated: 0,
    isAllied: (a: House, b: House) => a === b,
    movementSpeed: () => 2,
    idleMission: () => Mission.GUARD,
    fireWeaponAt: vi.fn(),
    fireWeaponAtStructure: vi.fn(),
    fireWeaponAtCoord: vi.fn(),
    getROFBias: () => 1.0,
    getPowerFraction: () => 1.0,
    ...overrides,
  };
}

function makeCombatCtx(
  structures: MapStructure[] = [],
  entities: Entity[] = [],
): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    inflightProjectiles: [],
    logicAnims: [],
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
    movementSpeed: () => 2,
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

function makeDefenseStructure(
  type: string, house: House, cx: number, cy: number, facing: number = 2,
): MapStructure {
  const weapon = STRUCTURE_WEAPONS[type];
  const TURRETED = new Set(['GUN', 'SAM', 'AGUN']);
  const isTurreted = TURRETED.has(type);
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: 256, maxHp: 256, alive: true, rubble: false,
    weapon,
    attackCooldown: 0,
    ammo: weapon ? 2 : -1,
    maxAmmo: weapon ? 2 : -1,
    ...(isTurreted ? { turretDir: facing, desiredTurretDir: facing, firingFlash: 0 } : {}),
  };
}

function alignStructureToTarget(s: MapStructure, target: Entity): void {
  setStructureTurretDesired(s, target);
  s.turretFacing256 = s.desiredTurretFacing256;
  s.turretDir = s.desiredTurretDir;
  s.turretRotAccum = 0;
}

function resolveProjectiles(ctx: CombatContext): void {
  for (let i = 0; i < 20 && ctx.inflightProjectiles.length > 0; i++) {
    updateInflightProjectiles(ctx);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fixed-Wing Attack Run (aircraft.cpp Mission_Hunt)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fixed-wing facing requirement (aircraft.cpp FIRE_FACING)', () => {
  it('runs LOOK_FOR_TARGET and TAKE_OFF before the first fixed-wing attack check', () => {
    const fireWeaponAtCoord = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAtCoord });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';

    updateFixedWingAttackRun(ctx, yak);
    expect(yak.aircraftAttackStatus).toBe(1); // TAKE_OFF
    expect(fireWeaponAtCoord).not.toHaveBeenCalled();

    updateFixedWingAttackRun(ctx, yak);
    expect(yak.aircraftAttackStatus).toBe(HUNT_FLY_TO_TARGET);
    expect(fireWeaponAtCoord).not.toHaveBeenCalled();

    updateFixedWingAttackRun(ctx, yak);
    expect(yak.aircraftAttackStatus).toBe(HUNT_DROP_BOMBS);
    expect(fireWeaponAtCoord).not.toHaveBeenCalled();

    updateFixedWingAttackRun(ctx, yak);
    expect(fireWeaponAtCoord).toHaveBeenCalledTimes(2);
  });

  it('uses a team ATT_WAYPT coordinate as fixed-wing TarCom instead of returning', () => {
    const ctx = makeAircraftCtx({ movementSpeed: () => 2 });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 22 * CELL_SIZE, 96 * CELL_SIZE);
    yak.flightAltitude = 24;
    yak.mission = Mission.ATTACK;
    yak.aircraftState = 'flying';
    yak.moveTarget = { lx: 16008, ly: 25992 };
    yak.target = null;
    yak.targetStructure = null;

    updateAircraft(ctx, yak);

    expect(yak.aircraftState).toBe('attacking');
    expect(yak.aircraftAttackStatus).toBe(1); // TAKE_OFF
    expect(yak.mission).toBe(Mission.ATTACK);
    expect(yak.moveTarget).toEqual({ lx: 16008, ly: 25992 });
  });

  it('fixed-wing Mission_Hunt keeps empty-cell TarCom legal through attack-run dispatch', () => {
    const ctx = makeAircraftCtx({ movementSpeed: () => 2 });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 22 * CELL_SIZE, 96 * CELL_SIZE);
    yak.flightAltitude = 24;
    yak.mission = Mission.ATTACK;
    yak.aircraftState = 'attacking';
    yak.moveTarget = { lx: 16008, ly: 25992 };
    yak.target = null;
    yak.targetStructure = null;

    updateFixedWingAttackRun(ctx, yak);

    expect(yak.aircraftState).toBe('attacking');
    expect(yak.aircraftAttackStatus).toBe(1); // TAKE_OFF
    expect(yak.mission).toBe(Mission.ATTACK);
  });

  it('damaged fixed-wing aircraft keep full FlyClass speed', () => {
    const ctx = makeAircraftCtx({
      movementSpeed: e => e.stats.speed * MPH_TO_PX * damageSpeedFactor(e),
    });
    const setupYak = (hp: number) => {
      const yak = makeEntity(UnitType.V_YAK, House.USSR, 100, 100);
      yak.hp = hp;
      yak.maxHp = 60;
      yak.mission = Mission.ATTACK;
      yak.aircraftState = 'attacking';
      yak.missionTimer = 1;
      yak.moveTarget = { lx: 12000, ly: 10000 };
      yak.aircraftSpeedFraction = 1.0;
      yak.speedAccum = 0;
      setLeptonPos(yak, 10000, 10000);
      setAircraftFacing256(yak, 64);
      setFixedWingAttackPhase(yak, 'flyToTarget');
      return yak;
    };

    const healthy = setupYak(60);
    const damaged = setupYak(30);
    const startHealthyLX = healthy.leptonX;
    const startDamagedLX = damaged.leptonX;

    updateFixedWingAttackRun(ctx, healthy);
    updateFixedWingAttackRun(ctx, damaged);

    const healthyDelta = healthy.leptonX - startHealthyLX;
    const damagedDelta = damaged.leptonX - startDamagedLX;
    expect(healthyDelta).toBeGreaterThan(35);
    expect(damagedDelta).toBe(healthyDelta);
  });

  it('fires when facing is aligned with target (diff=0)', () => {
    const fireWeaponAtCoord = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAtCoord });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    // Target due North — default facing is N
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 3 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'dropBombs');
    yak.attackCooldown = 0;

    updateFixedWingAttackRun(ctx, yak);

    expect(fireWeaponAtCoord).toHaveBeenCalledTimes(2);
  });

  it('fires when facing is off by 8 DirType units (~11°)', () => {
    const fireWeaponAtCoord = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAtCoord });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing256 = 8;
    yak.desiredFacing256 = 8;
    yak.bodyFacing256 = 8;
    // Target due North; C++ AircraftClass::Can_Fire allows diff <= 8.
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 3 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'dropBombs');
    yak.attackCooldown = 0;

    updateFixedWingAttackRun(ctx, yak);

    expect(fireWeaponAtCoord).toHaveBeenCalledTimes(2);
  });

  it('does NOT fire when facing is off by more than 8 DirType units', () => {
    const fireWeaponAtCoord = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAtCoord });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing256 = 16;
    yak.desiredFacing256 = 16;
    yak.bodyFacing256 = 16;
    // Target due North; diff=16 fails C++ AircraftClass::Can_Fire.
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 3 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'dropBombs');
    yak.attackCooldown = 0;

    updateFixedWingAttackRun(ctx, yak);

    expect(fireWeaponAtCoord).not.toHaveBeenCalled();
  });

  it('keeps moving forward while waiting for facing alignment in flyToTarget', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    // Target due South — facing diff = 4 (opposite direction)
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 + 2 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'flyToTarget');
    const posBefore = { ...yak.pos };

    updateFixedWingAttackRun(ctx, yak);

    // Aircraft must keep moving (fixed-wing can't stop)
    const moved = yak.pos.x !== posBefore.x || yak.pos.y !== posBefore.y;
    expect(moved).toBe(true);
    // Should still be in flyToTarget (facing not aligned yet)
    expect(yak.attackRunPhase).toBe('flyToTarget');
  });

  it('transitions from flyToTarget to dropBombs when facing aligns in range', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    // Target due North, close enough to be in weapon range
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'flyToTarget');

    updateFixedWingAttackRun(ctx, yak);

    expect(yak.attackRunPhase).toBe('dropBombs');
  });

  it('uses aircraft Fire_Coord offsets and lepton Height for the fixed-wing range gate', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 100, 100);
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    setLeptonPos(yak, 19078, 16227);
    setLeptonPos(enemy, 18048, 15488);
    setAircraftFacing256(yak, 214);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'flyToTarget');
    yak.attackCooldown = 0;
    yak.flightAltitude = Entity.FLIGHT_ALTITUDE;

    const range = WEAPON_STATS.ChainGun.range * LEPTON_SIZE;
    expect(leptonDist(yak.leptonX, yak.leptonY, enemy.leptonX, enemy.leptonY)).toBeGreaterThan(range);
    expect(yak.fireCoordForWeapon(yak.weapon)).toEqual({ lx: 19034, ly: 15984 });
    expect(leptonDist(19034, 15984, enemy.leptonX, enemy.leptonY)).toBeLessThanOrEqual(range);

    updateFixedWingAttackRun(ctx, yak);

    expect(yak.attackRunPhase).toBe('dropBombs');
    expect(yak.aircraftAttackStatus).toBe(HUNT_DROP_BOMBS);
  });

  it('keeps DROP_BOMBS after the successful shot that spends the last ammo', () => {
    const fireWeaponAtCoord = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAtCoord });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'dropBombs');
    yak.attackCooldown = 0;
    yak.ammo = 2;

    updateFixedWingAttackRun(ctx, yak);

    expect(fireWeaponAtCoord).toHaveBeenCalledTimes(2);
    expect(yak.ammo).toBe(0);
    expect(yak.attackRunPhase).toBe('dropBombs');
    expect(yak.aircraftAttackStatus).toBe(HUNT_DROP_BOMBS);
    expect(yak.missionTimer).toBe(2);
  });

  it('ParaBomb fixed-wing firing uses C++ parachute facing fudge of 16 DirType units', () => {
    const fireWeaponAtCoord = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAtCoord });
    const badr = makeEntity(UnitType.V_BADR, House.USSR, 0, 0);
    badr.weapon = WEAPON_STATS.ParaBomb;
    badr.mission = Mission.ATTACK;
    badr.aircraftState = 'attacking';
    setFixedWingAttackPhase(badr, 'dropBombs');
    setLeptonPos(badr, 10175, 26349);
    setAircraftFacing256(badr, 78);
    badr.moveTarget = { lx: 10376, ly: 26504 };
    badr.attackCooldown = 0;
    badr.ammo = 2;

    updateFixedWingAttackRun(ctx, badr);

    expect(fireWeaponAtCoord).toHaveBeenCalledTimes(1);
    expect(badr.attackRunPhase).toBe('dropBombs');
    expect(badr.aircraftAttackStatus).toBe(HUNT_DROP_BOMBS);
    expect(badr.ammo).toBe(1);
  });

  it('REGROUP dispatch consumes Mission_Hunt jitter and assigns ENTER when an airfield is available', () => {
    const ctx = makeAircraftCtx({
      structures: [makeDefenseStructure('AFLD', House.USSR, 5, 5)],
    });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    const team = { remove: vi.fn((e: Entity) => { e.teamRef = null; }) };
    yak.target = enemy;
    yak.teamRef = team;
    yak.mission = Mission.ATTACK;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'regroup');
    yak.attackCooldown = 0;
    yak.ammo = 0;
    ScenarioRandom.seed = 1778541872;
    ScenarioRandom._sourceTag = 0;

    updateFixedWingAttackRun(ctx, yak);

    expect(team.remove).toHaveBeenCalledWith(yak);
    expect(ScenarioRandom.seed).toBe(1358554537);
    expect(yak.mission).toBe(Mission.ENTER);
    expect(yak.aircraftState).toBe('returning');
    expect(yak.aircraftAttackStatus).toBe(0);
    expect(yak.missionTimer).toBe(14);
    expect(yak.target).toBe(enemy);
  });
});

describe('Fixed-wing multi-shot per pass (aircraft.cpp continuous fire)', () => {
  it('aims non-homing fixed-wing shots through the C++ coordinate target round-trip', () => {
    const fireWeaponAt = vi.fn();
    const fireWeaponAtCoord = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAt, fireWeaponAtCoord });
    const yak = makeEntity(UnitType.V_YAK, House.USSR);
    setLeptonPos(yak, 15320, 25876);
    setAircraftFacing256(yak, 67);
    yak.turretFacing256 = 68;
    yak.desiredTurretFacing256 = 68;

    const enemy = makeEntity(UnitType.V_2TNK, House.Spain);
    const targetRange = 512;
    const targetLX = yak.leptonX + ((COS_TABLE_256[67] * targetRange) >> 7);
    const targetLY = yak.leptonY - ((SIN_TABLE_256[67] * targetRange) >> 7);
    setLeptonPos(enemy, targetLX, targetLY);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'dropBombs');
    yak.attackCooldown = 0;
    const startLX = yak.leptonX;
    const startLY = yak.leptonY;

    updateFixedWingAttackRun(ctx, yak);

    expect(fireWeaponAt).not.toHaveBeenCalled();
    expect(fireWeaponAtCoord).toHaveBeenCalledTimes(2);
    const [, , impact] = fireWeaponAtCoord.mock.calls[0];
    const distance = Math.trunc(WEAPON_STATS.ChainGun.range * LEPTON_SIZE) - 0x0200;
    const rawLX = startLX + ((COS_TABLE_256[68] * distance) >> 7);
    const rawLY = startLY - ((SIN_TABLE_256[68] * distance) >> 7);
    const expectedLX = coordTargetRoundTripLepton(rawLX);
    const expectedLY = coordTargetRoundTripLepton(rawLY);
    const primaryFacingLY = startLY - ((SIN_TABLE_256[67] * distance) >> 7);
    expect(pixelToLepton(impact.x)).toBe(expectedLX);
    expect(pixelToLepton(impact.y)).toBe(expectedLY);
    expect(pixelToLepton(impact.y)).not.toBe(coordTargetRoundTripLepton(primaryFacingLY));
  });

  it('matches the C++ fixed-wing ChainGun coordinate target quantization near a splash threshold', () => {
    const fireWeaponAtCoord = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAtCoord });
    const yak = makeEntity(UnitType.V_YAK, House.USSR);
    setLeptonPos(yak, 17525, 14914);
    setAircraftFacing256(yak, 99);
    yak.turretFacing256 = 99;
    yak.desiredTurretFacing256 = 99;

    const jeep = makeEntity(UnitType.V_JEEP, House.Spain);
    setLeptonPos(jeep, 18048, 15488);
    yak.target = jeep;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'dropBombs');
    yak.attackCooldown = 0;

    updateFixedWingAttackRun(ctx, yak);

    const [, , impact] = fireWeaponAtCoord.mock.calls[0];
    expect(pixelToLepton(impact.x)).toBe(18024);
    expect(pixelToLepton(impact.y)).toBe(15496);
  });

  it('fires multiple times across ticks in dropBombs phase (ChainGun ROF=3)', () => {
    const fireWeaponAtCoord = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAtCoord });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    // Target in range but far enough N that yak doesn't fly past immediately.
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 4 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'dropBombs');
    yak.attackCooldown = 0;

    // Simulate multiple ticks — should fire whenever cooldown expires
    let fireCount = 0;
    for (let tick = 0; tick < 20; tick++) {
      fireWeaponAtCoord.mockClear();
      if (yak.attackCooldown > 0) yak.attackCooldown--;
      if (yak.attackRunPhase !== 'dropBombs') break;
      updateFixedWingAttackRun(ctx, yak);
      if (fireWeaponAtCoord.mock.calls.length > 0) fireCount++;
    }

    // ChainGun ROF=3, so in 20 ticks should fire multiple times
    expect(fireCount).toBeGreaterThanOrEqual(3);
  });

  it('decrements ammo on each shot', () => {
    const fireWeaponAtCoord = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAtCoord });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 4 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'dropBombs');
    yak.attackCooldown = 0;
    const ammoBefore = yak.ammo;

    updateFixedWingAttackRun(ctx, yak);

    expect(yak.ammo).toBe(ammoBefore - 2);
  });

  it('does not transition to REGROUP on the same dispatch that spends the last ammo', () => {
    const fireWeaponAtCoord = vi.fn();
    const ctx = makeAircraftCtx({ fireWeaponAtCoord });
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 4 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'dropBombs');
    yak.attackCooldown = 0;
    yak.ammo = 1; // last shot

    updateFixedWingAttackRun(ctx, yak);

    expect(fireWeaponAtCoord).toHaveBeenCalledTimes(2);
    expect(yak.ammo).toBe(0);
    expect(yak.attackRunPhase).toBe('dropBombs');
    expect(yak.aircraftAttackStatus).toBe(HUNT_DROP_BOMBS);
  });
});

describe('Fixed-wing anti-circle breaker (aircraft.cpp 2s delay)', () => {
  it('uses a two-second mission delay when in range without facing alignment', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    // Target due South — opposite direction, in range but can never align
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 + 2 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'flyToTarget');
    yak.circleBreakTimer = 0;

    updateFixedWingAttackRun(ctx, yak);

    expect(yak.attackRunPhase).toBe('flyToTarget');
    expect(yak.missionTimer).toBe(TICKS_PER_SECOND * 2 - 1);
  });

  it('uses the normal half-second dispatch delay when target is out of range', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.facing = Dir.N;
    // Target far away — out of range
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 + 20 * CELL_SIZE);
    yak.target = enemy;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'flyToTarget');
    yak.circleBreakTimer = 25; // almost triggering

    updateFixedWingAttackRun(ctx, yak);

    expect(yak.attackRunPhase).toBe('flyToTarget');
    expect(yak.missionTimer).toBe(Math.floor(TICKS_PER_SECOND / 2) - 1);
  });
});

describe('Fixed-wing regroup & re-engage (aircraft.cpp REGROUP)', () => {
  it('REGROUP with ammo remaining re-enters LOOK_FOR_TARGET and consumes Mission_Hunt jitter', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    yak.target = enemy;
    yak.ammo = 5;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'regroup');
    ScenarioRandom.seed = 1778541872;
    ScenarioRandom._sourceTag = 0;

    updateFixedWingAttackRun(ctx, yak);

    expect(ScenarioRandom.seed).toBe(1358554537);
    expect(yak.aircraftAttackStatus).toBe(0);
    expect(yak.attackRunPhase).toBe('flyToTarget');
    expect(yak.missionTimer).toBe(14);
  });

  it('re-engages (flyToTarget) when ammo > 0 and target alive', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    yak.target = enemy;
    yak.ammo = 5;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'regroup');

    // Run until regroup completes
    for (let i = 0; i < 100; i++) {
      if (yak.attackRunPhase !== 'regroup') break;
      updateFixedWingAttackRun(ctx, yak);
    }

    expect(yak.attackRunPhase).toBe('flyToTarget');
  });

  it('assigns RETREAT when ammo = 0 after regroup and no airfield is available', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    yak.target = enemy;
    yak.ammo = 0;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'regroup');
    ScenarioRandom.seed = 1778541872;
    ScenarioRandom._sourceTag = 0;

    updateFixedWingAttackRun(ctx, yak);

    expect(ScenarioRandom.seed).toBe(1358554537);
    expect(yak.aircraftState).toBe('flying');
    expect(yak.mission).toBe(Mission.RETREAT);
  });

  it('RTBs when target dies during regroup', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    yak.target = enemy;
    yak.ammo = 5;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'regroup');

    // Kill target mid-regroup
    enemy.alive = false;

    for (let i = 0; i < 100; i++) {
      if (yak.aircraftState !== 'attacking') break;
      updateFixedWingAttackRun(ctx, yak);
    }

    expect(yak.aircraftState).toBe('returning');
  });

  it('target lost during flyToTarget → RTB', () => {
    const ctx = makeAircraftCtx();
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 200, 200);
    yak.target = null;
    yak.targetStructure = null;
    yak.aircraftState = 'attacking';
    setFixedWingAttackPhase(yak, 'flyToTarget');

    updateFixedWingAttackRun(ctx, yak);

    expect(yak.aircraftState).toBe('returning');
    expect(yak.mission).toBe(Mission.GUARD);
  });
});

describe('Both MiG and Yak use fixed-wing attack path', () => {
  it('MiG transitions through flyToTarget → dropBombs when aligned', () => {
    const ctx = makeAircraftCtx();
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 200, 200);
    mig.facing = Dir.N;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200 - 2 * CELL_SIZE);
    mig.target = enemy;
    mig.aircraftState = 'attacking';
    setFixedWingAttackPhase(mig, 'flyToTarget');

    updateFixedWingAttackRun(ctx, mig);

    expect(mig.attackRunPhase).toBe('dropBombs');
  });

  it('MiG and Yak both have isFixedWing = true', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    const yak = makeEntity(UnitType.V_YAK, House.USSR);
    expect(mig.isFixedWing).toBe(true);
    expect(yak.isFixedWing).toBe(true);
  });

  it('Helicopters do NOT use fixed-wing attack path', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    const hind = makeEntity(UnitType.V_HIND, House.USSR);
    expect(heli.isFixedWing).toBe(false);
    expect(hind.isFixedWing).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AA Targeting (combat.cpp, techno.cpp, building.cpp)
// ═══════════════════════════════════════════════════════════════════════════════
//
// C++ gate (building.cpp): non-AA structures skip airborne aircraft.
// AA structures (SAM, AGUN) can target airborne aircraft and prefer them.
// combat.cpp: IsAntiAir property on weapon controls targeting gate.

describe('Structure AA targeting (building.cpp AA gate)', () => {

  it('SAM fires at airborne aircraft', () => {
    const sam = makeDefenseStructure('SAM', House.USSR, 10, 10, 2);
    const mig = entityAtCell(UnitType.V_MIG, House.Spain, 12, 10);
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE; // airborne
    alignStructureToTarget(sam, mig);
    const hpBefore = mig.hp;

    const ctx = makeCombatCtx([sam], [mig]);
    updateStructureCombat(ctx);
    resolveProjectiles(ctx);

    expect(mig.hp).toBeLessThan(hpBefore);
  });

  it('AGUN fires at airborne aircraft', () => {
    const agun = makeDefenseStructure('AGUN', House.USSR, 10, 10);
    const heli = entityAtCell(UnitType.V_HELI, House.Spain, 11, 10);
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    alignStructureToTarget(agun, heli);
    const hpBefore = heli.hp;

    const ctx = makeCombatCtx([agun], [heli]);
    updateStructureCombat(ctx);
    resolveProjectiles(ctx);

    expect(heli.hp).toBeLessThan(hpBefore);
  });

  it('GUN does NOT fire at airborne aircraft (no isAntiAir)', () => {
    const gun = makeDefenseStructure('GUN', House.USSR, 10, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.Spain, 11, 10);
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const hpBefore = mig.hp;

    const ctx = makeCombatCtx([gun], [mig]);
    updateStructureCombat(ctx);

    expect(mig.hp).toBe(hpBefore); // GUN can't target airborne
  });

  it('PBOX does NOT fire at airborne aircraft (no isAntiAir)', () => {
    const pbox = makeDefenseStructure('PBOX', House.USSR, 10, 10);
    const hind = entityAtCell(UnitType.V_HIND, House.Spain, 11, 10);
    hind.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const hpBefore = hind.hp;

    const ctx = makeCombatCtx([pbox], [hind]);
    updateStructureCombat(ctx);

    expect(hind.hp).toBe(hpBefore); // PBOX can't target airborne
  });

  it('TSLA does NOT fire at airborne aircraft (no isAntiAir)', () => {
    const tsla = makeDefenseStructure('TSLA', House.USSR, 10, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.Spain, 11, 10);
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const hpBefore = mig.hp;

    const ctx = makeCombatCtx([tsla], [mig]);
    updateStructureCombat(ctx);

    expect(mig.hp).toBe(hpBefore);
  });

  it('GUN fires at grounded aircraft (altitude=0, AA gate only checks altitude>0)', () => {
    const gun = makeDefenseStructure('GUN', House.USSR, 10, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.Spain, 11, 10);
    mig.flightAltitude = 0; // grounded
    alignStructureToTarget(gun, mig);
    const hpBefore = mig.hp;

    const ctx = makeCombatCtx([gun], [mig]);
    updateStructureCombat(ctx);

    expect(mig.hp).toBeLessThan(hpBefore); // GUN CAN target grounded aircraft
  });
});

describe('AA target preference (building.cpp AA override)', () => {
  it('SAM prefers airborne aircraft over ground units', () => {
    // MiG at (12,11) from SAM at (10,10) = SE direction (3), pre-align turret
    const sam = makeDefenseStructure('SAM', House.USSR, 10, 10, 3);
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 11, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.Spain, 12, 11);
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE;
    alignStructureToTarget(sam, mig);

    const tankHpBefore = tank.hp;
    const migHpBefore = mig.hp;
    const ctx = makeCombatCtx([sam], [tank, mig]);
    updateStructureCombat(ctx);
    resolveProjectiles(ctx);

    // SAM should have targeted the airborne MiG, not the tank
    expect(mig.hp).toBeLessThan(migHpBefore);
    expect(tank.hp).toBe(tankHpBefore);
  });
});

describe('AA coverage of all aircraft types', () => {
  const aircraftTypes: [string, UnitType][] = [
    ['MiG (fixed-wing)', UnitType.V_MIG],
    ['Yak (fixed-wing)', UnitType.V_YAK],
    ['Longbow (helicopter)', UnitType.V_HELI],
    ['Hind (helicopter)', UnitType.V_HIND],
    ['Chinook (transport)', UnitType.V_TRAN],
  ];

  for (const [name, type] of aircraftTypes) {
    it(`SAM can target airborne ${name}`, () => {
      const sam = makeDefenseStructure('SAM', House.USSR, 10, 10, 2);
      const aircraft = entityAtCell(type, House.Spain, 12, 10);
      aircraft.flightAltitude = Entity.FLIGHT_ALTITUDE;
      alignStructureToTarget(sam, aircraft);
      const hpBefore = aircraft.hp;

      const ctx = makeCombatCtx([sam], [aircraft]);
      updateStructureCombat(ctx);
      resolveProjectiles(ctx);

      expect(aircraft.hp).toBeLessThan(hpBefore);
    });
  }

  for (const [name, type] of aircraftTypes) {
    it(`GUN cannot target airborne ${name}`, () => {
      const gun = makeDefenseStructure('GUN', House.USSR, 10, 10);
      const aircraft = entityAtCell(type, House.Spain, 11, 10);
      aircraft.flightAltitude = Entity.FLIGHT_ALTITUDE;
      const hpBefore = aircraft.hp;

      const ctx = makeCombatCtx([gun], [aircraft]);
      updateStructureCombat(ctx);

      expect(aircraft.hp).toBe(hpBefore);
    });
  }
});
