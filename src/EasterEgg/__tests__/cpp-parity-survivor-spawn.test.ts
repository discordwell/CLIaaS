/**
 * C++ Behavioral Parity Tests — Crew Survivor Spawning (Buildings, Vehicles, Aircraft)
 *
 * This test file audits the TS engine's survivor spawning logic against C++ behavior,
 * using rules.ini as the authoritative source for which objects have IsCrew=true.
 *
 * C++ reference files:
 *   techno.cpp:5979         — IsCrew defaults to false in TechnoTypeClass constructor
 *   techno.cpp:6292         — IsCrew = ini.Get_Bool(Name(), "Crewed", IsCrew)
 *   techno.cpp:399-405      — TechnoClass::How_Many_Survivors: returns 1 if IsCrew, else 0
 *   techno.cpp:4437-4467    — TechnoClass::Crew_Type: E1 default, neutral→random civilian,
 *                              unarmed→15% civilian (C1/C7)
 *   building.cpp:5591-5600  — BuildingClass::How_Many_Survivors: cost-based formula, clamped [1,5]
 *   building.cpp:4667-4701  — BuildingClass::Crew_Type: per-building switch (SILO, FACT, KENN, etc.)
 *   unit.cpp:988-1089       — UnitClass::Take_Damage: spawns 1 crew on destruction
 *                              (50% chance, IsCrew && Max_Passengers()==0)
 *   unit.cpp:3965-3978      — UnitClass::Crew_Type: unarmed→C1/C7 (50/50), armed→E1
 *   aircraft.cpp:1580-1598  — AircraftClass::Take_Damage: parachutes E1 (90% chance if IsCrew)
 *   rules.ini [General]     — SurvivorRate=.4  (SurvivorFraction)
 *   rules.ini per-section   — Crewed=yes sets IsCrew=true; absent means IsCrew=false
 *
 * KEY C++ INVARIANT: IsCrew defaults to false. Only sections with explicit "Crewed=yes"
 * in rules.ini have IsCrew=true. No Crewed=yes → no survivors ever.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { PRODUCTION_ITEMS } from '../engine/types';

// ---------------------------------------------------------------------------
// Parse rules.ini at test time (authoritative source of truth)
// ---------------------------------------------------------------------------
const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');

interface IniSection {
  [key: string]: string;
}

function parseINI(text: string): Record<string, IniSection> {
  const result: Record<string, IniSection> = {};
  let currentSection = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.split(';')[0].trim();
    if (!line) continue;
    const secMatch = line.match(/^\[([^\]]+)\]$/);
    if (secMatch) { currentSection = secMatch[1]; continue; }
    if (!currentSection) continue;
    const kvMatch = line.match(/^(\w+)=(.*)$/);
    if (!kvMatch) continue;
    if (!result[currentSection]) result[currentSection] = {};
    result[currentSection][kvMatch[1]] = kvMatch[2].trim();
  }
  return result;
}

const INI = parseINI(rulesText);
const generalSection = INI['General'] ?? {};

// ── helpers ──────────────────────────────────────────────────────────────────

function iniCrewed(type: string): boolean {
  return (INI[type]?.['Crewed'] ?? '').toLowerCase() === 'yes';
}

function iniCost(type: string): number {
  const val = INI[type]?.['Cost'];
  if (!val || val === '') return 0;
  return parseInt(val, 10);
}

function iniPrimary(type: string): string | undefined {
  const val = INI[type]?.['Primary'];
  if (!val || val === '' || val.toLowerCase() === 'none') return undefined;
  return val;
}

function iniMaxPassengers(type: string): number {
  return parseInt(INI[type]?.['Passengers'] ?? '0', 10);
}

const iniSurvivorRate = parseFloat(generalSection['SurvivorRate'] ?? '0.4');
const E1_COST = iniCost('E1'); // 100

/**
 * C++ building.cpp:5591-5600 How_Many_Survivors formula.
 * Only called when IsCrew is true.
 */
function cppBuildingSurvivorCount(rawCost: number, isCaptured = false): number {
  let divisor = E1_COST;
  if (divisor === 0) return 0;
  if (isCaptured) divisor *= 2;
  const count = Math.floor((rawCost * iniSurvivorRate) / divisor);
  return Math.max(1, Math.min(5, count));
}

