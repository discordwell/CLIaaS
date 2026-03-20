/**
 * C++ Behavioral Parity: Advanced Combat — Torpedo, Flame Trail, Dog-Rides-Bullet,
 * AA Proximity, Fuel Timer
 *
 * Tests verify five untested combat behaviors match C++ RA source code:
 *
 * 1. bullet.cpp:920-941 — Torpedo water boundary:
 *    Subsurface projectiles (torpedoes) check land type each frame and
 *    force-explode if they leave water (LAND_WATER).
 *
 * 2. bullet.cpp:377-386 — Flame trail alternation (IsToAnimate):
 *    IsFlameEquipped projectiles spawn flame/smoke trail effects every OTHER
 *    tick via flameToggle (starts false, toggled each tick).
 *
 * 3. bullet.cpp:96-175 — Dog-rides-bullet unlimbo:
 *    When a dog attacks, it enters limbo (hidden from map) and rides the
 *    projectile. On impact, the dog unlimbos at the impact point, falling
 *    back to 8 adjacent cells if impact cell is impassable. If all 9 cells
 *    fail, the dog is deleted.
 *
 * 4. bullet.cpp:946-948 — AA proximity detonation:
 *    Anti-aircraft projectiles detonate early when within half a cell
 *    (0x0080 leptons = CELL_SIZE/2 pixels) of an airborne aircraft target.
 *
 * 5. fuse.cpp:127-139, bullet.cpp:710 — Fuel timer force-explode:
 *    IsFueled projectiles (SCUD/V2) decrement fuelTimer each tick. When
 *    fuelTimer reaches 0, the projectile force-explodes mid-air regardless
 *    of remaining travel distance.
 *
 * C++ source is the source of truth. These tests describe WHAT happens
 * (observable outcomes), not HOW the code implements it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, WEAPON_STATS,
  buildDefaultAlliances, worldToCell,
  COUNTRY_BONUSES, AnimState, Mission,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  type InflightProjectile,
  launchProjectile,
  updateInflightProjectiles,
} from '../engine/combat';
import { GameMap, Terrain } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  entities: Entity[] = [],
  map?: GameMap,
  structures: MapStructure[] = [],
): CombatContext {
  const gameMap = map ?? new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
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
    map: gameMap,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
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

/** Build a full InflightProjectile with all required fields */
function makeProjectile(
  attackerId: number,
  targetId: number,
  weapon: typeof WEAPON_STATS[string],
  startX: number,
  startY: number,
  impactX: number,
  impactY: number,
  travelFrames: number,
  overrides: Partial<InflightProjectile> = {},
): InflightProjectile {
  return {
    attackerId,
    targetId,
    weapon,
    damage: weapon.damage,
    strength: weapon.damage,
    speed: 1,
    travelFrames,
    currentFrame: 0,
    directHit: true,
    impactX,
    impactY,
    attackerIsPlayer: true,
    isArcing: weapon.isArcing ?? false,
    arcHeight: weapon.isArcing ? 1 : 0,
    arcRiser: weapon.isArcing ? 10 : 0,
    startX,
    startY,
    dogRiderId: -1,
    fuelTimer: Math.min(0xFF, travelFrames + 4),
    isFueled: !!(weapon as any).isFueled,
    isDropping: !!(weapon as any).isDropping,
    dropHeight: (weapon as any).isDropping ? 24 : 0,
    isFlameEquipped: !!(weapon as any).isFlameEquipped,
    flameToggle: false,
    ...overrides,
  };
}

// =============================================================================
// 1. Torpedo water boundary checks — C++ bullet.cpp:920-941
// =============================================================================

