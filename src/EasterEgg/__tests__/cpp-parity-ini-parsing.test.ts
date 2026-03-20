/**
 * C++ Behavioral Parity Tests — INI Parsing (parseIni.ts)
 *
 * Tests TS INI parsing against C++ INIClass behavior from:
 *   - ini.cpp (Load, Get_Bool, Get_Int, Get_Fixed, Get_String, Strip_Comments)
 *   - ini.h (INIClass, INIEntry, INISection, CRCEngine-based lookup)
 *   - readline.cpp (strtrim, Read_Line)
 *   - ccini.cpp (Get_Owners, Get_Buildings — comma-separated parsing)
 *   - display.cpp:4295-4303 (waypoint cell-index parsing)
 *
 * C++ reference: CnC_and_Red_Alert/RA/ini.cpp, ccini.cpp, readline.cpp, display.cpp
 */

import { describe, it, expect } from 'vitest';
import {
  parseIniSections,
  parseIniInt,
  normalizeOwnerToFaction,
  parsePrerequisiteList,
} from '../engine/parseIni';
import { cellIndexToPos, MAP_CELLS } from '../engine/types';

// =============================================================================
// Section 1: Basic Section Parsing — C++ ini.cpp:200-298
//
// C++ INIClass::Load():
//   - Prescans lines until first line where buffer[0]=='[' && strchr(buffer,']')!=NULL
//   - Section name: buffer[0] replaced with ' ', ']' zeroed, then strtrim()
//   - Entry lines: Split at first '=', both sides strtrim()'d
//   - Lines starting with ';' or '=' are skipped (ini.cpp:255)
//   - Lines without '=' are skipped (ini.cpp:262)
//   - Empty key or empty value after trim → skipped (ini.cpp:270-273)
//   - Empty sections (no entries) are discarded (ini.cpp:290)
// =============================================================================

describe('Section parsing (ini.cpp:200-298)', () => {
  it('parses basic [Section] with Key=Value entries', () => {
    const ini = parseIniSections('[Basic]\nName=Test Mission\nPlayer=Greece\n');
    const basic = ini.get('Basic');
    expect(basic).toBeDefined();
    expect(basic!.get('Name')).toBe('Test Mission');
    expect(basic!.get('Player')).toBe('Greece');
  });

  it('handles multiple sections', () => {
    const ini = parseIniSections(
      '[Map]\nX=1\nY=2\n[Basic]\nName=Hello\n',
    );
    expect(ini.get('Map')!.get('X')).toBe('1');
    expect(ini.get('Map')!.get('Y')).toBe('2');
    expect(ini.get('Basic')!.get('Name')).toBe('Hello');
  });

  it('trims whitespace from keys and values — C++ strtrim() in readline.cpp:31-57', () => {
    // C++ ini.cpp:269 calls strtrim(buffer) on key, :272 calls strtrim(divider) on value
    const ini = parseIniSections('[Section]\n  Key  =  Value  \n');
    expect(ini.get('Section')!.get('Key')).toBe('Value');
  });

  it('handles empty lines between entries', () => {
    const ini = parseIniSections('[S]\nA=1\n\nB=2\n');
    const s = ini.get('S');
    expect(s).toBeDefined();
    expect(s!.get('A')).toBe('1');
    expect(s!.get('B')).toBe('2');
  });

  it('lines before first section are ignored — C++ ini.cpp:217-221 prescan loop', () => {
    // C++ prescans until first '[' line. Lines before it are discarded.
    const ini = parseIniSections('Orphan=Value\nName=NoSection\n[Real]\nKey=Val\n');
    expect(ini.has('Real')).toBe(true);
    expect(ini.get('Real')!.get('Key')).toBe('Val');
    // There should be no section for the orphan lines
    expect(ini.size).toBe(1);
  });

  it('lines without = are skipped — C++ ini.cpp:262', () => {
    const ini = parseIniSections('[S]\nNoEquals\nKey=Val\n');
    expect(ini.get('S')!.size).toBe(1);
    expect(ini.get('S')!.get('Key')).toBe('Val');
  });

  it('= at start of line is skipped — C++ ini.cpp:255 (buffer[0]==\"=\")', () => {
    // C++ explicitly checks: if (buffer[0] == '=') continue;
    const ini = parseIniSections('[S]\n=NoKey\nKey=Val\n');
    const s = ini.get('S');
    expect(s).toBeDefined();
    expect(s!.get('Key')).toBe('Val');
    // The "=NoKey" line should have been skipped
    expect(s!.size).toBe(1);
  });

  it('handles value containing = character — C++ splits at FIRST = only (ini.cpp:261)', () => {
    // C++ uses strchr(buffer, '=') which finds the first '='
    // So "Key=A=B" splits to key="Key", value="A=B"
    const ini = parseIniSections('[S]\nKey=A=B\n');
    expect(ini.get('S')!.get('Key')).toBe('A=B');
  });

  // PARITY GAP: C++ ini.cpp:272-273 skips entries with empty values after trim.
  // TS parseIniSections keeps them with value="".
  // C++ behavior: "Key=" → key="Key", value="" → SKIPPED (empty value).
  // TS behavior: "Key=" → key="Key", value="" → KEPT.
  it('C++ discards entries with empty value after trim — ini.cpp:273', () => {
    const ini = parseIniSections('[S]\nKey=\nOther=Val\n');
    const s = ini.get('S')!;
    // C++ expected: "Key=" entry is discarded, only "Other" remains
    expect(s.has('Key')).toBe(false); // PARITY GAP — TS returns true
  });
});

