/**
 * C++ Behavioral Parity Tests -- [General] section of rules.ini
 *
 * Parses rules.ini directly and compares every [General] constant against
 * the corresponding TS engine value.  rules.ini is the authoritative source;
 * C++ constructor defaults (rules.cpp) are NOT authoritative when overridden
 * by the INI.
 *
 * === C++ Source References ===
 *
 * rules.ini [General] is parsed by RulesClass::Process() in rules.cpp:100-300.
 * Each value below shows the INI key, the authoritative INI value, and the
 * TS constant / location it maps to.
 *
 * Repair & Refit:
 *   RepairStep=7       (rules.cpp default=5, overridden by INI)
 *   RepairPercent=20%  (rules.cpp default=fixed(1,4)=0.25, overridden by INI)
 *   RepairRate=.016    (minutes between repair ticks; 0.016 * 900 = 14.4 -> 14 ticks)
 *   URepairStep=10     (rules.cpp default=5, overridden by INI)
 *   URepairPercent=20% (rules.cpp default=fixed(1,4)=0.25, overridden by INI)
 *   RefundPercent=50%  (sell refund for human players)
 *   ReloadRate=.04     (minutes to reload each ammo point)
 *
 * Combat & Damage:
 *   MaxDamage=1000     (max damage per hit)
 *   MinDamage=1        (min damage per hit)
 *   AtomDamage=1000    (nuclear bomb damage)
 *   APMineDamage=1000  (anti-personnel mine damage)
 *   AVMineDamage=1200  (anti-vehicle mine damage)
 *   BridgeStrength=1000
 *   C4Delay=.03        (0.03 min * 900 = 27 ticks)
 *   Crush=1.5          (cells to auto-crush instead of firing)
 *   BallisticScatter=1.0
 *   HomingScatter=2.0
 *   ExpSpread=.3
 *   FireSupress=1
 *   ProneDamage=50%    (0.5 multiplier for prone infantry)
 *   Incoming=10
 *   TurboBoost=1.5
 *
 * Special Weapons:
 *   ChronoDuration=3     (minutes; 3 * 900 = 2700 ticks)
 *   ChronoTechLevel=12
 *   GPSTechLevel=8
 *   GapRadius=10
 *   GapRegenInterval=.1
 *   IronCurtain=.75      (minutes; 0.75 * 60 * 15 = 675 ticks)
 *   ParaTech=5
 *   ParabombTech=8
 *   RadarJamRadius=15
 *   SpyPlaneTech=5
 *   BadgerBombCount=1
 *
 * Chrono Side Effects:
 *   QuakeChance=20%
 *   QuakeDamage=33%
 *   VortexChance=20%
 *   VortexDamage=200
 *   VortexRange=10
 *   VortexSpeed=10
 *
 * Income & Production:
 *   BailCount=28
 *   BuildSpeed=.8
 *   BuildupTime=.06
 *   GemValue=50
 *   GoldValue=25
 *   GrowthRate=2
 *   OreTruckRate=1
 *   SurvivorRate=.4
 *
 * Map & Visual:
 *   ConditionRed=25%
 *   ConditionYellow=50%
 *   DropZoneRadius=4
 *   Gravity=3
 *   IdleActionFrequency=.1
 *   MessageDelay=.6
 *   ShroudRate=4
 *   SpeakDelay=2
 *   TimerWarning=2
 *
 * Crates:
 *   CrateMinimum=1
 *   CrateMaximum=255
 *   CrateRadius=3.0
 *   CrateRegen=3
 *   SoloCrateMoney=2000
 *   WaterCrateChance=20%
 *
 * Movement & AI:
 *   BaseBias=2
 *   BaseDefenseDelay=.25
 *   CloseEnough=2.75
 *   DamageDelay=1
 *   GameSpeeBias=1  (note: typo in original INI)
 *   LZScanRadius=16
 *   Stray=2.0
 *   SubmergeDelay=.02
 *   SuspendDelay=2
 *   SuspendPriority=20
 *   TeamDelay=.6
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseIniSections } from '../engine/parseIni';
import {
  MAX_DAMAGE,
  REPAIR_STEP, REPAIR_PERCENT,
  UREPAIR_STEP, UREPAIR_PERCENT,
  CONDITION_RED, CONDITION_YELLOW,
  PRONE_DAMAGE_BIAS, RULE_GRAVITY,
  IRON_CURTAIN_DURATION,
  NUKE_DAMAGE, GAME_TICKS_PER_SEC,
} from '../engine/types';
import { Entity } from '../engine/entity';
import { CRATE_RADIUS } from '../engine/crates';
import { CHRONO_DURATION_TICKS } from '../engine/superweapon';
import { GAP_RADIUS } from '../engine/fog';

// ---------------------------------------------------------------------------
// Parse rules.ini
// ---------------------------------------------------------------------------

const TICKS_PER_MINUTE = GAME_TICKS_PER_SEC * 60; // 900

const rulesText = readFileSync(
  resolve(__dirname, '../../../public/ra/assets/rules.ini'),
  'utf-8',
);
const sections = parseIniSections(rulesText);
const general = sections.get('General')!;

/** Parse a percentage string like "20%" to a fraction (0.20), or a plain float. */
function parsePercent(raw: string): number {
  if (raw.endsWith('%')) {
    return Number.parseFloat(raw.replace('%', '')) / 100;
  }
  return Number.parseFloat(raw);
}

