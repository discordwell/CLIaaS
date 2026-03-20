/**
 * C++ Behavioral Parity Tests — INI Parsing (parseIni.ts)
 *
 * Tests parseIniSections(), normalizeOwnerToFaction(), parsePrerequisiteList(),
 * and interpretProductionPrerequisites() against C++ ini.cpp, house.h, bdata.cpp,
 * and scenario.cpp behaviors.
 *
 * C++ references:
 *   - ini.cpp: Read_INI_Data() — section/key/value parsing, comment handling
 *   - ini.cpp: Get_Bool() — boolean value normalization
 *   - ini.cpp: Get_Int(), Get_Fixed() — numeric value parsing
 *   - house.h: HousesType enum — faction/owner name mapping
 *   - scenario.cpp: Read_Scenario_INI() — waypoint cell→coord conversion
 *   - bdata.cpp: BuildingTypeClass::Read_INI() — prerequisite string parsing
 *   - teamtype.cpp: TeamTypeClass::Read_INI() — team type definition parsing
 */

import { describe, it, expect } from 'vitest';
import {
  parseIniSections,
  normalizeOwnerToFaction,
  parsePrerequisiteList,
  interpretProductionPrerequisites,
} from '../engine/parseIni';
import type { IniSections } from '../engine/parseIni';
import type { ProductionItem, Faction, CellPos } from '../engine/types';
import { cellIndexToPos, MAP_CELLS } from '../engine/types';
import { parseScenarioINI } from '../engine/scenario';

// ============================================================
// Section 1: Section Parsing — C++ ini.cpp Read_INI_Data()
// ============================================================
describe('Section parsing (ini.cpp Read_INI_Data)', () => {
  it('parses [SectionName] headers into Map keys', () => {
    const text = `[General]\nKey=Value\n[Combat]\nDamage=100`;
    const sections = parseIniSections(text);
    expect(sections.has('General'), 'General section exists').toBe(true);
    expect(sections.has('Combat'), 'Combat section exists').toBe(true);
  });

  it('parses Key=Value pairs within sections', () => {
    const text = `[General]\nRepairStep=5\nRepairPercent=25%`;
    const sections = parseIniSections(text);
    const general = sections.get('General')!;
    expect(general.get('RepairStep'), 'RepairStep=5').toBe('5');
    expect(general.get('RepairPercent'), 'RepairPercent=25%').toBe('25%');
  });

  it('trims whitespace from keys and values — C++ ini.cpp strtrim()', () => {
    const text = `[Section]\n  Key  =  Value with spaces  `;
    const sections = parseIniSections(text);
    expect(sections.get('Section')!.get('Key')).toBe('Value with spaces');
  });

  it('handles empty sections', () => {
    const text = `[Empty]\n[HasData]\nKey=Val`;
    const sections = parseIniSections(text);
    expect(sections.has('Empty'), 'Empty section registered').toBe(true);
    expect(sections.get('Empty')!.size, 'Empty section has no keys').toBe(0);
    expect(sections.get('HasData')!.get('Key')).toBe('Val');
  });

  it('last value wins for duplicate keys in same section — C++ ini.cpp overwrites', () => {
    // C++ INI parser: later entries for the same key overwrite earlier ones
    const text = `[Section]\nSpeed=5\nSpeed=10`;
    const sections = parseIniSections(text);
    expect(sections.get('Section')!.get('Speed'), 'last value wins').toBe('10');
  });

  it('handles values containing = signs — only first = is the delimiter', () => {
    // C++ ini.cpp splits on first '=' only; value may contain additional '='
    const text = `[Section]\nFormula=A=B+C`;
    const sections = parseIniSections(text);
    expect(sections.get('Section')!.get('Formula')).toBe('A=B+C');
  });

  it('ignores lines before first section header — C++ ini.cpp requires [section]', () => {
    const text = `OrphanKey=OrphanValue\n[Section]\nKey=Value`;
    const sections = parseIniSections(text);
    // OrphanKey should not appear in any section
    expect(sections.has(''), 'no empty-string section').toBe(false);
    expect(sections.get('Section')!.get('Key')).toBe('Value');
  });

  it('handles empty string input', () => {
    const sections = parseIniSections('');
    expect(sections.size).toBe(0);
  });

  it('handles multiple sections with same name — first registration, keys merge', () => {
    // C++ ini.cpp: re-encountering a section selects it; keys merge into existing
    const text = `[Section]\nA=1\n[Other]\nB=2\n[Section]\nC=3`;
    const sections = parseIniSections(text);
    const section = sections.get('Section')!;
    expect(section.get('A'), 'first key preserved').toBe('1');
    expect(section.get('C'), 'later key added').toBe('3');
  });

  it('ignores blank lines — C++ ini.cpp skips empty lines', () => {
    const text = `\n\n[Section]\n\nKey=Value\n\n`;
    const sections = parseIniSections(text);
    expect(sections.get('Section')!.get('Key')).toBe('Value');
  });
});

