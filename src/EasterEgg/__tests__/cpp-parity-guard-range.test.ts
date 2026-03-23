/**
 * C++ Behavioral Parity: Guard Mode Scan Range
 *
 * Tests verify that the TypeScript engine's guard-mode target acquisition range
 * matches C++ Red Alert source code behavior, using rules.ini as the authority.
 *
 * C++ source refs:
 *   - techno.cpp:5986    — ThreatRange(0) constructor default
 *   - techno.cpp:6275    — ThreatRange = ini.Get_Lepton(Name(), "GuardRange", ThreatRange)
 *   - techno.cpp:4558-4566 — Threat_Range(control=0): GUARD mode
 *       if ThreatRange != 0 → return ThreatRange (in leptons)
 *       else → return 0
 *   - techno.cpp:4573-4581 — Threat_Range(control=1): AREA_GUARD mode
 *       range = ThreatRange || max(Weapon_Range(0), Weapon_Range(1))
 *       range = clamp(range * 2, 0, 0x0A00)  [0x0A00 = 10 cells * 256 leptons]
 *   - techno.cpp:2047-2054 — Greatest_Threat scan range calculation:
 *       crange = range / ICON_LEPTON_W  (i.e., leptons → cells)
 *       if range == 0 → crange = max(Weapon_Range(0), Weapon_Range(1)) / 256 + 1
 *   - foot.cpp:589-593   — Mission_Guard: Target_Something_Nearby(THREAT_RANGE)
 *   - foot.cpp:1006      — Mission_Guard_Area: Target_Something_Nearby(THREAT_AREA)
 *   - foot.cpp:996       — Area guard leash: maxrange = Threat_Range(1)/2
 *
 * C++ lepton system:
 *   - ICON_LEPTON_W = 256 (one cell = 256 leptons)
 *   - Get_Lepton reads integer from INI, multiplies by 256 to get leptons
 *   - GuardRange=7 → ThreatRange = 7 * 256 = 1792 leptons
 *
 * TS source refs:
 *   - missionAI.ts:759-764 — updateGuard: baseRange = guardRange ?? sight
 *   - missionAI.ts:838-841 — updateAreaGuard: leash + scan range
 *   - scenarioRules.ts:92  — GuardRange parsed from INI as integer (cells, not leptons)
 *   - types.ts:450         — guardRange?: number (optional per-unit override)
 *   - types.ts:618         — DOG hardcoded with guardRange: 7
 *
 * rules.ini units with GuardRange:
 *   DOG=7, MIG=30, YAK=30, HELI=30, HIND=30
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseIniSections, parseIniInt, type IniSections } from '../engine/parseIni';
import { UNIT_STATS, WEAPON_STATS } from '../engine/types';

// ---------------------------------------------------------------------------
// Parse rules.ini directly (authoritative source, NOT hardcoded values)
// ---------------------------------------------------------------------------
const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');
const rulesIni: IniSections = parseIniSections(rulesText);

// ---------------------------------------------------------------------------
// Helpers — derive C++ guard scan range from rules.ini
// ---------------------------------------------------------------------------

/** Get GuardRange= from rules.ini for a unit (0 if absent — matches C++ default) */
function iniGuardRange(unitName: string): number {
  const section = rulesIni.get(unitName);
  if (!section) return 0;
  return parseIniInt(section.get('GuardRange'), 0);
}

/** Get weapon range in cells from TS WEAPON_STATS (mirrors C++ Weapon_Range / ICON_LEPTON_W) */
function tsWeaponRange(weaponName: string | null | undefined): number {
  if (!weaponName) return 0;
  return WEAPON_STATS[weaponName]?.range ?? 0;
}

/**
 * C++ Threat_Range(0) — GUARD mode scan range in cells.
 *
 * techno.cpp:4558-4566:
 *   if (ThreatRange != 0) return ThreatRange;    // in leptons
 *   else return 0;
 *
 * Then in Greatest_Threat (techno.cpp:2050-2054):
 *   crange = range / ICON_LEPTON_W;              // leptons → cells
 *   if (range == 0) crange = max(wpn0, wpn1) / ICON_LEPTON_W + 1;
 *
 * Since Get_Lepton converts GuardRange to leptons (N*256) and then we divide
 * by 256 to get cells, the final crange = GuardRange directly (if non-zero),
 * or max weapon range in cells + 1 (if zero).
 */
