import { describe, expect, it } from 'vitest';

import { buildScenarioRuleOverrides } from '../engine/scenarioRules';

describe('C++ parity: scenario projectile overrides', () => {
  it('replaces inherited projectile flags when a scenario weapon changes Projectile=', () => {
    const rawSections = new Map<string, Map<string, string>>([
      ['ANT3', new Map([
        ['Primary', 'Napalm'],
      ])],
      ['Napalm', new Map([
        ['Damage', '60'],
        ['ROF', '25'],
        ['Range', '1.75'],
        ['Projectile', 'Invisible'],
        ['Speed', '100'],
        ['Warhead', 'Super'],
      ])],
    ]);

    const { scenarioUnitStats, scenarioWeaponStats } = buildScenarioRuleOverrides(rawSections);
    const weapon = scenarioWeaponStats.Napalm;

    expect(scenarioUnitStats.ANT3.primaryWeapon).toBe('Napalm');
    expect(weapon.damage).toBe(60);
    expect(weapon.rof).toBe(25);
    expect(weapon.range).toBe(1.75);
    expect(weapon.warhead).toBe('Super');
    expect(weapon.projSpeed).toBe(100);
    expect(weapon.isInvisible).toBe(true);
    expect(weapon.projectileArm).toBeUndefined();
    expect(weapon.isDropping).toBeUndefined();
    expect(weapon.isParachuted).toBeUndefined();
    expect(weapon.isHigh).toBeUndefined();
  });

  it('applies scenario projectile-section fields after changing Projectile=', () => {
    const rawSections = new Map<string, Map<string, string>>([
      ['HELI', new Map([
        ['Primary', 'Hellfire'],
      ])],
      ['Hellfire', new Map([
        ['Projectile', 'LaserGuided'],
        ['Speed', '22'],
      ])],
      ['LaserGuided', new Map([
        ['Arm', '2'],
      ])],
    ]);

    const { scenarioWeaponStats } = buildScenarioRuleOverrides(rawSections);
    const weapon = scenarioWeaponStats.Hellfire;

    expect(weapon.projSpeed).toBe(22);
    expect(weapon.projectileROT).toBe(20);
    expect(weapon.projectileArm).toBe(2);
    expect(weapon.isHigh).toBe(true);
    expect(weapon.isFueled).toBe(true);
    expect(weapon.isAntiAir).toBe(true);
  });
});
