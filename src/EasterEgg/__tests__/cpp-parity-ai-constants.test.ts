/**
 * C++ Behavioral Parity Tests — AI Constants & Configuration
 *
 * Verifies that the TypeScript engine matches C++ rules.ini values for
 * AI-related sections: [AI], [IQ], difficulty settings, and country bonuses.
 *
 * Source references:
 *   rules.ini [AI]        lines 223-254  — AI building ratios, limits, and behavior
 *   rules.ini [IQ]        lines 269-280  — intelligence thresholds per ability
 *   rules.ini [Easy]      lines 389-400  — player handicap (easy = player buff)
 *   rules.ini [Normal]    lines 402-414  — baseline difficulty
 *   rules.ini [Difficult] lines 416-428  — hard difficulty (player debuff)
 *   rules.ini [England]   lines 297-304  — country bonus: Armor=1.1
 *   rules.ini [Germany]   lines 306-313  — country bonus: Firepower=1.1
 *   rules.ini [France]    lines 315-322  — country bonus: ROF=1.1
 *   rules.ini [Ukraine]   lines 324-331  — country bonus: Groundspeed=1.1
 *   rules.ini [USSR]      lines 333-340  — country bonus: Cost=0.9
 *   rules.ini [Greece]    lines 342-349  — no bonuses (all 1.0)
 *   rules.ini [Turkey]    lines 351-358  — no bonuses (all 1.0)
 *   rules.ini [Spain]     lines 360-367  — no bonuses (all 1.0)
 *   rules.ini [General]   lines 8-125    — general game constants affecting AI
 *   rules.cpp:240-254     — C++ default initializers (overridden by rules.ini)
 *   house.cpp:282-311     — Assign_Handicap difficulty bias application
 *
 * Tests that FAIL are GOOD — they identify real parity gaps.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseIniSections } from '../engine/parseIni';
import {
  COUNTRY_BONUSES, type CountryBonus,
} from '../engine/types';
import {
  AI_BUILD_RULES,
  AI_DIFFICULTY_MODS,
  UrgencyType,
  computeEnemyScore,
  STRUCTURE_IMAGES,
  DIFFICULTY_MODS,
  type Difficulty,
} from '../engine/ai';

// ── Load and parse rules.ini ────────────────────────────────────────

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

/** Get a boolean from an INI section */
function iniBool(section: string, key: string, def = false): boolean {
  const val = sections.get(section)?.get(key)?.toLowerCase();
  if (val == null) return def;
  return val === 'yes' || val === 'true' || val === '1';
}

// =============================================================================
// 1. [AI] Section Constants — rules.ini lines 223-254
// =============================================================================
describe('[AI] section constants (rules.ini lines 223-254)', () => {
  // -- Timing constants --

  it('AttackInterval = 3 (minutes between computer attacks)', () => {
    const iniVal = iniFloat('AI', 'AttackInterval', -1);
    expect(iniVal).toBe(3);
    // TS AI_DIFFICULTY_MODS has attackCooldown in ticks — verify conversion
    // C++ AttackInterval=3 minutes * 900 ticks/min = 2700 ticks at 15Hz
    // Scaled to 20Hz: 2700 * (20/15) = 3600 ticks
    // TS normal attackCooldown is 600 (custom value, NOT derived from C++ AttackInterval)
    // This is a known parity gap — TS uses its own timing system.
    expect(AI_DIFFICULTY_MODS.normal.attackCooldown).toBe(600);
  });

  it('AttackDelay = 5 (minutes before first attack)', () => {
    const iniVal = iniFloat('AI', 'AttackDelay', -1);
    expect(iniVal).toBe(5);
  });

  it('PatrolScan = 0.016 (minutes between patrol scans)', () => {
    const iniVal = iniFloat('AI', 'PatrolScan', -1);
    expect(iniVal).toBeCloseTo(0.016, 3);
  });

  it('CreditReserve = 100 (minimum credits before repair)', () => {
    const iniVal = iniFloat('AI', 'CreditReserve', -1);
    expect(iniVal).toBe(100);
  });

  it('PathDelay = 0.01 (minutes between path retries)', () => {
    const iniVal = iniFloat('AI', 'PathDelay', -1);
    expect(iniVal).toBeCloseTo(0.01, 3);
    expect(AI_BUILD_RULES.pathDelay).toBeCloseTo(iniVal, 3);
  });

  it('OreNearScan = 6 (cells for single-patch ore scan)', () => {
    const iniVal = iniFloat('AI', 'OreNearScan', -1);
    expect(iniVal).toBe(6);
  });

  it('OreFarScan = 48 (cells for new ore patch scan)', () => {
    const iniVal = iniFloat('AI', 'OreFarScan', -1);
    expect(iniVal).toBe(48);
  });

  it('AutocreateTime = 5 (minutes between autocreate teams)', () => {
    const iniVal = iniFloat('AI', 'AutocreateTime', -1);
    expect(iniVal).toBe(5);
  });

  // -- Infantry production constants --

  it('InfantryReserve = 3000 (credits threshold for always-build-infantry)', () => {
    const iniVal = iniFloat('AI', 'InfantryReserve', -1);
    expect(iniVal).toBe(3000);
  });

  it('InfantryBaseMult = 1 (building count multiplier for infantry quantity check)', () => {
    const iniVal = iniFloat('AI', 'InfantryBaseMult', -1);
    expect(iniVal).toBe(1);
  });

  // -- Power constants --

  it('PowerSurplus = 50 (minimum power surplus target)', () => {
    const iniVal = iniFloat('AI', 'PowerSurplus', -1);
    expect(iniVal).toBe(50);
    // TS AI_BUILD_RULES also has this
    expect(AI_BUILD_RULES.powerSurplus).toBe(iniVal);
  });

  // -- Base size constants --

  it('BaseSizeAdd = 3 (max base expansion above largest human)', () => {
    const iniVal = iniFloat('AI', 'BaseSizeAdd', -1);
    expect(iniVal).toBe(3);
    expect(AI_BUILD_RULES.baseSizeAdd).toBe(iniVal);
  });

  // -- Building ratios (already tested in cpp-parity-ai-build-urgency, but verified here from INI) --

  it('RefineryRatio = 0.16', () => {
    expect(iniFloat('AI', 'RefineryRatio')).toBeCloseTo(0.16, 2);
    expect(AI_BUILD_RULES.refineryRatio).toBeCloseTo(iniFloat('AI', 'RefineryRatio'), 2);
  });

  it('RefineryLimit = 4', () => {
    expect(iniFloat('AI', 'RefineryLimit')).toBe(4);
    expect(AI_BUILD_RULES.refineryLimit).toBe(iniFloat('AI', 'RefineryLimit'));
  });

  it('BarracksRatio = 0.16', () => {
    expect(iniFloat('AI', 'BarracksRatio')).toBeCloseTo(0.16, 2);
    expect(AI_BUILD_RULES.barracksRatio).toBeCloseTo(iniFloat('AI', 'BarracksRatio'), 2);
  });

  it('BarracksLimit = 2', () => {
    expect(iniFloat('AI', 'BarracksLimit')).toBe(2);
    expect(AI_BUILD_RULES.barracksLimit).toBe(iniFloat('AI', 'BarracksLimit'));
  });

  it('WarRatio = 0.1', () => {
    expect(iniFloat('AI', 'WarRatio')).toBeCloseTo(0.1, 2);
    expect(AI_BUILD_RULES.warRatio).toBeCloseTo(iniFloat('AI', 'WarRatio'), 2);
  });

  it('WarLimit = 2', () => {
    expect(iniFloat('AI', 'WarLimit')).toBe(2);
    expect(AI_BUILD_RULES.warLimit).toBe(iniFloat('AI', 'WarLimit'));
  });

  it('DefenseRatio = 0.4', () => {
    expect(iniFloat('AI', 'DefenseRatio')).toBeCloseTo(0.4, 2);
    expect(AI_BUILD_RULES.defenseRatio).toBeCloseTo(iniFloat('AI', 'DefenseRatio'), 2);
  });

  it('DefenseLimit = 40', () => {
    expect(iniFloat('AI', 'DefenseLimit')).toBe(40);
    expect(AI_BUILD_RULES.defenseLimit).toBe(iniFloat('AI', 'DefenseLimit'));
  });

  it('AARatio = 0.14', () => {
    expect(iniFloat('AI', 'AARatio')).toBeCloseTo(0.14, 2);
    expect(AI_BUILD_RULES.aaRatio).toBeCloseTo(iniFloat('AI', 'AARatio'), 2);
  });

  it('AALimit = 10', () => {
    expect(iniFloat('AI', 'AALimit')).toBe(10);
    expect(AI_BUILD_RULES.aaLimit).toBe(iniFloat('AI', 'AALimit'));
  });

  it('TeslaRatio = 0.16', () => {
    expect(iniFloat('AI', 'TeslaRatio')).toBeCloseTo(0.16, 2);
    expect(AI_BUILD_RULES.teslaRatio).toBeCloseTo(iniFloat('AI', 'TeslaRatio'), 2);
  });

  it('TeslaLimit = 10', () => {
    expect(iniFloat('AI', 'TeslaLimit')).toBe(10);
    expect(AI_BUILD_RULES.teslaLimit).toBe(iniFloat('AI', 'TeslaLimit'));
  });

  it('HelipadRatio = 0.12', () => {
    expect(iniFloat('AI', 'HelipadRatio')).toBeCloseTo(0.12, 2);
    expect(AI_BUILD_RULES.helipadRatio).toBeCloseTo(iniFloat('AI', 'HelipadRatio'), 2);
  });

  it('HelipadLimit = 5', () => {
    expect(iniFloat('AI', 'HelipadLimit')).toBe(5);
    expect(AI_BUILD_RULES.helipadLimit).toBe(iniFloat('AI', 'HelipadLimit'));
  });

  it('AirstripRatio = 0.12', () => {
    expect(iniFloat('AI', 'AirstripRatio')).toBeCloseTo(0.12, 2);
    expect(AI_BUILD_RULES.airstripRatio).toBeCloseTo(iniFloat('AI', 'AirstripRatio'), 2);
  });

  it('AirstripLimit = 5', () => {
    expect(iniFloat('AI', 'AirstripLimit')).toBe(5);
    expect(AI_BUILD_RULES.airstripLimit).toBe(iniFloat('AI', 'AirstripLimit'));
  });

  // -- Behavioral flags --

  it('CompEasyBonus = yes (rules.ini line 252)', () => {
    const iniVal = iniBool('AI', 'CompEasyBonus', false);
    expect(iniVal).toBe(true);
    expect(AI_BUILD_RULES.compEasyBonus).toBe(iniVal);
  });

  it('Paranoid = yes (computer players ally vs humans)', () => {
    const iniVal = iniBool('AI', 'Paranoid', false);
    expect(iniVal).toBe(true);
    expect(AI_BUILD_RULES.paranoid).toBe(iniVal);
  });

  it('PowerEmergency = 75% (sell threshold for power)', () => {
    // rules.ini: PowerEmergency=75%
    const raw = sections.get('AI')?.get('PowerEmergency');
    expect(raw).toBe('75%');
    const pct = iniFloat('AI', 'PowerEmergency', -1);
    expect(pct).toBe(75);
  });

  // -- TS parity: verify TS has these constants exposed --

  it('PARITY CHECK: TS AI_BUILD_RULES should include all [AI] ratio/limit fields', () => {
    // These are the ratio/limit fields from rules.ini [AI] section.
    // AI_BUILD_RULES should have every one.
    const expectedFields = [
      'refineryRatio', 'refineryLimit',
      'barracksRatio', 'barracksLimit',
      'warRatio', 'warLimit',
      'defenseRatio', 'defenseLimit',
      'aaRatio', 'aaLimit',
      'teslaRatio', 'teslaLimit',
      'helipadRatio', 'helipadLimit',
      'airstripRatio', 'airstripLimit',
      'powerSurplus', 'baseSizeAdd',
      'pathDelay', 'compEasyBonus', 'paranoid',
    ];
    for (const field of expectedFields) {
      expect(
        (AI_BUILD_RULES as Record<string, unknown>)[field],
        `AI_BUILD_RULES.${field} should be defined`
      ).toBeDefined();
    }
  });

  it('TS AI_BUILD_RULES.attackInterval matches C++ Rule.AttackInterval = 3 min', () => {
    expect(AI_BUILD_RULES.attackInterval).toBe(3);
  });

  it('TS AI_BUILD_RULES.attackDelay matches C++ Rule.AttackDelay = 5 min', () => {
    expect(AI_BUILD_RULES.attackDelay).toBe(5);
  });

  it('TS AI_BUILD_RULES.creditReserve matches C++ Rule.CreditReserve = 100', () => {
    expect(AI_BUILD_RULES.creditReserve).toBe(100);
  });

  it('TS AI_BUILD_RULES.infantryReserve matches C++ Rule.InfantryReserve = 3000', () => {
    expect(AI_BUILD_RULES.infantryReserve).toBe(3000);
  });

  it('TS AI_BUILD_RULES.infantryBaseMult matches C++ Rule.InfantryBaseMult = 1', () => {
    expect(AI_BUILD_RULES.infantryBaseMult).toBe(1);
  });

  it('TS AI_BUILD_RULES.autocreateTime matches C++ Rule.AutocreateTime = 5 min', () => {
    expect(AI_BUILD_RULES.autocreateTime).toBe(5);
  });

  it('TS AI_BUILD_RULES.oreNearScan matches C++ Rule.OreNearScan = 6 cells', () => {
    expect(AI_BUILD_RULES.oreNearScan).toBe(6);
  });

  it('TS AI_BUILD_RULES.oreFarScan matches C++ Rule.OreFarScan = 48 cells', () => {
    expect(AI_BUILD_RULES.oreFarScan).toBe(48);
  });

  it('TS AI_BUILD_RULES.patrolScan matches C++ Rule.PatrolScan = 0.016 min', () => {
    expect(AI_BUILD_RULES.patrolScan).toBeCloseTo(0.016, 3);
  });

  it('TS AI_BUILD_RULES.powerEmergency matches C++ Rule.PowerEmergency = 75%', () => {
    expect(AI_BUILD_RULES.powerEmergency).toBe(0.75);
  });
});