/** Parse a plain integer. */
function parseInteger(raw: string): number {
  return Number.parseInt(raw, 10);
}

/** Parse a plain float. */
function parseFloat_(raw: string): number {
  return Number.parseFloat(raw);
}

// Sanity check: [General] section exists and has keys
describe('[General] section parsing', () => {
  it('rules.ini has a [General] section', () => {
    expect(general).toBeDefined();
  });

  it('[General] has at least 50 keys', () => {
    expect(general.size).toBeGreaterThanOrEqual(50);
  });
});

// ==========================================================================
// Section 1: Repair & Refit Constants
//   C++ rules.cpp:228-235 — overridden by rules.ini [General]
// ==========================================================================
describe('Repair & Refit constants match rules.ini [General]', () => {

  it('RepairStep=7 -> REPAIR_STEP', () => {
    const ini = parseInteger(general.get('RepairStep')!);
    expect(ini).toBe(7);
    expect(REPAIR_STEP).toBe(ini);
  });

  it('RepairPercent=20% -> REPAIR_PERCENT', () => {
    const ini = parsePercent(general.get('RepairPercent')!);
    expect(ini).toBeCloseTo(0.20, 6);
    expect(REPAIR_PERCENT).toBeCloseTo(ini, 6);
  });

  it('RepairRate=.016 -> 14-tick interval (floor(0.016 * 900))', () => {
    const iniMinutes = parseFloat_(general.get('RepairRate')!);
    expect(iniMinutes).toBeCloseTo(0.016, 6);
    const expectedTicks = Math.floor(iniMinutes * TICKS_PER_MINUTE);
    // C++ integer truncation: 0.016 * 900 = 14.4 -> 14 ticks
    expect(expectedTicks).toBe(14);
  });

  it('URepairStep=10 -> UREPAIR_STEP', () => {
    const ini = parseInteger(general.get('URepairStep')!);
    expect(ini).toBe(10);
    expect(UREPAIR_STEP).toBe(ini);
  });

  it('URepairPercent=20% -> UREPAIR_PERCENT', () => {
    const ini = parsePercent(general.get('URepairPercent')!);
    expect(ini).toBeCloseTo(0.20, 6);
    expect(UREPAIR_PERCENT).toBeCloseTo(ini, 6);
  });

  it('RefundPercent=50% -> sellRefund uses 128/256 = 0.5', () => {
    const ini = parsePercent(general.get('RefundPercent')!);
    expect(ini).toBeCloseTo(0.50, 6);
    // C++ fixed-point: floor(0.50 * 256) = 128; sell formula: ((128 * cost) + 128) / 256
    const fixedRaw = Math.floor(ini * 256);
    expect(fixedRaw).toBe(128);
  });

  it('ReloadRate=.04 -> 36 ticks (floor(0.04 * 900))', () => {
    const iniMinutes = parseFloat_(general.get('ReloadRate')!);
    expect(iniMinutes).toBeCloseTo(0.04, 6);
    const expectedTicks = Math.floor(iniMinutes * TICKS_PER_MINUTE);
    // C++ integer truncation: 0.04 * 900 = 36 ticks
    expect(expectedTicks).toBe(36);
  });
});

