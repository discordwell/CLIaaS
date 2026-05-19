/**
 * Mission AI Behavioral Tests — direct invocation of exported functions
 * from missionAI.ts with mock MissionAIContext objects.
 *
 * Functions tested:
 *   updateGuard, updateAttack, updateHunt, updateRetreat,
 *   updateAreaGuard, updateAmbush, updateRepairMission,
 *   orderTransportEvacuate, updateAttackStructure,
 *   updateForceFireGround
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, Mission, AnimState, CELL_SIZE, LEPTON_SIZE, Stance, Dir,
  UNIT_STATS, WEAPON_STATS, CONDITION_RED,
  type WarheadType, type ArmorType,
  WARHEAD_VS_ARMOR, WARHEAD_META, WARHEAD_PROPS,
  COUNTRY_BONUSES,
  worldDist, worldToCell, buildDefaultAlliances, directionToLeptons256,
  pixelToLepton, leptonToCell, coordTargetRoundTripLepton,
} from '../engine/types';
import {
  Entity, resetEntityIds, CloakState, setPlayerHouses,
  dir256ToFacing8, dir256ToFacing32,
} from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import { STRUCTURE_MAX_HP, structureTargetLeptons as scenarioStructureTargetLeptons } from '../engine/scenario';
import type { Effect } from '../engine/renderer';
import type { MissionAIContext } from '../engine/missionAI';
import { ScenarioRandom } from '../engine/random';
import {
  updateGuard, updateAttack, updateHunt, updateRetreat,
  updateAreaGuard, updateAmbush, updateRepairMission,
  orderTransportEvacuate, updateAttackStructure,
  updateForceFireGround,
} from '../engine/missionAI';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  resetEntityIds();
  setPlayerHouses(new Set([House.Spain, House.Greece]));
});

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

function advanceInfantryFirePrep(ctx: MissionAIContext, entity: Entity): void {
  ctx.tick++;
  entity.advanceDoingStage(ctx.tick);
  updateAttack(ctx, entity);
}

function advanceInfantryForceFirePrep(ctx: MissionAIContext, entity: Entity): void {
  ctx.tick++;
  entity.advanceDoingStage(ctx.tick);
  updateForceFireGround(ctx, entity);
}

function advanceInfantryForceFireUntil(
  ctx: MissionAIContext,
  entity: Entity,
  launched: () => boolean,
  maxTicks = 80,
): void {
  for (let i = 0; i < maxTicks && !launched(); i++) {
    advanceInfantryForceFirePrep(ctx, entity);
  }
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

function makeMockContext(overrides: Partial<MissionAIContext> = {}): MissionAIContext {
  const map = new GameMap();
  // Set bounds to a generous 50x50 area starting at (10,10)
  map.setBounds(10, 10, 50, 50);
  const alliances = buildDefaultAlliances();

  return {
    entities: [],
    structures: [],
    effects: [] as Effect[],
    logicAnims: [],
    map,
    tick: 100,
    playerHouse: House.Spain,
    killCount: 0,
    evaMessages: [],
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},

    // Alliance / ownership
    isAllied: (a, b) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a, b) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e) => alliances.get(e.house)?.has(House.Spain) ?? false,

    // Movement / speed
    movementSpeed: () => 2,

    // Sound
    playSoundAt: vi.fn(),
    playEva: vi.fn(),
    playSound: vi.fn(),
    weaponSound: vi.fn(() => 'gun5'),

    // Combat delegation
    damageEntity: vi.fn(() => false),
    damageStructure: vi.fn(() => false),
    triggerRetaliation: vi.fn(),
    handleUnitDeath: vi.fn(),
    launchProjectile: vi.fn(),
    deferInvisibleScatter: vi.fn(),
    applySplashDamage: vi.fn(),

    // Warhead helpers
    getFirepowerBias: (house: House) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
    getArmorBias: (house: House) => COUNTRY_BONUSES[house]?.armorMult ?? 1.0,
    getROFBias: () => 1.0,
    getWarheadMult: (wh: WarheadType, ar: ArmorType) => {
      const idx = { none: 0, wood: 1, light: 2, heavy: 3, concrete: 4 }[ar] ?? 0;
      return WARHEAD_VS_ARMOR[wh]?.[idx] ?? 1.0;
    },
    getWarheadMeta: (wh: WarheadType) => WARHEAD_META[wh] ?? { spreadFactor: 1, wallDestroy: false, woodDestroy: false, iceDestroy: false, deformsTerrain: false },
    getWarheadProps: (wh) => WARHEAD_PROPS[wh as string] as any,
    warheadMuzzleColor: () => '255,200,60',
    weaponProjectileStyle: () => 'bullet',

    // Mission helpers
    idleMission: () => Mission.GUARD,
    retreatFromTarget: vi.fn(),
    threatScore: (_scanner, _target, dist) => 1000 - dist,

    // Special unit delegation
    updateDemoTruck: vi.fn(),
    updateMedic: vi.fn(),
    updateMechanicUnit: vi.fn(),
    updateTanyaC4: vi.fn(),
    updateThief: vi.fn(),
    spyDisguise: vi.fn(),
    spyInfiltrate: vi.fn(),

    // Minimap alert
    minimapAlert: vi.fn(),
    isRevealedToHouse: () => true,

    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. updateGuard
// ═══════════════════════════════════════════════════════════════════════════

describe('updateGuard', () => {
  it('entity in GUARD with no enemies nearby stays idle', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.GUARD;
    entity.lastGuardScan = 0; // ensure scan fires
    const ctx = makeMockContext({ entities: [entity] });

    updateGuard(ctx, entity);

    expect(entity.mission).toBe(Mission.GUARD);
    expect(entity.animState).toBe(AnimState.IDLE);
  });

  it('dog in GUARD auto-engages nearby enemy within scan range', () => {
    // C++ FootClass::Mission_Guard → Target_Something_Nearby(THREAT_RANGE).
    // Per techno.cpp:2013-2026, only DOGS / MEDICS / MECHANICS get type bits added to
    // the scan mask; regular infantry get mask=0 → Evaluate_Object rejects everything
    // → scan is a no-op. Regular-unit auto-engage in GUARD happens via retaliation or
    // explicit orders. This test uses a DOG to exercise the in-range scan path.
    const player = makeEntity(UnitType.I_DOG, House.Spain, 300, 300);
    player.mission = Mission.GUARD;
    player.lastGuardScan = 0;

    const enemy = makeEntity(UnitType.I_E1, House.USSR, 330, 300);
    // Place enemy close enough (~1.25 cells; well within dog guardRange=7)
    const ctx = makeMockContext({ entities: [player, enemy] });

    updateGuard(ctx, player);

    // C++ parity: guard fires inline via Firing_AI then restores GUARD — unit never
    // leaves GUARD mission. Target stays set for subsequent Firing_AI ticks.
    expect(player.mission).toBe(Mission.GUARD);
    expect(player.target).toBe(enemy);
  });

  it('vessel in GUARD keeps guard mission when acquiring a structure target', () => {
    // C++ FootClass::Mission_Guard calls Target_Something_Nearby, which assigns
    // TarCom only. VesselClass::AI then runs Combat_AI/Firing_AI while the mission
    // remains GUARD; SCG12EA's England cruiser against France V19 follows this path.
    const cruiser = makeEntity(UnitType.V_CA, House.England, 30 * CELL_SIZE, 30 * CELL_SIZE);
    cruiser.mission = Mission.GUARD;
    cruiser.attackCooldown = 0;

    const target = makeStructure('APWR', House.USSR, 32, 30);
    const ctx = makeMockContext({
      entities: [cruiser],
      structures: [target],
      isDiscoveredStructureByPlayer: (s) => s === target,
    });

    updateGuard(ctx, cruiser, /*timerFired=*/ true);

    expect(cruiser.mission).toBe(Mission.GUARD);
    expect(cruiser.target).toBeNull();
    expect(cruiser.targetStructure).toBe(target);
  });

  it('vessel in GUARD keeps an existing in-range structure target instead of rescanning', () => {
    // C++ Target_Something_Nearby first checks an existing TarCom and returns
    // true when it is still in range. It does not clear a building TarCom just
    // because the new Greatest_Threat scan would not rediscover that structure.
    const cruiser = makeEntity(UnitType.V_CA, House.England, 30 * CELL_SIZE, 30 * CELL_SIZE);
    cruiser.mission = Mission.GUARD;
    cruiser.targetStructure = makeStructure('V19', House.France, 32, 30);

    const ctx = makeMockContext({
      entities: [cruiser],
      structures: [cruiser.targetStructure],
      isDiscoveredStructureByPlayer: () => false,
    });

    updateGuard(ctx, cruiser, /*timerFired=*/ true);

    expect(cruiser.mission).toBe(Mission.GUARD);
    expect(cruiser.targetStructure).toBe(ctx.structures[0]);
  });

  it('civilian in GUARD flees from nearby enemy', () => {
    // Place civilian well within map bounds so flee clamping doesn't interfere
    const civ = makeEntity(UnitType.I_C1, House.Spain, 35 * CELL_SIZE, 35 * CELL_SIZE);
    civ.mission = Mission.GUARD;
    civ.lastGuardScan = 0;

    // Place ant to the WEST of the civilian so flee direction is EAST (positive x)
    const ant = makeEntity(UnitType.ANT1, House.USSR, 33 * CELL_SIZE, 35 * CELL_SIZE);
    const ctx = makeMockContext({ entities: [civ, ant] });

    updateGuard(ctx, civ);

    // Civilian should be set to MOVE (fleeing) with a moveTarget
    expect(civ.mission).toBe(Mission.MOVE);
    expect(civ.moveTarget).not.toBeNull();
    // Flee direction should be away from the ant (positive x direction)
    expect(civ.moveTarget!.lx).toBeGreaterThan(civ.leptonX);
  });

  it('entity does not engage allies', () => {
    const player1 = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    player1.mission = Mission.GUARD;
    player1.lastGuardScan = 0;

    const ally = makeEntity(UnitType.I_E1, House.Greece, 330, 300);
    const ctx = makeMockContext({ entities: [player1, ally] });

    updateGuard(ctx, player1);

    expect(player1.mission).toBe(Mission.GUARD);
    expect(player1.target).toBeNull();
  });

  it('entity in HOLD_FIRE stance does not auto-engage', () => {
    const player = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    player.mission = Mission.GUARD;
    player.stance = Stance.HOLD_FIRE;
    player.lastGuardScan = 0;

    const enemy = makeEntity(UnitType.I_E1, House.USSR, 330, 300);
    const ctx = makeMockContext({ entities: [player, enemy] });

    updateGuard(ctx, player);

    expect(player.mission).toBe(Mission.GUARD);
    expect(player.target).toBeNull();
  });

  it('harvester does not auto-engage in guard mode', () => {
    const harv = makeEntity(UnitType.V_HARV, House.Spain, 300, 300);
    harv.mission = Mission.GUARD;
    harv.lastGuardScan = 0;

    const enemy = makeEntity(UnitType.I_E1, House.USSR, 330, 300);
    const ctx = makeMockContext({ entities: [harv, enemy] });

    updateGuard(ctx, harv);

    expect(harv.mission).toBe(Mission.GUARD);
    expect(harv.target).toBeNull();
  });
});

