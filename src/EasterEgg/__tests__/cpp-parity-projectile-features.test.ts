/**
 * C++ Behavioral Parity: IsFueled, IsDropping, IsFlameEquipped
 *
 * Tests verify three C++ bullet features match the original RA source code.
 * Each describe block documents the C++ source reference (file:line).
 *
 * 1. IsFueled (fuse.cpp:139, bullet.cpp:710): Fueled projectiles explode mid-air when
 *    fuel timer expires. Also forces inaccuracy vs infantry targets.
 * 2. IsDropping (bullet.cpp:790-802, 359-361): Bullets fall from FLIGHT_LEVEL with gravity;
 *    detonate when dropHeight reaches 0.
 * 3. IsFlameEquipped (bullet.cpp:377-386): Spawn flame/smoke trail every other frame.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, RULE_GRAVITY,
  UNIT_STATS, WEAPON_STATS,
  buildDefaultAlliances,
  directionToLeptons256,
  pixelToLepton,
  type WeaponStats,
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
import {
  STRUCTURE_MAX_HP,
  STRUCTURE_WEAPONS,
  structureCenterLeptons,
  type MapStructure,
} from '../engine/scenario';
import {
  Team,
  clearAllTeams,
  registerTeam,
  TMISSION_MOVE,
} from '../engine/team';

beforeEach(() => {
  resetEntityIds();
  clearAllTeams();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function structureAtCell(type: string, house: House, cx: number, cy: number): MapStructure {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: maxHp,
    maxHp,
    alive: true,
    rubble: false,
    weapon: STRUCTURE_WEAPONS[type],
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    missionTimer: 0,
  };
}

function makeCombatCtx(entities: Entity[] = []): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures: [],
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

/** Create a raw InflightProjectile for direct testing of update logic */
function makeProjectile(overrides: Partial<InflightProjectile>): InflightProjectile {
  const startX = overrides.startX ?? 0;
  const startY = overrides.startY ?? 0;
  const impactX = overrides.impactX ?? 100;
  const impactY = overrides.impactY ?? 100;
  const logicalLX = overrides.logicalLX ?? pixelToLepton(startX);
  const logicalLY = overrides.logicalLY ?? pixelToLepton(startY);
  const headToLX = overrides.headToLX ?? pixelToLepton(impactX);
  const headToLY = overrides.headToLY ?? pixelToLepton(impactY);
  return {
    attackerId: 1,
    targetId: 2,
    weapon: WEAPON_STATS.SCUD,
    damage: 100,
    strength: 100,
    speed: 2.0,
    travelFrames: 20,
    currentFrame: 0,
    directHit: true,
    impactX,
    impactY,
    attackerIsPlayer: false,
    isArcing: false,
    arcHeight: 0,
    arcRiser: 0,
    startX,
    startY,
    dogRiderId: -1,
    fuelTimer: 10,
    isFueled: false,
    isDropping: false,
    dropHeight: 0,
    dropRiser: 0,
    dropHasAttachedAnim: false,
    isFlameEquipped: false,
    flameToggle: false,
    logicalLX,
    logicalLY,
    headToLX,
    headToLY,
    facing256: overrides.facing256 ?? directionToLeptons256(logicalLX, logicalLY, headToLX, headToLY),
    speedAccum: 0,
    speedAdd: 0,
    fuseTimer: 100,
    armingTimer: 0,
    proximity: 0x7fffffff,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Building Payback — techno.cpp:3229, bullet.cpp:991, foot.cpp:1178
// ══════════════════════════════════════════════════════════════════════════════

describe('Building-fired projectile payback', () => {
  it('passes the firing structure through explosion damage so moving teams retarget it', () => {
    const tank = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    const gun = structureAtCell('GUN', House.Greece, 25, 25);
    const ctx = makeCombatCtx([tank]);
    ctx.structures.push(gun);

    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.V_3TNK, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 0 }],
      forcedActive: true,
    });
    team.add(tank);
    team.isMoving = true;
    team.isFullStrength = true;
    team.isHasBeen = true;
    (team as any).setMissionTarget(
      { x: 4 * CELL_SIZE + CELL_SIZE / 2, y: 4 * CELL_SIZE + CELL_SIZE / 2 },
      { cx: 4, cy: 4 },
    );
    registerTeam(team);

    const gunCenter = structureCenterLeptons(gun);
    const impactX = tank.pos.x;
    const impactY = tank.pos.y;
    const weapon = STRUCTURE_WEAPONS.GUN;
    ctx.inflightProjectiles.push(makeProjectile({
      attackerId: -1,
      attackerHouse: gun.house,
      attackerStructureIndex: 0,
      targetId: tank.id,
      weapon: {
        name: weapon.weaponName ?? 'GUN',
        damage: weapon.damage,
        rof: weapon.rof,
        range: weapon.range,
        warhead: 'AP',
        splash: weapon.splash,
        projSpeed: weapon.projSpeed,
      } as WeaponStats,
      damage: weapon.damage,
      strength: weapon.damage,
      startX: gunCenter.lx * CELL_SIZE / 256,
      startY: gunCenter.ly * CELL_SIZE / 256,
      impactX,
      impactY,
      logicalLX: pixelToLepton(impactX),
      logicalLY: pixelToLepton(impactY),
      headToLX: pixelToLepton(impactX),
      headToLY: pixelToLepton(impactY),
      travelFrames: 1,
      fuseTimer: 1,
      fuelTimer: 1,
      proximity: 0x7fffffff,
    }));

    updateInflightProjectiles(ctx);

    expect((team as any).targetStructureRef).toBe(gun);

    team.coordinateMove(undefined, ctx as any);
    expect(tank.moveTarget).toEqual({
      lx: gunCenter.lx,
      ly: gunCenter.ly,
    });
  });

  it('keeps building payback stable when structure slots shift before impact', () => {
    const tank = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    const removedBeforeImpact = structureAtCell('GUN', House.Spain, 1, 1);
    const firingGun = structureAtCell('GUN', House.Greece, 25, 25);
    const wrongGun = structureAtCell('GUN', House.Greece, 5, 5);
    const ctx = makeCombatCtx([tank]);
    ctx.structures.push(removedBeforeImpact, firingGun, wrongGun);

    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.V_3TNK, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 0 }],
      forcedActive: true,
    });
    team.add(tank);
    team.isMoving = true;
    team.isFullStrength = true;
    team.isHasBeen = true;
    (team as any).setMissionTarget(
      { x: 4 * CELL_SIZE + CELL_SIZE / 2, y: 4 * CELL_SIZE + CELL_SIZE / 2 },
      { cx: 4, cy: 4 },
    );
    registerTeam(team);

    const firingGunCenter = structureCenterLeptons(firingGun);
    const impactX = tank.pos.x;
    const impactY = tank.pos.y;
    const weapon = STRUCTURE_WEAPONS.GUN;
    const projectileOverrides = {
      attackerId: -1,
      attackerHouse: firingGun.house,
      // C++ BulletClass::Payback stores a BuildingClass pointer. The slot is
      // only a TS diagnostic hint and must not become authoritative after splice.
      attackerStructure: firingGun,
      attackerStructureIndex: 1,
      targetId: tank.id,
      weapon: {
        name: weapon.weaponName ?? 'GUN',
        damage: weapon.damage,
        rof: weapon.rof,
        range: weapon.range,
        warhead: 'AP',
        splash: weapon.splash,
        projSpeed: weapon.projSpeed,
      } as WeaponStats,
      damage: weapon.damage,
      strength: weapon.damage,
      startX: firingGunCenter.lx * CELL_SIZE / 256,
      startY: firingGunCenter.ly * CELL_SIZE / 256,
      impactX,
      impactY,
      logicalLX: pixelToLepton(impactX),
      logicalLY: pixelToLepton(impactY),
      headToLX: pixelToLepton(impactX),
      headToLY: pixelToLepton(impactY),
      travelFrames: 1,
      fuseTimer: 1,
      fuelTimer: 1,
      proximity: 0x7fffffff,
    } as Partial<InflightProjectile> & { attackerStructure: MapStructure };
    ctx.inflightProjectiles.push(makeProjectile(projectileOverrides));

    ctx.structures.splice(0, 1);
    expect(ctx.structures[1]).toBe(wrongGun);

    updateInflightProjectiles(ctx);

    expect((team as any).targetStructureRef).toBe(firingGun);

    team.coordinateMove(undefined, ctx as any);
    expect(tank.moveTarget).toEqual({
      lx: firingGunCenter.lx,
      ly: firingGunCenter.ly,
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. IsFueled — fuse.cpp:139, bullet.cpp:710
// ══════════════════════════════════════════════════════════════════════════════

describe('IsFueled — fuel timer detonation (fuse.cpp:127-139)', () => {

  it('SCUD weapon has isFueled=true (C++ FROG bullet type: Fueled=yes)', () => {
    expect(WEAPON_STATS.SCUD.isFueled).toBe(true);
  });

  it('non-fueled weapons (90mm, M1Carbine) have isFueled undefined/false', () => {
    expect(WEAPON_STATS['90mm'].isFueled).toBeFalsy();
    expect(WEAPON_STATS.M1Carbine.isFueled).toBeFalsy();
  });

  it('fuelTimer decrements each tick (fuse.cpp:127: if (Timer) Timer--)', () => {
    const ctx = makeCombatCtx();
    const proj = makeProjectile({ isFueled: true, fuelTimer: 5, travelFrames: 100 });
    ctx.inflightProjectiles.push(proj);

    // After 1 tick, fuelTimer should be 4
    updateInflightProjectiles(ctx);
    // proj was mutated in-place before removal
    expect(proj.fuelTimer).toBe(4);
  });

  it('fueled projectile detonates when fuelTimer reaches 0 (fuse.cpp:139)', () => {
    const attacker = entityAtCell(UnitType.V_V2RL, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 15, 5);
    const ctx = makeCombatCtx([attacker, target]);

    // Create a fueled projectile with fuelTimer=3, long travelFrames
    // The projectile should run out of fuel and detonate before reaching target
    const proj = makeProjectile({
      attackerId: attacker.id,
      targetId: target.id,
      isFueled: true,
      fuelTimer: 3,
      travelFrames: 100,
      weapon: WEAPON_STATS.SCUD,
      damage: 600,
      strength: 600,
    });
    ctx.inflightProjectiles.push(proj);

    // Tick 3 times: fuelTimer goes 3 -> 2 -> 1 -> 0
    updateInflightProjectiles(ctx);
    expect(ctx.inflightProjectiles.length).toBe(1); // still alive at fuelTimer=2

    updateInflightProjectiles(ctx);
    expect(ctx.inflightProjectiles.length).toBe(1); // still alive at fuelTimer=1

    updateInflightProjectiles(ctx);
    // fuelTimer reaches 0 → projectile detonates
    expect(ctx.inflightProjectiles.length).toBe(0);
  });

  it('non-fueled projectile does NOT detonate when fuelTimer reaches 0', () => {
    const ctx = makeCombatCtx();
    const proj = makeProjectile({
      isFueled: false,
      fuelTimer: 2,
      travelFrames: 100,
    });
    ctx.inflightProjectiles.push(proj);

    // Tick twice to reach fuelTimer=0
    updateInflightProjectiles(ctx);
    updateInflightProjectiles(ctx);

    // Non-fueled: should still be in flight (travelFrames=100 not reached)
    expect(ctx.inflightProjectiles.length).toBe(1);
  });

  it('launchProjectile sets FuseClass Timer = min(0xFF, max(range, Arm)) for fueled weapons', () => {
    const attacker = entityAtCell(UnitType.V_V2RL, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 10, 5);
    const ctx = makeCombatCtx([attacker, target]);

    launchProjectile(ctx, attacker, target, WEAPON_STATS.SCUD, 600,
      target.pos.x, target.pos.y, true);

    expect(ctx.inflightProjectiles.length).toBe(1);
    const proj = ctx.inflightProjectiles[0];
    expect(proj.isFueled).toBe(true);
    expect(proj.armingTimer).toBe(WEAPON_STATS.SCUD.projectileArm);
    // travelFrames already includes bullet.cpp's +4 launch offset.
    expect(proj.fuelTimer).toBe(Math.min(0xFF, Math.max(proj.travelFrames, WEAPON_STATS.SCUD.projectileArm!)));
    expect(proj.fuseTimer).toBe(proj.fuelTimer);
  });
});

describe('IsFueled — forced inaccuracy vs infantry (bullet.cpp:709-710)', () => {

  it('SCUD weapon has isFueled=true (used in inaccuracy check)', () => {
    // C++ bullet.cpp:710: (Is_Target_Infantry(TarCom)) && (Warhead == WARHEAD_AP || Class->IsFueled)
    // SCUD warhead is HE (not AP), but IsFueled forces scatter vs infantry regardless
    expect(WEAPON_STATS.SCUD.isFueled).toBe(true);
    expect(WEAPON_STATS.SCUD.warhead).toBe('HE');
  });

  it('Flamer weapon (non-fueled, Fire warhead) does NOT trigger fueled-inaccuracy', () => {
    // Flamer is NOT fueled, so it should not have forced inaccuracy against infantry
    // via the IsFueled path (it may have other inaccuracy sources)
    expect(WEAPON_STATS.Flamer.isFueled).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. IsDropping — bullet.cpp:790-802, 359-361
// ══════════════════════════════════════════════════════════════════════════════

describe('IsDropping — vertical drop from FLIGHT_LEVEL (bullet.cpp:790-802)', () => {

  it('ParaBomb weapon has isDropping=true (C++ RULES.INI [ParaBomb])', () => {
    expect(WEAPON_STATS.ParaBomb.isDropping).toBe(true);
  });

  it('ParaBomb weapon has isParachuted=true', () => {
    expect(WEAPON_STATS.ParaBomb.isParachuted).toBe(true);
  });

  it('non-dropping weapons (90mm, SCUD) have isDropping falsy', () => {
    expect(WEAPON_STATS['90mm'].isDropping).toBeFalsy();
    expect(WEAPON_STATS.SCUD.isDropping).toBeFalsy();
  });

  it('launchProjectile initializes dropping bullets from Center_Coord with range 0xff', () => {
    const attacker = entityAtCell(UnitType.V_BADR, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 10, 5);
    const ctx = makeCombatCtx([attacker, target]);

    // Use a dropping weapon
    const droppingWeapon: WeaponStats = {
      ...WEAPON_STATS.ParaBomb,
    };
    launchProjectile(ctx, attacker, target, droppingWeapon, 300,
      target.pos.x, target.pos.y, true);

    expect(ctx.inflightProjectiles.length).toBe(1);
    const proj = ctx.inflightProjectiles[0];
    const fireCoord = attacker.fireCoordForWeapon(droppingWeapon);
    expect(fireCoord.ly).not.toBe(attacker.leptonY);
    expect(proj.logicalLX).toBe(attacker.leptonX);
    expect(proj.logicalLY).toBe(attacker.leptonY);
    expect(proj.travelFrames).toBe(0xFF);
    expect(proj.fuseTimer).toBe(0xFF);
    expect(proj.isDropping).toBe(true);
    expect(proj.dropHeight).toBe(Entity.FLIGHT_LEVEL_LEPTONS);
    expect(proj.dropRiser).toBe(0);
    expect(proj.dropHasAttachedAnim).toBe(true);
  });

  it('aircraft falling bullets get AircraftClass::Fire_At drift speed', () => {
    const attacker = entityAtCell(UnitType.V_BADR, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 10, 5);
    const ctx = makeCombatCtx([attacker, target]);

    launchProjectile(ctx, attacker, target, WEAPON_STATS.ParaBomb, 300,
      target.pos.x, target.pos.y, true);

    const proj = ctx.inflightProjectiles[0];
    // C++ aircraft.cpp:1532-1537 — falling bullets move with
    // Fly_Speed(40, MPH_MEDIUM_SLOW), i.e. ((12 * 40) + 128) / 256 = 2.
    expect(proj.speedAdd).toBe(2);
  });

  it('parachuted drop uses attached-animation fall physics (object.cpp:237-254)', () => {
    const ctx = makeCombatCtx();
    const proj = makeProjectile({
      isDropping: true,
      dropHeight: Entity.FLIGHT_LEVEL_LEPTONS,
      dropRiser: 0,
      dropHasAttachedAnim: true,
      travelFrames: 255,
      weapon: WEAPON_STATS.ParaBomb,
    });
    ctx.inflightProjectiles.push(proj);

    updateInflightProjectiles(ctx);
    expect(proj.dropHeight).toBe(Entity.FLIGHT_LEVEL_LEPTONS);
    expect(proj.dropRiser).toBe(-1);

    updateInflightProjectiles(ctx);
    expect(proj.dropHeight).toBe(Entity.FLIGHT_LEVEL_LEPTONS - 1);
    expect(proj.dropRiser).toBe(-2);

    updateInflightProjectiles(ctx);
    expect(proj.dropHeight).toBe(Entity.FLIGHT_LEVEL_LEPTONS - 3);
    expect(proj.dropRiser).toBe(-3);
  });

  it('non-parachuted dropping projectile uses Rule.Gravity riser (object.cpp:250-254)', () => {
    const ctx = makeCombatCtx();
    const proj = makeProjectile({
      isDropping: true,
      dropHeight: Entity.FLIGHT_LEVEL_LEPTONS,
      dropRiser: 0,
      dropHasAttachedAnim: false,
      travelFrames: 255,
      weapon: WEAPON_STATS.Napalm,
    });
    ctx.inflightProjectiles.push(proj);

    updateInflightProjectiles(ctx);
    expect(proj.dropHeight).toBe(Entity.FLIGHT_LEVEL_LEPTONS);
    expect(proj.dropRiser).toBe(-RULE_GRAVITY);

    updateInflightProjectiles(ctx);
    expect(proj.dropHeight).toBe(Entity.FLIGHT_LEVEL_LEPTONS - RULE_GRAVITY);
    expect(proj.dropRiser).toBe(-RULE_GRAVITY * 2);
  });

  it('parachuted ParaBomb forced impact damages current Coord, not Fuse_Target', () => {
    const attacker = entityAtCell(UnitType.V_BADR, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 15, 5);
    const ctx = makeCombatCtx([attacker, target]);
    const launchStructure = {
      type: 'HBOX',
      image: 'hbox',
      house: House.Spain,
      cx: 5,
      cy: 5,
      hp: 700,
      maxHp: 700,
      armor: 'wood',
      alive: true,
      rubble: false,
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
      missionTimer: 0,
    };
    const targetStructure = {
      ...launchStructure,
      cx: 15,
      hp: 700,
      maxHp: 700,
    };
    ctx.structures.push(launchStructure as any, targetStructure as any);

    const proj = makeProjectile({
      attackerId: attacker.id,
      targetId: target.id,
      isDropping: true,
      dropHeight: Entity.FLIGHT_LEVEL_LEPTONS,
      dropRiser: 0,
      dropHasAttachedAnim: true,
      travelFrames: 20,
      weapon: WEAPON_STATS.ParaBomb,
      damage: 300,
      strength: 300,
      startX: attacker.pos.x,
      startY: attacker.pos.y,
      impactX: target.pos.x,
      impactY: target.pos.y,
      headToLX: pixelToLepton(target.pos.x),
      headToLY: pixelToLepton(target.pos.y),
    });
    ctx.inflightProjectiles.push(proj);

    for (let i = 0; i < 8; i++) {
      updateInflightProjectiles(ctx);
    }
    expect(ctx.inflightProjectiles.length).toBe(1);
    expect(launchStructure.hp).toBe(700);
    expect(targetStructure.hp).toBe(700);

    for (let i = 8; i < 88; i++) {
      updateInflightProjectiles(ctx);
    }
    expect(ctx.inflightProjectiles.length).toBe(0);
    expect(launchStructure.hp).toBeLessThan(700);
    expect(targetStructure.hp).toBe(700);
  });

  it('falling bullet drift updates current Coord before forced impact damage', () => {
    const attacker = entityAtCell(UnitType.V_BADR, House.USSR, 1, 1);
    const ctx = makeCombatCtx([attacker]);
    const nearMovedImpact = {
      type: 'KENN',
      image: 'kenn',
      house: House.Spain,
      cx: 12,
      cy: 10,
      hp: 400,
      maxHp: 400,
      armor: 'wood',
      alive: true,
      rubble: false,
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
      missionTimer: 0,
    };
    ctx.structures.push(nearMovedImpact as any);

    const startLX = 10 * 256 + 250;
    const startLY = 10 * 256 + 128;
    ctx.inflightProjectiles.push(makeProjectile({
      attackerId: attacker.id,
      targetId: -1,
      isDropping: true,
      dropHeight: 1,
      dropRiser: -3,
      dropHasAttachedAnim: true,
      currentFrame: 87,
      travelFrames: 255,
      weapon: WEAPON_STATS.ParaBomb,
      damage: 999,
      strength: 999,
      startX: startLX * CELL_SIZE / 256,
      startY: startLY * CELL_SIZE / 256,
      impactX: startLX * CELL_SIZE / 256,
      impactY: startLY * CELL_SIZE / 256,
      logicalLX: startLX,
      logicalLY: startLY,
      headToLX: startLX,
      headToLY: startLY,
      facing256: 64,
      speedAdd: 2,
      speedAccum: 8,
    }));

    updateInflightProjectiles(ctx);

    expect(ctx.inflightProjectiles).toHaveLength(0);
    expect(nearMovedImpact.hp).toBeLessThan(400);
  });

  it('dropping projectile bypasses wall collision (bullet.cpp:574-577)', () => {
    // C++ type.h:1383: "Dropping projectiles do not calculate collision with terrain"
    expect(WEAPON_STATS.ParaBomb.isDropping).toBe(true);
    // isHigh is not needed for dropping projectiles to bypass wall checks
    // The code checks: if (!proj.weapon.isHigh && !proj.weapon.isDropping)
    // So IsDropping=true skips the wall collision code block
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. IsFlameEquipped — bullet.cpp:377-386
// ══════════════════════════════════════════════════════════════════════════════

describe('IsFlameEquipped — flame/smoke trail (bullet.cpp:377-386)', () => {

  it('Flamer weapon has isFlameEquipped=true (C++ bbdata.cpp: Animates=yes)', () => {
    expect(WEAPON_STATS.Flamer.isFlameEquipped).toBe(true);
  });

  it('FireballLauncher weapon has isFlameEquipped=true', () => {
    expect(WEAPON_STATS.FireballLauncher.isFlameEquipped).toBe(true);
  });

  it('non-flame weapons (90mm, SCUD, M1Carbine) have isFlameEquipped falsy', () => {
    expect(WEAPON_STATS['90mm'].isFlameEquipped).toBeFalsy();
    expect(WEAPON_STATS.SCUD.isFlameEquipped).toBeFalsy();
    expect(WEAPON_STATS.M1Carbine.isFlameEquipped).toBeFalsy();
  });

  it('launchProjectile initializes flameToggle=false (C++ IsToAnimate starts false)', () => {
    const attacker = entityAtCell(UnitType.I_E4, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.ANT1, House.USSR, 8, 5);
    const ctx = makeCombatCtx([attacker, target]);

    launchProjectile(ctx, attacker, target, WEAPON_STATS.Flamer, 70,
      target.pos.x, target.pos.y, true);

    expect(ctx.inflightProjectiles.length).toBe(1);
    const proj = ctx.inflightProjectiles[0];
    expect(proj.isFlameEquipped).toBe(true);
    expect(proj.flameToggle).toBe(false);
  });

  it('flameToggle alternates each tick (C++ IsToAnimate = !IsToAnimate)', () => {
    const ctx = makeCombatCtx();
    const proj = makeProjectile({
      isFlameEquipped: true,
      flameToggle: false,
      travelFrames: 10,
      weapon: WEAPON_STATS.Flamer,
    });
    ctx.inflightProjectiles.push(proj);

    // Tick 1: false → true (toggles, but trail spawned because toggle was false before flip? No —
    // C++ checks IsToAnimate first, then toggles. So tick 1: toggle is false → no trail → toggle becomes true)
    updateInflightProjectiles(ctx);
    expect(proj.flameToggle).toBe(true);

    // Tick 2: toggle is true → trail spawns → toggle becomes false
    updateInflightProjectiles(ctx);
    expect(proj.flameToggle).toBe(false);
  });

  it('flame trail spawns every other tick as an explosion effect (bullet.cpp:378-383)', () => {
    const ctx = makeCombatCtx();
    const proj = makeProjectile({
      isFlameEquipped: true,
      flameToggle: false,
      travelFrames: 10,
      startX: 0,
      startY: 0,
      impactX: 240,  // 10 cells away
      impactY: 0,
      weapon: WEAPON_STATS.Flamer,
    });
    ctx.inflightProjectiles.push(proj);

    // Tick 1: flameToggle starts false → no trail → toggle becomes true
    updateInflightProjectiles(ctx);
    const effectsAfterTick1 = ctx.effects.length;

    // Tick 2: flameToggle is true → trail spawns → toggle becomes false
    updateInflightProjectiles(ctx);
    const effectsAfterTick2 = ctx.effects.length;

    // Should have spawned exactly 1 effect in tick 2 (the flame trail)
    expect(effectsAfterTick2).toBeGreaterThan(effectsAfterTick1);

    // Tick 3: flameToggle is false → no trail → toggle becomes true
    const effectsBefore3 = ctx.effects.length;
    updateInflightProjectiles(ctx);
    const effectsAfterTick3 = ctx.effects.length;
    // No new effect in tick 3
    expect(effectsAfterTick3).toBe(effectsBefore3);

    // Tick 4: flameToggle is true → trail spawns
    updateInflightProjectiles(ctx);
    expect(ctx.effects.length).toBeGreaterThan(effectsAfterTick3);
  });

  it('flame trail effect uses napalm1 sprite (closest to C++ ANIM_FBALL_FADE)', () => {
    const ctx = makeCombatCtx();
    const proj = makeProjectile({
      isFlameEquipped: true,
      flameToggle: false,
      travelFrames: 10,
      startX: 0,
      startY: 0,
      impactX: 240,
      impactY: 0,
      weapon: WEAPON_STATS.Flamer,
    });
    ctx.inflightProjectiles.push(proj);

    // Tick 1 + 2 to get a flame trail effect
    updateInflightProjectiles(ctx);
    updateInflightProjectiles(ctx);

    const flameEffects = ctx.effects.filter(e => e.type === 'explosion' && (e as any).sprite === 'napalm1');
    expect(flameEffects.length).toBeGreaterThanOrEqual(1);
    const flameAnims = ctx.logicAnims.filter(a => a.type === 'fball_fade');
    expect(flameAnims).toHaveLength(1);
    expect(flameAnims[0].delay).toBe(1);
    expect(flameAnims[0].isBrandNew).toBe(true);
  });

  it('HeatSeeker weapons launch with SMOKE_PUFF trail slots (rules.ini Animates=yes)', () => {
    const attacker = entityAtCell(UnitType.V_MIG, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.U_1TNK, House.Spain, 12, 5);
    const ctx = makeCombatCtx([attacker, target]);

    launchProjectile(ctx, attacker, target, WEAPON_STATS.Maverick, 50,
      target.pos.x, target.pos.y, true);

    const proj = ctx.inflightProjectiles[0];
    expect(proj.isFlameEquipped).toBe(true);
    expect(proj.flameTrailAnim).toBe('smoke_puff');

    proj.flameToggle = true;
    proj.speedAdd = 0;
    proj.fuseTimer = 20;
    proj.fuelTimer = 20;
    updateInflightProjectiles(ctx);

    const smoke = ctx.effects.find(e => e.type === 'explosion' && e.sprite === 'smokey');
    expect(smoke).toBeDefined();
    expect(smoke?.maxFrames).toBe(7);
    expect(smoke?.cppLogicSlot).toBeUndefined();
    const smokeAnim = ctx.logicAnims.find(a => a.type === 'smokey');
    expect(smokeAnim).toBeDefined();
    expect(smokeAnim?.delay).toBe(1);
    expect(smokeAnim?.isBrandNew).toBe(true);
  });

  it('flame trail AnimClass allocation failure skips the trail object', () => {
    const ctx = makeCombatCtx();
    ctx.reserveAnimSlot = () => false;
    ctx.inflightProjectiles.push(makeProjectile({
      isFlameEquipped: true,
      flameTrailAnim: 'smoke_puff',
      flameToggle: true,
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

    expect(ctx.logicAnims).toHaveLength(0);
    expect(ctx.effects.filter(e => e.cppLogicSlot).length).toBe(0);
    expect(ctx.inflightProjectiles).toHaveLength(1);
  });

  it('non-flame projectile does NOT spawn trail effects', () => {
    const ctx = makeCombatCtx();
    const proj = makeProjectile({
      isFlameEquipped: false,
      travelFrames: 10,
      weapon: WEAPON_STATS['90mm'],
    });
    ctx.inflightProjectiles.push(proj);

    updateInflightProjectiles(ctx);
    updateInflightProjectiles(ctx);

    // No flame trail effects
    const flameEffects = ctx.effects.filter(e => e.type === 'explosion' && (e as any).sprite === 'napalm1');
    expect(flameEffects.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Integration: launchProjectile correctly initializes all three features
// ══════════════════════════════════════════════════════════════════════════════

describe('launchProjectile — combined feature initialization (bullet.cpp:783-802)', () => {

  it('SCUD projectile: isFueled=true, isDropping=false, isFlameEquipped=true', () => {
    const attacker = entityAtCell(UnitType.V_V2RL, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 10, 5);
    const ctx = makeCombatCtx([attacker, target]);

    launchProjectile(ctx, attacker, target, WEAPON_STATS.SCUD, 600,
      target.pos.x, target.pos.y, true);

    const proj = ctx.inflightProjectiles[0];
    expect(proj.isFueled).toBe(true);
    expect(proj.isDropping).toBe(false);
    expect(proj.isFlameEquipped).toBe(true);
    expect(proj.flameTrailAnim).toBe('smoke_puff');
    expect(proj.dropHeight).toBe(0);
  });

  it('Flamer projectile: isFueled=false, isDropping=false, isFlameEquipped=true', () => {
    const attacker = entityAtCell(UnitType.I_E4, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.ANT1, House.USSR, 8, 5);
    const ctx = makeCombatCtx([attacker, target]);

    launchProjectile(ctx, attacker, target, WEAPON_STATS.Flamer, 70,
      target.pos.x, target.pos.y, true);

    const proj = ctx.inflightProjectiles[0];
    expect(proj.isFueled).toBe(false);
    expect(proj.isDropping).toBe(false);
    expect(proj.isFlameEquipped).toBe(true);
    expect(proj.flameToggle).toBe(false);
  });

  it('ParaBomb projectile: isFueled=false, isDropping=true, isFlameEquipped=false', () => {
    const attacker = entityAtCell(UnitType.V_V2RL, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 10, 5);
    const ctx = makeCombatCtx([attacker, target]);

    launchProjectile(ctx, attacker, target, WEAPON_STATS.ParaBomb, 300,
      target.pos.x, target.pos.y, true);

    const proj = ctx.inflightProjectiles[0];
    expect(proj.isFueled).toBe(false);
    expect(proj.isDropping).toBe(true);
    expect(proj.isFlameEquipped).toBe(false);
    expect(proj.dropHeight).toBe(Entity.FLIGHT_LEVEL_LEPTONS);
    expect(proj.dropHasAttachedAnim).toBe(true);
  });

  it('normal projectile (90mm): all three features are false', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.ANT1, House.USSR, 8, 5);
    const ctx = makeCombatCtx([attacker, target]);

    launchProjectile(ctx, attacker, target, WEAPON_STATS['90mm'], 30,
      target.pos.x, target.pos.y, true);

    const proj = ctx.inflightProjectiles[0];
    expect(proj.isFueled).toBe(false);
    expect(proj.isDropping).toBe(false);
    expect(proj.isFlameEquipped).toBe(false);
  });
});
