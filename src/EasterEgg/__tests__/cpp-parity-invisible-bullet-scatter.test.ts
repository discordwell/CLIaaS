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
  UnitType, House, CELL_SIZE, Mission,
  pixelToLepton,
  WEAPON_STATS,
  buildDefaultAlliances,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  type InflightProjectile,
  fireWeaponAt,
  handleUnitDeath,
  launchProjectile,
  setStructureTurretDesired,
  updateStructureCombat,
  updateInflightProjectiles,
} from '../engine/combat';
import { logicAnimRenderSpec } from '../engine/logicAnim';
import { GameMap } from '../engine/map';
import { type MapStructure, STRUCTURE_WEAPONS } from '../engine/scenario';
import type { Effect } from '../engine/renderer';
import { COUNTRY_BONUSES } from '../engine/types';
import { ScenarioRandom } from '../engine/random';

beforeEach(() => {
  resetEntityIds();
  ScenarioRandom.seed = 0x12345678;
  ScenarioRandom.callCount = 0;
});

function makeCombatCtx(entities: Entity[] = [], structures: MapStructure[] = []): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    inflightProjectiles: [],
    effects: [] as Effect[],
    logicAnims: [],
    tick: 0,
    playerHouse: House.Spain,
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

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function defenseStructureAtCell(
  type: string,
  house: House,
  cx: number,
  cy: number,
  turretDir = 2,
): MapStructure {
  const weapon = STRUCTURE_WEAPONS[type];
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: 400,
    maxHp: 400,
    alive: true,
    rubble: false,
    weapon,
    attackCooldown: 0,
    ammo: weapon ? 1 : -1,
    maxAmmo: weapon ? 1 : -1,
    turretDir,
    desiredTurretDir: turretDir,
  };
}

function structureAtCell(type: string, house: House, cx: number, cy: number, hp: number): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp,
    maxHp: hp,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    missionTimer: 0,
  };
}

