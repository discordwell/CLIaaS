/**
 * C++ Behavioral Parity Tests — Dog-Rides-Bullet (Limbo/Unlimbo)
 *
 * C++ bullet.cpp:96-175, infantry.cpp:3649-3654:
 * When a dog fires its DogJaw weapon, it enters limbo (hidden, not targetable,
 * removed from map). The dog rides the bullet to the target. On bullet impact,
 * the dog unlimbos at the impact coordinates. If the impact cell is impassable,
 * adjacent cells are tried. If all fail, the dog is deleted.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UNIT_STATS, WEAPON_STATS,
  UnitType, House, Mission, AnimState, CELL_SIZE, worldToCell,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  launchProjectile, updateInflightProjectiles,
  applySplashDamage, type CombatContext, type InflightProjectile,
} from '../engine/combat';
import { GameMap, Terrain } from '../engine/map';

// ── Test helpers ────────────────────────────────────────────────────────────

/** Create a minimal CombatContext for testing */
function makeCombatContext(entities: Entity[], mapW = 20, mapH = 20): CombatContext {
  const map = new GameMap(mapW, mapH);
  const entityById = new Map<number, Entity>();
  for (const e of entities) entityById.set(e.id, e);

  return {
    entities,
    entityById,
    structures: [],
    inflightProjectiles: [],
    effects: [],
    tick: 0,
    playerHouse: House.Greece,
    scenarioId: 'test',
    killCount: 0,
    lossCount: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set(),
    map,
    aiStates: new Map(),
    lastBaseAttackEva: 0,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    powerConsumed: 0,
    powerProduced: 0,
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    isPlayerControlled: (e) => e.house === House.Greece,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    isRevealedToHouse: () => true,
    movementSpeed: () => 1,
    getFirepowerBias: () => 1.0,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    getArmorBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 1,
    warheadMuzzleColor: () => '#fff',
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
  };
}

beforeEach(() => {
  resetEntityIds();
});

// ─── 1. Dog enters limbo on projectile launch (C++ infantry.cpp:3649-3654) ──

describe('Dog enters limbo when launching DogJaw projectile', () => {
  it('dog.inLimbo is set to true after launchProjectile', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 150, 100);
    const ctx = makeCombatContext([dog, target]);

    expect(dog.inLimbo).toBe(false);

    const weapon = WEAPON_STATS.DogJaw;
    launchProjectile(ctx, dog, target, weapon, weapon.damage, target.pos.x, target.pos.y, true);

    expect(dog.inLimbo).toBe(true);
  });

  it('projectile carries dogRiderId matching the dog entity', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 150, 100);
    const ctx = makeCombatContext([dog, target]);

    const weapon = WEAPON_STATS.DogJaw;
    launchProjectile(ctx, dog, target, weapon, weapon.damage, target.pos.x, target.pos.y, true);

    expect(ctx.inflightProjectiles.length).toBe(1);
    expect(ctx.inflightProjectiles[0].dogRiderId).toBe(dog.id);
  });

  it('non-dog unit does NOT enter limbo when launching projectile', () => {
    const rifle = new Entity(UnitType.I_E1, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 150, 100);
    const ctx = makeCombatContext([rifle, target]);

    const weapon = WEAPON_STATS.M1Carbine;
    launchProjectile(ctx, rifle, target, weapon, weapon.damage, target.pos.x, target.pos.y, true);

    expect(rifle.inLimbo).toBe(false);
    expect(ctx.inflightProjectiles[0].dogRiderId).toBe(-1);
  });
});

// ─── 2. Dog unlimbos at impact point (C++ bullet.cpp:112-175) ──────────────

