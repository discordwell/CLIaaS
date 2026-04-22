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
  UnitType, House, Mission, AnimState, CELL_SIZE, Stance,
  UNIT_STATS, WEAPON_STATS, CONDITION_RED,
  type WarheadType, type ArmorType,
  WARHEAD_VS_ARMOR, WARHEAD_META, WARHEAD_PROPS,
  COUNTRY_BONUSES,
  worldDist, worldToCell, buildDefaultAlliances,
pixelToLepton, leptonToCell, } from '../engine/types';
import { Entity, resetEntityIds, CloakState, setPlayerHouses } from '../engine/entity';
import { GameMap, Terrain } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import { STRUCTURE_MAX_HP } from '../engine/scenario';
import type { Effect } from '../engine/renderer';
import type { MissionAIContext } from '../engine/missionAI';
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
    const startX = entity.pos.x;
    updateAttack(ctx, entity);

    // Entity should have moved toward target
    expect(entity.animState).toBe(AnimState.WALK);
    expect(entity.pos.x).toBeGreaterThan(startX);
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
    entity.firePrepStage = 1; // Graphic_Logic would advance stage each tick in the real loop
    updateAttack(ctx, entity);
    expect(entity.attackCooldown).toBe(0); // still in prep
    entity.firePrepStage = 2;
    updateAttack(ctx, entity);

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
      // E4 FireLaunch=2 (idata.cpp:464) — 3 updateAttack calls to reach Fire_At.
      updateAttack(ctx, e4);
      e4.firePrepStage = 1;
      updateAttack(ctx, e4);
      e4.firePrepStage = 2;
      updateAttack(ctx, e4);

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
      // E4 FireLaunch=2 — 3 updateAttack calls required to fire.
      updateAttack(ctx, e4);
      e4.firePrepStage = 1;
      updateAttack(ctx, e4);
      e4.firePrepStage = 2;
      updateAttack(ctx, e4);

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
      tank.turretFacing32 = 2 * 4; // keep 32-step in sync with 8-dir (Dir.E → 8)
      tank.desiredTurretFacing = 2;
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

    it('instant-hit weapon (M1Carbine) still passes modified damage to damageEntity', () => {
      // Rifleman firing M1Carbine (SA, 15 dmg, NO projectileSpeed — instant-hit path).
      // Instant-hit path is intentionally UNCHANGED by the projectile fix:
      //   damageEntity receives the already-modified damage (single application),
      //   matching the pre-existing behavior that currently-passing parity scenarios
      //   depend on.
      // SA vs none = 1.0, so raw and modified are the same (15). This test locks in
      // behavior so a future regression would be immediately visible.
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
      e1.firePrepStage = 1;
      updateAttack(ctx, e1);
      e1.firePrepStage = 2;
      updateAttack(ctx, e1);

      // M1Carbine has no projectileSpeed → instant-hit path → damageEntity is called,
      // launchProjectile is NOT called.
      expect(ctx.launchProjectile).not.toHaveBeenCalled();
      expect(ctx.damageEntity).toHaveBeenCalled();
      const dmgCallArgs = (ctx.damageEntity as any).mock.calls[0];
      const [dmgTarget, dmgAmount] = dmgCallArgs;
      expect(dmgTarget).toBe(enemy);
      // SA vs none = 1.0, Spain FirepowerBias = 1.0 → damage unchanged by warhead mult
      expect(dmgAmount).toBe(15);
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

  it('entity engages found enemy by switching to ATTACK when in range', () => {
    const hunter = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    hunter.mission = Mission.HUNT;

    // Place enemy within weapon range (3 cells = 72px)
    const enemy = makeEntity(UnitType.I_E1, House.USSR, 340, 300);
    hunter.target = enemy;

    const ctx = makeMockContext({ entities: [hunter, enemy] });
    updateHunt(ctx, hunter);

    expect(hunter.mission).toBe(Mission.ATTACK);
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
    const hunter = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    hunter.mission = Mission.HUNT;
    hunter.target = null;

    // Enemy structure within hunt range
    const struct = makeStructure('POWR', House.USSR, 15, 15);
    const ctx = makeMockContext({ entities: [hunter], structures: [struct] });

    updateHunt(ctx, hunter);

    expect(hunter.mission).toBe(Mission.ATTACK);
    expect(hunter.targetStructure).toBe(struct);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. updateRetreat
// ═══════════════════════════════════════════════════════════════════════════

describe('updateRetreat', () => {
  it('entity moves toward map edge', () => {
    // Place entity near left edge of bounds (boundsX=10, so cell 12 is 2 from left edge)
    const entity = makeEntity(UnitType.I_E1, House.Spain, 12 * CELL_SIZE + 12, 35 * CELL_SIZE + 12);
    entity.mission = Mission.RETREAT;
    entity.moveTarget = null;

    const ctx = makeMockContext({ entities: [entity] });
    updateRetreat(ctx, entity);

    // Should have set a move target toward the nearest map edge
    expect(entity.moveTarget).not.toBeNull();
    // Nearest edge should be left (boundsX=10) since entity is at cx=12
    const targetCell = leptonToCell(entity.moveTarget!.lx, entity.moveTarget!.ly);
    expect(targetCell.cx).toBe(10); // left edge
  });

  it('entity removed when reaching edge', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.RETREAT;
    // Set moveTarget to current position (simulating arrival)
    entity.moveTarget = { lx: pixelToLepton(300), ly: pixelToLepton(300) };

    const ctx = makeMockContext({ entities: [entity] });
    updateRetreat(ctx, entity);

    // moveToward returns true when at target, so entity should be removed
    expect(entity.alive).toBe(false);
    expect(entity.mission).toBe(Mission.DIE);
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
    expect(guard.moveTarget!.lx).toBe(pixelToLepton(300));
    expect(guard.moveTarget!.ly).toBe(pixelToLepton(300));
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

  it('entity engages enemy while returning home when too far', () => {
    const guard = makeEntity(UnitType.I_E1, House.Spain, 500, 500);
    guard.mission = Mission.AREA_GUARD;
    guard.guardOrigin = { x: 300, y: 300 };
    guard.lastGuardScan = 0;

    // Place enemy within sight range of current position (not origin)
    const enemy = makeEntity(UnitType.I_E1, House.USSR, 520, 500);
    const ctx = makeMockContext({ entities: [guard, enemy] });

    updateAreaGuard(ctx, guard);

    // Should attack the enemy even while returning
    expect(guard.mission).toBe(Mission.ATTACK);
    expect(guard.target).toBe(enemy);
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
  it('entity attacks target structure when in range', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;
    entity.attackCooldown = 0;

    // Place structure within weapon range (3 cells)
    const struct = makeStructure('POWR', House.USSR,
      Math.floor(300 / CELL_SIZE), Math.floor(300 / CELL_SIZE));

    const ctx = makeMockContext({ entities: [entity], structures: [struct] });
    updateAttackStructure(ctx, entity, struct);

    expect(ctx.damageStructure).toHaveBeenCalled();
    expect(entity.attackCooldown).toBeGreaterThan(0);
  });

  it('entity moves toward structure when out of range', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;

    // Place structure far away (20 cells)
    const struct = makeStructure('POWR', House.USSR, 40, 40);
    const startX = entity.pos.x;

    const ctx = makeMockContext({ entities: [entity], structures: [struct] });
    updateAttackStructure(ctx, entity, struct);

    expect(entity.animState).toBe(AnimState.WALK);
    // Entity should have moved toward the structure
    expect(entity.pos.x).toBeGreaterThan(startX);
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
  it('entity fires at ground position when in range', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;
    entity.attackCooldown = 0;
    entity.forceFirePos = { x: 330, y: 300 }; // ~1.25 cells away, within range 3

    const ctx = makeMockContext({ entities: [entity] });
    updateForceFireGround(ctx, entity);

    expect(entity.animState).toBe(AnimState.ATTACK);
    expect(entity.attackCooldown).toBeGreaterThan(0);
    expect(ctx.playSoundAt).toHaveBeenCalled();
    // Effects should be created (muzzle + projectile + explosion)
    expect(ctx.effects.length).toBeGreaterThanOrEqual(2);
  });

  it('entity moves toward target if out of range', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;
    entity.forceFirePos = { x: 600, y: 300 }; // ~12.5 cells away, out of range

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

    // E1 fires and consumes last ammo
    expect(entity.ammo).toBe(0);
    expect(entity.mission).toBe(Mission.GUARD);
  });

  it('applies splash damage when weapon has splash', () => {
    // Use a unit with splash weapon — grenadier (E2) has Grenade with splash 1.5
    const entity = makeEntity(UnitType.I_E2, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;
    entity.attackCooldown = 0;
    entity.forceFirePos = { x: 330, y: 300 };

    const ctx = makeMockContext({ entities: [entity] });
    updateForceFireGround(ctx, entity);

    expect(ctx.applySplashDamage).toHaveBeenCalled();
  });

  it('adds terrain decal at impact', () => {
    const entity = makeEntity(UnitType.I_E1, House.Spain, 300, 300);
    entity.mission = Mission.ATTACK;
    entity.attackCooldown = 0;
    entity.forceFirePos = { x: 330, y: 300 };

    const ctx = makeMockContext({ entities: [entity] });
    const decalsBefore = ctx.map.decals.length;
    updateForceFireGround(ctx, entity);

    expect(ctx.map.decals.length).toBeGreaterThan(decalsBefore);
  });
});
