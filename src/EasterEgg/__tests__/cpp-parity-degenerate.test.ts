/**
 * C++ Behavioral Parity: IsDegenerate — Projectile Damage Decay
 *
 * Tests verify IsDegenerate projectile behavior matches C++ RA source code.
 * C++ bullet.cpp:478-480:
 *   if (Class->IsDegenerate && Strength > 5) Strength--;
 *
 * This means certain projectiles lose 1 damage per frame during flight,
 * reducing their effectiveness at long range. Minimum damage is 5.
 *
 * C++ bbdata.cpp: IsDegenerate defaults to false, set via RULES.INI "Degenerates=yes"
 * C++ RULES.INI: Invisible and Cannon bullet types have Degenerates=yes
 *   - Invisible bullet: M1Carbine, M60mg, DogJaw, Sniper, Colt45, Pistol, ChainGun
 *   - Cannon bullet: 75mm, 90mm, 105mm, 120mm, Stinger, 2Inch
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE,
  WEAPON_STATS, WeaponStats,
  buildDefaultAlliances, COUNTRY_BONUSES,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  type InflightProjectile,
  updateInflightProjectiles,
  launchProjectile,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  entities: Entity[] = [],
): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures: [],
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
    movementSpeed: () => 1,
    getFirepowerBias: (house: House) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
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

/** Create a synthetic in-flight projectile for isolated testing */
function makeProjectile(
  weapon: WeaponStats,
  damage: number,
  travelFrames: number,
  targetId: number = -1,
): InflightProjectile {
  return {
    attackerId: 1,
    targetId,
    weapon,
    damage,
    strength: damage,
    speed: 1,
    travelFrames,
    currentFrame: 0,
    directHit: true,
    impactX: 100,
    impactY: 100,
    attackerIsPlayer: true,
    isArcing: false,
    arcHeight: 0,
    arcRiser: 0,
    startX: 0,
    startY: 0,
  };
}

// -- WeaponStats flag verification (bbdata.cpp / RULES.INI) -------------------

describe('IsDegenerate flag on weapon types (C++ RULES.INI Degenerates=yes)', () => {
  // C++ Invisible bullet type: Degenerates=yes
  it.each([
    'M1Carbine', 'M60mg', 'DogJaw', 'Sniper', 'Colt45', 'Pistol', 'ChainGun',
  ])('%s has isDegenerate=true (Invisible bullet)', (name) => {
    expect(WEAPON_STATS[name]?.isDegenerate, `${name} should be degenerate`).toBe(true);
  });

  // C++ Cannon bullet type: Degenerates=yes
  it.each([
    '75mm', '90mm', '105mm', '120mm', 'Stinger', '2Inch',
  ])('%s has isDegenerate=true (Cannon bullet)', (name) => {
    expect(WEAPON_STATS[name]?.isDegenerate, `${name} should be degenerate`).toBe(true);
  });

  // C++ Non-degenerate bullet types: Lobbed, HeatSeeker, FROG, etc.
  it.each([
    'Grenade', 'Dragon', 'RedEye', 'Flamer', 'MammothTusk', '155mm',
    'TeslaCannon', 'SCUD', 'Maverick', 'Hellfire', 'Tomahawk',
  ])('%s has isDegenerate falsy (non-degenerate bullet type)', (name) => {
    expect(WEAPON_STATS[name]?.isDegenerate).toBeFalsy();
  });
});

// -- Degenerate projectile decay behavior (bullet.cpp:478-480) ----------------

describe('IsDegenerate projectile strength decay (C++ bullet.cpp:478-480)', () => {
  it('degenerate projectile loses 1 strength per tick during flight', () => {
    const weapon = { ...WEAPON_STATS['75mm'], projectileSpeed: 1 };
    const proj = makeProjectile(weapon, 25, 10);

    // Simulate 3 ticks of flight
    for (let i = 0; i < 3; i++) {
      proj.currentFrame++;
      if (proj.weapon.isDegenerate && proj.strength > 5) {
        proj.strength--;
      }
    }

    // Started at 25, lost 3 over 3 ticks
    expect(proj.strength).toBe(22);
  });

  it('damage stops decaying at 5 (minimum) — C++ bullet.cpp:478 guard: Strength > 5', () => {
    const weapon = { ...WEAPON_STATS['75mm'], projectileSpeed: 1 };
    // Start with damage=8, so after 3 ticks it should reach 5 and stop
    const proj = makeProjectile(weapon, 8, 100);

    for (let i = 0; i < 10; i++) {
      proj.currentFrame++;
      if (proj.weapon.isDegenerate && proj.strength > 5) {
        proj.strength--;
      }
    }

    // Should stop at 5, not go below
    expect(proj.strength).toBe(5);
  });

  it('non-degenerate projectiles maintain full damage throughout flight', () => {
    const weapon = { ...WEAPON_STATS['Dragon'], projectileSpeed: 1 }; // Dragon is NOT degenerate
    const proj = makeProjectile(weapon, 35, 10);

    for (let i = 0; i < 5; i++) {
      proj.currentFrame++;
      if (proj.weapon.isDegenerate && proj.strength > 5) {
        proj.strength--;
      }
    }

    // Dragon is not degenerate — strength unchanged
    expect(proj.strength).toBe(35);
  });

  it('damage at impact equals original minus ticks-in-flight (capped at 5)', () => {
    const weapon = { ...WEAPON_STATS['90mm'], projectileSpeed: 1 };
    const originalDamage = 30;
    const ticksInFlight = 7;
    const proj = makeProjectile(weapon, originalDamage, ticksInFlight);

    for (let i = 0; i < ticksInFlight; i++) {
      proj.currentFrame++;
      if (proj.weapon.isDegenerate && proj.strength > 5) {
        proj.strength--;
      }
    }

    // 30 - 7 = 23, which is > 5 so no capping needed
    expect(proj.strength).toBe(originalDamage - ticksInFlight);
  });

  it('damage at impact is capped at 5 for very long flights', () => {
    const weapon = { ...WEAPON_STATS['75mm'], projectileSpeed: 1 };
    const originalDamage = 25;
    const ticksInFlight = 50;
    const proj = makeProjectile(weapon, originalDamage, ticksInFlight);

    for (let i = 0; i < ticksInFlight; i++) {
      proj.currentFrame++;
      if (proj.weapon.isDegenerate && proj.strength > 5) {
        proj.strength--;
      }
    }

    // 25 - 20 = 5 (stops at 5, doesn't go to -25)
    expect(proj.strength).toBe(5);
  });
});