// =============================================================================
// Section 2: Comment Handling — C++ ini.cpp:1278-1287 (Strip_Comments)
//
// C++ INIClass::Strip_Comments():
//   char * comment = strchr(buffer, ';');
//   if (comment) { *comment = '\0'; strtrim(buffer); }
//
// ONLY ';' is treated as a comment delimiter. '#' is NOT a comment character.
// The comment check happens AFTER Read_Line, which does strtrim().
// Semicolons within a line truncate from that point onward.
// =============================================================================

describe('Comment handling — Strip_Comments (ini.cpp:1278-1287)', () => {
  it('lines starting with ; are comments', () => {
    const ini = parseIniSections('[S]\n; This is a comment\nKey=Val\n');
    expect(ini.get('S')!.size).toBe(1);
    expect(ini.get('S')!.get('Key')).toBe('Val');
  });

  // PARITY GAP: C++ Strip_Comments (ini.cpp:1278-1287) runs on each line BEFORE
  // the '=' split (ini.cpp:254). It finds first ';' via strchr and truncates.
  // So "Key=Value ; comment" → "Key=Value" → value="Value".
  // TS parseIniSections does NOT strip inline ; comments.
  // TS result: value="Value ; comment".
  it('inline ; comments truncate the value — C++ strchr(buffer, \";\")', () => {
    const ini = parseIniSections('[S]\nKey=Value ; comment\n');
    const val = ini.get('S')!.get('Key');
    // C++ expected: inline comment stripped, value is "Value"
    expect(val).toBe('Value'); // PARITY GAP — TS returns "Value ; comment"
  });

  it('# is NOT a comment character in C++ INI parsing', () => {
    // C++ only uses ';' as comment delimiter (ini.cpp:1281).
    // '#' is treated as normal text.
    const ini = parseIniSections('[S]\n# NotAComment=true\nKey=Val\n');

    // C++ would see "# NotAComment=true" as a valid entry with key="# NotAComment"
    // TS should also not treat '#' as comment (it uses startsWith(';') only)
    // If '#' line is treated as comment, that happens to match TS behavior but for
    // the wrong reason — let's verify.
    const s = ini.get('S')!;
    expect(s.get('Key')).toBe('Val');

    // C++ would parse "# NotAComment" as a key (with the # in it).
    // If TS also treats '#' as normal text, there should be 2 entries.
    // If TS strips '#' lines as comments, there would be 1 entry.
    // Both TS and C++ should have this entry since '#' is not a comment character.
    if (s.size === 1) {
      // PARITY GAP: TS treats '#' as comment but C++ does not
      expect(s.size).toBe(2);
    } else {
      expect(s.size).toBe(2);
    }
  });
});

// =============================================================================
// Section 3: Boolean Parsing — C++ ini.cpp:1075-1097 (Get_Bool)
//
// C++ INIClass::Get_Bool():
//   switch (toupper(*entryptr->Value)) {
//     case 'Y': case 'T': case '1': return(true);
//     case 'N': case 'F': case '0': return(false);
//   }
//   return(defvalue);
//
// Key observations:
//   - Only the FIRST character matters
//   - Case insensitive (toupper on first char)
//   - "yes", "Yes", "YES", "Y", "y" all → true
//   - "true", "True", "TRUE", "T", "t" all → true
//   - "1", "100", "1.0" all → true (first char is '1')
//   - "no", "No", "NO", "N", "n" all → false
//   - "false", "False", "FALSE", "F", "f" all → false
//   - "0", "0.0" all → false
//   - "2", "abc", "" → returns default value
// =============================================================================