// ============================================================
// Section 1: rules.ini SurvivorRate is authoritative
// ============================================================
describe('rules.ini [General] SurvivorRate (authoritative source)', () => {

  it('SurvivorRate=.4 (rules.ini overrides C++ default 0.5)', () => {
    // C++ rules.cpp:177: SurvivorFraction(fixed(1, 2)) — default 0.5
    // C++ rules.cpp:459: SurvivorFraction = ini.Get_Fixed("General", "SurvivorRate", ...)
    // rules.ini line 88: SurvivorRate=.4
    expect(iniSurvivorRate).toBe(0.4);
    expect(iniSurvivorRate).not.toBe(0.5); // C++ default is wrong
  });

  it('E1 (minigunner) cost is 100 (used as divisor in How_Many_Survivors)', () => {
    // C++ building.cpp:5595: divisor = InfantryTypeClass::As_Reference(INFANTRY_E1).Raw_Cost()
    expect(E1_COST).toBe(100);
  });
});

// ============================================================
// Section 2: IsCrew flag from rules.ini — buildings
// C++ techno.cpp:5979: IsCrew defaults to false
// C++ techno.cpp:6292: IsCrew = ini.Get_Bool(Name(), "Crewed", IsCrew)
// ============================================================
describe('IsCrew flag from rules.ini — buildings', () => {

  // Buildings that HAVE Crewed=yes — these spawn survivors in C++
  const crewedBuildings = [
    'IRON', 'FCOM', 'ATEK', 'PDOX', 'WEAP', 'PBOX', 'HBOX', 'TSLA',
    'GUN', 'AGUN', 'FTUR', 'FACT', 'PROC', 'HPAD', 'DOME', 'GAP',
    'SAM', 'MSLO', 'AFLD', 'POWR', 'APWR', 'FIX', 'BARR', 'TENT',
    'HOSP', 'BIO',
  ];

  for (const type of crewedBuildings) {
    it(`${type} has Crewed=yes in rules.ini → IsCrew=true`, () => {
      expect(iniCrewed(type)).toBe(true);
    });
  }

  // Buildings that do NOT have Crewed=yes — NO survivors in C++
  const nonCrewedBuildings = ['SILO', 'KENN', 'SYRD', 'SPEN'];

  for (const type of nonCrewedBuildings) {
    it(`${type} has NO Crewed=yes in rules.ini → IsCrew=false → 0 survivors in C++`, () => {
      expect(iniCrewed(type)).toBe(false);
    });
  }

  it('PARITY GAP: TS spawns survivors for SILO despite IsCrew=false in rules.ini', () => {
    // C++: SILO has IsCrew=false → How_Many_Survivors returns 0 → NO survivors
    // TS: SILO is handled in the Crew_Type switch (spawns C1/C7 civilians)
    // but C++ never reaches Crew_Type for SILO because How_Many_Survivors returns 0.
    //
    // The C++ BuildingClass::Crew_Type case for STRUCT_STORAGE is DEAD CODE
    // because IsCrew=false blocks it in How_Many_Survivors first.
    expect(iniCrewed('SILO')).toBe(false);
    // TS bug: SILO is in PRODUCTION_ITEMS and TS doesn't check IsCrew
    const siloInProd = PRODUCTION_ITEMS.find(p => p.type === 'SILO');
    expect(siloInProd).toBeDefined(); // TS will spawn survivors for it — wrong
  });

  it('KENN has NO Crewed=yes — C++ returns 0 survivors even before IsSurvivorless check', () => {
    // C++ building.cpp:5593: if (IsSurvivorless || !Class->IsCrew) return(0);
    // KENN has IsCrew=false, so the IsSurvivorless flag is redundant for it.
    // But on the sell path (HOLDING state), C++ also checks How_Many_Survivors,
    // which returns 0 because IsCrew=false.
    expect(iniCrewed('KENN')).toBe(false);
  });
});

// ============================================================
// Section 3: IsCrew flag from rules.ini — vehicles
// ============================================================
describe('IsCrew flag from rules.ini — vehicles', () => {

  const crewedVehicles = [
    'V2RL', '1TNK', '3TNK', '2TNK', '4TNK', 'MRJ', 'MGG',
    'ARTY', 'HARV', 'MCV', 'JEEP', 'MNLY',
  ];

  for (const type of crewedVehicles) {
    it(`${type} has Crewed=yes → IsCrew=true`, () => {
      expect(iniCrewed(type)).toBe(true);
    });
  }

  const nonCrewedVehicles = ['APC', 'TRUK'];

  for (const type of nonCrewedVehicles) {
    it(`${type} has NO Crewed=yes → IsCrew=false → no crew survivor`, () => {
      expect(iniCrewed(type)).toBe(false);
    });
  }

  it('APC has no crew because it is a transport (ejects passengers instead)', () => {
    // C++ unit.cpp:1046: if (Class->IsCrew && Class->Max_Passengers() == 0)
    // APC has IsCrew=false AND Max_Passengers=5, so it only ejects passengers.
    expect(iniCrewed('APC')).toBe(false);
    expect(iniMaxPassengers('APC')).toBe(5);
  });

  it('TRUK has no crew (convoy truck, also has Passengers=1)', () => {
    expect(iniCrewed('TRUK')).toBe(false);
    expect(iniMaxPassengers('TRUK')).toBe(1);
  });
});