describe('torpedo water boundary (bullet.cpp:920-941)', () => {

  it('torpedo force-explodes when entering a land cell', () => {
    // Water from columns 5-8, land (CLEAR) from column 9 onward
    const map = new GameMap();
    for (let cx = 5; cx <= 8; cx++) {
      map.setTerrain(cx, 5, Terrain.WATER);
    }

    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 14, 5);
    const ctx = makeCombatCtx([attacker, target], map);

    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.TorpTube,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      40, // long travel — would reach col 14 if not stopped
    );
    ctx.inflightProjectiles.push(proj);

    // Advance until torpedo detonates
    let exploded = false;
    for (let i = 0; i < 40; i++) {
      updateInflightProjectiles(ctx);
      if (ctx.inflightProjectiles.length === 0) {
        // Impact should be at the first non-water cell, NOT at the target
        const impactCell = worldToCell(proj.impactX, proj.impactY);
        expect(impactCell.cx).toBeGreaterThanOrEqual(9);
        expect(impactCell.cx).toBeLessThan(14);
        exploded = true;
        break;
      }
    }

    expect(exploded).toBe(true);
  });

  it('torpedo stays inflight while traveling through water cells', () => {
    // All-water path — torpedo should NOT be force-exploded
    const map = new GameMap();
    for (let cx = 0; cx < 20; cx++) {
      map.setTerrain(cx, 5, Terrain.WATER);
    }

    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 10, 5);
    const ctx = makeCombatCtx([attacker, target], map);

    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.TorpTube,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      15,
    );
    ctx.inflightProjectiles.push(proj);

    // Run 14 frames — should still be inflight
    for (let i = 0; i < 14; i++) {
      updateInflightProjectiles(ctx);
    }
    expect(proj.currentFrame).toBe(14);
    expect(ctx.inflightProjectiles.length).toBe(1);

    // Frame 15 — normal arrival
    updateInflightProjectiles(ctx);
    expect(ctx.inflightProjectiles.length).toBe(0);
  });

  it('non-torpedo projectile ignores water-to-land transition', () => {
    // Water 5-8, land from 9 — non-torpedo should fly through unimpeded
    const map = new GameMap();
    for (let cx = 5; cx <= 8; cx++) {
      map.setTerrain(cx, 5, Terrain.WATER);
    }

    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 12, 5);
    const ctx = makeCombatCtx([attacker, target], map);

    // 75mm — not isSubSurface
    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS['75mm'],
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      20,
    );
    ctx.inflightProjectiles.push(proj);

    for (let i = 0; i < 19; i++) {
      updateInflightProjectiles(ctx);
    }
    // Should still be inflight at frame 19 (arrives at 20)
    expect(proj.currentFrame).toBe(19);
    expect(ctx.inflightProjectiles.length).toBe(1);
  });

  it('torpedo on ROCK terrain also force-explodes (any non-WATER)', () => {
    const map = new GameMap();
    // Water columns 5-7, ROCK at column 8
    for (let cx = 5; cx <= 7; cx++) {
      map.setTerrain(cx, 5, Terrain.WATER);
    }
    map.setTerrain(8, 5, Terrain.ROCK);

    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 14, 5);
    const ctx = makeCombatCtx([attacker, target], map);

    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.TorpTube,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      40,
    );
    ctx.inflightProjectiles.push(proj);

    let exploded = false;
    for (let i = 0; i < 40; i++) {
      updateInflightProjectiles(ctx);
      if (ctx.inflightProjectiles.length === 0) {
        const impactCell = worldToCell(proj.impactX, proj.impactY);
        // Should explode at column 8 (ROCK) or earlier
        expect(impactCell.cx).toBeLessThanOrEqual(8);
        exploded = true;
        break;
      }
    }
    expect(exploded).toBe(true);
  });
});

// =============================================================================
// 2. Flame trail alternation — C++ bullet.cpp:377-386 (IsToAnimate)
// =============================================================================

