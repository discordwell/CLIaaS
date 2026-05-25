/**
 * C++ Behavioral Parity: GPS Satellite — Map Reveal Mechanics
 *
 * Tests the GPS superweapon's reveal behavior against authoritative C++ source.
 * Focus areas: permanent vs one-time reveal, ATEK destruction re-shroud,
 * power dependency, tech-level gating, one-shot semantics, re-acquisition.
 *
 * Authoritative sources:
 *   rules.ini [General] GPSTechLevel=8
 *   rules.ini [Recharge] GPS=8  (8 minutes = 7200 ticks at 15 Hz)
 *
 * Key C++ source references:
 *   house.cpp:545      — IsGPSActive initialized false
 *   house.cpp:660      — SPC_GPS SuperClass(TICKS_PER_MINUTE * Rule.GPSTime, true, ...)
 *                         requiresPower=true, VOX_INSUFFICIENT_POWER on low power
 *   house.cpp:1265-1266 — IsGPSActive bypasses radar jam checks
 *   house.cpp:1292-1303 — GPS keeps radar active regardless of power/radar buildings
 *   house.cpp:1420-1425 — ATEK destruction: IsGPSActive=false, Shroud_The_Map() for player
 *   house.cpp:1433-1441 — GPS removed from sidebar when: ATEK gone OR already fired
 *   house.cpp:1446-1460 — Auto-fire GPS when charged; sets bldg->HasFired, MISSION_MISSILE
 *   house.cpp:1467-1494 — GPS re-enable: requires ATEK + !IsGPSActive + TechLevel>=GPSTechLevel
 *                         + (IsHuman || IQ>=IQSuperWeapons) + !bldg->HasFired
 *   bullet.cpp:403-414  — GPS satellite impact: Map_Cell all cells, IsGPSActive=true,
 *                         IsVisionary=true, Radar_Activate(1)
 *   bullet.cpp:1056-1068 — Duplicate GPS fire logic (same as above)
 *   display.cpp:4157-4163 — Shroud_Cell: if IsGPSActive, return early (prevents re-shrouding)
 *   map.cpp:2111-2134   — Shroud_The_Map: shroud all, then Look() on player units
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
import { GameMap } from '../engine/map';

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

/** Create a mock SuperweaponContext */
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

/** Create a FogContext with sensible defaults */
function makeFogContext(overrides: Partial<FogContext> = {}): FogContext {
  const map = overrides.map ?? new GameMap();
  return {
    entities: [],
    structures: [],
    map,
    tick: 0,
    playerHouse: House.Spain,
    fogDisabled: false,
    gpsActive: false,
    baseDiscovered: true,
    powerProduced: 100,
    powerConsumed: 50,
    gapGeneratorCells: new Map(),
    isAllied: (a, b) => a === b,
    entitiesAllied: (a, b) => a.house === b.house,
    ...overrides,
  };
}

// C++ constants (authoritative)
const CPP_TICKS_PER_MINUTE = 900; // defines.h:3032: TICKS_PER_SECOND(15) * 60

// =============================================================================
// Section 1: GPS Recharge Time — rules.ini [Recharge] GPS=8
// C++ house.cpp:660: TICKS_PER_MINUTE * Rule.GPSTime
// =============================================================================

describe('GPS recharge time (rules.ini [Recharge] GPS=8)', () => {
  /**
   * rules.ini [Recharge] GPS=8  (authoritative)
   * C++ rules.cpp:217: GPSTime default=1 (overridden by rules.ini to 8)
   * C++ rules.cpp:581: GPSTime = ini.Get_Fixed(RECHARGE, "GPS", GPSTime)
   * C++ house.cpp:660: TICKS_PER_MINUTE * Rule.GPSTime = 900 * 8 = 7200 ticks
   *
   * TS types.ts:765: rechargeTicks: 7200
   */
  const RULES_INI_GPS_MINUTES = 8;
  const EXPECTED_TICKS = RULES_INI_GPS_MINUTES * CPP_TICKS_PER_MINUTE; // 7200

  it('rechargeTicks matches rules.ini GPS=8 (7200 ticks)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks).toBe(EXPECTED_TICKS);
  });

  it('GPS is classified as allied faction', () => {
    // GPS satellite comes from ATEK (Allied Tech Center)
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].faction).toBe('allied');
  });

  it('GPS building is ATEK', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].building).toBe('ATEK');
  });
});

// =============================================================================
// Section 2: GPS Is Permanent Reveal (Not One-Time)
// C++ display.cpp:4157-4163 — IsGPSActive prevents Shroud_Cell
// =============================================================================