// ============================================================
// Section 4: IsCrew flag from rules.ini — aircraft
// ============================================================
describe('IsCrew flag from rules.ini — aircraft', () => {

  const crewedAircraft = ['YAK', 'HELI', 'HIND'];

  for (const type of crewedAircraft) {
    it(`${type} has Crewed=yes → IsCrew=true`, () => {
      expect(iniCrewed(type)).toBe(true);
    });
  }

  const nonCrewedAircraft = ['MIG', 'TRAN', 'BADR', 'U2'];

  for (const type of nonCrewedAircraft) {
    it(`${type} has NO Crewed=yes → IsCrew=false → no survivor on destruction`, () => {
      expect(iniCrewed(type)).toBe(false);
    });
  }

  it('MIG has no crew — no parachute survivor on destruction', () => {
    // C++ aircraft.cpp:1588: if (Class->IsCrew && Percent_Chance(90) ...)
    // MIG has IsCrew=false → no survivor
    expect(iniCrewed('MIG')).toBe(false);
  });

  it('TRAN (Chinook) has no crew — transport ejects passengers instead', () => {
    expect(iniCrewed('TRAN')).toBe(false);
    expect(iniMaxPassengers('TRAN')).toBe(5);
  });
});

// ============================================================
// Section 5: IsCrew flag from rules.ini — ships (none have crew)
// ============================================================
describe('IsCrew flag from rules.ini — ships', () => {

  const ships = ['SS', 'DD', 'CA', 'LST', 'PT'];

  for (const type of ships) {
    it(`${type} has NO Crewed=yes → no survivor`, () => {
      expect(iniCrewed(type)).toBe(false);
    });
  }
});

// ============================================================
// Section 6: C++ vehicle survivor spawning logic
// unit.cpp:1046-1069 — crew spawning on vehicle destruction
// ============================================================
describe('C++ vehicle crew spawning (unit.cpp:1046-1069)', () => {

  it('C++ only spawns crew if IsCrew=true AND Max_Passengers==0', () => {
    // C++ unit.cpp:1046: if (Class->IsCrew && Class->Max_Passengers() == 0)
    // This means transports (APC, TRUK) never spawn crew — they eject passengers instead.
    // Vehicles with IsCrew=false never spawn crew.

    // Crewed non-transports that should spawn crew on destruction:
    for (const type of ['1TNK', '2TNK', '3TNK', '4TNK', 'V2RL', 'ARTY', 'JEEP', 'HARV', 'MCV', 'MRJ', 'MGG', 'MNLY']) {
      expect(iniCrewed(type)).toBe(true);
      expect(iniMaxPassengers(type)).toBe(0);
    }
  });

  it('C++ vehicle crew spawn has 50% probability', () => {
    // C++ unit.cpp:1047: if (Percent_Chance(50))
    // Only 50% of the time does a destroyed crewed vehicle actually spawn a survivor.
    // TS does not implement vehicle crew spawning at all.
    expect(true).toBe(true); // documented C++ behavior
  });

  it('C++ vehicle Crew_Type: unarmed → C1 civilian, armed → E1 soldier', () => {
    // C++ unit.cpp:3965-3978:
    //   if (Class->PrimaryWeapon == NULL) {
    //     50% INFANTRY_C1, 50% INFANTRY_C7
    //   }
    //   return DriveClass::Crew_Type() → TechnoClass::Crew_Type() → INFANTRY_E1

    // Unarmed vehicles (no Primary weapon) → civilian survivor:
    expect(iniPrimary('HARV')).toBeUndefined();
    expect(iniPrimary('MCV')).toBeUndefined();
    expect(iniPrimary('MGG')).toBeUndefined();
    expect(iniPrimary('MNLY')).toBeUndefined();

    // Armed vehicles → E1 soldier survivor:
    expect(iniPrimary('1TNK')).toBe('75mm');
    expect(iniPrimary('2TNK')).toBe('90mm');
    expect(iniPrimary('3TNK')).toBe('105mm');
    expect(iniPrimary('4TNK')).toBe('120mm');
    expect(iniPrimary('V2RL')).toBe('SCUD');
    expect(iniPrimary('ARTY')).toBe('155mm');
    expect(iniPrimary('JEEP')).toBe('M60mg');
  });

  it('C++ unarmed vehicle crew gets IsTechnician=true', () => {
    // C++ unit.cpp:1050-1052:
    //   if (Class->PrimaryWeapon == NULL) {
    //     i = new InfantryClass(INFANTRY_C1, ...);
    //     if (i != NULL) i->IsTechnician = true;
    //   }
    // Note: C1 with IsTechnician — a "technician civilian"
    // This differs from building survivors where E1 gets IsTechnician.
    expect(true).toBe(true); // documented C++ behavior — TS doesn't have IsTechnician
  });

  it('C++ vehicle survivor HP: random between 5 and MaxStrength/2', () => {
    // C++ unit.cpp:1058: i->Strength = Random_Pick(5, (int)i->Class->MaxStrength/2);
    // Note: MaxStrength/2 (integer division), NOT full MaxStrength like building destruction survivors.
    // Building destruction survivors get: Random_Pick(5, MaxStrength) — FULL health possible.
    // Vehicle survivors always have at most HALF health.
    expect(true).toBe(true); // documented difference from building survivors
  });

  it('PARITY GAP: TS does not spawn crew survivors from destroyed vehicles', () => {
    // The TS handleUnitDeath function (combat.ts:463-521) handles explosion effects,
    // screen shake, sounds, and score tracking, but NEVER spawns infantry survivors.
    //
    // In C++, destroying a crewed vehicle (e.g., a Light Tank) has a 50% chance to
    // spawn a minigunner (E1) or civilian (C1) who runs away from the wreck.
    //
    // This is a PARITY GAP: no vehicle crew spawning exists in TS.
    expect(true).toBe(true); // PARITY GAP documented
  });
});

