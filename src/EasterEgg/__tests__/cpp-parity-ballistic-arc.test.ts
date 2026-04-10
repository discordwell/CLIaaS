/**
 * C++ parity tests: Ballistic arc flight (gravity/riser)
 *
 * C++ source of truth:
 *   - bullet.cpp:756-789 — arcing projectile initialization (Height=1, Riser calculation)
 *   - object.cpp:237-254 — per-tick gravity simulation (Height += Riser; Riser -= Rule.Gravity)
 *   - rules.cpp — Rule.Gravity = 3 (default)
 *
 * Arcing weapons in RA: Grenade (E2), 155mm (ARTY), 8Inch (CA cruiser)
 * Non-arcing weapons: M1Carbine, 90mm, Dragon, etc.
 */

import { describe, it, expect } from 'vitest';
import {
  RULE_GRAVITY,
  WEAPON_STATS,
  type WeaponStats,
} from '../engine/types';
import {
  type InflightProjectile,
  launchProjectile,
  updateInflightProjectiles,
  type CombatContext,
} from '../engine/combat';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal combat context stub for testing projectile flight.
 *  Only the fields needed by launchProjectile/updateInflightProjectiles. */
function makeCombatCtx(overrides?: Partial<CombatContext>): CombatContext {
  const inflightProjectiles: InflightProjectile[] = [];
  return {
    entities: [],
    entityById: new Map(),
    structures: [],
    inflightProjectiles,
    effects: [],
    tick: 0,
    playerHouse: 'Spain' as any,
    scenarioId: 'test',
    killCount: 0,
    lossCount: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set(),
    map: { isPassable: () => true, addDecal: () => {}, getTerrain: () => 0, setTerrain: () => {}, clearTreeType: () => {}, getTreeAtCell: () => undefined, getWallType: () => '', clearWallType: () => {}, overlay: new Uint8Array(128 * 128).fill(0xFF), hasLineOfSight: () => true, unjamRadius: () => {}, destroyBridge: () => 0, countBridgeCells: () => 0 } as any,
    aiStates: new Map(),
    lastBaseAttackEva: 0,
    gameTicksPerSec: 20,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    powerConsumed: 0,
    powerProduced: 100,
    isAllied: () => false,
    entitiesAllied: () => false,
    isPlayerControlled: () => true,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    movementSpeed: () => 1,
    getFirepowerBias: () => 1,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '#fff',
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  } as CombatContext;
}

/** Minimal entity-like object for launchProjectile */
function makeEntity(id: number, x: number, y: number, house = 'Spain' as any) {
  return {
    id,
    pos: { x, y },
    leptonX: Math.trunc(x * 256 / 24),
    leptonY: Math.trunc(y * 256 / 24),
    house,
    alive: true,
    hp: 100,
    maxHp: 100,
    stats: { isInfantry: false, armor: 'none' as any, crusher: false, crushable: false },
    weapon: null,
    weapon2: null,
    isPlayerUnit: true,
    isAirUnit: false,
    flightAltitude: 0,
    cell: { cx: Math.floor(x / 24), cy: Math.floor(y / 24) },
    creditKill: () => {},
    takeDamage: () => false,
    triggerName: undefined,
    mission: 0,
    animState: 0,
    target: null,
    targetStructure: null,
    moveTarget: null,
    teamMissions: [],
    isAnt: false,
  } as any;
}

// ── 1. RULE_GRAVITY constant matches C++ ───────────────────────────────────

describe('RULE_GRAVITY constant (rules.cpp)', () => {
  it('gravity constant equals 3 (C++ Rule.Gravity default)', () => {
    expect(RULE_GRAVITY).toBe(3);
  });
});

// ── 2. Arcing flag on weapon stats ─────────────────────────────────────────

describe('isArcing flag on weapons', () => {
  it('Grenade has isArcing=true', () => {
    expect(WEAPON_STATS.Grenade.isArcing).toBe(true);
  });

  it('155mm (artillery) has isArcing=true', () => {
    expect(WEAPON_STATS['155mm'].isArcing).toBe(true);
  });

  it('8Inch (cruiser) has isArcing=true', () => {
    expect(WEAPON_STATS['8Inch'].isArcing).toBe(true);
  });

  it('non-arcing weapons do not have isArcing', () => {
    expect(WEAPON_STATS.M1Carbine.isArcing).toBeFalsy();
    expect(WEAPON_STATS['90mm'].isArcing).toBeFalsy();
    expect(WEAPON_STATS.Dragon.isArcing).toBeFalsy();
  });
});

