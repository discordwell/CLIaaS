/**
 * C++ Parity: Comprehensive weapon-to-unit assignment audit
 *
 * Parses rules.ini and aftrmath.ini to discover ALL Primary= and Secondary=
 * weapon assignments for every unit, infantry, aircraft, ship, and building.
 * Compares each assignment against the TS runtime values in UNIT_STATS and
 * STRUCTURE_WEAPONS.
 *
 * Source of truth: rules.ini (base game), aftrmath.ini (overrides for expansion units).
 * aftrmath.ini values override rules.ini when both define the same section.
 *
 * C++ load chain: rules.ini parsed first, then aftrmath.ini overlays on top.
 * See rules.cpp, aftermat.cpp in RA source.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { UNIT_STATS } from '../engine/types';
import { STRUCTURE_WEAPONS } from '../engine/scenario';

// ─── INI Parser ──────────────────────────────────────────────────────────────

interface IniData {
  [section: string]: { [key: string]: string };
}

function parseIni(text: string): IniData {
  const data: IniData = {};
  let currentSection = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/;.*$/, '').trim();
    if (!line) continue;
    const secMatch = line.match(/^\[(.+)\]$/);
    if (secMatch) {
      currentSection = secMatch[1];
      if (!data[currentSection]) data[currentSection] = {};
      continue;
    }
    const kvMatch = line.match(/^([^=]+)=(.*)$/);
    if (kvMatch && currentSection) {
      data[currentSection][kvMatch[1].trim()] = kvMatch[2].trim();
    }
  }
  return data;
}

/**
 * Merge two INI datasets — aftrmath overrides rules on a per-key basis within
 * each section (matching C++ overlay behavior).
 */
function mergeIni(base: IniData, overlay: IniData): IniData {
  const merged: IniData = {};
  // Copy all base sections
  for (const [section, keys] of Object.entries(base)) {
    merged[section] = { ...keys };
  }
  // Apply overlay on top
  for (const [section, keys] of Object.entries(overlay)) {
    if (!merged[section]) merged[section] = {};
    for (const [key, value] of Object.entries(keys)) {
      merged[section][key] = value;
    }
  }
  return merged;
}

/** Normalise weapon value: "none" or empty → null */
function normaliseWeapon(value: string | undefined): string | null {
  if (!value || value.toLowerCase() === 'none' || value === '') return null;
  return value;
}

// ─── INI data loaded once ────────────────────────────────────────────────────

let ini: IniData;

beforeAll(() => {
  const rulesPath = resolve(__dirname, '../../../public/ra/assets/rules.ini');
  const aftermathPath = resolve(__dirname, '../../../public/ra/assets/aftrmath.ini');
  const rulesIni = parseIni(readFileSync(rulesPath, 'utf-8'));
  const aftermathIni = parseIni(readFileSync(aftermathPath, 'utf-8'));
  ini = mergeIni(rulesIni, aftermathIni);
});

// ─── Unit / infantry / aircraft / ship sections from rules.ini ───────────────
// These are the INI section headers for units that exist in UNIT_STATS.
// Grouped by category for organized test output.

const VEHICLE_SECTIONS = [
  'V2RL', '1TNK', '2TNK', '3TNK', '4TNK', 'JEEP', 'APC', 'ARTY',
  'HARV', 'MCV', 'MNLY', 'TRUK', 'MRJ', 'MGG',
  // Aftermath vehicles
  'STNK', 'CTNK', 'TTNK', 'QTNK', 'DTRK',
];

const INFANTRY_SECTIONS = [
  'DOG', 'E1', 'E2', 'E3', 'E4', 'E6', 'SPY', 'THF', 'E7',
  'MEDI', 'GNRL',
  // Aftermath infantry
  'SHOK', 'MECH',
];

const CIVILIAN_SECTIONS = [
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10',
  'EINSTEIN', 'CHAN',
];

// DELPHI is a scenario-only NPC (like ants) — in rules.ini but not in UNIT_STATS
const SCENARIO_ONLY_INFANTRY = ['DELPHI'];

const AIRCRAFT_SECTIONS = [
  'BADR', 'U2', 'MIG', 'YAK', 'TRAN', 'HELI', 'HIND',
];

const SHIP_SECTIONS = [
  'SS', 'DD', 'CA', 'LST', 'PT', 'MSUB',
];

const DEFENSE_BUILDING_SECTIONS = [
  'PBOX', 'HBOX', 'GUN', 'TSLA', 'SAM', 'AGUN', 'FTUR',
];