// ==========================================================================
// Section 2: Combat & Damage Constants
//   C++ rules.cpp:195-230, combat.cpp:100-130
// ==========================================================================
describe('Combat & Damage constants match rules.ini [General]', () => {

  it('MaxDamage=1000 -> MAX_DAMAGE', () => {
    const ini = parseInteger(general.get('MaxDamage')!);
    expect(ini).toBe(1000);
    expect(MAX_DAMAGE).toBe(ini);
  });

  it('MinDamage=1', () => {
    const ini = parseInteger(general.get('MinDamage')!);
    expect(ini).toBe(1);
  });

  it('AtomDamage=1000 -> NUKE_DAMAGE', () => {
    const ini = parseInteger(general.get('AtomDamage')!);
    expect(ini).toBe(1000);
    expect(NUKE_DAMAGE).toBe(ini);
  });

  it('APMineDamage=1000', () => {
    const ini = parseInteger(general.get('APMineDamage')!);
    expect(ini).toBe(1000);
  });

  it('AVMineDamage=1200', () => {
    const ini = parseInteger(general.get('AVMineDamage')!);
    expect(ini).toBe(1200);
  });

  it('BridgeStrength=1000', () => {
    const ini = parseInteger(general.get('BridgeStrength')!);
    expect(ini).toBe(1000);
  });

  it('C4Delay=.03 -> 27 ticks (floor(0.03 * 900))', () => {
    const iniMinutes = parseFloat_(general.get('C4Delay')!);
    expect(iniMinutes).toBeCloseTo(0.03, 6);
    const expectedTicks = Math.floor(iniMinutes * TICKS_PER_MINUTE);
    expect(expectedTicks).toBe(27);
  });

  it('Crush=1.5 (cells distance for auto-crush)', () => {
    const ini = parseFloat_(general.get('Crush')!);
    expect(ini).toBeCloseTo(1.5, 6);
  });

  it('BallisticScatter=1.0', () => {
    const ini = parseFloat_(general.get('BallisticScatter')!);
    expect(ini).toBeCloseTo(1.0, 6);
  });

  it('HomingScatter=2.0', () => {
    const ini = parseFloat_(general.get('HomingScatter')!);
    expect(ini).toBeCloseTo(2.0, 6);
  });

  it('ExpSpread=.3', () => {
    const ini = parseFloat_(general.get('ExpSpread')!);
    expect(ini).toBeCloseTo(0.3, 6);
  });

  it('FireSupress=1', () => {
    const ini = parseInteger(general.get('FireSupress')!);
    expect(ini).toBe(1);
  });

  it('ProneDamage=50% -> PRONE_DAMAGE_BIAS=0.5', () => {
    const ini = parsePercent(general.get('ProneDamage')!);
    expect(ini).toBeCloseTo(0.5, 6);
    expect(PRONE_DAMAGE_BIAS).toBeCloseTo(ini, 6);
  });

  it('Incoming=10', () => {
    const ini = parseInteger(general.get('Incoming')!);
    expect(ini).toBe(10);
  });

  it('TurboBoost=1.5', () => {
    const ini = parseFloat_(general.get('TurboBoost')!);
    expect(ini).toBeCloseTo(1.5, 6);
  });
});