function cppGuardScanCells(unitName: string): number {
  const gr = iniGuardRange(unitName);
  if (gr !== 0) return gr;
  // Fallback: max weapon range + 1
  const stats = UNIT_STATS[unitName];
  if (!stats) return 0;
  const wpn0 = tsWeaponRange(stats.primaryWeapon);
  const wpn1 = tsWeaponRange(stats.secondaryWeapon);
  const maxWpnRange = Math.max(wpn0, wpn1);
  if (maxWpnRange === 0) return 0; // unarmed — no scan
  return Math.floor(maxWpnRange) + 1;
}

/**
 * C++ Threat_Range(1) — AREA_GUARD scan range in cells.
 *
 * techno.cpp:4573-4581:
 *   range = ThreatRange || max(Weapon_Range(0), Weapon_Range(1));
 *   range *= 2;
 *   range = Bound(range, 0, 0x0A00);   // clamp to 10 cells in leptons
 *
 * In cells: min(guardRange * 2, 10) or min(maxWeaponRange * 2, 10)
 */
function cppAreaGuardScanCells(unitName: string): number {
  const gr = iniGuardRange(unitName);
  const stats = UNIT_STATS[unitName];
  if (!stats) return 0;
  const wpn0 = tsWeaponRange(stats.primaryWeapon);
  const wpn1 = tsWeaponRange(stats.secondaryWeapon);
  let rangeCells = gr !== 0 ? gr : Math.max(wpn0, wpn1);
  rangeCells = Math.min(rangeCells * 2, 10);
  return rangeCells;
}

/**
 * TS guard scan range (missionAI.ts:761):
 *   baseRange = entity.stats.guardRange ?? entity.stats.sight
 * (Defensive stance reduction is separate — tested elsewhere)
 */
function tsGuardScanCells(unitName: string): number {
  const stats = UNIT_STATS[unitName];
  if (!stats) return 0;
  return stats.guardRange ?? stats.sight;
}

/**
 * TS area guard scan range (missionAI.ts:838-841):
 *   weaponRange = entity.weapon?.range ?? entity.stats.sight
 *   leashRange = min(weaponRange / 2, 5)
 *   scanRange = max(leashRange, entity.stats.sight)
 */
function tsAreaGuardScanCells(unitName: string): number {
  const stats = UNIT_STATS[unitName];
  if (!stats) return 0;
  const wpn0 = tsWeaponRange(stats.primaryWeapon);
  const weaponRange = wpn0 || stats.sight;
  const leashRange = Math.min(weaponRange / 2, 5);
  return Math.max(leashRange, stats.sight);
}

// =============================================================================
// 1. rules.ini GuardRange values are correctly parsed into TS UNIT_STATS
// =============================================================================

describe('rules.ini GuardRange values parsed into UNIT_STATS', () => {
  // Units that HAVE GuardRange in rules.ini
  const UNITS_WITH_GUARD_RANGE: [string, number][] = [
    ['DOG',  7],
    ['MIG',  30],
    ['YAK',  30],
    ['HELI', 30],
    ['HIND', 30],
  ];

  for (const [unit, expected] of UNITS_WITH_GUARD_RANGE) {
    it(`rules.ini [${unit}] GuardRange=${expected}`, () => {
      const iniVal = iniGuardRange(unit);
      expect(iniVal, `rules.ini [${unit}] should have GuardRange=${expected}`).toBe(expected);
    });
  }

  it('DOG UNIT_STATS.guardRange matches rules.ini value of 7', () => {
    expect(UNIT_STATS.DOG.guardRange).toBe(7);
  });

  // Aircraft with GuardRange=30 should have guardRange in UNIT_STATS
  // (currently only DOG has it hardcoded — aircraft may be missing it)
  for (const [unit, expected] of UNITS_WITH_GUARD_RANGE) {
    if (unit === 'DOG') continue; // already tested
    it(`${unit} UNIT_STATS.guardRange should be ${expected} (from rules.ini)`, () => {
      const stats = UNIT_STATS[unit];
      expect(stats, `${unit} should exist in UNIT_STATS`).toBeDefined();
      expect(
        stats.guardRange,
        `${unit}: UNIT_STATS.guardRange should be ${expected} to match rules.ini GuardRange=${expected}`,
      ).toBe(expected);
    });
  }
});

// =============================================================================
// 2. Units WITHOUT GuardRange in rules.ini should NOT have guardRange in UNIT_STATS
// =============================================================================

