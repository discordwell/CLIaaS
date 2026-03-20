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
  });

  it('Paranoid = yes (computer players ally vs humans)', () => {
    const iniVal = iniBool('AI', 'Paranoid', false);
    expect(iniVal).toBe(true);
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
    ];
    for (const field of expectedFields) {
      expect(
        (AI_BUILD_RULES as Record<string, unknown>)[field],
        `AI_BUILD_RULES.${field} should be defined`
      ).toBeDefined();
    }
  });

  it('PARITY GAP: TS should have AttackInterval (C++ Rule.AttackInterval = 3 min)', () => {
    // C++ uses AttackInterval for average delay between attacks.
    // TS has attackCooldown per difficulty, but not a single Rule.AttackInterval constant.
    expect(
      (AI_BUILD_RULES as Record<string, unknown>)['attackInterval'],
      'TS AI_BUILD_RULES missing attackInterval — C++ has Rule.AttackInterval=3'
    ).toBe(3);
  });

  it('PARITY GAP: TS should have AttackDelay (C++ Rule.AttackDelay = 5 min)', () => {
    expect(
      (AI_BUILD_RULES as Record<string, unknown>)['attackDelay'],
      'TS AI_BUILD_RULES missing attackDelay — C++ has Rule.AttackDelay=5'
    ).toBe(5);
  });

  it('PARITY GAP: TS should have CreditReserve (C++ Rule.CreditReserve = 100)', () => {
    expect(
      (AI_BUILD_RULES as Record<string, unknown>)['creditReserve'],
      'TS AI_BUILD_RULES missing creditReserve — C++ has Rule.CreditReserve=100'
    ).toBe(100);
  });

  it('PARITY GAP: TS should have InfantryReserve (C++ Rule.InfantryReserve = 3000)', () => {
    expect(
      (AI_BUILD_RULES as Record<string, unknown>)['infantryReserve'],
      'TS AI_BUILD_RULES missing infantryReserve — C++ has Rule.InfantryReserve=3000'
    ).toBe(3000);
  });

  it('PARITY GAP: TS should have InfantryBaseMult (C++ Rule.InfantryBaseMult = 1)', () => {
    expect(
      (AI_BUILD_RULES as Record<string, unknown>)['infantryBaseMult'],
      'TS AI_BUILD_RULES missing infantryBaseMult — C++ has Rule.InfantryBaseMult=1'
    ).toBe(1);
  });

  it('PARITY GAP: TS should have AutocreateTime (C++ Rule.AutocreateTime = 5 min)', () => {
    expect(
      (AI_BUILD_RULES as Record<string, unknown>)['autocreateTime'],
      'TS AI_BUILD_RULES missing autocreateTime — C++ has Rule.AutocreateTime=5'
    ).toBe(5);
  });

  it('PARITY GAP: TS should have OreNearScan (C++ Rule.OreNearScan = 6 cells)', () => {
    expect(
      (AI_BUILD_RULES as Record<string, unknown>)['oreNearScan'],
      'TS AI_BUILD_RULES missing oreNearScan — C++ has Rule.OreNearScan=6'
    ).toBe(6);
  });

  it('PARITY GAP: TS should have OreFarScan (C++ Rule.OreFarScan = 48 cells)', () => {
    expect(
      (AI_BUILD_RULES as Record<string, unknown>)['oreFarScan'],
      'TS AI_BUILD_RULES missing oreFarScan — C++ has Rule.OreFarScan=48'
    ).toBe(48);
  });

  it('PARITY GAP: TS should have PatrolScan (C++ Rule.PatrolScan = 0.016 min)', () => {
    expect(
      (AI_BUILD_RULES as Record<string, unknown>)['patrolScan'],
      'TS AI_BUILD_RULES missing patrolScan — C++ has Rule.PatrolScan=.016'
    ).toBeCloseTo(0.016, 3);
  });

  it('PARITY GAP: TS should have PowerEmergency (C++ Rule.PowerEmergencyFraction = 75%)', () => {
    expect(
      (AI_BUILD_RULES as Record<string, unknown>)['powerEmergency'],
      'TS AI_BUILD_RULES missing powerEmergency — C++ has Rule.PowerEmergency=75%'
    ).toBe(0.75);
  });
});