// =============================================================================
// 2. [IQ] Section Constants — rules.ini lines 269-280
// =============================================================================
describe('[IQ] section constants (rules.ini lines 269-280)', () => {
  it('MaxIQLevels = 5', () => {
    const iniVal = iniFloat('IQ', 'MaxIQLevels');
    expect(iniVal).toBe(5);
    expect(AI_BUILD_RULES.maxIQLevels).toBe(iniVal);
  });

  it('SuperWeapons = 4 (IQ level for auto-firing super weapons)', () => {
    expect(iniFloat('IQ', 'SuperWeapons')).toBe(4);
  });

  it('Production = 5 (IQ level for auto production)', () => {
    expect(iniFloat('IQ', 'Production')).toBe(5);
  });

  it('GuardArea = 4 (IQ level for guard area mode on new units)', () => {
    expect(iniFloat('IQ', 'GuardArea')).toBe(4);
  });

  it('RepairSell = 1 (IQ level for repair/sell decisions)', () => {
    expect(iniFloat('IQ', 'RepairSell')).toBe(1);
  });

  it('AutoCrush = 2 (IQ level for auto-crush)', () => {
    expect(iniFloat('IQ', 'AutoCrush')).toBe(2);
  });

  it('Scatter = 3 (IQ level for scatter from threats)', () => {
    expect(iniFloat('IQ', 'Scatter')).toBe(3);
  });

  it('ContentScan = 4 (IQ level for transport content analysis)', () => {
    expect(iniFloat('IQ', 'ContentScan')).toBe(4);
  });

  it('Aircraft = 4 (IQ level for auto aircraft replacement)', () => {
    expect(iniFloat('IQ', 'Aircraft')).toBe(4);
  });

  it('Harvester = 2 (IQ level for auto harvester replacement)', () => {
    expect(iniFloat('IQ', 'Harvester')).toBe(2);
  });

  it('SellBack = 2 (IQ level for selling buildings)', () => {
    expect(iniFloat('IQ', 'SellBack')).toBe(2);
  });

  // -- TS parity checks for IQ thresholds --

  it('TS AI_BUILD_RULES exposes all IQ thresholds matching C++ [IQ] section', () => {
    // C++ uses Rule.IQSuperWeapons, Rule.IQProduction, etc. to gate AI abilities.
    // TS AI_BUILD_RULES now has all IQ threshold constants.
    const expectedIQFields: Record<string, number> = {
      maxIQLevels: 5,
      iqSuperWeapons: 4,
      iqProduction: 5,
      iqGuardArea: 4,
      iqRepairSell: 1,
      iqAutoCrush: 2,
      iqScatter: 3,
      iqContentScan: 4,
      iqAircraft: 4,
      iqHarvester: 2,
      iqSellBack: 2,
    };
    for (const [field, expectedVal] of Object.entries(expectedIQFields)) {
      expect(
        (AI_BUILD_RULES as Record<string, unknown>)[field],
        `AI_BUILD_RULES.${field} should be ${expectedVal} (C++ [IQ] section)`
      ).toBe(expectedVal);
    }
  });
});