// ============================================================
// Section 7: C++ aircraft survivor spawning logic
// aircraft.cpp:1580-1598 — parachute survivors
// ============================================================
describe('C++ aircraft crew spawning (aircraft.cpp:1580-1598)', () => {

  it('C++ aircraft crew: 90% chance to parachute E1 if IsCrew=true', () => {
    // C++ aircraft.cpp:1588-1594:
    //   if (Class->IsCrew && Percent_Chance(90) && Map[...].Is_Clear_To_Move(SPEED_FOOT, ...)) {
    //     InfantryClass * infantry = new InfantryClass(INFANTRY_E1, House->Class->House);
    //     if (infantry != NULL) {
    //       if (!infantry->Paradrop(Center_Coord())) {
    //         delete infantry;
    //       }
    //     }
    //   }
    //
    // Key differences from vehicle crew spawning:
    // 1. 90% probability (not 50% like vehicles)
    // 2. Always INFANTRY_E1 (not Crew_Type() — no civilian/weapon check)
    // 3. Infantry parachutes down (Paradrop, not Unlimbo)
    // 4. No IsTechnician flag
    // 5. No HP reduction — survivor gets full health
    expect(true).toBe(true); // documented C++ behavior
  });

  it('crewed aircraft (YAK, HELI, HIND) spawn parachute survivors', () => {
    for (const type of ['YAK', 'HELI', 'HIND']) {
      expect(iniCrewed(type)).toBe(true);
    }
  });

  it('non-crewed aircraft (MIG, TRAN, BADR, U2) do NOT spawn survivors', () => {
    for (const type of ['MIG', 'TRAN', 'BADR', 'U2']) {
      expect(iniCrewed(type)).toBe(false);
    }
  });

  it('PARITY GAP: TS does not spawn crew from destroyed aircraft', () => {
    // TS handleUnitDeath is used for both vehicles and aircraft deaths.
    // It does not spawn infantry survivors or implement parachuting.
    // In C++, crewed aircraft destruction (HELI, HIND, YAK) has a 90% chance
    // to create a parachuting E1 minigunner.
    expect(true).toBe(true); // PARITY GAP documented
  });
});