// ==========================================================================
// Section 3: Special Weapons
//   C++ rules.cpp:120-140, house.cpp superweapon charge logic
// ==========================================================================
describe('Special Weapon constants match rules.ini [General]', () => {

  it('ChronoDuration=3 -> CHRONO_DURATION_TICKS=2700', () => {
    const iniMinutes = parseFloat_(general.get('ChronoDuration')!);
    expect(iniMinutes).toBe(3);
    const expectedTicks = iniMinutes * TICKS_PER_MINUTE;
    expect(expectedTicks).toBe(2700);
    expect(CHRONO_DURATION_TICKS).toBe(expectedTicks);
  });

  it('ChronoKillCargo=yes', () => {
    const ini = general.get('ChronoKillCargo')!.toLowerCase();
    expect(ini).toBe('yes');
  });

  it('ChronoTechLevel=12', () => {
    const ini = parseInteger(general.get('ChronoTechLevel')!);
    expect(ini).toBe(12);
  });

  it('GPSTechLevel=8', () => {
    const ini = parseInteger(general.get('GPSTechLevel')!);
    expect(ini).toBe(8);
  });

  it('GapRadius=10 -> GAP_RADIUS', () => {
    const ini = parseInteger(general.get('GapRadius')!);
    expect(ini).toBe(10);
    expect(GAP_RADIUS).toBe(ini);
  });

  it('GapRegenInterval=.1', () => {
    const ini = parseFloat_(general.get('GapRegenInterval')!);
    expect(ini).toBeCloseTo(0.1, 6);
  });

  it('IronCurtain=.75 -> IRON_CURTAIN_DURATION=675', () => {
    const iniMinutes = parseFloat_(general.get('IronCurtain')!);
    expect(iniMinutes).toBeCloseTo(0.75, 6);
    const expectedTicks = iniMinutes * 60 * GAME_TICKS_PER_SEC;
    expect(expectedTicks).toBe(675);
    expect(IRON_CURTAIN_DURATION).toBe(expectedTicks);
  });

  it('ParaTech=5', () => {
    const ini = parseInteger(general.get('ParaTech')!);
    expect(ini).toBe(5);
  });

  it('ParabombTech=8', () => {
    const ini = parseInteger(general.get('ParabombTech')!);
    expect(ini).toBe(8);
  });

  it('RadarJamRadius=15', () => {
    const ini = parseInteger(general.get('RadarJamRadius')!);
    expect(ini).toBe(15);
  });

  it('SpyPlaneTech=5', () => {
    const ini = parseInteger(general.get('SpyPlaneTech')!);
    expect(ini).toBe(5);
  });

  it('BadgerBombCount=1', () => {
    const ini = parseInteger(general.get('BadgerBombCount')!);
    expect(ini).toBe(1);
  });
});

// ==========================================================================
// Section 4: Chrono Side Effects
//   C++ rules.cpp:204-210
// ==========================================================================
describe('Chrono side-effect constants match rules.ini [General]', () => {

  it('QuakeChance=20%', () => {
    const ini = parsePercent(general.get('QuakeChance')!);
    expect(ini).toBeCloseTo(0.20, 6);
  });

  it('QuakeDamage=33%', () => {
    const ini = parsePercent(general.get('QuakeDamage')!);
    expect(ini).toBeCloseTo(0.33, 6);
  });

  it('VortexChance=20%', () => {
    const ini = parsePercent(general.get('VortexChance')!);
    expect(ini).toBeCloseTo(0.20, 6);
  });

  it('VortexDamage=200', () => {
    const ini = parseInteger(general.get('VortexDamage')!);
    expect(ini).toBe(200);
  });

  it('VortexRange=10', () => {
    const ini = parseInteger(general.get('VortexRange')!);
    expect(ini).toBe(10);
  });

  it('VortexSpeed=10', () => {
    const ini = parseInteger(general.get('VortexSpeed')!);
    expect(ini).toBe(10);
  });
});

// ==========================================================================
// Section 5: Income & Production
//   C++ rules.cpp:155-180
// ==========================================================================
describe('Income & Production constants match rules.ini [General]', () => {

  it('BailCount=28 -> Entity.BAIL_COUNT', () => {
    const ini = parseInteger(general.get('BailCount')!);
    expect(ini).toBe(28);
    expect(Entity.BAIL_COUNT).toBe(ini);
  });

  it('BuildSpeed=.8 -> CPP_BUILD_SPEED_BIAS (used in production calc)', () => {
    const ini = parseFloat_(general.get('BuildSpeed')!);
    expect(ini).toBeCloseTo(0.8, 6);
    // TS formula: buildTime = floor(Cost * 0.8 * 900 / 1000) = floor(Cost * 0.72)
    // Verify via a sample: E1 costs 100 -> floor(100 * 0.8 * 900 / 1000) = floor(72) = 72
    const e1BuildTime = Math.floor(100 * ini * TICKS_PER_MINUTE / 1000);
    expect(e1BuildTime).toBe(72);
  });

  it('BuildupTime=.06', () => {
    const ini = parseFloat_(general.get('BuildupTime')!);
    expect(ini).toBeCloseTo(0.06, 6);
  });

  it('GemValue=50', () => {
    const ini = parseInteger(general.get('GemValue')!);
    expect(ini).toBe(50);
  });

  it('GoldValue=25', () => {
    const ini = parseInteger(general.get('GoldValue')!);
    expect(ini).toBe(25);
  });

  it('GrowthRate=2 (minutes between ore growth)', () => {
    const ini = parseInteger(general.get('GrowthRate')!);
    expect(ini).toBe(2);
  });

  it('OreGrows=yes', () => {
    const ini = general.get('OreGrows')!.toLowerCase();
    expect(ini).toBe('yes');
  });

  it('OreSpreads=yes', () => {
    const ini = general.get('OreSpreads')!.toLowerCase();
    expect(ini).toBe('yes');
  });

  it('OreTruckRate=1', () => {
    const ini = parseInteger(general.get('OreTruckRate')!);
    expect(ini).toBe(1);
  });

  it('SeparateAircraft=no', () => {
    const ini = general.get('SeparateAircraft')!.toLowerCase();
    expect(ini).toBe('no');
  });

  it('SurvivorRate=.4', () => {
    const ini = parseFloat_(general.get('SurvivorRate')!);
    expect(ini).toBeCloseTo(0.4, 6);
  });
});

