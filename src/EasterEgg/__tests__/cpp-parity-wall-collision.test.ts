/**
 * C++ Behavioral Parity: Projectile–Wall Collision (bullet.cpp:903-913)
 *
 * C++ Is_Forced_To_Explode checks if the bullet's current cell contains a
 * wall (high overlay). Non-high bullets explode on contact; high bullets
 * (missiles, rockets) fly over walls unimpeded.
 *
 * C++ source of truth:
 *   - type.h:1362-1365  — BulletTypeClass::IsHigh flag
 *   - bullet.cpp:903-913 — Is_Forced_To_Explode wall check
 *   - bbdata.cpp:79      — IsHigh defaults to false
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, WEAPON_STATS,
  buildDefaultAlliances, worldToCell,
  COUNTRY_BONUSES,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  type InflightProjectile,
  launchProjectile,
  updateInflightProjectiles,
  structureDamage,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  entities: Entity[] = [],
  structures: MapStructure[] = [],
): CombatContext {
  const map = new GameMap();
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

// ── Projectile hits wall and explodes (bullet.cpp:903-913) ──────────────────

describe('Non-high projectile hits wall (bullet.cpp:903-913)', () => {

  it('tank shell explodes at wall cell instead of reaching target', () => {
    // Attacker at cell (2,5), target at cell (8,5), wall at cell (5,5)
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 2, 5);
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 8, 5);
    const ctx = makeCombatCtx([attacker, target]);

    // Place a brick wall between attacker and target
    ctx.map.setWallType(5, 5, 'BRIK');

    // 90mm uses BULLET_CANNON — IsHigh=false (default)
    const weapon = { ...WEAPON_STATS['90mm'], projectileSpeed: 1.0 };
    launchProjectile(ctx, attacker, target, weapon, 30, target.pos.x, target.pos.y, true);

    expect(ctx.inflightProjectiles.length).toBe(1);
    const proj = ctx.inflightProjectiles[0];

    // Advance tick by tick until the projectile hits the wall or arrives
    let ticks = 0;
    while (ctx.inflightProjectiles.length > 0 && ticks < 50) {
      updateInflightProjectiles(ctx);
      ticks++;
    }

    // Projectile should have exploded at or near the wall cell (5,5) center
    // rather than reaching the target at cell (8,5)
    const wallCenterX = 5 * CELL_SIZE + CELL_SIZE / 2;
    const wallCenterY = 5 * CELL_SIZE + CELL_SIZE / 2;

    // Check that an explosion effect was spawned at the wall location
    const explosions = ctx.effects.filter(e => e.type === 'explosion');
    expect(explosions.length).toBeGreaterThan(0);

    // The explosion should be at the wall cell, not at the target
    const impactExplosion = explosions[0];
    const impactCell = worldToCell(impactExplosion.x, impactExplosion.y);
    expect(impactCell.cx).toBe(5);
    expect(impactCell.cy).toBe(5);
  });

  it('works with different wall types (SBAG, FENC, BARB, WOOD, CYCL)', () => {
    const wallTypes = ['SBAG', 'FENC', 'BARB', 'BRIK', 'WOOD', 'CYCL'];

    for (const wallType of wallTypes) {
      resetEntityIds();
      const attacker = entityAtCell(UnitType.V_1TNK, House.Spain, 2, 5);
      const target = entityAtCell(UnitType.V_1TNK, House.USSR, 8, 5);
      const ctx = makeCombatCtx([attacker, target]);

      ctx.map.setWallType(5, 5, wallType);

      const weapon = { ...WEAPON_STATS['75mm'], projectileSpeed: 1.0 };
      launchProjectile(ctx, attacker, target, weapon, 25, target.pos.x, target.pos.y, true);

      let ticks = 0;
      while (ctx.inflightProjectiles.length > 0 && ticks < 50) {
        updateInflightProjectiles(ctx);
        ticks++;
      }

      const explosions = ctx.effects.filter(e => e.type === 'explosion');
      expect(explosions.length, `${wallType} wall should cause explosion`).toBeGreaterThan(0);
      const impactCell = worldToCell(explosions[0].x, explosions[0].y);
      expect(impactCell.cx, `projectile should stop at ${wallType} wall cell`).toBe(5);
    }
  });
});

// ── High-flying projectile passes over wall ─────────────────────────────────

describe('High projectile flies over walls (bullet.cpp:911, type.h:1365)', () => {

  it('missile (isHigh=true) passes over wall and reaches target', () => {
    const attacker = entityAtCell(UnitType.V_4TNK, House.Spain, 2, 5);
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 8, 5);
    const targetHpBefore = target.hp;
    const ctx = makeCombatCtx([attacker, target]);

    // Place wall between attacker and target
    ctx.map.setWallType(5, 5, 'BRIK');

    // MammothTusk has isHigh: true (BULLET_LASER_GUIDED)
    const weapon = { ...WEAPON_STATS['MammothTusk'], projectileSpeed: 1.0 };
    expect(weapon.isHigh).toBe(true);

    launchProjectile(ctx, attacker, target, weapon, 75, target.pos.x, target.pos.y, true);

    let ticks = 0;
    while (ctx.inflightProjectiles.length > 0 && ticks < 50) {
      updateInflightProjectiles(ctx);
      ticks++;
    }

    // The missile should reach the target, not the wall
    const explosions = ctx.effects.filter(e => e.type === 'explosion');
    expect(explosions.length).toBeGreaterThan(0);
    const impactCell = worldToCell(explosions[0].x, explosions[0].y);
    expect(impactCell.cx).toBe(8); // target cell, not wall cell 5
    expect(impactCell.cy).toBe(5);

    // Target should have taken damage (direct hit)
    expect(target.hp).toBeLessThan(targetHpBefore);
  });

  it('SCUD rocket (isHigh=true) flies over wall', () => {
    expect(WEAPON_STATS['SCUD'].isHigh).toBe(true);
  });

  it('Dragon missile (isHigh=true) flies over wall', () => {
    expect(WEAPON_STATS['Dragon'].isHigh).toBe(true);
  });

  it('RedEye missile (isHigh=true) flies over wall', () => {
    expect(WEAPON_STATS['RedEye'].isHigh).toBe(true);
  });
});

// ── No wall in path — projectile reaches target normally ────────────────────

describe('Projectile with no wall in path reaches target (baseline)', () => {

  it('tank shell reaches target when no walls exist', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 2, 5);
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 6, 5);
    const targetHpBefore = target.hp;
    const ctx = makeCombatCtx([attacker, target]);

    // No wall placed — clear path
    const weapon = { ...WEAPON_STATS['90mm'], projectileSpeed: 1.0 };
    launchProjectile(ctx, attacker, target, weapon, 30, target.pos.x, target.pos.y, true);

    let ticks = 0;
    while (ctx.inflightProjectiles.length > 0 && ticks < 50) {
      updateInflightProjectiles(ctx);
      ticks++;
    }

    // Target should take damage
    expect(target.hp).toBeLessThan(targetHpBefore);

    // Explosion should be at target cell
    const explosions = ctx.effects.filter(e => e.type === 'explosion');
    expect(explosions.length).toBeGreaterThan(0);
    const impactCell = worldToCell(explosions[0].x, explosions[0].y);
    expect(impactCell.cx).toBe(6);
    expect(impactCell.cy).toBe(5);
  });
});

// ── Wall takes damage from projectile explosion splash ──────────────────────

describe('Wall takes splash damage from projectile collision (combat.cpp:244-270)', () => {

  it('wall in splash radius is destroyed by HE warhead splash', () => {
    const attacker = entityAtCell(UnitType.V_ARTY, House.Spain, 2, 5);
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 8, 5);
    const ctx = makeCombatCtx([attacker, target]);

    // Place a sandbag wall in the projectile path
    ctx.map.setWallType(5, 5, 'SBAG');

    // 155mm artillery: HE warhead with splash, isHigh=false so it stops at the wall
    // HE warhead has destroysWalls=true (WARHEAD_META)
    const weapon = { ...WEAPON_STATS['155mm'], projectileSpeed: 1.0, isArcing: false, isHigh: false };
    launchProjectile(ctx, attacker, target, weapon, 150, target.pos.x, target.pos.y, true);

    let ticks = 0;
    while (ctx.inflightProjectiles.length > 0 && ticks < 50) {
      updateInflightProjectiles(ctx);
      ticks++;
    }

    // The HE splash with destroysWalls=true should clear the wall
    // (handled by applySplashDamage terrain destruction code)
    expect(ctx.map.getWallType(5, 5)).toBe('');
  });
});

// ── Multiple walls in path — projectile hits first one ──────────────────────

describe('Multiple walls in path — projectile hits first wall', () => {

  it('projectile stops at the first wall encountered along its flight path', () => {
    // Attacker at cell (2,5), target at cell (10,5)
    // Walls at cells (5,5) and (7,5) — should hit cell 5 first
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 2, 5);
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 5);
    const ctx = makeCombatCtx([attacker, target]);

    ctx.map.setWallType(5, 5, 'BRIK');
    ctx.map.setWallType(7, 5, 'BRIK');

    const weapon = { ...WEAPON_STATS['90mm'], projectileSpeed: 1.0 };
    launchProjectile(ctx, attacker, target, weapon, 30, target.pos.x, target.pos.y, true);

    let ticks = 0;
    while (ctx.inflightProjectiles.length > 0 && ticks < 50) {
      updateInflightProjectiles(ctx);
      ticks++;
    }

    // Should explode at the FIRST wall (cell 5), not the second (cell 7)
    const explosions = ctx.effects.filter(e => e.type === 'explosion');
    expect(explosions.length).toBeGreaterThan(0);
    const impactCell = worldToCell(explosions[0].x, explosions[0].y);
    expect(impactCell.cx).toBe(5);
    expect(impactCell.cy).toBe(5);
  });
});

// ── isHigh flag correctness on weapon data ──────────────────────────────────

describe('Weapon isHigh flag matches C++ BulletTypeClass (bbdata.cpp)', () => {

  it('cannon/shell weapons are NOT high (default IsHigh=false)', () => {
    // These use BULLET_CANNON or BULLET_INVISIBLE — IsHigh defaults to false
    expect(WEAPON_STATS['75mm'].isHigh).toBeFalsy();
    expect(WEAPON_STATS['90mm'].isHigh).toBeFalsy();
    expect(WEAPON_STATS['105mm'].isHigh).toBeFalsy();
    expect(WEAPON_STATS['120mm'].isHigh).toBeFalsy();
    expect(WEAPON_STATS['M1Carbine'].isHigh).toBeFalsy();
    expect(WEAPON_STATS['M60mg'].isHigh).toBeFalsy();
  });

  it('arcing/lobbed weapons ARE high (C++ INI High=yes)', () => {
    // 155mm (Ballistic) and Grenade (Lobbed) have High=yes in INI
    expect(WEAPON_STATS['155mm'].isHigh).toBe(true);
    expect(WEAPON_STATS['Grenade'].isHigh).toBe(true);
  });

  it('missile/rocket weapons ARE high (C++ RULES.INI High=yes)', () => {
    // These use BULLET_HEAT_SEEKER, BULLET_LASER_GUIDED, BULLET_FROG — High=yes
    expect(WEAPON_STATS['Dragon'].isHigh).toBe(true);
    expect(WEAPON_STATS['RedEye'].isHigh).toBe(true);
    expect(WEAPON_STATS['MammothTusk'].isHigh).toBe(true);
    expect(WEAPON_STATS['SCUD'].isHigh).toBe(true);
    expect(WEAPON_STATS['SubSCUD'].isHigh).toBe(true);
    expect(WEAPON_STATS['Maverick'].isHigh).toBe(true);
    expect(WEAPON_STATS['Hellfire'].isHigh).toBe(true);
    expect(WEAPON_STATS['APTusk'].isHigh).toBe(true);
  });
});