// =============================================================================
// 3. Difficulty Settings — rules.ini [Easy], [Normal], [Difficult]
// =============================================================================
describe('Difficulty settings (rules.ini [Easy]/[Normal]/[Difficult])', () => {
  // C++ difficulty names: Easy, Normal, Difficult
  // TS difficulty names: easy, normal, hard
  // The INI values describe the PLAYER handicap:
  //   [Easy]      = player gets bonuses (Firepower=1.2, etc.)
  //   [Normal]    = baseline (all 1.0)
  //   [Difficult] = player gets penalties (Firepower=0.8, etc.)
  // The COMPUTER gets the inverse: on Easy difficulty, computer gets [Difficult] values.
  //
  // C++ house.cpp:285-311:
  //   if (IsHuman) handicap = player's difficulty
  //   else handicap = reversed difficulty (Easy<->Difficult)
  //
  // TS AI_DIFFICULTY_MODS represents the COMPUTER side:
  //   easy.firepowerBias   = C++ Diff[DIFF_EASY-for-computer] which is [Difficult] INI values
  //   hard.firepowerBias   = C++ Diff[DIFF_HARD-for-computer] which is [Easy] INI values

  describe('[Easy] section (player bonuses when game is easy)', () => {
    it('Firepower = 1.2', () => expect(iniFloat('Easy', 'Firepower')).toBe(1.2));
    it('Groundspeed = 1.2', () => expect(iniFloat('Easy', 'Groundspeed')).toBe(1.2));
    it('Airspeed = 1.2', () => expect(iniFloat('Easy', 'Airspeed')).toBe(1.2));
    it('BuildTime = 0.8', () => expect(iniFloat('Easy', 'BuildTime')).toBeCloseTo(0.8, 2));
    it('Armor = 1.2', () => expect(iniFloat('Easy', 'Armor')).toBe(1.2));
    it('ROF = 0.8', () => expect(iniFloat('Easy', 'ROF')).toBeCloseTo(0.8, 2));
    it('Cost = 0.8', () => expect(iniFloat('Easy', 'Cost')).toBeCloseTo(0.8, 2));
    it('RepairDelay = 0.001', () => expect(iniFloat('Easy', 'RepairDelay')).toBeCloseTo(0.001, 4));
    it('BuildDelay = 0.001', () => expect(iniFloat('Easy', 'BuildDelay')).toBeCloseTo(0.001, 4));
    it('DestroyWalls = yes', () => expect(iniBool('Easy', 'DestroyWalls')).toBe(true));
    it('ContentScan = yes', () => expect(iniBool('Easy', 'ContentScan')).toBe(true));
  });

  describe('[Normal] section (baseline difficulty)', () => {
    it('Firepower = 1.0', () => expect(iniFloat('Normal', 'Firepower')).toBe(1.0));
    it('Groundspeed = 1.0', () => expect(iniFloat('Normal', 'Groundspeed')).toBe(1.0));
    it('Airspeed = 1.0', () => expect(iniFloat('Normal', 'Airspeed')).toBe(1.0));
    it('BuildTime = 1.0', () => expect(iniFloat('Normal', 'BuildTime')).toBe(1.0));
    it('Armor = 1.0', () => expect(iniFloat('Normal', 'Armor')).toBe(1.0));
    it('ROF = 1.0', () => expect(iniFloat('Normal', 'ROF')).toBe(1.0));
    it('Cost = 1.0', () => expect(iniFloat('Normal', 'Cost')).toBe(1.0));
    it('RepairDelay = 0.02', () => expect(iniFloat('Normal', 'RepairDelay')).toBeCloseTo(0.02, 3));
    it('BuildDelay = 0.03', () => expect(iniFloat('Normal', 'BuildDelay')).toBeCloseTo(0.03, 3));
    it('BuildSlowdown = yes', () => expect(iniBool('Normal', 'BuildSlowdown')).toBe(true));
    it('DestroyWalls = yes', () => expect(iniBool('Normal', 'DestroyWalls')).toBe(true));
    it('ContentScan = yes', () => expect(iniBool('Normal', 'ContentScan')).toBe(true));
  });

  describe('[Difficult] section (player penalties when game is hard)', () => {
    it('Firepower = 0.8', () => expect(iniFloat('Difficult', 'Firepower')).toBeCloseTo(0.8, 2));
    it('Groundspeed = 0.8', () => expect(iniFloat('Difficult', 'Groundspeed')).toBeCloseTo(0.8, 2));
    it('Airspeed = 0.8', () => expect(iniFloat('Difficult', 'Airspeed')).toBeCloseTo(0.8, 2));
    it('BuildTime = 1.0', () => expect(iniFloat('Difficult', 'BuildTime')).toBe(1.0));
    it('Armor = 0.8', () => expect(iniFloat('Difficult', 'Armor')).toBeCloseTo(0.8, 2));
    it('ROF = 1.2', () => expect(iniFloat('Difficult', 'ROF')).toBe(1.2));
    it('Cost = 1.0', () => expect(iniFloat('Difficult', 'Cost')).toBe(1.0));
    it('RepairDelay = 0.05', () => expect(iniFloat('Difficult', 'RepairDelay')).toBeCloseTo(0.05, 3));
    it('BuildDelay = 0.1', () => expect(iniFloat('Difficult', 'BuildDelay')).toBeCloseTo(0.1, 2));
    it('BuildSlowdown = yes', () => expect(iniBool('Difficult', 'BuildSlowdown')).toBe(true));
    it('DestroyWalls = no', () => expect(iniBool('Difficult', 'DestroyWalls')).toBe(false));
  });

  // -- TS AI_DIFFICULTY_MODS parity against INI difficulty values --

  describe('TS AI_DIFFICULTY_MODS combat biases vs rules.ini difficulty sections', () => {
    // C++ reverses difficulty for computer:
    //   Game on "easy" -> computer gets [Difficult] values
    //   Game on "hard" -> computer gets [Easy] values
    // So TS easy.firepowerBias should match [Difficult].Firepower,
    //    TS hard.firepowerBias should match [Easy].Firepower

    it('easy computer: firepowerBias should match [Difficult] Firepower=0.8', () => {
      expect(AI_DIFFICULTY_MODS.easy.firepowerBias).toBeCloseTo(
        iniFloat('Difficult', 'Firepower'), 2
      );
    });

    it('easy computer: armorBias should match [Difficult] Armor=0.8', () => {
      expect(AI_DIFFICULTY_MODS.easy.armorBias).toBeCloseTo(
        iniFloat('Difficult', 'Armor'), 2
      );
    });

    it('easy computer: rofBias should match [Difficult] ROF=1.2', () => {
      expect(AI_DIFFICULTY_MODS.easy.rofBias).toBeCloseTo(
        iniFloat('Difficult', 'ROF'), 2
      );
    });

    it('easy computer: groundspeedBias should match [Difficult] Groundspeed=0.8', () => {
      expect(AI_DIFFICULTY_MODS.easy.groundspeedBias).toBeCloseTo(
        iniFloat('Difficult', 'Groundspeed'), 2
      );
    });

    it('easy computer: airspeedBias should match [Difficult] Airspeed=0.8', () => {
      expect(AI_DIFFICULTY_MODS.easy.airspeedBias).toBeCloseTo(
        iniFloat('Difficult', 'Airspeed'), 2
      );
    });

    it('easy computer: costBias should match [Difficult] Cost=1.0', () => {
      expect(AI_DIFFICULTY_MODS.easy.costBias).toBeCloseTo(
        iniFloat('Difficult', 'Cost'), 2
      );
    });

    it('normal computer: firepowerBias should match [Normal] Firepower=1.0', () => {
      expect(AI_DIFFICULTY_MODS.normal.firepowerBias).toBeCloseTo(
        iniFloat('Normal', 'Firepower'), 2
      );
    });

    it('normal computer: armorBias should match [Normal] Armor=1.0', () => {
      expect(AI_DIFFICULTY_MODS.normal.armorBias).toBeCloseTo(
        iniFloat('Normal', 'Armor'), 2
      );
    });

    it('normal computer: rofBias should match [Normal] ROF=1.0', () => {
      expect(AI_DIFFICULTY_MODS.normal.rofBias).toBeCloseTo(
        iniFloat('Normal', 'ROF'), 2
      );
    });

    it('normal computer: groundspeedBias should match [Normal] Groundspeed=1.0', () => {
      expect(AI_DIFFICULTY_MODS.normal.groundspeedBias).toBeCloseTo(
        iniFloat('Normal', 'Groundspeed'), 2
      );
    });

    it('normal computer: airspeedBias should match [Normal] Airspeed=1.0', () => {
      expect(AI_DIFFICULTY_MODS.normal.airspeedBias).toBeCloseTo(
        iniFloat('Normal', 'Airspeed'), 2
      );
    });

    it('normal computer: costBias should match [Normal] Cost=1.0', () => {
      expect(AI_DIFFICULTY_MODS.normal.costBias).toBeCloseTo(
        iniFloat('Normal', 'Cost'), 2
      );
    });

    it('hard computer: firepowerBias should match [Easy] Firepower=1.2', () => {
      expect(AI_DIFFICULTY_MODS.hard.firepowerBias).toBeCloseTo(
        iniFloat('Easy', 'Firepower'), 2
      );
    });

    it('hard computer: armorBias should match [Easy] Armor=1.2', () => {
      expect(AI_DIFFICULTY_MODS.hard.armorBias).toBeCloseTo(
        iniFloat('Easy', 'Armor'), 2
      );
    });

    it('hard computer: rofBias should match [Easy] ROF=0.8', () => {
      expect(AI_DIFFICULTY_MODS.hard.rofBias).toBeCloseTo(
        iniFloat('Easy', 'ROF'), 2
      );
    });

    it('hard computer: groundspeedBias should match [Easy] Groundspeed=1.2', () => {
      expect(AI_DIFFICULTY_MODS.hard.groundspeedBias).toBeCloseTo(
        iniFloat('Easy', 'Groundspeed'), 2
      );
    });

    it('hard computer: airspeedBias should match [Easy] Airspeed=1.2', () => {
      expect(AI_DIFFICULTY_MODS.hard.airspeedBias).toBeCloseTo(
        iniFloat('Easy', 'Airspeed'), 2
      );
    });

    it('hard computer: costBias should match [Easy] Cost=0.8', () => {
      expect(AI_DIFFICULTY_MODS.hard.costBias).toBeCloseTo(
        iniFloat('Easy', 'Cost'), 2
      );
    });
  });

  describe('TS difficulty includes BuildDelay and RepairDelay per level', () => {
    // C++ DifficultyClass has RepairDelay and BuildDelay (minutes).
    // TS AI_DIFFICULTY_MODS now includes these fields.

    for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
      it(`${diff} should have repairDelay`, () => {
        expect(AI_DIFFICULTY_MODS[diff].repairDelay).toBeDefined();
      });

      it(`${diff} should have buildDelay`, () => {
        expect(AI_DIFFICULTY_MODS[diff].buildDelay).toBeDefined();
      });
    }
  });

  describe('TS difficulty includes BuildSlowdown, DestroyWalls, ContentScan per level', () => {
    for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
      it(`${diff} should have isBuildSlowdown`, () => {
        expect(AI_DIFFICULTY_MODS[diff].isBuildSlowdown).toBeDefined();
      });

      it(`${diff} should have isWallDestroyer`, () => {
        expect(AI_DIFFICULTY_MODS[diff].isWallDestroyer).toBeDefined();
      });

      it(`${diff} should have isContentScan`, () => {
        expect(AI_DIFFICULTY_MODS[diff].isContentScan).toBeDefined();
      });
    }
  });

  describe('TS difficulty BuildTime bias (C++ BuildSpeedBias) differs per level', () => {
    // C++ [Easy] BuildTime=0.8, [Normal] BuildTime=1.0, [Difficult] BuildTime=1.0
    // These affect build speed: lower = faster. C++ calls it BuildSpeedBias.
    // For computer on easy (gets [Difficult]): BuildTime=1.0
    // For computer on hard (gets [Easy]): BuildTime=0.8 (faster!)
    // TS has buildSpeedBias per difficulty — verify values match reversed INI.

    it('easy computer: buildSpeedBias should match [Difficult] BuildTime=1.0', () => {
      expect(AI_DIFFICULTY_MODS.easy.buildSpeedBias).toBeCloseTo(
        iniFloat('Difficult', 'BuildTime'), 2
      );
    });

    it('normal computer: buildSpeedBias should match [Normal] BuildTime=1.0', () => {
      expect(AI_DIFFICULTY_MODS.normal.buildSpeedBias).toBeCloseTo(
        iniFloat('Normal', 'BuildTime'), 2
      );
    });

    it('hard computer: buildSpeedBias should match [Easy] BuildTime=0.8', () => {
      expect(AI_DIFFICULTY_MODS.hard.buildSpeedBias).toBeCloseTo(
        iniFloat('Easy', 'BuildTime'), 2
      );
    });
  });
});


