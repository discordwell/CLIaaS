/**
 * C++ Behavioral Parity: Warhead Verses= (damage multipliers vs armor types)
 *
 * AUTHORITATIVE SOURCE: rules.ini / aftrmath.ini — NOT C++ constructor defaults.
 * All expected values are PARSED from INI files at test setup.
 *
 * Warhead sections in rules.ini (lines 2641-2724):
 *   [SA]         Verses=100%,50%,60%,25%,25%    — Small Arms
 *   [HE]         Verses=90%,75%,60%,25%,100%    — High Explosive
 *   [AP]         Verses=30%,75%,75%,100%,50%    — Armor Piercing
 *   [Fire]       Verses=90%,100%,60%,25%,50%   — Napalm/Fire
 *   [HollowPoint] Verses=100%,5%,5%,5%,5%      — Anti-infantry rifle bullet
 *   [Super]      Verses=100%,100%,100%,100%,100% — Special case (equal all)
 *   [Organic]    Verses=100%,0%,0%,0%,0%        — Infantry-only (dogs)
 *   [Nuke]       Verses=90%,100%,60%,25%,50%   — Nuclear (same Verses as Fire)
 *
 * Warhead sections in aftrmath.ini (line 195):
 *   [Mechanical] Verses=100%,100%,100%,100%,100% — Vehicle repair
 *
 * Armor index order (rules.ini comment line 2658):
 *   "Verses = damage value verses various armor types (as percentage of full damage)...
 *            -vs- none, wood (buildings), light armor, heavy armor, concrete"
 *   Index: none=0, wood=1, light=2, heavy=3, concrete=4
 *
 * C++ source refs:
 *   warhead.cpp — WarheadTypeClass::Read_INI reads Verses= percentages
 *   type.h      — ArmorType enum: ARMOR_NONE=0, ARMOR_WOOD=1, ARMOR_ALUMINUM=2,
 *                 ARMOR_STEEL=3, ARMOR_CONCRETE=4
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import {
  WARHEAD_VS_ARMOR,
  WARHEAD_META,
  WARHEAD_PROPS,
  armorIndex,
  getWarheadMultiplier,
  type WarheadType,
  type ArmorType,
} from '../engine/types';

// ---------------------------------------------------------------------------
// INI parser — parses sections and key=value pairs, ignoring comments
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Load and merge INI files — aftrmath.ini overrides rules.ini per C++ load order
// ---------------------------------------------------------------------------
const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const rulesContent = readFileSync(join(assetsDir, 'rules.ini'), 'utf-8');
const aftrmathContent = readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8');

const rules = parseINI(rulesContent);
const aftrmath = parseINI(aftrmathContent);

// Merged INI: aftrmath overrides rules (C++ loads rules.ini first, then aftrmath.ini)
const ini: Record<string, Record<string, string>> = {};
for (const [section, values] of Object.entries(rules)) {
  ini[section] = { ...values };
}
for (const [section, values] of Object.entries(aftrmath)) {
  ini[section] = { ...(ini[section] || {}), ...values };
}

// ---------------------------------------------------------------------------
// Parse Verses= "100%,50%,60%,25%,25%" -> [1.0, 0.5, 0.6, 0.25, 0.25]
// ---------------------------------------------------------------------------
function parseVerses(versesStr: string): [number, number, number, number, number] {
  const parts = versesStr.split(',').map((s) => {
    const trimmed = s.trim().replace('%', '');
    return parseFloat(trimmed) / 100;
  });
  if (parts.length !== 5) {
    throw new Error(`Expected 5 Verses values, got ${parts.length}: "${versesStr}"`);
  }
  return parts as [number, number, number, number, number];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// All warhead types defined in the TS engine
const ALL_WARHEADS: WarheadType[] = [
  'SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke', 'Mechanical',
];

// Warheads that come from rules.ini (not aftrmath.ini)
const RULES_INI_WARHEADS: WarheadType[] = [
  'SA', 'HE', 'AP', 'Fire', 'HollowPoint', 'Super', 'Organic', 'Nuke',
];

const ARMOR_NAMES: ArmorType[] = ['none', 'wood', 'light', 'heavy', 'concrete'];

// ==========================================================================
// 1. WARHEAD_VS_ARMOR: Verses= parity for every warhead, every armor index
// ==========================================================================
describe('WARHEAD_VS_ARMOR Verses= parity (rules.ini / aftrmath.ini)', () => {

  // ---- Per-warhead, per-armor-type verification ----
  for (const wh of ALL_WARHEADS) {
    describe(`[${wh}]`, () => {
      it(`INI section [${wh}] exists with Verses= key`, () => {
        const section = ini[wh];
        expect(section, `INI section [${wh}] must exist`).toBeDefined();
        expect(section?.Verses, `[${wh}] must have Verses=`).toBeDefined();
      });

      // Test each of the 5 armor indices individually for clear failure messages
      for (let i = 0; i < 5; i++) {
        const armorName = ARMOR_NAMES[i];
        it(`vs ${armorName} (index ${i}): TS matches INI`, () => {
          const section = ini[wh];
          if (!section?.Verses) return; // guarded by section-exists test above

          const iniValues = parseVerses(section.Verses);
          const tsValue = WARHEAD_VS_ARMOR[wh][i];
          const iniValue = iniValues[i];

          expect(tsValue).toBeCloseTo(iniValue, 4);
        });
      }

      // Full tuple comparison as single assertion
      it('full Verses= tuple matches INI exactly', () => {
        const section = ini[wh];
        if (!section?.Verses) return;

        const iniValues = parseVerses(section.Verses);
        const tsValues = WARHEAD_VS_ARMOR[wh];

        expect(tsValues).toEqual(iniValues.map((v) => expect.closeTo(v, 4)));
      });
    });
  }
});

// ==========================================================================
// 2. armorIndex() mapping correctness
//    C++ type.h: ARMOR_NONE=0, ARMOR_WOOD=1, ARMOR_ALUMINUM=2 (=light),
//                ARMOR_STEEL=3 (=heavy), ARMOR_CONCRETE=4
//    rules.ini line 2658: "none, wood (buildings), light armor, heavy armor, concrete"
// ==========================================================================
describe('armorIndex() mapping matches C++ ArmorType enum / rules.ini order', () => {
  const EXPECTED_MAPPING: [ArmorType, number][] = [
    ['none', 0],
    ['wood', 1],
    ['light', 2],
    ['heavy', 3],
    ['concrete', 4],
  ];

  for (const [armor, expectedIndex] of EXPECTED_MAPPING) {
    it(`armorIndex('${armor}') === ${expectedIndex}`, () => {
      expect(armorIndex(armor)).toBe(expectedIndex);
    });
  }

  it('all 5 armor types produce unique indices 0-4', () => {
    const indices = ARMOR_NAMES.map((a) => armorIndex(a));
    expect(new Set(indices).size).toBe(5);
    expect(indices).toEqual([0, 1, 2, 3, 4]);
  });
});

// ==========================================================================
// 3. getWarheadMultiplier() integration — end-to-end lookup vs INI
// ==========================================================================
describe('getWarheadMultiplier() matches INI Verses= (end-to-end)', () => {
  for (const wh of ALL_WARHEADS) {
    for (const armor of ARMOR_NAMES) {
      it(`getWarheadMultiplier('${wh}', '${armor}') matches INI`, () => {
        const section = ini[wh];
        if (!section?.Verses) return;

        const iniValues = parseVerses(section.Verses);
        const idx = ARMOR_NAMES.indexOf(armor);
        const expected = iniValues[idx];

        expect(getWarheadMultiplier(wh, armor)).toBeCloseTo(expected, 4);
      });
    }
  }
});

// ==========================================================================
// 4. WARHEAD_PROPS: InfDeath= and Explosion= parity
//    C++ warhead.cpp: WarheadTypeClass InfDeath and Explosion fields
// ==========================================================================
describe('WARHEAD_PROPS InfDeath/Explosion parity (warhead.cpp)', () => {
  for (const wh of ALL_WARHEADS) {
    describe(`[${wh}]`, () => {
      it('infantryDeath matches INI InfDeath= (default 0)', () => {
        const section = ini[wh];
        if (!section) {
          // Mechanical is in aftrmath.ini which is already merged
          throw new Error(`INI section [${wh}] not found after merge`);
        }
        // C++ default for InfDeath is 0 when not specified
        const iniInfDeath = section.InfDeath != null
          ? parseInt(section.InfDeath, 10)
          : 0;
        expect(WARHEAD_PROPS[wh].infantryDeath).toBe(iniInfDeath);
      });

      it('explosionSet matches INI Explosion= (default 0)', () => {
        const section = ini[wh];
        if (!section) {
          throw new Error(`INI section [${wh}] not found after merge`);
        }
        // C++ default for Explosion is 0 when not specified
        const iniExplosion = section.Explosion != null
          ? parseInt(section.Explosion, 10)
          : 0;
        expect(WARHEAD_PROPS[wh].explosionSet).toBe(iniExplosion);
      });
    });
  }
});

// ==========================================================================
// 5. WARHEAD_META: Spread= parity
//    C++ warhead.cpp:72 — spreadFactor from rules.ini Spread= field
// ==========================================================================
describe('WARHEAD_META Spread= parity (warhead.cpp:72)', () => {
  for (const wh of ALL_WARHEADS) {
    it(`[${wh}] spreadFactor matches INI Spread= (default 0)`, () => {
      const section = ini[wh];
      if (!section) {
        throw new Error(`INI section [${wh}] not found after merge`);
      }
      const iniSpread = section.Spread != null
        ? parseInt(section.Spread, 10)
        : 0;
      expect(WARHEAD_META[wh].spreadFactor).toBe(iniSpread);
    });
  }
});

// ==========================================================================
// 6. Completeness checks
// ==========================================================================
describe('completeness: no INI warhead section is missing from TS', () => {

  it('WARHEAD_VS_ARMOR has exactly 9 entries (8 rules.ini + 1 aftrmath.ini)', () => {
    expect(Object.keys(WARHEAD_VS_ARMOR).length).toBe(9);
  });

  it('every INI section with Verses= that is a known warhead is in WARHEAD_VS_ARMOR', () => {
    // Gather all INI sections that have a Verses= key
    const iniSectionsWithVerses = Object.keys(ini).filter((k) => ini[k]?.Verses);

    // The known warhead section names (matching WarheadType values)
    for (const section of iniSectionsWithVerses) {
      if (ALL_WARHEADS.includes(section as WarheadType)) {
        expect(
          WARHEAD_VS_ARMOR[section as WarheadType],
          `WARHEAD_VS_ARMOR should include [${section}]`,
        ).toBeDefined();
      }
    }
  });

  it('all 8 rules.ini warheads have Verses= in rules.ini (not just aftrmath.ini)', () => {
    for (const wh of RULES_INI_WARHEADS) {
      expect(
        rules[wh]?.Verses,
        `rules.ini [${wh}] should have Verses=`,
      ).toBeDefined();
    }
  });

  it('[Mechanical] only exists in aftrmath.ini, not in rules.ini', () => {
    expect(rules['Mechanical']).toBeUndefined();
    expect(aftrmath['Mechanical']).toBeDefined();
    expect(aftrmath['Mechanical']?.Verses).toBeDefined();
  });

  it('[Nuke] and [Fire] have identical Verses= per rules.ini (intentional C++ design)', () => {
    const nukeVerses = ini['Nuke']?.Verses;
    const fireVerses = ini['Fire']?.Verses;
    expect(nukeVerses).toBeDefined();
    expect(fireVerses).toBeDefined();
    expect(nukeVerses).toBe(fireVerses);
  });
});

// ==========================================================================
// 7. Cross-validation: TS Nuke vs Fire same Verses= (matches C++ comment)
//    rules.ini line 2716: "; Nuclear warhead (same as fire)"
// ==========================================================================
describe('cross-validation: Nuke vs Fire Verses= symmetry', () => {
  it('WARHEAD_VS_ARMOR Nuke and Fire have identical tuples (per rules.ini comment)', () => {
    expect(WARHEAD_VS_ARMOR['Nuke']).toEqual(WARHEAD_VS_ARMOR['Fire']);
  });

  it('both match INI parsed values', () => {
    const nukeIni = parseVerses(ini['Nuke']!.Verses!);
    const fireIni = parseVerses(ini['Fire']!.Verses!);
    expect(nukeIni).toEqual(fireIni);
    expect(WARHEAD_VS_ARMOR['Nuke']).toEqual(nukeIni.map((v) => expect.closeTo(v, 4)));
    expect(WARHEAD_VS_ARMOR['Fire']).toEqual(fireIni.map((v) => expect.closeTo(v, 4)));
  });
});

// ==========================================================================
// 8. Boundary / edge case validation
// ==========================================================================
describe('edge cases: extreme Verses= values', () => {
  it('[Organic] has 0% for all armor except none (100%)', () => {
    const iniValues = parseVerses(ini['Organic']!.Verses!);
    expect(iniValues[0]).toBe(1.0);  // none = 100%
    expect(iniValues[1]).toBe(0.0);  // wood = 0%
    expect(iniValues[2]).toBe(0.0);  // light = 0%
    expect(iniValues[3]).toBe(0.0);  // heavy = 0%
    expect(iniValues[4]).toBe(0.0);  // concrete = 0%

    // TS matches
    expect(WARHEAD_VS_ARMOR['Organic']).toEqual([1.0, 0.0, 0.0, 0.0, 0.0]);
  });

  it('[Super] has 100% for all armor types', () => {
    const iniValues = parseVerses(ini['Super']!.Verses!);
    for (let i = 0; i < 5; i++) {
      expect(iniValues[i]).toBe(1.0);
    }
    expect(WARHEAD_VS_ARMOR['Super']).toEqual([1.0, 1.0, 1.0, 1.0, 1.0]);
  });

  it('[Mechanical] has 100% for all armor types (aftrmath.ini)', () => {
    const iniValues = parseVerses(ini['Mechanical']!.Verses!);
    for (let i = 0; i < 5; i++) {
      expect(iniValues[i]).toBe(1.0);
    }
    expect(WARHEAD_VS_ARMOR['Mechanical']).toEqual([1.0, 1.0, 1.0, 1.0, 1.0]);
  });

  it('[HollowPoint] has 5% for all armor except none (100%)', () => {
    const iniValues = parseVerses(ini['HollowPoint']!.Verses!);
    expect(iniValues[0]).toBe(1.0);   // none = 100%
    expect(iniValues[1]).toBe(0.05);  // wood = 5%
    expect(iniValues[2]).toBe(0.05);  // light = 5%
    expect(iniValues[3]).toBe(0.05);  // heavy = 5%
    expect(iniValues[4]).toBe(0.05);  // concrete = 5%

    expect(WARHEAD_VS_ARMOR['HollowPoint']).toEqual([1.0, 0.05, 0.05, 0.05, 0.05]);
  });
});