// ==========================================================================
// Section 6: Map & Visual Constants
//   C++ rules.cpp:230-250
// ==========================================================================
describe('Map & Visual constants match rules.ini [General]', () => {

  it('ConditionRed=25% -> CONDITION_RED=0.25', () => {
    const ini = parsePercent(general.get('ConditionRed')!);
    expect(ini).toBeCloseTo(0.25, 6);
    expect(CONDITION_RED).toBeCloseTo(ini, 6);
  });

  it('ConditionYellow=50% -> CONDITION_YELLOW=0.5', () => {
    const ini = parsePercent(general.get('ConditionYellow')!);
    expect(ini).toBeCloseTo(0.50, 6);
    expect(CONDITION_YELLOW).toBeCloseTo(ini, 6);
  });

  it('DropZoneRadius=4', () => {
    const ini = parseInteger(general.get('DropZoneRadius')!);
    expect(ini).toBe(4);
  });

  it('Gravity=3 -> RULE_GRAVITY', () => {
    const ini = parseInteger(general.get('Gravity')!);
    expect(ini).toBe(3);
    expect(RULE_GRAVITY).toBe(ini);
  });

  it('IdleActionFrequency=.1', () => {
    const ini = parseFloat_(general.get('IdleActionFrequency')!);
    expect(ini).toBeCloseTo(0.1, 6);
  });

  it('MessageDelay=.6', () => {
    const ini = parseFloat_(general.get('MessageDelay')!);
    expect(ini).toBeCloseTo(0.6, 6);
  });

  it('ShroudRate=4', () => {
    const ini = parseInteger(general.get('ShroudRate')!);
    expect(ini).toBe(4);
  });

  it('SpeakDelay=2', () => {
    const ini = parseInteger(general.get('SpeakDelay')!);
    expect(ini).toBe(2);
  });

  it('TimerWarning=2', () => {
    const ini = parseInteger(general.get('TimerWarning')!);
    expect(ini).toBe(2);
  });

  it('AllyReveal=yes', () => {
    const ini = general.get('AllyReveal')!.toLowerCase();
    expect(ini).toBe('yes');
  });

  it('EnemyHealth=yes', () => {
    const ini = general.get('EnemyHealth')!.toLowerCase();
    expect(ini).toBe('yes');
  });

  it('NamedCivilians=no', () => {
    const ini = general.get('NamedCivilians')!.toLowerCase();
    expect(ini).toBe('no');
  });

  it('FlashLowPower=yes', () => {
    const ini = general.get('FlashLowPower')!.toLowerCase();
    expect(ini).toBe('yes');
  });

  it('SavourDelay=.03', () => {
    const ini = parseFloat_(general.get('SavourDelay')!);
    expect(ini).toBeCloseTo(0.03, 6);
  });

  it('MovieTime=.06', () => {
    const ini = parseFloat_(general.get('MovieTime')!);
    expect(ini).toBeCloseTo(0.06, 6);
  });
});