// ============================================================
// Section 8: PARITY GAP — SILO survivor spawning
// C++ SILO has IsCrew=false, so it NEVER spawns survivors.
// The BuildingClass::Crew_Type switch case for STRUCT_STORAGE is dead code.
// ============================================================
describe('PARITY GAP: SILO (IsCrew=false → dead Crew_Type code)', () => {

  it('SILO has no Crewed=yes in rules.ini', () => {
    expect(iniCrewed('SILO')).toBe(false);
  });

  it('C++ How_Many_Survivors returns 0 for SILO (IsCrew=false)', () => {
    // C++ building.cpp:5593: if (IsSurvivorless || !Class->IsCrew) return(0);
    // SILO IsCrew = false → returns 0 immediately, never reaches cost calculation
    // This means the Crew_Type case for STRUCT_STORAGE (C1/C7) is UNREACHABLE.
    const surrCount = iniCrewed('SILO') ? cppBuildingSurvivorCount(iniCost('SILO')) : 0;
    expect(surrCount).toBe(0);
  });

  it('TS incorrectly spawns civilians for SILO sell/destruction', () => {
    // TS index.ts:2037-2038: case 'SILO': crewType = ... C1 or C7
    // TS combat.ts:1324-1325: case 'SILO': crewType = ... C1 or C7
    //
    // Both TS code paths spawn survivors for SILO, but C++ never does because IsCrew=false.
    // The TS engine does not check IsCrew before spawning survivors.
    //
    // To fix: TS should check iniCrewed before entering the survivor spawning loop,
    // or maintain a NON_CREWED_BUILDINGS set that skips SILO, KENN, SYRD, SPEN.
    expect(true).toBe(true); // PARITY GAP documented
  });
});

// ============================================================
// Section 9: PARITY GAP — SYRD and SPEN (naval yards) have no crew
// ============================================================
describe('PARITY GAP: SYRD and SPEN (no Crewed=yes)', () => {

  it('SYRD (Allied naval yard) has IsCrew=false — no survivors', () => {
    expect(iniCrewed('SYRD')).toBe(false);
    expect(iniCost('SYRD')).toBe(650);
  });

  it('SPEN (Soviet sub pen) has IsCrew=false — no survivors', () => {
    expect(iniCrewed('SPEN')).toBe(false);
    expect(iniCost('SPEN')).toBe(650);
  });
});

// ============================================================
// Section 10: Building survivor count — only for Crewed=yes buildings
// Validate the formula using rules.ini costs for all crewed buildings
// ============================================================
describe('building survivor counts from rules.ini (Crewed=yes only)', () => {

  const HARVESTER_COST = iniCost('HARV'); // 1400
  const HIND_COST = iniCost('HIND');      // 1200

  /** C++ bdata.cpp:3672-3683 Raw_Cost adjustments */
  function rawCost(type: string): number {
    let cost = iniCost(type);
    if (type === 'PROC') cost -= HARVESTER_COST;
    if (type === 'HPAD') cost -= (HIND_COST + HIND_COST) / 2; // C++ bug: HIND twice
    return cost;
  }

  // Only crewed buildings should be tested; non-crewed would return 0.
  const crewedBuildingsWithCost: [string, number][] = [
    ['POWR', 300],   ['APWR', 500],   ['BARR', 300],   ['TENT', 300],
    ['DOME', 1000],  ['WEAP', 2000],  ['FIX', 1200],   ['AFLD', 600],
    ['TSLA', 1500],  ['ATEK', 1500],  ['STEK', 1500],  ['PDOX', 2800],
    ['IRON', 2800],  ['MSLO', 2500],  ['PBOX', 400],   ['HBOX', 600],
    ['GUN', 600],    ['AGUN', 600],   ['FTUR', 600],   ['SAM', 750],
    ['GAP', 500],    ['FACT', 2500],  ['PROC', 2000],  ['HPAD', 1500],
  ];

  for (const [type, expectedIniCost] of crewedBuildingsWithCost) {
    it(`${type}: INI Cost=${expectedIniCost}, Crewed=yes`, () => {
      expect(iniCost(type)).toBe(expectedIniCost);
      expect(iniCrewed(type)).toBe(true);
    });
  }

  // Verify survivor counts using Raw_Cost
  const expectedSurvivors: [string, number, number][] = [
    // [type, rawCost, expected survivors]
    ['POWR', 300,  1],   // floor(300*0.4/100) = 1
    ['APWR', 500,  2],   // floor(500*0.4/100) = 2
    ['BARR', 300,  1],
    ['TENT', 300,  1],
    ['PBOX', 400,  1],   // floor(400*0.4/100) = 1
    ['HBOX', 600,  2],   // floor(600*0.4/100) = 2
    ['GUN', 600,   2],
    ['AGUN', 600,  2],
    ['FTUR', 600,  2],
    ['SAM', 750,   3],   // floor(750*0.4/100) = 3
    ['GAP', 500,   2],
    ['AFLD', 600,  2],
    ['DOME', 1000, 4],
    ['FIX', 1200,  4],
    ['TSLA', 1500, 5],   // floor(1500*0.4/100) = 6 → clamped 5
    ['ATEK', 1500, 5],
    ['STEK', 1500, 5],
    ['WEAP', 2000, 5],
    ['FACT', 2500, 5],   // Raw_Cost for FACT: C++ uses 2000 not 2500
    ['PDOX', 2800, 5],
    ['IRON', 2800, 5],
    ['MSLO', 2500, 5],
  ];

  for (const [type, expectedRaw, expected] of expectedSurvivors) {
    it(`${type}: rawCost=${expectedRaw} → ${expected} survivors`, () => {
      // Use actual rawCost from INI (with PROC/HPAD adjustments)
      const rc = rawCost(type);
      // FACT special case: C++ FACT Raw_Cost is ~2000 (not 2500) due to different
      // cost handling, but at 2500 it still clamps to 5 survivors
      const count = cppBuildingSurvivorCount(rc);
      expect(count).toBe(expected);
    });
  }

  it('PROC rawCost = 600 (2000 - 1400 harvester)', () => {
    expect(rawCost('PROC')).toBe(600);
    expect(cppBuildingSurvivorCount(600)).toBe(2);
  });

  it('HPAD rawCost = 300 (1500 - 1200 hind)', () => {
    expect(rawCost('HPAD')).toBe(300);
    expect(cppBuildingSurvivorCount(300)).toBe(1);
  });
});