// ── 3. InflightProjectile arc initialization ───────────────────────────────

describe('launchProjectile arc initialization (bullet.cpp:783-789)', () => {
  it('arcing projectile starts with arcHeight=1 and positive arcRiser', () => {
    const ctx = makeCombatCtx();
    const attacker = makeEntity(1, 0, 0);
    const target = makeEntity(2, 120, 0); // 5 cells away
    const weapon = WEAPON_STATS.Grenade;

    launchProjectile(ctx, attacker, target, weapon, 50, 120, 0, true);

    expect(ctx.inflightProjectiles).toHaveLength(1);
    const proj = ctx.inflightProjectiles[0];
    expect(proj.isArcing).toBe(true);
    expect(proj.arcHeight).toBe(1); // C++ Height = 1
    expect(proj.arcRiser).toBeGreaterThanOrEqual(10); // C++ Riser = max(Riser, 10)
  });

  it('non-arcing projectile has arcHeight=0, arcRiser=0, isArcing=false', () => {
    const ctx = makeCombatCtx();
    const attacker = makeEntity(1, 0, 0);
    const target = makeEntity(2, 120, 0);
    const weapon = WEAPON_STATS['90mm'];

    launchProjectile(ctx, attacker, target, weapon, 40, 120, 0, true);

    const proj = ctx.inflightProjectiles[0];
    expect(proj.isArcing).toBe(false);
    expect(proj.arcHeight).toBe(0);
    expect(proj.arcRiser).toBe(0);
  });

  it('arcRiser is at least 10 (C++ bullet.cpp:788 — Riser = max(Riser, 10))', () => {
    const ctx = makeCombatCtx();
    const attacker = makeEntity(1, 0, 0);
    // Very short distance — riser calculation might be small
    const target = makeEntity(2, 24, 0); // 1 cell away
    const weapon = WEAPON_STATS.Grenade;

    launchProjectile(ctx, attacker, target, weapon, 50, 24, 0, true);

    const proj = ctx.inflightProjectiles[0];
    expect(proj.arcRiser).toBeGreaterThanOrEqual(10);
  });
});

// ── 4. Parabolic arc (height rises then falls) ────────────────────────────

describe('arcing projectile follows parabolic arc (object.cpp:237-254)', () => {
  it('height rises initially, reaches peak, then falls back to 0', () => {
    const ctx = makeCombatCtx();
    const attacker = makeEntity(1, 0, 0);
    const target = makeEntity(2, 240, 0); // 10 cells away
    ctx.entityById.set(1, attacker);
    ctx.entityById.set(2, target);
    const weapon = WEAPON_STATS['155mm']; // artillery, isArcing=true

    launchProjectile(ctx, attacker, target, weapon, 150, 240, 0, true);

    const proj = ctx.inflightProjectiles[0];
    const initialRiser = proj.arcRiser;
    expect(initialRiser).toBeGreaterThan(0);

    // Simulate several ticks and track height
    const heights: number[] = [proj.arcHeight];
    let peaked = false;
    let peakHeight = proj.arcHeight;
    let prevHeight = proj.arcHeight;

    for (let i = 0; i < 100; i++) {
      updateInflightProjectiles(ctx);
      if (ctx.inflightProjectiles.length === 0) break;
      const h = ctx.inflightProjectiles[0].arcHeight;
      heights.push(h);
      if (h > peakHeight) peakHeight = h;
      if (h < prevHeight && !peaked) peaked = true;
      prevHeight = h;
    }

    // Height should have risen above initial
    expect(peakHeight).toBeGreaterThan(1);
    // Arc should have peaked (height decreased at some point)
    expect(peaked).toBe(true);
  });

  it('height is always positive during flight (before landing)', () => {
    const ctx = makeCombatCtx();
    const attacker = makeEntity(1, 0, 0);
    const target = makeEntity(2, 120, 0); // 5 cells
    ctx.entityById.set(1, attacker);
    ctx.entityById.set(2, target);
    const weapon = WEAPON_STATS.Grenade;

    launchProjectile(ctx, attacker, target, weapon, 50, 120, 0, true);

    // Track all heights during flight (before the projectile is removed)
    const heights: number[] = [];
    for (let i = 0; i < 200; i++) {
      if (ctx.inflightProjectiles.length === 0) break;
      heights.push(ctx.inflightProjectiles[0].arcHeight);
      updateInflightProjectiles(ctx);
    }

    // All heights during flight (before the landing tick) should be > 0
    // The last recorded height may be <= 0 on the landing tick itself
    const flightHeights = heights.slice(0, -1); // exclude final tick
    for (const h of flightHeights) {
      expect(h).toBeGreaterThan(0);
    }
  });
});