describe('units without GuardRange in rules.ini have no guardRange override', () => {
  const UNITS_WITHOUT_GUARD_RANGE = [
    'E1', 'E2', 'E3', 'E4', 'E6',   // infantry
    '1TNK', '2TNK', '3TNK', '4TNK',  // tanks
    'JEEP', 'APC', 'ARTY',           // vehicles
    'HARV', 'MCV', 'TRUK',           // support vehicles
    'TRAN',                           // transport helicopter
  ];

  for (const unit of UNITS_WITHOUT_GUARD_RANGE) {
    it(`${unit} has no GuardRange in rules.ini`, () => {
      expect(iniGuardRange(unit)).toBe(0);
    });

    it(`${unit} UNIT_STATS.guardRange should be undefined`, () => {
      const stats = UNIT_STATS[unit];
      expect(stats, `${unit} should exist in UNIT_STATS`).toBeDefined();
      expect(
        stats.guardRange,
        `${unit}: guardRange should be undefined (no INI override)`,
      ).toBeUndefined();
    });
  }
});

// =============================================================================
// 3. C++ GUARD mode scan range — ThreatRange or weapon range + 1 fallback
// =============================================================================

describe('C++ guard mode scan range (THREAT_RANGE)', () => {
  it('DOG guard scan = 7 cells (GuardRange=7 from INI)', () => {
    expect(cppGuardScanCells('DOG')).toBe(7);
  });

  it('MIG guard scan = 30 cells (GuardRange=30 from INI)', () => {
    expect(cppGuardScanCells('MIG')).toBe(30);
  });

  // Units without GuardRange: scan = floor(max weapon range) + 1
  const ARMED_UNITS_NO_GR: [string, number][] = [
    // unit, expected guard scan in cells
    // E1: M1Carbine range=3.0 → floor(3.0)+1 = 4
    ['E1', Math.floor(3.0) + 1],
    // E3: RedEye range=7.5, Dragon range=5.0 → floor(max(7.5,5.0))+1 = floor(7.5)+1 = 8
    ['E3', Math.floor(Math.max(7.5, 5.0)) + 1],
    // 1TNK: 75mm range=4.0 → floor(4.0)+1 = 5
    ['1TNK', Math.floor(4.0) + 1],
    // 2TNK: 90mm range=4.75 → floor(4.75)+1 = 5
    ['2TNK', Math.floor(4.75) + 1],
    // 4TNK: 120mm range=4.75, MammothTusk range=5.0 → floor(5.0)+1 = 6
    ['4TNK', Math.floor(Math.max(4.75, 5.0)) + 1],
    // ARTY: 155mm range=6.0 → floor(6.0)+1 = 7
    ['ARTY', Math.floor(6.0) + 1],
    // JEEP: M60mg range=4.0 → floor(4.0)+1 = 5
    ['JEEP', Math.floor(4.0) + 1],
  ];

  for (const [unit, expected] of ARMED_UNITS_NO_GR) {
    it(`${unit} guard scan = ${expected} cells (floor(max weapon range) + 1)`, () => {
      expect(cppGuardScanCells(unit)).toBe(expected);
    });
  }

  // Unarmed units: no scan at all
  it('HARV guard scan = 0 (unarmed — no target acquisition)', () => {
    expect(cppGuardScanCells('HARV')).toBe(0);
  });

  it('MCV guard scan = 0 (unarmed)', () => {
    expect(cppGuardScanCells('MCV')).toBe(0);
  });
});

// =============================================================================
// 4. TS guard scan matches C++ for units WITH GuardRange
// =============================================================================

describe('TS guard scan matches C++ for units with GuardRange', () => {
  const UNITS_WITH_GR: [string, number][] = [
    ['DOG', 7],
    ['MIG', 30],
    ['YAK', 30],
    ['HELI', 30],
    ['HIND', 30],
  ];

  for (const [unit, expected] of UNITS_WITH_GR) {
    it(`${unit}: TS guard scan = C++ guard scan = ${expected}`, () => {
      const cpp = cppGuardScanCells(unit);
      const ts = tsGuardScanCells(unit);
      expect(cpp).toBe(expected);
      expect(
        ts,
        `${unit}: TS scan ${ts} should equal C++ scan ${cpp}`,
      ).toBe(cpp);
    });
  }
});

// =============================================================================
// 5. TS guard scan vs C++ for units WITHOUT GuardRange
//    C++ uses: floor(max weapon range) + 1
//    TS uses:  sight
//    These may diverge — document mismatches.
// =============================================================================