// ============================================================
// Section 2: Comment Handling — C++ ini.cpp
// ============================================================
describe('Comment handling (ini.cpp)', () => {
  it('ignores lines starting with ; — C++ ini.cpp semicolon comment', () => {
    const text = `[Section]\n; This is a comment\nKey=Value\n;AnotherComment`;
    const sections = parseIniSections(text);
    const section = sections.get('Section')!;
    expect(section.size, 'only Key=Value parsed').toBe(1);
    expect(section.get('Key')).toBe('Value');
  });

  it('does NOT strip inline ; comments from values — TS behavior', () => {
    // C++ ini.cpp strips inline comments after ';', but the TS parseIniSections
    // does NOT do this — it takes everything after '=' as the value.
    // This documents the current TS behavior.
    const text = `[Section]\nKey=Value ; inline comment`;
    const sections = parseIniSections(text);
    // TS keeps the inline comment as part of the value
    expect(sections.get('Section')!.get('Key')).toBe('Value ; inline comment');
  });

  it('does NOT handle # comment lines — TS parity gap vs C++ ini.cpp', () => {
    // C++ ini.cpp treats '#' as a comment leader. The TS parser does NOT.
    // This test documents the known parity gap.
    const text = `[Section]\n# hash comment\nKey=Value`;
    const sections = parseIniSections(text);
    const section = sections.get('Section')!;
    // In TS, '# hash comment' would be ignored only if there's no '=' in it
    // Since there's no '=', it gets skipped by the eq > 0 check
    expect(section.get('Key')).toBe('Value');
    // But a hash-prefixed KEY=VALUE line would NOT be ignored in TS:
    const text2 = `[Section]\n#Comment=yes`;
    const sections2 = parseIniSections(text2);
    // TS parses this as key="#Comment", value="yes"
    expect(sections2.get('Section')!.has('#Comment'),
      'TS does NOT treat # as comment leader — parity gap with C++ ini.cpp').toBe(true);
  });
});

// ============================================================
// Section 3: Case Insensitivity — C++ ini.cpp uses stricmp
// ============================================================
describe('Case insensitivity (ini.cpp stricmp)', () => {
  it('section names are stored as-is — TS does NOT normalize case', () => {
    // C++ ini.cpp uses case-insensitive comparison for section lookups (stricmp).
    // TS parseIniSections stores section names verbatim.
    // This documents the current behavior (lookups must use exact case).
    const text = `[general]\nKey=1\n[General]\nKey=2`;
    const sections = parseIniSections(text);
    // Both exist as separate sections because Map keys are case-sensitive
    expect(sections.has('general'), 'lowercase section exists').toBe(true);
    expect(sections.has('General'), 'titlecase section exists').toBe(true);
    expect(sections.get('general')!.get('Key')).toBe('1');
    expect(sections.get('General')!.get('Key')).toBe('2');
  });

  it('key names are stored as-is — TS does NOT normalize case', () => {
    // C++ ini.cpp uses case-insensitive key lookup. TS stores keys verbatim.
    const text = `[Section]\nspeed=5\nSpeed=10`;
    const sections = parseIniSections(text);
    const section = sections.get('Section')!;
    // Both keys coexist (Map is case-sensitive)
    expect(section.has('speed'), 'lowercase key exists').toBe(true);
    expect(section.has('Speed'), 'titlecase key exists').toBe(true);
  });

  it('normalizeOwnerToFaction IS case-insensitive — matches C++ house.h', () => {
    // C++ house.h uses case-insensitive comparison for house name resolution.
    // normalizeOwnerToFaction lowercases before matching — correct parity.
    expect(normalizeOwnerToFaction('ENGLAND')).toBe('allied');
    expect(normalizeOwnerToFaction('england')).toBe('allied');
    expect(normalizeOwnerToFaction('England')).toBe('allied');
    expect(normalizeOwnerToFaction('USSR')).toBe('soviet');
    expect(normalizeOwnerToFaction('ussr')).toBe('soviet');
  });
});