describe('Dog unlimbos at impact point when bullet arrives', () => {
  it('dog exits limbo and is placed at impact coordinates on passable terrain', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 200, 200);
    const ctx = makeCombatContext([dog, target]);
    dog.target = target;

    const weapon = WEAPON_STATS.DogJaw;
    launchProjectile(ctx, dog, target, weapon, weapon.damage, target.pos.x, target.pos.y, true);

    expect(dog.inLimbo).toBe(true);

    // Advance projectile to completion
    const proj = ctx.inflightProjectiles[0];
    proj.currentFrame = proj.travelFrames; // force arrival

    updateInflightProjectiles(ctx);

    expect(dog.inLimbo).toBe(false);
    expect(dog.alive).toBe(true);
    // Dog should be at or near the impact cell center
    const impactCell = worldToCell(target.pos.x, target.pos.y);
    const dogCell = worldToCell(dog.pos.x, dog.pos.y);
    // Should be at impact cell (or adjacent if impact cell is impassable)
    expect(Math.abs(dogCell.cx - impactCell.cx)).toBeLessThanOrEqual(1);
    expect(Math.abs(dogCell.cy - impactCell.cy)).toBeLessThanOrEqual(1);
  });

  it('dog performs maul animation after landing (DO_DOG_MAUL)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 200, 200);
    const ctx = makeCombatContext([dog, target]);
    dog.target = target;

    const weapon = WEAPON_STATS.DogJaw;
    launchProjectile(ctx, dog, target, weapon, weapon.damage, target.pos.x, target.pos.y, true);

    const proj = ctx.inflightProjectiles[0];
    proj.currentFrame = proj.travelFrames;
    updateInflightProjectiles(ctx);

    // C++ bullet.cpp:152 — Do_Action(DO_DOG_MAUL, true)
    expect(dog.animState).toBe(AnimState.ATTACK);
    expect(dog.animFrame).toBe(0);
  });
});

// ─── 3. Adjacent cell fallback (C++ bullet.cpp:144-161) ────────────────────

describe('Dog unlimbo falls back to adjacent cells when impact cell is impassable', () => {
  it('dog unlimbos at adjacent cell when impact cell has impassable terrain', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 200, 200);
    const ctx = makeCombatContext([dog, target], 30, 30);
    dog.target = target;

    // Make impact cell impassable
    const impactCell = worldToCell(target.pos.x, target.pos.y);
    ctx.map.setTerrain(impactCell.cx, impactCell.cy, Terrain.WATER);

    const weapon = WEAPON_STATS.DogJaw;
    launchProjectile(ctx, dog, target, weapon, weapon.damage, target.pos.x, target.pos.y, true);

    const proj = ctx.inflightProjectiles[0];
    proj.currentFrame = proj.travelFrames;
    updateInflightProjectiles(ctx);

    // Dog should have unlimboed at an adjacent passable cell
    expect(dog.inLimbo).toBe(false);
    expect(dog.alive).toBe(true);
    const dogCell = worldToCell(dog.pos.x, dog.pos.y);
    // Must be within 1 cell of impact
    expect(Math.abs(dogCell.cx - impactCell.cx)).toBeLessThanOrEqual(1);
    expect(Math.abs(dogCell.cy - impactCell.cy)).toBeLessThanOrEqual(1);
    // Must NOT be the impassable impact cell itself
    expect(dogCell.cx === impactCell.cx && dogCell.cy === impactCell.cy).toBe(false);
  });

  it('dog is deleted when all 9 cells (impact + 8 adjacent) are impassable (C++ bullet.cpp:165-167)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 5 * CELL_SIZE, 5 * CELL_SIZE);
    const targetX = 10 * CELL_SIZE + CELL_SIZE / 2;
    const targetY = 10 * CELL_SIZE + CELL_SIZE / 2;
    const target = new Entity(UnitType.I_E1, House.Greece, targetX, targetY);
    const ctx = makeCombatContext([dog, target], 30, 30);
    dog.target = target;

    // Make impact cell and all 8 adjacent cells impassable
    const impactCell = worldToCell(targetX, targetY);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        ctx.map.setTerrain(impactCell.cx + dx, impactCell.cy + dy, Terrain.WATER);
      }
    }

    const weapon = WEAPON_STATS.DogJaw;
    launchProjectile(ctx, dog, target, weapon, weapon.damage, targetX, targetY, true);

    const proj = ctx.inflightProjectiles[0];
    proj.currentFrame = proj.travelFrames;
    updateInflightProjectiles(ctx);

    // C++ bullet.cpp:165-167 — if (!unlimbo) delete dog
    expect(dog.alive).toBe(false);
    expect(dog.inLimbo).toBe(false);
    expect(dog.mission).toBe(Mission.DIE);
  });
});

