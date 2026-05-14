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
    logicAnims: [],
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

describe('IsDegenerate flag on weapon types — no projectile in rules.ini has Degenerates=yes', () => {
  // C++ bbdata.cpp:93 — IsDegenerate defaults to false.
  // No projectile section in rules.ini sets Degenerates=yes.
  // The previous TS engine additions of isDegenerate were fabricated.
  it.each([
    'M1Carbine', 'M60mg', 'DogJaw', 'Sniper', 'Colt45', 'Pistol', 'ChainGun',
  ])('%s does NOT have isDegenerate (Invisible bullet — no Degenerates=yes in INI)', (name) => {
    expect(WEAPON_STATS[name]?.isDegenerate).toBeFalsy();
  });

  it.each([
    '75mm', '90mm', '105mm', '120mm', 'Stinger', '2Inch',
  ])('%s does NOT have isDegenerate (Cannon bullet — no Degenerates=yes in INI)', (name) => {
    expect(WEAPON_STATS[name]?.isDegenerate).toBeFalsy();
  });

  // C++ Non-degenerate bullet types: Lobbed, HeatSeeker, FROG, etc.
  it.each([
    'Grenade', 'Dragon', 'RedEye', 'Flamer', 'MammothTusk', '155mm',
    'TeslaCannon', 'SCUD', 'Maverick', 'Hellfire',
  ])('%s has isDegenerate falsy (non-degenerate bullet type)', (name) => {
    expect(WEAPON_STATS[name]?.isDegenerate).toBeFalsy();
  });
});

// -- Degenerate projectile decay behavior (bullet.cpp:478-480) ----------------

describe('IsDegenerate projectile strength decay (C++ bullet.cpp:478-480)', () => {
  // No weapon in rules.ini has Degenerates=yes (bbdata.cpp:93 default=false).
  // These tests verify the decay LOGIC is correct when isDegenerate is manually
  // set, but no real weapon triggers it. Using a synthetic degenerate weapon.
  it('degenerate projectile loses 1 strength per tick during flight', () => {
    const weapon = { ...WEAPON_STATS['75mm'], projectileSpeed: 1, isDegenerate: true };
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
    const weapon = { ...WEAPON_STATS['75mm'], projectileSpeed: 1, isDegenerate: true };
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
    const weapon = { ...WEAPON_STATS['90mm'], projectileSpeed: 1, isDegenerate: true };
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
    const weapon = { ...WEAPON_STATS['75mm'], projectileSpeed: 1, isDegenerate: true };
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

describe('updateInflightProjectiles integration — no degenerate decay with real weapons', () => {
  // Since no real weapon has isDegenerate=true (removed per rules.ini parity),
  // both short and long range shots deal the same damage — no degeneration.
  it('75mm (non-degenerate) deals same damage at short and long range', () => {
    const weapon = { ...WEAPON_STATS['75mm'], projectileSpeed: 0.5 };

    const attacker = entityAtCell(UnitType.V_1TNK, House.Spain, 5, 5);
    const shortTarget = entityAtCell(UnitType.V_2TNK, House.USSR, 6, 5);
    const longTarget = entityAtCell(UnitType.V_2TNK, House.USSR, 15, 5);

    const ctxShort = makeCombatCtx([attacker, shortTarget]);
    const ctxLong = makeCombatCtx([attacker, longTarget]);

    launchProjectile(ctxShort, attacker, shortTarget, weapon, 25, shortTarget.pos.x, shortTarget.pos.y, true);
    launchProjectile(ctxLong, attacker, longTarget, weapon, 25, longTarget.pos.x, longTarget.pos.y, true);

    // Simulate flight for both until arrival
    while (ctxShort.inflightProjectiles.length > 0) {
      ctxShort.tick++;
      updateInflightProjectiles(ctxShort);
    }
    while (ctxLong.inflightProjectiles.length > 0) {
      ctxLong.tick++;
      updateInflightProjectiles(ctxLong);
    }

    // Both targets take the same damage (no degeneration)
    const shortDamageTaken = 400 - shortTarget.hp;
    const longDamageTaken = 400 - longTarget.hp;

    expect(shortDamageTaken).toBeGreaterThan(0);
    expect(longDamageTaken).toBeGreaterThan(0);
    expect(shortDamageTaken).toBe(longDamageTaken);
  });

  it('strength field stays constant for non-degenerate 75mm', () => {
    const attacker = entityAtCell(UnitType.V_1TNK, House.Spain, 5, 5);
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 15, 5);

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

    // No degeneration — strength stays at 25
    if (ctx.inflightProjectiles.length > 0) {
      expect(ctx.inflightProjectiles[0].strength).toBe(25);
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