describe('flame trail alternation (bullet.cpp:377-386, IsToAnimate)', () => {

  it('isFlameEquipped projectile spawns trail effect every OTHER tick', () => {
    const attacker = entityAtCell(UnitType.I_E4, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 15, 5);
    const ctx = makeCombatCtx([attacker, target]);

    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.Flamer,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      10,
      { isFlameEquipped: true, flameToggle: false },
    );
    ctx.inflightProjectiles.push(proj);

    // Track effects spawned per tick
    const trailTicksWithEffects: number[] = [];
    const trailTicksWithoutEffects: number[] = [];

    for (let tick = 1; tick <= 8; tick++) {
      const effectsBefore = ctx.effects.length;
      updateInflightProjectiles(ctx);
      const newEffects = ctx.effects.length - effectsBefore;

      // Separate trail effects from impact effects (only count explosion-type at trail positions)
      if (newEffects > 0) {
        trailTicksWithEffects.push(tick);
      } else {
        trailTicksWithoutEffects.push(tick);
      }
    }

    // C++ IsToAnimate starts false, toggled each tick:
    // Tick 1: toggle to true → spawn trail
    // Tick 2: toggle to false → no trail
    // Tick 3: toggle to true → spawn trail
    // ...pattern: odd ticks spawn, even ticks don't
    expect(trailTicksWithEffects.length).toBeGreaterThan(0);
    expect(trailTicksWithoutEffects.length).toBeGreaterThan(0);

    // Every pair of consecutive trail ticks should differ by 2 (alternating)
    for (let i = 1; i < trailTicksWithEffects.length; i++) {
      expect(trailTicksWithEffects[i] - trailTicksWithEffects[i - 1]).toBe(2);
    }
  });

  it('flameToggle starts false (C++ IsToAnimate=false at init)', () => {
    const attacker = entityAtCell(UnitType.I_E4, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 15, 5);
    const ctx = makeCombatCtx([attacker, target]);

    // Use launchProjectile to verify initialization
    launchProjectile(
      ctx, attacker, target, WEAPON_STATS.Flamer,
      70, target.pos.x, target.pos.y, true,
    );

    expect(ctx.inflightProjectiles.length).toBe(1);
    expect(ctx.inflightProjectiles[0].flameToggle).toBe(false);
    expect(ctx.inflightProjectiles[0].isFlameEquipped).toBe(true);
  });

  it('non-flame projectile does not spawn trail effects', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 15, 5);
    const ctx = makeCombatCtx([attacker, target]);

    // 90mm — NOT isFlameEquipped
    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS['90mm'],
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      10,
    );
    ctx.inflightProjectiles.push(proj);

    // Run 8 ticks — no trail effects should spawn
    for (let i = 0; i < 8; i++) {
      updateInflightProjectiles(ctx);
    }

    // The only effects should be the impact explosion at the end, not trails during flight
    // No 'napalm1' trail sprites should appear before impact
    const trailEffects = ctx.effects.filter(
      e => e.type === 'explosion' && (e as any).sprite === 'napalm1'
    );
    expect(trailEffects.length).toBe(0);
  });

  it('trail effects are at interpolated positions along flight path', () => {
    const attacker = entityAtCell(UnitType.I_E4, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.I_E4, House.USSR, 15, 5);
    const ctx = makeCombatCtx([attacker, target]);

    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.Flamer,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      20,
      { isFlameEquipped: true, flameToggle: false },
    );
    ctx.inflightProjectiles.push(proj);

    // Run 6 ticks (3 should produce trail effects)
    for (let i = 0; i < 6; i++) {
      updateInflightProjectiles(ctx);
    }

    // Trail effects should be between start and impact positions
    const trails = ctx.effects.filter(e => e.type === 'explosion');
    for (const trail of trails) {
      expect(trail.x).toBeGreaterThanOrEqual(attacker.pos.x);
      expect(trail.x).toBeLessThanOrEqual(target.pos.x);
    }
  });
});

// =============================================================================
// 3. Dog-rides-bullet unlimbo — C++ bullet.cpp:96-175, infantry.cpp:3649-3654
// =============================================================================