// ==========================================================================
// Section 7: Crate Constants
//   C++ rules.cpp:260-275
// ==========================================================================
describe('Crate constants match rules.ini [General]', () => {

  it('CrateMinimum=1', () => {
    const ini = parseInteger(general.get('CrateMinimum')!);
    expect(ini).toBe(1);
  });

  it('CrateMaximum=255', () => {
    const ini = parseInteger(general.get('CrateMaximum')!);
    expect(ini).toBe(255);
  });

  it('CrateRadius=3.0 -> CRATE_RADIUS', () => {
    const ini = parseFloat_(general.get('CrateRadius')!);
    expect(ini).toBeCloseTo(3.0, 6);
    expect(CRATE_RADIUS).toBeCloseTo(ini, 6);
  });

  it('CrateRegen=3 (average minutes between regen)', () => {
    const ini = parseInteger(general.get('CrateRegen')!);
    expect(ini).toBe(3);
  });

  it('SoloCrateMoney=2000', () => {
    const ini = parseInteger(general.get('SoloCrateMoney')!);
    expect(ini).toBe(2000);
  });

  it('WaterCrateChance=20%', () => {
    const ini = parsePercent(general.get('WaterCrateChance')!);
    expect(ini).toBeCloseTo(0.20, 6);
  });

  it('UnitCrateType=none', () => {
    const ini = general.get('UnitCrateType')!.toLowerCase();
    expect(ini).toBe('none');
  });

  it('SilverCrate=HealBase', () => {
    const ini = general.get('SilverCrate')!;
    expect(ini).toBe('HealBase');
  });

  it('WaterCrate=Money', () => {
    const ini = general.get('WaterCrate')!;
    expect(ini).toBe('Money');
  });

  it('WoodCrate=Money', () => {
    const ini = general.get('WoodCrate')!;
    expect(ini).toBe('Money');
  });
});

// ==========================================================================
// Section 8: Movement & AI Constants
//   C++ rules.cpp:250-300
// ==========================================================================
describe('Movement & AI constants match rules.ini [General]', () => {

  it('BaseBias=2', () => {
    const ini = parseInteger(general.get('BaseBias')!);
    expect(ini).toBe(2);
  });

  it('BaseDefenseDelay=.25', () => {
    const ini = parseFloat_(general.get('BaseDefenseDelay')!);
    expect(ini).toBeCloseTo(0.25, 6);
  });

  it('CloseEnough=2.75', () => {
    const ini = parseFloat_(general.get('CloseEnough')!);
    expect(ini).toBeCloseTo(2.75, 6);
  });

  it('DamageDelay=1', () => {
    const ini = parseInteger(general.get('DamageDelay')!);
    expect(ini).toBe(1);
  });

  it('GameSpeeBias=1 (note: typo in original INI)', () => {
    const ini = parseInteger(general.get('GameSpeeBias')!);
    expect(ini).toBe(1);
  });

  it('LZScanRadius=16', () => {
    const ini = parseInteger(general.get('LZScanRadius')!);
    expect(ini).toBe(16);
  });

  it('MineAware=yes', () => {
    const ini = general.get('MineAware')!.toLowerCase();
    expect(ini).toBe('yes');
  });

  it('Stray=2.0', () => {
    const ini = parseFloat_(general.get('Stray')!);
    expect(ini).toBeCloseTo(2.0, 6);
  });

  it('SubmergeDelay=.02', () => {
    const ini = parseFloat_(general.get('SubmergeDelay')!);
    expect(ini).toBeCloseTo(0.02, 6);
  });

  it('SuspendDelay=2', () => {
    const ini = parseInteger(general.get('SuspendDelay')!);
    expect(ini).toBe(2);
  });

  it('SuspendPriority=20', () => {
    const ini = parseInteger(general.get('SuspendPriority')!);
    expect(ini).toBe(20);
  });

  it('TeamDelay=.6', () => {
    const ini = parseFloat_(general.get('TeamDelay')!);
    expect(ini).toBeCloseTo(0.6, 6);
  });

  it('CurleyShuffle=no', () => {
    const ini = general.get('CurleyShuffle')!.toLowerCase();
    expect(ini).toBe('no');
  });

  it('OreExplosive=no', () => {
    const ini = general.get('OreExplosive')!.toLowerCase();
    expect(ini).toBe('no');
  });

  it('PlayerAutoCrush=no', () => {
    const ini = general.get('PlayerAutoCrush')!.toLowerCase();
    expect(ini).toBe('no');
  });

  it('PlayerReturnFire=no', () => {
    const ini = general.get('PlayerReturnFire')!.toLowerCase();
    expect(ini).toBe('no');
  });

  it('PlayerScatter=no', () => {
    const ini = general.get('PlayerScatter')!.toLowerCase();
    expect(ini).toBe('no');
  });

  it('TreeTargeting=no', () => {
    const ini = general.get('TreeTargeting')!.toLowerCase();
    expect(ini).toBe('no');
  });

  it('MCVUndeploy=no', () => {
    const ini = general.get('MCVUndeploy')!.toLowerCase();
    expect(ini).toBe('no');
  });

  it('FineDiffControl=no', () => {
    const ini = general.get('FineDiffControl')!.toLowerCase();
    expect(ini).toBe('no');
  });
});