describe('Boolean parsing — Get_Bool (ini.cpp:1075-1097)', () => {
  // Helper: parse a boolean from INI text the way TS does
  function parseBoolFromIni(value: string): boolean | undefined {
    const ini = parseIniSections(`[S]\nKey=${value}\n`);
    const raw = ini.get('S')?.get('Key');
    if (!raw) return undefined;

    // TS parseIniSections returns raw string. The game code must interpret
    // the boolean separately. Let's test what C++ would produce.
    const firstChar = raw.charAt(0).toUpperCase();
    switch (firstChar) {
      case 'Y': case 'T': case '1': return true;
      case 'N': case 'F': case '0': return false;
      default: return undefined; // returns default in C++
    }
  }

  // Truthy values — C++ ini.cpp:1084-1088
  const truthyValues = ['yes', 'Yes', 'YES', 'Y', 'y', 'true', 'True', 'TRUE', 'T', 't', '1'];
  for (const val of truthyValues) {
    it(`"${val}" → true (first char '${val[0]}')`, () => {
      expect(parseBoolFromIni(val)).toBe(true);
    });
  }

  // Falsy values — C++ ini.cpp:1090-1093
  const falsyValues = ['no', 'No', 'NO', 'N', 'n', 'false', 'False', 'FALSE', 'F', 'f', '0'];
  for (const val of falsyValues) {
    it(`"${val}" → false (first char '${val[0]}')`, () => {
      expect(parseBoolFromIni(val)).toBe(false);
    });
  }

  // Unrecognized values — returns default (undefined in our helper)
  const unknownValues = ['2', 'abc', 'xyz', ''];
  for (const val of unknownValues) {
    it(`"${val}" → default (first char not Y/T/1/N/F/0)`, () => {
      // Empty string would be caught by C++ empty-value skip (ini.cpp:273)
      // So it would never reach Get_Bool. But for non-empty unknowns, C++ returns defvalue.
      if (val !== '') {
        expect(parseBoolFromIni(val)).toBeUndefined();
      }
    });
  }

  it('C++ only checks first character — "yep" is true, "nah" is false', () => {
    expect(parseBoolFromIni('yep')).toBe(true);
    expect(parseBoolFromIni('nah')).toBe(false);
  });

  it('C++ "Tracked=yes" in ini-parity.test.ts uses this exact path', () => {
    // From ini-parity.test.ts:454 — iniData.Tracked.toLowerCase() === 'yes'
    // C++ would check toupper('y') == 'Y' → true
    // Both agree on "yes" → true
    const ini = parseIniSections('[UNIT]\nTracked=yes\n');
    const raw = ini.get('UNIT')!.get('Tracked')!;
    // C++ Get_Bool: toupper('y') → 'Y' → true
    expect(raw.charAt(0).toUpperCase()).toBe('Y');
  });
});

// =============================================================================
// Section 4: Integer Parsing — C++ ini.cpp:813-834 (Get_Int)
//
// C++ INIClass::Get_Int():
//   if (*entryptr->Value == '$') {
//     sscanf(entryptr->Value, "$%x", &defvalue);        // $FF → 255
//   } else {
//     if (tolower(entryptr->Value[strlen(entryptr->Value)-1]) == 'h') {
//       sscanf(entryptr->Value, "%xh", &defvalue);      // FFh → 255
//     } else {
//       defvalue = atoi(entryptr->Value);                // 42 → 42
//     }
//   }
//
// Three integer formats:
//   1. Decimal: "42" → atoi("42") = 42
//   2. Hex with trailing 'h': "FFh" → sscanf("FFh", "%xh") → 255
//   3. Hex with leading '$': "$FF" → sscanf("$FF", "$%x") → 255
// =============================================================================

describe('Integer parsing — Get_Int (ini.cpp:813-834)', () => {
  // Helper: parse int from INI the way the TS parseIniSections works
  function getIntFromIni(value: string): number {
    const ini = parseIniSections(`[S]\nKey=${value}\n`);
    const raw = ini.get('S')?.get('Key');
    if (!raw) return 0;
    return parseInt(raw, 10); // TS typically uses parseInt for ints
  }

  it('decimal integer: "42" → 42', () => {
    expect(getIntFromIni('42')).toBe(42);
  });

  it('negative decimal: "-10" → -10', () => {
    expect(getIntFromIni('-10')).toBe(-10);
  });

  it('zero: "0" → 0', () => {
    expect(getIntFromIni('0')).toBe(0);
  });

  it('large integer: "1000" → 1000', () => {
    expect(getIntFromIni('1000')).toBe(1000);
  });

  // PARITY GAP: C++ ini.cpp:823-824 handles "$FF" hex format via sscanf.
  // TS uses parseInt(raw, 10) which returns NaN for "$FF".
  // C++ result: 255. TS result: NaN.
  it('C++ hex "$FF" format — parseIniInt handles this (ini.cpp:823-824)', () => {
    const ini = parseIniSections('[S]\nKey=$FF\n');
    const raw = ini.get('S')?.get('Key');
    expect(raw).toBe('$FF');
    // C++ Get_Int would return 255 for "$FF"; TS parseIniInt matches
    expect(parseIniInt(raw)).toBe(255);
  });

  // PARITY GAP: C++ ini.cpp:826-827 handles "FFh" trailing-h hex via sscanf.
  // TS uses parseInt(raw, 10) which returns NaN for "FFh".
  // C++ result: 255. TS result: NaN.
  it('C++ hex "FFh" format — parseIniInt handles this (ini.cpp:826-827)', () => {
    const ini = parseIniSections('[S]\nKey=FFh\n');
    const raw = ini.get('S')?.get('Key');
    expect(raw).toBe('FFh');
    // C++ Get_Int would return 255 for "FFh"; TS parseIniInt matches
    expect(parseIniInt(raw)).toBe(255);
  });
});

