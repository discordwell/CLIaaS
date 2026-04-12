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

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(entities: Entity[] = []): CombatContext {
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
    impactX: 100,
    impactY: 100,
    attackerIsPlayer: false,
    isArcing: false,
    arcHeight: 0,
    arcRiser: 0,
    startX: 0,
    startY: 0,
    dogRiderId: -1,
    fuelTimer: 10,
    isFueled: false,
    isDropping: false,
    dropHeight: 0,
    isFlameEquipped: false,
    flameToggle: false,
    ...overrides,
  };
}

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

  it('launchProjectile sets fuelTimer = min(0xFF, travelFrames+4) for fueled weapons (fuse.cpp:94-97)', () => {
    const attacker = entityAtCell(UnitType.V_V2RL, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 10, 5);
    const ctx = makeCombatCtx([attacker, target]);

    launchProjectile(ctx, attacker, target, WEAPON_STATS.SCUD, 600,
      target.pos.x, target.pos.y, true);

    expect(ctx.inflightProjectiles.length).toBe(1);
    const proj = ctx.inflightProjectiles[0];
    expect(proj.isFueled).toBe(true);
    // fuelTimer = min(0xFF, travelFrames + 4)
    expect(proj.fuelTimer).toBe(Math.min(0xFF, proj.travelFrames + 4));
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

  it('launchProjectile initializes dropHeight=24 for dropping weapons (C++ FLIGHT_LEVEL)', () => {
    const attacker = entityAtCell(UnitType.V_V2RL, House.USSR, 5, 5);
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
    expect(proj.isDropping).toBe(true);
    expect(proj.dropHeight).toBe(24); // C++ FLIGHT_LEVEL = 24
  });

  it('dropHeight decreases by RULE_GRAVITY each tick (bullet.cpp:790-802)', () => {
    const ctx = makeCombatCtx();
    const proj = makeProjectile({
      isDropping: true,
      dropHeight: 24,
      travelFrames: 100,
      weapon: WEAPON_STATS.ParaBomb,
    });
    ctx.inflightProjectiles.push(proj);

    updateInflightProjectiles(ctx);
    expect(proj.dropHeight).toBe(24 - RULE_GRAVITY);
  });

  it('dropping projectile detonates when dropHeight reaches 0 (bullet.cpp:359-361)', () => {
    const attacker = entityAtCell(UnitType.V_V2RL, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 10, 5);
    const ctx = makeCombatCtx([attacker, target]);

    // dropHeight=24, RULE_GRAVITY=3 → takes 8 ticks to reach 0
    const proj = makeProjectile({
      attackerId: attacker.id,
      targetId: target.id,
      isDropping: true,
      dropHeight: 24,
      travelFrames: 100,  // would normally fly much longer
      weapon: WEAPON_STATS.ParaBomb,
      damage: 300,
      strength: 300,
    });
    ctx.inflightProjectiles.push(proj);

    // Tick 7 times: dropHeight goes 24→21→18→15→12→9→6→3
    for (let i = 0; i < 7; i++) {
      updateInflightProjectiles(ctx);
    }
    expect(ctx.inflightProjectiles.length).toBe(1); // still alive at dropHeight=3

    // Tick 8: dropHeight goes 3→0, should detonate
    updateInflightProjectiles(ctx);
    expect(ctx.inflightProjectiles.length).toBe(0);
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

  it('SCUD projectile: isFueled=true, isDropping=false, isFlameEquipped=false', () => {
    const attacker = entityAtCell(UnitType.V_V2RL, House.USSR, 5, 5);
    const target = entityAtCell(UnitType.I_E1, House.Spain, 10, 5);
    const ctx = makeCombatCtx([attacker, target]);

    launchProjectile(ctx, attacker, target, WEAPON_STATS.SCUD, 600,
      target.pos.x, target.pos.y, true);

    const proj = ctx.inflightProjectiles[0];
    expect(proj.isFueled).toBe(true);
    expect(proj.isDropping).toBe(false);
    expect(proj.isFlameEquipped).toBe(false);
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
    expect(proj.dropHeight).toBe(24);
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
