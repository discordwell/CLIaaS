/**
 * C++ Behavioral Parity: GPS Satellite re-shroud when ATEK destroyed
 *
 * C++ house.cpp:1420-1425:
 *   if (IsGPSActive && !(ActiveBScan & STRUCTF_ADVANCED_TECH)) {
 *     IsGPSActive = false;
 *     if (IsPlayerControl) {
 *       Map.Shroud_The_Map();
 *     }
 *   }
 *
 * When the GPS satellite has been launched (IsGPSActive=true) and the
 * Advanced Tech Center (ATEK) is subsequently destroyed, the map is
 * re-shrouded. Normal fog-of-war then re-reveals around player units.
 *
 * C++ bullet.cpp:413,1067: Sets IsGPSActive=true when GPS satellite fires.
 * C++ display.cpp:4159: IsGPSActive prevents Shroud_Cell from working (persistent reveal).
 * C++ house.cpp:1265: IsGPSActive bypasses radar jam checks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  UnitType, House, CELL_SIZE,
  SuperweaponType, SUPERWEAPON_DEFS, type SuperweaponState,
  getWarheadMultiplier, type WarheadType, type ArmorType,
} from '../engine/types';
import {
  updateSuperweapons,
  type SuperweaponContext,
} from '../engine/superweapon';
import { updateFogOfWar, type FogContext } from '../engine/fog';
import { type MapStructure } from '../engine/scenario';
import { type Effect } from '../engine/renderer';
import { GameMap, Terrain } from '../engine/map';

beforeEach(() => resetEntityIds());

// ─── Helpers ────────────────────────────────────────────

function makeStructure(
  type: string, house: House, cx: number, cy: number,
  overrides: Partial<MapStructure> = {},
): MapStructure {
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: 256,
    maxHp: 256,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    ...overrides,
  } as MapStructure;
}

function makeSwState(
  type: SuperweaponType, house: House,
  overrides: Partial<SuperweaponState> = {},
): SuperweaponState {
  return {
    type,
    house,
    chargeTick: 0,
    ready: false,
    structureIndex: 0,
    fired: false,
    ...overrides,
  };
}

/** Create a mock SuperweaponContext for testing GPS behavior */
function makeSuperweaponCtx(
  overrides: Partial<SuperweaponContext> = {},
): SuperweaponContext & {
  _evaMessages: string[];
  _shroudCalled: () => boolean;
  _revealCalled: () => boolean;
} {
  const evaMessages: string[] = [];
  let shroudCalled = false;
  let revealCalled = false;

  const ctx: SuperweaponContext = {
    structures: [],
    entities: [],
    entityById: new Map(),
    superweapons: new Map(),
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    powerProduced: 100,
    powerConsumed: 50,
    killCount: 0,
    lossCount: 0,
    gpsActive: false,
    map: {
      revealAll() { revealCalled = true; },
      shroudAll() { shroudCalled = true; },
      isPassable() { return true; },
      setVisibility() {},
      inBounds() { return true; },
      setTerrain() {},
      unjamRadius() {},
    },
    sonarSpiedTarget: new Map(),
    gapGeneratorCells: new Map(),
    nukePendingTarget: null,
    nukePendingTick: 0,
    nukePendingSource: null,
    isAllied(a: House, b: House) { return a === b; },
    isPlayerControlled(e: Entity) { return e.house === House.Spain; },
    pushEva(text: string) { evaMessages.push(text); },
    playSound() {},
    playSoundAt() {},
    damageEntity() { return false; },
    damageStructure() { return false; },
    addEntity() {},
    aiIQ() { return 5; },
    getWarheadMult(warhead: string, armor: string) {
      return getWarheadMultiplier(warhead as WarheadType, armor as ArmorType);
    },
    cameraX: 0,
    cameraY: 0,
    cameraViewWidth: 640,
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  };

  return Object.assign(ctx, {
    _evaMessages: evaMessages,
    _shroudCalled: () => shroudCalled,
    _revealCalled: () => revealCalled,
  });
}

// =============================================================================
// GPS Satellite Launch — IsGPSActive = true
// C++ bullet.cpp:413,1067
// =============================================================================