// ============================================================
// Section 4: Owner/Faction Normalization — C++ house.h HousesType
// ============================================================
describe('Owner/faction normalization (house.h HousesType)', () => {
  // C++ house.h enum HousesType maps country names to factions:
  //   HOUSE_SPAIN, HOUSE_GREECE, HOUSE_ENGLAND, HOUSE_FRANCE,
  //   HOUSE_GERMANY, HOUSE_TURKEY → Allied
  //   HOUSE_USSR, HOUSE_UKRAINE → Soviet
  //   HOUSE_GOOD (GoodGuy) → Allied meta-house
  //   HOUSE_BAD (BadGuy) → Soviet meta-house

  // Individual Allied country names
  const ALLIED_COUNTRIES: [string, string][] = [
    ['Spain', 'allied'],
    ['Greece', 'allied'],
    ['England', 'allied'],
    ['France', 'allied'],
    ['Germany', 'allied'],
    ['Turkey', 'allied'],
  ];

  for (const [country, expected] of ALLIED_COUNTRIES) {
    it(`${country} → ${expected} (C++ HOUSE_${country.toUpperCase()})`, () => {
      expect(normalizeOwnerToFaction(country), `${country} should be ${expected}`).toBe(expected);
    });
  }

  // Individual Soviet country names
  const SOVIET_COUNTRIES: [string, string][] = [
    ['USSR', 'soviet'],
    ['Ukraine', 'soviet'],
  ];

  for (const [country, expected] of SOVIET_COUNTRIES) {
    it(`${country} → ${expected} (C++ HOUSE_${country.toUpperCase()})`, () => {
      expect(normalizeOwnerToFaction(country), `${country} should be ${expected}`).toBe(expected);
    });
  }

  // Meta-houses
  it('GoodGuy → allied (C++ HOUSE_GOOD)', () => {
    expect(normalizeOwnerToFaction('GoodGuy')).toBe('allied');
  });

  it('BadGuy → soviet (C++ HOUSE_BAD)', () => {
    expect(normalizeOwnerToFaction('BadGuy')).toBe('soviet');
  });

  // Multi-owner strings (rules.ini Owner= field uses comma-separated lists)
  it('"allies" alias → allied', () => {
    expect(normalizeOwnerToFaction('allies')).toBe('allied');
  });

  it('"soviet" alias → soviet', () => {
    expect(normalizeOwnerToFaction('soviet')).toBe('soviet');
  });

  it('comma-separated mixed factions → both', () => {
    // C++ rules.ini: Owner=allies,soviet means both factions can build
    expect(normalizeOwnerToFaction('allies,soviet')).toBe('both');
    expect(normalizeOwnerToFaction('soviet,allies')).toBe('both');
    expect(normalizeOwnerToFaction('England,USSR')).toBe('both');
  });

  it('comma-separated same faction → that faction', () => {
    expect(normalizeOwnerToFaction('Spain,Greece')).toBe('allied');
    expect(normalizeOwnerToFaction('USSR,Ukraine')).toBe('soviet');
  });

  // Edge cases
  it('undefined input → undefined', () => {
    expect(normalizeOwnerToFaction(undefined)).toBeUndefined();
  });

  it('empty string → undefined', () => {
    expect(normalizeOwnerToFaction('')).toBeUndefined();
  });

  it('unrecognized owner → undefined', () => {
    expect(normalizeOwnerToFaction('Nod')).toBeUndefined();
  });

  it('whitespace around comma-separated names is trimmed', () => {
    expect(normalizeOwnerToFaction(' allies , soviet ')).toBe('both');
    expect(normalizeOwnerToFaction('  england  ')).toBe('allied');
  });
});