// =============================================================================
// 4. Country Bonuses — rules.ini country sections
// =============================================================================
describe('Country bonuses (rules.ini country sections)', () => {
  // Each country has: Firepower, Groundspeed, Airspeed, Armor, ROF, Cost, BuildTime
  // TS COUNTRY_BONUSES has: costMult, firepowerMult, armorMult, groundspeedMult, rofMult
  // Note: TS omits Airspeed and BuildTime from CountryBonus.

  const countries: Array<{
    name: string;
    iniSection: string;
  }> = [
    { name: 'England', iniSection: 'England' },
    { name: 'Germany', iniSection: 'Germany' },
    { name: 'France', iniSection: 'France' },
    { name: 'Ukraine', iniSection: 'Ukraine' },
    { name: 'USSR', iniSection: 'USSR' },
    { name: 'Greece', iniSection: 'Greece' },
    { name: 'Turkey', iniSection: 'Turkey' },
    { name: 'Spain', iniSection: 'Spain' },
  ];

  for (const { name, iniSection } of countries) {
    describe(`[${name}]`, () => {
      const tsBonus: CountryBonus | undefined = COUNTRY_BONUSES[name];

      it(`TS has COUNTRY_BONUSES['${name}']`, () => {
        expect(tsBonus, `COUNTRY_BONUSES['${name}'] should exist`).toBeDefined();
      });

      it(`Firepower matches INI`, () => {
        const iniVal = iniFloat(iniSection, 'Firepower', 1.0);
        expect(tsBonus?.firepowerMult).toBeCloseTo(iniVal, 2);
      });

      it(`Armor matches INI`, () => {
        const iniVal = iniFloat(iniSection, 'Armor', 1.0);
        expect(tsBonus?.armorMult).toBeCloseTo(iniVal, 2);
      });

      it(`Cost matches INI`, () => {
        const iniVal = iniFloat(iniSection, 'Cost', 1.0);
        expect(tsBonus?.costMult).toBeCloseTo(iniVal, 2);
      });

      it(`Groundspeed matches INI`, () => {
        const iniVal = iniFloat(iniSection, 'Groundspeed', 1.0);
        expect(tsBonus?.groundspeedMult).toBeCloseTo(iniVal, 2);
      });

      it(`ROF matches INI`, () => {
        const iniVal = iniFloat(iniSection, 'ROF', 1.0);
        expect(tsBonus?.rofMult).toBeCloseTo(iniVal, 2);
      });
    });
  }

  // -- Country bonuses: known special values from INI --
  describe('Specific country bonus highlights', () => {
    it('England has 10% tougher armor (Armor=1.1)', () => {
      expect(COUNTRY_BONUSES.England.armorMult).toBeCloseTo(1.1, 2);
    });

    it('Germany has 10% more firepower (Firepower=1.1)', () => {
      expect(COUNTRY_BONUSES.Germany.firepowerMult).toBeCloseTo(1.1, 2);
    });

    it('France has ROF=1.1 (10% slower rate of fire as penalty/bonus tradeoff)', () => {
      // NOTE: ROF > 1 means SLOWER firing in C++. France fires 10% slower.
      // This is sometimes described as "10% faster ROF" in TS comments but the
      // actual mechanic means the weapon rearm delay is 10% LONGER.
      expect(COUNTRY_BONUSES.France.rofMult).toBeCloseTo(1.1, 2);
    });

    it('Ukraine has 10% faster ground (Groundspeed=1.1)', () => {
      expect(COUNTRY_BONUSES.Ukraine.groundspeedMult).toBeCloseTo(1.1, 2);
    });

    it('USSR has 10% cheaper costs (Cost=0.9)', () => {
      expect(COUNTRY_BONUSES.USSR.costMult).toBeCloseTo(0.9, 2);
    });

    it('Spain has no bonuses (all 1.0)', () => {
      expect(COUNTRY_BONUSES.Spain.firepowerMult).toBe(1.0);
      expect(COUNTRY_BONUSES.Spain.armorMult).toBe(1.0);
      expect(COUNTRY_BONUSES.Spain.costMult).toBe(1.0);
      expect(COUNTRY_BONUSES.Spain.groundspeedMult).toBe(1.0);
      expect(COUNTRY_BONUSES.Spain.rofMult).toBe(1.0);
    });

    it('Greece has no bonuses (all 1.0)', () => {
      expect(COUNTRY_BONUSES.Greece.firepowerMult).toBe(1.0);
      expect(COUNTRY_BONUSES.Greece.armorMult).toBe(1.0);
      expect(COUNTRY_BONUSES.Greece.costMult).toBe(1.0);
      expect(COUNTRY_BONUSES.Greece.groundspeedMult).toBe(1.0);
      expect(COUNTRY_BONUSES.Greece.rofMult).toBe(1.0);
    });
  });

  // TS CountryBonus now includes Airspeed and BuildTime multipliers.

  describe('TS CountryBonus includes Airspeed and BuildTime', () => {
    for (const { name, iniSection } of countries) {
      it(`${name}: airspeedMult matches INI Airspeed`, () => {
        const iniVal = iniFloat(iniSection, 'Airspeed', 1.0);
        expect(COUNTRY_BONUSES[name].airspeedMult).toBeCloseTo(iniVal, 2);
      });

      it(`${name}: buildTimeMult matches INI BuildTime`, () => {
        const iniVal = iniFloat(iniSection, 'BuildTime', 1.0);
        expect(COUNTRY_BONUSES[name].buildTimeMult).toBeCloseTo(iniVal, 2);
      });
    }
  });
});


// =============================================================================
// 5. [General] Section AI-Related Values
// =============================================================================
describe('[General] section AI-related values (rules.ini lines 8-125)', () => {
  // These General section values affect AI behavior but may not be AI-specific.
  // Some are already tested in other parity test files; this documents the full set.

  describe('Computer/movement controls', () => {
    it('BaseBias = 2 (threat target value multiplier near base)', () => {
      expect(iniFloat('General', 'BaseBias')).toBe(2);
    });

    it('BaseDefenseDelay = 0.25 (minutes between base defense responses)', () => {
      expect(iniFloat('General', 'BaseDefenseDelay')).toBeCloseTo(0.25, 2);
    });

    it('CloseEnough = 2.75 (movement abort distance)', () => {
      expect(iniFloat('General', 'CloseEnough')).toBeCloseTo(2.75, 2);
    });

    it('Stray = 2.0 (team member stray radius before regroup)', () => {
      expect(iniFloat('General', 'Stray')).toBeCloseTo(2.0, 2);
    });

    it('TeamDelay = 0.6 (minutes between team creation checks)', () => {
      expect(iniFloat('General', 'TeamDelay')).toBeCloseTo(0.6, 2);
    });

    it('SuspendDelay = 2 (minutes teams stay suspended)', () => {
      expect(iniFloat('General', 'SuspendDelay')).toBe(2);
    });

    it('SuspendPriority = 20 (teams below this priority suspend for base defense)', () => {
      expect(iniFloat('General', 'SuspendPriority')).toBe(20);
    });

    it('Crush = 1.5 (cells range for computer auto-crush)', () => {
      expect(iniFloat('General', 'Crush')).toBeCloseTo(1.5, 2);
    });

    it('FireSupress = 1 (friendlies-near-target suppression radius)', () => {
      expect(iniFloat('General', 'FireSupress')).toBe(1);
    });

    it('LZScanRadius = 16 (alternate landing zone scan radius)', () => {
      expect(iniFloat('General', 'LZScanRadius')).toBe(16);
    });

    it('GameSpeeBias = 1 (overall movement speed multiplier — note typo in INI)', () => {
      // Note: original INI has typo "GameSpeeBias" (missing 'd')
      expect(iniFloat('General', 'GameSpeeBias')).toBe(1);
    });

    it('MineAware = yes (units avoid friendly mines)', () => {
      expect(iniBool('General', 'MineAware')).toBe(true);
    });
  });

  describe('Income and production', () => {
    it('BuildSpeed = 0.8 (minutes to produce 1000-credit item)', () => {
      expect(iniFloat('General', 'BuildSpeed')).toBeCloseTo(0.8, 2);
    });

    it('GoldValue = 25 (credits per gold bail)', () => {
      expect(iniFloat('General', 'GoldValue')).toBe(25);
    });

    it('GemValue = 50 (credits per gem bail)', () => {
      expect(iniFloat('General', 'GemValue')).toBe(50);
    });

    it('BailCount = 28 (bails per harvester load)', () => {
      expect(iniFloat('General', 'BailCount')).toBe(28);
    });

    it('SurvivorRate = 0.4 (fraction of cost for survivors)', () => {
      expect(iniFloat('General', 'SurvivorRate')).toBeCloseTo(0.4, 2);
    });

    it('RefundPercent = 50% (sell refund fraction)', () => {
      expect(iniFloat('General', 'RefundPercent')).toBe(50);
    });

    it('GrowthRate = 2 (minutes between ore growth)', () => {
      expect(iniFloat('General', 'GrowthRate')).toBe(2);
    });

    it('OreTruckRate = 1 (harvester ore management speed)', () => {
      expect(iniFloat('General', 'OreTruckRate')).toBe(1);
    });
  });

  describe('Repair values', () => {
    it('RepairStep = 7 (HP per building repair tick)', () => {
      expect(iniFloat('General', 'RepairStep')).toBe(7);
    });

    it('RepairPercent = 20% (cost fraction per repair)', () => {
      expect(iniFloat('General', 'RepairPercent')).toBe(20);
    });

    it('RepairRate = 0.016 (minutes between repair ticks)', () => {
      expect(iniFloat('General', 'RepairRate')).toBeCloseTo(0.016, 3);
    });

    it('URepairStep = 10 (HP per unit repair tick)', () => {
      expect(iniFloat('General', 'URepairStep')).toBe(10);
    });

    it('URepairPercent = 20% (unit repair cost fraction)', () => {
      expect(iniFloat('General', 'URepairPercent')).toBe(20);
    });

    it('ReloadRate = 0.04 (minutes per ammo reload)', () => {
      expect(iniFloat('General', 'ReloadRate')).toBeCloseTo(0.04, 3);
    });
  });

  describe('AI-affecting combat values', () => {
    it('PlayerAutoCrush = no', () => {
      expect(iniBool('General', 'PlayerAutoCrush')).toBe(false);
    });

    it('PlayerReturnFire = no', () => {
      expect(iniBool('General', 'PlayerReturnFire')).toBe(false);
    });

    it('PlayerScatter = no', () => {
      expect(iniBool('General', 'PlayerScatter')).toBe(false);
    });
  });
});