describe('dog-rides-bullet unlimbo (bullet.cpp:96-175)', () => {

  it('dog enters limbo when launching projectile', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 7, 5);
    dog.target = target;
    const ctx = makeCombatCtx([dog, target]);

    // C++ infantry.cpp:3649-3654 — dog enters limbo on fire
    launchProjectile(
      ctx, dog, target, WEAPON_STATS.DogJaw,
      100, target.pos.x, target.pos.y, true,
    );

    // Dog should be in limbo
    expect(dog.inLimbo).toBe(true);
    // Projectile should carry the dog's ID
    expect(ctx.inflightProjectiles[0].dogRiderId).toBe(dog.id);
  });

  it('dog unlimbos at impact point when cell is passable', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 8, 5);
    dog.target = target;
    const ctx = makeCombatCtx([dog, target]);

    launchProjectile(
      ctx, dog, target, WEAPON_STATS.DogJaw,
      100, target.pos.x, target.pos.y, true,
    );

    expect(dog.inLimbo).toBe(true);

    // Advance until projectile arrives
    let ticks = 0;
    while (ctx.inflightProjectiles.length > 0 && ticks < 50) {
      updateInflightProjectiles(ctx);
      ticks++;
    }

    // Dog should have exited limbo
    expect(dog.inLimbo).toBe(false);
    expect(dog.alive).toBe(true);

    // Dog should be at or near the impact cell
    const dogCell = worldToCell(dog.pos.x, dog.pos.y);
    const impactCell = worldToCell(target.pos.x, target.pos.y);
    // C++ bullet.cpp:134-161 — impact cell first, then 8 adjacent
    const dist = Math.abs(dogCell.cx - impactCell.cx) + Math.abs(dogCell.cy - impactCell.cy);
    expect(dist).toBeLessThanOrEqual(1); // at impact or 1 cell adjacent
  });

  it('dog performs maul animation after unlimbo (bullet.cpp:152)', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 8, 5);
    dog.target = target;
    const ctx = makeCombatCtx([dog, target]);

    launchProjectile(
      ctx, dog, target, WEAPON_STATS.DogJaw,
      100, target.pos.x, target.pos.y, true,
    );

    while (ctx.inflightProjectiles.length > 0) {
      updateInflightProjectiles(ctx);
    }

    // C++ bullet.cpp:152 — Do_Action(DO_DOG_MAUL, true)
    expect(dog.animState).toBe(AnimState.ATTACK);
    expect(dog.animFrame).toBe(0);
  });

  it('dog falls back to adjacent cell when impact cell is impassable', () => {
    const map = new GameMap();
    // Make impact cell (8,5) impassable
    map.setTerrain(8, 5, Terrain.ROCK);
    // Surrounding cells passable (default CLEAR)

    const dog = entityAtCell(UnitType.I_DOG, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 8, 5);
    dog.target = target;
    const ctx = makeCombatCtx([dog, target], map);

    launchProjectile(
      ctx, dog, target, WEAPON_STATS.DogJaw,
      100, target.pos.x, target.pos.y, true,
    );

    while (ctx.inflightProjectiles.length > 0) {
      updateInflightProjectiles(ctx);
    }

    // Dog should still be alive and out of limbo
    expect(dog.inLimbo).toBe(false);
    expect(dog.alive).toBe(true);

    // Dog should be in an adjacent passable cell, NOT at (8,5)
    const dogCell = worldToCell(dog.pos.x, dog.pos.y);
    expect(dogCell.cx !== 8 || dogCell.cy !== 5).toBe(true);

    // Must be within 1 cell of impact point
    const dist = Math.max(Math.abs(dogCell.cx - 8), Math.abs(dogCell.cy - 5));
    expect(dist).toBeLessThanOrEqual(1);
  });

  it('dog is deleted when all 9 positions are impassable (bullet.cpp:165-167)', () => {
    const map = new GameMap();
    // Make impact cell (8,5) and all 8 adjacent cells impassable
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        map.setTerrain(8 + dx, 5 + dy, Terrain.ROCK);
      }
    }

    const dog = entityAtCell(UnitType.I_DOG, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 8, 5);
    dog.target = target;
    const ctx = makeCombatCtx([dog, target], map);

    launchProjectile(
      ctx, dog, target, WEAPON_STATS.DogJaw,
      100, target.pos.x, target.pos.y, true,
    );

    while (ctx.inflightProjectiles.length > 0) {
      updateInflightProjectiles(ctx);
    }

    // C++ bullet.cpp:165-167 — if (!unlimbo) delete dog
    expect(dog.alive).toBe(false);
    expect(dog.inLimbo).toBe(false);
    expect(dog.mission).toBe(Mission.DIE);
  });

  it('non-dog unit does NOT enter limbo when firing', () => {
    const soldier = entityAtCell(UnitType.I_E1, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.USSR, 8, 5);
    const ctx = makeCombatCtx([soldier, target]);

    launchProjectile(
      ctx, soldier, target, WEAPON_STATS.M1Carbine,
      15, target.pos.x, target.pos.y, true,
    );

    // Regular infantry should NOT enter limbo
    expect(soldier.inLimbo).toBe(false);
    expect(ctx.inflightProjectiles[0].dogRiderId).toBe(-1);
  });
});