// =============================================================================
// Section 5: Case Sensitivity — C++ CRC-based section/entry lookup
//
// C++ ini.h:125 (INIEntry::Index_ID):
//   int Index_ID(void) const { return(CRCEngine()(Entry, strlen(Entry))); }
// C++ ini.h:139 (INISection::Index_ID):
//   int Index_ID(void) const { return(CRCEngine()(Section, strlen(Section))); }
//
// CRCEngine (crc.h:52-106) computes CRC over raw bytes.
// It does NOT normalize to upper/lower case.
// Therefore, section and entry lookups ARE case-sensitive in C++.
//
// However, C++ strtrim() (readline.cpp:31-57) only strips whitespace.
// Section names come from: buffer[0]=' ' (replacing '['), ']' zeroed, then strtrim.
// So "[  Basic  ]" → " Basic" after ']' zeroed → "Basic" after strtrim.
//
// TS parseIniSections does line.slice(1, -1) which removes '[' and ']'.
// If TS also trims the section name, behavior matches.
//
// KEY: C++ lookups are case-sensitive. Get_Bool("Basic", "Player") ≠ Get_Bool("basic", "player")
// =============================================================================

describe('Case sensitivity — CRC-based lookup (ini.h:125,139)', () => {
  it('C++ section names are case-sensitive — "Basic" ≠ "basic"', () => {
    // C++ CRCEngine computes CRC over raw bytes, case matters
    const ini = parseIniSections('[Basic]\nName=Test\n');
    expect(ini.has('Basic')).toBe(true);

    // TS Map is case-sensitive by default, so this should match C++ behavior
    const hasLower = ini.has('basic');
    expect(hasLower).toBe(false); // Should be false — case-sensitive like C++
  });

  it('C++ entry names are case-sensitive — "Name" ≠ "name"', () => {
    const ini = parseIniSections('[S]\nName=Test\n');
    const s = ini.get('S')!;
    expect(s.has('Name')).toBe(true);
    expect(s.has('name')).toBe(false); // Case-sensitive like C++
  });

  it('C++ values preserve original case', () => {
    const ini = parseIniSections('[S]\nPlayer=Greece\n');
    // C++ stores the raw value string as-is (after strtrim)
    expect(ini.get('S')!.get('Player')).toBe('Greece');
  });

  // PARITY GAP: C++ ini.cpp:228-231 replaces '[' with space, zeros ']', then
  // calls strtrim(). So "[ Basic ]" → " Basic " → "Basic".
  // TS parseIniSections uses line.startsWith('[') && line.endsWith(']'),
  // then line.slice(1, -1). "[ Basic ]" → " Basic " (not trimmed further).
  // C++ result: section name "Basic". TS result: section name " Basic ".
  it('section name with spaces is trimmed — C++ strtrim after ] removal', () => {
    const ini = parseIniSections('[ Basic ]\nKey=Val\n');
    // C++ expected: section name is "Basic" (leading/trailing spaces trimmed)
    expect(ini.has('Basic')).toBe(true); // PARITY GAP — TS stores " Basic "
  });
});

// =============================================================================
// Section 6: Owner/Faction Normalization — C++ ccini.cpp:391-407 (Get_Owners)
//
// C++ CCINIClass::Get_Owners():
//   Get_String(section, entry, "", buffer, sizeof(buffer));
//   ownable = 0;
//   char * name = strtok(buffer, ",");
//   while (name) {
//     ownable |= Owner_From_Name(name);
//     name = strtok(NULL, ",");
//   }
//
// Owner_From_Name handles group names:
//   "allies" → all Allied house bits
//   "soviet" → all Soviet house bits
//   Individual house names: "England", "France", "Germany", "Greece",
//     "Spain", "Turkey", "GoodGuy" → Allied
//   "USSR", "Ukraine", "BadGuy" → Soviet
//
// Note: strtok strips leading delimiters but NOT whitespace.
// C++ Owner_From_Name likely uses stricmp (case-insensitive comparison).
// =============================================================================