describe('GPS satellite launch sets gpsActive (C++ bullet.cpp:413,1067)', () => {
  it('auto-fires GPS when ATEK is alive and charged, setting gpsActive=true', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({ structures: [atek] });

    // Pre-load a ready GPS superweapon state
    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      ready: true,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks,
    }));

    updateSuperweapons(ctx);

    expect(ctx.gpsActive).toBe(true);
    expect(ctx._revealCalled()).toBe(true);

    const state = ctx.superweapons.get(key);
    expect(state?.fired).toBe(true);
    expect(state?.ready).toBe(false);
    expect(ctx._evaMessages).toContain('GPS satellite launched');
  });

  it('gpsActive stays true on subsequent ticks while ATEK alive', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({ structures: [atek], gpsActive: true });

    // GPS already fired
    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      fired: true,
    }));

    updateSuperweapons(ctx);

    // gpsActive should remain true — ATEK is still alive
    expect(ctx.gpsActive).toBe(true);
    expect(ctx._shroudCalled()).toBe(false);
  });
});

// =============================================================================
// ATEK Destroyed After GPS — IsGPSActive = false + Shroud_The_Map()
// C++ house.cpp:1420-1425
// =============================================================================

describe('ATEK destroyed after GPS launch triggers re-shroud (C++ house.cpp:1420-1425)', () => {
  it('sets gpsActive=false and calls shroudAll when ATEK is destroyed', () => {
    // ATEK is destroyed (alive=false)
    const atek = makeStructure('ATEK', House.Spain, 10, 10, { alive: false });
    const ctx = makeSuperweaponCtx({ structures: [atek], gpsActive: true });

    // GPS was previously fired
    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      fired: true,
    }));

    updateSuperweapons(ctx);

    expect(ctx.gpsActive).toBe(false);
    expect(ctx._shroudCalled()).toBe(true);
    expect(ctx._evaMessages).toContain('GPS satellite lost');
  });

  it('removes GPS superweapon entry after ATEK destruction', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10, { alive: false });
    const ctx = makeSuperweaponCtx({ structures: [atek] });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      fired: true,
    }));

    updateSuperweapons(ctx);

    // Entry should be cleaned up since building is gone
    expect(ctx.superweapons.has(key)).toBe(false);
  });

  it('does NOT re-shroud for non-player (enemy) GPS', () => {
    // Enemy ATEK destroyed — should not shroud player's map
    const enemyAtek = makeStructure('ATEK', House.USSR, 10, 10, { alive: false });
    const ctx = makeSuperweaponCtx({ structures: [enemyAtek] });

    const key = `${House.USSR}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.USSR, {
      fired: true,
    }));

    updateSuperweapons(ctx);

    // C++ house.cpp:1422 — only shrouds if IsPlayerControl
    expect(ctx._shroudCalled()).toBe(false);
    expect(ctx.gpsActive).toBe(false); // stays false (was never set for player)
  });

  it('does NOT re-shroud if ATEK still alive (GPS active)', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10); // alive=true
    const ctx = makeSuperweaponCtx({ structures: [atek], gpsActive: true });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      fired: true,
    }));

    updateSuperweapons(ctx);

    expect(ctx.gpsActive).toBe(true);
    expect(ctx._shroudCalled()).toBe(false);
  });

  it('does NOT re-shroud if a second ATEK exists', () => {
    // First ATEK destroyed, but second one still alive
    const atek1 = makeStructure('ATEK', House.Spain, 10, 10, { alive: false });
    const atek2 = makeStructure('ATEK', House.Spain, 20, 20); // alive
    const ctx = makeSuperweaponCtx({ structures: [atek1, atek2], gpsActive: true });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      fired: true,
    }));

    updateSuperweapons(ctx);

    // Second ATEK keeps GPS alive
    expect(ctx.gpsActive).toBe(true);
    expect(ctx._shroudCalled()).toBe(false);
  });
});

// =============================================================================
// Fog-of-War Integration — gpsActive controls persistent map reveal
// C++ display.cpp:4159 — IsGPSActive prevents Shroud_Cell from working
// =============================================================================

describe('fog-of-war integration with gpsActive (C++ display.cpp:4159)', () => {
  it('updateFogOfWar reveals all when gpsActive=true', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 10, 10);
    map.initDefault();

    // Place a unit so we can verify fog behavior
    const unit = new Entity(UnitType.V_MTNK, House.Spain, 45 * CELL_SIZE, 45 * CELL_SIZE);


    const fogCtx: FogContext = {
      entities: [unit],
      structures: [],
      map,
      tick: 1,
      playerHouse: House.Spain,
      fogDisabled: false,
      gpsActive: true,
      baseDiscovered: true,
      powerProduced: 100,
      powerConsumed: 50,
      gapGeneratorCells: new Map(),
      isAllied: (a, b) => a === b,
      entitiesAllied: (a, b) => a.house === b.house,
    };

    updateFogOfWar(fogCtx);

    // All cells in bounds should be visible (2)
    for (let cy = 40; cy < 50; cy++) {
      for (let cx = 40; cx < 50; cx++) {
        expect(map.getVisibility(cx, cy)).toBe(2);
      }
    }
  });

  it('updateFogOfWar uses normal fog when gpsActive=false', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 10, 10);
    map.initDefault();

    // Place unit at center — should only reveal around unit's sight radius
    const unit = new Entity(UnitType.V_MTNK, House.Spain, 45 * CELL_SIZE, 45 * CELL_SIZE);


    const fogCtx: FogContext = {
      entities: [unit],
      structures: [],
      map,
      tick: 1,
      playerHouse: House.Spain,
      fogDisabled: false,
      gpsActive: false,
      baseDiscovered: true,
      powerProduced: 100,
      powerConsumed: 50,
      gapGeneratorCells: new Map(),
      isAllied: (a, b) => a === b,
      entitiesAllied: (a, b) => a.house === b.house,
    };

    updateFogOfWar(fogCtx);

    // Cell far from unit should be shrouded (0)
    expect(map.getVisibility(40, 40)).toBe(0);
    // Cell at unit position should be visible (2)
    expect(map.getVisibility(45, 45)).toBe(2);
  });

  it('after ATEK destruction: shroud clears map, then fog re-reveals around units', () => {
    // This tests the full lifecycle:
    // 1. GPS active → all revealed
    // 2. ATEK destroyed → shroudAll() blanks everything
    // 3. Next fog update → normal reveal around units only

    const map = new GameMap();
    map.setBounds(40, 40, 10, 10);
    map.initDefault();

    const unit = new Entity(UnitType.V_MTNK, House.Spain, 45 * CELL_SIZE, 45 * CELL_SIZE);


    // Step 1: GPS is active — everything revealed
    const fogCtx: FogContext = {
      entities: [unit],
      structures: [],
      map,
      tick: 1,
      playerHouse: House.Spain,
      fogDisabled: false,
      gpsActive: true,
      baseDiscovered: true,
      powerProduced: 100,
      powerConsumed: 50,
      gapGeneratorCells: new Map(),
      isAllied: (a, b) => a === b,
      entitiesAllied: (a, b) => a.house === b.house,
    };

    updateFogOfWar(fogCtx);
    // Everything should be visible
    expect(map.getVisibility(40, 40)).toBe(2);
    expect(map.getVisibility(49, 49)).toBe(2);

    // Step 2: ATEK destroyed — simulate shroudAll() call from superweapon system
    map.shroudAll();
    fogCtx.gpsActive = false;

    // Step 3: Normal fog update re-reveals around unit only
    updateFogOfWar(fogCtx);

    // Far cell should be shrouded
    expect(map.getVisibility(40, 40)).toBe(0);
    // Unit's cell should be revealed
    expect(map.getVisibility(45, 45)).toBe(2);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('GPS re-shroud edge cases', () => {
  it('GPS does not fire if ATEK building is not yet complete (buildProgress < 1)', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10, {
      buildProgress: 0.5,
    });
    const ctx = makeSuperweaponCtx({ structures: [atek] });

    updateSuperweapons(ctx);

    // No GPS entry should have been created
    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    expect(ctx.superweapons.has(key)).toBe(false);
    expect(ctx.gpsActive).toBe(false);
  });

  it('re-shroud only fires once (entry is cleaned up after)', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10, { alive: false });
    const ctx = makeSuperweaponCtx({ structures: [atek], gpsActive: true });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      fired: true,
    }));

    // First update — should shroud
    updateSuperweapons(ctx);
    expect(ctx._shroudCalled()).toBe(true);
    expect(ctx.superweapons.has(key)).toBe(false);

    // Second update — entry gone, no double-shroud
    const ctx2 = makeSuperweaponCtx({
      structures: [atek],
      superweapons: ctx.superweapons,
    });
    updateSuperweapons(ctx2);
    expect(ctx2._shroudCalled()).toBe(false);
  });
});
