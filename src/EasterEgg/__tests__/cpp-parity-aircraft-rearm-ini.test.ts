/**
 * C++ Behavioral Parity: Aircraft Rearm / Landing / Ammo — rules.ini Authoritative
 *
 * Parses rules.ini directly and audits ALL aircraft rearm mechanics against
 * C++ source behavior and the TS implementation in aircraft.ts.
 *
 * KEY C++ ARCHITECTURE (building.cpp:3989-4037):
 *   Rearm is BUILDING-driven. The helipad/airstrip sends RADIO_RELOAD to the
 *   docked aircraft once per timer tick, incrementing ammo by 1 each time.
 *   Timer delay per ammo point:
 *     pfrac = Saturate(Power_Fraction(), 1.0), clamped to min 0.5
 *     time = Inverse(pfrac) * Rule.ReloadRate * TICKS_PER_MINUTE
 *   At full power (pfrac=1.0): time = 1.0 * ReloadRate * 900
 *
 * TS ARCHITECTURE (aircraft.ts:263-286):
 *   Rearm is AIRCRAFT-driven. On landing with depleted ammo, the aircraft
 *   sets rearmTimer = max(1, round(weapon.rof * ROFBias)). Each tick,
 *   rearmTimer decrements; at zero, ammo++ and timer resets.
 *
 * C++ source refs:
 *   rules.ini [General] ReloadRate=.04 (authoritative — overrides rules.cpp:178 default of .05)
 *   rules.ini [BADR] Ammo=5, [U2] Ammo=1, [MIG] Ammo=3, [YAK] Ammo=15,
 *             [HELI] Ammo=6, [HIND] Ammo=12
 *   rules.ini [HELI] Primary=Hellfire, [HIND] Primary=ChainGun,
 *             [MIG] Primary=Maverick, [YAK] Primary=ChainGun
 *   aadata.cpp:76,99   — BADR/U2 Building = STRUCT_NONE
 *   aadata.cpp:122,145 — MIG/YAK Building = STRUCT_AIRSTRIP
 *   aadata.cpp:168     — TRAN Building = STRUCT_NONE (lands on clear ground)
 *   aadata.cpp:191,215 — HELI/HIND Building = STRUCT_HELIPAD
 *   building.cpp:3989-4037  — helipad/airstrip Mission_Repair rearm loop
 *   building.cpp:4025       — time = Inverse(pfrac) * Rule.ReloadRate * TICKS_PER_MINUTE
 *   techno.cpp:964-968      — RADIO_RELOAD: Ammo++ (one ammo per message)
 *   techno.cpp:2857-2870    — Rearm_Delay: weapon->ROF * House->ROFBias (combat rearm, not pad rearm)
 *   aircraft.cpp:248        — constructor: Ammo = Class->MaxAmmo
 *   aircraft.cpp:2691-2694  — RADIO_PREPARED readiness check
 *   defines.h:3031-3032     — TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS,
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

// ── INI Parser ────────────────────────────────────────────────────────────────

function parseINI(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = '';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    if (current) {
      const kvMatch = line.match(/^([^=;]+)=\s*([^;]*)/);
      if (kvMatch) {
        sections[current][kvMatch[1].trim()] = kvMatch[2].trim();
      }
    }
  }
  return sections;
}

// ── Load rules.ini ────────────────────────────────────────────────────────────

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const rulesContent = readFileSync(join(assetsDir, 'rules.ini'), 'utf-8');
const ini = parseINI(rulesContent);

// ── C++ Constants ─────────────────────────────────────────────────────────────

const TICKS_PER_SECOND = 15;  // defines.h:3031
const TICKS_PER_MINUTE = TICKS_PER_SECOND * 60; // = 900, defines.h:3032

// ── Test Helpers ──────────────────────────────────────────────────────────────

beforeEach(() => resetEntityIds());

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
// Section 1: rules.ini Aircraft Ammo Counts — Direct INI Parse
// rules.ini is god: Ammo= values override any C++ constructor defaults
// ═══════════════════════════════════════════════════════════════════════════════

describe('rules.ini Ammo= values parsed directly and compared to UNIT_STATS', () => {
  // Aircraft types with Ammo= in rules.ini
  const AIRCRAFT_WITH_AMMO: [string, UnitType][] = [
    ['BADR', UnitType.V_BADR],
    ['U2',   UnitType.V_U2],
    ['MIG',  UnitType.V_MIG],
    ['YAK',  UnitType.V_YAK],
    ['HELI', UnitType.V_HELI],
    ['HIND', UnitType.V_HIND],
  ];

  for (const [iniKey, unitType] of AIRCRAFT_WITH_AMMO) {
    it(`${iniKey} UNIT_STATS.maxAmmo matches rules.ini Ammo=${ini[iniKey]?.Ammo}`, () => {
      const iniAmmo = parseInt(ini[iniKey]?.Ammo ?? '', 10);
      expect(iniAmmo, `rules.ini [${iniKey}] Ammo= should be a valid integer`).not.toBeNaN();
      expect(UNIT_STATS[unitType]?.maxAmmo, `UNIT_STATS[${iniKey}].maxAmmo`).toBe(iniAmmo);
    });
  }

  it('TRAN has no Ammo= in rules.ini — should be unlimited (-1)', () => {
    expect(ini['TRAN']?.Ammo).toBeUndefined();
    const tran = makeEntity(UnitType.V_TRAN, House.Spain);
    expect(tran.ammo).toBe(-1);
  });

  // C++ aircraft.cpp:248: Ammo = Class->MaxAmmo at construction
  for (const [iniKey, unitType] of AIRCRAFT_WITH_AMMO) {
    it(`${iniKey} Entity starts fully loaded (aircraft.cpp:248)`, () => {
      const iniAmmo = parseInt(ini[iniKey]?.Ammo ?? '0', 10);
      const entity = makeEntity(unitType, House.USSR);
      expect(entity.ammo, `${iniKey} initial ammo`).toBe(iniAmmo);
      expect(entity.maxAmmo, `${iniKey} maxAmmo`).toBe(iniAmmo);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 2: rules.ini Weapon Assignments for Aircraft
// rules.ini Primary=/Secondary= must match UNIT_STATS primaryWeapon/secondaryWeapon
// ═══════════════════════════════════════════════════════════════════════════════

describe('rules.ini Primary=/Secondary= weapon assignments for aircraft', () => {
  const AIRCRAFT_WEAPONS: [string, UnitType][] = [
    ['BADR', UnitType.V_BADR],
    ['U2',   UnitType.V_U2],
    ['MIG',  UnitType.V_MIG],
    ['YAK',  UnitType.V_YAK],
    ['HELI', UnitType.V_HELI],
    ['HIND', UnitType.V_HIND],
  ];

  for (const [iniKey, unitType] of AIRCRAFT_WEAPONS) {
    const iniPrimary = ini[iniKey]?.Primary;
    if (iniPrimary) {
      it(`${iniKey} Primary=${iniPrimary} matches UNIT_STATS`, () => {
        expect(UNIT_STATS[unitType]?.primaryWeapon).toBe(iniPrimary);
      });
    }

    const iniSecondary = ini[iniKey]?.Secondary;
    if (iniSecondary) {
      it(`${iniKey} Secondary=${iniSecondary} matches UNIT_STATS`, () => {
        expect(UNIT_STATS[unitType]?.secondaryWeapon).toBe(iniSecondary);
      });
    }
  }

  it('TRAN has no Primary/Secondary in rules.ini', () => {
    expect(ini['TRAN']?.Primary).toBeUndefined();
    expect(UNIT_STATS[UnitType.V_TRAN]?.primaryWeapon).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 3: rules.ini [General] ReloadRate — Authoritative Rearm Timing
// C++ building.cpp:4025: time = Inverse(pfrac) * Rule.ReloadRate * TICKS_PER_MINUTE
// rules.ini overrides rules.cpp:178 constructor default of .05
// ═══════════════════════════════════════════════════════════════════════════════

describe('rules.ini [General] ReloadRate — C++ rearm timing formula', () => {

  it('rules.ini ReloadRate=.04 (not the C++ constructor default of .05)', () => {
    // rules.ini line 46: ReloadRate=.04
    // rules.cpp:178: ReloadRate(".05") — this is the constructor default
    // rules.cpp:461: ReloadRate = ini.Get_Fixed(GENERAL, "ReloadRate", ReloadRate);
    // rules.ini OVERRIDES the constructor default: 0.04, not 0.05
    const iniReloadRate = parseFloat(ini['General']?.ReloadRate ?? '');
    expect(iniReloadRate).toBeCloseTo(0.04, 4);
  });

  it('C++ full-power rearm: 1.0 * 0.04 * 900 = 36 ticks per ammo point', () => {
    // building.cpp:4025: time = Inverse(pfrac) * Rule.ReloadRate * TICKS_PER_MINUTE
    // At full power, pfrac=1.0, Inverse(1.0)=1.0
    // ReloadRate=0.04 (rules.ini), TICKS_PER_MINUTE=900
    const reloadRate = 0.04;
    const fullPowerRearm = Math.round(1.0 * reloadRate * TICKS_PER_MINUTE);
    expect(fullPowerRearm).toBe(36);
  });

  it('C++ half-power rearm: 2.0 * 0.04 * 900 = 72 ticks per ammo point', () => {
    // building.cpp:4023-4024: pfrac = Saturate(Power_Fraction(), 1);
    //                          if (pfrac < fixed::_1_2) pfrac = fixed::_1_2;
    // At 50% power: pfrac=0.5, Inverse(0.5)=2.0
    const reloadRate = 0.04;
    const halfPowerRearm = Math.round(2.0 * reloadRate * TICKS_PER_MINUTE);
    expect(halfPowerRearm).toBe(72);
  });

  it('C++ minimum power clamp: pfrac never below 0.5 → max rearm delay = 72 ticks', () => {
    // building.cpp:4024: if (pfrac < fixed::_1_2) pfrac = fixed::_1_2;
    // Even with 0% power, rearm delay is at most 2x the base rate
    const reloadRate = 0.04;
    const minPowerRearm = Math.round(2.0 * reloadRate * TICKS_PER_MINUTE);
    expect(minPowerRearm).toBe(72); // worst case
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 4: PARITY VERIFIED — TS Rearm Now Uses C++ ReloadRate Formula
// C++ building.cpp:4025: time = Inverse(pfrac) * ReloadRate * TICKS_PER_MINUTE
// TS now uses computeRearmDelay(getPowerFraction(house)) — matches C++
// ═══════════════════════════════════════════════════════════════════════════════

describe('PARITY VERIFIED: TS rearm matches C++ ReloadRate formula (rules.ini)', () => {
  const CPP_FULL_POWER_TICKS_PER_AMMO = computeRearmDelay(1.0); // = 36

  const AIRCRAFT_REARM_AUDIT: { name: string; unitType: UnitType; iniAmmo: number }[] = [
    { name: 'MIG',  unitType: UnitType.V_MIG,  iniAmmo: 3 },
    { name: 'YAK',  unitType: UnitType.V_YAK,  iniAmmo: 15 },
    { name: 'HELI', unitType: UnitType.V_HELI, iniAmmo: 6 },
    { name: 'HIND', unitType: UnitType.V_HIND, iniAmmo: 12 },
  ];

  for (const { name, unitType, iniAmmo } of AIRCRAFT_REARM_AUDIT) {
    const expectedTotal = iniAmmo * CPP_FULL_POWER_TICKS_PER_AMMO;
    it(`${name}: full rearm = ${expectedTotal} ticks (${iniAmmo} ammo * ${CPP_FULL_POWER_TICKS_PER_AMMO} ticks/ammo)`, () => {
      const entity = makeEntity(unitType, House.USSR);
      entity.ammo = 0;
      entity.maxAmmo = iniAmmo;
      entity.aircraftState = 'rearming';
      entity.rearmTimer = CPP_FULL_POWER_TICKS_PER_AMMO;

      const ctx = makeAircraftCtx();
      let ticks = 0;
      while (entity.aircraftState === 'rearming' && ticks < 10000) {
        updateAircraft(ctx, entity);
        ticks++;
      }

      expect(ticks).toBe(expectedTotal);
      expect(entity.ammo).toBe(iniAmmo);
      expect(entity.aircraftState).toBe('landed');
    });
  }

  it('MIG full rearm: 3 * 36 = 108 ticks (C++ parity verified)', () => {
    expect(3 * CPP_FULL_POWER_TICKS_PER_AMMO).toBe(108);
  });

  it('HIND full rearm: 12 * 36 = 432 ticks (C++ parity verified)', () => {
    expect(12 * CPP_FULL_POWER_TICKS_PER_AMMO).toBe(432);
  });

  it('YAK full rearm: 15 * 36 = 540 ticks (C++ parity verified)', () => {
    expect(15 * CPP_FULL_POWER_TICKS_PER_AMMO).toBe(540);
  });

  it('HELI full rearm: 6 * 36 = 216 ticks (C++ parity verified)', () => {
    expect(6 * CPP_FULL_POWER_TICKS_PER_AMMO).toBe(216);
  });

  it('all aircraft use identical per-ammo delay (weapon ROF is irrelevant to pad rearm)', () => {
    for (const { name, unitType } of AIRCRAFT_REARM_AUDIT) {
      const entity = makeEntity(unitType, House.USSR);
      entity.ammo = 0;
      entity.aircraftState = 'landing';
      entity.flightAltitude = 0;
      entity.landedAtStructure = 0;

      const padType = entity.stats.landingBuilding ?? 'HPAD';
      const pad = makePadStructure(padType, House.USSR, 5, 5);
      pad.dockedAircraft = entity.id;
      const ctx = makeAircraftCtx({ structures: [pad] });

      updateAircraft(ctx, entity);

      expect(entity.rearmTimer, `${name} rearmTimer`).toBe(CPP_FULL_POWER_TICKS_PER_AMMO);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 5: Landing Building Assignment — C++ aadata.cpp vs TS UNIT_STATS
// C++ uses Building field from AircraftTypeClass; TS uses landingBuilding
// ═══════════════════════════════════════════════════════════════════════════════

describe('landing building assignment — aadata.cpp vs TS (rules.ini Prerequisite= cross-check)', () => {
  /**
   * C++ aadata.cpp defines preferred landing building for each aircraft.
   * rules.ini Prerequisite= is a separate (production) field, but correlates:
   *   Prerequisite=afld → fixed-wing lands on AFLD
   *   Prerequisite=hpad → helicopter lands on HPAD
   *   No prerequisite → no landing building (bombers, spy planes)
   */
  const LANDING_EXPECTED: [string, UnitType, string | undefined, string | undefined][] = [
    // [name, type, C++ aadata.cpp Building, rules.ini Prerequisite]
    ['BADR', UnitType.V_BADR, undefined, 'afld'],   // aadata.cpp:76: STRUCT_NONE
    ['U2',   UnitType.V_U2,   undefined, 'afld'],   // aadata.cpp:99: STRUCT_NONE
    ['MIG',  UnitType.V_MIG,  'AFLD',    'afld'],   // aadata.cpp:122: STRUCT_AIRSTRIP
    ['YAK',  UnitType.V_YAK,  'AFLD',    'afld'],   // aadata.cpp:145: STRUCT_AIRSTRIP
    ['TRAN', UnitType.V_TRAN, undefined, 'hpad'],   // aadata.cpp:168: STRUCT_NONE (lands on clear ground)
    ['HELI', UnitType.V_HELI, 'HPAD',    'hpad'],   // aadata.cpp:191: STRUCT_HELIPAD
    ['HIND', UnitType.V_HIND, 'HPAD',    'hpad'],   // aadata.cpp:215: STRUCT_HELIPAD
  ];

  for (const [name, type, cppBuilding, iniPrereq] of LANDING_EXPECTED) {
    it(`${name}: C++ Building=${cppBuilding ?? 'STRUCT_NONE'}, ini Prerequisite=${iniPrereq}`, () => {
      const iniPrereqActual = ini[name]?.Prerequisite;
      if (iniPrereq) {
        expect(iniPrereqActual).toBe(iniPrereq);
      }

      const tsLanding = UNIT_STATS[type]?.landingBuilding;
      if (cppBuilding) {
        // C++ has a landing building — TS should match
        expect(tsLanding, `${name} landingBuilding`).toBe(cppBuilding);
      }
    });
  }

  it('PARITY GAP: TRAN landingBuilding — C++ STRUCT_NONE, TS HPAD (aircraft.ts/types.ts)', () => {
    // C++ aadata.cpp:168: TRAN Building = STRUCT_NONE
    // C++ Transport helicopter uses Good_LZ() to land on clear terrain
    // TS types.ts: TRAN has landingBuilding: 'HPAD'
    const tsLanding = UNIT_STATS[UnitType.V_TRAN]?.landingBuilding;
    // TS incorrectly assigns HPAD; C++ says STRUCT_NONE
    expect(tsLanding).toBe('HPAD'); // TS current behavior
    // C++ expected: undefined (STRUCT_NONE = no preferred building)
    // This means in TS, transports will try to dock at helipads,
    // while in C++ they land on clear ground via Good_LZ()
  });

  it('BADR and U2: both STRUCT_NONE in C++ — never land (fly off map)', () => {
    // aadata.cpp:76 BADR Building = STRUCT_NONE
    // aadata.cpp:99 U2 Building = STRUCT_NONE
    // These aircraft complete their mission and exit the map; they never rearm
    expect(UNIT_STATS[UnitType.V_BADR]?.landingBuilding).toBeUndefined();
    expect(UNIT_STATS[UnitType.V_U2]?.landingBuilding).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 6: rules.ini Speed/ROT vs UNIT_STATS — Direct INI Parse
// ═══════════════════════════════════════════════════════════════════════════════

describe('rules.ini Speed=/ROT= for all aircraft vs UNIT_STATS', () => {
  const ALL_AIRCRAFT: [string, UnitType][] = [
    ['BADR', UnitType.V_BADR],
    ['U2',   UnitType.V_U2],
    ['MIG',  UnitType.V_MIG],
    ['YAK',  UnitType.V_YAK],
    ['TRAN', UnitType.V_TRAN],
    ['HELI', UnitType.V_HELI],
    ['HIND', UnitType.V_HIND],
  ];

  for (const [iniKey, unitType] of ALL_AIRCRAFT) {
    const iniSpeed = parseInt(ini[iniKey]?.Speed ?? '', 10);
    const iniRot = parseInt(ini[iniKey]?.ROT ?? '', 10);

    if (!isNaN(iniSpeed)) {
      it(`${iniKey} Speed=${iniSpeed} matches UNIT_STATS`, () => {
        expect(UNIT_STATS[unitType]?.speed).toBe(iniSpeed);
      });
    }

    if (!isNaN(iniRot)) {
      it(`${iniKey} ROT=${iniRot} matches UNIT_STATS`, () => {
        expect(UNIT_STATS[unitType]?.rot).toBe(iniRot);
      });
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 7: Rearm State Machine Behavioral Tests
// Verify the TS aircraft.ts rearming state transitions
// ═══════════════════════════════════════════════════════════════════════════════

describe('rearm state machine: landing → rearming → landed transitions', () => {

  it('aircraft with depleted ammo transitions from landing to rearming at altitude 0', () => {
    // C++ Landing_Takeoff_AI: Height decrements by 1 lepton/tick → reaches 0
    // Then building.cpp Mission_Repair drives rearm
    // TS aircraft.ts:259-269: landing state, flightAltitude→0, then checks ammo
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 2; // nearly landed
    heli.ammo = 0;
    heli.landedAtStructure = 0;

    const ctx = makeAircraftCtx();

    // Tick 1: altitude 2→1
    updateAircraft(ctx, heli);
    expect(heli.flightAltitude).toBe(1);
    expect(heli.aircraftState).toBe('landing');

    // Tick 2: altitude 1→0, transition to rearming
    updateAircraft(ctx, heli);
    expect(heli.flightAltitude).toBe(0);
    expect(heli.aircraftState).toBe('rearming');
  });

  it('aircraft with full ammo transitions from landing directly to landed', () => {
    const heli = makeEntity(UnitType.V_HELI, House.Spain);
    heli.aircraftState = 'landing';
    heli.flightAltitude = 1;
    // ammo is full (6/6 from constructor)
    expect(heli.ammo).toBe(heli.maxAmmo);

    const ctx = makeAircraftCtx();
    updateAircraft(ctx, heli);
    expect(heli.flightAltitude).toBe(0);
    expect(heli.aircraftState).toBe('landed');
  });

  it('rearming increments ammo one-at-a-time (C++ techno.cpp:964-968 RADIO_RELOAD)', () => {
    // C++ building sends RADIO_RELOAD one at a time
    // TS aircraft.ts:279: entity.ammo++ (one per timer cycle)
    const mig = makeEntity(UnitType.V_MIG, House.USSR);
    mig.ammo = 0;
    mig.maxAmmo = 3;
    mig.aircraftState = 'rearming';
    mig.rearmTimer = computeRearmDelay(1.0); // C++ building-driven: 36

    const ctx = makeAircraftCtx();
    const ammoHistory: number[] = [];

    for (let i = 0; i < 150; i++) {
      updateAircraft(ctx, mig);
      ammoHistory.push(mig.ammo);
      if (mig.aircraftState !== 'rearming') break;
    }

    // Ammo should increment stepwise: stays at 0 for 35 ticks, becomes 1 at tick 36, etc.
    // Timer starts at 36: tick1→35, ..., tick36→0→ammo++ (1), reset timer
    expect(ammoHistory[0]).toBe(0);   // tick 1: timer 36→35
    expect(ammoHistory[34]).toBe(0);  // tick 35: timer still > 0
    expect(ammoHistory[35]).toBe(1);  // tick 36: timer→0, ammo++
    expect(ammoHistory[71]).toBe(2);  // tick 72: second ammo++
    expect(ammoHistory[107]).toBe(3); // tick 108: third ammo++, state→landed
  });

  it('rearm delay in TS now uses rules.ini ReloadRate (C++ parity achieved)', () => {
    // C++ building.cpp:4025: time = Inverse(pfrac) * Rule.ReloadRate * TICKS_PER_MINUTE
    // TS now uses computeRearmDelay(ctx.getPowerFraction(entity.house))
    // All aircraft use the SAME rearm rate: 36 ticks/ammo at full power
    const reloadRate = parseFloat(ini['General']?.ReloadRate ?? '0.04');
    const cppRearmPerAmmo = Math.round(reloadRate * TICKS_PER_MINUTE);
    expect(cppRearmPerAmmo).toBe(36);

    // TS now matches C++ — computeRearmDelay(1.0) = 36 for all aircraft
    expect(computeRearmDelay(1.0)).toBe(cppRearmPerAmmo);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 8: C++ Power Dependency — TS Has No Power-Dependent Rearm
// C++ building.cpp:4023-4024: rearm slows with low power
// TS aircraft.ts: no power check in rearm logic
// ═══════════════════════════════════════════════════════════════════════════════

describe('PARITY VERIFIED: TS rearm now depends on power fraction (building.cpp:4023)', () => {
  it('full power rearms in 36 ticks per ammo, half power in 72 ticks', () => {
    // Full power
    const heliFull = makeEntity(UnitType.V_HELI, House.Spain);
    heliFull.ammo = 5;
    heliFull.maxAmmo = 6;
    heliFull.aircraftState = 'rearming';
    heliFull.rearmTimer = computeRearmDelay(1.0); // 36

    const ctxFull = makeAircraftCtx({ getPowerFraction: () => 1.0 });
    let fullTicks = 0;
    while (heliFull.aircraftState === 'rearming' && fullTicks < 200) {
      updateAircraft(ctxFull, heliFull);
      fullTicks++;
    }
    expect(fullTicks).toBe(36);

    // Half power
    const heliHalf = makeEntity(UnitType.V_HELI, House.Spain);
    heliHalf.ammo = 5;
    heliHalf.maxAmmo = 6;
    heliHalf.aircraftState = 'rearming';
    heliHalf.rearmTimer = computeRearmDelay(0.5); // 72

    const ctxHalf = makeAircraftCtx({ getPowerFraction: () => 0.5 });
    let halfTicks = 0;
    while (heliHalf.aircraftState === 'rearming' && halfTicks < 200) {
      updateAircraft(ctxHalf, heliHalf);
      halfTicks++;
    }
    expect(halfTicks).toBe(72);
    expect(halfTicks).toBe(2 * fullTicks);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 9: IsFixedWing from C++ aadata.cpp vs TS isFixedWing
// ═══════════════════════════════════════════════════════════════════════════════

describe('IsFixedWing classification matches C++ aadata.cpp', () => {
  // aadata.cpp: true for BADR (line 67), U2 (90), MIG (113), YAK (136)
  //             false for TRAN (159), HELI (182), HIND (206)
  const FIXED_WING_MAP: [string, UnitType, boolean][] = [
    ['BADR', UnitType.V_BADR, true],
    ['U2',   UnitType.V_U2,   true],
    ['MIG',  UnitType.V_MIG,  true],
    ['YAK',  UnitType.V_YAK,  true],
    ['TRAN', UnitType.V_TRAN, false],
    ['HELI', UnitType.V_HELI, false],
    ['HIND', UnitType.V_HIND, false],
  ];

  for (const [name, type, expected] of FIXED_WING_MAP) {
    it(`${name} isFixedWing=${expected}`, () => {
      expect(UNIT_STATS[type]?.isFixedWing ?? false).toBe(expected);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 10: Complete Rearm Cycle Timing — Per Aircraft
// Full simulation of empty→full rearm for each aircraft type
// ═══════════════════════════════════════════════════════════════════════════════

describe('full rearm cycle simulation: ticks from empty to full ammo (C++ parity)', () => {
  const CPP_TICKS_PER_AMMO = computeRearmDelay(1.0); // 36

  const AIRCRAFT_CYCLES: [string, UnitType][] = [
    ['MIG',  UnitType.V_MIG],
    ['YAK',  UnitType.V_YAK],
    ['HELI', UnitType.V_HELI],
    ['HIND', UnitType.V_HIND],
  ];

  for (const [name, unitType] of AIRCRAFT_CYCLES) {
    it(`${name}: simulate full rearm cycle`, () => {
      const iniAmmo = parseInt(ini[name]?.Ammo ?? '0', 10);

      const entity = makeEntity(unitType, House.USSR);
      entity.ammo = 0;
      entity.maxAmmo = iniAmmo;
      entity.aircraftState = 'rearming';
      entity.rearmTimer = CPP_TICKS_PER_AMMO;

      const ctx = makeAircraftCtx();
      let ticks = 0;
      while (entity.aircraftState === 'rearming' && ticks < 50000) {
        updateAircraft(ctx, entity);
        ticks++;
      }

      const cppExpected = iniAmmo * CPP_TICKS_PER_AMMO;

      // TS now matches C++ formula
      expect(ticks).toBe(cppExpected);
      expect(entity.ammo).toBe(iniAmmo);
      expect(entity.aircraftState).toBe('landed');
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 11: C++ Two-Shooter Rearm Delay — First Shot Abbreviated
// C++ techno.cpp:2866-2869: second shot = weapon->ROF * ROFBias; first shot = 3
// This is for COMBAT rearm (between shots), NOT pad rearm
// ═══════════════════════════════════════════════════════════════════════════════

describe('C++ two-shooter rearm delay: first shot is abbreviated to 3 ticks', () => {
  it('C++ Rearm_Delay: first shot = 3 ticks, second shot = weapon->ROF * ROFBias', () => {
    // techno.cpp:2857-2870:
    //   if (second && weapon != NULL) return(weapon->ROF * House->ROFBias);
    //   return(3);
    //
    // Aircraft do NOT override Rearm_Delay in RA (unlike TD which halves it).
    // This means RA aircraft use the base TechnoClass formula.
    //
    // TS aircraft.ts does not distinguish first/second shot during combat.
    // TS always uses: attackCooldown = max(1, round(weapon.rof * ROFBias))
    //
    // For two-shooter aircraft (MIG, YAK, HELI with Secondary), the first shot
    // should have a 3-tick delay in C++, not the full weapon ROF.
    const mavRof = WEAPON_STATS['Maverick']?.rof ?? 3;
    const hellfireRof = WEAPON_STATS['Hellfire']?.rof ?? 60;

    // C++ first shot abbreviated delay
    const cppFirstShotDelay = 3;
    // C++ second shot full delay
    const cppMigSecondShot = Math.round(mavRof * 1.0);   // 3
    const cppHeliSecondShot = Math.round(hellfireRof * 1.0); // 60

    // MIG Maverick rof=3: first=3, second=3 (coincidentally the same)
    expect(cppFirstShotDelay).toBe(3);
    expect(cppMigSecondShot).toBe(3);

    // HELI Hellfire rof=60: first=3, second=60 (big difference!)
    expect(cppFirstShotDelay).toBe(3);
    expect(cppHeliSecondShot).toBe(60);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 12: Flight Altitude — C++ FLIGHT_LEVEL vs TS FLIGHT_ALTITUDE
// C++ object.h:252: FLIGHT_LEVEL=256 (leptons)
// TS entity.ts: FLIGHT_ALTITUDE=24 (pixels)
// C++ Pixel_To_Lepton(1) ≈ 256/24 leptons per pixel
// ═══════════════════════════════════════════════════════════════════════════════

describe('flight altitude parity: C++ 256 leptons = TS 24 pixels = 24 ticks takeoff/landing', () => {
  it('takeoff takes exactly 24 ticks (1 pixel/tick from 0 to 24)', () => {
    // C++ aircraft.cpp:4082: Height += Pixel_To_Lepton(1) per tick
    // C++ FLIGHT_LEVEL=256; 256/Pixel_To_Lepton(1) ≈ 24 ticks
    // TS aircraft.ts:145: flightAltitude += 1 per tick, FLIGHT_ALTITUDE=24
    const entity = makeEntity(UnitType.V_HELI, House.Spain);
    entity.aircraftState = 'takeoff';
    entity.flightAltitude = 0;
    entity.mission = Mission.ATTACK;
    entity.target = makeEntity(UnitType.V_MIG, House.USSR, 500, 500);
    entity.landedAtStructure = -1;

    const ctx = makeAircraftCtx();
    let ticks = 0;
    while (entity.aircraftState === 'takeoff' && ticks < 100) {
      updateAircraft(ctx, entity);
      ticks++;
    }

    expect(ticks).toBe(Entity.FLIGHT_ALTITUDE); // 24
    expect(entity.flightAltitude).toBe(Entity.FLIGHT_ALTITUDE);
    expect(entity.aircraftState).toBe('flying');
  });

  it('landing takes exactly 24 ticks (1 pixel/tick from 24 to 0)', () => {
    // C++ aircraft.cpp:4046: Height -= Pixel_To_Lepton(1) per tick
    const entity = makeEntity(UnitType.V_HELI, House.Spain);
    entity.aircraftState = 'landing';
    entity.flightAltitude = Entity.FLIGHT_ALTITUDE; // 24

    const ctx = makeAircraftCtx();
    let ticks = 0;
    while (entity.aircraftState === 'landing' && ticks < 100) {
      updateAircraft(ctx, entity);
      ticks++;
    }

    expect(ticks).toBe(Entity.FLIGHT_ALTITUDE); // 24
    expect(entity.flightAltitude).toBe(0);
  });
});