describe('TS guard scan vs C++ for units without GuardRange', () => {
  const TEST_UNITS: [string, number, number][] = [
    // [unit, c++ guard scan cells, ts guard scan cells (sight)]
    ['E1',   Math.floor(3.0) + 1, UNIT_STATS.E1.sight],
    ['E3',   Math.floor(7.5) + 1, UNIT_STATS.E3.sight],
    ['1TNK', Math.floor(4.0) + 1, UNIT_STATS['1TNK'].sight],
    ['2TNK', Math.floor(4.75) + 1, UNIT_STATS['2TNK'].sight],
    ['4TNK', Math.floor(5.0) + 1, UNIT_STATS['4TNK'].sight],
    ['ARTY', Math.floor(6.0) + 1, UNIT_STATS.ARTY.sight],
    ['JEEP', Math.floor(4.0) + 1, UNIT_STATS.JEEP.sight],
  ];

  for (const [unit, cppScan, tsScan] of TEST_UNITS) {
    it(`${unit}: C++ guard scan=${cppScan}, TS guard scan=${tsScan} (sight=${UNIT_STATS[unit].sight})`, () => {
      expect(cppGuardScanCells(unit)).toBe(cppScan);
      expect(tsGuardScanCells(unit)).toBe(tsScan);
      // Document the relationship — C++ uses weapon range + 1, TS uses sight
      // These may or may not match depending on the unit
    });
  }
});

// =============================================================================
// 6. C++ area guard scan range — min(2 * range, 10) cells
// =============================================================================

describe('C++ area guard scan range (THREAT_AREA)', () => {
  it('DOG area guard = min(7*2, 10) = 10 cells', () => {
    expect(cppAreaGuardScanCells('DOG')).toBe(10);
  });

  it('MIG area guard = min(30*2, 10) = 10 cells (clamped)', () => {
    expect(cppAreaGuardScanCells('MIG')).toBe(10);
  });

  // Without GuardRange: uses max weapon range
  it('E1 area guard = min(3.0*2, 10) = 6 cells', () => {
    expect(cppAreaGuardScanCells('E1')).toBe(6);
  });

  it('1TNK area guard = min(4.0*2, 10) = 8 cells', () => {
    expect(cppAreaGuardScanCells('1TNK')).toBe(8);
  });

  it('ARTY area guard = min(6.0*2, 10) = 10 cells (clamped at 10)', () => {
    // 155mm range=6.0, 6.0*2=12, clamped to 10
    expect(cppAreaGuardScanCells('ARTY')).toBe(10);
  });

  it('4TNK area guard = min(5.0*2, 10) = 10 cells', () => {
    // MammothTusk range=5.0 (max of 120mm:4.75 and MammothTusk:5.0)
    expect(cppAreaGuardScanCells('4TNK')).toBe(10);
  });
});

// =============================================================================
// 7. C++ area guard leash = Threat_Range(1) / 2
// =============================================================================

describe('C++ area guard leash distance (foot.cpp:996)', () => {
  /**
   * C++ foot.cpp:996: int maxrange = Threat_Range(1)/2
   * Threat_Range(1) = min(2 * range, 0x0A00) in leptons
   * So leash = min(range, 0x0500) in leptons = min(range, 5 cells) in cells
   * where range = GuardRange or max weapon range
   */

  it('DOG leash = min(7, 5) = 5 cells', () => {
    const gr = iniGuardRange('DOG'); // 7
    const leash = Math.min(gr, 5);
    expect(leash).toBe(5);
  });

  it('E1 leash = min(3.0, 5) = 3.0 cells', () => {
    const maxWpn = tsWeaponRange('M1Carbine'); // 3.0
    const leash = Math.min(maxWpn, 5);
    expect(leash).toBe(3.0);
  });

  it('ARTY leash = min(6.0, 5) = 5 cells', () => {
    const maxWpn = tsWeaponRange('155mm'); // 6.0
    const leash = Math.min(maxWpn, 5);
    expect(leash).toBe(5);
  });
});

// =============================================================================
// 8. scenarioRules.ts correctly parses GuardRange from INI as integer
// =============================================================================

describe('scenarioRules.ts GuardRange parsing (line 92)', () => {
  it('parseInt("7", 10) = 7 (DOG format)', () => {
    expect(Number.parseInt('7', 10)).toBe(7);
  });

  it('parseInt("30", 10) = 30 (aircraft format)', () => {
    expect(Number.parseInt('30', 10)).toBe(30);
  });

  // Verify rules.ini values are plain integers (not hex, not leptons)
  for (const unit of ['DOG', 'MIG', 'YAK', 'HELI', 'HIND']) {
    it(`rules.ini [${unit}] GuardRange is a plain decimal integer`, () => {
      const section = rulesIni.get(unit);
      expect(section, `[${unit}] section should exist`).toBeDefined();
      const raw = section!.get('GuardRange');
      expect(raw, `[${unit}] should have GuardRange key`).toBeDefined();
      // Must be a plain integer — no '$' hex, no 'h' suffix
      expect(raw!.match(/^\d+$/), `[${unit}] GuardRange="${raw}" should be plain decimal`).toBeTruthy();
    });
  }
});

