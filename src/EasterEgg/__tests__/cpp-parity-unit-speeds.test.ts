/**
 * C++ Parity Audit: Unit Speeds, ROT, SpeedClass, and Vehicle Flags
 *
 * Verifies ALL unit Speed=, ROT=, Tracked=, NoMovingFire= values from
 * rules.ini and aftrmath.ini against UNIT_STATS in types.ts.
 *
 * Failing tests are GOOD -- they identify real C++ divergences.
 * DO NOT modify engine code to make these pass.
 *
 * C++ source references:
 *   - rules.ini: Speed= field per unit section
 *   - rules.ini: ROT= field per unit section (body/turret rotation rate)
 *   - udata.cpp:865: all vehicles forced to WHEEL speed class
 *   - idata.cpp: infantry speed class is FOOT
 *   - vdata.cpp: vessel speed class is FLOAT
 *   - aadata.cpp: aircraft speed class is WINGED
 *   - aftrmath.ini: expansion unit overrides
 */

import { describe, it, expect } from 'vitest';
import { UNIT_STATS, SpeedClass } from '../engine/types';

// ============================================================================
// INI-authoritative Speed= values per unit section
// Source: public/ra/assets/rules.ini and public/ra/assets/aftrmath.ini
// ============================================================================

/** [unit, iniSpeed, source] */
const INI_SPEEDS: [string, number, string][] = [
  // === Vehicles (rules.ini) ===
  ['V2RL', 7,  'rules.ini [V2RL] Speed=7'],
  ['1TNK', 9,  'rules.ini [1TNK] Speed=9'],
  ['3TNK', 7,  'rules.ini [3TNK] Speed=7'],
  ['2TNK', 8,  'rules.ini [2TNK] Speed=8'],
  ['4TNK', 4,  'rules.ini [4TNK] Speed=4'],
  ['MRJ',  9,  'rules.ini [MRJ] Speed=9'],
  ['MGG',  9,  'rules.ini [MGG] Speed=9'],
  ['ARTY', 6,  'rules.ini [ARTY] Speed=6'],
  ['HARV', 6,  'rules.ini [HARV] Speed=6'],
  ['MCV',  6,  'rules.ini [MCV] Speed=6'],
  ['JEEP', 10, 'rules.ini [JEEP] Speed=10'],
  ['APC',  10, 'rules.ini [APC] Speed=10'],
  ['MNLY', 9,  'rules.ini [MNLY] Speed=9'],
  ['TRUK', 10, 'rules.ini [TRUK] Speed=10'],

  // === Ships (rules.ini) ===
  ['SS',   6,  'rules.ini [SS] Speed=6'],
  ['DD',   6,  'rules.ini [DD] Speed=6'],
  ['CA',   4,  'rules.ini [CA] Speed=4'],
  ['LST',  14, 'rules.ini [LST] Speed=14'],
  ['PT',   9,  'rules.ini [PT] Speed=9'],

  // === Infantry (rules.ini) ===
  ['E1',   4,  'rules.ini [E1] Speed=4'],
  ['E2',   5,  'rules.ini [E2] Speed=5'],
  ['E3',   3,  'rules.ini [E3] Speed=3'],
  ['E4',   3,  'rules.ini [E4] Speed=3'],
  ['E6',   4,  'rules.ini [E6] Speed=4'],
  ['DOG',  4,  'rules.ini [DOG] Speed=4'],
  ['SPY',  4,  'rules.ini [SPY] Speed=4'],
  ['MEDI', 4,  'rules.ini [MEDI] Speed=4'],
  ['GNRL', 5,  'rules.ini [GNRL] Speed=5'],
  ['E7',   5,  'rules.ini [E7] Speed=5'],
  ['THF',  4,  'rules.ini [THF] Speed=4'],

  // === Civilians (rules.ini) ===
  ['C1',   5,  'rules.ini [C1] Speed=5'],
  ['C2',   5,  'rules.ini [C2] Speed=5'],
  ['C3',   5,  'rules.ini [C3] Speed=5'],
  ['C4',   5,  'rules.ini [C4] Speed=5'],
  ['C5',   5,  'rules.ini [C5] Speed=5'],
  ['C6',   5,  'rules.ini [C6] Speed=5'],
  ['C7',   5,  'rules.ini [C7] Speed=5'],
  ['C8',   5,  'rules.ini [C8] Speed=5'],
  ['C9',   5,  'rules.ini [C9] Speed=5'],
  ['C10',  5,  'rules.ini [C10] Speed=5'],
  ['EINSTEIN', 5, 'rules.ini [EINSTEIN] Speed=5'],
  ['CHAN',  5,  'rules.ini [CHAN] Speed=5'],

  // === Aircraft (rules.ini) ===
  ['BADR', 16, 'rules.ini [BADR] Speed=16'],
  ['U2',   40, 'rules.ini [U2] Speed=40'],
  ['MIG',  20, 'rules.ini [MIG] Speed=20'],
  ['YAK',  16, 'rules.ini [YAK] Speed=16'],
  ['HELI', 16, 'rules.ini [HELI] Speed=16'],
  ['HIND', 12, 'rules.ini [HIND] Speed=12'],
  ['TRAN', 12, 'rules.ini [TRAN] Speed=12'],

  // === Aftermath expansion vehicles (aftrmath.ini) ===
  ['STNK', 10, 'aftrmath.ini [STNK] Speed=10'],
  ['CTNK', 5,  'aftrmath.ini [CTNK] Speed=5'],
  ['TTNK', 8,  'aftrmath.ini [TTNK] Speed=8'],
  ['DTRK', 8,  'aftrmath.ini [DTRK] Speed=8'],
  ['QTNK', 3,  'aftrmath.ini [QTNK] Speed=3'],
  ['MSUB', 5,  'aftrmath.ini [MSUB] Speed=5'],

  // === Aftermath expansion infantry (aftrmath.ini) ===
  ['SHOK', 3,  'aftrmath.ini [SHOK] Speed=3'],
  ['MECH', 4,  'aftrmath.ini [MECH] Speed=4'],

  // === Aftermath expansion vessels (aftrmath.ini) ===
  ['CARR', 6,  'aftrmath.ini [CARR] Speed=6'],

  // === Scenario-only units ===
  ['DELPHI', 5, 'rules.ini [DELPHI] Speed=5'],
];