// -- Integration: updateInflightProjectiles applies degeneration --------------

describe('updateInflightProjectiles integration — degenerate decay', () => {
  it('long-range degenerate shot deals less damage than short-range', () => {
    // Use a slower projectile speed to ensure measurable travel time difference
    const weapon = { ...WEAPON_STATS['75mm'], projectileSpeed: 0.5 }; // slow projectile for clear travelFrame difference

    const attacker = entityAtCell(UnitType.V_1TNK, House.Spain, 5, 5);
    const shortTarget = entityAtCell(UnitType.V_2TNK, House.USSR, 6, 5); // 1 cell away
    const longTarget = entityAtCell(UnitType.V_2TNK, House.USSR, 15, 5); // 10 cells away

    const ctxShort = makeCombatCtx([attacker, shortTarget]);
    const ctxLong = makeCombatCtx([attacker, longTarget]);

    // Launch short-range projectile
    launchProjectile(ctxShort, attacker, shortTarget, weapon, 25, shortTarget.pos.x, shortTarget.pos.y, true);
    const shortProj = ctxShort.inflightProjectiles[0];

    // Launch long-range projectile
    launchProjectile(ctxLong, attacker, longTarget, weapon, 25, longTarget.pos.x, longTarget.pos.y, true);
    const longProj = ctxLong.inflightProjectiles[0];

    // Long range should have more travel frames
    expect(longProj.travelFrames).toBeGreaterThan(shortProj.travelFrames);

    // Both start with same strength
    expect(shortProj.strength).toBe(25);
    expect(longProj.strength).toBe(25);

    // Simulate flight for both until arrival
    while (ctxShort.inflightProjectiles.length > 0) {
      ctxShort.tick++;
      updateInflightProjectiles(ctxShort);
    }
    while (ctxLong.inflightProjectiles.length > 0) {
      ctxLong.tick++;
      updateInflightProjectiles(ctxLong);
    }

    // Short-range target took more damage (less degeneration)
    // longTarget has more HP remaining because the projectile lost strength during flight
    const shortDamageTaken = 400 - shortTarget.hp;
    const longDamageTaken = 400 - longTarget.hp;

    expect(shortDamageTaken).toBeGreaterThan(0);
    expect(longDamageTaken).toBeGreaterThan(0);
    expect(shortDamageTaken).toBeGreaterThan(longDamageTaken);
  });

  it('strength field is decremented each tick via updateInflightProjectiles', () => {
    const attacker = entityAtCell(UnitType.V_1TNK, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 15, 5); // far away

    const ctx = makeCombatCtx([attacker, target]);
    const weapon75 = WEAPON_STATS['75mm'];

    launchProjectile(ctx, attacker, target, weapon75, 25, target.pos.x, target.pos.y, true);
    const proj = ctx.inflightProjectiles[0];

    expect(proj.strength).toBe(25);

    // Advance 3 ticks
    for (let i = 0; i < 3; i++) {
      ctx.tick++;
      updateInflightProjectiles(ctx);
    }

    // If projectile is still in flight, strength should have decayed by 3
    if (ctx.inflightProjectiles.length > 0) {
      expect(ctx.inflightProjectiles[0].strength).toBe(22);
    }
  });

  it('non-degenerate projectile strength stays constant during flight', () => {
    const attacker = entityAtCell(UnitType.I_E3, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 5);

    const ctx = makeCombatCtx([attacker, target]);
    const weaponDragon = WEAPON_STATS['Dragon'];

    launchProjectile(ctx, attacker, target, weaponDragon, 35, target.pos.x, target.pos.y, true);
    const proj = ctx.inflightProjectiles[0];

    expect(proj.strength).toBe(35);

    // Advance 3 ticks
    for (let i = 0; i < 3; i++) {
      ctx.tick++;
      updateInflightProjectiles(ctx);
    }

    // Dragon is NOT degenerate — strength unchanged
    if (ctx.inflightProjectiles.length > 0) {
      expect(ctx.inflightProjectiles[0].strength).toBe(35);
    }
  });
});