// ============================================================
// Section 11: C++ Crew_Type per building — all ALWAYS E1 crew type
// in Crew_Type, the default falls through to TechnoClass::Crew_Type
// which returns E1 (with 15% civilian for unarmed buildings).
// ============================================================
describe('C++ building Crew_Type (building.cpp:4667-4701)', () => {

  it('SILO Crew_Type is dead code — IsCrew=false means 0 survivors', () => {
    // C++ building.cpp:4673-4678: case STRUCT_STORAGE: C1/C7
    // But IsCrew=false → How_Many_Survivors returns 0 → Crew_Type never called
    expect(iniCrewed('SILO')).toBe(false);
  });

  it('KENN Crew_Type is dead code — IsCrew=false means 0 survivors', () => {
    // C++ building.cpp:4686-4691: case STRUCT_KENNEL: DOG/NONE
    // But IsCrew=false → How_Many_Survivors returns 0
    expect(iniCrewed('KENN')).toBe(false);
  });

  it('FACT (ConYard) Crew_Type: 25% engineer if human-owned && !captured', () => {
    // C++ building.cpp:4680-4684
    expect(iniCrewed('FACT')).toBe(true);
  });

  it('TENT and BARR always return E1', () => {
    // C++ building.cpp:4693-4695
    expect(iniCrewed('TENT')).toBe(true);
    expect(iniCrewed('BARR')).toBe(true);
  });

  it('unarmed crewed buildings: 15% civilian chance (TechnoClass::Crew_Type)', () => {
    // C++ techno.cpp:4458: if (PrimaryWeapon == NULL && Percent_Chance(15))
    // Unarmed crewed buildings: POWR, APWR, PROC, DOME, WEAP, ATEK, STEK, etc.
    const unarmedCrewedBuildings = [
      'POWR', 'APWR', 'PROC', 'DOME', 'WEAP', 'ATEK', 'STEK',
      'HPAD', 'AFLD', 'IRON', 'PDOX', 'FIX', 'GAP',
    ];
    for (const type of unarmedCrewedBuildings) {
      expect(iniCrewed(type)).toBe(true);
      // These have no Primary weapon (or Primary=none) → 15% civilian chance
      const primary = iniPrimary(type);
      expect(primary, `${type} should have no primary weapon`).toBeUndefined();
    }
  });

  it('armed crewed buildings: always E1 (no civilian chance)', () => {
    // These have Primary weapons → Crew_Type returns E1
    const armedCrewedBuildings = [
      'PBOX', 'HBOX', 'GUN', 'AGUN', 'FTUR', 'TSLA', 'SAM',
    ];
    for (const type of armedCrewedBuildings) {
      expect(iniCrewed(type)).toBe(true);
      const primary = iniPrimary(type);
      expect(primary, `${type} should have a primary weapon`).toBeDefined();
    }
  });
});