// ============================================================
// Section 5: Prerequisite Parsing — C++ bdata.cpp
// ============================================================
describe('Prerequisite parsing (bdata.cpp BuildingTypeClass::Read_INI)', () => {
  // C++ bdata.cpp: Prerequisite= field is a comma-separated list of structure type names.
  // First entry is the primary prerequisite; second (if present) is the tech prerequisite.

  it('single prerequisite → array with one uppercased entry', () => {
    expect(parsePrerequisiteList('FACT')).toEqual(['FACT']);
    expect(parsePrerequisiteList('fact')).toEqual(['FACT']);
  });

  it('two prerequisites → array with two uppercased entries', () => {
    // C++ bdata.cpp: "FACT,POWR" means FACT is primary, POWR is tech prereq
    expect(parsePrerequisiteList('FACT,POWR')).toEqual(['FACT', 'POWR']);
  });

  it('multiple prerequisites → all entries preserved and uppercased', () => {
    expect(parsePrerequisiteList('weap,dome,stek')).toEqual(['WEAP', 'DOME', 'STEK']);
  });

  it('whitespace around entries is trimmed', () => {
    expect(parsePrerequisiteList(' FACT , POWR ')).toEqual(['FACT', 'POWR']);
  });

  it('empty string → empty array', () => {
    expect(parsePrerequisiteList('')).toEqual([]);
  });

  it('undefined → empty array', () => {
    expect(parsePrerequisiteList(undefined)).toEqual([]);
  });

  it('trailing comma produces no empty entries', () => {
    expect(parsePrerequisiteList('FACT,')).toEqual(['FACT']);
  });
});

// ============================================================
// Section 6: interpretProductionPrerequisites — C++ bdata.cpp
// ============================================================
describe('interpretProductionPrerequisites (bdata.cpp prerequisite logic)', () => {
  // C++ bdata.cpp interprets Prerequisite= differently for structures vs units:
  //   Structures: prereqs[0] → prerequisite, prereqs[1] → techPrereq
  //   Units: if prereqs[0] == default factory, then prereqs[1] → techPrereq
  //          otherwise prereqs[0] → techPrereq (factory stays as default)

  const makeItem = (overrides: Partial<ProductionItem>): ProductionItem => ({
    type: 'TEST',
    name: 'Test',
    cost: 100,
    buildTime: 30,
    prerequisite: 'WEAP',
    faction: 'allied' as Faction,
    ...overrides,
  });

  describe('structure prerequisites', () => {
    it('single prereq → replaces prerequisite, no techPrereq', () => {
      const item = makeItem({ isStructure: true, prerequisite: 'FACT' });
      const result = interpretProductionPrerequisites(item, 'POWR');
      expect(result.prerequisite, 'prerequisite becomes first prereq').toBe('POWR');
      expect(result.techPrereq, 'no tech prereq').toBeUndefined();
    });

    it('two prereqs → first=prerequisite, second=techPrereq', () => {
      const item = makeItem({ isStructure: true, prerequisite: 'FACT' });
      const result = interpretProductionPrerequisites(item, 'BARR,DOME');
      expect(result.prerequisite).toBe('BARR');
      expect(result.techPrereq).toBe('DOME');
    });
  });

  describe('unit prerequisites', () => {
    it('prereq matches default factory → techPrereq from second entry', () => {
      // C++ bdata.cpp: if Prerequisite= starts with the unit's factory, the second
      // entry becomes the techPrereq. E.g., 4TNK: Prerequisite=weap,stek
      const item = makeItem({ prerequisite: 'WEAP' });
      const result = interpretProductionPrerequisites(item, 'WEAP,STEK');
      expect(result.prerequisite, 'factory unchanged').toBe('WEAP');
      expect(result.techPrereq, 'second entry is tech prereq').toBe('STEK');
    });

    it('prereq does NOT match default factory → first entry becomes techPrereq', () => {
      // C++ bdata.cpp: if Prerequisite= doesn't start with the factory,
      // the first entry is treated as the techPrereq
      const item = makeItem({ prerequisite: 'WEAP' });
      const result = interpretProductionPrerequisites(item, 'DOME');
      expect(result.prerequisite, 'factory stays as default').toBe('WEAP');
      expect(result.techPrereq, 'first entry becomes tech prereq').toBe('DOME');
    });

    it('empty/undefined prereq → keeps defaults, no techPrereq', () => {
      const item = makeItem({ prerequisite: 'WEAP', techPrereq: undefined });
      const result = interpretProductionPrerequisites(item, undefined);
      expect(result.prerequisite).toBe('WEAP');
      expect(result.techPrereq).toBeUndefined();
    });
  });

  describe('real rules.ini prerequisite examples', () => {
    it('4TNK (Mammoth): Prerequisite=weap,stek → factory=WEAP, tech=STEK', () => {
      // C++ rules.ini line 549: [4TNK] Prerequisite=weap,stek
      const item = makeItem({ type: '4TNK', prerequisite: 'WEAP' });
      const result = interpretProductionPrerequisites(item, 'weap,stek');
      expect(result.prerequisite).toBe('WEAP');
      expect(result.techPrereq).toBe('STEK');
    });

    it('V2RL: Prerequisite=weap,dome → factory=WEAP, tech=DOME', () => {
      // C++ rules.ini line 482: [V2RL] Prerequisite=weap,dome
      const item = makeItem({ type: 'V2RL', prerequisite: 'WEAP' });
      const result = interpretProductionPrerequisites(item, 'weap,dome');
      expect(result.prerequisite).toBe('WEAP');
      expect(result.techPrereq).toBe('DOME');
    });

    it('FTUR: Prerequisite=tent → structure, so prerequisite=TENT', () => {
      // C++ rules.ini: [FTUR] Prerequisite=tent
      const item = makeItem({ type: 'FTUR', isStructure: true, prerequisite: 'BARR' });
      const result = interpretProductionPrerequisites(item, 'tent');
      expect(result.prerequisite).toBe('TENT');
      expect(result.techPrereq).toBeUndefined();
    });

    it('DOG: Prerequisite=kenn → techPrereq=KENN (not factory match)', () => {
      // C++ rules.ini line 781: [DOG] Prerequisite=kenn
      const item = makeItem({ type: 'DOG', prerequisite: 'TENT' });
      const result = interpretProductionPrerequisites(item, 'kenn');
      expect(result.prerequisite, 'factory stays TENT').toBe('TENT');
      expect(result.techPrereq, 'KENN becomes tech prereq').toBe('KENN');
    });
  });
});