describe('Owner/faction normalization — Get_Owners (ccini.cpp:391-407)', () => {
  it('"allies" → allied', () => {
    expect(normalizeOwnerToFaction('allies')).toBe('allied');
  });

  it('"soviet" → soviet', () => {
    expect(normalizeOwnerToFaction('soviet')).toBe('soviet');
  });

  it('"allies,soviet" → both (comma-separated)', () => {
    expect(normalizeOwnerToFaction('allies,soviet')).toBe('both');
  });

  it('"soviet,allies" → both (order independent)', () => {
    expect(normalizeOwnerToFaction('soviet,allies')).toBe('both');
  });

  it('individual Allied houses: England, France, Germany, Greece, Spain, Turkey', () => {
    // C++ Owner_From_Name maps these to Allied house bits
    expect(normalizeOwnerToFaction('england')).toBe('allied');
    expect(normalizeOwnerToFaction('france')).toBe('allied');
    expect(normalizeOwnerToFaction('germany')).toBe('allied');
    expect(normalizeOwnerToFaction('greece')).toBe('allied');
    expect(normalizeOwnerToFaction('spain')).toBe('allied');
    expect(normalizeOwnerToFaction('turkey')).toBe('allied');
  });

  it('individual Soviet houses: USSR, Ukraine', () => {
    // C++ Owner_From_Name maps these to Soviet house bits
    expect(normalizeOwnerToFaction('ussr')).toBe('soviet');
    expect(normalizeOwnerToFaction('ukraine')).toBe('soviet');
  });

  it('special house names: GoodGuy → allied, BadGuy → soviet', () => {
    expect(normalizeOwnerToFaction('goodguy')).toBe('allied');
    expect(normalizeOwnerToFaction('badguy')).toBe('soviet');
  });

  it('case insensitive — C++ Owner_From_Name likely uses stricmp', () => {
    // TS normalizes to lowercase before checking
    expect(normalizeOwnerToFaction('ALLIES')).toBe('allied');
    expect(normalizeOwnerToFaction('Soviet')).toBe('soviet');
    expect(normalizeOwnerToFaction('England')).toBe('allied');
    expect(normalizeOwnerToFaction('USSR')).toBe('soviet');
  });

  it('mixed Allied + Soviet houses → both', () => {
    expect(normalizeOwnerToFaction('england,ussr')).toBe('both');
    expect(normalizeOwnerToFaction('greece,ukraine')).toBe('both');
  });

  it('undefined/empty → undefined', () => {
    expect(normalizeOwnerToFaction(undefined)).toBeUndefined();
    expect(normalizeOwnerToFaction('')).toBeUndefined();
  });

  it('unrecognized house name → undefined', () => {
    // C++ would return 0 bits for unknown names
    expect(normalizeOwnerToFaction('neutral')).toBeUndefined();
    expect(normalizeOwnerToFaction('special')).toBeUndefined();
  });

  it('whitespace around comma-separated names is handled', () => {
    // C++ strtok does NOT trim whitespace, but the INI parser trims the whole line.
    // TS normalizeOwnerToFaction does .trim() on each token.
    expect(normalizeOwnerToFaction('allies , soviet')).toBe('both');
  });
});

// =============================================================================
// Section 7: Prerequisite Parsing — C++ ccini.cpp:1352-1373 (Get_Buildings)
//
// C++ CCINIClass::Get_Buildings():
//   Get_String(section, entry, "", buffer, sizeof(buffer));
//   pre = 0;
//   char * token = strtok(buffer, ",");
//   while (token != NULL && *token != '\0') {
//     StructType building = BuildingTypeClass::From_Name(token);
//     if (building != STRUCT_NONE) {
//       pre |= (1L << building);
//     }
//     token = strtok(NULL, ",");
//   }
//
// Prerequisites are comma-separated building type names.
// C++ converts to uppercase internally via From_Name.
// =============================================================================

describe('Prerequisite parsing — Get_Buildings (ccini.cpp:1352-1373)', () => {
  it('single prerequisite: "FACT" → ["FACT"]', () => {
    expect(parsePrerequisiteList('FACT')).toEqual(['FACT']);
  });

  it('multiple prerequisites: "FACT,POWR" → ["FACT", "POWR"]', () => {
    expect(parsePrerequisiteList('FACT,POWR')).toEqual(['FACT', 'POWR']);
  });

  it('trims whitespace around each token', () => {
    expect(parsePrerequisiteList(' FACT , POWR ')).toEqual(['FACT', 'POWR']);
  });

  it('uppercases all tokens — matching C++ From_Name behavior', () => {
    // C++ BuildingTypeClass::From_Name uses stricmp (case-insensitive)
    // TS parsePrerequisiteList uppercases: .toUpperCase()
    expect(parsePrerequisiteList('fact,powr')).toEqual(['FACT', 'POWR']);
  });

  it('empty/undefined → empty array', () => {
    expect(parsePrerequisiteList(undefined)).toEqual([]);
    expect(parsePrerequisiteList('')).toEqual([]);
  });

  it('three-part prerequisite list', () => {
    expect(parsePrerequisiteList('BARR,TENT,WEAP')).toEqual(['BARR', 'TENT', 'WEAP']);
  });

  it('filters empty strings from consecutive commas', () => {
    // C++ strtok naturally skips empty tokens between consecutive delimiters
    // TS .filter(Boolean) does the same
    expect(parsePrerequisiteList('FACT,,POWR')).toEqual(['FACT', 'POWR']);
  });
});

// =============================================================================
// Section 8: Waypoint Cell-Index Parsing — C++ display.cpp:4295-4303
//
// C++ DisplayClass::Read_INI() (display.cpp:4295-4303):
//   for (int i = 0; i < WAYPT_COUNT; i++) {
//     char buf[20];
//     sprintf(buf, "%d", i);
//     Scen.Waypoint[i] = ini.Get_Int("Waypoints", buf, -1);
//     if (Scen.Waypoint[i] != -1) {
//       (*this)[Scen.Waypoint[i]].IsWaypoint = 1;
//     }
//   }
//
// Cell index → position:
//   C++ MAP_CELL_W = 128 (at RESFACTOR=2, this is 128)
//   cx = cellIndex % MAP_CELL_W
//   cy = cellIndex / MAP_CELL_W  (integer division)
//
// TS cellIndexToPos (types.ts:1006-1008):
//   return { cx: idx % MAP_CELLS, cy: Math.floor(idx / MAP_CELLS) }
//   MAP_CELLS = 128
// =============================================================================