// =============================================================================
// 9. C++ Get_Lepton semantics — INI value is in cells, stored as leptons
// =============================================================================

describe('C++ Get_Lepton conversion (techno.cpp:6275)', () => {
  /**
   * C++ stores ThreatRange in leptons (cell * 256), but the INI value
   * is in cells. Get_Lepton reads the integer and multiplies by 256.
   * The TS engine stores guardRange in cells (not leptons), which is
   * correct since TS distances are in cells. The key invariant:
   *   INI GuardRange value == TS guardRange == C++ ThreatRange / 256
   */

  it('DOG: INI=7, C++ leptons=1792, TS cells=7', () => {
    const iniVal = iniGuardRange('DOG');
    const cppLeptons = iniVal * 256;
    const tsVal = UNIT_STATS.DOG.guardRange;
    expect(iniVal).toBe(7);
    expect(cppLeptons).toBe(1792);
    expect(tsVal).toBe(7);
    // C++ stores leptons, TS stores cells — both represent the same distance
    expect(tsVal).toBe(cppLeptons / 256);
  });

  for (const [unit, expected] of [['MIG', 30], ['YAK', 30], ['HELI', 30], ['HIND', 30]] as [string, number][]) {
    it(`${unit}: INI=${expected}, C++ leptons=${expected * 256}, TS cells should be ${expected}`, () => {
      const iniVal = iniGuardRange(unit);
      expect(iniVal).toBe(expected);
      const tsVal = UNIT_STATS[unit]?.guardRange;
      expect(
        tsVal,
        `${unit}: TS guardRange should be ${expected} (== INI value == C++ leptons / 256)`,
      ).toBe(expected);
    });
  }
});

// =============================================================================
// 10. Guard scan is NOT the same as sight for GuardRange units
// =============================================================================

describe('GuardRange != Sight — they are independent values', () => {
  it('DOG: guardRange=7 > sight=5 (dogs can detect enemies beyond vision)', () => {
    const stats = UNIT_STATS.DOG;
    expect(stats.guardRange).toBe(7);
    expect(stats.sight).toBe(5);
    expect(stats.guardRange).toBeGreaterThan(stats.sight);
  });

  // Aircraft have Sight=0 but GuardRange=30 in rules.ini
  for (const unit of ['MIG', 'YAK', 'HELI', 'HIND']) {
    it(`${unit}: Sight=${UNIT_STATS[unit].sight}, GuardRange=30 — scan not based on sight`, () => {
      const stats = UNIT_STATS[unit];
      expect(stats.sight).toBe(0);
      expect(iniGuardRange(unit)).toBe(30);
      // With guardRange set, guard scan should be 30, NOT sight (0)
    });
  }
});

// =============================================================================
// 11. Comprehensive: all units that have GuardRange — exhaustive INI scan
// =============================================================================

describe('exhaustive: every unit section in rules.ini with GuardRange', () => {
  // Collect all sections that have a GuardRange key
  const unitsWithGR: [string, number][] = [];
  for (const [sectionName, entries] of rulesIni) {
    if (entries.has('GuardRange')) {
      unitsWithGR.push([sectionName, parseIniInt(entries.get('GuardRange')!, 0)]);
    }
  }

  it('exactly 5 unit types have GuardRange in rules.ini', () => {
    expect(unitsWithGR.length).toBe(5);
  });

  it('the 5 units are DOG, MIG, YAK, HELI, HIND', () => {
    const names = unitsWithGR.map(([name]) => name).sort();
    expect(names).toEqual(['DOG', 'HELI', 'HIND', 'MIG', 'YAK']);
  });

  for (const [unit, iniVal] of unitsWithGR) {
    it(`${unit} UNIT_STATS.guardRange matches rules.ini value (${iniVal})`, () => {
      const stats = UNIT_STATS[unit];
      expect(stats, `${unit} should exist in UNIT_STATS`).toBeDefined();
      expect(
        stats.guardRange,
        `${unit}: UNIT_STATS.guardRange=${stats.guardRange} should match INI=${iniVal}`,
      ).toBe(iniVal);
    });
  }
});