describe('updateAttack projectile fire gates', () => {
  it('slow infantry projectiles run CellClass::Incoming on the target cell after Fire_At', () => {
    const grenadier = makeEntity(
      UnitType.I_E2,
      House.USSR,
      20 * CELL_SIZE + CELL_SIZE / 2,
      20 * CELL_SIZE + CELL_SIZE / 2,
    );
    const target = makeEntity(
      UnitType.I_E1,
      House.Greece,
      22 * CELL_SIZE + CELL_SIZE / 2,
      20 * CELL_SIZE + CELL_SIZE / 2,
    );
    grenadier.mission = Mission.ATTACK;
    grenadier.attackCooldown = 0;
    grenadier.target = target;

    const incomingThreatScatterCell = vi.fn();
    const ctx = makeMockContext({
      entities: [grenadier, target],
      incomingThreatScatterCell,
      incomingProjectileSpeed: 10,
    });
    ScenarioRandom.seed = 0x12345678;

    updateAttack(ctx, grenadier);
    for (let i = 0; i < 20 && !(ctx.launchProjectile as any).mock.calls.length; i++) {
      advanceInfantryFirePrep(ctx, grenadier);
    }

    expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
    expect(incomingThreatScatterCell).toHaveBeenCalledTimes(1);
    expect(incomingThreatScatterCell).toHaveBeenCalledWith(
      target.cell.cx,
      target.cell.cy,
      grenadier,
    );
  });

  it('does not run CellClass::Incoming when scenario [General] resets Incoming to zero', () => {
    const grenadier = makeEntity(
      UnitType.I_E2,
      House.USSR,
      20 * CELL_SIZE + CELL_SIZE / 2,
      20 * CELL_SIZE + CELL_SIZE / 2,
    );
    const target = makeEntity(
      UnitType.I_E1,
      House.Greece,
      22 * CELL_SIZE + CELL_SIZE / 2,
      20 * CELL_SIZE + CELL_SIZE / 2,
    );
    grenadier.mission = Mission.ATTACK;
    grenadier.attackCooldown = 0;
    grenadier.target = target;

    const incomingThreatScatterCell = vi.fn();
    const ctx = makeMockContext({
      entities: [grenadier, target],
      incomingThreatScatterCell,
      incomingProjectileSpeed: 0,
    });
    ScenarioRandom.seed = 0x12345678;

    updateAttack(ctx, grenadier);
    for (let i = 0; i < 20 && !(ctx.launchProjectile as any).mock.calls.length; i++) {
      advanceInfantryFirePrep(ctx, grenadier);
    }

    expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
    expect(incomingThreatScatterCell).not.toHaveBeenCalled();
  });

  it('launches projectile weapons even when armor reduces final damage to zero', () => {
    const shooter = makeEntity(UnitType.I_C7, House.Spain, 10 * CELL_SIZE + CELL_SIZE / 2, 10 * CELL_SIZE + CELL_SIZE / 2);
    const harvester = makeEntity(UnitType.V_HARV, House.USSR, 11 * CELL_SIZE + CELL_SIZE / 2, 10 * CELL_SIZE + CELL_SIZE / 2);
    shooter.mission = Mission.ATTACK;
    shooter.target = harvester;
    shooter.ammo = 10;
    shooter.weapon = WEAPON_STATS.Pistol;
    shooter.firePrepActive = true;
    shooter.firePrepStage = 2;
    shooter.firePrepUsesDoingStage = false;

    const ctx = makeMockContext({ entities: [shooter, harvester] });

    updateAttack(ctx, shooter);

    expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
    expect(ctx.damageEntity).not.toHaveBeenCalled();
    expect(shooter.target).toBe(harvester);
    expect(shooter.ammo).toBe(9);
  });

  it('does not create projectile impact AnimClass at fire time for projSpeed weapons', () => {
    const shooter = makeEntity(UnitType.I_C7, House.USSR, 10 * CELL_SIZE + CELL_SIZE / 2, 10 * CELL_SIZE + CELL_SIZE / 2);
    const target = makeEntity(UnitType.I_E1, House.Greece, 12 * CELL_SIZE + CELL_SIZE / 2, 10 * CELL_SIZE + CELL_SIZE / 2);
    shooter.mission = Mission.ATTACK;
    shooter.target = target;
    shooter.attackCooldown = 0;
    shooter.weapon = WEAPON_STATS.Sniper;
    shooter.firePrepActive = true;
    shooter.firePrepStage = 8;
    shooter.firePrepUsesDoingStage = false;

    const ctx = makeMockContext({ entities: [shooter, target] });

    updateAttack(ctx, shooter);

    expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
    expect(ctx.logicAnims.some(anim => anim.type === 'art-exp1')).toBe(false);
    expect(ctx.effects.some(effect => effect.type === 'explosion' && effect.sprite === 'art-exp1')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. updateAttack
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAttack', () => {
  it('entity with no target switches to GUARD', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;
    entity.target = null;

    const ctx = makeMockContext({ entities: [entity] });
    updateAttack(ctx, entity);

    expect(entity.mission).toBe(Mission.GUARD);
    expect(entity.animState).toBe(AnimState.IDLE);
  });

  it('entity with dead target switches to GUARD', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;

    const deadTarget = makeEntity(UnitType.I_E1, House.USSR, 330, 300);
    deadTarget.alive = false;
    entity.target = deadTarget;

    const ctx = makeMockContext({ entities: [entity, deadTarget] });
    updateAttack(ctx, entity);

    expect(entity.mission).toBe(Mission.GUARD);
    expect(entity.target).toBeNull();
  });

  it('entity moves toward target if out of range', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;

    // E1 has M1Carbine with range 3.0 cells = 72px; place enemy at ~10 cells
    const enemy = makeEntity(UnitType.I_E1, House.USSR, 540, 300);
    entity.target = enemy;

    const ctx = makeMockContext({ entities: [entity, enemy] });
    updateAttack(ctx, entity);

    // C++ Firing_AI does not move infantry directly. It marks the unit as
    // walking; the mission/Movement_AI path advances position later.
    expect(entity.animState).toBe(AnimState.WALK);
    expect(entity.pos.x).toBe(300);
  });

  it('entity fires when in range (instant-hit weapon)', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;
    entity.attackCooldown = 0;

    // Place enemy within M1Carbine range (3.0 cells = 72px)
    const enemy = makeEntity(UnitType.I_E1, House.USSR, 340, 300);
    entity.target = enemy;
    // Face the right direction to avoid rotation delay
    entity.facing = 2; // East
    entity.desiredFacing = 2;

    const ctx = makeMockContext({ entities: [entity, enemy] });
    // C++ InfantryClass::Firing_AI FireLaunch gate (infantry.cpp:3651): E1 FireLaunch=2.
    // First updateAttack starts firing animation (Stage=0) — bullet does NOT launch yet.
    updateAttack(ctx, entity);
    expect(entity.firePrepActive).toBe(true);
    expect(entity.attackCooldown).toBe(0);
    advanceInfantryFirePrep(ctx, entity);
    expect(entity.attackCooldown).toBe(0); // stage 1
    advanceInfantryFirePrep(ctx, entity);

    // Stage reached FireLaunch — bullet launches (deferred invisible scatter + arm set)
    expect(entity.animState).toBe(AnimState.ATTACK);
    expect(entity.attackCooldown).toBeGreaterThan(0);
  });

  it('entity with dead structure target switches to GUARD', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;
    const deadStruct = makeStructure('POWR', House.USSR, 15, 15, { alive: false });
    entity.targetStructure = deadStruct;

    const ctx = makeMockContext({ entities: [entity], structures: [deadStruct] });
    updateAttack(ctx, entity);

    expect(entity.mission).toBe(Mission.GUARD);
    expect(entity.targetStructure).toBeNull();
  });

  it('CA first two-shooter launch uses the pre-toggle fire coordinate', () => {
    // C++ TechnoClass::Fire_At computes Fire_Coord(which), Unlimbo's the bullet,
    // then sets Arm and toggles IsSecondShot. A cruiser must therefore launch
    // the first shell from the fore barrel even though IsSecondShot is true
    // after the call returns.
    const cruiser = makeEntity(UnitType.V_CA, House.England, 20 * CELL_SIZE + CELL_SIZE / 2, 20 * CELL_SIZE + CELL_SIZE / 2);
    cruiser.mission = Mission.ATTACK;
    cruiser.attackCooldown = 0;
    cruiser.bodyFacing256 = 192; // west
    cruiser.bodyFacing32 = dir256ToFacing32(192);
    cruiser.facing = dir256ToFacing8(192);
    cruiser.isSecondShot = false;

    const target = makeEntity(UnitType.V_3TNK, House.USSR, 25 * CELL_SIZE + CELL_SIZE / 2, 20 * CELL_SIZE + CELL_SIZE / 2);
    cruiser.target = target;
    const targetDir = directionToLeptons256(cruiser.leptonX, cruiser.leptonY, target.leptonX, target.leptonY);
    cruiser.turretFacing256 = targetDir;
    cruiser.turretFacing32 = dir256ToFacing32(targetDir);
    cruiser.turretFacing = dir256ToFacing8(targetDir);
    cruiser.desiredTurretFacing256 = targetDir;
    cruiser.desiredTurretFacing = cruiser.turretFacing;

    const expectedLaunchCoord = cruiser.fireCoordForWeapon(cruiser.weapon);
    const ctx = makeMockContext({ entities: [cruiser, target] });

    updateAttack(ctx, cruiser);

    expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
    const launchCoord = (ctx.launchProjectile as any).mock.calls[0][7];
    expect(launchCoord).toEqual(expectedLaunchCoord);
    expect(cruiser.isSecondShot).toBe(true);
    expect(cruiser.fireCoordForWeapon(cruiser.weapon)).not.toEqual(expectedLaunchCoord);
  });

  it('two-shooter second eligible shot writes full ROF immediately', () => {
    // C++ land/vessel Firing_AI calls TechnoClass::Fire_At once per eligible
    // frame. Weapon.Burst only makes TechnoTypeClass::Is_Two_Shooter true:
    // first Fire_At writes Arm=3, second Fire_At writes weapon ROF.
    const mammoth = makeEntity(
      UnitType.V_4TNK,
      House.USSR,
      20 * CELL_SIZE + CELL_SIZE / 2,
      20 * CELL_SIZE + CELL_SIZE / 2,
    );
    mammoth.mission = Mission.ATTACK;
    mammoth.attackCooldown = 0;

    const target = makeEntity(
      UnitType.V_3TNK,
      House.Greece,
      23 * CELL_SIZE + CELL_SIZE / 2,
      20 * CELL_SIZE + CELL_SIZE / 2,
    );
    mammoth.target = target;
    const targetDir = directionToLeptons256(
      mammoth.leptonX,
      mammoth.leptonY,
      target.leptonX,
      target.leptonY,
    );
    mammoth.turretFacing256 = targetDir;
    mammoth.turretFacing32 = dir256ToFacing32(targetDir);
    mammoth.turretFacing = dir256ToFacing8(targetDir);
    mammoth.desiredTurretFacing256 = targetDir;
    mammoth.desiredTurretFacing = mammoth.turretFacing;

    const ctx = makeMockContext({ entities: [mammoth, target] });

    updateAttack(ctx, mammoth);
    expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
    expect(mammoth.attackCooldown).toBe(3);
    expect(mammoth.isSecondShot).toBe(true);

    // Simulate the three-frame Arm countdown reaching zero. The next eligible
    // Firing_AI call is the second shot of the same C++ two-shooter cadence.
    mammoth.attackCooldown = 0;
    mammoth.burstDelay = 0;
    (ctx.launchProjectile as any).mockClear();

    updateAttack(ctx, mammoth);
    expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
    expect(mammoth.attackCooldown).toBe(WEAPON_STATS['120mm'].rof);
    expect(mammoth.isSecondShot).toBe(false);
  });

  it('moving CA arcing scatter uses C++ Coord_Scatter integer movement', () => {
    // SCG12EA tick 165 geometry. The C++ shell starts from the cruiser muzzle,
    // applies Random_Pick(0,10), Random_Pick(0,scatterdist), then
    // Coord_Scatter(target, distance). Coord_Scatter uses the 256-entry integer
    // trig table, not floating-point screen angles.
    const saved = {
      seed: ScenarioRandom.seed,
      callCount: ScenarioRandom.callCount,
      sourceTag: ScenarioRandom._sourceTag,
      tagLogging: ScenarioRandom._tagLogging,
    };

    try {
      ScenarioRandom.seed = 1926610988;
      ScenarioRandom.callCount = 0;
      ScenarioRandom._sourceTag = 0;
      ScenarioRandom._tagLogging = false;

      const cruiser = makeEntity(UnitType.V_CA, House.England, 0, 0);
      cruiser.leptonX = 21021;
      cruiser.leptonY = 22400;
      cruiser.syncPosFromLeptons();
      cruiser.prevPos = { ...cruiser.pos };
      cruiser.mission = Mission.ATTACK;
      cruiser.attackCooldown = 0;
      cruiser.isDriving = true;
      cruiser.bodyFacing256 = 192;
      cruiser.bodyFacing32 = dir256ToFacing32(192);
      cruiser.facing = dir256ToFacing8(192);
      cruiser.isSecondShot = false;

      const target = makeEntity(UnitType.V_3TNK, House.BadGuy, 0, 0);
      target.leptonX = 20864;
      target.leptonY = 19840;
      target.syncPosFromLeptons();
      cruiser.target = target;

      const targetDir = directionToLeptons256(cruiser.leptonX, cruiser.leptonY, target.leptonX, target.leptonY);
      cruiser.turretFacing256 = targetDir;
      cruiser.turretFacing32 = dir256ToFacing32(targetDir);
      cruiser.turretFacing = dir256ToFacing8(targetDir);
      cruiser.desiredTurretFacing256 = targetDir;
      cruiser.desiredTurretFacing = cruiser.turretFacing;

      const ctx = makeMockContext({ entities: [cruiser, target] });
      updateAttack(ctx, cruiser);

      expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
      expect(ScenarioRandom.callCount).toBe(3);
      expect(ScenarioRandom.seed).toBe(2797688571);

      const call = (ctx.launchProjectile as any).mock.calls[0];
      const impactX = call[4] as number;
      const impactY = call[5] as number;
      expect({ lx: pixelToLepton(impactX), ly: pixelToLepton(impactY) }).toEqual({
        lx: 20884,
        ly: 19852,
      });
      expect(call[8]).toBe(6);
    } finally {
      ScenarioRandom.seed = saved.seed;
      ScenarioRandom.callCount = saved.callCount;
      ScenarioRandom._sourceTag = saved.sourceTag;
      ScenarioRandom._tagLogging = saved.tagLogging;
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // C++ Parity: projectile launches with RAW bullet strength (no warhead
  // multiplier baked in). applySplashDamage applies warhead-vs-armor and
  // distance falloff ONCE on arrival.
  //
  // C++ sources:
  //   bullet.cpp:478     — BulletClass::Read_INI / constructor: Strength = weapon.damage
  //                        (modulated only by FirepowerBias at firing time; Modify_Damage
  //                        runs later inside Explosion_Damage on impact).
  //   bullet.cpp:991     — Bullet_Explodes → Explosion_Damage is the SOLE damage path.
  //   combat.cpp:72-129  — Modify_Damage: warhead * armor * houseBias * distance falloff.
  //                        Applied EXACTLY ONCE per target inside Explosion_Damage.
  //   combat.cpp:207     — Explosion_Damage iterates entities in splash radius, calls
  //                        Modify_Damage for each — including the direct-hit target.
  // ─────────────────────────────────────────────────────────────────────────
  describe('projectile launch strength — single warhead-vs-armor application', () => {
    it('Flamer (projectile+splash) launches with RAW damage, not pre-multiplied by warhead mult', () => {
      // E4 (Flamethrower) firing Flamer at a Jeep (light armor).
      // C++ bullet.cpp:478: bullet.strength = weapon.damage * FirepowerBias (USSR = 1.0).
      //   Expected strength passed to launchProjectile = 70 (raw Flamer damage).
      //
      // Previous (buggy) behavior: missionAI would pre-multiply by warhead-vs-armor
      //   (Fire vs light = 0.6), passing 42. Then applySplashDamage would multiply again
      //   by 0.6, giving ~25 on impact — a double application.
      const e4 = makeEntity(UnitType.I_E4, House.USSR, 300, 300);
      e4.mission = Mission.ATTACK;
      e4.attackCooldown = 0;
      e4.facing = 2; // East, matches target direction
      e4.desiredFacing = 2;

      // Place Jeep within Flamer range (3.5 cells) — 2 cells away
      const jeep = makeEntity(UnitType.V_JEEP, House.England, 300 + CELL_SIZE * 2, 300);
      e4.target = jeep;

      const ctx = makeMockContext({ entities: [e4, jeep] });
      // E4 FireLaunch=2 (idata.cpp:464) — advance C++ StageClass to launch.
      updateAttack(ctx, e4);
      advanceInfantryFirePrep(ctx, e4);
      advanceInfantryFirePrep(ctx, e4);

      // launchProjectile must have been called (Flamer has projectileSpeed)
      expect(ctx.launchProjectile).toHaveBeenCalled();
      const callArgs = (ctx.launchProjectile as any).mock.calls[0];
      const [attacker, target, weapon, damage] = callArgs;
      expect(attacker).toBe(e4);
      expect(target).toBe(jeep);
      expect(weapon.name).toBe('Flamer');
      // C++ parity: bullet strength = weapon.damage * USSR FirepowerBias (1.0) = 70.
      // NOT 70 * 0.6 (Fire vs light) = 42, which is the old double-application bug.
      expect(damage).toBe(70);
    });

    it('Flamer from a Germany (firepower 1.10) unit scales strength by firepower bias', () => {
      // C++ bullet.cpp:478: weapon.damage * FirepowerBias is applied exactly once
      // at firing time. Warhead-vs-armor is applied later in Explosion_Damage.
      const e4 = makeEntity(UnitType.I_E4, House.Germany, 300, 300);
      e4.mission = Mission.ATTACK;
      e4.attackCooldown = 0;
      e4.facing = 2;
      e4.desiredFacing = 2;

      const jeep = makeEntity(UnitType.V_JEEP, House.USSR, 300 + CELL_SIZE * 2, 300);
      e4.target = jeep;

      const ctx = makeMockContext({ entities: [e4, jeep] });
      // E4 FireLaunch=2 — advance C++ StageClass to launch.
      updateAttack(ctx, e4);
      advanceInfantryFirePrep(ctx, e4);
      advanceInfantryFirePrep(ctx, e4);

      expect(ctx.launchProjectile).toHaveBeenCalled();
      const [, , , damage] = (ctx.launchProjectile as any).mock.calls[0];
      // 70 * 1.10 = 77 (rounded)
      expect(damage).toBe(Math.round(70 * COUNTRY_BONUSES.Germany.firepowerMult));
    });

    it('AP cannon (90mm) fired at light-armor jeep launches with raw damage', () => {
      // Medium Tank firing 90mm (AP, 30 dmg) at a Jeep (light armor).
      // AP vs light = 0.75, so the old buggy code would pre-multiply to 23 (round(30*0.75)).
      // The fix passes raw 30, letting applySplashDamage apply the 0.75 once on arrival.
      const tank = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200);
      tank.mission = Mission.ATTACK;
      tank.attackCooldown = 0;
      tank.facing = 2;
      tank.desiredFacing = 2;
      tank.turretFacing = 2;
      tank.turretFacing256 = 64;
      tank.turretFacing32 = 2 * 4; // keep 32-step in sync with 8-dir (Dir.E → 8)
      tank.desiredTurretFacing = 2;
      tank.desiredTurretFacing256 = 64;
      tank.turretDir = 2;

      // 90mm range is 4 cells; place Jeep 2 cells away
      const jeep = makeEntity(UnitType.V_JEEP, House.USSR, 200 + CELL_SIZE * 2, 200);
      tank.target = jeep;

      const ctx = makeMockContext({ entities: [tank, jeep] });
      updateAttack(ctx, tank);

      expect(ctx.launchProjectile).toHaveBeenCalled();
      const [, , weapon, damage] = (ctx.launchProjectile as any).mock.calls[0];
      expect(weapon.name).toBe('90mm');
      // C++ parity: raw 30 (Spain FirepowerBias = 1.0), not 23 (30*0.75 pre-multiplied).
      expect(damage).toBe(30);
    });

    it('DepthCharge uses BulletClass launch when only rules.ini projSpeed is set', () => {
      // C++ PT vs SS uses secondary DepthCharge: VesselClass::Can_Fire rejects
      // non-ASW 2Inch against submarines, then Fire_At creates a Catapult
      // BulletClass. DepthCharge has Speed=5 (projSpeed) but no legacy TS
      // projectileSpeed field, so damage must be deferred through launchProjectile.
      const pt = makeEntity(UnitType.V_PT, House.Greece, 300, 300);
      pt.mission = Mission.ATTACK;
      pt.attackCooldown = 0;
      pt.attackCooldown2 = 0;
      pt.facing = 2;
      pt.desiredFacing = 2;
      pt.turretFacing = 2;
      pt.turretFacing256 = 64;
      pt.turretFacing32 = 2 * 4;
      pt.desiredTurretFacing = 2;
      pt.desiredTurretFacing256 = 64;
      pt.turretDir = 2;

      const sub = makeEntity(UnitType.V_SS, House.USSR, 300 + CELL_SIZE * 3, 300);
      sub.cloakState = CloakState.UNCLOAKED;
      pt.target = sub;

      const ctx = makeMockContext({ entities: [pt, sub] });
      updateAttack(ctx, pt);

      expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
      expect(ctx.damageEntity).not.toHaveBeenCalled();
      const [attacker, target, weapon, damage] = (ctx.launchProjectile as any).mock.calls[0];
      expect(attacker).toBe(pt);
      expect(target).toBe(sub);
      expect(weapon.name).toBe('DepthCharge');
      expect(damage).toBe(80);
    });

    it('turreted vessels fire on the tick Rotation_AI finishes (vessel AI order)', () => {
      // C++ VesselClass::AI runs Rotation_AI before Combat_AI
      // (vessel.cpp:623-631). Unlike land UnitClass, VesselClass::Can_Fire sees
      // the post-rotation SecondaryFacing, so a PT whose turret reaches target
      // direction this tick can fire immediately.
      const pt = makeEntity(UnitType.V_PT, House.Greece, 300, 300);
      pt.mission = Mission.ATTACK;
      pt.attackCooldown = 0;
      pt.attackCooldown2 = 0;
      pt.facing = Dir.E;
      pt.desiredFacing = Dir.E;
      pt.bodyFacing256 = 64;
      pt.bodyFacing32 = dir256ToFacing32(64);

      const sub = makeEntity(UnitType.V_SS, House.USSR, 300 + CELL_SIZE * 3, 300);
      sub.cloakState = CloakState.UNCLOAKED;
      pt.target = sub;

      // One vessel turret step short of the target direction. PT ROT=7, so
      // Rotation_Adjust rate=8.
      const targetDir = directionToLeptons256(pt.leptonX, pt.leptonY, sub.leptonX, sub.leptonY);
      const startDir = (targetDir - 8 + 256) & 0xFF;
      pt.turretFacing256 = startDir;
      pt.turretFacing = dir256ToFacing8(startDir);
      pt.turretFacing32 = dir256ToFacing32(startDir);
      pt.desiredTurretFacing256 = targetDir;
      pt.desiredTurretFacing = dir256ToFacing8(targetDir);
      pt.turretRotTickedThisFrame = false;

      const ctx = makeMockContext({ entities: [pt, sub] });
      updateAttack(ctx, pt);

      expect(pt.turretFacing256).toBe(targetDir);
      expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
      const [, , weapon] = (ctx.launchProjectile as any).mock.calls[0];
      expect(weapon.name).toBe('DepthCharge');
    });

    it('non-turret vessels set PrimaryFacing.Desired on FIRE_FACING without rotating in Combat_AI', () => {
      // C++ VesselClass::AI order for submarines:
      //   DriveClass::AI() has already rotated PrimaryFacing for this tick,
      //   Rotation_AI() does not touch non-turret body facing,
      //   Combat_AI()/FIRE_FACING only sets PrimaryFacing.Desired().
      const sub = makeEntity(UnitType.V_SS, House.USSR, 300, 300);
      sub.mission = Mission.ATTACK;
      sub.attackCooldown = 0;
      sub.cloakState = CloakState.UNCLOAKED;

      const target = makeEntity(UnitType.V_DD, House.Greece, 300 + CELL_SIZE * 3, 300);
      sub.target = target;

      const targetDir = directionToLeptons256(sub.leptonX, sub.leptonY, target.leptonX, target.leptonY);
      sub.bodyFacing256 = (targetDir + 10) & 0xff; // strict vessel FIRE_FACING: diff > 8
      sub.bodyFacing32 = dir256ToFacing32(sub.bodyFacing256);
      sub.facing = dir256ToFacing8(sub.bodyFacing256);
      sub.desiredFacing256 = sub.bodyFacing256;
      sub.desiredFacing = sub.facing;
      sub.rotTickedThisFrame = false;

      const ctx = makeMockContext({ entities: [sub, target] });
      updateAttack(ctx, sub);

      expect(ctx.launchProjectile).not.toHaveBeenCalled();
      expect(sub.bodyFacing256).toBe((targetDir + 10) & 0xff);
      expect(sub.desiredFacing256).toBe(targetDir);
    });

    it('non-turret vessels do not use TS body-rotation state as FIRE_ROTATING', () => {
      // VesselClass::Rotation_AI clears IsRotating for non-turret vessels; once
      // PrimaryFacing is within the strict <=8-dir firing window, Can_Fire may
      // return FIRE_OK even if PrimaryFacing.Desired() is not exact yet.
      const sub = makeEntity(UnitType.V_SS, House.USSR, 300, 300);
      sub.mission = Mission.ATTACK;
      sub.attackCooldown = 0;
      sub.cloakState = CloakState.UNCLOAKED;

      const target = makeEntity(UnitType.V_DD, House.Greece, 300 + CELL_SIZE * 3, 300);
      sub.target = target;

      const targetDir = directionToLeptons256(sub.leptonX, sub.leptonY, target.leptonX, target.leptonY);
      sub.bodyFacing256 = (targetDir + 6) & 0xff; // inside vessel diff <= 8 tolerance
      sub.bodyFacing32 = dir256ToFacing32(sub.bodyFacing256);
      sub.facing = dir256ToFacing8(sub.bodyFacing256);
      sub.desiredFacing256 = targetDir;
      sub.desiredFacing = dir256ToFacing8(targetDir);
      sub.rotTickedThisFrame = true; // DriveClass::AI already rotated earlier this tick.

      const ctx = makeMockContext({ entities: [sub, target] });
      updateAttack(ctx, sub);

      expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
      const [, , weapon] = (ctx.launchProjectile as any).mock.calls[0];
      expect(weapon.name).toBe('TorpTube');
    });

    it('invisible projectile weapon (M1Carbine) defers raw bullet strength for explosion damage', () => {
      // C++ still creates BulletClass for Projectile=Invisible weapons. The bullet
      // explodes in the same tick, but damage goes through Explosion_Damage with raw
      // bullet Strength; warhead and distance falloff are applied there.
      const e1 = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
      e1.mission = Mission.ATTACK;
      e1.attackCooldown = 0;
      e1.facing = 2;
      e1.desiredFacing = 2;

      const enemy = makeEntity(UnitType.I_E1, House.USSR, 300 + CELL_SIZE * 2, 300);
      e1.target = enemy;

      const ctx = makeMockContext({ entities: [e1, enemy] });
      // E1 FireLaunch=2 (idata.cpp:404) — advance through the pre-fire stages.
      updateAttack(ctx, e1);
      advanceInfantryFirePrep(ctx, e1);
      advanceInfantryFirePrep(ctx, e1);

      // M1Carbine is Projectile=Invisible, but C++ still creates a BulletClass
      // with raw strength; the bullet resolves through the projectile path.
      expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
      const [attacker, target, weapon, damage] = (ctx.launchProjectile as any).mock.calls[0];
      expect(attacker).toBe(e1);
      expect(target).toBe(enemy);
      expect(weapon.name).toBe('M1Carbine');
      expect(damage).toBe(15);
      expect(ctx.damageEntity).not.toHaveBeenCalled();
      expect(ctx.deferInvisibleScatter).not.toHaveBeenCalled();
    });
  });

  it('demo truck delegates to updateDemoTruck', () => {
    const truck = makeEntity(UnitType.V_DTRK, House.USSR, 300, 300);
    truck.mission = Mission.ATTACK;
    const enemy = makeEntity(UnitType.I_E1, House.Spain, 340, 300);
    truck.target = enemy;

    const ctx = makeMockContext({ entities: [truck, enemy] });
    updateAttack(ctx, truck);

    expect(ctx.updateDemoTruck).toHaveBeenCalledWith(truck);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. updateHunt
// ═══════════════════════════════════════════════════════════════════════════

describe('updateHunt', () => {
  it('entity seeks nearest enemy', () => {
    const hunter = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    hunter.mission = Mission.HUNT;
    hunter.target = null;

    // Place enemy within hunt range (2 * sight = 2 * 4 = 8 cells = 192px)
    const enemy = makeEntity(UnitType.I_E1, House.USSR, 400, 300);
    const ctx = makeMockContext({ entities: [hunter, enemy] });

    updateHunt(ctx, hunter);

    expect(hunter.target).toBe(enemy);
  });

  it('entity engages found enemy while staying in HUNT when in range', () => {
    const hunter = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    hunter.mission = Mission.HUNT;

    // Place enemy within weapon range (3 cells = 72px)
    const enemy = makeEntity(UnitType.I_E1, House.USSR, 340, 300);
    hunter.target = enemy;

    const ctx = makeMockContext({ entities: [hunter, enemy] });
    updateHunt(ctx, hunter);

    expect(hunter.mission).toBe(Mission.HUNT);
    expect(hunter.animState).toBe(AnimState.ATTACK);
  });

  it('no enemies left: stays in HUNT with idle animation (C++ Random_Animate fallthrough)', () => {
    const hunter = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    hunter.mission = Mission.HUNT;
    hunter.target = null;

    // No enemies in the entity list
    const ctx = makeMockContext({ entities: [hunter] });
    updateHunt(ctx, hunter);

    // C++ foot.cpp:688: hunt with no targets falls through to Random_Animate.
    // The unit stays in HUNT mission — no explicit transition to GUARD.
    expect(hunter.mission).toBe(Mission.HUNT);
    expect(hunter.target).toBeNull();
  });

  it('chases target out of weapon range', () => {
    const hunter = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    hunter.mission = Mission.HUNT;

    // Place target out of weapon range but within hunt range
    const enemy = makeEntity(UnitType.I_E1, House.USSR, 450, 300);
    hunter.target = enemy;

    const ctx = makeMockContext({ entities: [hunter, enemy] });
    updateHunt(ctx, hunter);

    // C++ Mission_Hunt only sets target; movement is via Approach_Target in the
    // per-tick AI loop (index.ts). updateHunt sets animState to WALK but does
    // NOT move the position — that happens between scan ticks.
    expect(hunter.mission).toBe(Mission.HUNT);
    expect(hunter.animState).toBe(AnimState.WALK);
    // Position unchanged — movement is external to updateHunt
  });

  it('hunts enemy structures when no mobile enemies', () => {
    const hunter = makeEntity(UnitType.I_E1, House.USSR, 300, 300);
    hunter.mission = Mission.HUNT;
    hunter.target = null;

    // Enemy structure within hunt range
    const struct = makeStructure('POWR', House.Spain, 15, 15);
    const ctx = makeMockContext({ entities: [hunter], structures: [struct] });

    updateHunt(ctx, hunter);

    expect(hunter.mission).toBe(Mission.HUNT);
    expect(hunter.targetStructure).toBe(struct);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. updateRetreat
// ═══════════════════════════════════════════════════════════════════════════

describe('updateRetreat', () => {
  it('assigns an off-map edge NavCom', () => {
    // Place entity near left edge of bounds (boundsX=10, so cell 12 is 2 from left edge)
    const entity = makeEntity(UnitType.I_E1, House.Spain, 12 * CELL_SIZE + 12, 35 * CELL_SIZE + 12);
    entity.mission = Mission.RETREAT;
    entity.moveTarget = null;

    const ctx = makeMockContext({ entities: [entity] });
    updateRetreat(ctx, entity);

    // Should have set a move target toward the nearest map edge
    expect(entity.moveTarget).not.toBeNull();
    // Nearest exit is one cell beyond the left playable bound (boundsX=10).
    const targetCell = leptonToCell(entity.moveTarget!.lx, entity.moveTarget!.ly);
    expect(targetCell.cx).toBe(9);
    expect(entity.alive).toBe(true);
  });

  it('does not remove an in-bounds entity just because it already has NavCom', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.RETREAT;
    entity.moveTarget = { lx: pixelToLepton(300), ly: pixelToLepton(300) };

    const ctx = makeMockContext({ entities: [entity] });
    updateRetreat(ctx, entity);

    expect(entity.alive).toBe(true);
    expect(entity.mission).toBe(Mission.RETREAT);
  });

  it('retreat exit clears attached destroyed trigger state', () => {
    const entity = makeEntity(UnitType.V_LST, House.Greece, 9 * CELL_SIZE + 12, 35 * CELL_SIZE + 12);
    entity.mission = Mission.RETREAT;
    entity.triggerName = 'los3';

    const ctx = makeMockContext({ entities: [entity] });
    updateRetreat(ctx, entity);

    expect(entity.alive).toBe(false);
    expect(entity.mission).toBe(Mission.DIE);
    expect(entity.triggerName).toBe('');
    expect(entity.triggerDeathProcessed).toBe(true);
  });

  it('retreat exit delegates map-leave accounting when provided', () => {
    const entity = makeEntity(UnitType.V_LST, House.Greece, 9 * CELL_SIZE + 12, 35 * CELL_SIZE + 12);
    entity.mission = Mission.RETREAT;
    entity.triggerName = 'los3';
    const leaveMap = vi.fn((e: Entity) => {
      e.triggerName = '';
      e.triggerDeathProcessed = true;
      e.alive = false;
      e.mission = Mission.DIE;
    });

    const ctx = makeMockContext({ entities: [entity], leaveMap });
    updateRetreat(ctx, entity);

    expect(leaveMap).toHaveBeenCalledWith(entity);
    expect(entity.triggerName).toBe('');
    expect(entity.triggerDeathProcessed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. updateAreaGuard
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAreaGuard', () => {
  it('entity engages enemies within area', () => {
    const guard = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    guard.mission = Mission.AREA_GUARD;
    guard.guardOrigin = { x: 300, y: 300 };
    guard.lastGuardScan = 0;

    // Place enemy within sight range
    const enemy = makeEntity(UnitType.I_E1, House.USSR, 340, 300);
    const ctx = makeMockContext({ entities: [guard, enemy] });

    updateAreaGuard(ctx, guard);

    // C++ foot.cpp:1034-1037: target-found path stays AREA_GUARD with TarCom set.
    expect(guard.mission).toBe(Mission.AREA_GUARD);
    expect(guard.target).toBe(enemy);
  });

  it('entity returns to guard origin when far from it', () => {
    const guard = makeEntity(UnitType.I_E1, House.Spain, 500, 500);
    guard.mission = Mission.AREA_GUARD;
    guard.guardOrigin = { x: 300, y: 300 };
    guard.lastGuardScan = 0;
    // No weapon range defined, so leash = sight/2 ~= 2 cells
    // Entity is ~8.3 cells away from origin, beyond leash

    const ctx = makeMockContext({ entities: [guard] });
    updateAreaGuard(ctx, guard);

    // Should set moveTarget back toward origin and stay in AREA_GUARD
    expect(guard.moveTarget).not.toBeNull();
    expect(guard.moveTarget!.lx).toBe(coordTargetRoundTripLepton(pixelToLepton(300)));
    expect(guard.moveTarget!.ly).toBe(coordTargetRoundTripLepton(pixelToLepton(300)));
    expect(guard.animState).toBe(AnimState.WALK);
  });

  it('entity patrols within guard radius (stays idle when no enemies)', () => {
    const guard = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    guard.mission = Mission.AREA_GUARD;
    guard.guardOrigin = { x: 300, y: 300 };
    guard.lastGuardScan = 0;

    // No enemies
    const ctx = makeMockContext({ entities: [guard] });
    updateAreaGuard(ctx, guard);

    // Should stay in AREA_GUARD with IDLE animation
    expect(guard.mission).toBe(Mission.AREA_GUARD);
    expect(guard.animState).toBe(AnimState.IDLE);
  });

  it('entity returns home instead of scanning around its current position', () => {
    const guard = makeEntity(UnitType.I_E1, House.Spain, 500, 500);
    guard.mission = Mission.AREA_GUARD;
    guard.guardOrigin = { x: 300, y: 300 };
    guard.lastGuardScan = 0;

    // Place enemy within sight range of current position (not origin)
    const enemy = makeEntity(UnitType.I_E1, House.USSR, 520, 500);
    const ctx = makeMockContext({ entities: [guard, enemy] });

    updateAreaGuard(ctx, guard);

    // C++ scans from ArchiveTarget/home after assigning the return destination.
    // An enemy only near the current position is not acquired by this pass.
    expect(guard.mission).toBe(Mission.AREA_GUARD);
    expect(guard.target).toBeNull();
    expect(guard.moveTarget).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. updateAmbush
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAmbush', () => {
  it('entity stays dormant until enemy spotted', () => {
    const ambusher = makeEntity(UnitType.I_E1, House.USSR, 300, 300);
    ambusher.mission = Mission.AMBUSH;
    ambusher.lastGuardScan = 0;

    // No enemies
    const ctx = makeMockContext({ entities: [ambusher] });
    updateAmbush(ctx, ambusher);

    expect(ambusher.mission).toBe(Mission.AMBUSH);
    expect(ambusher.animState).toBe(AnimState.IDLE);
  });

  it('transitions to HUNT when enemy detected within sight', () => {
    const ambusher = makeEntity(UnitType.I_E1, House.USSR, 300, 300);
    ambusher.mission = Mission.AMBUSH;
    ambusher.lastGuardScan = 0;

    // Place enemy within sight range (4 cells = 96px)
    const enemy = makeEntity(UnitType.I_E1, House.Spain, 360, 300);
    const ctx = makeMockContext({ entities: [ambusher, enemy] });

    updateAmbush(ctx, ambusher);

    expect(ambusher.mission).toBe(Mission.HUNT);
    expect(ambusher.target).toBe(enemy);
  });

  it('does not trigger on allied units', () => {
    const ambusher = makeEntity(UnitType.I_E1, House.USSR, 300, 300);
    ambusher.mission = Mission.AMBUSH;
    ambusher.lastGuardScan = 0;

    // Allied unit nearby
    const ally = makeEntity(UnitType.I_E1, House.Ukraine, 340, 300);
    const ctx = makeMockContext({ entities: [ambusher, ally] });

    updateAmbush(ctx, ambusher);

    expect(ambusher.mission).toBe(Mission.AMBUSH);
    expect(ambusher.target).toBeNull();
  });

  it('does not trigger when scan delay has not elapsed', () => {
    const ambusher = makeEntity(UnitType.I_E1, House.USSR, 300, 300);
    ambusher.mission = Mission.AMBUSH;
    ambusher.lastGuardScan = 95; // scanned recently (tick is 100, delay is 15)

    const enemy = makeEntity(UnitType.I_E1, House.Spain, 340, 300);
    const ctx = makeMockContext({ entities: [ambusher, enemy] });

    updateAmbush(ctx, ambusher);

    expect(ambusher.mission).toBe(Mission.AMBUSH); // scan hasn't fired
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. updateRepairMission
// ═══════════════════════════════════════════════════════════════════════════

describe('updateRepairMission', () => {
  it('entity seeks nearest FIX (service depot)', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 300, 300);
    tank.mission = Mission.REPAIR;
    tank.moveTarget = null;

    const depot = makeStructure('FIX', House.Spain, 20, 20);
    const ctx = makeMockContext({ entities: [tank], structures: [depot] });

    updateRepairMission(ctx, tank);

    expect(tank.moveTarget).not.toBeNull();
    // Should target the depot position
    expect(tank.moveTarget!.lx).toBe(pixelToLepton(20 * CELL_SIZE + CELL_SIZE));
    expect(tank.moveTarget!.ly).toBe(pixelToLepton(20 * CELL_SIZE + CELL_SIZE));
  });

  it('switches to GUARD on arrival', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 504, 504);
    tank.mission = Mission.REPAIR;
    // Set moveTarget to current position to simulate arrival
    tank.moveTarget = { lx: pixelToLepton(504), ly: pixelToLepton(504) };

    const ctx = makeMockContext({ entities: [tank] });
    updateRepairMission(ctx, tank);

    expect(tank.mission).toBe(Mission.GUARD);
    expect(tank.moveTarget).toBeNull();
  });

  it('falls back to GUARD if no depot exists', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 300, 300);
    tank.mission = Mission.REPAIR;
    tank.moveTarget = null;

    // No FIX structures
    const ctx = makeMockContext({ entities: [tank], structures: [] });
    updateRepairMission(ctx, tank);

    expect(tank.mission).toBe(Mission.GUARD);
  });

  it('does not seek enemy depot', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 300, 300);
    tank.mission = Mission.REPAIR;
    tank.moveTarget = null;

    // Enemy depot — Spain is not allied with USSR
    const enemyDepot = makeStructure('FIX', House.USSR, 20, 20);
    const ctx = makeMockContext({ entities: [tank], structures: [enemyDepot] });

    updateRepairMission(ctx, tank);

    // Should not have found a depot and should fall back
    expect(tank.mission).toBe(Mission.GUARD);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. orderTransportEvacuate
// ═══════════════════════════════════════════════════════════════════════════

describe('orderTransportEvacuate', () => {
  it('transport moves to map edge', () => {
    // Place transport near left edge (boundsX=10)
    const transport = makeEntity(UnitType.V_TRAN, House.Spain, 12 * CELL_SIZE + 12, 35 * CELL_SIZE + 12);
    transport.teamMissions = [{ mission: 1, data: 0 }];
    transport.aircraftState = 'landed';

    const ctx = makeMockContext({ entities: [transport] });
    orderTransportEvacuate(ctx, transport);

    expect(transport.mission).toBe(Mission.MOVE);
    expect(transport.moveTarget).not.toBeNull();
    expect(transport.teamMissions).toHaveLength(0);
    // Aircraft state should transition for takeoff
    expect(transport.aircraftState).toBe('takeoff');
  });

  it('clears existing target and move queue', () => {
    const transport = makeEntity(UnitType.V_TRAN, House.Spain, 35 * CELL_SIZE, 35 * CELL_SIZE);
    transport.target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    transport.moveQueue = [{ lx: pixelToLepton(100), ly: pixelToLepton(100) }];
    transport.aircraftState = 'flying';

    const ctx = makeMockContext({ entities: [transport] });
    orderTransportEvacuate(ctx, transport);

    expect(transport.target).toBeNull();
    expect(transport.moveQueue).toHaveLength(0);
    expect(transport.mission).toBe(Mission.MOVE);
  });

  it('sets moveTarget one cell outside bounds for exit detection', () => {
    // Place transport at center — closest edge depends on position
    const cx = 35, cy = 35;
    const transport = makeEntity(UnitType.V_TRAN, House.Spain, cx * CELL_SIZE + 12, cy * CELL_SIZE + 12);
    transport.aircraftState = 'flying';

    const ctx = makeMockContext({ entities: [transport] });
    orderTransportEvacuate(ctx, transport);

    // Bounds are (10,10)-(60,60). From (35,35): all edges are 25 cells away.
    // minDist picks distLeft first (tie-breaking). tx = boundsX - 1 = 9
    const targetCell = leptonToCell(transport.moveTarget!.lx, transport.moveTarget!.ly);
    // One cell outside bounds
    expect(
      targetCell.cx < 10 || targetCell.cx >= 60 ||
      targetCell.cy < 10 || targetCell.cy >= 60
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. updateAttackStructure
// ═══════════════════════════════════════════════════════════════════════════

describe('updateAttackStructure', () => {
  it('turreted vessels wait for SecondaryFacing before firing at structures', () => {
    // C++ VesselClass::AI runs Rotation_AI before Combat_AI, then
    // VesselClass::Can_Fire returns FIRE_ROTATING for non-homing weapons while
    // SecondaryFacing is still rotating. Building targets use the same TarCom
    // Can_Fire path as unit targets.
    const cruiser = makeEntity(UnitType.V_CA, House.England, 20 * CELL_SIZE + CELL_SIZE / 2, 20 * CELL_SIZE + CELL_SIZE / 2);
    cruiser.mission = Mission.ATTACK;
    cruiser.attackCooldown = 0;
    cruiser.bodyFacing256 = 64;
    cruiser.bodyFacing32 = dir256ToFacing32(64);
    cruiser.facing = dir256ToFacing8(64);

    const struct = makeStructure('POWR', House.USSR, 25, 20);
    const target = scenarioStructureTargetLeptons(struct);
    const targetDir = directionToLeptons256(cruiser.leptonX, cruiser.leptonY, target.lx, target.ly);
    const startDir = (targetDir + 64) & 0xFF;
    cruiser.turretFacing256 = startDir;
    cruiser.turretFacing = dir256ToFacing8(startDir);
    cruiser.turretFacing32 = dir256ToFacing32(startDir);
    cruiser.desiredTurretFacing256 = startDir;
    cruiser.desiredTurretFacing = cruiser.turretFacing;
    cruiser.turretRotTickedThisFrame = false;

    const ctx = makeMockContext({ entities: [cruiser], structures: [struct] });
    updateAttackStructure(ctx, cruiser, struct);

    expect(ctx.launchProjectile).not.toHaveBeenCalled();
    expect(cruiser.attackCooldown).toBe(0);
    expect(cruiser.desiredTurretFacing256).toBe(targetDir);
    expect(cruiser.turretFacing256).not.toBe(startDir);
  });

  it('turreted vessels fire at structures on the tick vessel Rotation_AI finishes', () => {
    const cruiser = makeEntity(UnitType.V_CA, House.England, 20 * CELL_SIZE + CELL_SIZE / 2, 20 * CELL_SIZE + CELL_SIZE / 2);
    cruiser.mission = Mission.ATTACK;
    cruiser.attackCooldown = 0;
    cruiser.bodyFacing256 = 64;
    cruiser.bodyFacing32 = dir256ToFacing32(64);
    cruiser.facing = dir256ToFacing8(64);

    const struct = makeStructure('POWR', House.USSR, 25, 20);
    const target = scenarioStructureTargetLeptons(struct);
    const targetDir = directionToLeptons256(cruiser.leptonX, cruiser.leptonY, target.lx, target.ly);
    const startDir = (targetDir - (cruiser.stats.rot + 1) + 256) & 0xFF;
    cruiser.turretFacing256 = startDir;
    cruiser.turretFacing = dir256ToFacing8(startDir);
    cruiser.turretFacing32 = dir256ToFacing32(startDir);
    cruiser.desiredTurretFacing256 = targetDir;
    cruiser.desiredTurretFacing = dir256ToFacing8(targetDir);
    cruiser.turretRotTickedThisFrame = false;

    const ctx = makeMockContext({ entities: [cruiser], structures: [struct] });
    updateAttackStructure(ctx, cruiser, struct);

    expect(cruiser.turretFacing256).toBe(targetDir);
    expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
    const [, targetEntity, weapon] = (ctx.launchProjectile as any).mock.calls[0];
    expect(targetEntity).toBeNull();
    expect(weapon.name).toBe('8Inch');
  });

  it('two-shooter units use the 3-tick first-shot rearm against structures', () => {
    const cruiser = makeEntity(UnitType.V_CA, House.England, 20 * CELL_SIZE + CELL_SIZE / 2, 20 * CELL_SIZE + CELL_SIZE / 2);
    cruiser.mission = Mission.ATTACK;
    cruiser.attackCooldown = 0;

    const struct = makeStructure('V19', House.USSR, 25, 20);
    const target = scenarioStructureTargetLeptons(struct);
    const targetDir = directionToLeptons256(cruiser.leptonX, cruiser.leptonY, target.lx, target.ly);
    cruiser.turretFacing256 = targetDir;
    cruiser.turretFacing = dir256ToFacing8(targetDir);
    cruiser.turretFacing32 = dir256ToFacing32(targetDir);
    cruiser.desiredTurretFacing256 = targetDir;
    cruiser.desiredTurretFacing = cruiser.turretFacing;
    expect(cruiser.isTwoShooter()).toBe(true);
    expect(cruiser.isSecondShot).toBe(false);

    const ctx = makeMockContext({ entities: [cruiser], structures: [struct] });
    updateAttackStructure(ctx, cruiser, struct);

    expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
    expect(cruiser.attackCooldown).toBe(3);
    expect(cruiser.attackCooldown2).toBe(3);
    expect(cruiser.isSecondShot).toBe(true);
  });

  it('moving projectile platforms scatter structure shots during Fire_At', () => {
    // C++ TechnoClass::Fire_At sets BulletClass::IsInaccurate for moving
    // FootClass shooters before BulletClass::Unlimbo, regardless of target kind.
    // SCG12EA tick 5 hits this with a moving CA firing 8Inch at a France V19.
    const saved = {
      seed: ScenarioRandom.seed,
      callCount: ScenarioRandom.callCount,
      sourceTag: ScenarioRandom._sourceTag,
      tagLogging: ScenarioRandom._tagLogging,
    };

    try {
      ScenarioRandom.seed = 1624842842;
      ScenarioRandom.callCount = 0;
      ScenarioRandom._sourceTag = 0;
      ScenarioRandom._tagLogging = false;

      const cruiser = makeEntity(UnitType.V_CA, House.England, 20 * CELL_SIZE + CELL_SIZE / 2, 20 * CELL_SIZE + CELL_SIZE / 2);
      cruiser.mission = Mission.GUARD;
      cruiser.attackCooldown = 0;
      cruiser.isDriving = true;
      cruiser.isSecondShot = true;

      const struct = makeStructure('V19', House.USSR, 35, 20);
      const target = scenarioStructureTargetLeptons(struct);
      const targetDir = directionToLeptons256(cruiser.leptonX, cruiser.leptonY, target.lx, target.ly);
      cruiser.turretFacing256 = targetDir;
      cruiser.turretFacing = dir256ToFacing8(targetDir);
      cruiser.turretFacing32 = dir256ToFacing32(targetDir);
      cruiser.desiredTurretFacing256 = targetDir;
      cruiser.desiredTurretFacing = cruiser.turretFacing;

      const ctx = makeMockContext({ entities: [cruiser], structures: [struct] });
      updateAttackStructure(ctx, cruiser, struct);

      expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
      // The first Random_Pick(0,10) rejects once for this seed, so the arcing
      // scatter sequence consumes four raw seeds: two jitter attempts, distance,
      // then Coord_Scatter direction.
      expect(ScenarioRandom.callCount).toBe(4);
      expect(ScenarioRandom.seed).toBe(1995901478);

      const call = (ctx.launchProjectile as any).mock.calls[0];
      const impactX = call[4] as number;
      const impactY = call[5] as number;
      const targetX = target.lx * CELL_SIZE / LEPTON_SIZE;
      const targetY = target.ly * CELL_SIZE / LEPTON_SIZE;
      expect(Math.hypot(impactX - targetX, impactY - targetY)).toBeGreaterThan(0.1);
    } finally {
      ScenarioRandom.seed = saved.seed;
      ScenarioRandom.callCount = saved.callCount;
      ScenarioRandom._sourceTag = saved.sourceTag;
      ScenarioRandom._tagLogging = saved.tagLogging;
    }
  });

  it('launches a projectile at a target structure when the fire animation reaches FireLaunch', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;
    entity.attackCooldown = 0;
    entity.firePrepActive = true;
    entity.firePrepStage = 2;
    entity.firePrepUsesDoingStage = false;

    // Place structure within weapon range (3 cells)
    const struct = makeStructure('POWR', House.USSR,
      Math.floor(300 / CELL_SIZE), Math.floor(300 / CELL_SIZE));

    const ctx = makeMockContext({ entities: [entity], structures: [struct] });
    updateAttackStructure(ctx, entity, struct);

    expect(ctx.launchProjectile).toHaveBeenCalled();
    expect(ctx.damageStructure).not.toHaveBeenCalled();
    expect(entity.attackCooldown).toBeGreaterThan(0);
  });

  it('out-of-range structure TarCom does not move inside Firing_AI', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;

    // Place structure far away (20 cells)
    const struct = makeStructure('POWR', House.USSR, 40, 40);
    const startX = entity.pos.x;
    const startY = entity.pos.y;

    const ctx = makeMockContext({ entities: [entity], structures: [struct] });
    updateAttackStructure(ctx, entity, struct);

    expect(entity.animState).toBe(AnimState.WALK);
    // C++ Firing_AI does not call Coord_Move. Approach_Target assigns NavCom and
    // Movement_AI consumes it later in the object AI pass.
    expect(entity.pos.x).toBe(startX);
    expect(entity.pos.y).toBe(startY);
  });

  it('engineer captures enemy structure at red health', () => {
    const engineer = makeEntity(UnitType.I_E6, House.Spain, 300, 300);
    engineer.mission = Mission.ATTACK;

    // Place structure at same position (in range) and at red health
    const struct = makeStructure('POWR', House.USSR,
      Math.floor(300 / CELL_SIZE), Math.floor(300 / CELL_SIZE),
      { hp: 50, maxHp: 400 }); // hp/maxHp = 0.125 < CONDITION_RED (0.25)

    const ctx = makeMockContext({ entities: [engineer], structures: [struct] });
    updateAttackStructure(ctx, engineer, struct);

    // Engineer captures the building
    expect(struct.house).toBe(House.Spain);
    // C++ parity: Captured() changes ownership but does NOT restore HP (building.cpp:2936)
    expect(struct.hp).toBe(50); // stays at pre-capture HP
    expect(engineer.alive).toBe(false); // consumed
    expect(ctx.playEva).toHaveBeenCalledWith('eva_building_captured');
  });

  it('engineer damages enemy structure above red health', () => {
    const engineer = makeEntity(UnitType.I_E6, House.Spain, 300, 300);
    engineer.mission = Mission.ATTACK;

    // Place structure at good health
    const struct = makeStructure('POWR', House.USSR,
      Math.floor(300 / CELL_SIZE), Math.floor(300 / CELL_SIZE),
      { hp: 400, maxHp: 400 });

    const ctx = makeMockContext({ entities: [engineer], structures: [struct] });
    updateAttackStructure(ctx, engineer, struct);

    // Engineer damages the building (maxHp/3 = 133, capped to hp-1 = 399)
    expect(struct.hp).toBeLessThan(400);
    expect(struct.house).toBe(House.USSR); // not captured
    expect(engineer.alive).toBe(false); // consumed
  });

  it('spy infiltrates enemy structure', () => {
    const spy = makeEntity(UnitType.I_SPY, House.Spain, 300, 300);
    spy.mission = Mission.ATTACK;

    const struct = makeStructure('POWR', House.USSR,
      Math.floor(300 / CELL_SIZE), Math.floor(300 / CELL_SIZE));

    const ctx = makeMockContext({ entities: [spy], structures: [struct] });
    updateAttackStructure(ctx, spy, struct);

    expect(ctx.spyInfiltrate).toHaveBeenCalledWith(spy, struct);
  });

  it('engineer repairs friendly structure', () => {
    const engineer = makeEntity(UnitType.I_E6, House.Spain, 300, 300);
    engineer.mission = Mission.ATTACK;

    // Friendly damaged structure
    const struct = makeStructure('POWR', House.Spain,
      Math.floor(300 / CELL_SIZE), Math.floor(300 / CELL_SIZE),
      { hp: 200, maxHp: 400 });

    const ctx = makeMockContext({ entities: [engineer], structures: [struct] });
    updateAttackStructure(ctx, engineer, struct);

    expect(struct.hp).toBe(400); // fully repaired
    expect(engineer.alive).toBe(false); // consumed
    expect(ctx.playSound).toHaveBeenCalledWith('repair');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. updateForceFireGround
// ═══════════════════════════════════════════════════════════════════════════

describe('updateForceFireGround', () => {
  it('infantry force-fire launches only when FireLaunch stage is reached', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;
    entity.attackCooldown = 0;
    entity.forceFirePos = { x: 330, y: 300 }; // ~1.25 cells away, within range 3

    const ctx = makeMockContext({ entities: [entity] });
    updateForceFireGround(ctx, entity);

    expect(entity.animState).toBe(AnimState.ATTACK);
    expect(entity.firePrepActive).toBe(true);
    expect(entity.attackCooldown).toBe(0);
    expect(ctx.playSoundAt).not.toHaveBeenCalled();

    advanceInfantryForceFirePrep(ctx, entity);
    expect(entity.attackCooldown).toBe(0);
    advanceInfantryForceFirePrep(ctx, entity);

    expect(entity.attackCooldown).toBeGreaterThan(0);
    expect(ctx.playSoundAt).toHaveBeenCalled();
    expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
    expect(ctx.effects.length).toBeGreaterThanOrEqual(1);
  });

  it('vehicle moves toward force-fire target if out of range', () => {
    const entity = makeEntity(UnitType.V_1TNK, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;
    entity.forceFirePos = { x: 600, y: 300 }; // ~12.5 cells away, out of range
    entity.bodyFacing256 = 64; // east, already aligned with force-fire target
    entity.bodyFacing32 = dir256ToFacing32(64);
    entity.facing = dir256ToFacing8(64);
    entity.desiredFacing256 = 64;
    entity.desiredFacing = entity.facing;

    const ctx = makeMockContext({ entities: [entity] });
    const startX = entity.pos.x;
    updateForceFireGround(ctx, entity);

    expect(entity.animState).toBe(AnimState.WALK);
    expect(entity.pos.x).toBeGreaterThan(startX);
  });

  it('stops when ammo depleted', () => {
    // Use E1 (no noMovingFire constraint) with manually set ammo
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;
    entity.attackCooldown = 0;
    entity.ammo = 1;
    entity.maxAmmo = 2;
    entity.forceFirePos = { x: 330, y: 300 };

    const ctx = makeMockContext({ entities: [entity] });
    updateForceFireGround(ctx, entity);

    advanceInfantryForceFireUntil(
      ctx,
      entity,
      () => (ctx.launchProjectile as any).mock.calls.length > 0,
    );

    // E1 fires at FireLaunch and consumes last ammo.
    expect(entity.ammo).toBe(0);
    expect(entity.mission).toBe(Mission.GUARD);
  });

  it('launches splash projectile instead of applying splash inside Fire_At', () => {
    // Grenade is a projectile+splash weapon. C++ applies splash when the
    // BulletClass explodes, not inside InfantryClass::Firing_AI/Fire_At.
    const entity = makeEntity(UnitType.I_E2, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;
    entity.attackCooldown = 0;
    entity.forceFirePos = { x: 330, y: 300 };

    const ctx = makeMockContext({ entities: [entity] });
    updateForceFireGround(ctx, entity);
    advanceInfantryForceFireUntil(
      ctx,
      entity,
      () => (ctx.launchProjectile as any).mock.calls.length > 0,
    );

    expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
    expect(ctx.applySplashDamage).not.toHaveBeenCalled();
  });

  it('does not add terrain decal before projectile impact resolves', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;
    entity.attackCooldown = 0;
    entity.forceFirePos = { x: 330, y: 300 };

    const ctx = makeMockContext({ entities: [entity] });
    const decalsBefore = ctx.map.decals.length;
    updateForceFireGround(ctx, entity);
    advanceInfantryForceFireUntil(
      ctx,
      entity,
      () => (ctx.launchProjectile as any).mock.calls.length > 0,
    );

    expect(ctx.launchProjectile).toHaveBeenCalledTimes(1);
    expect(ctx.map.decals.length).toBe(decalsBefore);
  });
});