// ============================================================
// Section 7: Boolean Value Parsing — C++ ini.cpp Get_Bool()
// ============================================================
describe('Boolean value parsing (ini.cpp Get_Bool)', () => {
  // C++ ini.cpp Get_Bool(): accepts "yes"/"no", "true"/"false", "1"/"0",
  // "on"/"off" — all case-insensitive.
  // The TS parseIniSections stores raw strings; boolean interpretation
  // happens at the caller. This test documents the patterns that must work.

  const TRUTHY_STRINGS = ['yes', 'Yes', 'YES', 'true', 'True', 'TRUE', '1', 'on', 'On'];
  const FALSY_STRINGS = ['no', 'No', 'NO', 'false', 'False', 'FALSE', '0', 'off', 'Off'];

  // Helper: C++ Get_Bool equivalent
  function parseBool(value: string): boolean {
    const lower = value.toLowerCase();
    return lower === 'yes' || lower === 'true' || lower === '1' || lower === 'on';
  }

  for (const truthy of TRUTHY_STRINGS) {
    it(`"${truthy}" → true (C++ Get_Bool)`, () => {
      const text = `[Section]\nFlag=${truthy}`;
      const sections = parseIniSections(text);
      const raw = sections.get('Section')!.get('Flag')!;
      expect(parseBool(raw), `"${truthy}" should be truthy`).toBe(true);
    });
  }

  for (const falsy of FALSY_STRINGS) {
    it(`"${falsy}" → false (C++ Get_Bool)`, () => {
      const text = `[Section]\nFlag=${falsy}`;
      const sections = parseIniSections(text);
      const raw = sections.get('Section')!.get('Flag')!;
      expect(parseBool(raw), `"${falsy}" should be falsy`).toBe(false);
    });
  }
});

// ============================================================
// Section 8: Numeric Value Parsing — C++ ini.cpp Get_Int, Get_Fixed
// ============================================================
describe('Numeric value parsing (ini.cpp Get_Int, Get_Fixed)', () => {
  // C++ ini.cpp Get_Int(): calls atoi() on the INI value string
  // C++ ini.cpp Get_Fixed(): parses fixed-point values (e.g. "0.25")
  // TS consumers use parseInt() / parseFloat() / Number() on raw strings.

  it('integer values parse correctly via parseInt — C++ Get_Int/atoi', () => {
    const text = `[Unit]\nSpeed=5\nStrength=400\nCost=1700\nAmmo=-1`;
    const sections = parseIniSections(text);
    const unit = sections.get('Unit')!;

    const cases: [string, number][] = [
      ['Speed', 5],
      ['Strength', 400],
      ['Cost', 1700],
      ['Ammo', -1],
    ];

    for (const [key, expected] of cases) {
      expect(parseInt(unit.get(key)!, 10), `${key}=${expected}`).toBe(expected);
    }
  });

  it('float/fixed-point values parse correctly via parseFloat — C++ Get_Fixed', () => {
    const text = `[General]\nRepairPercent=0.25\nCondRed=0.25\nCondYellow=0.5`;
    const sections = parseIniSections(text);
    const general = sections.get('General')!;

    const cases: [string, number][] = [
      ['RepairPercent', 0.25],
      ['CondRed', 0.25],
      ['CondYellow', 0.5],
    ];

    for (const [key, expected] of cases) {
      expect(parseFloat(general.get(key)!), `${key}=${expected}`).toBe(expected);
    }
  });

  it('zero values parse correctly', () => {
    const text = `[Section]\nValue=0`;
    const sections = parseIniSections(text);
    expect(parseInt(sections.get('Section')!.get('Value')!, 10)).toBe(0);
  });

  it('large values parse correctly — C++ atoi handles up to INT_MAX', () => {
    const text = `[Section]\nBigValue=16384`;
    const sections = parseIniSections(text);
    expect(parseInt(sections.get('Section')!.get('BigValue')!, 10)).toBe(16384);
  });
});