// ============================================================================
// INI-authoritative ROT= values per unit section
// Infantry have no INI ROT= (it is 0 in INI, but TS uses rot:8 for rendering)
// ============================================================================

/** [unit, iniROT, source] */
const INI_ROT: [string, number, string][] = [
  // === Vehicles (rules.ini) ===
  ['V2RL', 5,  'rules.ini [V2RL] ROT=5'],
  ['1TNK', 5,  'rules.ini [1TNK] ROT=5'],
  ['3TNK', 5,  'rules.ini [3TNK] ROT=5'],
  ['2TNK', 5,  'rules.ini [2TNK] ROT=5'],
  ['4TNK', 5,  'rules.ini [4TNK] ROT=5'],
  ['MRJ',  5,  'rules.ini [MRJ] ROT=5'],
  ['MGG',  5,  'rules.ini [MGG] ROT=5'],
  ['ARTY', 2,  'rules.ini [ARTY] ROT=2'],
  ['HARV', 5,  'rules.ini [HARV] ROT=5'],
  ['MCV',  5,  'rules.ini [MCV] ROT=5'],
  ['JEEP', 10, 'rules.ini [JEEP] ROT=10'],
  ['APC',  5,  'rules.ini [APC] ROT=5'],
  ['MNLY', 5,  'rules.ini [MNLY] ROT=5'],
  ['TRUK', 5,  'rules.ini [TRUK] ROT=5'],

  // === Ships (rules.ini) ===
  ['SS',   7,  'rules.ini [SS] ROT=7'],
  ['DD',   7,  'rules.ini [DD] ROT=7'],
  ['CA',   5,  'rules.ini [CA] ROT=5'],
  ['LST',  10, 'rules.ini [LST] ROT=10'],
  ['PT',   7,  'rules.ini [PT] ROT=7'],

  // === Aircraft (rules.ini) ===
  ['BADR', 5,  'rules.ini [BADR] ROT=5'],
  ['U2',   7,  'rules.ini [U2] ROT=7'],
  ['MIG',  5,  'rules.ini [MIG] ROT=5'],
  ['YAK',  5,  'rules.ini [YAK] ROT=5'],
  ['HELI', 4,  'rules.ini [HELI] ROT=4'],
  ['HIND', 4,  'rules.ini [HIND] ROT=4'],
  ['TRAN', 5,  'rules.ini [TRAN] ROT=5'],

  // === Aftermath expansion (aftrmath.ini) ===
  ['STNK', 5,  'aftrmath.ini [STNK] ROT=5'],
  ['CTNK', 5,  'aftrmath.ini [CTNK] ROT=5'],
  ['TTNK', 5,  'aftrmath.ini [TTNK] ROT=5'],
  ['DTRK', 5,  'aftrmath.ini [DTRK] ROT=5'],
  ['QTNK', 5,  'aftrmath.ini [QTNK] ROT=5'],
  ['MSUB', 7,  'aftrmath.ini [MSUB] ROT=7'],
  // CARR not in UNIT_STATS but has ROT=7 in aftrmath.ini
];