// =============================================================================
// 2. [IQ] Section Constants — rules.ini lines 269-280
// =============================================================================
describe('[IQ] section constants (rules.ini lines 269-280)', () => {
  it('MaxIQLevels = 5', () => {
    expect(iniFloat('IQ', 'MaxIQLevels')).toBe(5);
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

  it('PARITY GAP: TS AI engine should expose IQ thresholds as constants', () => {
    // C++ uses Rule.IQSuperWeapons, Rule.IQProduction, etc. to gate AI abilities.
    // TS AIHouseState has an `iq` field but the threshold constants are not exported.
    // Verify AI_BUILD_RULES or a separate IQ_THRESHOLDS object has these.
    const expectedIQFields: Record<string, number> = {
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

  describe('PARITY GAP: TS difficulty should include BuildDelay and RepairDelay', () => {
    // C++ DifficultyClass has RepairDelay and BuildDelay (minutes).
    // These control how quickly AI initiates repairs and construction.
    // TS AI_DIFFICULTY_MODS may not have these fields.

    for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
      it(`${diff} should have repairDelay`, () => {
        expect(
          (AI_DIFFICULTY_MODS[diff] as Record<string, unknown>)['repairDelay'],
          `${diff} missing repairDelay — C++ DifficultyClass has RepairDelay`
        ).toBeDefined();
      });

      it(`${diff} should have buildDelay`, () => {
        expect(
          (AI_DIFFICULTY_MODS[diff] as Record<string, unknown>)['buildDelay'],
          `${diff} missing buildDelay — C++ DifficultyClass has BuildDelay`
        ).toBeDefined();
      });
    }
  });

  describe('PARITY GAP: TS difficulty should include BuildSlowdown and DestroyWalls', () => {
    for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
      it(`${diff} should have isBuildSlowdown`, () => {
        expect(
          (AI_DIFFICULTY_MODS[diff] as Record<string, unknown>)['isBuildSlowdown'],
          `${diff} missing isBuildSlowdown — C++ DifficultyClass has IsBuildSlowdown`
        ).toBeDefined();
      });

      it(`${diff} should have isWallDestroyer`, () => {
        expect(
          (AI_DIFFICULTY_MODS[diff] as Record<string, unknown>)['isWallDestroyer'],
          `${diff} missing isWallDestroyer — C++ DifficultyClass has IsWallDestroyer`
        ).toBeDefined();
      });

      it(`${diff} should have isContentScan`, () => {
        expect(
          (AI_DIFFICULTY_MODS[diff] as Record<string, unknown>)['isContentScan'],
          `${diff} missing isContentScan — C++ DifficultyClass has IsContentScan`
        ).toBeDefined();
      });
    }
  });

  describe('PARITY GAP: TS difficulty BuildTime bias (C++ BuildSpeedBias) should differ per level', () => {
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

  // -- Parity gap: missing fields in TS CountryBonus --

  describe('PARITY GAP: TS CountryBonus should include Airspeed and BuildTime', () => {
    for (const { name, iniSection } of countries) {
      it(`${name}: TS should have airspeedMult matching INI Airspeed`, () => {
        const iniVal = iniFloat(iniSection, 'Airspeed', 1.0);
        expect(
          (COUNTRY_BONUSES[name] as Record<string, unknown>)['airspeedMult'],
          `COUNTRY_BONUSES.${name} missing airspeedMult — INI Airspeed=${iniVal}`
        ).toBeCloseTo(iniVal, 2);
      });

      it(`${name}: TS should have buildTimeMult matching INI BuildTime`, () => {
        const iniVal = iniFloat(iniSection, 'BuildTime', 1.0);
        expect(
          (COUNTRY_BONUSES[name] as Record<string, unknown>)['buildTimeMult'],
          `COUNTRY_BONUSES.${name} missing buildTimeMult — INI BuildTime=${iniVal}`
        ).toBeCloseTo(iniVal, 2);
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
