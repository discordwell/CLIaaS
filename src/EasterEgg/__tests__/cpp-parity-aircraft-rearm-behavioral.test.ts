/**
 * C++ Behavioral Parity: Aircraft Rearm — Building-Driven Formula
 *
 * Verifies that TS aircraft rearm matches the C++ building.cpp:3989-4037
 * building-driven rearm model. The building (helipad/airstrip) controls
 * the rearm timing via RADIO_RELOAD messages, with delay scaled by
 * the house power fraction.
 *
 * C++ formula (building.cpp:4023-4025):
 *   pfrac = Saturate(Power_Fraction(), 1), clamped to min 0.5
 *   time = Inverse(pfrac) * Rule.ReloadRate * TICKS_PER_MINUTE
 *
 * rules.ini [General] ReloadRate=.04 (authoritative, overrides .cpp default of .05)
 * defines.h: TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 *
 * At full power (1.0): 1.0 * 0.04 * 900 = 36 ticks per ammo point
 * At 75% power:        1.333 * 0.04 * 900 = 48 ticks per ammo point
 * At 50% power (min):  2.0 * 0.04 * 900 = 72 ticks per ammo point
 * Below 50% clamps to 50%: always 72 ticks max delay
 *
 * C++ source refs:
 *   building.cpp:3989-4037 — helipad/airstrip Mission_Repair rearm loop
 *   building.cpp:4023       — pfrac = Saturate(Power_Fraction(), 1)
 *   building.cpp:4024       — if (pfrac < fixed::_1_2) pfrac = fixed::_1_2
 *   building.cpp:4025       — time = Inverse(pfrac) * Rule.ReloadRate * TICKS_PER_MINUTE
 *   techno.cpp:964-968      — RADIO_RELOAD handler: Ammo++ (one per message)
 *   rules.ini [General]     — ReloadRate=.04
 *   defines.h:3031-3032     — TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission,
  UNIT_STATS,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type AircraftContext,
  updateAircraft,
  computeRearmDelay,
  RELOAD_RATE,
  TICKS_PER_MINUTE,
  TICKS_PER_SECOND,
} from '../engine/aircraft';
import type { MapStructure } from '../engine/scenario';
import { GameMap } from '../engine/map';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

function makeAircraftCtx(overrides: Partial<AircraftContext> = {}): AircraftContext {
  return {
    structures: [],
    map: new GameMap(),
    unitsLeftMap: 0,
    civiliansEvacuated: 0,
    isAllied: (a: House, b: House) => a === b,
    movementSpeed: () => 2,
    idleMission: () => Mission.GUARD,
    fireWeaponAt: vi.fn(),
    fireWeaponAtStructure: vi.fn(),
    getROFBias: () => 1.0,
    getPowerFraction: () => 1.0,
    ...overrides,
  };
}

function makePadStructure(
  type: string, house: House, cx: number, cy: number,
  dockedAircraft?: number,
): MapStructure {
  return {
    type, image: type.toLowerCase(), house,
    cx, cy, hp: 256, maxHp: 256, alive: true, rubble: false,
    weapon: null,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    dockedAircraft,
  };
}

/** Run aircraft through landing→rearming→landed, returns total ticks spent rearming */
function simulateFullRearm(
  type: UnitType, house: House, powerFraction: number,
): { ticks: number; finalAmmo: number } {
  const entity = makeEntity(type, house);
  const maxAmmo = entity.maxAmmo;
  entity.ammo = 0;
  entity.aircraftState = 'landing';
  entity.flightAltitude = 0;
  entity.landedAtStructure = 0;

  const padType = entity.stats.landingBuilding ?? 'HPAD';
  const pad = makePadStructure(padType, house, 5, 5);
  pad.dockedAircraft = entity.id;
  const ctx = makeAircraftCtx({
    structures: [pad],
    getPowerFraction: () => powerFraction,
  });

  // First tick: landing→rearming transition
  updateAircraft(ctx, entity);
  expect(entity.aircraftState).toBe('rearming');

  let ticks = 0;
  while (entity.aircraftState === 'rearming' && ticks < 20000) {
    updateAircraft(ctx, entity);
    ticks++;
  }

  return { ticks, finalAmmo: entity.ammo };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 1: computeRearmDelay — Pure Function Tests
// C++ building.cpp:4023-4025
// ═══════════════════════════════════════════════════════════════════════════════

describe('computeRearmDelay — C++ building.cpp:4023-4025 formula', () => {
  it('full power (1.0): 1.0 * 0.04 * 900 = 36 ticks', () => {
    expect(computeRearmDelay(1.0)).toBe(36);
  });

  it('75% power: round(1.333 * 0.04 * 900) = 48 ticks', () => {
    expect(computeRearmDelay(0.75)).toBe(48);
  });

  it('50% power (minimum clamp): 2.0 * 0.04 * 900 = 72 ticks', () => {
    expect(computeRearmDelay(0.5)).toBe(72);
  });

  it('25% power clamps to 50%: still 72 ticks (building.cpp:4024)', () => {
    // C++ building.cpp:4024: if (pfrac < fixed::_1_2) pfrac = fixed::_1_2;
    expect(computeRearmDelay(0.25)).toBe(72);
  });

  it('0% power clamps to 50%: still 72 ticks', () => {
    expect(computeRearmDelay(0.0)).toBe(72);
  });

  it('negative power clamps to 50%: still 72 ticks', () => {
    expect(computeRearmDelay(-1.0)).toBe(72);
  });

  it('over-powered (1.5) saturates to 1.0: still 36 ticks', () => {
    // C++ building.cpp:4023: Saturate(Power_Fraction(), 1)
    expect(computeRearmDelay(1.5)).toBe(36);
  });

  it('result is always >= 1', () => {
    for (let p = 0; p <= 2; p += 0.1) {
      expect(computeRearmDelay(p)).toBeGreaterThanOrEqual(1);
    }
  });

  it('ReloadRate constant matches rules.ini (.04)', () => {
    expect(RELOAD_RATE).toBe(0.04);
  });

  it('TICKS_PER_MINUTE constant matches C++ defines.h (900)', () => {
    expect(TICKS_PER_MINUTE).toBe(900);
  });

  it('TICKS_PER_SECOND constant matches C++ defines.h (15)', () => {
    expect(TICKS_PER_SECOND).toBe(15);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 2: Full Rearm Cycle — All Aircraft Types at Full Power
// C++ building.cpp:4025 + techno.cpp:964-968
// ═══════════════════════════════════════════════════════════════════════════════

describe('full rearm cycle — all aircraft at full power (building.cpp:4025)', () => {
  const FULL_POWER_TICKS = computeRearmDelay(1.0); // = 36

  const AIRCRAFT: { name: string; type: UnitType; maxAmmo: number }[] = [
    { name: 'MIG',  type: UnitType.V_MIG,  maxAmmo: 3 },
    { name: 'YAK',  type: UnitType.V_YAK,  maxAmmo: 15 },
    { name: 'HELI', type: UnitType.V_HELI, maxAmmo: 6 },
    { name: 'HIND', type: UnitType.V_HIND, maxAmmo: 12 },
  ];

  for (const { name, type, maxAmmo } of AIRCRAFT) {
    const expectedTicks = maxAmmo * FULL_POWER_TICKS;
    it(`${name}: 0→${maxAmmo} ammo takes ${expectedTicks} ticks (${maxAmmo} * ${FULL_POWER_TICKS})`, () => {
      const { ticks, finalAmmo } = simulateFullRearm(type, House.USSR, 1.0);
      expect(finalAmmo).toBe(maxAmmo);
      expect(ticks).toBe(expectedTicks);
    });
  }

  it('all aircraft use identical per-ammo delay regardless of weapon type', () => {
    // C++ building-driven: weapon ROF is irrelevant to pad rearm
    // MIG (Maverick rof=3), YAK (ChainGun rof=3), HELI (Hellfire rof=60), HIND (ChainGun rof=3)
    // All should use 36 ticks/ammo at full power
    for (const { name, type } of AIRCRAFT) {
      const entity = makeEntity(type, House.USSR);
      entity.ammo = 0;
      entity.aircraftState = 'landing';
      entity.flightAltitude = 0;
      entity.landedAtStructure = 0;

      const padType = entity.stats.landingBuilding ?? 'HPAD';
      const pad = makePadStructure(padType, House.USSR, 5, 5);
      pad.dockedAircraft = entity.id;
      const ctx = makeAircraftCtx({ structures: [pad] });

      updateAircraft(ctx, entity);
      expect(entity.rearmTimer, `${name}`).toBe(FULL_POWER_TICKS);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 3: Power Fraction Scaling — Rearm Slows Under Low Power
// C++ building.cpp:4023-4024: pfrac clamped to [0.5, 1.0]
// ═══════════════════════════════════════════════════════════════════════════════

describe('power fraction scaling — rearm delay increases under low power', () => {
  it('MIG at 50% power: 3 * 72 = 216 ticks (2x slower than full power)', () => {
    const { ticks, finalAmmo } = simulateFullRearm(UnitType.V_MIG, House.USSR, 0.5);
    expect(finalAmmo).toBe(3);
    expect(ticks).toBe(3 * computeRearmDelay(0.5)); // 3 * 72 = 216
  });

  it('HELI at 75% power: 6 * 48 = 288 ticks', () => {
    const { ticks, finalAmmo } = simulateFullRearm(UnitType.V_HELI, House.Spain, 0.75);
    expect(finalAmmo).toBe(6);
    expect(ticks).toBe(6 * computeRearmDelay(0.75)); // 6 * 48 = 288
  });

  it('HIND at 0% power (clamps to 50%): 12 * 72 = 864 ticks', () => {
    const { ticks, finalAmmo } = simulateFullRearm(UnitType.V_HIND, House.USSR, 0.0);
    expect(finalAmmo).toBe(12);
    expect(ticks).toBe(12 * computeRearmDelay(0.0)); // 12 * 72 = 864
  });

  it('YAK at 100% power: 15 * 36 = 540 ticks', () => {
    const { ticks, finalAmmo } = simulateFullRearm(UnitType.V_YAK, House.USSR, 1.0);
    expect(finalAmmo).toBe(15);
    expect(ticks).toBe(15 * 36); // 540
  });

  it('power fraction below 0.5 clamps — 10% and 50% produce same delay', () => {
    const delay10 = computeRearmDelay(0.1);
    const delay50 = computeRearmDelay(0.5);
    expect(delay10).toBe(delay50); // both clamped to 72
  });

  it('power fraction above 1.0 saturates — 1.5 and 1.0 produce same delay', () => {
    const delay150 = computeRearmDelay(1.5);
    const delay100 = computeRearmDelay(1.0);
    expect(delay150).toBe(delay100); // both 36
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 4: Rearm Timer Reset Between Ammo Points
// C++ techno.cpp:964-968 + building.cpp:4025
// ═══════════════════════════════════════════════════════════════════════════════

describe('rearm timer reset between ammo points', () => {
  it('timer resets to full delay after each ammo increment (not once)', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 0;
    mig.maxAmmo = 3;
    mig.aircraftState = 'rearming';
    mig.rearmTimer = 36; // full power

    const ctx = makeAircraftCtx();

    // After 36 ticks, first ammo should increment
    for (let i = 0; i < 36; i++) updateAircraft(ctx, mig);
    expect(mig.ammo).toBe(1);
    expect(mig.rearmTimer).toBe(36); // reset for next ammo

    // After another 36 ticks, second ammo
    for (let i = 0; i < 36; i++) updateAircraft(ctx, mig);
    expect(mig.ammo).toBe(2);
    expect(mig.rearmTimer).toBe(36); // reset again

    // After another 36 ticks, third ammo — fully loaded
    for (let i = 0; i < 36; i++) updateAircraft(ctx, mig);
    expect(mig.ammo).toBe(3);
    expect(mig.aircraftState).toBe('landed');
  });

  it('mid-rearm power change: new power applies on next timer reset', () => {
    // Simulate power going from full to half mid-rearm
    let powerFrac = 1.0;
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 0;
    mig.maxAmmo = 3;
    mig.aircraftState = 'rearming';
    mig.rearmTimer = computeRearmDelay(1.0); // 36

    const ctx = makeAircraftCtx({
      getPowerFraction: () => powerFrac,
    });

    // First ammo point at full power: 36 ticks
    for (let i = 0; i < 36; i++) updateAircraft(ctx, mig);
    expect(mig.ammo).toBe(1);
    // Timer reset happened at ammo++, power was still 1.0 at that moment
    expect(mig.rearmTimer).toBe(36);

    // Now cut power to 50% BEFORE the second timer counts down
    powerFrac = 0.5;
    // Second ammo point still takes 36 ticks (timer was already set at full power)
    for (let i = 0; i < 36; i++) updateAircraft(ctx, mig);
    expect(mig.ammo).toBe(2);
    // NOW the timer reset uses 0.5 power → 72 ticks
    expect(mig.rearmTimer).toBe(72);

    // Third ammo point takes 72 ticks (half power timer was set after ammo=2)
    for (let i = 0; i < 72; i++) updateAircraft(ctx, mig);
    expect(mig.ammo).toBe(3);
    expect(mig.aircraftState).toBe('landed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 5: Landing → Rearming Transition Sets Correct Timer
// C++ building.cpp:4025 — first rearm delay set on landing
// ═══════════════════════════════════════════════════════════════════════════════

describe('landing → rearming transition sets C++ correct timer', () => {
  it('MIG landing at full power sets rearmTimer = 36', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 0;
    mig.aircraftState = 'landing';
    mig.flightAltitude = 0;
    mig.landedAtStructure = 0;

    const pad = makePadStructure('AFLD', House.USSR, 5, 5);
    pad.dockedAircraft = mig.id;
    const ctx = makeAircraftCtx({ structures: [pad] });

    updateAircraft(ctx, mig);

    expect(mig.aircraftState).toBe('rearming');
    expect(mig.rearmTimer).toBe(36);
  });

  it('HELI landing at half power sets rearmTimer = 72', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.ammo = 0;
    heli.aircraftState = 'landing';
    heli.flightAltitude = 0;
    heli.landedAtStructure = 0;

    const pad = makePadStructure('HPAD', House.Spain, 5, 5);
    pad.dockedAircraft = heli.id;
    const ctx = makeAircraftCtx({ structures: [pad], getPowerFraction: () => 0.5 });

    updateAircraft(ctx, heli);

    expect(heli.aircraftState).toBe('rearming');
    expect(heli.rearmTimer).toBe(72);
  });

  it('aircraft with full ammo skips rearming entirely', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 3;
    mig.maxAmmo = 3;
    mig.aircraftState = 'landing';
    mig.flightAltitude = 0;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, mig);

    expect(mig.aircraftState).toBe('landed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 6: Regression — Old Weapon-ROF-Based Rearm Would Fail
// Documents that the old formula (weapon.rof * ROFBias) no longer applies
// ═══════════════════════════════════════════════════════════════════════════════

describe('regression: weapon ROF is irrelevant to pad rearm delay', () => {
  it('MIG Maverick rof=3 does NOT produce rearmTimer=3 (old bug)', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 0;
    mig.aircraftState = 'landing';
    mig.flightAltitude = 0;
    mig.landedAtStructure = 0;

    const pad = makePadStructure('AFLD', House.USSR, 5, 5);
    pad.dockedAircraft = mig.id;
    const ctx = makeAircraftCtx({ structures: [pad] });

    updateAircraft(ctx, mig);

    // Old (broken): 3 ticks. New (C++ parity): 36 ticks
    expect(mig.rearmTimer).not.toBe(3);
    expect(mig.rearmTimer).toBe(36);
  });

  it('HELI Hellfire rof=60 does NOT produce rearmTimer=60 (old bug)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.ammo = 0;
    heli.aircraftState = 'landing';
    heli.flightAltitude = 0;
    heli.landedAtStructure = 0;

    const pad = makePadStructure('HPAD', House.Spain, 5, 5);
    pad.dockedAircraft = heli.id;
    const ctx = makeAircraftCtx({ structures: [pad] });

    updateAircraft(ctx, heli);

    // Old (broken): 60 ticks. New (C++ parity): 36 ticks
    expect(heli.rearmTimer).not.toBe(60);
    expect(heli.rearmTimer).toBe(36);
  });

  it('MIG full rearm is NOT 9 ticks anymore (was 12x faster than C++)', () => {
    const { ticks } = simulateFullRearm(UnitType.V_MIG, House.USSR, 1.0);
    expect(ticks).not.toBe(9); // old: 3 ammo * 3 rof = 9
    expect(ticks).toBe(108);   // new: 3 ammo * 36 ticks = 108
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 7: Real-Time Duration Equivalence
// Verify tick counts translate to expected real-world seconds
// ═══════════════════════════════════════════════════════════════════════════════

describe('rearm duration in real-time seconds', () => {
  it('MIG full rearm at full power: 108 ticks = 7.2 seconds', () => {
    const ticks = 3 * computeRearmDelay(1.0); // 108
    const seconds = ticks / TICKS_PER_SECOND;
    expect(seconds).toBeCloseTo(7.2, 1);
  });

  it('YAK full rearm at full power: 540 ticks = 36 seconds', () => {
    const ticks = 15 * computeRearmDelay(1.0); // 540
    const seconds = ticks / TICKS_PER_SECOND;
    expect(seconds).toBeCloseTo(36, 1);
  });

  it('HIND full rearm at half power: 864 ticks = 57.6 seconds', () => {
    const ticks = 12 * computeRearmDelay(0.5); // 864
    const seconds = ticks / TICKS_PER_SECOND;
    expect(seconds).toBeCloseTo(57.6, 1);
  });

  it('single ammo at full power: 36 ticks = 2.4 seconds', () => {
    const seconds = computeRearmDelay(1.0) / TICKS_PER_SECOND;
    expect(seconds).toBeCloseTo(2.4, 1);
  });
});