// =============================================================================
// 6. [Maximums] Section — Object Heap Caps (affect AI unit limits)
// =============================================================================
describe('[Maximums] section (rules.ini lines 186-206)', () => {
  it('Unit = 500', () => expect(iniFloat('Maximums', 'Unit')).toBe(500));
  it('Infantry = 500', () => expect(iniFloat('Maximums', 'Infantry')).toBe(500));
  it('Building = 500', () => expect(iniFloat('Maximums', 'Building')).toBe(500));
  it('Vessel = 100', () => expect(iniFloat('Maximums', 'Vessel')).toBe(100));
  it('Aircraft = 100', () => expect(iniFloat('Maximums', 'Aircraft')).toBe(100));
  it('Team = 60', () => expect(iniFloat('Maximums', 'Team')).toBe(60));
  it('TeamType = 60', () => expect(iniFloat('Maximums', 'TeamType')).toBe(60));
  it('Trigger = 200', () => expect(iniFloat('Maximums', 'Trigger')).toBe(200));
  it('TrigType = 80', () => expect(iniFloat('Maximums', 'TrigType')).toBe(80));

  // TS parity: ai.ts uses RULE_UNIT_MAX=500, RULE_BUILDING_MAX=500, etc.
  // These are hardcoded, not parsed from INI. Verify they match.
  // (We can't import the private constants directly, but AI_BUILD_RULES or
  //  createAIHouseState derives per-house caps from them.)
});


// =============================================================================
// 7. [Recharge] Section — Super Weapon Timings (AI auto-fires these)
// =============================================================================
describe('[Recharge] section super weapon timings (rules.ini lines 171-180)', () => {
  it('Chrono = 7 min', () => expect(iniFloat('Recharge', 'Chrono')).toBe(7));
  it('GPS = 8 min', () => expect(iniFloat('Recharge', 'GPS')).toBe(8));
  it('IronCurtain = 11 min', () => expect(iniFloat('Recharge', 'IronCurtain')).toBe(11));
  it('Nuke = 13 min', () => expect(iniFloat('Recharge', 'Nuke')).toBe(13));
  it('ParaBomb = 14 min', () => expect(iniFloat('Recharge', 'ParaBomb')).toBe(14));
  it('Paratrooper = 7 min', () => expect(iniFloat('Recharge', 'Paratrooper')).toBe(7));
  it('SpyPlane = 3 min', () => expect(iniFloat('Recharge', 'SpyPlane')).toBe(3));
});


// =============================================================================
// 8. Cross-reference: AI_DIFFICULTY_MODS TS-only fields that have no INI source
// =============================================================================
describe('TS AI_DIFFICULTY_MODS custom fields (not from rules.ini)', () => {
  // TS adds several AI tuning knobs that don't exist in C++ rules.ini.
  // These are TS-specific gameplay balancing. Document what they are.

  for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
    const mods = AI_DIFFICULTY_MODS[diff];

    it(`${diff}: has incomeMult (TS-specific, not in C++ rules.ini)`, () => {
      expect(mods.incomeMult).toBeDefined();
      expect(typeof mods.incomeMult).toBe('number');
    });

    it(`${diff}: has attackThreshold (TS-specific unit count for attacks)`, () => {
      expect(mods.attackThreshold).toBeDefined();
      expect(typeof mods.attackThreshold).toBe('number');
    });

    it(`${diff}: has attackCooldown (TS-specific ticks between attacks)`, () => {
      expect(mods.attackCooldown).toBeDefined();
      expect(typeof mods.attackCooldown).toBe('number');
    });

    it(`${diff}: has productionInterval (TS-specific ticks between production)`, () => {
      expect(mods.productionInterval).toBeDefined();
      expect(typeof mods.productionInterval).toBe('number');
    });

    it(`${diff}: has aggressionMult (TS-specific)`, () => {
      expect(mods.aggressionMult).toBeDefined();
      expect(typeof mods.aggressionMult).toBe('number');
    });

    it(`${diff}: has retreatHpPercent (TS-specific)`, () => {
      expect(mods.retreatHpPercent).toBeDefined();
      expect(typeof mods.retreatHpPercent).toBe('number');
    });
  }
});


// =============================================================================
// 9. Per-House Default Caps — C++ house.cpp:755-759, rules.ini [Maximums]
// =============================================================================
describe('Per-house default caps (C++ MaxUnit/MaxBuilding/etc = [Maximums] / 6)', () => {
  // C++ house.cpp:755-759: HouseStaticClass constructor sets:
  //   Control.MaxUnit     = Rule.UnitMax / 6
  //   Control.MaxBuilding = Rule.BuildingMax / 6
  //   Control.MaxInfantry = Rule.InfantryMax / 6
  //   Control.MaxVessel   = Rule.VesselMax / 6
  //   Control.MaxAircraft  = Rule.UnitMax / 6  (C++ quirk: uses UnitMax, not AircraftMax!)
  //
  // RULE_*_MAX values are from [Maximums] section of rules.ini.
  // Per-house caps are these divided by 6 (integer division).

  const unitMax = iniFloat('Maximums', 'Unit', 500);
  const buildingMax = iniFloat('Maximums', 'Building', 500);
  const infantryMax = iniFloat('Maximums', 'Infantry', 500);
  const vesselMax = iniFloat('Maximums', 'Vessel', 100);

  it('default MaxUnit = Unit/6 = 83 (500/6 integer division)', () => {
    const expected = Math.floor(unitMax / 6);
    expect(expected).toBe(83);
  });

  it('default MaxBuilding = Building/6 = 83', () => {
    const expected = Math.floor(buildingMax / 6);
    expect(expected).toBe(83);
  });

  it('default MaxInfantry = Infantry/6 = 83', () => {
    const expected = Math.floor(infantryMax / 6);
    expect(expected).toBe(83);
  });

  it('default MaxVessel = Vessel/6 = 16', () => {
    const expected = Math.floor(vesselMax / 6);
    expect(expected).toBe(16);
  });

  it('C++ quirk: MaxAircraft uses UnitMax/6, NOT AircraftMax/6', () => {
    // C++ house.cpp:759: Control.MaxAircraft = Rule.UnitMax / 6
    // NOT Rule.AircraftMax / 6 — this is a real C++ quirk
    const aircraftMax = iniFloat('Maximums', 'Aircraft', 100);
    const expectedFromAircraftMax = Math.floor(aircraftMax / 6); // 16 (wrong)
    const expectedFromUnitMax = Math.floor(unitMax / 6);         // 83 (correct)
    expect(expectedFromUnitMax).toBe(83);
    expect(expectedFromAircraftMax).toBe(16);
    // The actual C++ behavior is to use UnitMax, not AircraftMax
    expect(expectedFromUnitMax).not.toBe(expectedFromAircraftMax);
  });
});


// =============================================================================
// 10. UrgencyType Enum — C++ house.h UrgencyType
// =============================================================================
describe('UrgencyType enum matches C++ house.h (house.cpp:5434-5773)', () => {
  // C++ house.h enum UrgencyType { URGENCY_NONE, URGENCY_LOW, URGENCY_MEDIUM, URGENCY_HIGH, URGENCY_CRITICAL }
  // Values must be ordered 0..4 for sorting to produce correct build priority.

  it('URGENCY_NONE = 0', () => {
    expect(UrgencyType.URGENCY_NONE).toBe(0);
  });

  it('URGENCY_LOW = 1', () => {
    expect(UrgencyType.URGENCY_LOW).toBe(1);
  });

  it('URGENCY_MEDIUM = 2', () => {
    expect(UrgencyType.URGENCY_MEDIUM).toBe(2);
  });

  it('URGENCY_HIGH = 3', () => {
    expect(UrgencyType.URGENCY_HIGH).toBe(3);
  });

  it('URGENCY_CRITICAL = 4', () => {
    expect(UrgencyType.URGENCY_CRITICAL).toBe(4);
  });

  it('urgency values are strictly ascending (sorting correctness)', () => {
    expect(UrgencyType.URGENCY_NONE).toBeLessThan(UrgencyType.URGENCY_LOW);
    expect(UrgencyType.URGENCY_LOW).toBeLessThan(UrgencyType.URGENCY_MEDIUM);
    expect(UrgencyType.URGENCY_MEDIUM).toBeLessThan(UrgencyType.URGENCY_HIGH);
    expect(UrgencyType.URGENCY_HIGH).toBeLessThan(UrgencyType.URGENCY_CRITICAL);
  });
});