describe('GPS is persistent reveal, not one-time (display.cpp:4159)', () => {
  /**
   * C++ display.cpp:4157-4163:
   *   void DisplayClass::Shroud_Cell(CELL cell) {
   *     if (PlayerPtr->IsGPSActive) {
   *       if ((*this)[cell].Jammed & (1 << PlayerPtr->Class->House)) {
   *         return;  // jammed cells still hidden
   *       }
   *     }
   *   }
   *
   * IsGPSActive prevents ANY Shroud_Cell from working on non-jammed cells.
   * This means the reveal is PERSISTENT — not a one-time map reveal.
   * New map areas (if any) also stay revealed. The only way to lose GPS
   * vision is ATEK destruction (house.cpp:1420-1425).
   *
   * TS parity: fog.ts:76 checks gpsActive every tick and calls revealAll().
   * This is functionally equivalent — persistent reveal while flag is set.
   */

  it('fog update keeps all cells revealed on repeated calls while gpsActive=true', () => {
    const map = new GameMap();
    const fogCtx = makeFogContext({ map, gpsActive: true });

    // First fog update
    updateFogOfWar(fogCtx);
    expect(map.getVisibility(64, 64)).toBe(2);

    // Second fog update — still revealed (persistent)
    updateFogOfWar(fogCtx);
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(10, 10)).toBe(2);
    expect(map.getVisibility(100, 100)).toBe(2);
  });

  it('GPS reveal persists even without any player units on map', () => {
    // C++ display.cpp:4159 — GPS prevents shrouding regardless of unit presence.
    // Unlike normal fog which requires units with sight range, GPS reveals everything.
    const map = new GameMap();
    const fogCtx = makeFogContext({
      map,
      gpsActive: true,
      entities: [],  // no units at all
      structures: [], // no structures
    });

    updateFogOfWar(fogCtx);

    // Everything visible despite no units
    expect(map.getVisibility(0, 0)).toBe(2);
    expect(map.getVisibility(64, 64)).toBe(2);
  });
});

// =============================================================================
// Section 3: GPS Does NOT Survive ATEK Destruction
// C++ house.cpp:1420-1425
// =============================================================================