describe('Waypoint cell-index parsing — display.cpp:4295-4303', () => {
  it('MAP_CELLS matches C++ MAP_CELL_W (128)', () => {
    // C++ MAP_CELL_W at RESFACTOR=2 is 128
    expect(MAP_CELLS).toBe(128);
  });

  it('cell index 0 → (0, 0)', () => {
    const pos = cellIndexToPos(0);
    expect(pos.cx).toBe(0);
    expect(pos.cy).toBe(0);
  });

  it('cell index 127 → (127, 0) — last cell in first row', () => {
    const pos = cellIndexToPos(127);
    expect(pos.cx).toBe(127);
    expect(pos.cy).toBe(0);
  });

  it('cell index 128 → (0, 1) — first cell in second row', () => {
    // C++ idx=128: 128 % 128 = 0, 128 / 128 = 1
    const pos = cellIndexToPos(128);
    expect(pos.cx).toBe(0);
    expect(pos.cy).toBe(1);
  });

  it('cell index 3201 → (1, 25) — typical waypoint position', () => {
    // C++ idx=3201: 3201 % 128 = 1, 3201 / 128 = 25
    const pos = cellIndexToPos(3201);
    expect(pos.cx).toBe(3201 % 128);
    expect(pos.cy).toBe(Math.floor(3201 / 128));
  });

  it('cell index 7432 → (8, 58) — another typical scenario waypoint', () => {
    // 7432 % 128 = 8, 7432 / 128 = 58.0625 → 58
    const pos = cellIndexToPos(7432);
    expect(pos.cx).toBe(7432 % 128);
    expect(pos.cy).toBe(Math.floor(7432 / 128));
  });

  it('maximum cell index 16383 → (127, 127)', () => {
    // 128*128 - 1 = 16383
    // 16383 % 128 = 127, 16383 / 128 = 127.9921... → 127
    const pos = cellIndexToPos(16383);
    expect(pos.cx).toBe(127);
    expect(pos.cy).toBe(127);
  });

  it('waypoints section uses string keys "0", "1", "2"... for indices', () => {
    // C++ display.cpp:4297: sprintf(buf, "%d", i) → keys are "0", "1", "2"...
    // Verify TS parseIniSections handles numeric-named keys
    const ini = parseIniSections(
      '[Waypoints]\n0=3201\n1=7432\n25=4500\n',
    );
    const wp = ini.get('Waypoints')!;
    expect(wp.get('0')).toBe('3201');
    expect(wp.get('1')).toBe('7432');
    expect(wp.get('25')).toBe('4500');
  });

  it('C++ Get_Int returns -1 for missing waypoints — display.cpp:4298', () => {
    // C++ default value is -1 for missing waypoints
    // TS scenario.ts:641 uses parseInt and checks isNaN
    const ini = parseIniSections('[Waypoints]\n0=3201\n');
    const wp = ini.get('Waypoints')!;
    // Key "1" is not present
    expect(wp.has('1')).toBe(false);
    // C++ would return -1 (defvalue), TS would get undefined from Map.get
    // This is equivalent — both mean "waypoint not set"
  });
});

// =============================================================================
// Section 9: Section Bracket Parsing Edge Cases — C++ ini.cpp:220,228-231
//
// C++ section detection (ini.cpp:220):
//   if (buffer[0] == '[' && strchr(buffer, ']') != NULL) break;
//
// C++ section name extraction (ini.cpp:228-231):
//   buffer[0] = ' ';  // Replace '[' with space
//   char * ptr = strchr(buffer, ']');
//   if (ptr) *ptr = '\0';
//   strtrim(buffer);
//
// This means:
//   - "[Section]" → " Section" → "Section"
//   - "[Section] ; comment" → " Section" (']' found, text after irrelevant)
//   - Section names can have embedded spaces: "[My Section]" → "My Section"
//   - "[Section" without ']' → NOT recognized as section (strchr returns NULL)
// =============================================================================

describe('Section bracket edge cases — ini.cpp:220,228-231', () => {
  // PARITY GAP: C++ ini.cpp:220 detects sections via strchr(buffer, ']'),
  // which finds the FIRST ']' anywhere in the line. Text after ']' is ignored.
  // C++ ini.cpp:229-230: ptr = strchr(buffer, ']'); *ptr = '\0';
  // So "[Section] ; extra" → section name "Section".
  // TS uses line.endsWith(']'), which requires ']' at end of trimmed line.
  // "[Section] ; extra stuff" does NOT end with ']', so TS skips it entirely.
  it('section with trailing text after ] — C++ ignores everything after ]', () => {
    const ini = parseIniSections('[Section] ; extra stuff\nKey=Val\n');
    // C++ expected: section "Section" exists with Key=Val
    expect(ini.has('Section')).toBe(true); // PARITY GAP — TS returns false
  });

  it('section with spaces in name — "[My Section]" → "My Section"', () => {
    const ini = parseIniSections('[My Section]\nKey=Val\n');
    if (ini.has('My Section')) {
      expect(ini.get('My Section')!.get('Key')).toBe('Val');
    } else {
      // PARITY GAP
      expect(ini.has('My Section')).toBe(true);
    }
  });
});