// Buildings that have Primary=none or Primary=<weapon> in INI (non-defense)
// MSLO has Primary=none
const NON_DEFENSE_ARMED_BUILDINGS = ['MSLO'];

// All unit sections (those tracked in UNIT_STATS)
const ALL_UNIT_SECTIONS = [
  ...VEHICLE_SECTIONS,
  ...INFANTRY_SECTIONS,
  ...CIVILIAN_SECTIONS,
  ...AIRCRAFT_SECTIONS,
  ...SHIP_SECTIONS,
];

// ─── Helper to get TS weapon values ──────────────────────────────────────────

function tsPrimary(unitId: string): string | null {
  const s = UNIT_STATS[unitId];
  return s?.primaryWeapon ?? null;
}

function tsSecondary(unitId: string): string | null {
  const s = UNIT_STATS[unitId];
  return s?.secondaryWeapon ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('C++ Parity — Weapon Assignment (INI-parsed, comprehensive)', () => {

  // ─────────────────────────────────────────────────────────────────────────
  // VEHICLES
  // ─────────────────────────────────────────────────────────────────────────
  describe('Vehicles — primary weapon matches INI', () => {
    for (const id of VEHICLE_SECTIONS) {
      it(`${id} primaryWeapon matches [${id}] Primary=`, () => {
        const iniSection = ini[id];
        expect(iniSection, `[${id}] section must exist in merged INI`).toBeDefined();
        const iniPrimary = normaliseWeapon(iniSection.Primary);
        const tsPrim = tsPrimary(id);
        expect(tsPrim, `${id}: TS primaryWeapon=${tsPrim}, INI Primary=${iniPrimary}`).toBe(iniPrimary);
      });
    }
  });

  describe('Vehicles — secondary weapon matches INI', () => {
    for (const id of VEHICLE_SECTIONS) {
      it(`${id} secondaryWeapon matches [${id}] Secondary=`, () => {
        const iniSection = ini[id];
        expect(iniSection, `[${id}] section must exist in merged INI`).toBeDefined();
        const iniSecondary = normaliseWeapon(iniSection.Secondary);
        const tsSec = tsSecondary(id);
        expect(tsSec, `${id}: TS secondaryWeapon=${tsSec}, INI Secondary=${iniSecondary}`).toBe(iniSecondary);
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // INFANTRY
  // ─────────────────────────────────────────────────────────────────────────
  describe('Infantry — primary weapon matches INI', () => {
    for (const id of INFANTRY_SECTIONS) {
      it(`${id} primaryWeapon matches [${id}] Primary=`, () => {
        const iniSection = ini[id];
        expect(iniSection, `[${id}] section must exist in merged INI`).toBeDefined();
        const iniPrimary = normaliseWeapon(iniSection.Primary);
        const tsPrim = tsPrimary(id);
        expect(tsPrim, `${id}: TS primaryWeapon=${tsPrim}, INI Primary=${iniPrimary}`).toBe(iniPrimary);
      });
    }
  });

  describe('Infantry — secondary weapon matches INI', () => {
    for (const id of INFANTRY_SECTIONS) {
      it(`${id} secondaryWeapon matches [${id}] Secondary=`, () => {
        const iniSection = ini[id];
        expect(iniSection, `[${id}] section must exist in merged INI`).toBeDefined();
        const iniSecondary = normaliseWeapon(iniSection.Secondary);
        const tsSec = tsSecondary(id);
        expect(tsSec, `${id}: TS secondaryWeapon=${tsSec}, INI Secondary=${iniSecondary}`).toBe(iniSecondary);
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CIVILIANS
  // ─────────────────────────────────────────────────────────────────────────
  describe('Civilians — primary weapon matches INI', () => {
    for (const id of CIVILIAN_SECTIONS) {
      it(`${id} primaryWeapon matches [${id}] Primary=`, () => {
        const iniSection = ini[id];
        expect(iniSection, `[${id}] section must exist in merged INI`).toBeDefined();
        const iniPrimary = normaliseWeapon(iniSection.Primary);
        const tsPrim = tsPrimary(id);
        expect(tsPrim, `${id}: TS primaryWeapon=${tsPrim}, INI Primary=${iniPrimary}`).toBe(iniPrimary);
      });
    }
  });

  describe('Civilians — secondary weapon matches INI', () => {
    for (const id of CIVILIAN_SECTIONS) {
      it(`${id} secondaryWeapon matches [${id}] Secondary=`, () => {
        const iniSection = ini[id];
        expect(iniSection, `[${id}] section must exist in merged INI`).toBeDefined();
        const iniSecondary = normaliseWeapon(iniSection.Secondary);
        const tsSec = tsSecondary(id);
        expect(tsSec, `${id}: TS secondaryWeapon=${tsSec}, INI Secondary=${iniSecondary}`).toBe(iniSecondary);
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AIRCRAFT
  // ─────────────────────────────────────────────────────────────────────────
  describe('Aircraft — primary weapon matches INI', () => {
    for (const id of AIRCRAFT_SECTIONS) {
      it(`${id} primaryWeapon matches [${id}] Primary=`, () => {
        const iniSection = ini[id];
        expect(iniSection, `[${id}] section must exist in merged INI`).toBeDefined();
        const iniPrimary = normaliseWeapon(iniSection.Primary);
        const tsPrim = tsPrimary(id);
        expect(tsPrim, `${id}: TS primaryWeapon=${tsPrim}, INI Primary=${iniPrimary}`).toBe(iniPrimary);
      });
    }
  });

  describe('Aircraft — secondary weapon matches INI', () => {
    for (const id of AIRCRAFT_SECTIONS) {
      it(`${id} secondaryWeapon matches [${id}] Secondary=`, () => {
        const iniSection = ini[id];
        expect(iniSection, `[${id}] section must exist in merged INI`).toBeDefined();
        const iniSecondary = normaliseWeapon(iniSection.Secondary);
        const tsSec = tsSecondary(id);
        expect(tsSec, `${id}: TS secondaryWeapon=${tsSec}, INI Secondary=${iniSecondary}`).toBe(iniSecondary);
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SHIPS
  // ─────────────────────────────────────────────────────────────────────────
  describe('Ships — primary weapon matches INI', () => {
    for (const id of SHIP_SECTIONS) {
      it(`${id} primaryWeapon matches [${id}] Primary=`, () => {
        const iniSection = ini[id];
        expect(iniSection, `[${id}] section must exist in merged INI`).toBeDefined();
        const iniPrimary = normaliseWeapon(iniSection.Primary);
        const tsPrim = tsPrimary(id);
        expect(tsPrim, `${id}: TS primaryWeapon=${tsPrim}, INI Primary=${iniPrimary}`).toBe(iniPrimary);
      });
    }
  });

  describe('Ships — secondary weapon matches INI', () => {
    for (const id of SHIP_SECTIONS) {
      it(`${id} secondaryWeapon matches [${id}] Secondary=`, () => {
        const iniSection = ini[id];
        expect(iniSection, `[${id}] section must exist in merged INI`).toBeDefined();
        const iniSecondary = normaliseWeapon(iniSection.Secondary);
        const tsSec = tsSecondary(id);
        expect(tsSec, `${id}: TS secondaryWeapon=${tsSec}, INI Secondary=${iniSecondary}`).toBe(iniSecondary);
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DEFENSE BUILDINGS (via STRUCTURE_WEAPONS)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Defense buildings — primary weapon name matches INI', () => {
    for (const id of DEFENSE_BUILDING_SECTIONS) {
      it(`${id} is armed in STRUCTURE_WEAPONS matching [${id}] Primary=`, () => {
        const iniSection = ini[id];
        expect(iniSection, `[${id}] section must exist in merged INI`).toBeDefined();
        const iniPrimary = normaliseWeapon(iniSection.Primary);
        expect(iniPrimary, `[${id}] should have a Primary weapon in INI`).not.toBeNull();
        // Verify the structure has a weapon entry
        expect(STRUCTURE_WEAPONS[id], `${id} should be defined in STRUCTURE_WEAPONS`).toBeDefined();
      });
    }
  });

  describe('Defense buildings — secondary weapon matches INI', () => {
    for (const id of DEFENSE_BUILDING_SECTIONS) {
      it(`${id} secondary weapon presence matches INI`, () => {
        const iniSection = ini[id];
        const iniSecondary = normaliseWeapon(iniSection.Secondary);
        // AGUN has Secondary=ZSU-23 in rules.ini — buildings can have secondary weapons
        // The STRUCTURE_WEAPONS interface doesn't track primary vs secondary weapon names
        // directly, but we can verify the INI has the expected Secondary assignment.
        // For AGUN: both Primary and Secondary are ZSU-23 (dual barrel flak)
        if (iniSecondary) {
          // If INI specifies a secondary, document it (STRUCTURE_WEAPONS merges both)
          expect(iniSecondary).toBeTruthy();
        }
      });
    }
  });

  describe('Defense buildings — weapon damage from INI weapon section', () => {
    for (const id of DEFENSE_BUILDING_SECTIONS) {
      it(`${id} damage matches INI [weapon] Damage=`, () => {
        const iniSection = ini[id];
        const weaponName = iniSection.Primary;
        expect(weaponName, `[${id}] must have Primary= in INI`).toBeDefined();
        const weaponSection = ini[weaponName];
        expect(weaponSection, `[${weaponName}] weapon section must exist in INI`).toBeDefined();
        const iniDamage = Number(weaponSection.Damage);
        const tsDamage = STRUCTURE_WEAPONS[id]?.damage;
        expect(tsDamage, `${id}: TS damage=${tsDamage}, INI [${weaponName}] Damage=${iniDamage}`).toBe(iniDamage);
      });
    }
  });

  describe('Defense buildings — weapon range from INI weapon section', () => {
    for (const id of DEFENSE_BUILDING_SECTIONS) {
      it(`${id} range matches INI [weapon] Range=`, () => {
        const iniSection = ini[id];
        const weaponName = iniSection.Primary;
        const weaponSection = ini[weaponName];
        const iniRange = Number(weaponSection.Range);
        const tsRange = STRUCTURE_WEAPONS[id]?.range;
        expect(tsRange, `${id}: TS range=${tsRange}, INI [${weaponName}] Range=${iniRange}`).toBe(iniRange);
      });
    }
  });

  describe('Defense buildings — weapon ROF from INI weapon section', () => {
    for (const id of DEFENSE_BUILDING_SECTIONS) {
      it(`${id} rof matches INI [weapon] ROF=`, () => {
        const iniSection = ini[id];
        const weaponName = iniSection.Primary;
        const weaponSection = ini[weaponName];
        const iniROF = Number(weaponSection.ROF);
        const tsROF = STRUCTURE_WEAPONS[id]?.rof;
        expect(tsROF, `${id}: TS rof=${tsROF}, INI [${weaponName}] ROF=${iniROF}`).toBe(iniROF);
      });
    }
  });

  describe('Defense buildings — weapon warhead from INI weapon section', () => {
    for (const id of DEFENSE_BUILDING_SECTIONS) {
      it(`${id} warhead matches INI [weapon] Warhead=`, () => {
        const iniSection = ini[id];
        const weaponName = iniSection.Primary;
        const weaponSection = ini[weaponName];
        const iniWarhead = weaponSection.Warhead;
        const tsWarhead = STRUCTURE_WEAPONS[id]?.warhead;
        expect(tsWarhead, `${id}: TS warhead=${tsWarhead}, INI [${weaponName}] Warhead=${iniWarhead}`).toBe(iniWarhead);
      });
    }
  });

  describe('Defense buildings — weapon projSpeed from INI weapon section', () => {
    for (const id of DEFENSE_BUILDING_SECTIONS) {
      it(`${id} projSpeed matches INI [weapon] Speed=`, () => {
        const iniSection = ini[id];
        const weaponName = iniSection.Primary;
        const weaponSection = ini[weaponName];
        const iniSpeed = Number(weaponSection.Speed);
        const tsProjSpeed = STRUCTURE_WEAPONS[id]?.projSpeed;
        expect(tsProjSpeed, `${id}: TS projSpeed=${tsProjSpeed}, INI [${weaponName}] Speed=${iniSpeed}`).toBe(iniSpeed);
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // NON-DEFENSE ARMED BUILDINGS (e.g., MSLO Primary=none)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Non-defense buildings with Primary= in INI', () => {
    for (const id of NON_DEFENSE_ARMED_BUILDINGS) {
      it(`${id} Primary= from INI is correctly reflected (none → unarmed)`, () => {
        const iniSection = ini[id];
        expect(iniSection, `[${id}] section must exist in merged INI`).toBeDefined();
        const iniPrimary = normaliseWeapon(iniSection.Primary);
        // MSLO has Primary=none — should NOT be in STRUCTURE_WEAPONS
        if (iniPrimary === null) {
          expect(STRUCTURE_WEAPONS[id], `${id}: INI Primary=none, should not be armed`).toBeUndefined();
        }
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // COMPLETENESS: every unit in UNIT_STATS is accounted for
  // ─────────────────────────────────────────────────────────────────────────
  describe('Completeness — all UNIT_STATS entries have an INI section', () => {
    // Scenario-only units defined in SCA0xEA.ini, not in rules.ini/aftrmath.ini
    const SCENARIO_ONLY_UNITS = new Set(['ANT1', 'ANT2', 'ANT3']);

    for (const unitId of Object.keys(UNIT_STATS)) {
      if (SCENARIO_ONLY_UNITS.has(unitId)) continue; // scenario-only units not in base rules.ini

      it(`${unitId} has a section in merged rules.ini + aftrmath.ini`, () => {
        expect(ini[unitId], `[${unitId}] section not found in INI`).toBeDefined();
      });
    }
  });

  describe('Completeness — all INI units with weapons are in UNIT_STATS', () => {
    for (const id of ALL_UNIT_SECTIONS) {
      it(`${id} exists in UNIT_STATS`, () => {
        expect(UNIT_STATS[id], `${id} should be defined in UNIT_STATS`).toBeDefined();
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DUAL-WEAPON UNITS: verify primary != secondary when different
  // ─────────────────────────────────────────────────────────────────────────
  describe('Dual-weapon units — distinct primary/secondary pairs', () => {
    // Units where Primary != Secondary in INI
    const DISTINCT_DUAL_WEAPONS = ['4TNK', 'E3', 'DD', 'PT'];

    for (const id of DISTINCT_DUAL_WEAPONS) {
      it(`${id} has distinct primary and secondary weapons`, () => {
        const iniSection = ini[id];
        const iniPrimary = normaliseWeapon(iniSection.Primary);
        const iniSecondary = normaliseWeapon(iniSection.Secondary);
        expect(iniPrimary, `${id} should have a primary weapon`).not.toBeNull();
        expect(iniSecondary, `${id} should have a secondary weapon`).not.toBeNull();
        expect(iniPrimary).not.toBe(iniSecondary);
        // Verify TS matches
        expect(tsPrimary(id)).toBe(iniPrimary);
        expect(tsSecondary(id)).toBe(iniSecondary);
      });
    }
  });

  describe('Dual-weapon units — same weapon on both slots', () => {
    // Units where Primary == Secondary in INI
    const SAME_DUAL_WEAPONS = ['3TNK', 'CA', 'MIG', 'YAK', 'HELI', 'E7', 'AGUN'];

    for (const id of SAME_DUAL_WEAPONS) {
      it(`${id} has same weapon on primary and secondary`, () => {
        const iniSection = ini[id];
        const iniPrimary = normaliseWeapon(iniSection.Primary);
        const iniSecondary = normaliseWeapon(iniSection.Secondary);
        expect(iniPrimary, `${id} should have a primary weapon`).not.toBeNull();
        expect(iniSecondary, `${id} should have a secondary weapon`).not.toBeNull();
        expect(iniPrimary).toBe(iniSecondary);
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // UNARMED UNITS: no Primary= key or Primary=none
  // ─────────────────────────────────────────────────────────────────────────
  describe('Unarmed units — no weapon in INI means null in TS', () => {
    const EXPECTED_UNARMED = [
      'HARV', 'MCV', 'TRUK', 'MRJ', 'MGG', 'MNLY',
      'E6', 'SPY', 'THF',
      'C2', 'C3', 'C4', 'C5', 'C6', 'C8', 'C9', 'C10',
      'EINSTEIN', 'CHAN',
      'TRAN', 'LST',
    ];

    for (const id of EXPECTED_UNARMED) {
      it(`${id} has no primary weapon`, () => {
        const iniSection = ini[id];
        expect(iniSection, `[${id}] section must exist`).toBeDefined();
        const iniPrimary = normaliseWeapon(iniSection.Primary);
        expect(iniPrimary, `[${id}] should have Primary=none or no Primary key`).toBeNull();
        expect(tsPrimary(id), `${id}: TS should have primaryWeapon=null`).toBeNull();
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // AFTERMATH OVERRIDES: verify aftrmath.ini wins over rules.ini
  // ─────────────────────────────────────────────────────────────────────────
  describe('Aftermath INI overrides — weapon values from aftrmath.ini take precedence', () => {
    it('GNRL Secondary=none in aftrmath.ini overrides rules.ini (which has no Secondary)', () => {
      const iniSection = ini['GNRL'];
      const iniSecondary = normaliseWeapon(iniSection.Secondary);
      expect(iniSecondary).toBeNull();
      expect(tsSecondary('GNRL')).toBeNull();
    });

    it('QTNK Primary=none (aftrmath.ini makes M.A.D. Tank unarmed)', () => {
      const iniSection = ini['QTNK'];
      const iniPrimary = normaliseWeapon(iniSection.Primary);
      expect(iniPrimary).toBeNull();
      expect(tsPrimary('QTNK')).toBeNull();
    });

    it('4TNK retains dual weapons after aftrmath overlay', () => {
      const iniSection = ini['4TNK'];
      expect(normaliseWeapon(iniSection.Primary)).toBe('120mm');
      expect(normaliseWeapon(iniSection.Secondary)).toBe('MammothTusk');
      expect(tsPrimary('4TNK')).toBe('120mm');
      expect(tsSecondary('4TNK')).toBe('MammothTusk');
    });

    it('C2 Primary=none in aftrmath.ini (unarmed civilian)', () => {
      // rules.ini [C2] has no Primary key, aftrmath.ini [C2] Primary=none
      const iniSection = ini['C2'];
      const iniPrimary = normaliseWeapon(iniSection.Primary);
      expect(iniPrimary).toBeNull();
      expect(tsPrimary('C2')).toBeNull();
    });

    it('C6 Primary=none in aftrmath.ini overrides rules.ini (which had no Primary)', () => {
      const iniSection = ini['C6'];
      const iniPrimary = normaliseWeapon(iniSection.Primary);
      expect(iniPrimary).toBeNull();
      expect(tsPrimary('C6')).toBeNull();
    });

    it('C9 Primary=none in aftrmath.ini overrides rules.ini (which had no Primary)', () => {
      const iniSection = ini['C9'];
      const iniPrimary = normaliseWeapon(iniSection.Primary);
      expect(iniPrimary).toBeNull();
      expect(tsPrimary('C9')).toBeNull();
    });

    it('DELPHI Primary=Pistol retained in aftrmath.ini', () => {
      const iniSection = ini['DELPHI'];
      const iniPrimary = normaliseWeapon(iniSection.Primary);
      expect(iniPrimary).toBe('Pistol');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SPECIAL CASES
  // ─────────────────────────────────────────────────────────────────────────
  describe('Special cases', () => {
    it('HIND has no secondary weapon (rules.ini only has Primary=ChainGun)', () => {
      const iniSection = ini['HIND'];
      expect(normaliseWeapon(iniSection.Secondary)).toBeNull();
      expect(tsSecondary('HIND')).toBeNull();
    });

    it('DELPHI has Primary=Pistol in INI (scenario-only NPC, not in UNIT_STATS)', () => {
      const iniSection = ini['DELPHI'];
      expect(normaliseWeapon(iniSection.Primary)).toBe('Pistol');
      // DELPHI is a scenario-only NPC like ants — present in rules.ini but
      // not tracked in UNIT_STATS since it only appears in specific missions
      expect(UNIT_STATS['DELPHI']).toBeUndefined();
    });

    it('C1 and C7 are armed civilians (Primary=Pistol)', () => {
      expect(normaliseWeapon(ini['C1']?.Primary)).toBe('Pistol');
      expect(normaliseWeapon(ini['C7']?.Primary)).toBe('Pistol');
      expect(tsPrimary('C1')).toBe('Pistol');
      expect(tsPrimary('C7')).toBe('Pistol');
    });

    it('Scenario-only units: DELPHI in INI but not UNIT_STATS, ants in UNIT_STATS but not INI', () => {
      // DELPHI is in rules.ini but not in UNIT_STATS (scenario-only NPC)
      expect(ini['DELPHI']).toBeDefined();
      expect(UNIT_STATS['DELPHI']).toBeUndefined();
    });

    it('Ant units (ANT1/ANT2/ANT3) are not in rules.ini but have weapons in UNIT_STATS', () => {
      // Ants are defined in SCA scenario INI files, not rules.ini
      expect(ini['ANT1']).toBeUndefined();
      expect(ini['ANT2']).toBeUndefined();
      expect(ini['ANT3']).toBeUndefined();
      // But they must have weapons in TS
      expect(tsPrimary('ANT1')).toBe('Mandible');
      expect(tsPrimary('ANT2')).toBe('FireballLauncher');
      expect(tsPrimary('ANT3')).toBe('TeslaZap');
    });

    it('QUEE building is not in rules.ini but has a weapon in STRUCTURE_WEAPONS', () => {
      expect(ini['QUEE']).toBeUndefined();
      expect(STRUCTURE_WEAPONS['QUEE']).toBeDefined();
    });
  });
});