// ── 5. Projectile lands (explodes) when height <= 0 ───────────────────────

describe('arcing projectile lands when height <= 0 (object.cpp:241)', () => {
  it('arcing projectile is removed from inflight list upon landing', () => {
    const ctx = makeCombatCtx();
    const attacker = makeEntity(1, 0, 0);
    const target = makeEntity(2, 120, 0);
    ctx.entityById.set(1, attacker);
    ctx.entityById.set(2, target);
    const weapon = WEAPON_STATS.Grenade;

    launchProjectile(ctx, attacker, target, weapon, 50, 120, 0, true);
    expect(ctx.inflightProjectiles).toHaveLength(1);

    // Advance until projectile lands
    let ticks = 0;
    while (ctx.inflightProjectiles.length > 0 && ticks < 200) {
      updateInflightProjectiles(ctx);
      ticks++;
    }

    expect(ctx.inflightProjectiles).toHaveLength(0);
    expect(ticks).toBeGreaterThan(1); // should take more than 1 tick
    expect(ticks).toBeLessThan(200);  // should eventually land
  });

  it('generates explosion effect on landing', () => {
    const ctx = makeCombatCtx();
    const attacker = makeEntity(1, 0, 0);
    const target = makeEntity(2, 120, 0);
    ctx.entityById.set(1, attacker);
    ctx.entityById.set(2, target);
    const weapon = WEAPON_STATS.Grenade;

    launchProjectile(ctx, attacker, target, weapon, 50, 120, 0, true);

    const initialEffects = ctx.effects.length;

    // Advance until landing
    while (ctx.inflightProjectiles.length > 0) {
      updateInflightProjectiles(ctx);
    }

    // Should have created at least one explosion effect
    expect(ctx.effects.length).toBeGreaterThan(initialEffects);
  });
});

// ── 6. Non-arcing projectiles unaffected ───────────────────────────────────

describe('non-arcing projectiles fly straight (unchanged behavior)', () => {
  it('non-arcing projectile lands at travelFrames (not height-based)', () => {
    const ctx = makeCombatCtx();
    const attacker = makeEntity(1, 0, 0);
    const target = makeEntity(2, 120, 0);
    ctx.entityById.set(1, attacker);
    ctx.entityById.set(2, target);
    const weapon = WEAPON_STATS['90mm']; // non-arcing

    launchProjectile(ctx, attacker, target, weapon, 40, 120, 0, true);

    const proj = ctx.inflightProjectiles[0];
    const expectedFrames = proj.travelFrames;

    let ticks = 0;
    while (ctx.inflightProjectiles.length > 0 && ticks < 200) {
      updateInflightProjectiles(ctx);
      ticks++;
    }

    expect(ticks).toBe(expectedFrames);
  });

  it('non-arcing projectile arcHeight remains 0 throughout flight', () => {
    const ctx = makeCombatCtx();
    const attacker = makeEntity(1, 0, 0);
    const target = makeEntity(2, 120, 0);
    ctx.entityById.set(1, attacker);
    ctx.entityById.set(2, target);
    const weapon = WEAPON_STATS['90mm'];

    launchProjectile(ctx, attacker, target, weapon, 40, 120, 0, true);

    for (let i = 0; i < 50; i++) {
      if (ctx.inflightProjectiles.length === 0) break;
      expect(ctx.inflightProjectiles[0].arcHeight).toBe(0);
      updateInflightProjectiles(ctx);
    }
  });
});

// ── 7. Short-range and long-range arcs both work ───────────────────────────