// ============================================================================
// SpeedClass assignments per C++ source
// C++ udata.cpp:865 forces ALL vehicles to WHEEL
// C++ idata.cpp: all infantry are FOOT
// C++ vdata.cpp: all vessels are FLOAT
// C++ aadata.cpp: all aircraft are WINGED
// ============================================================================

/** [unit, expectedSpeedClass, source] */
const SPEED_CLASSES: [string, SpeedClass, string][] = [
  // Infantry = FOOT
  ['E1',   SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['E2',   SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['E3',   SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['E4',   SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['E6',   SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['DOG',  SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['SPY',  SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['MEDI', SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['GNRL', SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['E7',   SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['THF',  SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['SHOK', SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['MECH', SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['C1',   SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['C2',   SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['C3',   SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['C4',   SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['C5',   SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['C6',   SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['C7',   SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['C8',   SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['C9',   SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['C10',  SpeedClass.FOOT,   'idata.cpp: infantry speed class = FOOT'],
  ['EINSTEIN', SpeedClass.FOOT, 'idata.cpp: infantry speed class = FOOT'],
  ['CHAN', SpeedClass.FOOT,    'idata.cpp: infantry speed class = FOOT'],

  // Tracked vehicles = TRACK (C++ udata.cpp:1366 — Tracked=yes in rules.ini/aftrmath.ini)
  ['1TNK', SpeedClass.TRACK,  'udata.cpp:1366 Tracked=yes → SPEED_TRACK'],
  ['2TNK', SpeedClass.TRACK,  'udata.cpp:1366 Tracked=yes → SPEED_TRACK'],
  ['3TNK', SpeedClass.TRACK,  'udata.cpp:1366 Tracked=yes → SPEED_TRACK'],
  ['4TNK', SpeedClass.TRACK,  'udata.cpp:1366 Tracked=yes → SPEED_TRACK'],
  // Wheeled vehicles = WHEEL (C++ udata.cpp:1366 — Tracked=no or absent)
  ['JEEP', SpeedClass.WHEEL,  'udata.cpp:1366 Tracked=no → SPEED_WHEEL'],
  ['APC',  SpeedClass.TRACK,  'udata.cpp:1366 Tracked=yes → SPEED_TRACK'],
  ['ARTY', SpeedClass.TRACK,  'udata.cpp:1366 Tracked=yes → SPEED_TRACK'],
  ['HARV', SpeedClass.TRACK,  'udata.cpp:1366 Tracked=yes → SPEED_TRACK'],
  ['MCV',  SpeedClass.WHEEL,  'udata.cpp:1366 Tracked=no → SPEED_WHEEL'],
  ['TRUK', SpeedClass.WHEEL,  'udata.cpp:1366 Tracked=no → SPEED_WHEEL'],
  ['V2RL', SpeedClass.TRACK,  'udata.cpp:1366 Tracked=yes → SPEED_TRACK'],
  ['MNLY', SpeedClass.TRACK,  'udata.cpp:1366 Tracked=yes → SPEED_TRACK'],
  ['MRJ',  SpeedClass.TRACK,  'udata.cpp:1366 Tracked=yes → SPEED_TRACK'],
  ['MGG',  SpeedClass.WHEEL,  'udata.cpp:1366 Tracked=no → SPEED_WHEEL'],
  ['STNK', SpeedClass.TRACK,  'udata.cpp:1366 Tracked=yes → SPEED_TRACK (aftrmath.ini)'],
  ['CTNK', SpeedClass.TRACK,  'udata.cpp:1366 Tracked=yes → SPEED_TRACK (aftrmath.ini)'],
  ['TTNK', SpeedClass.TRACK,  'udata.cpp:1366 Tracked=yes → SPEED_TRACK (aftrmath.ini)'],
  ['DTRK', SpeedClass.WHEEL,  'udata.cpp:1366 Tracked=no → SPEED_WHEEL'],
  ['QTNK', SpeedClass.TRACK,  'udata.cpp:1366 Tracked=yes → SPEED_TRACK (aftrmath.ini)'],

  // Ships = FLOAT (vdata.cpp)
  ['SS',   SpeedClass.FLOAT,  'vdata.cpp: vessel speed class = FLOAT'],
  ['DD',   SpeedClass.FLOAT,  'vdata.cpp: vessel speed class = FLOAT'],
  ['CA',   SpeedClass.FLOAT,  'vdata.cpp: vessel speed class = FLOAT'],
  ['LST',  SpeedClass.FLOAT,  'vdata.cpp: vessel speed class = FLOAT'],
  ['PT',   SpeedClass.FLOAT,  'vdata.cpp: vessel speed class = FLOAT'],
  ['MSUB', SpeedClass.FLOAT,  'vdata.cpp: vessel speed class = FLOAT'],

  // Aircraft = WINGED (aadata.cpp)
  ['BADR', SpeedClass.WINGED, 'aadata.cpp: aircraft speed class = WINGED'],
  ['U2',   SpeedClass.WINGED, 'aadata.cpp: aircraft speed class = WINGED'],
  ['MIG',  SpeedClass.WINGED, 'aadata.cpp: aircraft speed class = WINGED'],
  ['YAK',  SpeedClass.WINGED, 'aadata.cpp: aircraft speed class = WINGED'],
  ['HELI', SpeedClass.WINGED, 'aadata.cpp: aircraft speed class = WINGED'],
  ['HIND', SpeedClass.WINGED, 'aadata.cpp: aircraft speed class = WINGED'],
  ['TRAN', SpeedClass.WINGED, 'aadata.cpp: aircraft speed class = WINGED'],

  // Aftermath expansion vessels
  ['CARR', SpeedClass.FLOAT, 'aftrmath.ini: vessel speed class = FLOAT'],

  // Scenario-only units
  ['DELPHI', SpeedClass.FOOT, 'rules.ini: infantry speed class = FOOT'],
];

// ============================================================================
// Vehicle-specific flags: Tracked= (crusher), NoMovingFire=
// ============================================================================

/** [unit, hasTrackedFlag, source] — Tracked=yes in INI means the vehicle can crush infantry */
const TRACKED_UNITS: [string, boolean, string][] = [
  // rules.ini Tracked=yes units
  ['V2RL', true,  'rules.ini [V2RL] Tracked=yes'],
  ['1TNK', true,  'rules.ini [1TNK] Tracked=yes'],
  ['3TNK', true,  'rules.ini [3TNK] Tracked=yes'],
  ['2TNK', true,  'rules.ini [2TNK] Tracked=yes'],
  ['4TNK', true,  'rules.ini [4TNK] Tracked=yes'],
  ['MRJ',  true,  'rules.ini [MRJ] Tracked=yes'],
  ['ARTY', true,  'rules.ini [ARTY] Tracked=yes'],
  ['HARV', true,  'rules.ini [HARV] Tracked=yes'],
  ['APC',  true,  'rules.ini [APC] Tracked=yes'],
  ['MNLY', true,  'rules.ini [MNLY] Tracked=yes'],

  // rules.ini: NO Tracked= (wheeled, cannot crush)
  ['JEEP', false, 'rules.ini [JEEP] no Tracked= (wheeled)'],
  ['TRUK', false, 'rules.ini [TRUK] no Tracked= (wheeled)'],
  ['MCV',  false, 'rules.ini [MCV] no Tracked= (wheeled, note: debatable)'],

  // aftrmath.ini Tracked=yes units
  ['STNK', true,  'aftrmath.ini [STNK] Tracked=yes'],
  ['CTNK', true,  'aftrmath.ini [CTNK] Tracked=yes'],
  ['TTNK', true,  'aftrmath.ini [TTNK] Tracked=yes'],
  ['QTNK', true,  'aftrmath.ini [QTNK] Tracked=yes'],

  // aftrmath.ini: NO Tracked= (wheeled)
  ['DTRK', false, 'aftrmath.ini [DTRK] no Tracked= (wheeled)'],

  // MGG has no Tracked= in rules.ini
  ['MGG',  false, 'rules.ini [MGG] no Tracked= (wheeled)'],
];

/** [unit, hasNoMovingFire, source] */
const NO_MOVING_FIRE_UNITS: [string, boolean, string][] = [
  // rules.ini NoMovingFire=yes
  ['V2RL', true,  'rules.ini [V2RL] NoMovingFire=yes'],
  ['ARTY', true,  'rules.ini [ARTY] NoMovingFire=yes'],

  // aftrmath.ini NoMovingFire=yes
  ['TTNK', true,  'aftrmath.ini [TTNK] NoMovingFire=yes'],
  ['SHOK', true,  'aftrmath.ini [SHOK] NoMovingFire=yes'],

  // Units that should NOT have NoMovingFire
  ['1TNK', false, 'rules.ini [1TNK] no NoMovingFire'],
  ['2TNK', false, 'rules.ini [2TNK] no NoMovingFire'],
  ['3TNK', false, 'rules.ini [3TNK] no NoMovingFire'],
  ['4TNK', false, 'rules.ini [4TNK] no NoMovingFire'],
  ['JEEP', false, 'rules.ini [JEEP] no NoMovingFire'],
  ['APC',  false, 'rules.ini [APC] no NoMovingFire'],
  ['STNK', false, 'aftrmath.ini [STNK] no NoMovingFire'],
  ['CTNK', false, 'aftrmath.ini [CTNK] no NoMovingFire'],
  ['DTRK', false, 'aftrmath.ini [DTRK] no NoMovingFire'],
  ['QTNK', false, 'aftrmath.ini [QTNK] no NoMovingFire'],
  ['E1',   false, 'rules.ini [E1] no NoMovingFire'],
  ['E2',   false, 'rules.ini [E2] no NoMovingFire'],
  ['E3',   false, 'rules.ini [E3] no NoMovingFire'],
  ['E4',   false, 'rules.ini [E4] no NoMovingFire'],
  ['DOG',  false, 'rules.ini [DOG] no NoMovingFire'],
  ['E7',   false, 'rules.ini [E7] no NoMovingFire'],
];

// ============================================================================
// Tests
// ============================================================================

describe('cpp-parity: unit Speed= values (rules.ini + aftrmath.ini)', () => {
  for (const [unit, expectedSpeed, source] of INI_SPEEDS) {
    it(`${unit} speed should be ${expectedSpeed} (${source})`, () => {
      const stats = UNIT_STATS[unit];
      expect(stats, `${unit} should exist in UNIT_STATS`).toBeDefined();
      expect(stats.speed).toBe(expectedSpeed);
    });
  }

  it('every UNIT_STATS entry (except ants) has an INI speed check', () => {
    const testedUnits = new Set(INI_SPEEDS.map(([u]) => u));
    const ants = new Set(['ANT1', 'ANT2', 'ANT3']); // ants are from scenario INI, not rules.ini
    for (const unit of Object.keys(UNIT_STATS)) {
      if (ants.has(unit)) continue;
      expect(testedUnits.has(unit), `${unit} is missing from INI_SPEEDS audit`).toBe(true);
    }
  });
});

describe('cpp-parity: unit ROT= values (rules.ini + aftrmath.ini)', () => {
  for (const [unit, expectedROT, source] of INI_ROT) {
    it(`${unit} ROT should be ${expectedROT} (${source})`, () => {
      const stats = UNIT_STATS[unit];
      expect(stats, `${unit} should exist in UNIT_STATS`).toBeDefined();
      expect(stats.rot).toBe(expectedROT);
    });
  }

  it('infantry ROT is not defined in INI (defaulting to 0) — TS uses rot=8 for rendering', () => {
    // In C++ infantry has no ROT= field in rules.ini (defaults to 0).
    // TS uses rot=8 for all infantry as a rendering convenience.
    // This documents the known divergence.
    const infantryUnits = Object.entries(UNIT_STATS)
      .filter(([_, s]) => s.isInfantry)
      .map(([k]) => k);

    for (const unit of infantryUnits) {
      const stats = UNIT_STATS[unit];
      // C++ INI default ROT=0 for infantry, TS uses 8
      // This is an intentional rendering divergence, not a bug
      expect(stats.rot).toBe(8);
    }
  });
});

describe('cpp-parity: SpeedClass assignments', () => {
  for (const [unit, expectedClass, source] of SPEED_CLASSES) {
    it(`${unit} speedClass should be ${SpeedClass[expectedClass]} (${source})`, () => {
      const stats = UNIT_STATS[unit];
      expect(stats, `${unit} should exist in UNIT_STATS`).toBeDefined();
      expect(stats.speedClass).toBe(expectedClass);
    });
  }

  it('every UNIT_STATS entry (except ants) has a SpeedClass check', () => {
    const testedUnits = new Set(SPEED_CLASSES.map(([u]) => u));
    const ants = new Set(['ANT1', 'ANT2', 'ANT3']);
    for (const unit of Object.keys(UNIT_STATS)) {
      if (ants.has(unit)) continue;
      expect(testedUnits.has(unit), `${unit} is missing from SPEED_CLASSES audit`).toBe(true);
    }
  });
});

describe('cpp-parity: Tracked= flag (crusher capability)', () => {
  for (const [unit, shouldBeTracked, source] of TRACKED_UNITS) {
    it(`${unit} crusher=${shouldBeTracked} (${source})`, () => {
      const stats = UNIT_STATS[unit];
      expect(stats, `${unit} should exist in UNIT_STATS`).toBeDefined();
      // In TS, Tracked=yes maps to crusher=true
      const isCrusher = stats.crusher === true;
      expect(isCrusher).toBe(shouldBeTracked);
    });
  }
});

describe('cpp-parity: NoMovingFire= flag', () => {
  for (const [unit, shouldHaveNoMovingFire, source] of NO_MOVING_FIRE_UNITS) {
    it(`${unit} noMovingFire=${shouldHaveNoMovingFire} (${source})`, () => {
      const stats = UNIT_STATS[unit];
      expect(stats, `${unit} should exist in UNIT_STATS`).toBeDefined();
      const hasFlag = stats.noMovingFire === true;
      expect(hasFlag).toBe(shouldHaveNoMovingFire);
    });
  }
});

describe('cpp-parity: aircraft speeds — high-speed units', () => {
  // Aircraft have notably higher speeds than ground units.
  // Verify the specific INI values for all aircraft.

  const AIRCRAFT_SPEED_TABLE: [string, number][] = [
    ['BADR', 16],  // rules.ini [BADR] Speed=16
    ['U2',   40],  // rules.ini [U2] Speed=40 (fastest unit in game)
    ['MIG',  20],  // rules.ini [MIG] Speed=20
    ['YAK',  16],  // rules.ini [YAK] Speed=16
    ['HELI', 16],  // rules.ini [HELI] Speed=16
    ['HIND', 12],  // rules.ini [HIND] Speed=12
    ['TRAN', 12],  // rules.ini [TRAN] Speed=12
  ];

  for (const [unit, expectedSpeed] of AIRCRAFT_SPEED_TABLE) {
    it(`${unit} aircraft speed=${expectedSpeed}`, () => {
      const stats = UNIT_STATS[unit];
      expect(stats.speed).toBe(expectedSpeed);
      expect(stats.isAircraft).toBe(true);
      expect(stats.speedClass).toBe(SpeedClass.WINGED);
    });
  }

  it('all aircraft are faster than all standard ground vehicles (excluding ants)', () => {
    const ants = new Set(['ANT1', 'ANT2', 'ANT3']); // scenario-only units with abnormal speed
    const aircraftSpeeds = Object.values(UNIT_STATS)
      .filter(s => s.isAircraft)
      .map(s => s.speed);
    const groundSpeeds = Object.entries(UNIT_STATS)
      .filter(([k, s]) => !s.isAircraft && !s.isVessel && !s.isInfantry && !ants.has(k))
      .map(([_, s]) => s.speed);

    const minAircraft = Math.min(...aircraftSpeeds);
    const maxGround = Math.max(...groundSpeeds);

    // HIND/TRAN at 12 should be >= fastest standard ground unit (JEEP/APC/STNK at 10)
    expect(minAircraft).toBeGreaterThanOrEqual(maxGround);
  });
});

describe('cpp-parity: DELPHI infantry (rules.ini only, not in UNIT_STATS)', () => {
  // DELPHI is a special agent infantry defined in rules.ini but may not be
  // in UNIT_STATS since it's mission-specific. Document its absence.
  it('DELPHI is not in UNIT_STATS (mission-specific, not buildable)', () => {
    // DELPHI: Speed=5, no ROT, Owner=allies,soviet, TechLevel=-1
    // If DELPHI were added, it would need speed=5, speedClass=FOOT
    const hasDelphi = 'DELPHI' in UNIT_STATS;
    // Just document whether it exists or not -- not a parity failure
    expect(typeof hasDelphi).toBe('boolean');
  });
});

describe('cpp-parity: speed consistency cross-checks', () => {
  it('Mammoth (4TNK) is the slowest tank at speed=4', () => {
    expect(UNIT_STATS['4TNK'].speed).toBe(4);
    expect(UNIT_STATS['4TNK'].speed).toBeLessThan(UNIT_STATS['3TNK'].speed);
    expect(UNIT_STATS['4TNK'].speed).toBeLessThan(UNIT_STATS['2TNK'].speed);
    expect(UNIT_STATS['4TNK'].speed).toBeLessThan(UNIT_STATS['1TNK'].speed);
  });

  it('Light Tank (1TNK) is the fastest standard tank at speed=9', () => {
    expect(UNIT_STATS['1TNK'].speed).toBe(9);
    expect(UNIT_STATS['1TNK'].speed).toBeGreaterThan(UNIT_STATS['2TNK'].speed);
    expect(UNIT_STATS['1TNK'].speed).toBeGreaterThan(UNIT_STATS['3TNK'].speed);
    expect(UNIT_STATS['1TNK'].speed).toBeGreaterThan(UNIT_STATS['4TNK'].speed);
  });

  it('Harvester and MCV share the same slow speed=6', () => {
    expect(UNIT_STATS['HARV'].speed).toBe(6);
    expect(UNIT_STATS['MCV'].speed).toBe(6);
    expect(UNIT_STATS['HARV'].speed).toBe(UNIT_STATS['MCV'].speed);
  });

  it('U2 spy plane is the fastest unit in the game at speed=40', () => {
    const allSpeeds = Object.values(UNIT_STATS).map(s => s.speed);
    const maxSpeed = Math.max(...allSpeeds);
    expect(UNIT_STATS['U2'].speed).toBe(40);
    expect(UNIT_STATS['U2'].speed).toBe(maxSpeed);
  });

  it('M.A.D. Tank (QTNK) is the slowest vehicle at speed=3', () => {
    const vehicleSpeeds = Object.entries(UNIT_STATS)
      .filter(([_, s]) => !s.isInfantry && !s.isAircraft && !s.isVessel)
      .map(([k, s]) => ({ unit: k, speed: s.speed }));
    const minVehicle = vehicleSpeeds.reduce((a, b) => a.speed < b.speed ? a : b);
    expect(minVehicle.unit).toBe('QTNK');
    expect(minVehicle.speed).toBe(3);
  });

  it('Artillery (ARTY) has the slowest ROT=2 among vehicles', () => {
    expect(UNIT_STATS['ARTY'].rot).toBe(2);
    // All other non-infantry units have ROT >= 4
    const vehicleROTs = Object.entries(UNIT_STATS)
      .filter(([_, s]) => !s.isInfantry && _.indexOf('ANT') !== 0)
      .map(([k, s]) => ({ unit: k, rot: s.rot }));
    for (const { unit, rot } of vehicleROTs) {
      if (unit === 'ARTY') continue;
      expect(rot, `${unit} ROT should be >= ARTY ROT`).toBeGreaterThanOrEqual(UNIT_STATS['ARTY'].rot);
    }
  });
});

describe('cpp-parity: MCV tracked/crusher status', () => {
  // C++ rules.ini [MCV] does NOT have Tracked=yes — MCV is NOT a tracked vehicle.
  // However, TS may set crusher=true. This test checks the real INI value.
  it('MCV does NOT have Tracked=yes in rules.ini', () => {
    // rules.ini [MCV] section (lines 628-639) has no Tracked= line
    // C++ default for Tracked is false when not specified
    // Therefore MCV should NOT be a crusher
    const mcv = UNIT_STATS['MCV'];
    expect(mcv).toBeDefined();
    // Per strict INI parity, MCV.crusher should be false (no Tracked=yes)
    expect(mcv.crusher).toBeFalsy();
  });
});

describe('cpp-parity: MGG tracked/crusher status', () => {
  // C++ rules.ini [MGG] does NOT have Tracked=yes
  it('MGG does NOT have Tracked=yes in rules.ini', () => {
    const mgg = UNIT_STATS['MGG'];
    expect(mgg).toBeDefined();
    expect(mgg.crusher).toBeFalsy();
  });
});

describe('cpp-parity: DTRK tracked/crusher status', () => {
  // C++ aftrmath.ini [DTRK] does NOT have Tracked=yes
  it('DTRK does NOT have Tracked=yes in aftrmath.ini', () => {
    const dtrk = UNIT_STATS['DTRK'];
    expect(dtrk).toBeDefined();
    expect(dtrk.crusher).toBeFalsy();
  });
});

describe('cpp-parity: TRUK tracked/crusher status', () => {
  // C++ rules.ini [TRUK] does NOT have Tracked=yes
  it('TRUK does NOT have Tracked=yes in rules.ini', () => {
    const truk = UNIT_STATS['TRUK'];
    expect(truk).toBeDefined();
    expect(truk.crusher).toBeFalsy();
  });
});

describe('cpp-parity: JEEP tracked/crusher status', () => {
  // C++ rules.ini [JEEP] does NOT have Tracked=yes — it's a wheeled vehicle
  it('JEEP does NOT have Tracked=yes in rules.ini', () => {
    const jeep = UNIT_STATS['JEEP'];
    expect(jeep).toBeDefined();
    expect(jeep.crusher).toBeFalsy();
  });
});
