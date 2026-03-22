/**
 * C++ Behavioral Parity Tests -- AI Config from rules.ini
 *
 * Parses rules.ini [AI] and [IQ] sections DIRECTLY and compares every value
 * against the corresponding TypeScript constant in AI_BUILD_RULES (ai.ts).
 *
 * rules.ini is the authoritative source of truth, NOT C++ constructor defaults.
 *
 * Source references:
 *   rules.ini [AI]  lines 223-254  -- AI building ratios, limits, timing, behavior
 *   rules.ini [IQ]  lines 269-280  -- IQ thresholds gating AI abilities
 *   ai.ts           AI_BUILD_RULES -- TS constants for AI configuration
 *   ai.ts           AI_DIFFICULTY_MODS -- TS difficulty modifiers
 *
 * Tests that FAIL identify real parity gaps between rules.ini and the TS engine.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseIniSections } from '../engine/parseIni';
import { AI_BUILD_RULES, AI_DIFFICULTY_MODS } from '../engine/ai';

// -- Load and parse rules.ini directly --

const rulesIniPath = join(__dirname, '../../..', 'public/ra/assets/rules.ini');
const rulesText = readFileSync(rulesIniPath, 'utf-8');
const sections = parseIniSections(rulesText);

/** Get a float from an INI section, stripping trailing '%' if present */
function iniFloat(section: string, key: string, def = 0): number {
  const val = sections.get(section)?.get(key);
  if (val == null) return def;
  const cleaned = val.replace(/%$/, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? def : parsed;
}

/** Get raw string value from an INI section */
function iniRaw(section: string, key: string): string | undefined {
  return sections.get(section)?.get(key);
}

/** Get a boolean from an INI section */
function iniBool(section: string, key: string, def = false): boolean {
  const val = sections.get(section)?.get(key)?.toLowerCase();
  if (val == null) return def;
  return val === 'yes' || val === 'true' || val === '1';
}

// =============================================================================
// 1. [AI] Section -- Verify INI values are parsed correctly
// =============================================================================
describe('[AI] section -- rules.ini parse verification', () => {
  it('[AI] section exists in rules.ini', () => {
    expect(sections.has('AI')).toBe(true);
  });

  it('[AI] has all expected keys', () => {
    const aiSection = sections.get('AI')!;
    const expectedKeys = [
      'AttackInterval', 'AttackDelay', 'PatrolScan', 'CreditReserve',
      'PathDelay', 'OreNearScan', 'OreFarScan', 'AutocreateTime',
      'InfantryReserve', 'InfantryBaseMult', 'PowerSurplus', 'BaseSizeAdd',
      'RefineryRatio', 'RefineryLimit', 'BarracksRatio', 'BarracksLimit',
      'WarRatio', 'WarLimit', 'DefenseRatio', 'DefenseLimit',
      'AARatio', 'AALimit', 'TeslaRatio', 'TeslaLimit',
      'HelipadRatio', 'HelipadLimit', 'AirstripRatio', 'AirstripLimit',
      'CompEasyBonus', 'Paranoid', 'PowerEmergency',
    ];
    for (const key of expectedKeys) {
      expect(aiSection.has(key), `[AI] should have key '${key}'`).toBe(true);
    }
  });
});

// =============================================================================
// 2. [AI] Timing Constants -- INI vs TS AI_BUILD_RULES
// =============================================================================
describe('[AI] timing constants -- INI vs TS AI_BUILD_RULES', () => {
  it('AttackInterval: INI=3 vs TS', () => {
    const ini = iniFloat('AI', 'AttackInterval');
    expect(ini).toBe(3);
    expect(AI_BUILD_RULES.attackInterval).toBe(ini);
  });

  it('AttackDelay: INI=5 vs TS', () => {
    const ini = iniFloat('AI', 'AttackDelay');
    expect(ini).toBe(5);
    expect(AI_BUILD_RULES.attackDelay).toBe(ini);
  });

  it('PatrolScan: INI=0.016 vs TS', () => {
    const ini = iniFloat('AI', 'PatrolScan');
    expect(ini).toBeCloseTo(0.016, 3);
    expect(AI_BUILD_RULES.patrolScan).toBeCloseTo(ini, 3);
  });

  it('CreditReserve: INI=100 vs TS', () => {
    const ini = iniFloat('AI', 'CreditReserve');
    expect(ini).toBe(100);
    expect(AI_BUILD_RULES.creditReserve).toBe(ini);
  });

  it('AutocreateTime: INI=5 vs TS', () => {
    const ini = iniFloat('AI', 'AutocreateTime');
    expect(ini).toBe(5);
    expect(AI_BUILD_RULES.autocreateTime).toBe(ini);
  });
});

// =============================================================================
// 3. [AI] Harvester/Ore Constants -- INI vs TS AI_BUILD_RULES
// =============================================================================
describe('[AI] harvester/ore constants -- INI vs TS AI_BUILD_RULES', () => {
  it('OreNearScan: INI=6 vs TS', () => {
    const ini = iniFloat('AI', 'OreNearScan');
    expect(ini).toBe(6);
    expect(AI_BUILD_RULES.oreNearScan).toBe(ini);
  });

  it('OreFarScan: INI=48 vs TS', () => {
    const ini = iniFloat('AI', 'OreFarScan');
    expect(ini).toBe(48);
    expect(AI_BUILD_RULES.oreFarScan).toBe(ini);
  });
});

// =============================================================================
// 4. [AI] Infantry Constants -- INI vs TS AI_BUILD_RULES
// =============================================================================
describe('[AI] infantry constants -- INI vs TS AI_BUILD_RULES', () => {
  it('InfantryReserve: INI=3000 vs TS', () => {
    const ini = iniFloat('AI', 'InfantryReserve');
    expect(ini).toBe(3000);
    expect(AI_BUILD_RULES.infantryReserve).toBe(ini);
  });

  it('InfantryBaseMult: INI=1 vs TS', () => {
    const ini = iniFloat('AI', 'InfantryBaseMult');
    expect(ini).toBe(1);
    expect(AI_BUILD_RULES.infantryBaseMult).toBe(ini);
  });
});

// =============================================================================
// 5. [AI] Power Constants -- INI vs TS AI_BUILD_RULES
// =============================================================================
describe('[AI] power constants -- INI vs TS AI_BUILD_RULES', () => {
  it('PowerSurplus: INI=50 vs TS', () => {
    const ini = iniFloat('AI', 'PowerSurplus');
    expect(ini).toBe(50);
    expect(AI_BUILD_RULES.powerSurplus).toBe(ini);
  });

  it('PowerEmergency: INI=75% -> 0.75 vs TS', () => {
    // rules.ini stores as "75%" -- TS stores as fraction 0.75
    const raw = iniRaw('AI', 'PowerEmergency');
    expect(raw).toBe('75%');
    const iniPct = iniFloat('AI', 'PowerEmergency');
    expect(iniPct).toBe(75);
    expect(AI_BUILD_RULES.powerEmergency).toBe(iniPct / 100);
  });
});

// =============================================================================
// 6. [AI] Base Size -- INI vs TS AI_BUILD_RULES
// =============================================================================
describe('[AI] base size -- INI vs TS AI_BUILD_RULES', () => {
  it('BaseSizeAdd: INI=3 vs TS', () => {
    const ini = iniFloat('AI', 'BaseSizeAdd');
    expect(ini).toBe(3);
    expect(AI_BUILD_RULES.baseSizeAdd).toBe(ini);
  });
});

// =============================================================================
// 7. [AI] Building Ratios and Limits -- INI vs TS AI_BUILD_RULES
// =============================================================================
describe('[AI] building ratios and limits -- INI vs TS AI_BUILD_RULES', () => {
  const ratioLimits: Array<{
    iniRatioKey: string;
    iniLimitKey: string;
    tsRatioField: keyof typeof AI_BUILD_RULES;
    tsLimitField: keyof typeof AI_BUILD_RULES;
    expectedRatio: number;
    expectedLimit: number;
  }> = [
    { iniRatioKey: 'RefineryRatio',  iniLimitKey: 'RefineryLimit',  tsRatioField: 'refineryRatio',  tsLimitField: 'refineryLimit',  expectedRatio: 0.16, expectedLimit: 4 },
    { iniRatioKey: 'BarracksRatio',  iniLimitKey: 'BarracksLimit',  tsRatioField: 'barracksRatio',  tsLimitField: 'barracksLimit',  expectedRatio: 0.16, expectedLimit: 2 },
    { iniRatioKey: 'WarRatio',       iniLimitKey: 'WarLimit',       tsRatioField: 'warRatio',       tsLimitField: 'warLimit',       expectedRatio: 0.1,  expectedLimit: 2 },
    { iniRatioKey: 'DefenseRatio',   iniLimitKey: 'DefenseLimit',   tsRatioField: 'defenseRatio',   tsLimitField: 'defenseLimit',   expectedRatio: 0.4,  expectedLimit: 40 },
    { iniRatioKey: 'AARatio',        iniLimitKey: 'AALimit',        tsRatioField: 'aaRatio',        tsLimitField: 'aaLimit',        expectedRatio: 0.14, expectedLimit: 10 },
    { iniRatioKey: 'TeslaRatio',     iniLimitKey: 'TeslaLimit',     tsRatioField: 'teslaRatio',     tsLimitField: 'teslaLimit',     expectedRatio: 0.16, expectedLimit: 10 },
    { iniRatioKey: 'HelipadRatio',   iniLimitKey: 'HelipadLimit',   tsRatioField: 'helipadRatio',   tsLimitField: 'helipadLimit',   expectedRatio: 0.12, expectedLimit: 5 },
    { iniRatioKey: 'AirstripRatio',  iniLimitKey: 'AirstripLimit',  tsRatioField: 'airstripRatio',  tsLimitField: 'airstripLimit',  expectedRatio: 0.12, expectedLimit: 5 },
  ];

  for (const { iniRatioKey, iniLimitKey, tsRatioField, tsLimitField, expectedRatio, expectedLimit } of ratioLimits) {
    it(`${iniRatioKey}: INI=${expectedRatio} vs TS`, () => {
      const ini = iniFloat('AI', iniRatioKey);
      expect(ini).toBeCloseTo(expectedRatio, 2);
      expect(AI_BUILD_RULES[tsRatioField]).toBeCloseTo(ini, 2);
    });

    it(`${iniLimitKey}: INI=${expectedLimit} vs TS`, () => {
      const ini = iniFloat('AI', iniLimitKey);
      expect(ini).toBe(expectedLimit);
      expect(AI_BUILD_RULES[tsLimitField]).toBe(ini);
    });
  }
});

// =============================================================================
// 8. [AI] Behavioral Flags -- INI parse (TS may not expose these)
// =============================================================================
describe('[AI] behavioral flags -- INI parse verification', () => {
  it('CompEasyBonus: INI=yes', () => {
    expect(iniBool('AI', 'CompEasyBonus')).toBe(true);
  });

  it('Paranoid: INI=yes', () => {
    expect(iniBool('AI', 'Paranoid')).toBe(true);
  });

  it('PathDelay: INI=0.01 (minutes between path retries)', () => {
    const ini = iniFloat('AI', 'PathDelay');
    expect(ini).toBeCloseTo(0.01, 3);
    // TS uses PATH_DELAY_TICKS=9 in index.ts, derived as 0.01 * 900 = 9
    // Not directly in AI_BUILD_RULES but used in movement code
  });
});

// =============================================================================
// 9. [IQ] Section -- Verify INI values are parsed correctly
// =============================================================================
describe('[IQ] section -- rules.ini parse verification', () => {
  it('[IQ] section exists in rules.ini', () => {
    expect(sections.has('IQ')).toBe(true);
  });

  it('[IQ] has all expected keys', () => {
    const iqSection = sections.get('IQ')!;
    const expectedKeys = [
      'MaxIQLevels', 'SuperWeapons', 'Production', 'GuardArea',
      'RepairSell', 'AutoCrush', 'Scatter', 'ContentScan',
      'Aircraft', 'Harvester', 'SellBack',
    ];
    for (const key of expectedKeys) {
      expect(iqSection.has(key), `[IQ] should have key '${key}'`).toBe(true);
    }
  });
});

// =============================================================================
// 10. [IQ] Thresholds -- INI vs TS AI_BUILD_RULES.iq* fields
// =============================================================================
describe('[IQ] thresholds -- INI vs TS AI_BUILD_RULES', () => {
  it('MaxIQLevels: INI=5', () => {
    expect(iniFloat('IQ', 'MaxIQLevels')).toBe(5);
  });

  const iqThresholds: Array<{
    iniKey: string;
    tsField: keyof typeof AI_BUILD_RULES;
    expectedValue: number;
  }> = [
    { iniKey: 'SuperWeapons', tsField: 'iqSuperWeapons', expectedValue: 4 },
    { iniKey: 'Production',   tsField: 'iqProduction',   expectedValue: 5 },
    { iniKey: 'GuardArea',    tsField: 'iqGuardArea',    expectedValue: 4 },
    { iniKey: 'RepairSell',   tsField: 'iqRepairSell',   expectedValue: 1 },
    { iniKey: 'AutoCrush',    tsField: 'iqAutoCrush',    expectedValue: 2 },
    { iniKey: 'Scatter',      tsField: 'iqScatter',      expectedValue: 3 },
    { iniKey: 'ContentScan',  tsField: 'iqContentScan',  expectedValue: 4 },
    { iniKey: 'Aircraft',     tsField: 'iqAircraft',     expectedValue: 4 },
    { iniKey: 'Harvester',    tsField: 'iqHarvester',    expectedValue: 2 },
    { iniKey: 'SellBack',     tsField: 'iqSellBack',     expectedValue: 2 },
  ];

  for (const { iniKey, tsField, expectedValue } of iqThresholds) {
    it(`${iniKey}: INI=${expectedValue} vs TS AI_BUILD_RULES.${tsField}`, () => {
      const ini = iniFloat('IQ', iniKey);
      expect(ini).toBe(expectedValue);
      expect(AI_BUILD_RULES[tsField]).toBe(ini);
    });
  }
});

// =============================================================================
// 11. Difficulty Sections -- INI [Easy]/[Normal]/[Difficult] vs TS AI_DIFFICULTY_MODS
//     C++ reverses difficulty for computer:
//       easy computer   -> gets [Difficult] INI values
//       normal computer -> gets [Normal] INI values
//       hard computer   -> gets [Easy] INI values
// =============================================================================
describe('Difficulty combat biases -- INI vs TS AI_DIFFICULTY_MODS (reversed for computer)', () => {
  // Map: TS difficulty -> INI section (reversed for computer)
  const difficultyMap: Array<{
    tsDifficulty: 'easy' | 'normal' | 'hard';
    iniSection: string;
    label: string;
  }> = [
    { tsDifficulty: 'easy',   iniSection: 'Difficult', label: 'easy computer gets [Difficult]' },
    { tsDifficulty: 'normal', iniSection: 'Normal',    label: 'normal computer gets [Normal]' },
    { tsDifficulty: 'hard',   iniSection: 'Easy',      label: 'hard computer gets [Easy]' },
  ];

  for (const { tsDifficulty, iniSection, label } of difficultyMap) {
    describe(label, () => {
      const mods = AI_DIFFICULTY_MODS[tsDifficulty];

      it(`firepowerBias matches [${iniSection}] Firepower`, () => {
        expect(mods.firepowerBias).toBeCloseTo(iniFloat(iniSection, 'Firepower'), 2);
      });

      it(`armorBias matches [${iniSection}] Armor`, () => {
        expect(mods.armorBias).toBeCloseTo(iniFloat(iniSection, 'Armor'), 2);
      });

      it(`rofBias matches [${iniSection}] ROF`, () => {
        expect(mods.rofBias).toBeCloseTo(iniFloat(iniSection, 'ROF'), 2);
      });

      it(`groundspeedBias matches [${iniSection}] Groundspeed`, () => {
        expect(mods.groundspeedBias).toBeCloseTo(iniFloat(iniSection, 'Groundspeed'), 2);
      });

      it(`airspeedBias matches [${iniSection}] Airspeed`, () => {
        expect(mods.airspeedBias).toBeCloseTo(iniFloat(iniSection, 'Airspeed'), 2);
      });

      it(`costBias matches [${iniSection}] Cost`, () => {
        expect(mods.costBias).toBeCloseTo(iniFloat(iniSection, 'Cost'), 2);
      });

      it(`buildSpeedBias matches [${iniSection}] BuildTime`, () => {
        expect(mods.buildSpeedBias).toBeCloseTo(iniFloat(iniSection, 'BuildTime'), 2);
      });

      it(`repairDelay matches [${iniSection}] RepairDelay`, () => {
        expect(mods.repairDelay).toBeCloseTo(iniFloat(iniSection, 'RepairDelay'), 4);
      });

      it(`buildDelay matches [${iniSection}] BuildDelay`, () => {
        expect(mods.buildDelay).toBeCloseTo(iniFloat(iniSection, 'BuildDelay'), 4);
      });
    });
  }
});

// =============================================================================
// 12. Completeness Check -- Every key in [AI] section has a TS counterpart
// =============================================================================
describe('[AI] completeness -- every INI key maps to a TS constant', () => {
  // Mapping from rules.ini [AI] key -> AI_BUILD_RULES field name
  const aiKeyToTsField: Record<string, string> = {
    AttackInterval:   'attackInterval',
    AttackDelay:      'attackDelay',
    PatrolScan:       'patrolScan',
    CreditReserve:    'creditReserve',
    OreNearScan:      'oreNearScan',
    OreFarScan:       'oreFarScan',
    AutocreateTime:   'autocreateTime',
    InfantryReserve:  'infantryReserve',
    InfantryBaseMult: 'infantryBaseMult',
    PowerSurplus:     'powerSurplus',
    BaseSizeAdd:      'baseSizeAdd',
    RefineryRatio:    'refineryRatio',
    RefineryLimit:    'refineryLimit',
    BarracksRatio:    'barracksRatio',
    BarracksLimit:    'barracksLimit',
    WarRatio:         'warRatio',
    WarLimit:         'warLimit',
    DefenseRatio:     'defenseRatio',
    DefenseLimit:     'defenseLimit',
    AARatio:          'aaRatio',
    AALimit:          'aaLimit',
    TeslaRatio:       'teslaRatio',
    TeslaLimit:       'teslaLimit',
    HelipadRatio:     'helipadRatio',
    HelipadLimit:     'helipadLimit',
    AirstripRatio:    'airstripRatio',
    AirstripLimit:    'airstripLimit',
    PowerEmergency:   'powerEmergency',
    // PathDelay is used in index.ts (PATH_DELAY_TICKS), not AI_BUILD_RULES
    // CompEasyBonus and Paranoid are behavioral flags not yet in TS constants
  };

  for (const [iniKey, tsField] of Object.entries(aiKeyToTsField)) {
    it(`[AI].${iniKey} -> AI_BUILD_RULES.${tsField} exists`, () => {
      expect(
        (AI_BUILD_RULES as Record<string, unknown>)[tsField],
        `AI_BUILD_RULES.${tsField} for [AI].${iniKey} should be defined`
      ).toBeDefined();
    });
  }

  // Document keys NOT yet mapped to AI_BUILD_RULES
  it('PathDelay is in [AI] but handled as PATH_DELAY_TICKS in index.ts (not AI_BUILD_RULES)', () => {
    expect(iniFloat('AI', 'PathDelay')).toBeCloseTo(0.01, 3);
    // PATH_DELAY_TICKS = 0.01 * 900 = 9 (defined in index.ts, not exported from ai.ts)
  });

  it('CompEasyBonus is in [AI] but not mapped to any TS constant', () => {
    expect(iniBool('AI', 'CompEasyBonus')).toBe(true);
    // This flag controls multi-human-game AI behavior -- not yet in TS
  });

  it('Paranoid is in [AI] but not mapped to any TS constant', () => {
    expect(iniBool('AI', 'Paranoid')).toBe(true);
    // This flag controls AI-AI alliances vs humans -- not yet in TS
  });
});

// =============================================================================
// 13. Exhaustive value comparison -- catch ANY mismatch between INI and TS
// =============================================================================
describe('Exhaustive INI-vs-TS value comparison', () => {
  // For numeric [AI] fields: compare INI parsed value against TS constant
  const numericChecks: Array<{
    section: string;
    iniKey: string;
    tsField: keyof typeof AI_BUILD_RULES;
    isPercent?: boolean;  // INI stores as "75%" -> TS stores as 0.75
  }> = [
    { section: 'AI', iniKey: 'AttackInterval',   tsField: 'attackInterval' },
    { section: 'AI', iniKey: 'AttackDelay',      tsField: 'attackDelay' },
    { section: 'AI', iniKey: 'PatrolScan',       tsField: 'patrolScan' },
    { section: 'AI', iniKey: 'CreditReserve',    tsField: 'creditReserve' },
    { section: 'AI', iniKey: 'OreNearScan',      tsField: 'oreNearScan' },
    { section: 'AI', iniKey: 'OreFarScan',       tsField: 'oreFarScan' },
    { section: 'AI', iniKey: 'AutocreateTime',   tsField: 'autocreateTime' },
    { section: 'AI', iniKey: 'InfantryReserve',  tsField: 'infantryReserve' },
    { section: 'AI', iniKey: 'InfantryBaseMult', tsField: 'infantryBaseMult' },
    { section: 'AI', iniKey: 'PowerSurplus',     tsField: 'powerSurplus' },
    { section: 'AI', iniKey: 'BaseSizeAdd',      tsField: 'baseSizeAdd' },
    { section: 'AI', iniKey: 'RefineryRatio',    tsField: 'refineryRatio' },
    { section: 'AI', iniKey: 'RefineryLimit',    tsField: 'refineryLimit' },
    { section: 'AI', iniKey: 'BarracksRatio',    tsField: 'barracksRatio' },
    { section: 'AI', iniKey: 'BarracksLimit',    tsField: 'barracksLimit' },
    { section: 'AI', iniKey: 'WarRatio',         tsField: 'warRatio' },
    { section: 'AI', iniKey: 'WarLimit',         tsField: 'warLimit' },
    { section: 'AI', iniKey: 'DefenseRatio',     tsField: 'defenseRatio' },
    { section: 'AI', iniKey: 'DefenseLimit',     tsField: 'defenseLimit' },
    { section: 'AI', iniKey: 'AARatio',          tsField: 'aaRatio' },
    { section: 'AI', iniKey: 'AALimit',          tsField: 'aaLimit' },
    { section: 'AI', iniKey: 'TeslaRatio',       tsField: 'teslaRatio' },
    { section: 'AI', iniKey: 'TeslaLimit',       tsField: 'teslaLimit' },
    { section: 'AI', iniKey: 'HelipadRatio',     tsField: 'helipadRatio' },
    { section: 'AI', iniKey: 'HelipadLimit',     tsField: 'helipadLimit' },
    { section: 'AI', iniKey: 'AirstripRatio',    tsField: 'airstripRatio' },
    { section: 'AI', iniKey: 'AirstripLimit',    tsField: 'airstripLimit' },
    { section: 'AI', iniKey: 'PowerEmergency',   tsField: 'powerEmergency', isPercent: true },
    { section: 'IQ', iniKey: 'SuperWeapons',     tsField: 'iqSuperWeapons' },
    { section: 'IQ', iniKey: 'Production',       tsField: 'iqProduction' },
    { section: 'IQ', iniKey: 'GuardArea',        tsField: 'iqGuardArea' },
    { section: 'IQ', iniKey: 'RepairSell',       tsField: 'iqRepairSell' },
    { section: 'IQ', iniKey: 'AutoCrush',        tsField: 'iqAutoCrush' },
    { section: 'IQ', iniKey: 'Scatter',          tsField: 'iqScatter' },
    { section: 'IQ', iniKey: 'ContentScan',      tsField: 'iqContentScan' },
    { section: 'IQ', iniKey: 'Aircraft',         tsField: 'iqAircraft' },
    { section: 'IQ', iniKey: 'Harvester',        tsField: 'iqHarvester' },
    { section: 'IQ', iniKey: 'SellBack',         tsField: 'iqSellBack' },
  ];

  for (const { section, iniKey, tsField, isPercent } of numericChecks) {
    it(`[${section}].${iniKey} == AI_BUILD_RULES.${tsField}`, () => {
      const iniVal = iniFloat(section, iniKey);
      const tsVal = AI_BUILD_RULES[tsField] as number;
      const expected = isPercent ? iniVal / 100 : iniVal;
      expect(tsVal).toBeCloseTo(expected, 3);
    });
  }
});
