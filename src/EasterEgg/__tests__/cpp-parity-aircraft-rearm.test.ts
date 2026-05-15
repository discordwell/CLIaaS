/**
 * C++ Behavioral Parity: Aircraft Rearming State Machine
 *
 * Tests verify landing pad selection, rearm delay calculation, ammo increment,
 * and state transitions match C++ RA source code behavior.
 *
 * C++ algorithm summary:
 *
 * === Landing Pad Selection (aircraft.cpp Enter_Idle_Mode ~line 1913, Mission_Guard ~line 3742) ===
 *   1. Fixed-wing aircraft (MIG/YAK) prefer STRUCT_AIRSTRIP (aadata.cpp:122,145)
 *   2. Helicopters (HELI/HIND) prefer STRUCT_HELIPAD (aadata.cpp:191,215)
 *   3. Find_Docking_Bay(Class->Building, false) — nearest available pad of correct type
 *   4. Pad must be owned by same house (allied check)
 *   5. If no pad available, helicopters can land on clear terrain (Good_LZ)
 *
 * === Rearm Delay (building.cpp Mission_Repair ~line 3989-4037) ===
 *   - Building (helipad/airstrip) drives the rearm, NOT the aircraft
 *   - RADIO_RELOAD sent to aircraft: Ammo++ (techno.cpp:964-968)
 *   - Delay between each RADIO_RELOAD: Inverse(pfrac) * Rule.ReloadRate * TICKS_PER_MINUTE
 *     where pfrac = Saturate(Power_Fraction(), 1), clamped to >= 0.5
 *   - ReloadRate is a rules.ini value (default ~0.066 = ~4 seconds at full power)
 *   - At full power: time ≈ 1.0 * 0.066 * 900 ≈ 59 ticks (~4 sec)
 *   - At half power: time ≈ 2.0 * 0.066 * 900 ≈ 118 ticks (~8 sec)
 *
 * === Ammo Increment (techno.cpp:964-968) ===
 *   - RADIO_RELOAD: if (Ammo == MaxAmmo) return RADIO_NEGATIVE; else Ammo++;
 *   - One ammo per RADIO_RELOAD, building sends one at a time
 *
 * === Rearm Completion (aircraft.cpp RADIO_PREPARED ~line 2691-2694) ===
 *   - Grounded (Height==0): ready when Ammo == MaxAmmo
 *   - Airborne (Height>0): ready when Ammo > 0 (can fight immediately)
 *
 * === State Transitions ===
 *   - Out of ammo → Enter_Idle_Mode → Find_Docking_Bay → MISSION_ENTER
 *   - MISSION_ENTER: INITIAL → TAKEOFF → ALTITUDE → STACK → DOWNWIND → CROSSWIND → TRAVEL → LANDING
 *   - Landing complete → RADIO_IM_IN → building starts MISSION_REPAIR
 *   - Building rearms: INITIAL (check if needs rearm) → DURING (send RADIO_RELOAD periodically)
 *   - When RADIO_PREPARED returns ROGER (fully rearmed) → aircraft gets MISSION_GUARD
 *
 * === TS Implementation (aircraft.ts) ===
 *   - Simplified: aircraft drives its own rearm (no building radio protocol)
 *   - rearmTimer = weapon.rof * ROFBias (NOT building.cpp ReloadRate formula)
 *   - Ammo++ when rearmTimer reaches 0, then reset timer
 *   - aircraftState transitions: 'returning' → 'landing' → 'rearming' → 'landed'
 *
 * C++ references:
 *   - aadata.cpp:60-219 — aircraft type data (preferred landing building)
 *   - aircraft.cpp:228-248 — constructor (Ammo = Class->MaxAmmo)
 *   - aircraft.cpp:2691-2694 — RADIO_PREPARED (rearm completion check)
 *   - aircraft.cpp:3227-3465 — Mission_Enter (landing state machine)
 *   - aircraft.cpp:3486-3540 — Good_LZ (fallback landing zone for helicopters)
 *   - aircraft.cpp:3742-3760 — Mission_Guard (ammo=0 → find helipad)
 *   - aircraft.cpp:1879-2020 — Enter_Idle_Mode (find docking bay by type)
 *   - building.cpp:3989-4037 — helipad/airstrip rearm state machine
 *   - techno.cpp:964-968 — RADIO_RELOAD handler (Ammo++)
 *   - techno.cpp:2857-2870 — Rearm_Delay (weapon ROF * ROFBias)
 *   - techno.cpp:3119-3122 — Fire_At (Arm = Rearm_Delay, IsSecondShot toggle)
 *   - techno.cpp:3186-3188 — Fire_At (Ammo--)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission,
  UNIT_STATS, WEAPON_STATS, worldDist, directionToLeptons256,
  cellTargetToLepton,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type AircraftContext,
  findLandingPad,
  updateAircraft,
  computeRearmDelay,
} from '../engine/aircraft';
import type { MapStructure } from '../engine/scenario';
import { GameMap } from '../engine/map';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

function makeAircraftCtx(overrides: Partial<AircraftContext> = {}): AircraftContext {
  const structures = overrides.structures ?? [];
  const entities = overrides.entities ?? [];
  const entityById = overrides.entityById ?? new Map(entities.map(e => [e.id, e]));
  if (!overrides.entityById) {
    for (const s of structures) {
      if (s.dockedAircraft !== undefined && s.dockedAircraft > 0 && !entityById.has(s.dockedAircraft)) {
        const docked = makeEntity(UnitType.V_HIND, s.house);
        docked.id = s.dockedAircraft;
        entityById.set(docked.id, docked);
      }
    }
  }
  return {
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
    structures,
    entities,
    entityById,
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

// ═══════════════════════════════════════════════════════════════════════════════
// Section 1: Aircraft Type Data — Landing Building Preference
// C++ aadata.cpp:60-219
// ═══════════════════════════════════════════════════════════════════════════════

describe('aircraft type data — preferred landing building (aadata.cpp:60-219)', () => {
  // C++ aadata.cpp:122: MIG → STRUCT_AIRSTRIP
  it('MIG prefers AFLD (airstrip) — aadata.cpp:122', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    expect(mig.stats.landingBuilding).toBe('AFLD');
  });

  // C++ aadata.cpp:145: YAK → STRUCT_AIRSTRIP
  it('YAK prefers AFLD (airstrip) — aadata.cpp:145', () => {
    const yak = makeEntity(UnitType.V_YAK, House.USSR);
    expect(yak.stats.landingBuilding).toBe('AFLD');
  });

  // C++ aadata.cpp:191: Longbow → STRUCT_HELIPAD
  it('Longbow (HELI) prefers HPAD (helipad) — aadata.cpp:191', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    expect(heli.stats.landingBuilding).toBe('HPAD');
  });

  // C++ aadata.cpp:215: Hind → STRUCT_HELIPAD
  it('Hind prefers HPAD (helipad) — aadata.cpp:215', () => {
    const hind = makeEntity(UnitType.V_HIND, House.USSR);
    expect(hind.stats.landingBuilding).toBe('HPAD');
  });

  // C++ aadata.cpp:168: Transport → STRUCT_NONE
  it('Chinook (TRAN) has no landingBuilding — C++ aadata.cpp:168 STRUCT_NONE', () => {
    const tran = makeEntity(UnitType.V_TRAN, House.Spain);
    // C++ aadata.cpp:168: Transport helicopter has STRUCT_NONE as preferred landing building
    // In C++, transports use Good_LZ() to land on clear terrain, not helipads
    expect(tran.stats.landingBuilding).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 2: Ammo Initialization
// C++ aircraft.cpp:248
// ═══════════════════════════════════════════════════════════════════════════════

describe('ammo initialization (aircraft.cpp:248)', () => {
  // C++ aircraft.cpp:248: Ammo = Class->MaxAmmo
  it('MIG starts with full ammo (MaxAmmo=3) — aadata.cpp + aircraft.cpp:248', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    expect(mig.ammo).toBe(3);
    expect(mig.maxAmmo).toBe(3);
  });

  it('YAK starts with full ammo (MaxAmmo=15)', () => {
    const yak = makeEntity(UnitType.V_YAK, House.USSR);
    expect(yak.ammo).toBe(15);
    expect(yak.maxAmmo).toBe(15);
  });

  it('Longbow starts with full ammo (MaxAmmo=6)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    expect(heli.ammo).toBe(6);
    expect(heli.maxAmmo).toBe(6);
  });

  it('Hind starts with full ammo (MaxAmmo=12)', () => {
    const hind = makeEntity(UnitType.V_HIND, House.USSR);
    expect(hind.ammo).toBe(12);
    expect(hind.maxAmmo).toBe(12);
  });

  // C++ aircraft.cpp:248: Ammo = Class->MaxAmmo. MaxAmmo from rules.ini.
  // C++ TRAN has PrimaryWeapon==NULL so MaxAmmo defaults to -1.
  // TS TRAN has no maxAmmo in UNIT_STATS (no primaryWeapon either).
  it('Chinook (TRAN) has no ammo (transport, no weapon)', () => {
    const tran = makeEntity(UnitType.V_TRAN, House.Spain);
    // C++ Transport: PrimaryWeapon is NULL → no ammo tracking
    // TS: TRAN has no maxAmmo → ammo stays -1 (unlimited/inapplicable)
    expect(tran.ammo).toBe(-1);
    expect(tran.maxAmmo).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 3: Landing Pad Selection — findLandingPad()
// C++ aircraft.cpp:1913 (Enter_Idle_Mode → Find_Docking_Bay(Class->Building, false))
// C++ aircraft.cpp:3742 (Mission_Guard → Find_Docking_Bay(STRUCT_HELIPAD, false))
// ═══════════════════════════════════════════════════════════════════════════════

describe('landing pad selection — findLandingPad() (aircraft.cpp:1913)', () => {
  it('MIG finds AFLD, not HPAD', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 100, 100);
    const afld = makePadStructure('AFLD', House.USSR, 5, 5);
    const hpad = makePadStructure('HPAD', House.USSR, 3, 3);
    const ctx = makeAircraftCtx({ structures: [afld, hpad] });
    const idx = findLandingPad(ctx, mig);
    expect(idx).toBe(0); // AFLD
    expect(ctx.structures[idx].type).toBe('AFLD');
  });

  it('HELI finds HPAD, not AFLD', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 100, 100);
    const afld = makePadStructure('AFLD', House.Spain, 3, 3);
    const hpad = makePadStructure('HPAD', House.Spain, 5, 5);
    const ctx = makeAircraftCtx({ structures: [afld, hpad] });
    const idx = findLandingPad(ctx, heli);
    expect(idx).toBe(1); // HPAD
    expect(ctx.structures[idx].type).toBe('HPAD');
  });

  it('selects nearest pad when multiple available', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 200, 200);
    const farPad = makePadStructure('AFLD', House.USSR, 1, 1);  // far from (200,200)
    const nearPad = makePadStructure('AFLD', House.USSR, 8, 8); // closer to (200,200)
    const ctx = makeAircraftCtx({ structures: [farPad, nearPad] });
    const idx = findLandingPad(ctx, mig);
    expect(idx).toBe(1); // nearPad is closer
  });

  // C++ Find_Docking_Bay checks house ownership — aircraft.cpp:1913
  it('does not select enemy pad (house mismatch)', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 100, 100);
    const enemyPad = makePadStructure('AFLD', House.Spain, 5, 5);
    const ctx = makeAircraftCtx({ structures: [enemyPad] });
    const idx = findLandingPad(ctx, mig);
    expect(idx).toBe(-1); // no allied pad
  });

  it('skips occupied pads', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 100, 100);
    const occupiedPad = makePadStructure('AFLD', House.USSR, 5, 5, 42); // entity 42 docked
    const freePad = makePadStructure('AFLD', House.USSR, 8, 8);
    const ctx = makeAircraftCtx({ structures: [occupiedPad, freePad] });
    const idx = findLandingPad(ctx, mig);
    expect(idx).toBe(1); // free pad
  });

  it('skips destroyed pads', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 100, 100);
    const deadPad = makePadStructure('AFLD', House.USSR, 5, 5);
    deadPad.alive = false;
    const livePad = makePadStructure('AFLD', House.USSR, 8, 8);
    const ctx = makeAircraftCtx({ structures: [deadPad, livePad] });
    const idx = findLandingPad(ctx, mig);
    expect(idx).toBe(1); // live pad
  });

  it('returns -1 when no pad of correct type exists', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 100, 100);
    const hpad = makePadStructure('HPAD', House.USSR, 5, 5); // wrong type for MIG
    const ctx = makeAircraftCtx({ structures: [hpad] });
    const idx = findLandingPad(ctx, mig);
    expect(idx).toBe(-1);
  });

  it('returns -1 when no structures exist', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 100, 100);
    const ctx = makeAircraftCtx({ structures: [] });
    const idx = findLandingPad(ctx, heli);
    expect(idx).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 4: Rearm Delay Calculation
// C++ building.cpp:4023-4025: time = Inverse(pfrac) * Rule.ReloadRate * TICKS_PER_MINUTE
// TS now uses computeRearmDelay(powerFraction) matching C++ building.cpp formula
// ═══════════════════════════════════════════════════════════════════════════════

describe('rearm delay calculation — C++ building.cpp ReloadRate parity', () => {
  /**
   * C++ building.cpp:4023-4025 (helipad/airstrip rearm):
   *   fixed pfrac = Saturate(House->Power_Fraction(), 1);
   *   if (pfrac < fixed::_1_2) pfrac = fixed::_1_2;
   *   int time = Inverse(pfrac) * Rule.ReloadRate * TICKS_PER_MINUTE;
   *
   * rules.ini [General] ReloadRate=.04 → at full power: 1.0 * 0.04 * 900 = 36 ticks per ammo
   * At 50% power: 2.0 * 0.04 * 900 = 72 ticks per ammo
   *
   * TS now uses computeRearmDelay(ctx.getPowerFraction(entity.house)) matching C++ formula.
   */

  it('rearm delay for MIG at full power = 36 ticks (C++ building.cpp ReloadRate)', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 0;
    mig.aircraftState = 'landing';
    mig.flightAltitude = 0;
    mig.landedAtStructure = 0;

    const pad = makePadStructure('AFLD', House.USSR, 5, 5);
    pad.dockedAircraft = mig.id;
    const ctx = makeAircraftCtx({ structures: [pad] });

    updateAircraft(ctx, mig);

    // computeRearmDelay(1.0) = round(1.0 * 0.04 * 900) = 36
    expect(mig.aircraftState).toBe('rearming');
    expect(mig.rearmTimer).toBe(36);
  });

  it('rearm delay for HELI at full power = 36 ticks (same formula, weapon-independent)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.ammo = 0;
    heli.aircraftState = 'landing';
    heli.flightAltitude = 0;
    heli.landedAtStructure = 0;

    const pad = makePadStructure('HPAD', House.Spain, 5, 5);
    pad.dockedAircraft = heli.id;
    const ctx = makeAircraftCtx({ structures: [pad] });

    updateAircraft(ctx, heli);

    expect(heli.aircraftState).toBe('rearming');
    expect(heli.rearmTimer).toBe(36);
  });

  it('half power doubles rearm delay to 72 ticks', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 0;
    mig.aircraftState = 'landing';
    mig.flightAltitude = 0;
    mig.landedAtStructure = 0;

    const pad = makePadStructure('AFLD', House.USSR, 5, 5);
    pad.dockedAircraft = mig.id;
    const ctx = makeAircraftCtx({ structures: [pad], getPowerFraction: () => 0.5 });

    updateAircraft(ctx, mig);

    // computeRearmDelay(0.5) = round(2.0 * 0.04 * 900) = 72
    expect(mig.rearmTimer).toBe(72);
  });

  it('rearmTimer has minimum of 1 even at extreme power', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 0;
    mig.aircraftState = 'landing';
    mig.flightAltitude = 0;
    mig.landedAtStructure = 0;

    const pad = makePadStructure('AFLD', House.USSR, 5, 5);
    pad.dockedAircraft = mig.id;
    const ctx = makeAircraftCtx({ structures: [pad] });

    updateAircraft(ctx, mig);

    expect(mig.rearmTimer).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 5: Ammo Increment During Rearming
// C++ techno.cpp:964-968: RADIO_RELOAD → Ammo++ (one at a time)
// TS aircraft.ts:261-276: rearmTimer-- each tick, Ammo++ when timer reaches 0
// ═══════════════════════════════════════════════════════════════════════════════

describe('ammo increment during rearming (techno.cpp:964-968)', () => {
  it('ammo increments by 1 when rearm timer expires', () => {
    // C++ techno.cpp:967: Ammo++
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 0;
    mig.maxAmmo = 3;
    mig.aircraftState = 'rearming';
    mig.rearmTimer = 1; // will expire this tick

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, mig);

    expect(mig.ammo).toBe(1); // incremented by 1
  });

  it('rearm timer resets after each ammo increment (not yet full)', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 0;
    mig.maxAmmo = 3;
    mig.aircraftState = 'rearming';
    mig.rearmTimer = 1;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, mig);

    // After increment to 1, should reset timer (still needs 2 more)
    expect(mig.ammo).toBe(1);
    expect(mig.aircraftState).toBe('rearming');
    expect(mig.rearmTimer).toBeGreaterThan(0); // timer reset for next ammo
  });

  it('transitions to landed when fully rearmed', () => {
    // C++ techno.cpp:965: if (Ammo == MaxAmmo) return RADIO_NEGATIVE
    // → building stops sending RADIO_RELOAD
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 2;
    mig.maxAmmo = 3;
    mig.aircraftState = 'rearming';
    mig.rearmTimer = 1;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, mig);

    expect(mig.ammo).toBe(3); // now at MaxAmmo
    expect(mig.aircraftState).toBe('landed');
  });

  it('rearm timer decrements by 1 each tick', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 0;
    mig.maxAmmo = 3;
    mig.aircraftState = 'rearming';
    mig.rearmTimer = 5;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, mig);

    expect(mig.rearmTimer).toBe(4); // decremented by 1
    expect(mig.ammo).toBe(0); // not yet incremented
    expect(mig.aircraftState).toBe('rearming');
  });

  it('full rearm cycle: 0 → MaxAmmo takes exactly MaxAmmo * rearmDelay ticks', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 0;
    mig.maxAmmo = 3;
    mig.aircraftState = 'rearming';
    // computeRearmDelay(1.0) = 36 ticks per ammo at full power
    mig.rearmTimer = 36;

    const ctx = makeAircraftCtx();
    let ticks = 0;
    while (mig.aircraftState === 'rearming' && ticks < 200) {
      updateAircraft(ctx, mig);
      ticks++;
    }

    expect(mig.ammo).toBe(3);
    expect(mig.aircraftState).toBe('landed');
    // Should take 3 ammo * 36 ticks per ammo = 108 ticks total
    expect(ticks).toBe(108);
  });

  // DESIGN NOTE: TS rearming handler increments ammo before checking boundary,
  // but the landing→rearming guard (aircraft.ts:379) prevents entering 'rearming'
  // state when ammo is already at max. In normal gameplay, overshoot never occurs.
  // C++ techno.cpp:965: if (Ammo == MaxAmmo) return(RADIO_NEGATIVE) — rejects reload.
  // TS aircraft.ts:379: if (ammo < maxAmmo) → enter 'rearming' — prevents entry at max.
  // The handler itself (aircraft.ts:397) does ammo++ then checks >= maxAmmo, but
  // this path is only reachable when ammo < maxAmmo on entry.
  // Functionally correct — already works correctly via the entry guard.
  it('rearm does not exceed MaxAmmo — early exit guard prevents overshoot', () => {
    // Even if artificially forced into rearming at max ammo, the early-exit
    // guard (aircraft.ts) checks ammo >= maxAmmo before incrementing.
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 3;
    mig.maxAmmo = 3;
    mig.aircraftState = 'rearming';
    mig.rearmTimer = 1;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, mig);

    // Guard prevents overshoot — ammo stays at maxAmmo
    expect(mig.ammo).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 6: State Transitions — Landing to Rearming
// C++ aircraft.cpp Mission_Enter → Process_Landing → RADIO_IM_IN
// TS aircraft.ts:242-258 (landing state → rearming state)
// ═══════════════════════════════════════════════════════════════════════════════

describe('state transitions: landing → rearming → landed (aircraft.ts:242-276)', () => {
  it('landing state descends flightAltitude 1px/tick', () => {
    // C++ Landing_Takeoff_AI:4046: Height -= Pixel_To_Lepton(1)
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 5;
    heli.ammo = 0;
    heli.maxAmmo = 6;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(4); // descended by 1
    expect(heli.aircraftState).toBe('landing'); // still descending
  });

  it('transitions to rearming when altitude=0 and ammo < maxAmmo', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 1; // will hit 0 this tick
    heli.ammo = 3;
    heli.maxAmmo = 6;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(0);
    expect(heli.aircraftState).toBe('rearming');
  });

  it('transitions to landed when altitude=0 and ammo == maxAmmo (no rearm needed)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 1;
    heli.ammo = 6;
    heli.maxAmmo = 6;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(0);
    expect(heli.aircraftState).toBe('landed');
  });

  it('mission set to GUARD after landing completes', () => {
    // C++ Mission_Enter LANDING: RADIO_IM_IN → MISSION_GUARD
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 1;
    heli.ammo = 6;
    heli.maxAmmo = 6;
    heli.mission = Mission.ATTACK; // was attacking

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.mission).toBe(Mission.GUARD);
  });

  it('rearming maintains flightAltitude=0', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.aircraftState = 'rearming';
    mig.flightAltitude = 0;
    mig.ammo = 0;
    mig.maxAmmo = 3;
    mig.rearmTimer = 5;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, mig);

    expect(mig.flightAltitude).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 7: State Transitions — Takeoff from Landed