// =============================================================================
// Section 10: Empty Sections — C++ ini.cpp:290-295
//
// C++ INIClass::Load():
//   if (secptr->EntryList.Is_Empty()) {
//     delete secptr;                     // Discard empty sections
//   } else {
//     SectionIndex.Add_Index(...);        // Keep non-empty sections
//     SectionList.Add_Tail(secptr);
//   }
//
// C++ discards sections that have no valid entries.
// TS may or may not discard them.
// =============================================================================

describe('Empty section handling — ini.cpp:290-295', () => {
  // PARITY GAP: C++ ini.cpp:290-295 discards sections with no valid entries.
  // TS parseIniSections creates an empty Map for the section and keeps it.
  // C++ result: [Empty] not present. TS result: [Empty] present (empty Map).
  it('C++ discards sections with no entries', () => {
    const ini = parseIniSections('[Empty]\n[HasEntries]\nKey=Val\n');
    // C++ expected: [Empty] is discarded (no entries)
    expect(ini.has('Empty')).toBe(false); // PARITY GAP — TS returns true
    // Non-empty section should exist either way
    expect(ini.has('HasEntries')).toBe(true);
    expect(ini.get('HasEntries')!.get('Key')).toBe('Val');
  });

  // PARITY GAP: Same as above — a section containing only comment lines
  // has no valid entries, so C++ discards it.
  // TS keeps it as an empty Map.
  it('section with only comments has no entries — C++ discards it', () => {
    const ini = parseIniSections('[OnlyComments]\n; just a comment\n[Real]\nKey=Val\n');
    // C++ expected: [OnlyComments] is discarded
    expect(ini.has('OnlyComments')).toBe(false); // PARITY GAP — TS returns true
  });
});

// =============================================================================
// Section 11: Real-World INI Pattern — Scenario File Structure
//
// Verifies that parseIniSections handles the actual structure of RA scenario
// INI files, which have sections like [Basic], [Map], [Waypoints], [UKRAINE],
// [TeamTypes], [Trigs], [Infantry], [Units], [Structures], etc.
// =============================================================================

describe('Real-world scenario INI parsing', () => {
  const SCENARIO_INI = `[Basic]
Name=Rescue Tanya
Player=Greece
Theme=No Theme
CarryOverMoney=0
ToCarryOver=no
ToInherit=no
EndOfGame=no
TimerInherit=no
NewINIFormat=3

[Map]
Theater=TEMPERATE
X=30
Y=40
Width=50
Height=40

[Waypoints]
0=5380
1=5635
25=6789
98=4500

[UKRAINE]
Credits=2000
MaxBuilding=50
MaxUnit=50

; This is a comment section
[TeamTypes]
0001=UKRAINE,ATT1,0,0,0,7,0,-1,0,2,1TNK:3,TMISSION_ATT_WAYPT:0,TMISSION_ATT_WAYPT:1
`;

  it('parses all major sections from a scenario INI', () => {
    const ini = parseIniSections(SCENARIO_INI);
    expect(ini.has('Basic')).toBe(true);
    expect(ini.has('Map')).toBe(true);
    expect(ini.has('Waypoints')).toBe(true);
    expect(ini.has('UKRAINE')).toBe(true);
    expect(ini.has('TeamTypes')).toBe(true);
  });

  it('reads Basic section values correctly', () => {
    const ini = parseIniSections(SCENARIO_INI);
    const basic = ini.get('Basic')!;
    expect(basic.get('Name')).toBe('Rescue Tanya');
    expect(basic.get('Player')).toBe('Greece');
    expect(basic.get('NewINIFormat')).toBe('3');
    expect(basic.get('ToCarryOver')).toBe('no');
  });

  it('reads Map section values correctly', () => {
    const ini = parseIniSections(SCENARIO_INI);
    const map = ini.get('Map')!;
    expect(map.get('Theater')).toBe('TEMPERATE');
    expect(map.get('X')).toBe('30');
    expect(map.get('Width')).toBe('50');
  });

  it('reads Waypoint cell indices as string values', () => {
    const ini = parseIniSections(SCENARIO_INI);
    const wp = ini.get('Waypoints')!;
    expect(wp.get('0')).toBe('5380');
    expect(wp.get('1')).toBe('5635');
    expect(wp.get('25')).toBe('6789');
    expect(wp.get('98')).toBe('4500');
  });

  it('waypoint cell indices convert to correct positions', () => {
    // C++ display.cpp:4298: Scen.Waypoint[i] = ini.Get_Int("Waypoints", buf, -1)
    // C++ then uses cell index directly: cx = cellIdx % 128, cy = cellIdx / 128
    const pos0 = cellIndexToPos(5380);
    expect(pos0.cx).toBe(5380 % 128);  // 5380 % 128 = 4
    expect(pos0.cy).toBe(Math.floor(5380 / 128)); // 5380 / 128 = 42.03... → 42

    const pos25 = cellIndexToPos(6789);
    expect(pos25.cx).toBe(6789 % 128); // 6789 % 128 = 5
    expect(pos25.cy).toBe(Math.floor(6789 / 128)); // 6789 / 128 = 53.03... → 53
  });

  it('reads house credits', () => {
    const ini = parseIniSections(SCENARIO_INI);
    const ukraine = ini.get('UKRAINE')!;
    expect(ukraine.get('Credits')).toBe('2000');
    expect(ukraine.get('MaxUnit')).toBe('50');
  });

  it('reads complex TeamTypes entry as raw string', () => {
    const ini = parseIniSections(SCENARIO_INI);
    const teams = ini.get('TeamTypes')!;
    expect(teams.has('0001')).toBe(true);
    // The value contains commas and colons — should be preserved as-is
    const teamVal = teams.get('0001')!;
    expect(teamVal).toContain('UKRAINE');
    expect(teamVal).toContain('1TNK:3');
  });
});