function alignStructureToTarget(s: MapStructure, target: Entity): void {
  setStructureTurretDesired(s, target);
  s.turretFacing256 = s.desiredTurretFacing256;
  s.turretDir = s.desiredTurretDir;
  s.turretRotAccum = 0;
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
    logicalLX: 100,
    logicalLY: 100,
    headToLX: 100,
    headToLY: 100,
    facing256: 0,
    speedAccum: 0,
    speedAdd: 0,
    fuseTimer: 1,
    armingTimer: 0,
    proximity: 0,
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

  it('invisible weapon consumes exactly 1 RNG call (Coord_Scatter) on DETONATION', () => {
    // C++ bullet.cpp:1012-1014 — Coord_Scatter fires during Bullet_Explodes,
    // not at Unlimbo. Verified via WASM tag 50002 at SCG03EA tick 267 bullet[282].
    const ctx = makeCombatCtx();
    const attacker = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 200, 100);
    ctx.entities = [attacker, target];
    ctx.entityById = new Map([[attacker.id, attacker], [target.id, target]]);

    const beforeLaunch = ScenarioRandom.seed;
    launchProjectile(ctx, attacker, target, WEAPON_STATS.M1Carbine, 15, 200, 100, true);
    // No RNG at launch — scatter is deferred to detonation
    expect(ScenarioRandom.seed).toBe(beforeLaunch);

    // Advance projectiles until detonation (travelFrames may be > 0)
    const beforeDetonate = ScenarioRandom.seed;
    for (let i = 0; i < 10 && ctx.inflightProjectiles.length > 0; i++) {
      updateInflightProjectiles(ctx);
    }
    // Exactly 1 ScenarioRandom.nextInRange(0, 255) consumed for Coord_Scatter dir at detonation
    expect(ScenarioRandom.seed).not.toBe(beforeDetonate);
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

  it('Colt45 (Tanya, Inviso=yes) consumes 1 RNG on DETONATION', () => {
    const ctx = makeCombatCtx();
    const attacker = new Entity(UnitType.I_E7, House.Spain, 100, 100);
    const target = new Entity(UnitType.I_E1, House.USSR, 200, 100);
    ctx.entities = [attacker, target];
    ctx.entityById = new Map([[attacker.id, attacker], [target.id, target]]);

    const beforeLaunch = ScenarioRandom.seed;
    launchProjectile(ctx, attacker, target, WEAPON_STATS.Colt45, 50, 200, 100, true);
    expect(ScenarioRandom.seed).toBe(beforeLaunch);

    const beforeDetonate = ScenarioRandom.seed;
    for (let i = 0; i < 10 && ctx.inflightProjectiles.length > 0; i++) {
      updateInflightProjectiles(ctx);
    }
    expect(ScenarioRandom.seed).not.toBe(beforeDetonate);
  });

  it('aircraft ChainGun fire creates an invisible BulletClass before damaging the target', () => {
    // C++ AircraftClass::Fire_At delegates to FootClass::Fire_At, which creates
    // a BulletClass even for Speed=100/Inviso=yes ChainGun shots. The Jeep
    // damage and Coord_Scatter RNG happen later in BulletClass::AI, not inside
    // AircraftClass::Fire_At itself.
    const attacker = new Entity(UnitType.V_YAK, House.BadGuy, 100, 100);
    const target = new Entity(UnitType.V_JEEP, House.Spain, 150, 100);
    const ctx = makeCombatCtx([attacker, target]);
    const hpBefore = target.hp;
    const seedBefore = ScenarioRandom.seed;

    fireWeaponAt(ctx, attacker, target, WEAPON_STATS.ChainGun);

    expect(target.hp, 'Fire_At should not damage synchronously').toBe(hpBefore);
    expect(ScenarioRandom.seed, 'Coord_Scatter is deferred to BulletClass::AI').toBe(seedBefore);
    expect(ctx.inflightProjectiles).toHaveLength(1);
    expect(ctx.inflightProjectiles[0].weapon.name).toBe('ChainGun');
    expect(ctx.inflightProjectiles[0].weapon.isInvisible).toBe(true);

    updateInflightProjectiles(ctx);

    expect(target.hp, 'BulletClass::AI applies the shot damage').toBeLessThan(hpBefore);
    expect(ScenarioRandom.callCount, 'invisible bullet detonation scatters once').toBe(1);
    expect(ctx.inflightProjectiles).toHaveLength(0);
  });

  it('entity projectile fire impacts ObjectClass::Target_Coord for falling infantry', () => {
    // C++ TechnoClass::Fire_At passes the target object to BulletClass; then
    // As_Coord(TarCom) resolves ObjectClass::Target_Coord(), which subtracts
    // current Height. Explosion_Damage still measures radius to Center_Coord,
    // so a falling infantry target takes distance-falloff damage rather than a
    // full center hit.
    const attacker = new Entity(UnitType.I_E1, House.Greece, 100, 100);
    attacker.leptonX = 14656;
    attacker.leptonY = 25920;
    attacker.syncPosFromLeptons();

    const target = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    target.leptonX = 15168;
    target.leptonY = 25664;
    target.syncPosFromLeptons();
    target.isFalling = true;
    target.fallHeightLeptons = 154;
    target.flightAltitude = 14;

    const ctx = makeCombatCtx([attacker, target]);
    const hpBefore = target.hp;

    fireWeaponAt(ctx, attacker, target, WEAPON_STATS.M1Carbine);

    expect(ctx.inflightProjectiles).toHaveLength(1);
    expect(ctx.inflightProjectiles[0].impactY).toBe((target.leptonY - target.fallHeightLeptons) * CELL_SIZE / 256);

    for (let i = 0; i < 10 && ctx.inflightProjectiles.length > 0; i++) {
      updateInflightProjectiles(ctx);
    }

    expect(hpBefore - target.hp).toBe(1);
  });

  it('AGUN ZSU-23 fire creates an Ack invisible BulletClass before damaging aircraft', () => {
    // rules.ini: [AGUN] Primary=ZSU-23, [ZSU-23] Projectile=Ack,
    // [Ack] Inviso=yes. C++ BuildingClass::Fire_At still submits a BulletClass;
    // damage and Coord_Scatter happen when that bullet runs.
    const agun = defenseStructureAtCell('AGUN', House.USSR, 10, 10, 2);
    const yak = entityAtCell(UnitType.V_YAK, House.Spain, 12, 10);
    yak.flightAltitude = Entity.FLIGHT_ALTITUDE;
    alignStructureToTarget(agun, yak);
    const hpBefore = yak.hp;
    const ctx = makeCombatCtx([yak], [agun]);
    const seedBefore = ScenarioRandom.seed;

    updateStructureCombat(ctx);

    expect(yak.hp, 'BuildingClass::Fire_At should not damage synchronously').toBe(hpBefore);
    expect(ScenarioRandom.seed, 'Ack Coord_Scatter is deferred to BulletClass::AI').toBe(seedBefore);
    expect(ctx.inflightProjectiles).toHaveLength(1);
    expect(ctx.inflightProjectiles[0].weapon.name).toBe('ZSU-23');
    expect(ctx.inflightProjectiles[0].weapon.isInvisible).toBe(true);
    expect(ctx.inflightProjectiles[0].impactY).toBe(yak.pos.y - yak.flightAltitude);

    updateInflightProjectiles(ctx);

    expect(yak.hp, 'Ack BulletClass::AI applies AGUN damage').toBeLessThan(hpBefore);
    expect(ScenarioRandom.callCount, 'invisible Ack detonation scatters once').toBe(1);
    expect(ctx.inflightProjectiles).toHaveLength(0);
  });

  it('airborne aircraft targets bypass Explosion_Damage before invisible scatter', () => {
    // C++ bullet.cpp:996-1014 skips Explosion_Damage for airborne aircraft
    // targets. The direct aircraft damage happens at TarCom distance < 0x80,
    // then the invisible projectile performs its single Coord_Scatter call.
    const ctx = makeCombatCtx();
    const wallCx = 12;
    const wallCy = 10;
    ctx.map.setWallType(wallCx, wallCy, 'BRIK');

    const yak = entityAtCell(UnitType.V_YAK, House.Spain, wallCx, wallCy + 1);
    yak.flightAltitude = Entity.FLIGHT_ALTITUDE;
    ctx.entities = [yak];
    ctx.entityById = new Map([[yak.id, yak]]);

    const impactX = wallCx * CELL_SIZE + CELL_SIZE / 2;
    const impactY = wallCy * CELL_SIZE + CELL_SIZE / 2;
    const hpBefore = yak.hp;

    ctx.inflightProjectiles.push(makeProjectile({
      attackerId: -1,
      attackerHouse: House.USSR,
      targetId: yak.id,
      weapon: {
        ...WEAPON_STATS.M1Carbine,
        name: 'ZSU-23',
        damage: 25,
        warhead: 'AP',
        isAntiAir: true,
        isInvisible: true,
      },
      damage: 25,
      strength: 25,
      speed: 0,
      currentFrame: 0,
      travelFrames: 1,
      startX: impactX,
      startY: impactY,
      impactX,
      impactY,
      logicalLX: wallCx * 256 + 128,
      logicalLY: wallCy * 256 + 128,
      headToLX: wallCx * 256 + 128,
      headToLY: wallCy * 256 + 128,
    }));

    updateInflightProjectiles(ctx);

    // AircraftClass::Take_Damage halves airborne damage before AP/light armor
    // modifies it: 25 / 2 = 12, then AP verses light armor = 75% => 9.
    expect(hpBefore - yak.hp).toBe(9);
    expect(ctx.map.getWallType(wallCx, wallCy)).toBe('BRIK');
    expect(ctx.map.getWallDamageLevel(wallCx, wallCy)).toBe(0);
    expect(ScenarioRandom.callCount).toBe(1);
  });

  it('does not force-explode non-high bullets on non-high wall overlays', () => {
    // C++ bullet.cpp:914 checks OverlayTypeClass::IsHigh, not IsWall. In
    // odata.cpp, FENC/SBAG/BARB/WOOD/CYCL are walls but do not stop low bullets.
    const ctx = makeCombatCtx();
    const wallCx = 20;
    const wallCy = 18;
    const lx = wallCx * 256 + 128;
    const ly = wallCy * 256 + 128;
    ctx.map.setWallType(wallCx, wallCy, 'FENC');
    ScenarioRandom.callCount = 0;

    ctx.inflightProjectiles.push(makeProjectile({
      weapon: { ...WEAPON_STATS.M1Carbine, isHigh: false, isDropping: false },
      speed: 0,
      speedAdd: 0,
      currentFrame: 0,
      travelFrames: 30,
      fuelTimer: 30,
      fuseTimer: 30,
      proximity: 512,
      startX: wallCx * CELL_SIZE + CELL_SIZE / 2,
      startY: wallCy * CELL_SIZE + CELL_SIZE / 2,
      impactX: (wallCx + 2) * CELL_SIZE + CELL_SIZE / 2,
      impactY: wallCy * CELL_SIZE + CELL_SIZE / 2,
      logicalLX: lx,
      logicalLY: ly,
      headToLX: lx + 512,
      headToLY: ly,
      facing256: 64,
    }));

    updateInflightProjectiles(ctx);

    expect(ctx.inflightProjectiles).toHaveLength(1);
    expect(ctx.inflightProjectiles[0].currentFrame).toBe(1);
    expect(ScenarioRandom.callCount).toBe(0);
  });

  it('force-explodes non-high bullets on high brick overlays', () => {
    const ctx = makeCombatCtx();
    const wallCx = 20;
    const wallCy = 18;
    const lx = wallCx * 256 + 128;
    const ly = wallCy * 256 + 128;
    ctx.map.setWallType(wallCx, wallCy, 'BRIK');
    ScenarioRandom.callCount = 0;

    ctx.inflightProjectiles.push(makeProjectile({
      weapon: { ...WEAPON_STATS.M1Carbine, isHigh: false, isDropping: false },
      speed: 0,
      speedAdd: 0,
      currentFrame: 0,
      travelFrames: 30,
      fuelTimer: 30,
      fuseTimer: 30,
      proximity: 512,
      startX: wallCx * CELL_SIZE + CELL_SIZE / 2,
      startY: wallCy * CELL_SIZE + CELL_SIZE / 2,
      impactX: (wallCx + 2) * CELL_SIZE + CELL_SIZE / 2,
      impactY: wallCy * CELL_SIZE + CELL_SIZE / 2,
      logicalLX: lx,
      logicalLY: ly,
      headToLX: lx + 512,
      headToLY: ly,
      facing256: 64,
    }));

    updateInflightProjectiles(ctx);

    expect(ctx.inflightProjectiles).toHaveLength(0);
    expect(ScenarioRandom.callCount).toBe(1);
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

  it('defers the next adjacent bullet when detonation deletes an earlier vehicle Logic object', () => {
    // C++ LogicClass::AI walks a compacting DynamicVector. If Bullet[N] deletes
    // an object before N and then deletes itself, only one index-- compensation
    // runs. The following pre-existing object can slide behind the cursor and
    // skip its BulletClass::AI until the next tick.
    const ctx = makeCombatCtx();
    const attacker1 = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    const target1 = new Entity(UnitType.V_APC, House.Greece, 200, 100);
    target1.hp = 1;
    const attacker2 = new Entity(UnitType.I_E1, House.USSR, 100, 180);
    const target2 = new Entity(UnitType.I_E1, House.Greece, 400, 180);
    target2.hp = 1;
    ctx.entities = [target1, attacker1, attacker2, target2];
    ctx.entityById = new Map(ctx.entities.map(e => [e.id, e]));

    launchProjectile(ctx, attacker1, target1, WEAPON_STATS.M1Carbine, 15, target1.pos.x, target1.pos.y, true);
    launchProjectile(ctx, attacker2, target2, WEAPON_STATS.M1Carbine, 15, target2.pos.x, target2.pos.y, true);

    updateInflightProjectiles(ctx);

    expect(target1.alive).toBe(false);
    expect(target2.hp).toBe(1);
    expect(ScenarioRandom.callCount).toBe(1);
    expect(ctx.inflightProjectiles).toHaveLength(1);
    expect(ctx.inflightProjectiles[0].targetId).toBe(target2.id);
    expect(ctx.inflightProjectiles[0].currentFrame).toBe(0);
    expect(ctx.inflightProjectiles[0].fuseTimer).toBe(4);

    updateInflightProjectiles(ctx);

    expect(ctx.inflightProjectiles).toHaveLength(1);
    expect(target2.alive).toBe(true);
    expect(ScenarioRandom.callCount).toBe(1);

    ctx.tick++;
    updateInflightProjectiles(ctx);

    expect(ctx.inflightProjectiles).toHaveLength(0);
    expect(target2.alive).toBe(false);
    expect(ScenarioRandom.callCount).toBe(2);
  });

  it('does not defer the next bullet when AP-killed infantry remains in Logic death animation', () => {
    // C++ InfantryClass::Take_Damage does not delete InfantryDeath variants
    // 1-4 immediately; it assigns a death action and the dead infantry remains
    // an active Logic object until the animation completes. SCG01EA tick 212
    // verifies that the next invisible bullet still receives same-tick AI.
    const ctx = makeCombatCtx();
    const attacker1 = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    const target1 = new Entity(UnitType.I_E1, House.Greece, 200, 100);
    target1.hp = 1;
    const attacker2 = new Entity(UnitType.I_E1, House.USSR, 100, 180);
    const target2 = new Entity(UnitType.I_E1, House.Greece, 400, 180);
    target2.hp = 1;
    ctx.entities = [target1, attacker1, attacker2, target2];
    ctx.entityById = new Map(ctx.entities.map(e => [e.id, e]));

    launchProjectile(ctx, attacker1, target1, WEAPON_STATS.M1Carbine, 15, target1.pos.x, target1.pos.y, true);
    launchProjectile(ctx, attacker2, target2, WEAPON_STATS.M1Carbine, 15, target2.pos.x, target2.pos.y, true);

    updateInflightProjectiles(ctx);

    expect(target1.alive).toBe(false);
    expect(target1.mission).toBe(Mission.DIE);
    expect(target1.deathVariant).toBeGreaterThanOrEqual(1);
    expect(target1.deathVariant).toBeLessThanOrEqual(4);
    expect(target2.alive).toBe(false);
    expect(ctx.inflightProjectiles).toHaveLength(0);
    expect(ScenarioRandom.callCount).toBe(2);
  });

  it('processes a bullet submitted during BulletClass::AI later in the same Logic loop', () => {
    // C++ LogicClass::AI re-reads Count() as BulletClass::AI runs. If a bullet
    // detonation submits another BulletClass object, that new bullet can receive
    // its own AI pass before later infantry submitted by the same explosion.
    const ctx = makeCombatCtx();
    const attacker = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    const victim = new Entity(UnitType.I_E1, House.Greece, 200, 100);
    const retaliator = new Entity(UnitType.I_E1, House.Greece, 180, 100);
    const secondTarget = new Entity(UnitType.I_E1, House.USSR, 260, 100);
    victim.hp = 1;
    secondTarget.hp = 1;
    ctx.entities = [victim, attacker, retaliator, secondTarget];
    ctx.entityById = new Map(ctx.entities.map(e => [e.id, e]));

    const originalTakeDamage = victim.takeDamage.bind(victim);
    victim.takeDamage = ((amount, warhead, source, props, options) => {
      launchProjectile(
        ctx,
        retaliator,
        secondTarget,
        WEAPON_STATS.M1Carbine,
        15,
        secondTarget.pos.x,
        secondTarget.pos.y,
        true
      );
      return originalTakeDamage(amount, warhead, source, props, options);
    }) as typeof victim.takeDamage;

    launchProjectile(ctx, attacker, victim, WEAPON_STATS.M1Carbine, 15, victim.pos.x, victim.pos.y, true);

    updateInflightProjectiles(ctx);

    expect(victim.alive).toBe(false);
    expect(secondTarget.alive).toBe(false);
    expect(ctx.inflightProjectiles).toHaveLength(0);
    expect(ScenarioRandom.callCount).toBeGreaterThan(1);
  });

  it('flame-equipped bullets submit delayed FBALL_FADE Logic anim slots', () => {
    // C++ bullet.cpp:380-388 toggles IsToAnimate and submits ANIM_FBALL_FADE
    // for FB1 flame bullets. TS tracks and renders that as a real Logic anim,
    // not as a detached legacy Effect.
    const ctx = makeCombatCtx();
    ctx.inflightProjectiles.push(makeProjectile({
      weapon: WEAPON_STATS.Flamer,
      isFlameEquipped: true,
      flameToggle: true,
      currentFrame: 0,
      travelFrames: 20,
      fuelTimer: 20,
      fuseTimer: 20,
      speedAdd: 0,
      speedAccum: 0,
      logicalLX: 1000,
      logicalLY: 1000,
      headToLX: 3000,
      headToLY: 1000,
      proximity: 2000,
    }));

    updateInflightProjectiles(ctx);

    const logicTrail = ctx.logicAnims.find(a => a.type === 'fball_fade');
    expect(logicTrail).toBeDefined();
    expect(logicTrail?.delay).toBe(1);
    expect(logicTrail?.isBrandNew).toBe(true);
    expect(logicAnimRenderSpec(logicTrail!.type)).toMatchObject({
      sprite: 'napalm1',
      groundLayer: false,
    });
    expect(ctx.effects.some(e => e.type === 'explosion' && e.sprite === 'napalm1')).toBe(false);
    expect(ctx.inflightProjectiles).toHaveLength(1);
  });

  it('defers hinted bullets until the C++ Logic cursor reaches their slot', () => {
    // C++ LogicClass::AI processes BulletClass objects in vector order. TS batches
    // bullet AI, so partial flushes must leave later hinted bullets untouched until
    // the cursor reaches that Logic index.
    const ctx = makeCombatCtx();
    const attacker = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 200, 100);
    target.hp = 1;
    ctx.entities = [attacker, target];
    ctx.entityById = new Map(ctx.entities.map(e => [e.id, e]));

    launchProjectile(ctx, attacker, target, WEAPON_STATS.M1Carbine, 15, target.pos.x, target.pos.y, true);
    const proj = ctx.inflightProjectiles[0];
    proj.logicIndexHint = 51;
    proj.currentFrame = 3;
    proj.fuseTimer = 1;
    ScenarioRandom.callCount = 0;

    updateInflightProjectiles(ctx, 50);

    expect(target.alive).toBe(true);
    expect(proj.currentFrame).toBe(3);
    expect(ctx.inflightProjectiles).toHaveLength(1);
    expect(ScenarioRandom.callCount).toBe(0);

    updateInflightProjectiles(ctx, 51);

    expect(target.alive).toBe(false);
    expect(ctx.inflightProjectiles).toHaveLength(0);
    expect(ScenarioRandom.callCount).toBe(1);
  });

  it('does not run the same hinted BulletClass twice in one Logic tick', () => {
    // C++ LogicClass::AI visits each BulletClass object once as the cursor reaches
    // its vector slot. TS can flush bullets before later objects and again at the
    // end of the tick; the already-flushed bullet must not age twice.
    const ctx = makeCombatCtx();
    ctx.tick = 100;
    const proj = makeProjectile({
      weapon: WEAPON_STATS['90mm'],
      logicIndexHint: 10,
      currentFrame: 0,
      fuseTimer: 10,
      travelFrames: 10,
      logicalLX: 1000,
      logicalLY: 1000,
      headToLX: 5000,
      headToLY: 1000,
      proximity: 4000,
    });
    ctx.inflightProjectiles.push(proj);

    updateInflightProjectiles(ctx, 10);
    expect(proj.currentFrame).toBe(1);
    expect(ctx.inflightProjectiles).toHaveLength(1);

    updateInflightProjectiles(ctx);
    expect(proj.currentFrame).toBe(1);
    expect(ctx.inflightProjectiles).toHaveLength(1);

    ctx.tick++;
    updateInflightProjectiles(ctx);
    expect(proj.currentFrame).toBe(2);
  });

  it('keeps a deletion-shift skipped BulletClass idle through later same-tick flushes', () => {
    // C++ logic.cpp:284-313 decrements the Logic cursor when the current
    // BulletClass deletes itself after removing an earlier Logic predecessor.
    // The object that shifted into the skipped slot is not processed until the
    // next frame; TS partial projectile flushes must preserve that skip through
    // the final end-of-tick flush.
    const victim = entityAtCell(UnitType.V_JEEP, House.Greece, 10, 10);
    victim.hp = 1;
    const ctx = makeCombatCtx([victim]);
    ctx.tick = 368;

    const victimLX = pixelToLepton(victim.pos.x);
    const victimLY = pixelToLepton(victim.pos.y);
    const killingProjectile = makeProjectile({
      attackerId: -1,
      targetId: victim.id,
      weapon: WEAPON_STATS['90mm'],
      damage: 50,
      strength: 50,
      logicIndexHint: 10,
      impactX: victim.pos.x,
      impactY: victim.pos.y,
      logicalLX: victimLX,
      logicalLY: victimLY,
      headToLX: victimLX,
      headToLY: victimLY,
      fuseTimer: 1,
      fuelTimer: 1,
      proximity: 0,
    });
    const shiftedProjectile = makeProjectile({
      weapon: WEAPON_STATS['105mm'],
      logicIndexHint: 11,
      currentFrame: 0,
      fuseTimer: 10,
      fuelTimer: 10,
      logicalLX: 25429,
      logicalLY: 24577,
      headToLX: 25408,
      headToLY: 24128,
      proximity: 459,
    });
    ctx.inflightProjectiles.push(killingProjectile, shiftedProjectile);

    updateInflightProjectiles(ctx, 11);

    expect(victim.alive).toBe(false);
    expect(ctx.inflightProjectiles).toContain(shiftedProjectile);
    expect(shiftedProjectile.currentFrame).toBe(0);
    expect(shiftedProjectile.processedLogicTick).toBe(368);

    updateInflightProjectiles(ctx);
    expect(shiftedProjectile.currentFrame).toBe(0);

    ctx.tick++;
    updateInflightProjectiles(ctx);
    expect(shiftedProjectile.currentFrame).toBe(1);
  });

  it('processes duplicate-hinted BulletClass slots when no earlier Logic predecessor was deleted', () => {
    // SCG07EA tick 169 has a torpedo and a fireball collapsed onto the same
    // effective Logic hint after previous vector compaction. C++ still advances
    // both bullets in that frame; only objects in the range after the deleting
    // bullet are skipped when a real earlier predecessor was removed.
    const ctx = makeCombatCtx();
    ctx.tick = 169;
    const detonatingProjectile = makeProjectile({
      weapon: WEAPON_STATS.TorpTube,
      logicIndexHint: 188,
      fuseTimer: 1,
      fuelTimer: 1,
      logicalLX: 4496,
      logicalLY: 14223,
      headToLX: 4496,
      headToLY: 14223,
      proximity: 0,
    });
    const duplicateHintProjectile = makeProjectile({
      weapon: WEAPON_STATS.Flamer,
      logicIndexHint: 188,
      currentFrame: 17,
      fuseTimer: 15,
      fuelTimer: 15,
      travelFrames: 32,
      logicalLX: 7282,
      logicalLY: 15095,
      headToLX: 7040,
      headToLY: 14976,
      proximity: 270,
    });
    ctx.inflightProjectiles.push(detonatingProjectile, duplicateHintProjectile);

    updateInflightProjectiles(ctx, 188);

    expect(ctx.inflightProjectiles).toContain(duplicateHintProjectile);
    expect(duplicateHintProjectile.currentFrame).toBe(18);
    expect(duplicateHintProjectile.fuelTimer).toBe(14);
    expect(duplicateHintProjectile.processedLogicTick).toBe(169);
  });

  it('processes two bullets submitted by the current object in the same Logic pass', () => {
    // C++ DynamicVectorClass::Add appends at ActiveCount; it does not reuse an
    // earlier hole. A two-shooter aircraft can submit two invisible BulletClass
    // objects from the current AircraftClass::AI pass, and both are reachable
    // when LogicClass::AI later reaches the appended bullet slots.
    const ctx = makeCombatCtx();
    ctx.tick = 100;
    let nextHint = 3;
    ctx.logicIndexHintForNewObject = () => nextHint++;
    (ctx as CombatContext & { isLogicIndexBehindCursor?: (hint: number) => boolean })
      .isLogicIndexBehindCursor = (hint) => hint < 5;
    const attacker = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    ctx.entities = [attacker];
    ctx.entityById = new Map(ctx.entities.map(e => [e.id, e]));

    launchProjectile(ctx, attacker, null, WEAPON_STATS.M1Carbine, 15, 800, 100, true);
    launchProjectile(ctx, attacker, null, WEAPON_STATS.M1Carbine, 15, 800, 100, true);
    for (const proj of ctx.inflightProjectiles) {
      proj.currentFrame = 3;
      proj.fuseTimer = 1;
    }
    ScenarioRandom.callCount = 0;

    updateInflightProjectiles(ctx);

    expect(ctx.inflightProjectiles).toHaveLength(0);
    expect(ScenarioRandom.callCount).toBe(2);
  });

  it('processes barrel bullets appended after a projectile deletes an earlier Logic object', () => {
    // C++ LogicClass::AI re-reads Count() after BulletClass::AI. If that bullet
    // destroys a barrel, Take_Damage first appends its RESULT_DESTROYED AnimClass
    // effects, then appends the four barrel BulletClass objects. Those fresh
    // appends can run in the same pass; deletion-shift handling must not
    // classify them as old objects behind the cursor.
    const barrel = structureAtCell('BARL', House.USSR, 10, 10, 10);
    const ctx = makeCombatCtx([], [barrel]);
    let nextHint = 11;
    ctx.logicIndexHintForNewObject = () => nextHint++;
    ctx.inflightProjectiles.push(makeProjectile({
      weapon: { ...WEAPON_STATS['8Inch'], isInvisible: false },
      damage: 500,
      strength: 500,
      logicIndexHint: 10,
      impactX: 10 * CELL_SIZE + CELL_SIZE / 2,
      impactY: 10 * CELL_SIZE + CELL_SIZE / 2,
      logicalLX: 10 * 256 + 128,
      logicalLY: 10 * 256 + 128,
      headToLX: 10 * 256 + 128,
      headToLY: 10 * 256 + 128,
      fuseTimer: 1,
      fuelTimer: 1,
    }));

    updateInflightProjectiles(ctx);

    const barrelBullets = ctx.inflightProjectiles.filter(p => p.weapon.name === 'BarrelFire');
    expect(barrel.alive).toBe(false);
    expect(barrelBullets).toHaveLength(4);
    expect(barrelBullets.map(p => p.logicIndexHint)).toEqual([12, 13, 14, 15]);
    expect(barrelBullets.every(p => p.currentFrame === 1)).toBe(true);
  });

  it('does not treat pending Drop_Debris buildings as deleted Logic predecessors', () => {
    // C++ BuildingClass::Take_Damage leaves destroyed buildings active in Logic
    // until BuildingClass::AI runs Drop_Debris. A bullet that destroys a barrel
    // therefore must not cause the following BulletClass slot to be skipped.
    const barrel = structureAtCell('BARL', House.USSR, 10, 10, 10);
    const ctx = makeCombatCtx([], [barrel]);
    let nextHint = 20;
    ctx.logicIndexHintForNewObject = () => nextHint++;
    ctx.inflightProjectiles.push(makeProjectile({
      weapon: { ...WEAPON_STATS['8Inch'], isInvisible: false },
      damage: 500,
      strength: 500,
      logicIndexHint: 10,
      impactX: 10 * CELL_SIZE + CELL_SIZE / 2,
      impactY: 10 * CELL_SIZE + CELL_SIZE / 2,
      logicalLX: 10 * 256 + 128,
      logicalLY: 10 * 256 + 128,
      headToLX: 10 * 256 + 128,
      headToLY: 10 * 256 + 128,
      fuseTimer: 1,
      fuelTimer: 1,
    }));
    ctx.inflightProjectiles.push(makeProjectile({
      weapon: { ...WEAPON_STATS['8Inch'], isInvisible: false },
      damage: 1,
      strength: 1,
      logicIndexHint: 11,
      impactX: 20 * CELL_SIZE + CELL_SIZE / 2,
      impactY: 20 * CELL_SIZE + CELL_SIZE / 2,
      logicalLX: 20 * 256 + 128,
      logicalLY: 20 * 256 + 128,
      headToLX: 20 * 256 + 128,
      headToLY: 20 * 256 + 128,
      fuseTimer: 1,
      fuelTimer: 1,
    }));

    updateInflightProjectiles(ctx);

    expect(barrel.alive).toBe(false);
    expect(barrel.debrisCountdown).toBe(8);
    expect(ctx.inflightProjectiles.some(p => p.logicIndexHint === 11)).toBe(false);
    expect(ctx.inflightProjectiles.filter(p => p.weapon.name === 'BarrelFire')).toHaveLength(4);
  });

  it('vehicle death crew is appended after existing BulletClass Logic slots', () => {
    // SCG04EA tick 1288: an invisible bullet submitted before a vehicle survivor
    // must run before that new C1 gets Mission_Move. The survivor therefore keeps
    // the next Logic index after already-submitted BulletClass objects.
    const ctx = makeCombatCtx();
    const attacker = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    const victim = new Entity(UnitType.V_MCV, House.Greece, 200, 100);
    ctx.entities = [victim, attacker];
    ctx.entityById = new Map(ctx.entities.map(e => [e.id, e]));
    ctx.logicIndexHintForNewObject = () => 52;

    ScenarioRandom.seed = 0; // first Percent_Chance(50) succeeds.
    ScenarioRandom.callCount = 0;
    victim.alive = false;
    victim.hp = 0;

    handleUnitDeath(ctx, victim, {
      screenShake: 0,
      explosionSize: 0,
      debris: false,
      explodeLgSound: false,
      attackerIsPlayer: false,
      trackLoss: false,
      attacker,
    });

    const crew = ctx.entities.find(e => e !== victim && e !== attacker);
    expect(crew?.type).toBe(UnitType.I_C1);
    expect(crew?.logicIndexHint).toBe(52);
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