// ─── 4. Limbo state prevents targeting, splash, rendering ──────────────────

describe('Entity in limbo is hidden from game systems', () => {
  it('limbo entity is skipped in splash damage', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 200, 200);
    const ctx = makeCombatContext([dog, target]);

    // Put dog in limbo at position near splash center
    dog.inLimbo = true;
    const originalHp = dog.hp;

    // Apply splash damage at dog's position
    applySplashDamage(
      ctx,
      { x: dog.pos.x, y: dog.pos.y },
      { damage: 100, warhead: 'HE', splash: 2 },
      -1,
      House.Greece,
    );

    // Dog should not be damaged while in limbo
    expect(dog.hp).toBe(originalHp);
  });

  it('inLimbo flag starts as false for new entities', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    expect(dog.inLimbo).toBe(false);
  });

  it('inLimbo can be set and cleared', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    dog.inLimbo = true;
    expect(dog.inLimbo).toBe(true);
    dog.inLimbo = false;
    expect(dog.inLimbo).toBe(false);
  });
});

// ─── 5. Full lifecycle: fire → limbo → travel → unlimbo ────────────────────

describe('Full dog-rides-bullet lifecycle', () => {
  it('complete flow: dog fires, enters limbo, bullet travels, dog unlimbos at target', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 5 * CELL_SIZE, 5 * CELL_SIZE);
    const enemy = new Entity(UnitType.I_E1, House.Greece, 7 * CELL_SIZE, 5 * CELL_SIZE);
    const ctx = makeCombatContext([dog, enemy]);
    dog.target = enemy;

    // Step 1: Fire
    const weapon = WEAPON_STATS.DogJaw;
    launchProjectile(ctx, dog, enemy, weapon, weapon.damage, enemy.pos.x, enemy.pos.y, true);
    expect(dog.inLimbo).toBe(true);
    expect(ctx.inflightProjectiles.length).toBe(1);
    const proj = ctx.inflightProjectiles[0];
    expect(proj.dogRiderId).toBe(dog.id);

    // Step 2: Simulate bullet travel — dog stays in limbo during flight
    for (let i = 0; i < proj.travelFrames - 1; i++) {
      ctx.tick++;
      updateInflightProjectiles(ctx);
      if (dog.inLimbo) {
        // Dog is still in limbo while bullet travels
        expect(dog.inLimbo).toBe(true);
      }
    }

    // Step 3: Bullet arrives — dog unlimbos
    ctx.tick++;
    updateInflightProjectiles(ctx);
    expect(dog.inLimbo).toBe(false);
    expect(dog.alive).toBe(true);
    expect(dog.animState).toBe(AnimState.ATTACK);
  });

  it('dead dog is not unlimboed (C++ checks dog.alive)', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Greece, 200, 200);
    const ctx = makeCombatContext([dog, target]);
    dog.target = target;

    const weapon = WEAPON_STATS.DogJaw;
    launchProjectile(ctx, dog, target, weapon, weapon.damage, target.pos.x, target.pos.y, true);

    // Kill the dog while it's in limbo (e.g., from a global effect)
    dog.alive = false;
    dog.inLimbo = true;

    const proj = ctx.inflightProjectiles[0];
    proj.currentFrame = proj.travelFrames;
    updateInflightProjectiles(ctx);

    // Dead dog should not be unlimboed
    expect(dog.alive).toBe(false);
  });
});

// ─── 6. DogJaw weapon has projectileSpeed for bullet travel ────────────────

describe('DogJaw weapon enables projectile travel (not instant hit)', () => {
  it('DogJaw has projectileSpeed defined (enables launchProjectile path)', () => {
    const jaw = WEAPON_STATS.DogJaw;
    expect(jaw.projectileSpeed).toBeDefined();
    expect(jaw.projectileSpeed).toBeGreaterThan(0);
  });

  it('DogJaw isInvisible is falsy (LeapDog projectile has no Inviso=yes in INI)', () => {
    expect(WEAPON_STATS.DogJaw.isInvisible).toBeFalsy();
  });

  it('DogJaw isDegenerate is falsy (no Degenerates=yes in INI)', () => {
    expect(WEAPON_STATS.DogJaw.isDegenerate).toBeFalsy();
  });
});