// ============================================================
// Section 9: Waypoint Parsing — C++ scenario.cpp Read_Scenario_INI
// ============================================================
describe('Waypoint parsing (scenario.cpp Read_Scenario_INI)', () => {
  // C++ scenario.cpp: [Waypoints] section maps waypoint index → cell index.
  // Cell index is converted to (cx, cy) via: cx = cellIdx % MAP_CELLS, cy = cellIdx / MAP_CELLS.
  // MAP_CELLS = 128 (128x128 map grid).

  it('cellIndexToPos converts cell index to (cx, cy) correctly — C++ Cell_X/Cell_Y macros', () => {
    // C++ CELL.H: Cell_X(cell) = cell % MAP_CELL_W, Cell_Y(cell) = cell / MAP_CELL_W
    const cases: [number, number, number][] = [
      [0, 0, 0],           // top-left corner
      [127, 127, 0],       // top-right of first row
      [128, 0, 1],         // first cell of second row
      [16383, 127, 127],   // bottom-right corner (128*128-1)
      [7744, 64, 60],      // mid-map: 60*128+64 = 7744
      [3200, 0, 25],       // 25*128+0 = 3200
    ];

    for (const [cellIdx, expectedCx, expectedCy] of cases) {
      const pos = cellIndexToPos(cellIdx);
      expect(pos.cx, `cell ${cellIdx} cx`).toBe(expectedCx);
      expect(pos.cy, `cell ${cellIdx} cy`).toBe(expectedCy);
    }
  });

  it('parseScenarioINI parses [Waypoints] section into Map<number, CellPos>', () => {
    // Minimal scenario with waypoints — mirrors C++ scenario.cpp parsing
    const text = [
      '[Basic]',
      'Player=Spain',
      '[Map]',
      'X=1',
      'Y=1',
      'Width=50',
      'Height=50',
      '[Spain]',
      'Credits=0',
      'TechLevel=3',
      'Allies=Spain',
      '[Waypoints]',
      '0=7744',
      '25=3200',
      '98=8064',
    ].join('\n');

    const scenario = parseScenarioINI(text);
    expect(scenario.waypoints.size, 'three waypoints parsed').toBe(3);

    // WP0 = cell 7744 → (64, 60)
    const wp0 = scenario.waypoints.get(0)!;
    expect(wp0.cx, 'WP0 cx').toBe(7744 % MAP_CELLS);
    expect(wp0.cy, 'WP0 cy').toBe(Math.floor(7744 / MAP_CELLS));

    // WP25 = cell 3200 → (0, 25)
    const wp25 = scenario.waypoints.get(25)!;
    expect(wp25.cx, 'WP25 cx').toBe(0);
    expect(wp25.cy, 'WP25 cy').toBe(25);

    // WP98 = cell 8064 → home/map-center waypoint
    const wp98 = scenario.waypoints.get(98)!;
    expect(wp98.cx, 'WP98 cx').toBe(8064 % MAP_CELLS);
    expect(wp98.cy, 'WP98 cy').toBe(Math.floor(8064 / MAP_CELLS));
  });

  it('waypoint 98 is home waypoint — C++ scenario.cpp convention', () => {
    // C++ scenario.cpp: Waypoint 98 is used as the player home/scroll position
    // Every shipped RA scenario file defines WP98
    const text = [
      '[Basic]',
      'Player=Spain',
      '[Map]',
      'X=1',
      'Y=1',
      'Width=50',
      'Height=50',
      '[Spain]',
      'Credits=0',
      'TechLevel=3',
      'Allies=Spain',
      '[Waypoints]',
      '98=6528',
    ].join('\n');

    const scenario = parseScenarioINI(text);
    expect(scenario.waypoints.has(98), 'WP98 exists').toBe(true);
    // 6528 = 51*128 + 0 → (0, 51) OR recalculate: 6528/128=51, 6528%128=0
    expect(scenario.waypoints.get(98)!.cx).toBe(6528 % 128);
    expect(scenario.waypoints.get(98)!.cy).toBe(Math.floor(6528 / 128));
  });
});

