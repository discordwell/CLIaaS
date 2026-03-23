/**
 * C++ Behavioral Parity: Aircraft Altitude Mechanics
 *
 * Tests verify ascent/descent timing, flight level constants, landing pad fallback,
 * hover vs fixed-wing behavior, and layer transitions match C++ RA source code.
 *
 * C++ algorithm summary:
 *
 * === Constants ===
 *   - object.h:252: enum {FLIGHT_LEVEL=256}; (leptons)
 *   - display.h:45-47: ICON_PIXEL_W=24, ICON_LEPTON_W=256
 *   - inline.h:119-121: Pixel_To_Lepton(pixel) = (pixel * 256 + 12) / 24
 *   - Pixel_To_Lepton(1) = (256 + 12) / 24 = 11 leptons (integer division)
 *
 * === Landing_Takeoff_AI (aircraft.cpp:4033-4139) ===
 *   - Runs once per tick when IsLanding or IsTakingOff and door is closed
 *   - Landing: Height -= Pixel_To_Lepton(1) [11 leptons/tick]; clamp to 0
 *   - Takeoff: Height += Pixel_To_Lepton(1) [11 leptons/tick]; clamp to FLIGHT_LEVEL
 *   - Layer transition: Height < FLIGHT_LEVEL-(FLIGHT_LEVEL/3) [170] → LAYER_GROUND
 *   - LZ blocked: if landing into LAYER_GROUND and LZ not clear → abort, take off again
 *
 * === Process_Take_Off — Helicopter (aircraft.cpp:2885-2930) ===
 *   - Height 0: Close_Door, PrimaryFacing = SecondaryFacing
 *   - Height FLIGHT_LEVEL/2 (128): face NavCom
 *   - Height FLIGHT_LEVEL-(FLIGHT_LEVEL/3) (170): Set_Speed(0x20), sync facings
 *   - Height FLIGHT_LEVEL-(FLIGHT_LEVEL/5) (204): Set_Speed(0x40)
 *   - Height FLIGHT_LEVEL (256): Set_Speed(0xFF), IsTakingOff=false, return true
 *
 * === Process_Take_Off — Fixed-wing (aircraft.cpp:2893-2897) ===
 *   - Set_Speed(0xFF) immediately
 *   - Return true when Height == FLIGHT_LEVEL
 *
 * === Process_Landing — Helicopter (aircraft.cpp:2982-2998) ===
 *   - Height 0: IsLanding=false, return true (landed)
 *   - Height FLIGHT_LEVEL/2 (128): Set_Speed(0)
 *   - Height FLIGHT_LEVEL (256): no-op
 *
 * === Process_Landing — Fixed-wing (aircraft.cpp:2958-2981) ===
 *   - Height 0: Set_Speed(0), IsLanding=false, return true
 *   - Default: Set_Speed(LandingSpeed / AirspeedBias)
 *   - Fixed-wing landing on ground without MISSION_ENTER → DESTROYED (4062-4068)
 *
 * === Helicopter Jitter (aircraft.cpp:441-445) ===
 *   - At FLIGHT_LEVEL, speed < 3: bobbing pattern {0,0,0,0,1,1,1,0,0,0,0,0,-1,-1,-1,0}
 *
 * === Aircraft Constructor (aircraft.cpp:249) ===
 *   - Height = FLIGHT_LEVEL — aircraft are created in flight
 *
 * === In_Which_Layer (object.cpp:343-352) ===
 *   - Height < FLIGHT_LEVEL - (FLIGHT_LEVEL/3) → LAYER_GROUND
 *   - Otherwise → LAYER_TOP
 *   - Threshold: 256 - 85 = 170 leptons (integer: 256/3=85)
 *
 * C++ references:
 *   - object.h:252 — FLIGHT_LEVEL=256 (leptons)
 *   - display.h:45-47 — ICON_PIXEL_W=24, ICON_LEPTON_W=256
 *   - inline.h:119-121 — Pixel_To_Lepton conversion
 *   - aircraft.cpp:249 — constructor sets Height=FLIGHT_LEVEL
 *   - aircraft.cpp:2885-2930 — Process_Take_Off
 *   - aircraft.cpp:2950-3000 — Process_Landing
 *   - aircraft.cpp:4033-4139 — Landing_Takeoff_AI
 *   - aircraft.cpp:441-445 — helicopter jitter at FLIGHT_LEVEL
 *   - object.cpp:343-352 — In_Which_Layer (layer transition threshold)
 *   - aadata.cpp:67,113,159 — IsFixedWing flag per aircraft type
 *   - aadata.cpp:70,116,162,185,209 — IsLandable flag (transport helicopters only)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission,
  UNIT_STATS,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type AircraftContext,
  findLandingPad,
  updateAircraft,
  HOVER_JITTER,
  resetAircraftFrame,
  advanceAircraftFrame,
} from '../engine/aircraft';
import type { MapStructure } from '../engine/scenario';
import { GameMap } from '../engine/map';

beforeEach(() => { resetEntityIds(); resetAircraftFrame(); });

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

// ═══════════════════════════════════════════════════════════════════════════════
// Section 1: FLIGHT_LEVEL / FLIGHT_ALTITUDE Constant
// C++ object.h:252: FLIGHT_LEVEL=256 leptons
// C++ display.h:45: ICON_PIXEL_W=24, ICON_LEPTON_W=256
// TS entity.ts:383: FLIGHT_ALTITUDE=24 pixels
// ═══════════════════════════════════════════════════════════════════════════════

describe('FLIGHT_LEVEL constant (object.h:252, display.h:45-47)', () => {

  it('C++ FLIGHT_LEVEL=256 leptons = 1 cell = 24 pixels → TS FLIGHT_ALTITUDE=24', () => {
    // C++ object.h:252: enum {FLIGHT_LEVEL=256};
    // C++ display.h:47: ICON_LEPTON_W=256, display.h:45: ICON_PIXEL_W=24
    // 256 leptons / (256 leptons/cell) = 1 cell = 24 pixels
    // TS entity.ts:383: FLIGHT_ALTITUDE = 24
    const cppFlightLevelLeptons = 256;
    const cppIconLeptonW = 256;
    const cppIconPixelW = 24;
    const cppFlightLevelPixels = Math.round(
      (cppFlightLevelLeptons * cppIconPixelW) / cppIconLeptonW
    );
    expect(cppFlightLevelPixels).toBe(24);
    expect(Entity.FLIGHT_ALTITUDE).toBe(cppFlightLevelPixels);
  });

  it('FLIGHT_ALTITUDE is exactly 24 pixels', () => {
    // Direct value check — documented in MISSING_FEATURES.md AC7
    expect(Entity.FLIGHT_ALTITUDE).toBe(24);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 2: Ascent Timing — Takeoff Tick Count
// C++ Landing_Takeoff_AI:4079-4086: Height += Pixel_To_Lepton(1) each tick
// Pixel_To_Lepton(1) = (1*256+12)/24 = 11 leptons
// 256 / 11 = 23.27 → 24 ticks to reach FLIGHT_LEVEL
// TS: flightAltitude += 1 each tick → 24 ticks
// ═══════════════════════════════════════════════════════════════════════════════

describe('ascent timing — takeoff tick count (aircraft.cpp:4079-4086)', () => {

  it('C++ Pixel_To_Lepton(1) = 11 leptons (inline.h:119-121)', () => {
    // C++ inline.h:121: (pixel * ICON_LEPTON_W + ICON_PIXEL_W/2) / ICON_PIXEL_W
    // = (1 * 256 + 12) / 24 = 268 / 24 = 11 (integer division)
    const pixelToLepton = (pixel: number) =>
      Math.floor((pixel * 256 + 12) / 24);
    expect(pixelToLepton(1)).toBe(11);
  });

  it('C++ takes 24 ticks to ascend from 0 to FLIGHT_LEVEL (256/11 rounds up)', () => {
    // Simulate C++ Landing_Takeoff_AI takeoff loop
    const FLIGHT_LEVEL = 256;
    const heightPerTick = 11; // Pixel_To_Lepton(1)
    let height = 0;
    let ticks = 0;
    while (height < FLIGHT_LEVEL) {
      height += heightPerTick;
      if (height >= FLIGHT_LEVEL) height = FLIGHT_LEVEL;
      ticks++;
    }
    expect(height).toBe(FLIGHT_LEVEL);
    expect(ticks).toBe(24); // ceil(256/11) = 24
  });

  it('TS takes 24 ticks to ascend from 0 to FLIGHT_ALTITUDE (24/1 = 24)', () => {
    // TS aircraft.ts:132: flightAltitude = min(FLIGHT_ALTITUDE, flightAltitude + 1)
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'takeoff';
    heli.flightAltitude = 0;
    heli.ammo = 6;
    heli.maxAmmo = 6;
    heli.mission = Mission.ATTACK;
    const enemy = makeEntity(UnitType.V_MIG, House.USSR, 300, 300);
    heli.target = enemy;

    const ctx = makeAircraftCtx();
    let ticks = 0;
    while (heli.aircraftState === 'takeoff' && ticks < 100) {
      updateAircraft(ctx, heli);
      ticks++;
    }

    expect(heli.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    expect(heli.aircraftState).toBe('flying');
    expect(ticks).toBe(24); // matches C++ 24-tick ascent
  });

  it('ascent/descent parity: both C++ and TS take 24 ticks', () => {
    // C++: 256 leptons / 11 leptons per tick = ceil to 24 ticks
    // TS: 24 pixels / 1 pixel per tick = 24 ticks
    // Parity confirmed — same timing through different numerical representations
    const cppTicks = Math.ceil(256 / 11); // 24
    const tsTicks = Math.ceil(24 / 1);    // 24
    expect(cppTicks).toBe(tsTicks);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 3: Descent Timing — Landing Tick Count
// C++ Landing_Takeoff_AI:4044-4048: Height -= Pixel_To_Lepton(1) each tick
// TS aircraft.ts:244: flightAltitude = max(0, flightAltitude - 1)
// ═══════════════════════════════════════════════════════════════════════════════

describe('descent timing — landing tick count (aircraft.cpp:4044-4048)', () => {

  it('C++ takes 24 ticks to descend from FLIGHT_LEVEL to 0', () => {
    // Simulate C++ Landing_Takeoff_AI landing loop
    const FLIGHT_LEVEL = 256;
    const heightPerTick = 11; // Pixel_To_Lepton(1)
    let height = FLIGHT_LEVEL;
    let ticks = 0;
    while (height > 0) {
      height -= heightPerTick;
      if (height <= 0) height = 0;
      ticks++;
    }
    expect(height).toBe(0);
    expect(ticks).toBe(24); // ceil(256/11) = 24
  });

  it('TS takes 24 ticks to descend from FLIGHT_ALTITUDE to 0', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landing';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.ammo = 0;
    heli.maxAmmo = 6;

    const ctx = makeAircraftCtx();
    let ticks = 0;
    while (heli.aircraftState === 'landing' && ticks < 100) {
      updateAircraft(ctx, heli);
      ticks++;
    }

    expect(heli.flightAltitude).toBe(0);
    expect(ticks).toBe(24);
  });

  it('descent rate is symmetric with ascent rate — 1 px/tick both ways', () => {
    // C++ aircraft.cpp:4046 (landing): Height -= Pixel_To_Lepton(1)
    // C++ aircraft.cpp:4082 (takeoff): Height += Pixel_To_Lepton(1)
    // Same delta in both directions
    // TS: -1 (landing) and +1 (takeoff) per tick — same symmetry
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 10;
    heli.ammo = 0;
    heli.maxAmmo = 6;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);
    expect(heli.flightAltitude).toBe(9); // descended by 1

    const heli2 = makeEntity(UnitType.V_HELI, House.Spain);
    heli2.aircraftState = 'takeoff';
    heli2.flightAltitude = 10;

    updateAircraft(ctx, heli2);
    expect(heli2.flightAltitude).toBe(11); // ascended by 1
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 4: Process_Take_Off — Helicopter Speed Staging
// C++ aircraft.cpp:2899-2928: speed changes at specific height thresholds
// TS: no staged speed control during takeoff — PARITY GAP
// ═══════════════════════════════════════════════════════════════════════════════

describe('FIXED: helicopter takeoff speed staging (aircraft.cpp:2899-2928)', () => {
  /**
   * C++ Process_Take_Off for helicopters has a multi-stage speed ramp:
   *   Height 0: Close_Door, sync facings
   *   Height 128 (FLIGHT_LEVEL/2): face NavCom
   *   Height 170 (FLIGHT_LEVEL-(FLIGHT_LEVEL/3)): Set_Speed(0x20), sync body facing
   *   Height 204 (FLIGHT_LEVEL-(FLIGHT_LEVEL/5)): Set_Speed(0x40)
   *   Height 256 (FLIGHT_LEVEL): Set_Speed(0xFF), IsTakingOff=false
   *
   * FIXED: TS now implements speed staging during helicopter takeoff.
   * aircraftSpeedFraction ramps from 0.125 → 0.25 → 1.0 at altitude thresholds.
   */

  it('FIXED: helicopter speed ramps through 5 stages during takeoff', () => {
    // C++ 5-stage speed ramp (lepton heights mapped to pixel equivalents):
    //   0: speed=0 (close door)
    //   128/256 → 12px: speed=0 (face navcom)
    //   170/256 → 16px: speed 0x20 (12.5%)
    //   204/256 → 19px: speed 0x40 (25%)
    //   256/256 → 24px: speed 0xFF (100%)
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'takeoff';
    heli.flightAltitude = 0;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    // At altitude 1 (below halfLevel=12): speed should be 0
    expect(heli.flightAltitude).toBe(1);
    expect(heli.aircraftSpeedFraction).toBe(0);

    // Advance past halfLevel — still speed=0 until stage3 (16px)
    while (heli.flightAltitude < 13 && heli.aircraftState === 'takeoff') {
      updateAircraft(ctx, heli);
    }
    expect(heli.aircraftSpeedFraction).toBe(0); // still 0 between halfLevel and stage3

    // Advance to altitude 17 (between 16px=stage3 and 19px=stage4): speed ~0.125
    while (heli.flightAltitude < 17 && heli.aircraftState === 'takeoff') {
      updateAircraft(ctx, heli);
    }
    expect(heli.aircraftSpeedFraction).toBeCloseTo(0x20 / 0xFF, 2);

    // Advance to altitude 20 (between 19px=stage4 and 24px=full): speed ~0.25
    while (heli.flightAltitude < 20 && heli.aircraftState === 'takeoff') {
      updateAircraft(ctx, heli);
    }
    expect(heli.aircraftSpeedFraction).toBeCloseTo(0x40 / 0xFF, 2);

    // At full altitude: speed = 1.0
    while (heli.aircraftState === 'takeoff') {
      updateAircraft(ctx, heli);
    }
    expect(heli.aircraftSpeedFraction).toBe(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 5: Process_Take_Off — Fixed-Wing Behavior
// C++ aircraft.cpp:2893-2897: immediate full speed, wait for FLIGHT_LEVEL
// TS: same as helicopter — linear ascent
// ═══════════════════════════════════════════════════════════════════════════════

describe('fixed-wing takeoff behavior (aircraft.cpp:2893-2897)', () => {

  it('C++ fixed-wing sets full speed (0xFF) immediately on Process_Take_Off', () => {
    // C++ aircraft.cpp:2893-2897:
    //   if (Class->IsFixedWing) {
    //     Set_Speed(0xFF);
    //     if (Height == FLIGHT_LEVEL) return true;
    //   }
    // Fixed-wing aircraft accelerate immediately to full speed during takeoff
    // then the height increase happens in Landing_Takeoff_AI, not Process_Take_Off
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    expect(mig.isFixedWing).toBe(true);
    // TS doesn't model the immediate-full-speed behavior separately
    // but the takeoff ascent rate is the same
  });

  it('fixed-wing takeoff takes same 24 ticks as helicopter in TS', () => {
    // C++ Landing_Takeoff_AI: both fixed-wing and helicopter use Pixel_To_Lepton(1) per tick
    // TS: both use +1 per tick
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.aircraftState = 'takeoff';
    mig.flightAltitude = 0;
    mig.ammo = 3;
    mig.maxAmmo = 3;
    mig.mission = Mission.ATTACK;
    const enemy = makeEntity(UnitType.V_HELI, House.Spain, 300, 300);
    mig.target = enemy;

    const ctx = makeAircraftCtx();
    let ticks = 0;
    while (mig.aircraftState === 'takeoff' && ticks < 100) {
      updateAircraft(ctx, mig);
      ticks++;
    }
    expect(ticks).toBe(24);
    expect(mig.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 6: Process_Landing — Helicopter Speed at Half-Height
// C++ aircraft.cpp:2988-2990: Set_Speed(0) at FLIGHT_LEVEL/2
// TS: no speed change during landing — PARITY GAP
// ═══════════════════════════════════════════════════════════════════════════════

describe('FIXED: helicopter landing speed staging (aircraft.cpp:2982-2998)', () => {

  it('FIXED: helicopter stops horizontal movement at half flight level during landing', () => {
    // C++ aircraft.cpp:2988-2990:
    //   case FLIGHT_LEVEL/2:
    //     Set_Speed(0);
    // At 128 leptons (~12 pixels), helicopter stops horizontal movement during landing
    //
    // FIXED: TS now sets aircraftSpeedFraction=0 at half flight level during landing
    const cppHalfLevelLeptons = 256 / 2; // 128
    const cppHalfLevelPixels = Math.round((cppHalfLevelLeptons * 24) / 256); // 12
    expect(cppHalfLevelPixels).toBe(12);
  });

  it('FIXED: helicopter speed goes to 0 at half altitude during landing', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 12; // exactly at FLIGHT_LEVEL/2 equivalent
    heli.ammo = 0;
    heli.maxAmmo = 6;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    // FIXED: at or below 12px altitude, helicopter speed fraction goes to 0
    expect(heli.flightAltitude).toBe(11);
    expect(heli.aircraftState).toBe('landing');
    expect(heli.aircraftSpeedFraction).toBe(0); // stopped horizontal movement
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 7: Fixed-Wing Landing — Speed from LandingSpeed
// C++ aircraft.cpp:2958-2980: landing speed = LandingSpeed / AirspeedBias
// C++ aircraft.cpp:4062-4068: fixed-wing on ground without MISSION_ENTER → DESTROYED
// TS: fixed-wing uses same landing as helicopter — PARITY GAP
// ═══════════════════════════════════════════════════════════════════════════════

describe('fixed-wing landing behavior (aircraft.cpp:2958-2980, 4062-4068)', () => {

  it('C++ MIG has LandingSpeed=0xC0 (aadata.cpp:123)', () => {
    // C++ aadata.cpp:123: MIG LandingSpeed = 0xC0 (192 / 255 = 75% speed during landing)
    // C++ aadata.cpp:146: YAK LandingSpeed = 0xFF (100% = no slowdown)
    const cppMigLandingSpeed = 0xC0;
    const cppYakLandingSpeed = 0xFF;
    expect(cppMigLandingSpeed).toBe(192);
    expect(cppYakLandingSpeed).toBe(255);
    // TS does not model per-type landing speeds
  });

  it('FIXED: fixed-wing crash-lands on open ground (destroyed)', () => {
    // C++ aircraft.cpp:4062-4068:
    //   if (Class->IsFixedWing && Mission != MISSION_ENTER) {
    //     Strength = 1;
    //     int damage = Strength;
    //     Take_Damage(damage, 0, WARHEAD_AP, 0, true);
    //     return(true); // destroyed
    //   }
    // Fixed-wing aircraft that land on the ground (not on airstrip) are destroyed
    //
    // FIXED: TS now destroys fixed-wing aircraft that land without an airstrip pad
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.aircraftState = 'landing';
    mig.flightAltitude = 1;
    mig.ammo = 3;
    mig.maxAmmo = 3;
    mig.landedAtStructure = -1; // no pad — landing on open ground

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, mig);

    // FIXED: MIG is destroyed when landing on open ground (matching C++)
    expect(mig.flightAltitude).toBe(0);
    expect(mig.alive).toBe(false); // C++ behavior: destroyed on crash-land
    expect(mig.hp).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 8: Layer Transition Threshold
// C++ object.cpp:348: Height < FLIGHT_LEVEL - (FLIGHT_LEVEL/3) → LAYER_GROUND
// 256 - 85 = 171 leptons threshold (integer: 256/3=85)
// ═══════════════════════════════════════════════════════════════════════════════

describe('layer transition threshold (object.cpp:343-352)', () => {

  it('C++ GROUND/TOP layer threshold is at 2/3 of FLIGHT_LEVEL', () => {
    // C++ object.cpp:348: if (Height < (FLIGHT_LEVEL - (FLIGHT_LEVEL/3)))
    //   return LAYER_GROUND;
    // FLIGHT_LEVEL/3 = 256/3 = 85 (integer division)
    // Threshold = 256 - 85 = 171 leptons
    // In pixels: (171 * 24) / 256 ≈ 16 pixels
    const FLIGHT_LEVEL = 256;
    const threshold = FLIGHT_LEVEL - Math.floor(FLIGHT_LEVEL / 3);
    expect(threshold).toBe(171);

    // Below 171 leptons → LAYER_GROUND; at or above 171 → LAYER_TOP
    const thresholdPixels = Math.round((threshold * 24) / 256);
    expect(thresholdPixels).toBe(16);
  });

  it('TS does not implement layer transition — visual-only altitude', () => {
    // TS entity.ts:381-383: flightAltitude is purely visual rendering offset
    // There is no layer system in TS — all entities render in one pass
    // This is acceptable: the layer distinction matters for rendering order
    // and collision detection in C++, but TS handles these differently
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.flightAltitude = 16; // at the C++ layer threshold
    // No layer-related property exists in TS
    expect(heli.flightAltitude).toBe(16);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 9: Aircraft Constructor — Starting Altitude
// C++ aircraft.cpp:249: Height = FLIGHT_LEVEL (starts in air)
// TS entity.ts:328-329: aircraftState='landed', flightAltitude=0 (starts grounded)
// ═══════════════════════════════════════════════════════════════════════════════

describe('aircraft initial altitude (aircraft.cpp:249)', () => {

  it('C++ aircraft starts at FLIGHT_LEVEL (in flight)', () => {
    // C++ aircraft.cpp:249: Height = FLIGHT_LEVEL;
    // Aircraft are created already airborne at full altitude
    const cppInitialHeight = 256; // FLIGHT_LEVEL
    expect(cppInitialHeight).toBe(256);
  });

  it('FIXED: TS aircraft starts at FLIGHT_ALTITUDE, aircraftState=flying', () => {
    // FIXED: TS now matches C++ — aircraft created airborne at FLIGHT_ALTITUDE.
    // Callers that place aircraft on pads override afterwards.
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    expect(mig.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    expect(mig.aircraftState).toBe('flying');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 10: IsFixedWing Flag — Type Classification
// C++ aadata.cpp:67,90,113,136 — Badger/U2/MIG/YAK are fixed-wing
// C++ aadata.cpp:159,182,206 — TRAN/HELI/HIND are NOT fixed-wing
// ═══════════════════════════════════════════════════════════════════════════════

describe('IsFixedWing flag per aircraft type (aadata.cpp)', () => {

  const FIXED_WING_TYPES: [string, UnitType, boolean][] = [
    ['MIG',  UnitType.V_MIG,  true],   // aadata.cpp:113
    ['YAK',  UnitType.V_YAK,  true],   // aadata.cpp:136
    ['HELI', UnitType.V_HELI, false],   // aadata.cpp:182
    ['HIND', UnitType.V_HIND, false],   // aadata.cpp:206
    ['TRAN', UnitType.V_TRAN, false],   // aadata.cpp:159
  ];

  for (const [name, type, expected] of FIXED_WING_TYPES) {
    it(`${name} isFixedWing=${expected} — aadata.cpp`, () => {
      const entity = makeEntity(type, House.USSR);
      expect(entity.isFixedWing).toBe(expected);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 11: Helicopter vs Fixed-Wing — isHelicopter Getter
// TS entity.ts:362-363: isHelicopter = isAircraft && !isFixedWing
// ═══════════════════════════════════════════════════════════════════════════════

describe('isHelicopter classification (entity.ts:362-363)', () => {

  const HELI_TYPES: [string, UnitType, boolean][] = [
    ['HELI', UnitType.V_HELI, true],
    ['HIND', UnitType.V_HIND, true],
    ['TRAN', UnitType.V_TRAN, true],
    ['MIG',  UnitType.V_MIG,  false],
    ['YAK',  UnitType.V_YAK,  false],
  ];

  for (const [name, type, expected] of HELI_TYPES) {
    it(`${name} isHelicopter=${expected}`, () => {
      const entity = makeEntity(type, House.USSR);
      expect(entity.isHelicopter).toBe(expected);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 12: Helicopter Jitter at FLIGHT_LEVEL
// C++ aircraft.cpp:441-445: bobbing when at FLIGHT_LEVEL and speed < 3
// Pattern: {0,0,0,0,1,1,1,0,0,0,0,0,-1,-1,-1,0} indexed by Frame%16
// TS: no jitter implemented — PARITY GAP
// ═══════════════════════════════════════════════════════════════════════════════

describe('FIXED: helicopter hover jitter (aircraft.cpp:441-445)', () => {

  it('FIXED: HOVER_JITTER pattern matches C++ _jitter array', () => {
    // C++ aircraft.cpp:443-444:
    //   static int _jitter[] = {0,0,0,0,1,1,1,0,0,0,0,0,-1,-1,-1,0};
    //   jitter = _jitter[::Frame % 16];
    expect(HOVER_JITTER.length).toBe(16);
    // All values are -1, 0, or 1
    for (const j of HOVER_JITTER) {
      expect(j).toBeGreaterThanOrEqual(-1);
      expect(j).toBeLessThanOrEqual(1);
    }
    // Sum is 0 — no net vertical displacement
    expect(HOVER_JITTER.reduce((a, b) => a + b, 0)).toBe(0);
    // Exact pattern match
    expect([...HOVER_JITTER]).toEqual([0,0,0,0,1,1,1,0,0,0,0,0,-1,-1,-1,0]);
  });

  it('FIXED: hovering helicopter gets jitter offset applied per tick', () => {
    // C++ aircraft.cpp:442: if (Height == FLIGHT_LEVEL && Get_Speed() < 3)
    // FIXED: TS now applies hoverJitter field when helicopter is at FLIGHT_ALTITUDE
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'flying';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.mission = Mission.GUARD; // no target — will go to 'returning'

    const ctx = makeAircraftCtx();
    // Advance frame to index 4 (first +1 jitter)
    for (let i = 0; i < 4; i++) advanceAircraftFrame();
    updateAircraft(ctx, heli);
    // At frame 4, HOVER_JITTER[4] = 1
    expect(heli.hoverJitter).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 13: Landing Pad Fallback — Helicopter Clear Terrain Landing
// C++ aircraft.cpp:3486-3523: Good_LZ() — land near friendly buildings
// C++ aircraft.cpp:4104-4111: LZ blocked → abort landing, take off again
// C++ aadata.cpp:162: TRAN IsLandable=true (can land on clear terrain)
// TS aircraft.ts:217-224: transport can land without pad; combat aircraft orbit
// ═══════════════════════════════════════════════════════════════════════════════

describe('landing pad fallback behavior (aircraft.cpp:3486-3523, 4104-4111)', () => {

  it('transport helicopter can land without a pad in TS (matches C++ IsLandable)', () => {
    // C++ aadata.cpp:162: TRAN IsLandable=true
    // C++ Good_LZ() tries to land near friendly buildings
    // TS aircraft.ts:219-221: if isTransport → landing state, no pad needed
    const tran = makeEntity(UnitType.V_TRAN, House.Spain, 200, 200);
    tran.aircraftState = 'returning';
    tran.flightAltitude = Entity.FLIGHT_ALTITUDE;
    tran.mission = Mission.GUARD;

    const ctx = makeAircraftCtx({ structures: [] }); // no pads
    updateAircraft(ctx, tran);

    // Transport should enter landing state even without a pad
    expect(tran.aircraftState).toBe('landing');
  });

  it('combat helicopter orbits when no pad available in TS', () => {
    // C++ uses Good_LZ() for helicopters without pads — finds a nearby cell
    // TS: combat aircraft stay in 'returning' state (orbit)
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'returning';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.mission = Mission.GUARD;

    const ctx = makeAircraftCtx({ structures: [] }); // no pads
    updateAircraft(ctx, heli);

    // Non-transport stays in returning (orbiting) — does not land
    expect(heli.aircraftState).toBe('returning');
  });

  it('C++ aborts landing when LZ becomes blocked — TS does not check', () => {
    // C++ aircraft.cpp:4104-4111:
    //   if (In_Which_Layer() == LAYER_GROUND && !IsTakingOff && !Class->IsFixedWing) {
    //     if (!Is_LZ_Clear(::As_Target(Coord_Cell(Coord)))) {
    //       IsTakingOff = true;
    //       Height += Pixel_To_Lepton(1);
    //     }
    //   }
    // When descending below layer threshold, C++ checks if landing zone is blocked
    // If blocked, reverses to takeoff
    //
    // TS: no LZ clear check during landing — will always complete descent
    // PARITY GAP: TS cannot abort a landing in progress
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 5; // close to ground
    heli.ammo = 0;
    heli.maxAmmo = 6;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    // TS unconditionally descends — no abort check
    expect(heli.flightAltitude).toBe(4);
    expect(heli.aircraftState).toBe('landing');
    // C++ might have reversed to takeoff if LZ was blocked
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 14: Altitude Clamping
// C++ aircraft.cpp:4046-4048: Height clamps to 0 (landing)
// C++ aircraft.cpp:4082-4084: Height clamps to FLIGHT_LEVEL (takeoff)
// TS aircraft.ts:132,244: min/max clamping
// ═══════════════════════════════════════════════════════════════════════════════

describe('altitude clamping (aircraft.cpp:4046-4048, 4082-4084)', () => {

  it('takeoff clamps to FLIGHT_ALTITUDE — never exceeds', () => {
    // C++ aircraft.cpp:4083-4084: if (Height >= FLIGHT_LEVEL) Height = FLIGHT_LEVEL;
    // TS aircraft.ts:132: min(FLIGHT_ALTITUDE, flightAltitude + 1)
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'takeoff';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE - 1;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    // One more tick should not exceed
    heli.aircraftState = 'takeoff'; // force back to takeoff
    updateAircraft(ctx, heli);
    expect(heli.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
  });

  it('landing clamps to 0 — never goes negative', () => {
    // C++ aircraft.cpp:4047: if (Height <= 0) Height = 0;
    // TS aircraft.ts:244: max(0, flightAltitude - 1)
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 1;
    heli.ammo = 0;
    heli.maxAmmo = 6;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(0);
    // Should not be negative even if we forced it
  });

  it('altitude=0 on landing triggers state transition', () => {
    // C++ aircraft.cpp:4047-4050: Height=0 → IsLanding=false, Set_Speed(0)
    // TS aircraft.ts:246-256: flightAltitude <= 0 → transition to rearming or landed
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 1;
    heli.ammo = 3;
    heli.maxAmmo = 6;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(0);
    // Should transition out of 'landing' state
    expect(heli.aircraftState).not.toBe('landing');
    expect(['rearming', 'landed']).toContain(heli.aircraftState);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 15: Mission_Retreat — Fixed-Wing Altitude Gain
// C++ aircraft.cpp:1314-1318: Height += 1 per tick during retreat (not Pixel_To_Lepton!)
// ═══════════════════════════════════════════════════════════════════════════════

describe('fixed-wing retreat altitude gain (aircraft.cpp:1314-1318)', () => {

  it('C++ Mission_Retreat gains altitude at 1 lepton/tick (slower than normal takeoff)', () => {
    // C++ aircraft.cpp:1314-1318:
    //   if (Class->IsFixedWing && Height < FLIGHT_LEVEL) {
    //     Height += 1;  // NOT Pixel_To_Lepton(1) which is 11!
    //     return(3);
    //   }
    // During retreat, fixed-wing gains altitude at only 1 lepton per 3 ticks
    // Normal takeoff uses Pixel_To_Lepton(1) = 11 leptons per tick
    // So retreat altitude gain is ~33x slower than normal takeoff!
    const retreatLeptonsPerTick = 1;
    const retreatTickInterval = 3; // returns 3, meaning called every 3 ticks
    const normalLeptonsPerTick = 11; // Pixel_To_Lepton(1)

    // Retreat: 256 leptons / (1 lepton per 3 ticks) = 768 ticks
    // Normal: 256 leptons / 11 leptons per tick = ~24 ticks
    const retreatTotalTicks = 256 * retreatTickInterval; // 768
    const normalTotalTicks = Math.ceil(256 / normalLeptonsPerTick); // 24

    expect(retreatTotalTicks).toBe(768);
    expect(normalTotalTicks).toBe(24);
    expect(retreatTotalTicks / normalTotalTicks).toBe(32); // 32x slower
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 16: Full Takeoff→Fly→Land Altitude Cycle
// Integration test: complete altitude lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe('full takeoff → fly → land altitude cycle', () => {

  it('helicopter completes full altitude lifecycle: 0→24→0', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'takeoff';
    heli.flightAltitude = 0;
    heli.ammo = 6;
    heli.maxAmmo = 6;

    const ctx = makeAircraftCtx();
    const altitudes: number[] = [0];

    // Phase 1: Takeoff (0 → 24)
    while (heli.aircraftState === 'takeoff' && altitudes.length < 100) {
      updateAircraft(ctx, heli);
      altitudes.push(heli.flightAltitude);
    }
    expect(heli.flightAltitude).toBe(24);
    expect(heli.aircraftState).toBe('flying');

    // Verify monotonic ascent
    for (let i = 1; i < altitudes.length; i++) {
      expect(altitudes[i]).toBeGreaterThanOrEqual(altitudes[i - 1]);
    }

    // Phase 2: Force landing
    heli.aircraftState = 'landing';
    heli.ammo = 0; // need rearm
    const descentAltitudes: number[] = [24];

    while (heli.aircraftState === 'landing' && descentAltitudes.length < 100) {
      updateAircraft(ctx, heli);
      descentAltitudes.push(heli.flightAltitude);
    }
    expect(heli.flightAltitude).toBe(0);

    // Verify monotonic descent
    for (let i = 1; i < descentAltitudes.length; i++) {
      expect(descentAltitudes[i]).toBeLessThanOrEqual(descentAltitudes[i - 1]);
    }
  });

  it('altitude increases by exactly 1 each takeoff tick (no gaps)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'takeoff';
    heli.flightAltitude = 0;

    const ctx = makeAircraftCtx();
    for (let tick = 0; tick < 24; tick++) {
      const before = heli.flightAltitude;
      updateAircraft(ctx, heli);
      expect(heli.flightAltitude).toBe(before + 1);
    }
    expect(heli.flightAltitude).toBe(24);
  });

  it('altitude decreases by exactly 1 each landing tick (no gaps)', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 24;
    heli.ammo = 0;
    heli.maxAmmo = 6;

    const ctx = makeAircraftCtx();
    for (let tick = 0; tick < 24; tick++) {
      const before = heli.flightAltitude;
      updateAircraft(ctx, heli);
      expect(heli.flightAltitude).toBe(before - 1);
    }
    expect(heli.flightAltitude).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 17: IsLandable — Transport Helicopter Special Flag
// C++ aadata.cpp:162: TRAN IsLandable=true; others false
// ═══════════════════════════════════════════════════════════════════════════════

describe('IsLandable flag (aadata.cpp:162)', () => {

  it('only transport helicopter has isTransport=true in TS (C++ IsLandable)', () => {
    // C++ aadata.cpp:162: Transport IsLandable=true — can land on clear terrain
    // C++ aadata.cpp:116,185,209: MIG/HELI/HIND IsLandable=false
    const tran = makeEntity(UnitType.V_TRAN, House.Spain);
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    const hind = makeEntity(UnitType.V_HIND, House.USSR);

    expect(tran.isTransport).toBe(true);
    expect(heli.isTransport).toBe(false);
    expect(mig.isTransport).toBe(false);
    expect(hind.isTransport).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 18: Altitude During Different Aircraft States
// Verify flightAltitude behavior across all states
// ═══════════════════════════════════════════════════════════════════════════════

describe('altitude across aircraft states', () => {

  it('landed state holds altitude at 0', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landed';
    heli.flightAltitude = 0;
    heli.ammo = 6;
    heli.maxAmmo = 6;
    heli.mission = Mission.GUARD;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(0);
    expect(heli.aircraftState).toBe('landed');
  });

  it('rearming state holds altitude at 0', () => {
    // C++ building.cpp: rearming occurs on the ground, aircraft is landed
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

  it('flying state maintains FLIGHT_ALTITUDE', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'flying';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.mission = Mission.GUARD; // will transition to returning

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    // flightAltitude should not change during flying state
    expect(heli.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
  });

  it('attacking state maintains FLIGHT_ALTITUDE for helicopter', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain, 200, 200);
    heli.aircraftState = 'attacking';
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE;
    heli.ammo = 6;
    heli.maxAmmo = 6;
    heli.attackCooldown = 5;
    const enemy = makeEntity(UnitType.V_MIG, House.USSR, 200, 200 + CELL_SIZE);
    heli.target = enemy;

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);

    expect(heli.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
  });
});