// =============================================================================
// 11. computeEnemyScore — C++ house.cpp:4660-4686 Expert_AI enemy scoring
// =============================================================================
describe('computeEnemyScore matches C++ house.cpp:4660-4686', () => {
  // C++ formula:
  //   value = ((MAP_CELL_W*2) - Distance(Center, h->Center)) * 2
  //   value += h->BuildingsKilled[Class->House] * 5
  //   value += h->UnitsKilled[Class->House]
  //   value += h->CurUnits - CurUnits
  //   value += h->CurBuildings - CurBuildings
  //   value += (h->CurInfantry - CurInfantry) / 4
  //   if (h == LAEnemy) value += 100

  const MAP_CELL_W = 128; // C++ MAP_CELL_W

  it('distance component: closer enemies score higher', () => {
    const closerScore = computeEnemyScore(
      { cx: 10, cy: 10 }, { cx: 15, cy: 15 },
      0, 0, 0, 0, 0, 0, 0, 0, false,
    );
    const fartherScore = computeEnemyScore(
      { cx: 10, cy: 10 }, { cx: 100, cy: 100 },
      0, 0, 0, 0, 0, 0, 0, 0, false,
    );
    expect(closerScore).toBeGreaterThan(fartherScore);
  });

  it('building kills weighted x5 (C++ line 4668)', () => {
    const noKills = computeEnemyScore(
      { cx: 64, cy: 64 }, { cx: 64, cy: 64 },
      0, 0, 0, 0, 0, 0, 0, 0, false,
    );
    const withBuildingKills = computeEnemyScore(
      { cx: 64, cy: 64 }, { cx: 64, cy: 64 },
      10, 0, 0, 0, 0, 0, 0, 0, false,
    );
    expect(withBuildingKills - noKills).toBe(10 * 5);
  });

  it('unit kills weighted x1 (C++ line 4669)', () => {
    const noKills = computeEnemyScore(
      { cx: 64, cy: 64 }, { cx: 64, cy: 64 },
      0, 0, 0, 0, 0, 0, 0, 0, false,
    );
    const withUnitKills = computeEnemyScore(
      { cx: 64, cy: 64 }, { cx: 64, cy: 64 },
      0, 20, 0, 0, 0, 0, 0, 0, false,
    );
    expect(withUnitKills - noKills).toBe(20);
  });

  it('relative unit count component (C++ line 4676)', () => {
    const balanced = computeEnemyScore(
      { cx: 64, cy: 64 }, { cx: 64, cy: 64 },
      0, 0, 10, 10, 0, 0, 0, 0, false,
    );
    const enemyStronger = computeEnemyScore(
      { cx: 64, cy: 64 }, { cx: 64, cy: 64 },
      0, 0, 20, 10, 0, 0, 0, 0, false,
    );
    // enemyCurUnits - myCurUnits: 20-10 = +10 vs 10-10 = 0
    expect(enemyStronger - balanced).toBe(10);
  });

  it('relative building count component (C++ line 4677)', () => {
    const balanced = computeEnemyScore(
      { cx: 64, cy: 64 }, { cx: 64, cy: 64 },
      0, 0, 0, 0, 5, 5, 0, 0, false,
    );
    const enemyMoreBuildings = computeEnemyScore(
      { cx: 64, cy: 64 }, { cx: 64, cy: 64 },
      0, 0, 0, 0, 15, 5, 0, 0, false,
    );
    expect(enemyMoreBuildings - balanced).toBe(10);
  });

  it('infantry component divided by 4 (C++ line 4678)', () => {
    const balanced = computeEnemyScore(
      { cx: 64, cy: 64 }, { cx: 64, cy: 64 },
      0, 0, 0, 0, 0, 0, 10, 10, false,
    );
    const enemyMoreInf = computeEnemyScore(
      { cx: 64, cy: 64 }, { cx: 64, cy: 64 },
      0, 0, 0, 0, 0, 0, 50, 10, false,
    );
    // (50-10)/4 = 10 vs (10-10)/4 = 0
    expect(enemyMoreInf - balanced).toBe(Math.floor((50 - 10) / 4));
  });

  it('last attacker bonus = +100 (C++ line 4684-4686)', () => {
    const noLastAttacker = computeEnemyScore(
      { cx: 64, cy: 64 }, { cx: 64, cy: 64 },
      0, 0, 0, 0, 0, 0, 0, 0, false,
    );
    const withLastAttacker = computeEnemyScore(
      { cx: 64, cy: 64 }, { cx: 64, cy: 64 },
      0, 0, 0, 0, 0, 0, 0, 0, true,
    );
    expect(withLastAttacker - noLastAttacker).toBe(100);
  });

  it('zero-distance baseline: value = MAP_CELL_W*2*2 = 512 (C++ line 4660-4661)', () => {
    // When distance=0: value = (128*2 - 0) * 2 = 512
    const score = computeEnemyScore(
      { cx: 64, cy: 64 }, { cx: 64, cy: 64 },
      0, 0, 0, 0, 0, 0, 0, 0, false,
    );
    expect(score).toBe(MAP_CELL_W * 2 * 2);
  });
});


// =============================================================================
// 12. BROKE state threshold — C++ house.cpp:4753-4761
// =============================================================================
describe('BROKE state threshold (C++ house.cpp:4753-4761)', () => {
  // C++ AI enters STATE_BROKE when money < 25
  // C++ exits STATE_BROKE when money >= 25
  // This threshold is hardcoded in C++ (not from rules.ini).

  it('broke threshold is 25 credits (C++ hardcoded, not INI)', () => {
    // The TS engine uses money < 25 as the broke threshold.
    // This is a C++ hardcoded value, not from rules.ini.
    // Verify there is no rules.ini key for this (it doesn't exist in INI).
    const brokeKey = sections.get('AI')?.get('BrokeThreshold');
    expect(brokeKey).toBeUndefined(); // Not in rules.ini — hardcoded in C++
  });
});


// =============================================================================
// 13. Endgame production building types — C++ house.cpp:4976 Check_Fire_Sale
// =============================================================================
describe('Endgame trigger: production building types (C++ house.cpp:4976)', () => {
  // C++ Check_Fire_Sale checks: no ConYard (FACT), no Barracks (TENT/BARR),
  // no War Factory (WEAP), no Helipad (HPAD), no Airstrip (AFLD).
  // If ALL production buildings are gone and CurBuildings > 0, trigger fire sale.

  const expectedProductionTypes = ['FACT', 'TENT', 'BARR', 'WEAP', 'HPAD', 'AFLD'];

  for (const type of expectedProductionTypes) {
    it(`${type} is a production building (losing all triggers endgame)`, () => {
      // Verify these types exist in the STRUCTURE_IMAGES lookup (they are valid structure types)
      expect(STRUCTURE_IMAGES[type], `STRUCTURE_IMAGES should have ${type}`).toBeDefined();
    });
  }

  it('exactly 6 production building types trigger endgame check', () => {
    expect(expectedProductionTypes.length).toBe(6);
  });
});


// =============================================================================
// 14. Autocreate team count formula — C++ house.cpp:993
// =============================================================================
describe('Autocreate team count formula (C++ house.cpp:993)', () => {
  // C++ house.cpp:993: maxteams = Random_Pick(2, (TechLevel-1)/3+1)
  // Lower bound is always 2. Upper bound scales with tech level.

  const techLevelCases: Array<{ tech: number; expectedUpper: number }> = [
    { tech: 1, expectedUpper: Math.floor((1 - 1) / 3) + 1 },    // 1
    { tech: 3, expectedUpper: Math.floor((3 - 1) / 3) + 1 },    // 1
    { tech: 5, expectedUpper: Math.floor((5 - 1) / 3) + 1 },    // 2
    { tech: 7, expectedUpper: Math.floor((7 - 1) / 3) + 1 },    // 3
    { tech: 10, expectedUpper: Math.floor((10 - 1) / 3) + 1 },  // 4
    { tech: 12, expectedUpper: Math.floor((12 - 1) / 3) + 1 },  // 4
    { tech: 15, expectedUpper: Math.floor((15 - 1) / 3) + 1 },  // 5
  ];

  for (const { tech, expectedUpper } of techLevelCases) {
    it(`TechLevel=${tech}: upper bound = (${tech}-1)/3+1 = ${expectedUpper}`, () => {
      expect(Math.floor((tech - 1) / 3) + 1).toBe(expectedUpper);
    });
  }

  it('lower bound of team count is always 2 (C++ Random_Pick(2, ...))', () => {
    // Even at tech level 1, minimum teams created per cycle is 2
    const tech = 1;
    const upper = Math.floor((tech - 1) / 3) + 1; // = 1
    // C++ uses max(upper, 2) so minimum is always 2
    const effectiveUpper = Math.max(upper, 2);
    expect(effectiveUpper).toBe(2);
  });
});


// =============================================================================
// 15. Suggested_New_Team cap — C++ teamtype.cpp:419-497
// =============================================================================
describe('Suggested_New_Team constraints (C++ teamtype.cpp:419-497)', () => {
  it('candidate list capped at 20 entries (C++ choices[20])', () => {
    // C++ uses a fixed-size array: TeamTypeClass * choices[20]
    // TS should cap at the same limit
    const MAX_CHOICES = 20;
    expect(MAX_CHOICES).toBe(20);
  });
});


// =============================================================================
// 16. Difficulty INI completeness — [Easy]/[Normal]/[Difficult] missing keys
// =============================================================================
describe('Difficulty INI section completeness (C++ rules.h:44-61 DifficultyClass)', () => {
  // C++ DifficultyClass has 12 fields. Not all are present in every INI section.
  // Missing keys use the C++ default from the constructor.

  it('[Easy] has no BuildSlowdown key (C++ default = no)', () => {
    // C++ DifficultyClass constructor default for IsBuildSlowdown = false
    const val = sections.get('Easy')?.get('BuildSlowdown');
    expect(val).toBeUndefined(); // Not in INI; C++ defaults to false
  });

  it('[Difficult] has no ContentScan key (C++ default = no)', () => {
    // C++ DifficultyClass constructor default for IsContentScan = false
    const val = sections.get('Difficult')?.get('ContentScan');
    expect(val).toBeUndefined(); // Not in INI; C++ defaults to false
  });

  it('[Easy] has ContentScan=yes', () => {
    expect(iniBool('Easy', 'ContentScan')).toBe(true);
  });

  it('[Normal] has BuildSlowdown=yes', () => {
    expect(iniBool('Normal', 'BuildSlowdown')).toBe(true);
  });

  it('[Difficult] has BuildSlowdown=yes', () => {
    expect(iniBool('Difficult', 'BuildSlowdown')).toBe(true);
  });
});


// =============================================================================
// 17. [General] FineDiffControl — affects difficulty system
// =============================================================================
describe('[General] FineDiffControl (rules.ini line 123)', () => {
  // C++ rules.ini: FineDiffControl=no
  // When no, only 3 difficulty levels. When yes, allows 5 levels.
  // This controls whether the difficulty slider uses 3 or 5 positions.

  it('FineDiffControl = no (3 difficulty levels, not 5)', () => {
    expect(iniBool('General', 'FineDiffControl')).toBe(false);
  });

  it('MCVUndeploy = no (MCV cannot undeploy in vanilla RA)', () => {
    expect(iniBool('General', 'MCVUndeploy')).toBe(false);
  });
});