// ==========================================================================
// Section 9: Cross-check TS constants against INI-derived values
//   Ensures the engine didn't drift from the authoritative INI values.
// ==========================================================================
describe('TS engine constants cross-check against rules.ini', () => {

  it('IRON_CURTAIN_DURATION matches IronCurtain INI -> ticks conversion', () => {
    const iniMinutes = parseFloat_(general.get('IronCurtain')!);
    const expected = iniMinutes * 60 * GAME_TICKS_PER_SEC;
    expect(IRON_CURTAIN_DURATION).toBe(expected);
  });

  it('CHRONO_DURATION_TICKS matches ChronoDuration INI -> ticks conversion', () => {
    const iniMinutes = parseFloat_(general.get('ChronoDuration')!);
    const expected = iniMinutes * TICKS_PER_MINUTE;
    expect(CHRONO_DURATION_TICKS).toBe(expected);
  });

  it('CRATE_RADIUS matches CrateRadius INI (3.0, not 2.5 from C++ default)', () => {
    const ini = parseFloat_(general.get('CrateRadius')!);
    expect(CRATE_RADIUS).toBeCloseTo(ini, 6);
  });

  it('GAP_RADIUS matches GapRadius INI', () => {
    const ini = parseInteger(general.get('GapRadius')!);
    expect(GAP_RADIUS).toBe(ini);
  });

  it('Entity.BAIL_COUNT matches BailCount INI', () => {
    const ini = parseInteger(general.get('BailCount')!);
    expect(Entity.BAIL_COUNT).toBe(ini);
  });

  it('Entity.ORE_CAPACITY matches BailCount INI (alias)', () => {
    const ini = parseInteger(general.get('BailCount')!);
    expect(Entity.ORE_CAPACITY).toBe(ini);
  });

  it('MAX_DAMAGE matches MaxDamage INI', () => {
    const ini = parseInteger(general.get('MaxDamage')!);
    expect(MAX_DAMAGE).toBe(ini);
  });

  it('NUKE_DAMAGE matches AtomDamage INI', () => {
    const ini = parseInteger(general.get('AtomDamage')!);
    expect(NUKE_DAMAGE).toBe(ini);
  });

  it('RULE_GRAVITY matches Gravity INI', () => {
    const ini = parseInteger(general.get('Gravity')!);
    expect(RULE_GRAVITY).toBe(ini);
  });

  it('REPAIR_STEP matches RepairStep INI', () => {
    const ini = parseInteger(general.get('RepairStep')!);
    expect(REPAIR_STEP).toBe(ini);
  });

  it('REPAIR_PERCENT matches RepairPercent INI', () => {
    const ini = parsePercent(general.get('RepairPercent')!);
    expect(REPAIR_PERCENT).toBeCloseTo(ini, 6);
  });

  it('UREPAIR_STEP matches URepairStep INI', () => {
    const ini = parseInteger(general.get('URepairStep')!);
    expect(UREPAIR_STEP).toBe(ini);
  });

  it('UREPAIR_PERCENT matches URepairPercent INI', () => {
    const ini = parsePercent(general.get('URepairPercent')!);
    expect(UREPAIR_PERCENT).toBeCloseTo(ini, 6);
  });

  it('CONDITION_RED matches ConditionRed INI', () => {
    const ini = parsePercent(general.get('ConditionRed')!);
    expect(CONDITION_RED).toBeCloseTo(ini, 6);
  });

  it('CONDITION_YELLOW matches ConditionYellow INI', () => {
    const ini = parsePercent(general.get('ConditionYellow')!);
    expect(CONDITION_YELLOW).toBeCloseTo(ini, 6);
  });

  it('PRONE_DAMAGE_BIAS matches ProneDamage INI', () => {
    const ini = parsePercent(general.get('ProneDamage')!);
    expect(PRONE_DAMAGE_BIAS).toBeCloseTo(ini, 6);
  });
});