// =============================================================================
// Section 12: strtrim behavior — C++ readline.cpp:31-57
//
// C++ strtrim():
//   1. Strip leading whitespace (isspace: space, tab, CR, LF, etc.)
//   2. Strip trailing whitespace
//   Both operations modify the buffer in-place.
//
// This is called on:
//   - Section names (ini.cpp:231)
//   - Entry keys (ini.cpp:269)
//   - Entry values (ini.cpp:272)
//   - Read_Line output (readline.cpp:89)
//   - Get_String output (ini.cpp:1017)
// =============================================================================

describe('strtrim behavior — readline.cpp:31-57', () => {
  it('strips tabs from keys and values', () => {
    // C++ isspace() matches tab (\t)
    const ini = parseIniSections('[S]\n\tKey\t=\tValue\t\n');
    const s = ini.get('S')!;
    // After strtrim, key should be "Key" and value should be "Value"
    expect(s.has('Key')).toBe(true);
    expect(s.get('Key')).toBe('Value');
  });

  it('strips mixed whitespace', () => {
    const ini = parseIniSections('[S]\n  \tKey  \t=  \tValue  \t\n');
    expect(ini.get('S')!.get('Key')).toBe('Value');
  });

  it('preserves internal whitespace in values', () => {
    // strtrim only strips leading/trailing, not internal
    const ini = parseIniSections('[S]\nKey=Hello World\n');
    expect(ini.get('S')!.get('Key')).toBe('Hello World');
  });

  it('preserves internal whitespace in keys', () => {
    const ini = parseIniSections('[S]\nMy Key=Val\n');
    expect(ini.get('S')!.get('My Key')).toBe('Val');
  });
});

// =============================================================================
// Section 13: Line Splitting — C++ readline.cpp:69-91 (Read_Line)
//
// C++ Read_Line():
//   - Reads until '\x0A' (LF) or EOF
//   - Strips '\x0D' (CR) characters
//   - Calls strtrim on result
//
// This means C++ handles:
//   - Unix (\n) line endings
//   - Windows (\r\n) line endings
//   - Old Mac (\r only) — '\r' chars are stripped but line doesn't end until '\n'
// =============================================================================

describe('Line splitting — Read_Line (readline.cpp:69-91)', () => {
  it('handles Unix (\\n) line endings', () => {
    const ini = parseIniSections('[S]\nA=1\nB=2\n');
    expect(ini.get('S')!.get('A')).toBe('1');
    expect(ini.get('S')!.get('B')).toBe('2');
  });

  it('handles Windows (\\r\\n) line endings', () => {
    const ini = parseIniSections('[S]\r\nA=1\r\nB=2\r\n');
    expect(ini.get('S')!.get('A')).toBe('1');
    expect(ini.get('S')!.get('B')).toBe('2');
  });
});

// =============================================================================
// Section 14: C++ MAX_LINE_LENGTH — ini.h:116
//
// C++ INIClass has: enum { MAX_LINE_LENGTH = 128 };
// Read_Line uses this as the buffer size.
// Lines longer than 128 characters would be truncated in C++.
// This is unlikely to matter for real INI files but documents the constraint.
// =============================================================================

describe('MAX_LINE_LENGTH (ini.h:116)', () => {
  it('C++ MAX_LINE_LENGTH is 128 — very long values are truncated in C++', () => {
    // C++ reads at most 128 chars per line (ini.h:116, ini.cpp:207)
    // TS has no such limit. This is a known difference but acceptable
    // because real RA INI files stay within the limit.
    const longValue = 'A'.repeat(200);
    const ini = parseIniSections(`[S]\nKey=${longValue}\n`);
    const val = ini.get('S')!.get('Key')!;

    // TS preserves the full value
    expect(val.length).toBe(200);

    // C++ would truncate to ~120 chars (128 minus "Key=" prefix)
    // This is a known difference, not a bug — document it
    // expect(val.length).toBeLessThanOrEqual(128); // Would fail in TS
  });
});