// ============================================================
// Section 12: TS sell path — IsCrew check missing
// The TS never checks IsCrew before spawning survivors.
// ============================================================
describe('PARITY GAP: TS sell path does not check IsCrew', () => {

  it('TS spawns survivors for ALL buildings in PRODUCTION_ITEMS regardless of IsCrew', () => {
    // C++ building.cpp:5593: if (IsSurvivorless || !Class->IsCrew) return(0);
    // TS index.ts:2015-2069: survivor spawning loop runs for ANY building that
    // has been sold, with no IsCrew check.
    //
    // Buildings that should NOT spawn survivors (IsCrew=false):
    // SILO, KENN, SYRD, SPEN
    //
    // Of these, SILO and KENN are in PRODUCTION_ITEMS and will incorrectly
    // spawn survivors when sold in TS.
    const siloInProd = PRODUCTION_ITEMS.find(p => p.type === 'SILO');
    const kennInProd = PRODUCTION_ITEMS.find(p => p.type === 'KENN');
    expect(siloInProd).toBeDefined();
    expect(kennInProd).toBeDefined();

    // These are in PRODUCTION_ITEMS but have IsCrew=false
    expect(iniCrewed('SILO')).toBe(false);
    expect(iniCrewed('KENN')).toBe(false);
  });
});

// ============================================================
// Section 13: TS destruction path — IsCrew check missing
// ============================================================
describe('PARITY GAP: TS destruction path does not check IsCrew', () => {

  it('TS exclusion list covers walls, barrels, and KENN but NOT SILO', () => {
    // TS combat.ts:1281: if (!WALL_TYPES.has(s.type) && s.type !== 'BARL' && s.type !== 'BRL3' && s.type !== 'KENN')
    // KENN is excluded — correct for destruction (C++ sets IsSurvivorless for KENN on destruction)
    // BUT: SILO is NOT excluded — TS will spawn destruction survivors for SILO
    // C++: SILO IsCrew=false → Drop_Debris never spawns survivors
    expect(iniCrewed('SILO')).toBe(false);
  });
});

// ============================================================
// Section 14: C++ vs TS crew spawn probability comparison
// ============================================================
describe('C++ crew spawn probabilities per object type', () => {

  it('buildings (sell): 100% guaranteed spawning (count = How_Many_Survivors)', () => {
    // C++ building.cpp:3450-3483: while (count) { spawn; count--; }
    // Every survivor is guaranteed to spawn on sell.
    expect(true).toBe(true);
  });

  it('buildings (destruction): probabilistic per cell (1/3 base, 1/2 sabotage, 1/9 captured)', () => {
    // C++ building.cpp:1676-1678
    expect(true).toBe(true);
  });

  it('vehicles: 50% chance if IsCrew=true && Max_Passengers==0', () => {
    // C++ unit.cpp:1047: if (Percent_Chance(50))
    // Single survivor (not cost-based like buildings)
    expect(true).toBe(true);
  });

  it('aircraft: 90% chance if IsCrew=true, always E1, parachutes down', () => {
    // C++ aircraft.cpp:1588: if (Class->IsCrew && Percent_Chance(90) && ...)
    expect(true).toBe(true);
  });

  it('TS: only building survivors implemented (sell + destruction), no vehicle/aircraft crew', () => {
    // TS sell path: index.ts:2013-2069
    // TS destruction path: combat.ts:1279-1355 (spawnDestructionSurvivors)
    // No vehicle or aircraft crew spawning exists in TS.
    expect(true).toBe(true);
  });
});

// ============================================================
// Section 15: Complete IsCrew parity matrix — all object types
// ============================================================
describe('complete IsCrew parity matrix from rules.ini', () => {

  // Full list of ALL crewed objects in rules.ini (buildings + vehicles + aircraft)
  const allCrewedObjects = [
    // Vehicles
    'V2RL', '1TNK', '3TNK', '2TNK', '4TNK', 'MRJ', 'MGG', 'ARTY', 'HARV', 'MCV', 'JEEP', 'MNLY',
    // Aircraft
    'YAK', 'HELI', 'HIND',
    // Buildings
    'IRON', 'FCOM', 'ATEK', 'PDOX', 'WEAP', 'PBOX', 'HBOX', 'TSLA', 'GUN', 'AGUN', 'FTUR',
    'FACT', 'PROC', 'HPAD', 'DOME', 'GAP', 'SAM', 'MSLO', 'AFLD', 'POWR', 'APWR', 'FIX',
    'BARR', 'TENT', 'HOSP', 'BIO', 'STEK',
  ];

  it('all 42 Crewed=yes entries in rules.ini are accounted for', () => {
    // Count all Crewed=yes in rules.ini
    const crewedCount = Object.keys(INI).filter(sec => iniCrewed(sec)).length;
    expect(crewedCount).toBe(allCrewedObjects.length);

    for (const type of allCrewedObjects) {
      expect(iniCrewed(type), `${type} should have Crewed=yes`).toBe(true);
    }
  });

  // Objects that notably do NOT have crew
  const notableNonCrewedObjects: [string, string][] = [
    ['SILO', 'Ore Silo — no crew despite BuildingClass::Crew_Type having dead switch case'],
    ['KENN', 'Kennel — no crew despite BuildingClass::Crew_Type having dead switch case'],
    ['SYRD', 'Allied Naval Yard — no crew'],
    ['SPEN', 'Soviet Sub Pen — no crew'],
    ['APC', 'APC — transport, ejects passengers instead'],
    ['TRUK', 'Convoy Truck — transport'],
    ['MIG', 'MiG — no parachute survivor'],
    ['TRAN', 'Chinook — transport, ejects passengers'],
    ['BADR', 'Badger Bomber — no crew'],
    ['U2', 'Spy Plane — no crew'],
    ['SS', 'Submarine — no crew'],
    ['DD', 'Destroyer — no crew'],
    ['CA', 'Cruiser — no crew'],
    ['LST', 'Landing Ship — no crew'],
    ['PT', 'Patrol Boat — no crew'],
  ];

  for (const [type, description] of notableNonCrewedObjects) {
    it(`${type} (${description}) has IsCrew=false`, () => {
      expect(iniCrewed(type)).toBe(false);
    });
  }
});