// =============================================================================
// 4. AA proximity detonation — C++ bullet.cpp:946-948
// =============================================================================

describe('AA proximity detonation (bullet.cpp:946-948)', () => {

  it('AA projectile detonates within half a cell of airborne target', () => {
    const attacker = entityAtCell(UnitType.I_E3, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.V_HELI, House.USSR, 10, 5);
    target.flightAltitude = 24; // airborne

    const ctx = makeCombatCtx([attacker, target]);

    // RedEye is isAntiAir: true
    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.RedEye,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      20,
    );
    ctx.inflightProjectiles.push(proj);

    // Track when the projectile detonates
    let detonatedFrame = -1;
    for (let i = 0; i < 20; i++) {
      updateInflightProjectiles(ctx);
      if (ctx.inflightProjectiles.length === 0) {
        detonatedFrame = proj.currentFrame;
        break;
      }
    }

    // C++ Distance(TarCom) < 0x0080: proximity detonation should trigger early
    expect(detonatedFrame).toBeGreaterThan(0);
    expect(detonatedFrame).toBeLessThan(20); // detonated before normal arrival
  });

  it('AA projectile impact position snaps to target position on proximity detonation', () => {
    const attacker = entityAtCell(UnitType.I_E3, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.V_HIND, House.USSR, 10, 5);
    target.flightAltitude = 24;

    const ctx = makeCombatCtx([attacker, target]);

    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.RedEye,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      20,
    );
    ctx.inflightProjectiles.push(proj);

    while (ctx.inflightProjectiles.length > 0) {
      updateInflightProjectiles(ctx);
    }

    // C++ bullet.cpp:946-948: impactX/Y should be set to target position
    expect(proj.impactX).toBe(target.pos.x);
    expect(proj.impactY).toBe(target.pos.y);
  });

  it('AA projectile does NOT proximity-detonate against ground targets', () => {
    const attacker = entityAtCell(UnitType.I_E3, House.Spain, 5, 5);
    // Ground vehicle — not aircraft, or aircraft on ground
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 8, 5);

    const ctx = makeCombatCtx([attacker, target]);

    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.RedEye,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      10,
    );
    ctx.inflightProjectiles.push(proj);

    // Run 9 frames — should NOT detonate early
    for (let i = 0; i < 9; i++) {
      updateInflightProjectiles(ctx);
    }

    expect(proj.currentFrame).toBe(9);
    expect(ctx.inflightProjectiles.length).toBe(1);
  });

  it('AA projectile does NOT proximity-detonate against landed aircraft (altitude=0)', () => {
    const attacker = entityAtCell(UnitType.I_E3, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.V_HELI, House.USSR, 8, 5);
    target.flightAltitude = 0; // landed

    const ctx = makeCombatCtx([attacker, target]);

    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.RedEye,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      10,
    );
    ctx.inflightProjectiles.push(proj);

    for (let i = 0; i < 9; i++) {
      updateInflightProjectiles(ctx);
    }

    // No early detonation — aircraft on ground
    expect(proj.currentFrame).toBe(9);
    expect(ctx.inflightProjectiles.length).toBe(1);
  });

  it('non-AA projectile does NOT proximity-detonate even near airborne target', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.V_HELI, House.USSR, 8, 5);
    target.flightAltitude = 24;

    const ctx = makeCombatCtx([attacker, target]);

    // 90mm is NOT isAntiAir
    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS['90mm'],
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      10,
    );
    ctx.inflightProjectiles.push(proj);

    for (let i = 0; i < 9; i++) {
      updateInflightProjectiles(ctx);
    }

    // Non-AA: must reach full travel frames, no proximity detonation
    expect(proj.currentFrame).toBe(9);
    expect(ctx.inflightProjectiles.length).toBe(1);
  });
});

// =============================================================================
// 5. Fuel timer force-explode — C++ fuse.cpp:127-139, bullet.cpp:710
// =============================================================================

