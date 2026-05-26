/**
 * C++ Behavioral Parity: Superweapon Power Suspension
 *
 * C++ source: house.cpp:1410-1411, super.cpp:102-121
 *
 * C++ behavior (source of truth):
 *   When Power_Fraction() < 1.0 (drain exceeds production), powered
 *   superweapon timers are fully suspended via SuperClass::Suspend(true).
 *   The timer is stopped — no charging occurs at all. When power is
 *   restored, Suspend(false) resumes the timer from where it left off.
 *
 * Previously broken TS behavior:
 *   Low power only slowed charging to 25% rate. Superweapons would
 *   slowly charge even with zero power. Fixed to match C++ binary
 *   on/off suspension.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  House, SuperweaponType, SUPERWEAPON_DEFS,
  type SuperweaponState, buildDefaultAlliances,
} from '../engine/types';
import { type SuperweaponContext, updateSuperweapons } from '../engine/superweapon';
import { type MapStructure, STRUCTURE_MAX_HP } from '../engine/scenario';
import type { Effect } from '../engine/renderer';
import { GameMap } from '../engine/map';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeStructure(
  type: string, cx: number, cy: number,
  house: House = House.Spain,
): MapStructure {
  const maxHp = STRUCTURE_MAX_HP[type] ?? 256;
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: maxHp, maxHp, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makeSwContext(overrides: Partial<SuperweaponContext> = {}): SuperweaponContext {
  const alliances = buildDefaultAlliances();
  const map = new GameMap();
  return {
    structures: [],
    entities: [],
    entityById: new Map(),
    superweapons: new Map<string, SuperweaponState>(),
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    powerProduced: 200,
    powerConsumed: 100,
    killCount: 0,
    lossCount: 0,
    map: {
      revealAll: () => {},
      isPassable: () => true,
      setVisibility: () => {},
      inBounds: () => true,
      setTerrain: () => {},
      unjamRadius: () => {},
    },
    sonarSpiedTarget: new Map(),
    gapGeneratorCells: new Map(),
    nukePendingTarget: null,
    nukePendingTick: 0,
    nukePendingSource: null,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    isPlayerControlled: () => true,
    pushEva: () => {},
    playSound: () => {},
    playSoundAt: () => {},
    damageEntity: () => false,
    damageStructure: () => false,
    addEntity: () => {},
    aiIQ: () => 0,
    getWarheadMult: () => 1,
    cameraX: 0,
    cameraY: 0,
    cameraViewWidth: 800,
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  };
}

// =============================================================================
// Superweapon charges at full rate with full power
// C++ house.cpp:1410-1411: Power_Fraction() >= 1 means no suspension
// =============================================================================

describe('superweapon charges at full rate with full power (house.cpp:1410-1411)', () => {

  it('MSLO charges 1 tick per update when power is sufficient', () => {
    const mslo = makeStructure('MSLO', 10, 10, House.Spain);
    const ctx = makeSwContext({
      structures: [mslo],
      powerProduced: 200,
      powerConsumed: 100,
    });

    // Run one update to create the superweapon state
    updateSuperweapons(ctx);
    const key = `${House.Spain}:${SuperweaponType.NUKE}`;
    const state = ctx.superweapons.get(key);
    expect(state).toBeDefined();
    const tick1 = state!.chargeTick;

    // Run a second update
    updateSuperweapons(ctx);
    const tick2 = state!.chargeTick;

    // Should advance by exactly 1 per update
    expect(tick2 - tick1).toBe(1);
  });

  it('IRON charges 1 tick per update when power is sufficient', () => {
    const iron = makeStructure('IRON', 10, 10, House.USSR);
    const ctx = makeSwContext({
      structures: [iron],
      powerProduced: 300,
      powerConsumed: 200,
    });

    updateSuperweapons(ctx);
    const key = `${House.USSR}:${SuperweaponType.IRON_CURTAIN}`;
    const state = ctx.superweapons.get(key);
    expect(state).toBeDefined();
    const tick1 = state!.chargeTick;

    updateSuperweapons(ctx);
    expect(state!.chargeTick - tick1).toBe(1);
  });

  it('normal-game BadGuy IRON does not enable Iron Curtain', () => {
    // house.cpp:1600-1604 gates SPC_IRON_CURTAIN to ActLike USSR/Ukraine
    // during GAME_NORMAL. BadGuy owns Soviet tech but is not ActLike USSR.
    const iron = makeStructure('IRON', 10, 10, House.BadGuy);
    const ctx = makeSwContext({
      structures: [iron],
      playerHouse: House.BadGuy,
      powerProduced: 300,
      powerConsumed: 200,
    });

    updateSuperweapons(ctx);

    expect(ctx.superweapons.has(`${House.BadGuy}:${SuperweaponType.IRON_CURTAIN}`)).toBe(false);
  });

  it('normal-game USSR MSLO does not enable nuclear missile', () => {
    // house.cpp:1682-1685 enables SPC_NUCLEAR_BOMB only when ActLike is not
    // USSR/Ukraine during GAME_NORMAL.
    const mslo = makeStructure('MSLO', 10, 10, House.USSR);
    const ctx = makeSwContext({
      structures: [mslo],
      playerHouse: House.USSR,
      powerProduced: 300,
      powerConsumed: 200,
    });

    updateSuperweapons(ctx);

    expect(ctx.superweapons.has(`${House.USSR}:${SuperweaponType.NUKE}`)).toBe(false);
  });

  it('charging accumulates over multiple updates', () => {
    const mslo = makeStructure('MSLO', 10, 10, House.Spain);
    const ctx = makeSwContext({
      structures: [mslo],
      powerProduced: 200,
      powerConsumed: 100,
    });

    const N = 50;
    for (let i = 0; i < N; i++) {
      updateSuperweapons(ctx);
    }

    const key = `${House.Spain}:${SuperweaponType.NUKE}`;
    const state = ctx.superweapons.get(key);
    expect(state!.chargeTick).toBe(N);
  });
});

// =============================================================================
// Superweapon charging stops completely with insufficient power
// C++ house.cpp:1410-1411: Suspend(Power_Fraction() < 1) — timer stopped
// =============================================================================

describe('superweapon charging fully suspends at low power (house.cpp:1410-1411)', () => {

  it('MSLO does not charge when power consumed > produced', () => {
    const mslo = makeStructure('MSLO', 10, 10, House.Spain);
    const ctx = makeSwContext({
      structures: [mslo],
      powerProduced: 50,
      powerConsumed: 200,
    });

    // First update creates state and attempts charge
    updateSuperweapons(ctx);
    const key = `${House.Spain}:${SuperweaponType.NUKE}`;
    const state = ctx.superweapons.get(key);
    expect(state).toBeDefined();
    const chargeAfterFirst = state!.chargeTick;

    // Run many more updates — charge should NOT increase
    for (let i = 0; i < 100; i++) {
      updateSuperweapons(ctx);
    }

    expect(state!.chargeTick).toBe(chargeAfterFirst);
  });

  it('IRON does not charge when power consumed > produced', () => {
    const iron = makeStructure('IRON', 10, 10, House.USSR);
    const ctx = makeSwContext({
      structures: [iron],
      powerProduced: 100,
      powerConsumed: 300,
    });

    updateSuperweapons(ctx);
    const key = `${House.USSR}:${SuperweaponType.IRON_CURTAIN}`;
    const state = ctx.superweapons.get(key);
    expect(state).toBeDefined();
    const chargeAfterFirst = state!.chargeTick;

    for (let i = 0; i < 50; i++) {
      updateSuperweapons(ctx);
    }

    expect(state!.chargeTick).toBe(chargeAfterFirst);
  });

  it('charge stays at exactly 0 when low power from the start', () => {
    const mslo = makeStructure('MSLO', 10, 10, House.Spain);
    const ctx = makeSwContext({
      structures: [mslo],
      powerProduced: 10,
      powerConsumed: 200,
    });

    for (let i = 0; i < 20; i++) {
      updateSuperweapons(ctx);
    }

    const key = `${House.Spain}:${SuperweaponType.NUKE}`;
    const state = ctx.superweapons.get(key);
    expect(state!.chargeTick).toBe(0);
  });
});

// =============================================================================
// Superweapon charging resumes when power is restored
// C++ super.cpp:102-121: Suspend(false) calls Control.Start(), resuming timer
// =============================================================================

describe('superweapon charging resumes when power restored (super.cpp:102-121)', () => {

  it('charge resumes from where it left off after power outage', () => {
    const mslo = makeStructure('MSLO', 10, 10, House.Spain);
    const ctx = makeSwContext({
      structures: [mslo],
      powerProduced: 200,
      powerConsumed: 100,
    });

    // Charge for 30 ticks with full power
    for (let i = 0; i < 30; i++) {
      updateSuperweapons(ctx);
    }

    const key = `${House.Spain}:${SuperweaponType.NUKE}`;
    const state = ctx.superweapons.get(key);
    const chargeBeforeOutage = state!.chargeTick;
    expect(chargeBeforeOutage).toBe(30);

    // Simulate power outage — drain exceeds production
    ctx.powerProduced = 50;
    ctx.powerConsumed = 200;

    // Run 100 updates during outage — charge should NOT change
    for (let i = 0; i < 100; i++) {
      updateSuperweapons(ctx);
    }
    expect(state!.chargeTick).toBe(chargeBeforeOutage);

    // Restore power
    ctx.powerProduced = 300;
    ctx.powerConsumed = 100;

    // Charge for 20 more ticks
    for (let i = 0; i < 20; i++) {
      updateSuperweapons(ctx);
    }

    // Should have resumed from 30, now at 50
    expect(state!.chargeTick).toBe(chargeBeforeOutage + 20);
  });

  it('multiple power outage/restore cycles preserve accumulated charge', () => {
    const mslo = makeStructure('MSLO', 10, 10, House.Spain);
    const ctx = makeSwContext({
      structures: [mslo],
      powerProduced: 200,
      powerConsumed: 100,
    });

    // Phase 1: charge 10 ticks
    for (let i = 0; i < 10; i++) updateSuperweapons(ctx);
    const key = `${House.Spain}:${SuperweaponType.NUKE}`;
    const state = ctx.superweapons.get(key)!;
    expect(state.chargeTick).toBe(10);

    // Phase 2: power outage for 50 ticks
    ctx.powerProduced = 10;
    ctx.powerConsumed = 200;
    for (let i = 0; i < 50; i++) updateSuperweapons(ctx);
    expect(state.chargeTick).toBe(10); // unchanged

    // Phase 3: restore, charge 15 ticks
    ctx.powerProduced = 200;
    ctx.powerConsumed = 100;
    for (let i = 0; i < 15; i++) updateSuperweapons(ctx);
    expect(state.chargeTick).toBe(25);

    // Phase 4: another outage for 30 ticks
    ctx.powerProduced = 10;
    ctx.powerConsumed = 200;
    for (let i = 0; i < 30; i++) updateSuperweapons(ctx);
    expect(state.chargeTick).toBe(25); // unchanged

    // Phase 5: restore, charge 5 more ticks
    ctx.powerProduced = 200;
    ctx.powerConsumed = 100;
    for (let i = 0; i < 5; i++) updateSuperweapons(ctx);
    expect(state.chargeTick).toBe(30);
  });
});

// =============================================================================
// Charge progress is preserved during power outage (not reset)
// C++ super.cpp:102-121: Suspend only stops/starts the timer, never resets it
// =============================================================================

describe('charge progress preserved during outage — not reset (super.cpp:102-121)', () => {

  it('charge does not reset to 0 when power goes out', () => {
    const iron = makeStructure('IRON', 10, 10, House.USSR);
    const ctx = makeSwContext({
      structures: [iron],
      powerProduced: 300,
      powerConsumed: 200,
    });

    // Charge to 40
    for (let i = 0; i < 40; i++) updateSuperweapons(ctx);
    const key = `${House.USSR}:${SuperweaponType.IRON_CURTAIN}`;
    const state = ctx.superweapons.get(key)!;
    expect(state.chargeTick).toBe(40);

    // Power outage
    ctx.powerProduced = 10;
    ctx.powerConsumed = 200;
    for (let i = 0; i < 200; i++) updateSuperweapons(ctx);

    // Charge must still be 40, not 0 or any other value
    expect(state.chargeTick).toBe(40);
  });

  it('partial charge fraction is exact after resume', () => {
    const mslo = makeStructure('MSLO', 10, 10, House.Spain);
    const rechargeTicks = SUPERWEAPON_DEFS[SuperweaponType.NUKE].rechargeTicks;
    const ctx = makeSwContext({
      structures: [mslo],
      powerProduced: 200,
      powerConsumed: 100,
    });

    // Charge to 1/4 of the way
    const target = Math.floor(rechargeTicks / 4);
    for (let i = 0; i < target; i++) updateSuperweapons(ctx);

    const key = `${House.Spain}:${SuperweaponType.NUKE}`;
    const state = ctx.superweapons.get(key)!;
    expect(state.chargeTick).toBe(target);

    // Outage
    ctx.powerProduced = 10;
    ctx.powerConsumed = 200;
    for (let i = 0; i < 500; i++) updateSuperweapons(ctx);
    expect(state.chargeTick).toBe(target);

    // Restore — charge exactly the remaining ticks
    ctx.powerProduced = 200;
    ctx.powerConsumed = 100;
    const remaining = rechargeTicks - target;
    for (let i = 0; i < remaining; i++) updateSuperweapons(ctx);
    expect(state.chargeTick).toBe(rechargeTicks);
    expect(state.ready).toBe(true);
  });
});

// =============================================================================
// Multiple superweapons all suspend simultaneously
// C++ house.cpp:1392-1414: loop iterates ALL superweapons, suspending each
// =============================================================================

describe('multiple superweapons all suspend simultaneously (house.cpp:1392-1414)', () => {

  it('MSLO and IRON both stop charging during shared power outage', () => {
    const mslo = makeStructure('MSLO', 10, 10, House.Spain);
    const iron = makeStructure('IRON', 14, 10, House.USSR);
    const ctx = makeSwContext({
      structures: [mslo, iron],
      powerProduced: 500,
      powerConsumed: 300,
    });

    // Charge both for 20 ticks
    for (let i = 0; i < 20; i++) updateSuperweapons(ctx);
    const nukeKey = `${House.Spain}:${SuperweaponType.NUKE}`;
    const icKey = `${House.USSR}:${SuperweaponType.IRON_CURTAIN}`;
    const nukeState = ctx.superweapons.get(nukeKey)!;
    const icState = ctx.superweapons.get(icKey)!;
    expect(nukeState.chargeTick).toBe(20);
    expect(icState.chargeTick).toBe(20);

    // Power outage
    ctx.powerProduced = 50;
    ctx.powerConsumed = 400;

    for (let i = 0; i < 100; i++) updateSuperweapons(ctx);

    // Both must be frozen
    expect(nukeState.chargeTick).toBe(20);
    expect(icState.chargeTick).toBe(20);
  });

  it('all superweapons resume simultaneously when power restored', () => {
    const mslo = makeStructure('MSLO', 10, 10, House.Spain);
    const iron = makeStructure('IRON', 14, 10, House.USSR);
    const ctx = makeSwContext({
      structures: [mslo, iron],
      powerProduced: 500,
      powerConsumed: 300,
    });

    // Charge both for 15 ticks
    for (let i = 0; i < 15; i++) updateSuperweapons(ctx);
    const nukeKey = `${House.Spain}:${SuperweaponType.NUKE}`;
    const icKey = `${House.USSR}:${SuperweaponType.IRON_CURTAIN}`;
    const nukeState = ctx.superweapons.get(nukeKey)!;
    const icState = ctx.superweapons.get(icKey)!;

    // Outage
    ctx.powerProduced = 50;
    ctx.powerConsumed = 400;
    for (let i = 0; i < 50; i++) updateSuperweapons(ctx);

    // Restore
    ctx.powerProduced = 500;
    ctx.powerConsumed = 300;
    for (let i = 0; i < 10; i++) updateSuperweapons(ctx);

    // Both should have advanced by exactly 10 from their frozen state
    expect(nukeState.chargeTick).toBe(25);
    expect(icState.chargeTick).toBe(25);
  });
});

// =============================================================================
// Edge case: power exactly equals drain (should charge)
// C++ house.cpp:1411: Suspend(Power_Fraction() < 1) — exactly 1.0 means NO suspension
// =============================================================================

describe('edge case: power equals drain — no suspension (house.cpp:1411)', () => {

  it('MSLO charges normally when powerProduced == powerConsumed', () => {
    const mslo = makeStructure('MSLO', 10, 10, House.Spain);
    const ctx = makeSwContext({
      structures: [mslo],
      powerProduced: 200,
      powerConsumed: 200,
    });

    for (let i = 0; i < 25; i++) updateSuperweapons(ctx);

    const key = `${House.Spain}:${SuperweaponType.NUKE}`;
    const state = ctx.superweapons.get(key)!;
    // powerConsumed is NOT > powerProduced, so isLowPower is false, should charge
    expect(state.chargeTick).toBe(25);
  });

  it('charging stops only when drain strictly exceeds production', () => {
    const mslo = makeStructure('MSLO', 10, 10, House.Spain);
    const ctx = makeSwContext({
      structures: [mslo],
      powerProduced: 200,
      powerConsumed: 200,
    });

    // Equal power — should charge
    for (let i = 0; i < 10; i++) updateSuperweapons(ctx);
    const key = `${House.Spain}:${SuperweaponType.NUKE}`;
    const state = ctx.superweapons.get(key)!;
    expect(state.chargeTick).toBe(10);

    // Drain exceeds by just 1 — should suspend
    ctx.powerConsumed = 201;
    for (let i = 0; i < 10; i++) updateSuperweapons(ctx);
    expect(state.chargeTick).toBe(10); // unchanged

    // Back to equal — should resume
    ctx.powerConsumed = 200;
    for (let i = 0; i < 10; i++) updateSuperweapons(ctx);
    expect(state.chargeTick).toBe(20);
  });
});