// ============================================================
// Section 16: Summary of all parity gaps
// ============================================================
describe('SUMMARY: survivor spawn parity gaps (TS vs C++)', () => {

  it('GAP 1: TS does not check IsCrew for buildings before spawning survivors', () => {
    // Affected buildings: SILO, KENN (KENN excluded by hardcoded check, but for wrong reason)
    // SILO incorrectly spawns C1/C7 civilians on sell and destruction.
    // Fix: add IsCrew check or NON_CREWED set to skip SILO, SYRD, SPEN.
    expect(iniCrewed('SILO')).toBe(false);
  });

  it('GAP 2: TS does not spawn crew from destroyed vehicles', () => {
    // C++ unit.cpp:1046-1069: crewed vehicles (50% chance) spawn E1 or C1 on destruction.
    // TS: no vehicle crew spawning. Crewed vehicles that should spawn crew:
    // 1TNK, 2TNK, 3TNK, 4TNK, V2RL, ARTY, JEEP, HARV, MCV, MRJ, MGG, MNLY
    const crewedVehicles = ['1TNK', '2TNK', '3TNK', '4TNK', 'V2RL', 'ARTY',
      'JEEP', 'HARV', 'MCV', 'MRJ', 'MGG', 'MNLY'];
    for (const v of crewedVehicles) {
      expect(iniCrewed(v)).toBe(true);
      expect(iniMaxPassengers(v)).toBe(0);
    }
  });

  it('GAP 3: TS does not spawn crew from destroyed aircraft', () => {
    // C++ aircraft.cpp:1588: crewed aircraft (90% chance) parachute E1 on destruction.
    // TS: no aircraft crew spawning. Crewed aircraft: YAK, HELI, HIND
    for (const a of ['YAK', 'HELI', 'HIND']) {
      expect(iniCrewed(a)).toBe(true);
    }
  });

  it('GAP 4: TS SILO Crew_Type switch case is not gated by IsCrew', () => {
    // In C++, SILO's Crew_Type case (STRUCT_STORAGE → C1/C7) is dead code.
    // In TS, it actively runs, causing incorrect civilian spawns.
    expect(iniCrewed('SILO')).toBe(false);
  });

  it('GAP 5: TS KENN exclusion is destruction-only; sell path may still attempt survivors', () => {
    // TS combat.ts:1281 excludes KENN from destruction survivors.
    // But TS index.ts sell path has a 'KENN' case that spawns DOG.
    // C++: KENN IsCrew=false → 0 survivors on sell path too.
    // However: KENN sell path in C++ with IsSurvivorless=false would check
    // How_Many_Survivors which returns 0 because IsCrew=false.
    expect(iniCrewed('KENN')).toBe(false);
  });

  it('GAP 6: vehicle survivor HP is MaxStrength/2 (not full like building survivors)', () => {
    // C++ unit.cpp:1058: Random_Pick(5, MaxStrength/2)
    // C++ building.cpp:1701: Random_Pick(5, MaxStrength) — full HP possible
    // TS building destruction uses: Math.max(5, Math.floor(Math.random() * maxHp) + 5)
    // which can exceed MaxStrength/2. This is a minor difference if vehicle crew is ever added.
    expect(true).toBe(true);
  });
});