describe('GPS lost when all ATEKs destroyed (house.cpp:1420-1425)', () => {
  /**
   * C++ house.cpp:1420-1425:
   *   if (IsGPSActive && !(ActiveBScan & STRUCTF_ADVANCED_TECH)) {
   *     IsGPSActive = false;
   *     if (IsPlayerControl) {
   *       Map.Shroud_The_Map();
   *     }
   *   }
   *
   * ActiveBScan scans ALL alive buildings. So if ANY ATEK survives,
   * GPS stays active. Only when ALL ATEKs are gone does GPS deactivate.
   */

  it('gpsActive cleared and map shrouded when last ATEK is destroyed', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10, { alive: false });
    const ctx = makeSuperweaponCtx({ structures: [atek], gpsActive: true });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      fired: true,
    }));

    updateSuperweapons(ctx);

    expect(ctx.gpsActive).toBe(false);
    expect(ctx._shroudCalled()).toBe(true);
  });

  it('GPS persists if one of two ATEKs survives', () => {
    // C++ ActiveBScan includes ALL alive buildings of the house
    const atek1 = makeStructure('ATEK', House.Spain, 10, 10, { alive: false });
    const atek2 = makeStructure('ATEK', House.Spain, 20, 20); // alive
    const ctx = makeSuperweaponCtx({
      structures: [atek1, atek2],
      gpsActive: true,
    });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      fired: true,
    }));

    updateSuperweapons(ctx);

    expect(ctx.gpsActive).toBe(true);
    expect(ctx._shroudCalled()).toBe(false);
  });

  it('only player GPS triggers shroud (not enemy GPS)', () => {
    // C++ house.cpp:1422: if (IsPlayerControl) { Map.Shroud_The_Map(); }
    // Enemy losing ATEK should not shroud the player's map.
    const enemyAtek = makeStructure('ATEK', House.USSR, 10, 10, { alive: false });
    const ctx = makeSuperweaponCtx({ structures: [enemyAtek] });

    const key = `${House.USSR}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.USSR, {
      fired: true,
    }));

    updateSuperweapons(ctx);

    expect(ctx._shroudCalled()).toBe(false);
  });
});

// =============================================================================
// Section 4: GPS Power Dependency — Charging vs Active
// C++ house.cpp:660 (charging requires power) vs house.cpp:1292 (active ignores power)
// =============================================================================

describe('GPS power dependency (house.cpp:660 + 1292)', () => {
  /**
   * C++ house.cpp:660: SPC_GPS SuperClass(..., true, ...) — requiresPower=true
   *   GPS charging is FULLY SUSPENDED when Power_Fraction() < 1 (binary, not fractional).
   *
   * C++ house.cpp:1292-1303:
   *   if (Power_Fraction() < 1 && !IsGPSActive) { Map.Radar_Activate(0); }
   *   ...
   *   if (Power_Fraction() >= 1 || IsGPSActive) { Map.Radar_Activate(1); }
   *
   *   Once GPS is ACTIVE (fired), it overrides ALL power checks for radar.
   *   Low power does NOT disable GPS vision — only ATEK destruction does.
   */

  it('GPS charging suspended with insufficient power', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({
      structures: [atek],
      powerProduced: 50,
      powerConsumed: 100, // low power
    });

    for (let i = 0; i < 100; i++) {
      ctx.tick = i;
      updateSuperweapons(ctx);
    }

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    const state = ctx.superweapons.get(key);
    expect(state).toBeDefined();
    expect(state!.chargeTick).toBe(0);
    expect(state!.ready).toBe(false);
  });

  it('GPS charges normally with sufficient power', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({
      structures: [atek],
      powerProduced: 100,
      powerConsumed: 50,
    });

    for (let i = 0; i < 50; i++) {
      ctx.tick = i;
      updateSuperweapons(ctx);
    }

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    const state = ctx.superweapons.get(key);
    expect(state).toBeDefined();
    expect(state!.chargeTick).toBeGreaterThan(0);
  });

  it('GPS vision unaffected by low power AFTER firing', () => {
    // Once IsGPSActive=true, power does not matter (house.cpp:1292)
    const map = new GameMap();
    const fogCtx = makeFogContext({
      map,
      gpsActive: true,
      powerProduced: 0,
      powerConsumed: 100, // zero power
    });

    updateFogOfWar(fogCtx);

    // GPS keeps everything visible regardless of power
    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(10, 10)).toBe(2);
  });

  it('requiresPower flag is true in SUPERWEAPON_DEFS', () => {
    // C++ house.cpp:660: second parameter is true
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].requiresPower).toBe(true);
  });
});

// =============================================================================
// Section 5: GPS Is One-Shot, Auto-Fires
// C++ house.cpp:1446-1460
// =============================================================================

describe('GPS auto-fire and one-shot semantics (house.cpp:1446-1460)', () => {
  /**
   * C++ house.cpp:1446-1460:
   *   if (SuperWeapon[SPC_GPS].Is_Ready()) {
   *     SuperWeapon[SPC_GPS].Discharged(this == PlayerPtr);
   *     SuperWeapon[SPC_GPS].Remove();  // <-- removed from sidebar
   *     ...
   *     bldg->HasFired = true;          // <-- per-building one-shot flag
   *     bldg->Assign_Mission(MISSION_MISSILE); // launch animation
   *   }
   *
   * GPS auto-fires as soon as it charges. No player targeting needed.
   * The ATEK building is marked HasFired=true (cannot re-fire from same building).
   * C++ house.cpp:1434: sidebar removal when IsGPSActive || ATEK gone || defeated.
   *
   * TS parity: superweapon.ts:152 auto-fires GPS on ready + !fired.
   * needsTarget=false in SUPERWEAPON_DEFS — no manual targeting.
   */

  it('GPS auto-fires when charged (needsTarget=false)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].needsTarget).toBe(false);
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].targetMode).toBe('none');
  });

  it('auto-fire sets gpsActive=true and calls revealAll', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({ structures: [atek] });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      ready: true,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks,
    }));

    updateSuperweapons(ctx);

    expect(ctx.gpsActive).toBe(true);
    expect(ctx._revealCalled()).toBe(true);
  });

  it('auto-fire marks state as fired=true, ready=false', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({ structures: [atek] });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      ready: true,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks,
    }));

    updateSuperweapons(ctx);

    const state = ctx.superweapons.get(key);
    expect(state).toBeDefined();
    expect(state!.fired).toBe(true);
    expect(state!.ready).toBe(false);
  });

  it('EVA message "GPS satellite launched" on player fire', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({ structures: [atek] });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      ready: true,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks,
    }));

    updateSuperweapons(ctx);

    expect(ctx._evaMessages).toContain('GPS satellite launched');
  });

  it('GPS does not re-fire once already fired (one-shot)', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({ structures: [atek], gpsActive: true });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      fired: true,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks,
      ready: false,
    }));

    // Run multiple ticks — should not re-fire
    for (let i = 0; i < 10; i++) {
      ctx.tick = i;
      updateSuperweapons(ctx);
    }

    // gpsActive stays true (was already set), not re-fired
    expect(ctx.gpsActive).toBe(true);
    // No "GPS satellite launched" message (already fired)
    expect(ctx._evaMessages.filter(m => m === 'GPS satellite launched')).toHaveLength(0);
  });
});

// =============================================================================
// Section 6: GPS Re-Acquisition After ATEK Rebuild
// C++ house.cpp:1467-1494
// =============================================================================

describe('GPS re-acquisition after ATEK rebuild (house.cpp:1467-1494)', () => {
  /**
   * C++ house.cpp:1467-1480:
   *   if ((ActiveBScan & STRUCTF_ADVANCED_TECH) != 0 &&
   *       !IsGPSActive &&
   *       Control.TechLevel >= Rule.GPSTechLevel &&
   *       (IsHuman || IQ >= Rule.IQSuperWeapons)) {
   *     bool canfire = false;
   *     for (buildings) {
   *       if (bldg == STRUCT_ADVANCED_TECH && !bldg->HasFired) {
   *         canfire = true; break;
   *       }
   *     }
   *     if (canfire) SuperWeapon[SPC_GPS].Enable(...);
   *   }
   *
   * After GPS is lost (all ATEKs destroyed), building a NEW ATEK can
   * re-enable GPS charging because the new ATEK has HasFired=false.
   * The !IsGPSActive check prevents re-enabling while GPS is still active.
   *
   * TS parity: When all ATEKs are destroyed, the superweapon entry is deleted
   * (superweapon.ts:251-255). When a new ATEK is built, a fresh entry is
   * created with fired=false (superweapon.ts:120-130). This correctly allows
   * GPS to re-charge from a rebuilt ATEK.
   */

  it('new ATEK after GPS loss allows re-charging', () => {
    // Phase 1: GPS was active, ATEK destroyed
    const deadAtek = makeStructure('ATEK', House.Spain, 10, 10, { alive: false });
    const ctx = makeSuperweaponCtx({ structures: [deadAtek], gpsActive: true });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      fired: true,
    }));

    updateSuperweapons(ctx);
    expect(ctx.gpsActive).toBe(false);
    expect(ctx.superweapons.has(key)).toBe(false); // entry cleaned up

    // Phase 2: New ATEK built
    const newAtek = makeStructure('ATEK', House.Spain, 30, 30);
    ctx.structures = [newAtek];

    // Run ticks — new GPS entry should be created and start charging
    for (let i = 0; i < 10; i++) {
      ctx.tick = 100 + i;
      updateSuperweapons(ctx);
    }

    const newState = ctx.superweapons.get(key);
    expect(newState).toBeDefined();
    expect(newState!.fired).toBe(false); // fresh entry, not fired
    expect(newState!.chargeTick).toBeGreaterThan(0); // charging
  });

  it('GPS cannot re-enable while still active (house.cpp:1468 !IsGPSActive check)', () => {
    // C++ explicitly checks !IsGPSActive before creating a new GPS entry.
    // If GPS is still active, building another ATEK does not create a second entry.
    const atek1 = makeStructure('ATEK', House.Spain, 10, 10);
    const atek2 = makeStructure('ATEK', House.Spain, 20, 20);
    const ctx = makeSuperweaponCtx({
      structures: [atek1, atek2],
      gpsActive: true,
    });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      fired: true,
    }));

    updateSuperweapons(ctx);

    // Should not have created a new charging entry — GPS is still active
    const state = ctx.superweapons.get(key);
    // The entry should exist (ATEK alive) but remain in fired state
    expect(state?.fired).toBe(true);
    expect(state?.ready).toBe(false);
  });
});

// =============================================================================
// Section 7: GPSTechLevel Gating
// C++ house.cpp:1469: Control.TechLevel >= Rule.GPSTechLevel
// rules.ini [General] GPSTechLevel=8
// =============================================================================

describe('GPSTechLevel gating (house.cpp:1469, rules.ini GPSTechLevel=8)', () => {
  /**
   * C++ house.cpp:1469: Control.TechLevel >= Rule.GPSTechLevel
   * rules.ini [General] GPSTechLevel=8
   * C++ rules.cpp:127: GPSTechLevel default=0 (overridden by rules.ini to 8)
   *
   * In C++, GPS only becomes available when the scenario's tech level >= 8.
   * Lower tech level scenarios (e.g., early missions) cannot get GPS even
   * with an ATEK.
   *
   * TS parity: superweapon.ts receives both the house Control.TechLevel and
   * scenario-overridden GPSTechLevel, and only creates GPS when the C++ gate
   * passes.
   */

  it('does not create GPS when house tech is below GPSTechLevel', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({
      structures: [atek],
      houseTechLevel: () => 7,
      gpsTechLevel: 8,
    });

    updateSuperweapons(ctx);

    expect(ctx.superweapons.has(`${House.Spain}:${SuperweaponType.GPS_SATELLITE}`)).toBe(false);
  });

  it('creates GPS when house tech meets GPSTechLevel', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({
      structures: [atek],
      houseTechLevel: () => 8,
      gpsTechLevel: 8,
    });

    updateSuperweapons(ctx);

    expect(ctx.superweapons.has(`${House.Spain}:${SuperweaponType.GPS_SATELLITE}`)).toBe(true);
  });

  it('respects scenario GPSTechLevel overrides', () => {
    // SCG08EA overrides [General] GPSTechLevel=10 while Greece TechLevel=8.
    const atek = makeStructure('ATEK', House.Greece, 10, 10);
    const ctx = makeSuperweaponCtx({
      structures: [atek],
      playerHouse: House.Greece,
      houseTechLevel: () => 8,
      gpsTechLevel: 10,
    });

    updateSuperweapons(ctx);

    expect(ctx.superweapons.has(`${House.Greece}:${SuperweaponType.GPS_SATELLITE}`)).toBe(false);
  });
});

// =============================================================================
// Section 8: IsGPSActive vs IsVisionary — Dual Flag Semantics
// C++ bullet.cpp:413-414: sets BOTH IsGPSActive AND IsVisionary
// =============================================================================

describe('IsGPSActive and IsVisionary dual flags (bullet.cpp:413-414)', () => {
  /**
   * C++ bullet.cpp:413-414 (and 1067-1068):
   *   Payback->House->IsGPSActive = true;
   *   Payback->House->IsVisionary = true;
   *
   * In C++, GPS sets TWO separate flags:
   * - IsGPSActive: prevents Shroud_Cell (display.cpp:4159), survives until ATEK destroyed
   * - IsVisionary: a separate flag (also set by reveal crate), broader purpose
   *
   * When ATEK is destroyed (house.cpp:1420-1425):
   *   IsGPSActive = false;  // <-- only this one is cleared
   *   // IsVisionary is NOT cleared! This means if you had GPS, lost ATEK,
   *   // you STILL have IsVisionary from GPS (but not IsGPSActive).
   *
   * This distinction matters for crate fallback logic:
   *   cell.cpp:2186-2193: if IsVisionary && IsGPSActive -> CRATE_MONEY
   *                       if IsVisionary && !IsGPSActive -> CRATE_DARKNESS
   *
   * TS parity: TS folds both into a single `gpsActive` flag. The crate system
   * uses a separate `visionaryHouses` Set. When GPS fires, only gpsActive is
   * set — visionaryHouses is NOT populated. This creates a minor difference:
   * in C++, after GPS fires, picking up a reveal crate gives money/darkness;
   * in TS, it just re-reveals (no fallback). This gap is documented in
   * cpp-parity-crate-collection.test.ts.
   */

  it('DOCUMENT: GPS sets gpsActive but NOT visionaryHouses (differs from C++ dual flags)', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({ structures: [atek] });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      ready: true,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks,
    }));

    updateSuperweapons(ctx);

    // TS sets gpsActive (equivalent to C++ IsGPSActive)
    expect(ctx.gpsActive).toBe(true);

    // C++ also sets IsVisionary — TS does not have an equivalent flag
    // in the superweapon context. The visionaryHouses mechanism exists
    // only in the crate system (crates.ts). This is a known simplification.
  });
});

// =============================================================================
// Section 9: GPS + Shroud_The_Map Unit Re-reveal
// C++ map.cpp:2111-2134 — after shrouding, re-reveal around player units
// =============================================================================

describe('Shroud_The_Map re-reveals around units (map.cpp:2129-2134)', () => {
  /**
   * C++ map.cpp:2129-2134:
   *   After shrouding the entire map, C++ immediately calls Look() on all
   *   player units to re-reveal their sight radius.
   *
   * TS parity: map.shroudAll() only blanks the map. Re-reveal happens on
   * the next updateFogOfWar() call. This is a minor timing difference
   * (one tick delay) but functionally equivalent in the game loop.
   */

  it('after GPS loss, units re-reveal their sight radius on next fog tick', () => {
    const map = new GameMap();
    map.setBounds(40, 40, 20, 20);
    map.initDefault();

    const unit = new Entity(UnitType.V_MTNK, House.Spain, 50 * CELL_SIZE, 50 * CELL_SIZE);

    // Phase 1: GPS active — everything revealed
    const fogCtx = makeFogContext({
      map,
      gpsActive: true,
      entities: [unit],
    });
    updateFogOfWar(fogCtx);
    expect(map.getVisibility(50, 50)).toBe(2);
    expect(map.getVisibility(40, 40)).toBe(2);

    // Phase 2: ATEK destroyed — shroud everything, GPS lost
    map.shroudAll();
    fogCtx.gpsActive = false;
    expect(map.getVisibility(50, 50)).toBe(0);

    // Phase 3: Next fog tick — units re-reveal
    updateFogOfWar(fogCtx);
    expect(map.getVisibility(50, 50)).toBe(2); // unit's position
    expect(map.getVisibility(40, 40)).toBe(0); // far away — stays shrouded
  });
});

// =============================================================================
// Section 10: Full Charge-to-Fire Lifecycle
// Integration test: ATEK placed -> charges -> auto-fires -> reveals -> ATEK dies -> reshroud
// =============================================================================

describe('full GPS lifecycle: build -> charge -> fire -> lose -> rebuild', () => {
  it('complete lifecycle from ATEK construction to GPS loss and re-acquisition', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({ structures: [atek] });
    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;

    // Phase 1: Start charging
    updateSuperweapons(ctx);
    let state = ctx.superweapons.get(key);
    expect(state).toBeDefined();
    expect(state!.fired).toBe(false);
    expect(state!.ready).toBe(false);

    // Phase 2: Charge to near-completion (7200 ticks)
    const rechargeTicks = SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks;
    // Phase 1 already incremented chargeTick to 1 (tick 0).
    // Now charge to one tick BEFORE ready threshold — stop at rechargeTicks-2
    // so that chargeTick = rechargeTicks - 1 after this loop.
    for (let i = 1; i < rechargeTicks - 1; i++) {
      ctx.tick = i;
      updateSuperweapons(ctx);
    }

    state = ctx.superweapons.get(key);
    expect(state!.chargeTick).toBe(rechargeTicks - 1);
    expect(state!.ready).toBe(false);
    expect(state!.fired).toBe(false);

    // Phase 3: Final tick — charges to full AND auto-fires in same call
    // C++ house.cpp:1446 auto-fires within the same Super_Weapon logic pass.
    // In TS, superweapon.ts lines 139-143 increment chargeTick to rechargeTicks,
    // set ready=true, then lines 152-167 immediately auto-fire GPS.
    ctx.tick = rechargeTicks - 1;
    updateSuperweapons(ctx);

    expect(ctx.gpsActive).toBe(true);
    expect(ctx._revealCalled()).toBe(true);
    state = ctx.superweapons.get(key);
    expect(state!.fired).toBe(true);

    // Phase 4: ATEK destroyed — GPS lost
    atek.alive = false;
    ctx.tick = rechargeTicks + 1;
    updateSuperweapons(ctx);

    expect(ctx.gpsActive).toBe(false);
    expect(ctx._shroudCalled()).toBe(true);
    expect(ctx.superweapons.has(key)).toBe(false); // entry cleaned up

    // Phase 5: New ATEK — re-acquisition
    const newAtek = makeStructure('ATEK', House.Spain, 30, 30);
    ctx.structures = [newAtek];
    ctx.tick = rechargeTicks + 2;
    updateSuperweapons(ctx);

    const newState = ctx.superweapons.get(key);
    expect(newState).toBeDefined();
    expect(newState!.fired).toBe(false);
    expect(newState!.chargeTick).toBe(1); // started charging
  });
});

// =============================================================================
// Section 11: GPS Initialization
// C++ house.cpp:545 — IsGPSActive initialized false
// =============================================================================

describe('GPS initialization (house.cpp:545)', () => {
  /**
   * C++ house.cpp:545: IsGPSActive(false) in constructor initialization list
   *
   * GPS starts inactive. It only becomes active when the GPS satellite
   * bullet reaches the edge of the map (bullet.cpp:403-414).
   */

  it('gpsActive starts false in fresh context', () => {
    const ctx = makeSuperweaponCtx();
    expect(ctx.gpsActive).toBe(false);
  });

  it('fog reveals nothing (except around units) when gpsActive is false', () => {
    const map = new GameMap();
    const fogCtx = makeFogContext({ map, gpsActive: false, entities: [] });
    updateFogOfWar(fogCtx);

    // No units, no GPS — everything shrouded
    expect(map.getVisibility(64, 64)).toBe(0);
  });
});

// =============================================================================
// Section 12: Per-Building HasFired (C++ one-shot per ATEK)
// C++ house.cpp:1455, 1476
// =============================================================================

describe('per-building HasFired one-shot (house.cpp:1455, 1476)', () => {
  /**
   * C++ house.cpp:1455: bldg->HasFired = true — marks the specific ATEK building
   * C++ house.cpp:1476: if (!bldg->HasFired) { canfire = true; }
   *
   * In C++, the one-shot is tracked PER BUILDING. If you have two ATEKs,
   * only one fires. The second ATEK's HasFired remains false, but since
   * IsGPSActive is true, the !IsGPSActive check (line 1468) prevents
   * re-enabling GPS.
   *
   * TS parity: TS tracks `fired` on the SuperweaponState (per house+type key).
   * There is only one GPS entry per house, so this is functionally equivalent.
   * The per-building granularity is collapsed into a per-house flag.
   *
   * Behavioral difference: In C++, if you sell the fired ATEK but keep a second
   * unfired ATEK, AND somehow IsGPSActive becomes false (e.g., save/load quirk),
   * the second ATEK could re-enable GPS. In TS, re-charging only happens when
   * the entry is deleted (all ATEKs destroyed) and a new one is created.
   */

  it('DOCUMENT: TS uses per-house fired flag vs C++ per-building HasFired', () => {
    // Two ATEKs — TS should only have ONE GPS entry
    const atek1 = makeStructure('ATEK', House.Spain, 10, 10);
    const atek2 = makeStructure('ATEK', House.Spain, 20, 20);
    const ctx = makeSuperweaponCtx({ structures: [atek1, atek2] });

    updateSuperweapons(ctx);

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    // Only one entry exists despite two ATEKs
    let count = 0;
    for (const [k] of ctx.superweapons) {
      if (k === key) count++;
    }
    expect(count).toBe(1);
  });
});

// =============================================================================
// Section 13: GPS Effect on Enemy Side
// C++ bullet.cpp:403-414 — GPS fires for the owning house
// =============================================================================

describe('GPS is house-specific (bullet.cpp:403-414)', () => {
  /**
   * C++ bullet.cpp:403-414:
   *   if (Payback->House == PlayerPtr) {
   *     // reveal map cells for player only
   *     for (CELL cell = 0; cell < MAP_CELL_TOTAL; cell++) {
   *       Map.Map_Cell(cell, PlayerPtr);
   *     }
   *   }
   *   Payback->House->IsGPSActive = true; // set for owning house regardless
   *
   * IsGPSActive is set for the owning house regardless, but map reveals
   * (Map_Cell) and radar activation only happen for the player's house.
   *
   * PARITY BUG: TS superweapon.ts:153 calls ctx.map.revealAll() BEFORE
   * the isAllied check on line 157. This means enemy GPS auto-fire
   * incorrectly calls revealAll() on the player's map. The gpsActive flag
   * is correctly gated behind isAllied (line 157-158), but the one-time
   * revealAll() call leaks to all houses.
   *
   * Impact: Minor — enemy GPS fires revealAll() once, but since gpsActive
   * stays false, the next fog tick will re-shroud everything. The player
   * gets a single-tick flash of full visibility, then normal fog resumes.
   */

  it('enemy GPS firing does not set player gpsActive (flag correctly gated)', () => {
    const enemyAtek = makeStructure('ATEK', House.USSR, 10, 10);
    const ctx = makeSuperweaponCtx({
      structures: [enemyAtek],
    });

    const key = `${House.USSR}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.USSR, {
      ready: true,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks,
    }));

    updateSuperweapons(ctx);

    // Player's gpsActive should remain false (correctly gated by isAllied)
    expect(ctx.gpsActive).toBe(false);

    // Enemy's GPS entry should be marked as fired
    const state = ctx.superweapons.get(key);
    expect(state?.fired).toBe(true);
  });

  it('PARITY FIXED: enemy GPS does not call revealAll (superweapon.ts — revealAll inside isAllied)', () => {
    // C++ bullet.cpp:404: Map_Cell only runs if Payback->House == PlayerPtr
    // TS superweapon.ts: revealAll() now correctly gated behind isAllied check.
    const enemyAtek = makeStructure('ATEK', House.USSR, 10, 10);
    const ctx = makeSuperweaponCtx({
      structures: [enemyAtek],
    });

    const key = `${House.USSR}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.USSR, {
      ready: true,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks,
    }));

    updateSuperweapons(ctx);

    // FIXED: revealAll() is NOT called when GPS is fired by enemy
    // C++ bullet.cpp:404: Map_Cell only runs if Payback->House == PlayerPtr
    expect(ctx._revealCalled()).toBe(false); // matches C++ behavior
  });
});

// =============================================================================
// Section 14: GPS Visual Effect on Fire
// C++ bullet.cpp:403-411 + house.cpp:1456 — Radar_Activate + MISSION_MISSILE
// =============================================================================

describe('GPS visual effect on fire', () => {
  /**
   * C++ bullet.cpp:405-406: Map.Radar_Activate(1) — activates radar display
   * C++ house.cpp:1456: bldg->Assign_Mission(MISSION_MISSILE) — launch animation
   *
   * TS parity: superweapon.ts:161-165 creates a visual 'marker' effect for
   * the GPS sweep. The radar concept is not separate in TS (fog system handles it).
   */

  it('GPS fire creates a visual effect', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({ structures: [atek] });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      ready: true,
      chargeTick: SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks,
    }));

    const effectsBefore = ctx.effects.length;
    updateSuperweapons(ctx);

    // Should have added a visual effect (GPS sweep marker)
    expect(ctx.effects.length).toBeGreaterThan(effectsBefore);
    const gpsEffect = ctx.effects[ctx.effects.length - 1];
    expect(gpsEffect.type).toBe('marker');
  });
});

// =============================================================================
// Section 15: GPS Superweapon Cleanup on Building Death
// C++ house.cpp:1433-1441 — Remove GPS from sidebar
// =============================================================================

describe('GPS entry cleanup on ATEK death (house.cpp:1433-1441)', () => {
  /**
   * C++ house.cpp:1433-1434:
   *   if (SuperWeapon[SPC_GPS].Is_Present()) {
   *     if (!(ActiveBScan & STRUCTF_ADVANCED_TECH) || IsGPSActive || IsDefeated) {
   *       SuperWeapon[SPC_GPS].Remove();
   *
   * GPS is removed from sidebar/cleaned up when:
   * 1. No ATEK exists (building destroyed)
   * 2. GPS has been fired (IsGPSActive)
   * 3. House is defeated
   *
   * TS parity: superweapon.ts:251-255 removes entries for keys not in
   * activeBuildings set. When ATEK is destroyed, the key is not added,
   * so the entry is deleted.
   */

  it('GPS entry removed when ATEK destroyed before firing', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10, { alive: false });
    const ctx = makeSuperweaponCtx({ structures: [atek] });

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    ctx.superweapons.set(key, makeSwState(SuperweaponType.GPS_SATELLITE, House.Spain, {
      chargeTick: 500, // partially charged
    }));

    updateSuperweapons(ctx);

    expect(ctx.superweapons.has(key)).toBe(false);
  });

  it('GPS entry persists while ATEK alive and charging', () => {
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({ structures: [atek] });

    updateSuperweapons(ctx);

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    expect(ctx.superweapons.has(key)).toBe(true);
  });

  it('partially charged GPS is lost when ATEK dies (no persistence)', () => {
    // C++ removes GPS from sidebar entirely — charge progress is lost.
    // If player rebuilds ATEK, GPS starts charging from 0.
    const atek = makeStructure('ATEK', House.Spain, 10, 10);
    const ctx = makeSuperweaponCtx({ structures: [atek] });

    // Charge GPS partway
    for (let i = 0; i < 3000; i++) {
      ctx.tick = i;
      updateSuperweapons(ctx);
    }

    const key = `${House.Spain}:${SuperweaponType.GPS_SATELLITE}`;
    let state = ctx.superweapons.get(key);
    expect(state!.chargeTick).toBe(3000);

    // ATEK destroyed
    atek.alive = false;
    ctx.tick = 3001;
    updateSuperweapons(ctx);

    expect(ctx.superweapons.has(key)).toBe(false);

    // Rebuild ATEK
    const newAtek = makeStructure('ATEK', House.Spain, 30, 30);
    ctx.structures = [newAtek];
    ctx.tick = 3002;
    updateSuperweapons(ctx);

    state = ctx.superweapons.get(key);
    expect(state).toBeDefined();
    // Charge starts from 0 (or 1), not from 3000
    expect(state!.chargeTick).toBeLessThanOrEqual(1);
  });
});