describe('short-range and long-range arcs', () => {
  it('short-range grenade (1 cell) still arcs and lands', () => {
    const ctx = makeCombatCtx();
    const attacker = makeEntity(1, 0, 0);
    const target = makeEntity(2, 24, 0); // 1 cell
    ctx.entityById.set(1, attacker);
    ctx.entityById.set(2, target);

    launchProjectile(ctx, attacker, target, WEAPON_STATS.Grenade, 50, 24, 0, true);

    const proj = ctx.inflightProjectiles[0];
    expect(proj.isArcing).toBe(true);
    expect(proj.arcRiser).toBeGreaterThanOrEqual(10);

    let ticks = 0;
    let maxHeight = 0;
    while (ctx.inflightProjectiles.length > 0 && ticks < 200) {
      maxHeight = Math.max(maxHeight, ctx.inflightProjectiles[0].arcHeight);
      updateInflightProjectiles(ctx);
      ticks++;
    }

    expect(ticks).toBeGreaterThan(1);
    expect(ticks).toBeLessThan(200);
    expect(maxHeight).toBeGreaterThan(1); // should arc up
  });

  it('long-range artillery (6 cells) arcs higher and longer than short-range', () => {
    // Short range
    const ctxShort = makeCombatCtx();
    const atkS = makeEntity(1, 0, 0);
    const tgtS = makeEntity(2, 72, 0); // 3 cells
    ctxShort.entityById.set(1, atkS);
    ctxShort.entityById.set(2, tgtS);
    launchProjectile(ctxShort, atkS, tgtS, WEAPON_STATS['155mm'], 150, 72, 0, true);
    const shortRiser = ctxShort.inflightProjectiles[0].arcRiser;

    // Long range
    const ctxLong = makeCombatCtx();
    const atkL = makeEntity(1, 0, 0);
    const tgtL = makeEntity(2, 144, 0); // 6 cells
    ctxLong.entityById.set(1, atkL);
    ctxLong.entityById.set(2, tgtL);
    launchProjectile(ctxLong, atkL, tgtL, WEAPON_STATS['155mm'], 150, 144, 0, true);
    const longRiser = ctxLong.inflightProjectiles[0].arcRiser;

    // Longer range should have higher initial riser
    expect(longRiser).toBeGreaterThan(shortRiser);
  });
});

// ── 8. Gravity simulation math matches C++ ─────────────────────────────────

describe('gravity simulation per-tick math (object.cpp:240-253)', () => {
  it('each tick: arcHeight += arcRiser, arcRiser -= RULE_GRAVITY', () => {
    const ctx = makeCombatCtx();
    const attacker = makeEntity(1, 0, 0);
    const target = makeEntity(2, 120, 0);
    ctx.entityById.set(1, attacker);
    ctx.entityById.set(2, target);

    launchProjectile(ctx, attacker, target, WEAPON_STATS.Grenade, 50, 120, 0, true);

    const proj = ctx.inflightProjectiles[0];
    const h0 = proj.arcHeight;    // 1
    const r0 = proj.arcRiser;     // initial riser

    // Tick 1
    updateInflightProjectiles(ctx);
    if (ctx.inflightProjectiles.length > 0) {
      const p = ctx.inflightProjectiles[0];
      expect(p.arcHeight).toBe(h0 + r0);           // Height += Riser
      expect(p.arcRiser).toBe(r0 - RULE_GRAVITY);  // Riser -= Gravity

      const h1 = p.arcHeight;
      const r1 = p.arcRiser;

      // Tick 2
      updateInflightProjectiles(ctx);
      if (ctx.inflightProjectiles.length > 0) {
        const p2 = ctx.inflightProjectiles[0];
        expect(p2.arcHeight).toBe(h1 + r1);
        expect(p2.arcRiser).toBe(r1 - RULE_GRAVITY);
      }
    }
  });

  it('arcRiser is clamped to -100 minimum (object.cpp:254)', () => {
    const ctx = makeCombatCtx();
    const attacker = makeEntity(1, 0, 0);
    const target = makeEntity(2, 120, 0);
    ctx.entityById.set(1, attacker);
    ctx.entityById.set(2, target);

    launchProjectile(ctx, attacker, target, WEAPON_STATS.Grenade, 50, 120, 0, true);

    // Force riser to very negative value and simulate
    ctx.inflightProjectiles[0].arcRiser = -98;
    ctx.inflightProjectiles[0].arcHeight = 99999; // keep it airborne

    updateInflightProjectiles(ctx);

    if (ctx.inflightProjectiles.length > 0) {
      // After subtracting gravity (3), -98 - 3 = -101, should be clamped to -100
      expect(ctx.inflightProjectiles[0].arcRiser).toBe(-100);
    }
  });
});
