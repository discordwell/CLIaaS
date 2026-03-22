/**
 * C++ Behavioral Parity: Unit Flags from rules.ini / aftrmath.ini
 *
 * Audits UNIT_STATS against authoritative INI source for:
 *   - ROT= vs TS rot
 *   - Passengers= vs TS passengers
 *   - Tracked= vs TS crusher (Tracked=yes means unit can crush infantry)
 *   - Ammo= vs TS maxAmmo (aircraft/V2RL/MNLY)
 *   - Cloakable= vs TS isCloakable
 *   - NoMovingFire= vs TS noMovingFire
 *   - Crewed= (documented; TS has no 'crewed' field yet)
 *
 * rules.ini is the authoritative source, NOT .cpp files.
 * aftrmath.ini overrides rules.ini for Counterstrike/Aftermath units.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { UNIT_STATS } from '../engine/types';

// ---------------------------------------------------------------------------
// INI parser — parse [Section] Key=Value from rules.ini and aftrmath.ini
// ---------------------------------------------------------------------------
type IniSections = Record<string, Record<string, string>>;

function parseIni(filepath: string): IniSections {
  const text = readFileSync(filepath, 'utf-8');
  const sections: IniSections = {};
  let current: string | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const secMatch = line.match(/^\[(\w+)\]/);
    if (secMatch) {
      current = secMatch[1];
      sections[current] = sections[current] ?? {};
      continue;
    }
    if (current && line.includes('=')) {
      const eqIdx = line.indexOf('=');
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).split(';')[0].trim();
      sections[current][key] = val;
    }
  }
  return sections;
}

function mergeIni(base: IniSections, override: IniSections): IniSections {
  const result: IniSections = {};
  const allKeys = new Set([...Object.keys(base), ...Object.keys(override)]);
  for (const sec of allKeys) {
    result[sec] = { ...(base[sec] ?? {}), ...(override[sec] ?? {}) };
  }
  return result;
}

function ynBool(val: string | undefined): boolean | undefined {
  if (val === undefined) return undefined;
  return val.toLowerCase() === 'yes';
}

// ---------------------------------------------------------------------------
// Parse both INI files and merge (aftrmath overrides rules)
// ---------------------------------------------------------------------------
const RULES_PATH = resolve(__dirname, '../../..', 'public/ra/assets/rules.ini');
const AFTRMATH_PATH = resolve(__dirname, '../../..', 'public/ra/assets/aftrmath.ini');

const rules = parseIni(RULES_PATH);
const aftrmath = parseIni(AFTRMATH_PATH);
const ini = mergeIni(rules, aftrmath);

// ---------------------------------------------------------------------------
// All units in UNIT_STATS that have INI sections (ants are scenario-only)
// ---------------------------------------------------------------------------
const VEHICLE_UNITS = [
  '1TNK', '2TNK', '3TNK', '4TNK', 'JEEP', 'APC', 'ARTY', 'HARV', 'MCV', 'TRUK',
  'STNK', 'CTNK', 'TTNK', 'QTNK', 'DTRK', 'MRJ', 'MGG', 'V2RL', 'MNLY',
];

const INFANTRY_UNITS = [
  'E1', 'E2', 'E3', 'E4', 'E6', 'DOG', 'SPY', 'MEDI', 'GNRL', 'CHAN',
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'EINSTEIN',
  'SHOK', 'MECH', 'E7', 'THF',
];

const VESSEL_UNITS = ['SS', 'DD', 'CA', 'PT', 'MSUB', 'LST'];

const AIRCRAFT_UNITS = ['BADR', 'U2', 'MIG', 'YAK', 'HELI', 'HIND', 'TRAN'];

const ALL_INI_UNITS = [...VEHICLE_UNITS, ...INFANTRY_UNITS, ...VESSEL_UNITS, ...AIRCRAFT_UNITS];

// ==========================================================================
// 1. ROT= parity
// ==========================================================================
describe('ROT= parity (rules.ini ROT vs TS rot)', () => {
  const unitsWithROT = ALL_INI_UNITS.filter(u => ini[u]?.ROT !== undefined);

  it.each(unitsWithROT)('%s: ROT matches rules.ini', (unit) => {
    const iniROT = parseInt(ini[unit].ROT, 10);
    const tsROT = UNIT_STATS[unit].rot;
    expect(tsROT, `${unit} rot: INI=${iniROT} TS=${tsROT}`).toBe(iniROT);
  });

  // Infantry & some vehicles don't have ROT in INI — they rely on C++ defaults.
  // We don't assert those because the INI is silent.
  it('sanity: at least 25 units have ROT in INI', () => {
    expect(unitsWithROT.length).toBeGreaterThanOrEqual(25);
  });
});

// ==========================================================================
// 2. Passengers= parity
// ==========================================================================
describe('Passengers= parity (rules.ini Passengers vs TS passengers)', () => {
  // Units that HAVE Passengers= in INI
  const iniPassengerUnits: [string, number][] = ALL_INI_UNITS
    .filter(u => ini[u]?.Passengers !== undefined)
    .map(u => [u, parseInt(ini[u].Passengers, 10)]);

  it.each(iniPassengerUnits)(
    '%s: passengers=%i matches rules.ini',
    (unit, expected) => {
      const tsPax = UNIT_STATS[unit].passengers;
      expect(tsPax, `${unit} passengers: INI=${expected} TS=${tsPax}`).toBe(expected);
    },
  );

  // Units that do NOT have Passengers= should not have TS passengers set
  const iniNoPassengerUnits = ALL_INI_UNITS.filter(
    u => ini[u]?.Passengers === undefined && UNIT_STATS[u].passengers !== undefined,
  );

  it('no unit has TS passengers without INI Passengers=', () => {
    for (const u of iniNoPassengerUnits) {
      // This will fail if any unit has passengers in TS but not in INI
      expect(
        UNIT_STATS[u].passengers,
        `${u}: TS has passengers=${UNIT_STATS[u].passengers} but INI has no Passengers=`,
      ).toBeUndefined();
    }
  });
});

// ==========================================================================
// 3. Tracked= vs crusher parity
//    In RA, Tracked=yes in rules.ini means the vehicle can crush infantry.
//    TS uses the 'crusher' boolean flag for this.
// ==========================================================================
describe('Tracked= vs crusher parity (rules.ini Tracked=yes -> TS crusher=true)', () => {
  const trackedUnits = ALL_INI_UNITS.filter(u => ynBool(ini[u]?.Tracked) === true);
  const nonTrackedIniUnits = ALL_INI_UNITS.filter(
    u => ini[u] !== undefined && ynBool(ini[u]?.Tracked) !== true,
  );

  it.each(trackedUnits)('%s: Tracked=yes in INI -> crusher=true in TS', (unit) => {
    expect(
      UNIT_STATS[unit].crusher,
      `${unit}: INI has Tracked=yes but TS crusher=${UNIT_STATS[unit].crusher}`,
    ).toBe(true);
  });

  it.each(nonTrackedIniUnits)(
    '%s: no Tracked=yes in INI -> crusher should be absent/false in TS',
    (unit) => {
      const tsCrusher = UNIT_STATS[unit].crusher;
      expect(
        tsCrusher,
        `${unit}: INI has no Tracked=yes but TS has crusher=${tsCrusher}`,
      ).toBeFalsy();
    },
  );
});

// ==========================================================================
// 4. Ammo= parity (aircraft + V2RL, MNLY, C1, C7)
// ==========================================================================
describe('Ammo= parity (rules.ini Ammo vs TS maxAmmo)', () => {
  const iniAmmoUnits: [string, number][] = ALL_INI_UNITS
    .filter(u => ini[u]?.Ammo !== undefined)
    .map(u => [u, parseInt(ini[u].Ammo, 10)]);

  it.each(iniAmmoUnits)(
    '%s: maxAmmo=%i matches rules.ini Ammo=',
    (unit, expected) => {
      const tsAmmo = UNIT_STATS[unit].maxAmmo;
      expect(tsAmmo, `${unit}: INI Ammo=${expected} TS maxAmmo=${tsAmmo}`).toBe(expected);
    },
  );

  // Units with TS maxAmmo but no INI Ammo= (should not exist for INI units)
  const tsAmmoNoIni = ALL_INI_UNITS.filter(
    u => UNIT_STATS[u].maxAmmo !== undefined && ini[u]?.Ammo === undefined,
  );

  it('no INI unit has TS maxAmmo without INI Ammo=', () => {
    for (const u of tsAmmoNoIni) {
      expect(
        UNIT_STATS[u].maxAmmo,
        `${u}: TS has maxAmmo=${UNIT_STATS[u].maxAmmo} but INI has no Ammo=`,
      ).toBeUndefined();
    }
  });
});

// ==========================================================================
// 5. Cloakable= parity
// ==========================================================================
describe('Cloakable= parity (rules.ini Cloakable=yes -> TS isCloakable=true)', () => {
  const cloakableUnits = ALL_INI_UNITS.filter(u => ynBool(ini[u]?.Cloakable) === true);
  const nonCloakableUnits = ALL_INI_UNITS.filter(
    u => ini[u] !== undefined && ynBool(ini[u]?.Cloakable) !== true,
  );

  it.each(cloakableUnits)('%s: Cloakable=yes in INI -> isCloakable=true in TS', (unit) => {
    expect(
      UNIT_STATS[unit].isCloakable,
      `${unit}: INI Cloakable=yes but TS isCloakable=${UNIT_STATS[unit].isCloakable}`,
    ).toBe(true);
  });

  it('no non-cloakable unit has isCloakable=true in TS', () => {
    for (const u of nonCloakableUnits) {
      const tsCloak = UNIT_STATS[u].isCloakable;
      expect(
        tsCloak,
        `${u}: INI has no Cloakable=yes but TS has isCloakable=${tsCloak}`,
      ).toBeFalsy();
    }
  });

  it('sanity: SS, MSUB, STNK are cloakable', () => {
    expect(cloakableUnits).toContain('SS');
    expect(cloakableUnits).toContain('MSUB');
    expect(cloakableUnits).toContain('STNK');
  });
});

// ==========================================================================
// 6. NoMovingFire= parity
// ==========================================================================
describe('NoMovingFire= parity (rules.ini NoMovingFire=yes -> TS noMovingFire=true)', () => {
  const nmfUnits = ALL_INI_UNITS.filter(u => ynBool(ini[u]?.NoMovingFire) === true);
  const nonNmfUnits = ALL_INI_UNITS.filter(
    u => ini[u] !== undefined && ynBool(ini[u]?.NoMovingFire) !== true,
  );

  it.each(nmfUnits)('%s: NoMovingFire=yes in INI -> noMovingFire=true in TS', (unit) => {
    expect(
      UNIT_STATS[unit].noMovingFire,
      `${unit}: INI NoMovingFire=yes but TS noMovingFire=${UNIT_STATS[unit].noMovingFire}`,
    ).toBe(true);
  });

  it('no non-NoMovingFire unit has noMovingFire=true in TS', () => {
    for (const u of nonNmfUnits) {
      const tsNmf = UNIT_STATS[u].noMovingFire;
      expect(
        tsNmf,
        `${u}: INI has no NoMovingFire=yes but TS has noMovingFire=${tsNmf}`,
      ).toBeFalsy();
    }
  });

  it('sanity: ARTY, V2RL, TTNK, SHOK have NoMovingFire=yes', () => {
    expect(nmfUnits).toContain('ARTY');
    expect(nmfUnits).toContain('V2RL');
    expect(nmfUnits).toContain('TTNK');
    expect(nmfUnits).toContain('SHOK');
  });
});

// ==========================================================================
// 7. Crewed= documentation (TS has no 'crewed' field)
//    Crewed=yes means vehicle spawns crew infantry on destruction.
//    This section documents which units have Crewed= in INI for future impl.
// ==========================================================================
describe('Crewed= documentation (INI field, no TS equivalent yet)', () => {
  const crewedUnits = ALL_INI_UNITS.filter(u => ynBool(ini[u]?.Crewed) === true);
  const notCrewedUnits = ALL_INI_UNITS.filter(u => ynBool(ini[u]?.Crewed) === false);

  it('crewed vehicles from INI are documented', () => {
    // These units have Crewed=yes in rules.ini / aftrmath.ini
    const expectedCrewedYes = [
      '1TNK', '2TNK', '3TNK', '4TNK', 'JEEP', 'ARTY', 'HARV', 'MCV',
      'TTNK', 'MRJ', 'MGG', 'V2RL', 'MNLY',
      'YAK', 'HELI', 'HIND',
    ];
    for (const u of expectedCrewedYes) {
      expect(crewedUnits, `${u} should have Crewed=yes in INI`).toContain(u);
    }
  });

  it('QTNK has Crewed=no in INI (explicit override)', () => {
    expect(notCrewedUnits).toContain('QTNK');
  });

  it('APC, TRUK, DTRK, LST do NOT have Crewed=yes', () => {
    expect(crewedUnits).not.toContain('APC');
    expect(crewedUnits).not.toContain('TRUK');
    expect(crewedUnits).not.toContain('DTRK');
    expect(crewedUnits).not.toContain('LST');
  });
});

// ==========================================================================
// 8. Ant units (ANT1, ANT2, ANT3) — NOT in rules.ini/aftrmath.ini
//    Ants are defined in scenario INI files (SCA01EA.ini, etc.)
//    This section just confirms they are absent from the global INI.
// ==========================================================================
describe('Ant units are scenario-only (not in rules.ini)', () => {
  it.each(['ANT1', 'ANT2', 'ANT3'])('%s is not in rules.ini or aftrmath.ini', (unit) => {
    expect(ini[unit]).toBeUndefined();
  });

  // But they should still exist in UNIT_STATS
  it.each(['ANT1', 'ANT2', 'ANT3'])('%s exists in UNIT_STATS', (unit) => {
    expect(UNIT_STATS[unit]).toBeDefined();
  });
});