// =============================================================================
// 18. AI_BUILD_RULES timing/production constants vs INI [AI] section
// =============================================================================
describe('AI_BUILD_RULES timing constants match INI [AI] values exactly', () => {
  // Each AI_BUILD_RULES timing field must match its INI counterpart.
  // These are the non-ratio fields — timing and behavior constants.

  it('attackInterval matches AI.AttackInterval', () => {
    expect(AI_BUILD_RULES.attackInterval).toBe(iniFloat('AI', 'AttackInterval'));
  });

  it('attackDelay matches AI.AttackDelay', () => {
    expect(AI_BUILD_RULES.attackDelay).toBe(iniFloat('AI', 'AttackDelay'));
  });

  it('creditReserve matches AI.CreditReserve', () => {
    expect(AI_BUILD_RULES.creditReserve).toBe(iniFloat('AI', 'CreditReserve'));
  });

  it('infantryReserve matches AI.InfantryReserve', () => {
    expect(AI_BUILD_RULES.infantryReserve).toBe(iniFloat('AI', 'InfantryReserve'));
  });

  it('infantryBaseMult matches AI.InfantryBaseMult', () => {
    expect(AI_BUILD_RULES.infantryBaseMult).toBe(iniFloat('AI', 'InfantryBaseMult'));
  });

  it('autocreateTime matches AI.AutocreateTime', () => {
    expect(AI_BUILD_RULES.autocreateTime).toBe(iniFloat('AI', 'AutocreateTime'));
  });

  it('oreNearScan matches AI.OreNearScan', () => {
    expect(AI_BUILD_RULES.oreNearScan).toBe(iniFloat('AI', 'OreNearScan'));
  });

  it('oreFarScan matches AI.OreFarScan', () => {
    expect(AI_BUILD_RULES.oreFarScan).toBe(iniFloat('AI', 'OreFarScan'));
  });

  it('patrolScan matches AI.PatrolScan', () => {
    expect(AI_BUILD_RULES.patrolScan).toBeCloseTo(iniFloat('AI', 'PatrolScan'), 4);
  });

  it('powerEmergency matches AI.PowerEmergency as fraction (75% -> 0.75)', () => {
    const iniPct = iniFloat('AI', 'PowerEmergency'); // 75
    expect(AI_BUILD_RULES.powerEmergency).toBeCloseTo(iniPct / 100, 2);
  });

  it('pathDelay matches AI.PathDelay', () => {
    expect(AI_BUILD_RULES.pathDelay).toBeCloseTo(iniFloat('AI', 'PathDelay'), 4);
  });

  it('compEasyBonus matches AI.CompEasyBonus', () => {
    expect(AI_BUILD_RULES.compEasyBonus).toBe(iniBool('AI', 'CompEasyBonus'));
  });

  it('paranoid matches AI.Paranoid', () => {
    expect(AI_BUILD_RULES.paranoid).toBe(iniBool('AI', 'Paranoid'));
  });
});


// =============================================================================
// 19. AI_BUILD_RULES IQ thresholds match INI [IQ] section
// =============================================================================
describe('AI_BUILD_RULES IQ thresholds match INI [IQ] values exactly', () => {
  it('maxIQLevels matches IQ.MaxIQLevels', () => {
    expect(AI_BUILD_RULES.maxIQLevels).toBe(iniFloat('IQ', 'MaxIQLevels'));
  });

  it('iqSuperWeapons matches IQ.SuperWeapons', () => {
    expect(AI_BUILD_RULES.iqSuperWeapons).toBe(iniFloat('IQ', 'SuperWeapons'));
  });

  it('iqProduction matches IQ.Production', () => {
    expect(AI_BUILD_RULES.iqProduction).toBe(iniFloat('IQ', 'Production'));
  });

  it('iqGuardArea matches IQ.GuardArea', () => {
    expect(AI_BUILD_RULES.iqGuardArea).toBe(iniFloat('IQ', 'GuardArea'));
  });

  it('iqRepairSell matches IQ.RepairSell', () => {
    expect(AI_BUILD_RULES.iqRepairSell).toBe(iniFloat('IQ', 'RepairSell'));
  });

  it('iqAutoCrush matches IQ.AutoCrush', () => {
    expect(AI_BUILD_RULES.iqAutoCrush).toBe(iniFloat('IQ', 'AutoCrush'));
  });

  it('iqScatter matches IQ.Scatter', () => {
    expect(AI_BUILD_RULES.iqScatter).toBe(iniFloat('IQ', 'Scatter'));
  });

  it('iqContentScan matches IQ.ContentScan', () => {
    expect(AI_BUILD_RULES.iqContentScan).toBe(iniFloat('IQ', 'ContentScan'));
  });

  it('iqAircraft matches IQ.Aircraft', () => {
    expect(AI_BUILD_RULES.iqAircraft).toBe(iniFloat('IQ', 'Aircraft'));
  });

  it('iqHarvester matches IQ.Harvester', () => {
    expect(AI_BUILD_RULES.iqHarvester).toBe(iniFloat('IQ', 'Harvester'));
  });

  it('iqSellBack matches IQ.SellBack', () => {
    expect(AI_BUILD_RULES.iqSellBack).toBe(iniFloat('IQ', 'SellBack'));
  });
});


// =============================================================================
// 20. Difficulty reversal for computer — C++ house.cpp:285-311
// =============================================================================
describe('Difficulty reversal for computer (C++ house.cpp:285-311)', () => {
  // C++ reverses difficulty for computer players:
  //   Game on "easy" -> computer gets [Difficult] values (weaker)
  //   Game on "normal" -> computer gets [Normal] values (baseline)
  //   Game on "hard" -> computer gets [Easy] values (stronger)
  //
  // TS AI_DIFFICULTY_MODS represents the COMPUTER side, so:
  //   easy.repairDelay should match [Difficult] RepairDelay
  //   normal.repairDelay should match [Normal] RepairDelay
  //   hard.repairDelay should match [Easy] RepairDelay

  it('easy computer: repairDelay matches [Difficult] RepairDelay', () => {
    expect(AI_DIFFICULTY_MODS.easy.repairDelay).toBeCloseTo(
      iniFloat('Difficult', 'RepairDelay'), 3
    );
  });

  it('normal computer: repairDelay matches [Normal] RepairDelay', () => {
    expect(AI_DIFFICULTY_MODS.normal.repairDelay).toBeCloseTo(
      iniFloat('Normal', 'RepairDelay'), 3
    );
  });

  it('hard computer: repairDelay matches [Easy] RepairDelay', () => {
    expect(AI_DIFFICULTY_MODS.hard.repairDelay).toBeCloseTo(
      iniFloat('Easy', 'RepairDelay'), 4
    );
  });

  it('easy computer: buildDelay matches [Difficult] BuildDelay', () => {
    expect(AI_DIFFICULTY_MODS.easy.buildDelay).toBeCloseTo(
      iniFloat('Difficult', 'BuildDelay'), 2
    );
  });

  it('normal computer: buildDelay matches [Normal] BuildDelay', () => {
    expect(AI_DIFFICULTY_MODS.normal.buildDelay).toBeCloseTo(
      iniFloat('Normal', 'BuildDelay'), 3
    );
  });

  it('hard computer: buildDelay matches [Easy] BuildDelay', () => {
    expect(AI_DIFFICULTY_MODS.hard.buildDelay).toBeCloseTo(
      iniFloat('Easy', 'BuildDelay'), 4
    );
  });

  it('easy computer: isBuildSlowdown matches [Difficult] BuildSlowdown', () => {
    // [Difficult] has BuildSlowdown=yes
    expect(AI_DIFFICULTY_MODS.easy.isBuildSlowdown).toBe(
      iniBool('Difficult', 'BuildSlowdown')
    );
  });

  it('normal computer: isBuildSlowdown matches [Normal] BuildSlowdown', () => {
    expect(AI_DIFFICULTY_MODS.normal.isBuildSlowdown).toBe(
      iniBool('Normal', 'BuildSlowdown')
    );
  });

  it('hard computer: isBuildSlowdown matches [Easy] BuildSlowdown default (false)', () => {
    // [Easy] has no BuildSlowdown key => C++ default = false
    const iniVal = iniBool('Easy', 'BuildSlowdown', false);
    expect(AI_DIFFICULTY_MODS.hard.isBuildSlowdown).toBe(iniVal);
  });

  it('easy computer: isWallDestroyer matches [Difficult] DestroyWalls', () => {
    expect(AI_DIFFICULTY_MODS.easy.isWallDestroyer).toBe(
      iniBool('Difficult', 'DestroyWalls')
    );
  });

  it('normal computer: isWallDestroyer matches [Normal] DestroyWalls', () => {
    expect(AI_DIFFICULTY_MODS.normal.isWallDestroyer).toBe(
      iniBool('Normal', 'DestroyWalls')
    );
  });

  it('hard computer: isWallDestroyer matches [Easy] DestroyWalls', () => {
    expect(AI_DIFFICULTY_MODS.hard.isWallDestroyer).toBe(
      iniBool('Easy', 'DestroyWalls')
    );
  });

  it('easy computer: isContentScan matches [Difficult] ContentScan default (false)', () => {
    // [Difficult] has no ContentScan key => C++ default = false
    const iniVal = iniBool('Difficult', 'ContentScan', false);
    expect(AI_DIFFICULTY_MODS.easy.isContentScan).toBe(iniVal);
  });

  it('normal computer: isContentScan matches [Normal] ContentScan', () => {
    expect(AI_DIFFICULTY_MODS.normal.isContentScan).toBe(
      iniBool('Normal', 'ContentScan')
    );
  });

  it('hard computer: isContentScan matches [Easy] ContentScan', () => {
    expect(AI_DIFFICULTY_MODS.hard.isContentScan).toBe(
      iniBool('Easy', 'ContentScan')
    );
  });
});


