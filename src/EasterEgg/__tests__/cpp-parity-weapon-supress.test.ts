/**
 * C++ parity: WeaponTypeClass::IsSupressed / TechnoClass::Area_Modify.
 *
 * Matched source:
 *   weapon.cpp:72-87   -- WeaponTypeClass constructor defaults IsSupressed=false
 *   weapon.cpp:204-208 -- Read_INI reads INI key "Supress"
 *   weapon.h:83-88     -- IsSupressed meaning
 *   techno.cpp:1342-1345 -- Area_Modify returns 1 unless PrimaryWeapon->IsSupressed
 *   techno.cpp:1732-1735 -- Evaluate_Object multiplies value by Area_Modify
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { Entity, threatScore } from '../engine/entity';
import { House, UnitType, WEAPON_STATS } from '../engine/types';
import { parseIniSections } from '../engine/parseIni';
import { buildScenarioRuleOverrides } from '../engine/scenarioRules';

const rulesIniText = readFileSync(
  join(process.cwd(), 'public', 'ra', 'assets', 'rules.ini'),
  'utf-8',
);
const rulesSections = parseIniSections(rulesIniText);

function makeEntity(type: UnitType, house: House): Entity {
  return new Entity(type, house, 100, 100);
}

function cppIniSupressFlag(weaponName: string): boolean {
  return rulesSections.get(weaponName)?.get('Supress')?.toLowerCase() === 'yes';
}

describe('WeaponTypeClass::IsSupressed INI parity', () => {
  it('8Inch loads Supress=yes from rules.ini into WeaponStats.isSupressed', () => {
    expect(cppIniSupressFlag('8Inch')).toBe(true);
    expect(WEAPON_STATS['8Inch'].isSupressed).toBe(true);
  });

  it('SCUD is splash-capable in TS but has no Supress=yes in rules.ini', () => {
    expect(WEAPON_STATS.SCUD.splash).toBeGreaterThan(0);
    expect(cppIniSupressFlag('SCUD')).toBe(false);
    expect(WEAPON_STATS.SCUD.isSupressed).toBeFalsy();
  });

  it('scenario rules loader reads Supress and preserves the C++ default false when omitted', () => {
    const overrides = buildScenarioRuleOverrides(rulesSections);

    expect(overrides.scenarioWeaponStats['8Inch'].isSupressed).toBe(true);
    expect(overrides.scenarioWeaponStats.SCUD.isSupressed).toBeFalsy();
  });
});

describe('TechnoClass::Area_Modify target valuation parity', () => {
  it('applies Area_Modify for 8Inch because PrimaryWeapon->IsSupressed is true', () => {
    const scanner = makeEntity(UnitType.V_CA, House.Spain);
    const target = makeEntity(UnitType.I_E1, House.USSR);

    expect(scanner.weapon?.name).toBe('8Inch');
    expect(scanner.weapon?.splash).toBeUndefined();
    expect(scanner.weapon?.isSupressed).toBe(true);

    const noFriendly = threatScore(scanner, target, 2, null, 0);
    const oneFriendly = threatScore(scanner, target, 2, null, 1);

    expect(oneFriendly).toBeLessThan(noFriendly);
    expect(oneFriendly / noFriendly).toBeCloseTo(0.5, 2);
  });

  it('does not apply Area_Modify for SCUD even though it has splash', () => {
    const scanner = makeEntity(UnitType.V_V2RL, House.Spain);
    const target = makeEntity(UnitType.I_E1, House.USSR);

    expect(scanner.weapon?.name).toBe('SCUD');
    expect(scanner.weapon?.splash).toBeGreaterThan(0);
    expect(scanner.weapon?.isSupressed).toBeFalsy();

    const noFriendly = threatScore(scanner, target, 2, null, 0);
    const threeFriendly = threatScore(scanner, target, 2, null, 3);

    expect(threeFriendly).toBe(noFriendly);
  });

  it('returns unmodified valuation when a scanner has no primary weapon', () => {
    const scanner = makeEntity(UnitType.V_MCV, House.Spain);
    const target = makeEntity(UnitType.I_E1, House.USSR);

    expect(scanner.weapon).toBeNull();
    expect(threatScore(scanner, target, 2, null, 2)).toBe(
      threatScore(scanner, target, 2, null, 0),
    );
  });
});