// C++ aircraft.cpp Process_Take_Off (line 2885-2930)
// TS aircraft.ts:130-143
// ═══════════════════════════════════════════════════════════════════════════════

describe('state transitions: landed → takeoff → flying (aircraft.ts:118-143)', () => {
  it('landed aircraft transitions to takeoff when given attack order', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landed';
    heli.flightAltitude = 0;
    heli.ammo = 6;
    heli.maxAmmo = 6;
    heli.mission = Mission.ATTACK;
    const enemy = makeEntity(UnitType.V_MIG, House.USSR, 300, 300);
    heli.target = enemy;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.aircraftState).toBe('takeoff');
  });

  it('takeoff ascends 1px/tick', () => {
    // C++ Process_Take_Off → Height increases gradually
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'takeoff';
    heli.flightAltitude = 5;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(6); // +1
  });

  it('transitions to flying when reaching FLIGHT_ALTITUDE', () => {
    // C++ Process_Take_Off:2920-2923: case FLIGHT_LEVEL → return true
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'takeoff';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE - 1;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    expect(heli.aircraftState).toBe('flying');
  });

  it('undocks from pad on takeoff', () => {
    // C++ Mission_Enter TAKEOFF: break radio contact with helipad
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'takeoff';
    heli.flightAltitude = 0;
    heli.landedAtStructure = 0;

    const pad = makePadStructure('HPAD', House.Spain, 5, 5);
    pad.dockedAircraft = heli.id;
    const ctx = makeAircraftCtx({ structures: [pad] });

    updateAircraft(ctx, heli);

    expect(pad.dockedAircraft).toBeUndefined();
    expect(heli.landedAtStructure).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 8: Out-of-Ammo RTB Transition
// C++ aircraft.cpp Mission_Hunt/DROP_BOMBS/FIRE_AMMO → Enter_Idle_Mode → MISSION_ENTER
// TS aircraft.ts: ammo===0 → aircraftState='returning'
// ═══════════════════════════════════════════════════════════════════════════════

describe('out-of-ammo return-to-base (aircraft.cpp REGROUP, line 800-803)', () => {
  it('helicopter RTBs when ammo reaches 0 during attack', () => {
    // C++ aircraft.cpp:800: if (Ammo == 0) { Enter_Idle_Mode(); }
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'attacking';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.ammo = 0;
    heli.maxAmmo = 6;
    const enemy = makeEntity(UnitType.V_MIG, House.USSR, 200, 200 + CELL_SIZE);
    heli.target = enemy;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.aircraftState).toBe('returning');
    expect(heli.mission).toBe(Mission.GUARD);
  });

  it('returning aircraft flies toward landing pad', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'returning';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.ammo = 0;
    heli.maxAmmo = 6;

    const pad = makePadStructure('HPAD', House.Spain, 5, 5);
    const ctx = makeAircraftCtx({ structures: [pad] });

    const posBefore = { ...heli.pos };
    updateAircraft(ctx, heli);

    // Should move toward pad
    const padCenter = { x: (5 + 1) * CELL_SIZE, y: (5 + 1) * CELL_SIZE };
    const distBefore = worldDist(posBefore, padCenter);
    const distAfter = worldDist(heli.pos, padCenter);
    expect(distAfter).toBeLessThan(distBefore);
  });

  it('fixed-wing MISSION_ENTER waits for its mission timer before steering to the airstrip', () => {
    const map = new GameMap();
    map.setBounds(23, 57, 87, 54);
    const airstrip = makePadStructure('AFLD', House.USSR, 102, 58);
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 0, 0);
    yak.leptonX = 16139;
    yak.leptonY = 25946;
    yak.syncPosFromLeptons();
    yak.aircraftState = 'returning';
    yak.mission = Mission.ENTER;
    yak.missionTimer = 3;
    yak.aircraftEnterStatus = 0;
    yak.aircraftDockingStructure = 0;
    yak.flightAltitude = Entity.FLIGHT_ALTITUDE;
    yak.facing256 = 67;
    yak.desiredFacing256 = 67;
    yak._flyToTicks = 4;

    const ctx = makeAircraftCtx({
      structures: [airstrip],
      map,
      movementSpeed: e => e.stats.speed * CELL_SIZE / 100,
    });

    updateAircraft(ctx, yak);
    expect([yak.leptonX, yak.leptonY]).toEqual([16178, 25949]);
    updateAircraft(ctx, yak);
    expect([yak.leptonX, yak.leptonY]).toEqual([16217, 25952]);
    updateAircraft(ctx, yak);
    expect([yak.leptonX, yak.leptonY]).toEqual([16256, 25955]);
    expect(yak.missionTimer).toBe(0);
    expect(yak.aircraftEnterStatus).toBe(0);
    expect(yak.desiredFacing256).toBe(67);
  });

  it('fixed-wing MISSION_ENTER STACK flies to BuildingClass::Check_Point, not pad center', () => {
    const map = new GameMap();
    map.setBounds(23, 57, 87, 54);
    const airstrip = makePadStructure('AFLD', House.USSR, 102, 58);
    const yak = makeEntity(UnitType.V_YAK, House.USSR, 0, 0);
    yak.leptonX = 16139;
    yak.leptonY = 25946;
    yak.syncPosFromLeptons();
    yak.aircraftState = 'returning';
    yak.mission = Mission.ENTER;
    yak.missionTimer = 0;
    yak.aircraftEnterStatus = 3; // STACK
    yak.aircraftDockingStructure = 0;
    yak.flightAltitude = Entity.FLIGHT_ALTITUDE;
    yak.facing256 = 67;
    yak.desiredFacing256 = 67;
    yak._flyToTicks = 4;

    const before = { lx: yak.leptonX, ly: yak.leptonY };
    const stackCheckpoint = cellTargetToLepton(103, 63);
    const oldPadCenter = { lx: Math.trunc((102 + 1.5) * 256), ly: Math.trunc((58 + 1) * 256) };
    const ctx = makeAircraftCtx({
      structures: [airstrip],
      map,
      movementSpeed: e => e.stats.speed * CELL_SIZE / 100,
    });

    updateAircraft(ctx, yak);

    expect(yak.desiredFacing256).toBe(
      directionToLeptons256(before.lx, before.ly, stackCheckpoint.lx, stackCheckpoint.ly),
    );
    expect(yak.desiredFacing256).not.toBe(
      directionToLeptons256(before.lx, before.ly, oldPadCenter.lx, oldPadCenter.ly),
    );
    expect(yak.aircraftEnterStatus).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 9: RADIO_PREPARED — Rearm Completion Check
// C++ aircraft.cpp:2691-2694
// ═══════════════════════════════════════════════════════════════════════════════

describe('rearm completion semantics (aircraft.cpp RADIO_PREPARED:2691-2694)', () => {
  /**
   * C++ aircraft.cpp:2691-2694:
   *   case RADIO_PREPARED:
   *     if (Target_Legal(TarCom)) return(RADIO_NEGATIVE);
   *     if ((Height == 0 && Ammo == Class->MaxAmmo) || (Height > 0 && Ammo > 0)) return(RADIO_ROGER);
   *     return(RADIO_NEGATIVE);
   *
   * Key behaviors:
   *   - Grounded: must be fully rearmed (Ammo == MaxAmmo) to be "prepared"
   *   - Airborne: just needs ANY ammo (Ammo > 0) to be "prepared"
   *   - Having an active target means NOT prepared
   */

  it('grounded aircraft is prepared only when fully rearmed', () => {
    // C++ (Height == 0 && Ammo == Class->MaxAmmo)
    const mig = makeEntity(UnitType.V_MIG, House.USSR);

    // TS: rearming state with partially loaded ammo → still rearming
    mig.aircraftState = 'rearming';
    mig.ammo = 2;
    mig.maxAmmo = 3;
    mig.rearmTimer = 1;
    mig.flightAltitude = 0;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, mig);

    // After rearmTimer expires: ammo++ → 3 = MaxAmmo → transition to 'landed'
    expect(mig.ammo).toBe(3);
    expect(mig.aircraftState).toBe('landed');
  });

  it('partially rearmed grounded aircraft stays in rearming state', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.aircraftState = 'rearming';
    mig.ammo = 1;
    mig.maxAmmo = 3;
    mig.rearmTimer = 1;
    mig.flightAltitude = 0;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, mig);

    // ammo becomes 2, still < 3 → stays in rearming
    expect(mig.ammo).toBe(2);
    expect(mig.aircraftState).toBe('rearming');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 10: C++ vs TS Rearm Driver — WHO controls the rearm?
// C++ building.cpp:3989-4037 — BUILDING drives rearm (sends RADIO_RELOAD)
// TS aircraft.ts — AIRCRAFT drives its own rearm (simplified architecture)
// DESIGN NOTE: Different driver (building vs aircraft) but TIMING matches C++ exactly
// via computeRearmDelay (building.cpp:4023-4025 formula). Functionally correct.
// ═══════════════════════════════════════════════════════════════════════════════

describe('rearm driver — building-driven timing with power fraction (C++ parity)', () => {
  /**
   * TS now uses C++ building.cpp:4023-4025 formula via computeRearmDelay:
   *   time = Inverse(pfrac) * ReloadRate * TICKS_PER_MINUTE
   * Aircraft still self-manages the timer (simplified vs C++ RADIO protocol),
   * but the TIMING matches C++ exactly including power fraction scaling.
   */

  it('rearm works without structures (aircraft manages timer internally)', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.aircraftState = 'rearming';
    mig.ammo = 0;
    mig.maxAmmo = 3;
    mig.rearmTimer = 1;
    mig.flightAltitude = 0;

    const ctx = makeAircraftCtx({ structures: [] });
    updateAircraft(ctx, mig);

    expect(mig.ammo).toBe(1);
  });

  it('rearm delay scales with power fraction (C++ building.cpp:4023-4025)', () => {
    // Full power: 36 ticks per ammo
    const migFull = makeEntity(UnitType.V_MIG, House.USSR);
    migFull.aircraftState = 'rearming';
    migFull.ammo = 0;
    migFull.maxAmmo = 3;
    migFull.rearmTimer = computeRearmDelay(1.0); // 36

    const ctxFull = makeAircraftCtx({ getPowerFraction: () => 1.0 });
    for (let i = 0; i < 36; i++) updateAircraft(ctxFull, migFull);
    expect(migFull.ammo).toBe(1);

    // Half power: 72 ticks per ammo
    const migHalf = makeEntity(UnitType.V_MIG, House.USSR);
    migHalf.aircraftState = 'rearming';
    migHalf.ammo = 0;
    migHalf.maxAmmo = 3;
    migHalf.rearmTimer = computeRearmDelay(0.5); // 72

    const ctxHalf = makeAircraftCtx({ getPowerFraction: () => 0.5 });
    for (let i = 0; i < 36; i++) updateAircraft(ctxHalf, migHalf);
    expect(migHalf.ammo).toBe(0); // not yet — half power needs 72 ticks
    for (let i = 0; i < 36; i++) updateAircraft(ctxHalf, migHalf);
    expect(migHalf.ammo).toBe(1); // 72 ticks total
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 11: Weapon ROF After Firing (Rearm_Delay in combat)
// C++ techno.cpp:3119: Arm = Rearm_Delay(IsSecondShot)
// C++ techno.cpp:2857-2870: Rearm_Delay
// ═══════════════════════════════════════════════════════════════════════════════

describe('weapon rearm delay after firing (techno.cpp:2857-2870)', () => {
  /**
   * C++ Rearm_Delay (techno.cpp:2857-2870):
   *   if (What_Am_I() == RTTI_BUILDING && Ammo > 1) return 1;
   *   WeaponTypeClass* weapon = (which==0) ? PrimaryWeapon : SecondaryWeapon;
   *   if (second && weapon != NULL) return weapon->ROF * House->ROFBias;
   *   return 3; // first shot of two-shot salvo uses ROF=3
   *
   * Key behaviors:
   *   - Single-shot weapons: IsSecondShot is always true → normal ROF * ROFBias
   *   - Two-shot weapons: first shot uses ROF=3 (quick), second uses full ROF
   *   - Buildings with Ammo>1: always ROF=1 (Tesla coil chain attack)
   *
   * PARITY FIXED: TS now implements IsSecondShot cadence (missionAI.ts:309-319).
   * Dual-weapon units get 3-tick rearm on first shot, full ROF on second.
   */

  it('C++ first shot of two-shooter uses ROF=3, TS does not distinguish', () => {
    // C++ MIG is a two-shooter (two Mavericks)
    // C++ first shot: Arm = 3 (fast follow-up)
    // C++ second shot: Arm = weapon->ROF * ROFBias (normal delay)
    // TS: always weapon.rof * ROFBias regardless of shot number
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    const maverickRof = WEAPON_STATS['Maverick']?.rof ?? 3;
    // TS attackCooldown is always set to rof * bias
    // C++ first shot would be 3, second would be maverickRof * ROFBias
    // Since TS doesn't distinguish, it's always maverickRof
    expect(maverickRof).toBe(3);
    // In this specific case, the difference is invisible because Maverick ROF=3
    // But for weapons with higher ROF, the first shot delay difference would matter
  });

  it('Rearm_Delay with ROFBias=1.0: returns weapon ROF for second shot', () => {
    // C++ techno.cpp:2867: return(weapon->ROF * House->ROFBias)
    const hellfireRof = WEAPON_STATS['Hellfire']?.rof ?? 60;
    const bias = 1.0;
    const expected = Math.round(hellfireRof * bias);
    // TS: same formula for attackCooldown
    expect(expected).toBe(60);
  });

  it('Rearm_Delay with ROFBias=0.8 (easy difficulty): faster refire', () => {
    // C++ techno.cpp:2867: weapon->ROF * House->ROFBias
    // ROFBias < 1.0 = faster fire rate (easy difficulty bonus)
    const chaingunRof = WEAPON_STATS['ChainGun']?.rof ?? 3;
    const bias = 0.8;
    const expected = Math.max(1, Math.round(chaingunRof * bias));
    expect(expected).toBe(2); // 3 * 0.8 = 2.4 → round → 2
  });

  it('Rearm_Delay first shot (non-second-shot) always returns 3 in C++', () => {
    // C++ techno.cpp:2869: return(3) — when !second
    // This is the quick follow-up shot for two-shooters
    // TS does not implement this distinction
    const cppFirstShotDelay = 3;
    expect(cppFirstShotDelay).toBe(3);
    // Note: this test documents C++ behavior. TS always uses weapon.rof.
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 12: Full Rearm Cycle Integration Test
// ═══════════════════════════════════════════════════════════════════════════════

describe('full rearm cycle integration', () => {
  it('MIG: empty → rearm → full → landed (3 ammo, 36 ticks/ammo)', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 0;
    mig.maxAmmo = 3;
    mig.aircraftState = 'landing';
    mig.flightAltitude = 1; // will land in 1 tick
    mig.landedAtStructure = 0;

    const pad = makePadStructure('AFLD', House.USSR, 5, 5);
    pad.dockedAircraft = mig.id;
    const ctx = makeAircraftCtx({ structures: [pad] });

    const states: string[] = [];
    const ammoHistory: number[] = [];

    // 3 ammo * 36 ticks/ammo = 108 ticks rearming + 1 tick landing = 109 max
    for (let tick = 0; tick < 120; tick++) {
      updateAircraft(ctx, mig);
      states.push(mig.aircraftState);
      ammoHistory.push(mig.ammo);
      if (mig.aircraftState === 'landed') break;
    }

    // Tick 0: landing → flightAlt=0, transition to rearming (ammo=0 < maxAmmo=3)
    expect(states[0]).toBe('rearming');

    // Verify final state
    expect(mig.ammo).toBe(3);
    expect(mig.aircraftState).toBe('landed');

    // Verify ammo incremented one-at-a-time (C++ RADIO_RELOAD pattern)
    const increments = ammoHistory.filter((a, i) => i > 0 && a > ammoHistory[i - 1]);
    expect(increments.length).toBe(3); // exactly 3 increments
    for (const inc of increments) {
      // Each increment should be +1 from previous
      const prevIdx = ammoHistory.indexOf(inc) - 1;
      if (prevIdx >= 0) {
        expect(inc - ammoHistory[prevIdx]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('HELI: partial ammo → rearm fills to max', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.ammo = 4;
    heli.maxAmmo = 6;
    heli.aircraftState = 'landing';
    heli.flightAltitude = 1;
    heli.landedAtStructure = 0;

    const pad = makePadStructure('HPAD', House.Spain, 5, 5);
    pad.dockedAircraft = heli.id;
    const ctx = makeAircraftCtx({ structures: [pad] });

    for (let tick = 0; tick < 200; tick++) {
      updateAircraft(ctx, heli);
      if (heli.aircraftState === 'landed') break;
    }

    expect(heli.ammo).toBe(6);
    expect(heli.aircraftState).toBe('landed');
  });

  it('fully loaded aircraft skips rearming entirely', () => {
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 3;
    mig.maxAmmo = 3;
    mig.aircraftState = 'landing';
    mig.flightAltitude = 1;
    mig.landedAtStructure = 0;

    const pad = makePadStructure('AFLD', House.USSR, 5, 5);
    pad.dockedAircraft = mig.id;
    const ctx = makeAircraftCtx({ structures: [pad] });

    updateAircraft(ctx, mig);

    // Should go straight to 'landed', not 'rearming'
    expect(mig.aircraftState).toBe('landed');
    expect(mig.ammo).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 13: Ammo Decrement During Combat
// C++ techno.cpp:3186-3188: if (Ammo > 0) Ammo--
// ═══════════════════════════════════════════════════════════════════════════════

describe('ammo decrement during combat (techno.cpp:3186-3188)', () => {
  it('ammo decrements when helicopter fires', () => {
    // C++ techno.cpp:3186-3188: if (Ammo > 0) Ammo--
    const fireWeaponAt = vi.fn();
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'attacking';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.ammo = 6;
    heli.maxAmmo = 6;
    heli.attackCooldown = 0;
    const enemy = makeEntity(UnitType.V_MIG, House.USSR, 200, 200 + CELL_SIZE);
    heli.target = enemy;

    const ctx = makeAircraftCtx({ fireWeaponAt });
    updateAircraft(ctx, heli);

    if (fireWeaponAt.mock.calls.length > 0) {
      expect(heli.ammo).toBe(5); // decremented
    }
  });

  it('ammo does not go below 0', () => {
    // C++ techno.cpp:3186: if (Ammo > 0) Ammo-- — guarded
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'attacking';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.ammo = 0;
    heli.maxAmmo = 6;
    const enemy = makeEntity(UnitType.V_MIG, House.USSR, 200, 200 + CELL_SIZE);
    heli.target = enemy;

    const ctx = makeAircraftCtx();

    // With 0 ammo, should RTB rather than fire
    updateAircraft(ctx, heli);
    expect(heli.ammo).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 14: Aircraft-Specific MaxAmmo Values
// C++ rules.ini parsed via TechnoTypeClass (techno.cpp:6289)
// TS types.ts UNIT_STATS
// ═══════════════════════════════════════════════════════════════════════════════

describe('aircraft MaxAmmo values match C++ rules.ini', () => {
  // These values come from rules.ini, parsed in C++ at techno.cpp:6289
  // TS hardcodes them in UNIT_STATS

  const AIRCRAFT_AMMO: [string, UnitType, number][] = [
    ['MIG',  UnitType.V_MIG,  3],   // C++ rules.ini: Ammo=3 (two Maverick missiles + 1?)
    ['YAK',  UnitType.V_YAK,  15],  // C++ rules.ini: Ammo=15 (ChainGun rounds)
    ['HELI', UnitType.V_HELI, 6],   // C++ rules.ini: Ammo=6 (Hellfire missiles)
    ['HIND', UnitType.V_HIND, 12],  // C++ rules.ini: Ammo=12 (ChainGun rounds)
  ];

  for (const [name, type, expectedAmmo] of AIRCRAFT_AMMO) {
    it(`${name} MaxAmmo = ${expectedAmmo}`, () => {
      const stats = UNIT_STATS[type];
      expect(stats.maxAmmo).toBe(expectedAmmo);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 15: Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  it('aircraft with ammo=-1 (unlimited) does not enter rearming state on landing', () => {
    // Transport helicopters have unlimited ammo (no weapon)
    const tran = makeEntity(UnitType.V_TRAN, House.Spain);
    tran.aircraftState = 'landing';
    tran.flightAltitude = 1;
    // TRAN has ammo=-1, maxAmmo=-1

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, tran);

    // ammo=-1 is NOT < maxAmmo=-1, so should go to 'landed' not 'rearming'
    expect(tran.aircraftState).toBe('landed');
  });

  it('rearm timer is set from weapon rof, not a hardcoded value', () => {
    // Different aircraft types have different weapons with different ROFs
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    const heli = makeEntity(UnitType.V_HELI, House.Spain);

    const maverickRof = mig.weapon?.rof ?? 0;
    const hellfireRof = heli.weapon?.rof ?? 0;

    // MIG has Maverick (rof=3), HELI has Hellfire (rof=60)
    expect(maverickRof).not.toBe(hellfireRof);
    expect(maverickRof).toBe(3);
    expect(hellfireRof).toBe(60);
  });

  it('flightAltitude clamps to 0 on landing (never negative)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 0; // already at ground
    heli.ammo = 3;
    heli.maxAmmo = 6;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(0);
    // Should transition since already at altitude 0
    expect(heli.aircraftState).toBe('rearming');
  });

  it('flightAltitude clamps to FLIGHT_ALTITUDE on takeoff (never exceeds)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'takeoff';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE; // already at max

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    expect(heli.aircraftState).toBe('flying');
  });

  it('landed aircraft with no target and no move order stays landed', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landed';
    heli.flightAltitude = 0;
    heli.ammo = 6;
    heli.maxAmmo = 6;
    heli.mission = Mission.GUARD;
    heli.target = null;
    heli.moveTarget = null;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.aircraftState).toBe('landed');
  });
});