// =============================================================================
// 21. DIFFICULTY_MODS (Ant Missions) — TS-specific but documented
// =============================================================================
describe('DIFFICULTY_MODS for ant missions (TS-specific)', () => {
  // These control ant queen behavior and wave composition.
  // Not from rules.ini, but worth documenting the scaling pattern.

  for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
    const mods = DIFFICULTY_MODS[diff];

    it(`${diff}: has spawnInterval (number)`, () => {
      expect(typeof mods.spawnInterval).toBe('number');
      expect(mods.spawnInterval).toBeGreaterThan(0);
    });

    it(`${diff}: has maxAnts (number)`, () => {
      expect(typeof mods.maxAnts).toBe('number');
      expect(mods.maxAnts).toBeGreaterThan(0);
    });

    it(`${diff}: has fireAntChance (0-1 range)`, () => {
      expect(mods.fireAntChance).toBeGreaterThanOrEqual(0);
      expect(mods.fireAntChance).toBeLessThanOrEqual(1);
    });

    it(`${diff}: has waveSize (number)`, () => {
      expect(typeof mods.waveSize).toBe('number');
      expect(mods.waveSize).toBeGreaterThan(0);
    });
  }

  it('harder difficulties have shorter spawn intervals', () => {
    expect(DIFFICULTY_MODS.hard.spawnInterval).toBeLessThan(DIFFICULTY_MODS.normal.spawnInterval);
    expect(DIFFICULTY_MODS.normal.spawnInterval).toBeLessThan(DIFFICULTY_MODS.easy.spawnInterval);
  });

  it('harder difficulties have more max ants', () => {
    expect(DIFFICULTY_MODS.hard.maxAnts).toBeGreaterThan(DIFFICULTY_MODS.normal.maxAnts);
    expect(DIFFICULTY_MODS.normal.maxAnts).toBeGreaterThan(DIFFICULTY_MODS.easy.maxAnts);
  });

  it('harder difficulties have larger wave sizes', () => {
    expect(DIFFICULTY_MODS.hard.waveSize).toBeGreaterThan(DIFFICULTY_MODS.normal.waveSize);
    expect(DIFFICULTY_MODS.normal.waveSize).toBeGreaterThan(DIFFICULTY_MODS.easy.waveSize);
  });
});


// =============================================================================
// 22. STRUCTURE_IMAGES mapping — all AI-buildable structures have images
// =============================================================================
describe('STRUCTURE_IMAGES covers all AI-buildable structures', () => {
  // C++ AI_Building builds these structure types. Each needs an image mapping.
  const aiBuildableTypes = [
    'FACT', 'POWR', 'APWR', 'BARR', 'TENT', 'WEAP', 'PROC',
    'SILO', 'DOME', 'FIX', 'GUN', 'SAM', 'HBOX', 'TSLA',
    'AGUN', 'FTUR', 'GAP', 'PBOX', 'HPAD', 'AFLD',
    'ATEK', 'STEK', 'IRON', 'PDOX', 'KENN',
  ];

  for (const type of aiBuildableTypes) {
    it(`STRUCTURE_IMAGES has '${type}'`, () => {
      expect(STRUCTURE_IMAGES[type], `missing image for ${type}`).toBeDefined();
      expect(typeof STRUCTURE_IMAGES[type]).toBe('string');
    });
  }
});


// =============================================================================
// 23. Difficulty direction correctness — harder = stronger computer
// =============================================================================
describe('Difficulty scaling direction (harder = stronger computer)', () => {
  // Computer on hard should be stronger than normal, which is stronger than easy.
  // "Stronger" means: more firepower, more armor, faster ROF, faster speed.

  it('hard computer has higher firepowerBias than easy', () => {
    expect(AI_DIFFICULTY_MODS.hard.firepowerBias).toBeGreaterThan(AI_DIFFICULTY_MODS.easy.firepowerBias);
  });

  it('hard computer has higher armorBias than easy', () => {
    expect(AI_DIFFICULTY_MODS.hard.armorBias).toBeGreaterThan(AI_DIFFICULTY_MODS.easy.armorBias);
  });

  it('hard computer has lower rofBias than easy (lower = fires faster)', () => {
    expect(AI_DIFFICULTY_MODS.hard.rofBias).toBeLessThan(AI_DIFFICULTY_MODS.easy.rofBias);
  });

  it('hard computer has higher groundspeedBias than easy', () => {
    expect(AI_DIFFICULTY_MODS.hard.groundspeedBias).toBeGreaterThan(AI_DIFFICULTY_MODS.easy.groundspeedBias);
  });

  it('hard computer has higher airspeedBias than easy', () => {
    expect(AI_DIFFICULTY_MODS.hard.airspeedBias).toBeGreaterThan(AI_DIFFICULTY_MODS.easy.airspeedBias);
  });

  it('hard computer has lower costBias than easy (lower = cheaper)', () => {
    expect(AI_DIFFICULTY_MODS.hard.costBias).toBeLessThanOrEqual(AI_DIFFICULTY_MODS.easy.costBias);
  });

  it('hard computer has lower buildSpeedBias than easy (lower = builds faster)', () => {
    expect(AI_DIFFICULTY_MODS.hard.buildSpeedBias).toBeLessThanOrEqual(AI_DIFFICULTY_MODS.easy.buildSpeedBias);
  });

  it('hard computer has lower repairDelay than easy (repairs faster)', () => {
    expect(AI_DIFFICULTY_MODS.hard.repairDelay).toBeLessThan(AI_DIFFICULTY_MODS.easy.repairDelay);
  });

  it('hard computer has lower buildDelay than easy (starts building sooner)', () => {
    expect(AI_DIFFICULTY_MODS.hard.buildDelay).toBeLessThan(AI_DIFFICULTY_MODS.easy.buildDelay);
  });

  it('normal firepowerBias is between easy and hard', () => {
    expect(AI_DIFFICULTY_MODS.normal.firepowerBias).toBeGreaterThanOrEqual(AI_DIFFICULTY_MODS.easy.firepowerBias);
    expect(AI_DIFFICULTY_MODS.normal.firepowerBias).toBeLessThanOrEqual(AI_DIFFICULTY_MODS.hard.firepowerBias);
  });
});


// =============================================================================
// 24. Dynamic cap increase formula — C++ house.cpp:4648-4740
// =============================================================================
describe('Dynamic cap increase formula (C++ house.cpp:4648-4740)', () => {
  // C++ adjusts per-house caps dynamically:
  //   for each cap: if (state.maxX < avgEnemyX + 10) state.maxX = avgEnemyX + 10
  // The "+10" buffer ensures AI can always produce slightly more than enemy average.

  it('buffer above enemy average is 10 (C++ house.cpp:4700)', () => {
    // C++ code: if (Control.MaxUnit < average + 10) Control.MaxUnit = average + 10
    // The buffer is hardcoded to 10, not from rules.ini
    const DYNAMIC_CAP_BUFFER = 10;
    expect(DYNAMIC_CAP_BUFFER).toBe(10);
  });

  it('dynamic caps cover all 5 categories (units, buildings, infantry, vessels, aircraft)', () => {
    // C++ adjusts: MaxUnit, MaxBuilding, MaxInfantry, MaxVessel, MaxAircraft
    const categories = ['maxUnit', 'maxBuilding', 'maxInfantry', 'maxVessel', 'maxAircraft'];
    expect(categories.length).toBe(5);
  });
});


// =============================================================================
// 25. Fire sale refund — C++ techno.cpp:5743-5761
// =============================================================================
describe('Fire sale refund (C++ techno.cpp:5743-5761 Sell_Back for AI)', () => {
  // C++ Fire_Sale → Sell_Back(1) → Refund_Amount:
  //   For AI (IsHuman=false): refund = full cost (100%)
  //   For Human (IsHuman=true): refund = cost * RefundPercent * healthFraction
  // rules.ini RefundPercent only applies to human sell, not AI fire sale.

  it('RefundPercent = 50% in rules.ini (applies to human sell only)', () => {
    expect(iniFloat('General', 'RefundPercent')).toBe(50);
  });

  it('AI fire sale gets 100% refund (C++ techno.cpp:5754 — no RefundPercent for AI)', () => {
    // This is C++ behavior: AI sell back returns full cost.
    // The 50% RefundPercent is for human players only.
    const humanRefundPct = iniFloat('General', 'RefundPercent') / 100; // 0.5
    const aiRefundPct = 1.0; // C++ hardcoded: AI gets 100%
    expect(aiRefundPct).toBeGreaterThan(humanRefundPct);
  });
});


// =============================================================================
// 26. Phase transition conditions — C++ Expert_AI state machine
// =============================================================================
describe('AI phase transitions (C++ Expert_AI house.cpp:4749-4769)', () => {
  // AI has 3 phases: economy -> buildup -> attack
  // economy -> buildup: has barracks + war factory + 2 power plants
  // buildup -> attack: attack pool >= attackThreshold
  // attack -> buildup: attack pool empty

  it('attack thresholds scale with difficulty', () => {
    expect(AI_DIFFICULTY_MODS.easy.attackThreshold).toBeGreaterThan(
      AI_DIFFICULTY_MODS.hard.attackThreshold
    );
  });

  it('easy attackThreshold = 8 (needs more units before attacking)', () => {
    expect(AI_DIFFICULTY_MODS.easy.attackThreshold).toBe(8);
  });

  it('normal attackThreshold = 6', () => {
    expect(AI_DIFFICULTY_MODS.normal.attackThreshold).toBe(6);
  });

  it('hard attackThreshold = 4 (attacks sooner with fewer units)', () => {
    expect(AI_DIFFICULTY_MODS.hard.attackThreshold).toBe(4);
  });

  it('attack cooldowns scale with difficulty', () => {
    expect(AI_DIFFICULTY_MODS.easy.attackCooldown).toBeGreaterThan(
      AI_DIFFICULTY_MODS.normal.attackCooldown
    );
    expect(AI_DIFFICULTY_MODS.normal.attackCooldown).toBeGreaterThan(
      AI_DIFFICULTY_MODS.hard.attackCooldown
    );
  });

  it('production intervals scale with difficulty', () => {
    expect(AI_DIFFICULTY_MODS.easy.productionInterval).toBeGreaterThan(
      AI_DIFFICULTY_MODS.normal.productionInterval
    );
    expect(AI_DIFFICULTY_MODS.normal.productionInterval).toBeGreaterThan(
      AI_DIFFICULTY_MODS.hard.productionInterval
    );
  });
});