// ============================================================
// Section 10: Team Type Parsing — C++ teamtype.cpp Read_INI
// ============================================================
describe('Team type parsing (teamtype.cpp TeamTypeClass::Read_INI)', () => {
  // C++ teamtype.cpp format:
  // name=House,Flags,RecruitPriority,InitNum,MaxAllowed,Origin,Trigger,ClassCount,
  //   Type1:Count1,Type2:Count2,...,MissionCount,Mission1:Data1,...

  it('parses team with members and missions from scenario INI', () => {
    const text = [
      '[Basic]',
      'Player=Spain',
      '[Map]',
      'X=1',
      'Y=1',
      'Width=50',
      'Height=50',
      '[Spain]',
      'Credits=0',
      'TechLevel=3',
      'Allies=Spain',
      '[Waypoints]',
      '98=6528',
      '5=3200',
      '[TeamTypes]',
      'atk1=4,2,7,0,1,5,-1,2,3TNK:3,E1:5,3,3:5,0:0,5:5',
    ].join('\n');

    const scenario = parseScenarioINI(text);
    expect(scenario.teamTypes.length, 'one team parsed').toBe(1);

    const team = scenario.teamTypes[0];
    expect(team.name, 'team name').toBe('atk1');
    expect(team.house, 'house (C++ HousesType index 4=USSR)').toBe(4);
    expect(team.origin, 'origin waypoint').toBe(5);
    expect(team.trigger, 'trigger index').toBe(-1);

    // Members: 3TNK:3, E1:5
    expect(team.members.length, 'two member classes').toBe(2);
    expect(team.members[0].type, 'first member type').toBe('3TNK');
    expect(team.members[0].count, 'first member count').toBe(3);
    expect(team.members[1].type, 'second member type').toBe('E1');
    expect(team.members[1].count, 'second member count').toBe(5);

    // Missions: 3:5 (MOVE to WP5), 0:0 (ATTACK WP0), 5:5 (GUARD WP5)
    expect(team.missions.length, 'three missions').toBe(3);
    expect(team.missions[0].mission, 'mission 0: MOVE (3)').toBe(3);
    expect(team.missions[0].data, 'mission 0 data: waypoint 5').toBe(5);
    expect(team.missions[1].mission, 'mission 1: ATTACK (0)').toBe(0);
    expect(team.missions[1].data, 'mission 1 data: waypoint 0').toBe(0);
    expect(team.missions[2].mission, 'mission 2: GUARD (5)').toBe(5);
    expect(team.missions[2].data, 'mission 2 data: waypoint 5').toBe(5);
  });

  it('parses team with no missions — C++ missionCount=0', () => {
    const text = [
      '[Basic]',
      'Player=Spain',
      '[Map]',
      'X=1',
      'Y=1',
      'Width=50',
      'Height=50',
      '[Spain]',
      'Credits=0',
      'TechLevel=3',
      'Allies=Spain',
      '[Waypoints]',
      '98=6528',
      '[TeamTypes]',
      'grd1=0,0,5,1,1,0,-1,1,E1:4,0',
    ].join('\n');

    const scenario = parseScenarioINI(text);
    const team = scenario.teamTypes[0];
    expect(team.members.length, 'one member class').toBe(1);
    expect(team.members[0].type).toBe('E1');
    expect(team.members[0].count).toBe(4);
    expect(team.missions.length, 'no missions').toBe(0);
  });

  it('flags bitfield is preserved — C++ teamtype.h flag bits', () => {
    // C++ teamtype.h: bit 0=roundabout, bit 1=suicide, bit 2=autocreate,
    // bit 3=prebuilt, bit 4=reinforce, bit 5=aggressive
    const text = [
      '[Basic]',
      'Player=Spain',
      '[Map]',
      'X=1',
      'Y=1',
      'Width=50',
      'Height=50',
      '[Spain]',
      'Credits=0',
      'TechLevel=3',
      'Allies=Spain',
      '[Waypoints]',
      '98=6528',
      '[TeamTypes]',
      'sui1=4,6,7,0,1,0,-1,1,E1:3,1,0:0',
    ].join('\n');

    const scenario = parseScenarioINI(text);
    const team = scenario.teamTypes[0];
    // flags=6 → binary 110 → bit1 (suicide) + bit2 (autocreate)
    expect(team.flags, 'flags=6 (suicide+autocreate)').toBe(6);
  });
});