describe('fuel timer force-explode (fuse.cpp:127-139, bullet.cpp:710)', () => {

  it('isFueled projectile (SCUD) explodes when fuelTimer reaches 0', () => {
    const attacker = entityAtCell(UnitType.V_V2RL, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 15, 5);
    const ctx = makeCombatCtx([attacker, target]);

    // Manually create a fueled projectile with a short fuel timer
    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.SCUD,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      30, // 30 frames travel
      {
        isFueled: true,
        fuelTimer: 8, // runs out of fuel at tick 8
      },
    );
    ctx.inflightProjectiles.push(proj);

    // Advance 7 ticks — fuelTimer should go from 8 to 1
    for (let i = 0; i < 7; i++) {
      updateInflightProjectiles(ctx);
    }
    expect(ctx.inflightProjectiles.length).toBe(1); // still inflight
    expect(proj.fuelTimer).toBe(1);

    // Tick 8: fuelTimer goes from 1 to 0 → force-explode
    updateInflightProjectiles(ctx);
    expect(ctx.inflightProjectiles.length).toBe(0); // removed
  });

  it('fuel timer decrements each tick (fuse.cpp:127)', () => {
    const attacker = entityAtCell(UnitType.V_V2RL, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 15, 5);
    const ctx = makeCombatCtx([attacker, target]);

    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.SCUD,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      50,
      {
        isFueled: true,
        fuelTimer: 20,
      },
    );
    ctx.inflightProjectiles.push(proj);

    // After 5 ticks, fuelTimer should be 20 - 5 = 15
    for (let i = 0; i < 5; i++) {
      updateInflightProjectiles(ctx);
    }
    expect(proj.fuelTimer).toBe(15);

    // After 10 more, should be 5
    for (let i = 0; i < 10; i++) {
      updateInflightProjectiles(ctx);
    }
    expect(proj.fuelTimer).toBe(5);
  });

  it('fueled projectile reaching target before fuel runs out detonates normally', () => {
    const attacker = entityAtCell(UnitType.V_V2RL, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 8, 5);
    const ctx = makeCombatCtx([attacker, target]);

    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS.SCUD,
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      5, // arrives in 5 frames
      {
        isFueled: true,
        fuelTimer: 20, // plenty of fuel
      },
    );
    ctx.inflightProjectiles.push(proj);

    // Advance 5 frames — should arrive normally
    for (let i = 0; i < 5; i++) {
      updateInflightProjectiles(ctx);
    }

    expect(ctx.inflightProjectiles.length).toBe(0);
    // fuelTimer should still have fuel remaining
    expect(proj.fuelTimer).toBe(15); // 20 - 5
  });

  it('launchProjectile initializes fuelTimer to min(0xFF, travelFrames+4) for fueled weapons', () => {
    const attacker = entityAtCell(UnitType.V_V2RL, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 5);
    const ctx = makeCombatCtx([attacker, target]);

    launchProjectile(
      ctx, attacker, target, WEAPON_STATS.SCUD,
      600, target.pos.x, target.pos.y, true,
    );

    expect(ctx.inflightProjectiles.length).toBe(1);
    const proj = ctx.inflightProjectiles[0];

    // C++ fuse.cpp: fuel timer = min(0xFF, travelFrames + 4)
    expect(proj.isFueled).toBe(true);
    expect(proj.fuelTimer).toBe(Math.min(0xFF, proj.travelFrames + 4));
  });

  it('non-fueled projectile does NOT force-explode when fuelTimer reaches 0', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 5);
    const ctx = makeCombatCtx([attacker, target]);

    // 90mm is NOT isFueled — fuelTimer decrement should not cause early detonation
    const proj = makeProjectile(
      attacker.id, target.id, WEAPON_STATS['90mm'],
      attacker.pos.x, attacker.pos.y,
      target.pos.x, target.pos.y,
      10,
      {
        isFueled: false,
        fuelTimer: 3, // would run out at tick 3 if it were fueled
      },
    );
    ctx.inflightProjectiles.push(proj);

    // Run 5 ticks — should NOT detonate even though fuelTimer reaches 0
    for (let i = 0; i < 5; i++) {
      updateInflightProjectiles(ctx);
    }
    expect(ctx.inflightProjectiles.length).toBe(1);
    expect(proj.currentFrame).toBe(5);
  });

  it('SCUD weapon data has isFueled=true (C++ RULES.INI Fueled=yes)', () => {
    expect((WEAPON_STATS.SCUD as any).isFueled).toBe(true);
  });
});