// ============================================================
// Section 11: patchProductionItems integration — parseIni.ts
// ============================================================
describe('patchProductionItems integration (parseIni.ts)', () => {
  // Tests that parseIniSections output feeds correctly into patchProductionItems

  it('Cost= override is applied via parseInt', () => {
    const text = `[TESTUNIT]\nCost=999\nTechLevel=5`;
    const sections = parseIniSections(text);
    const section = sections.get('TESTUNIT')!;
    expect(parseInt(section.get('Cost')!, 10), 'Cost parsed as integer').toBe(999);
    expect(parseInt(section.get('TechLevel')!, 10), 'TechLevel parsed as integer').toBe(5);
  });

  it('Owner= feeds into normalizeOwnerToFaction for faction resolution', () => {
    const text = `[TSLA]\nOwner=soviet\n[GUN]\nOwner=allies`;
    const sections = parseIniSections(text);
    expect(normalizeOwnerToFaction(sections.get('TSLA')!.get('Owner'))).toBe('soviet');
    expect(normalizeOwnerToFaction(sections.get('GUN')!.get('Owner'))).toBe('allied');
  });

  it('Prerequisite= feeds into parsePrerequisiteList', () => {
    const text = `[4TNK]\nPrerequisite=weap,stek`;
    const sections = parseIniSections(text);
    const prereqs = parsePrerequisiteList(sections.get('4TNK')!.get('Prerequisite'));
    expect(prereqs).toEqual(['WEAP', 'STEK']);
  });
});

// ============================================================
// Section 12: Edge Cases and Robustness
// ============================================================
describe('Edge cases and robustness', () => {
  it('section with only whitespace lines between entries', () => {
    const text = `[Section]\n  \nKey1=A\n\t\nKey2=B`;
    const sections = parseIniSections(text);
    const section = sections.get('Section')!;
    expect(section.get('Key1')).toBe('A');
    expect(section.get('Key2')).toBe('B');
  });

  it('value containing commas is preserved as raw string', () => {
    // C++ ini.cpp stores the entire value; comma splitting is caller responsibility
    const text = `[Section]\nOwner=allies,soviet`;
    const sections = parseIniSections(text);
    expect(sections.get('Section')!.get('Owner')).toBe('allies,soviet');
  });

  it('key with no value (Key=) stores empty string', () => {
    const text = `[Section]\nEmpty=`;
    const sections = parseIniSections(text);
    expect(sections.get('Section')!.get('Empty')).toBe('');
  });

  it('Windows-style CRLF line endings are handled', () => {
    const text = `[Section]\r\nKey=Value\r\nOther=Data\r\n`;
    const sections = parseIniSections(text);
    const section = sections.get('Section')!;
    expect(section.get('Key')).toBe('Value');
    expect(section.get('Other')).toBe('Data');
  });

  it('normalizeOwnerToFaction handles comma-only input gracefully', () => {
    // Edge case: "," with no actual names
    expect(normalizeOwnerToFaction(',')).toBeUndefined();
  });

  it('parsePrerequisiteList handles whitespace-only entries', () => {
    // "FACT, , POWR" → should filter out empty entries
    const result = parsePrerequisiteList('FACT, , POWR');
    expect(result).toEqual(['FACT', 'POWR']);
  });

  it('parseIniSections handles line with = but no key (=Value)', () => {
    // C++ ini.cpp: key before = must exist; TS requires eq > 0
    const text = `[Section]\n=Value\nKey=Good`;
    const sections = parseIniSections(text);
    const section = sections.get('Section')!;
    // '=Value' has eq at index 0, which is NOT > 0, so it's skipped
    expect(section.has(''), 'empty key not stored').toBe(false);
    expect(section.get('Key')).toBe('Good');
  });
});
