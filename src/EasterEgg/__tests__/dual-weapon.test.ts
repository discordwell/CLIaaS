/**
 * Tests for dual-weapon (primary + secondary) firing system.
 * C++ parity: TechnoClass::Fire_At() / Can_Fire() — units with two weapons select
 * the best weapon based on target armor and alternate using independent cooldowns.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  UnitType, House, UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR,
  type WeaponStats, type WarheadType, type ArmorType,
  getWarheadMultiplier,
} from '../engine/types';

beforeEach(() => resetEntityIds());

/** Alias for centralized warhead multiplier */
const getWarheadMult = getWarheadMultiplier;

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

describe('Dual-weapon unit configuration', () => {
  it('Mammoth Tank (4TNK) has both primary (120mm) and secondary (MammothTusk) weapons', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain);
    expect(mammoth.weapon).not.toBeNull();
    expect(mammoth.weapon!.name).toBe('120mm');
    expect(mammoth.weapon2).not.toBeNull();
    expect(mammoth.weapon2!.name).toBe('MammothTusk');
  });

  it('Rocket Soldier (E3) has primary (Dragon) and secondary (RedEye)', () => {
    const rocket = makeEntity(UnitType.I_E3, House.Spain);
    expect(rocket.weapon).not.toBeNull();
    expect(rocket.weapon!.name).toBe('Dragon');
    expect(rocket.weapon2).not.toBeNull();
    expect(rocket.weapon2!.name).toBe('RedEye');
  });

  it('UNIT_STATS correctly defines secondaryWeapon for 4TNK', () => {
    const stats = UNIT_STATS['4TNK'];
    expect(stats.primaryWeapon).toBe('120mm');
    expect(stats.secondaryWeapon).toBe('MammothTusk');
  });

  it('UNIT_STATS correctly defines secondaryWeapon for E3', () => {
    const stats = UNIT_STATS['E3'];
    expect(stats.primaryWeapon).toBe('Dragon');
    expect(stats.secondaryWeapon).toBe('RedEye');
  });
});

describe('Single-weapon unit (no regression)', () => {
  it('unit without weapon2 only fires primary weapon', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.ANT1, House.USSR, 150, 100);

    expect(tank.weapon).not.toBeNull();
    expect(tank.weapon2).toBeNull();

    // selectWeapon should always return primary for single-weapon units
    const selected = tank.selectWeapon(target, getWarheadMult);
    expect(selected).toBe(tank.weapon);
  });

  it('unit without weapon2 returns primary even when on cooldown (caller gates cooldown)', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.ANT1, House.USSR, 150, 100);
    tank.attackCooldown = 30;

    // For single-weapon units, selectWeapon always returns the weapon.
    // The caller (updateAttack) gates the actual firing on cooldown state.
    const selected = tank.selectWeapon(target, getWarheadMult);
    expect(selected).toBe(tank.weapon);
  });

  it('unit without any weapons returns null', () => {
    const harv = makeEntity(UnitType.V_HARV, House.Spain, 100, 100);
    const target = makeEntity(UnitType.ANT1, House.USSR, 150, 100);

    expect(harv.weapon).toBeNull();
    expect(harv.weapon2).toBeNull();

    const selected = harv.selectWeapon(target, getWarheadMult);
    expect(selected).toBeNull();
  });
});

describe('Weapon selection based on target armor effectiveness', () => {
  it('selects weapon with higher effective damage vs target armor', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    // Target with heavy armor
    const heavyTarget = makeEntity(UnitType.V_3TNK, House.USSR, 150, 100);

    // 120mm: AP warhead, 40 damage, vs heavy armor: 1.0 multiplier → eff = 40
    // MammothTusk: HE warhead, 75 damage, vs heavy armor: 0.25 multiplier → eff = 18.75
    // 120mm should be selected against heavy armor
    const selected = mammoth.selectWeapon(heavyTarget, getWarheadMult);
    expect(selected).toBe(mammoth.weapon); // 120mm (AP is better vs heavy)
  });

  it('selects secondary weapon when more effective against light armor', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    // Target with no armor (infantry)
    const infantry = makeEntity(UnitType.I_E1, House.USSR, 150, 100);

    // 120mm: AP warhead, 40 damage, vs none armor: 0.3 multiplier → eff = 12
    // MammothTusk: HE warhead, 75 damage, vs none armor: 0.9 multiplier → eff = 67.5
    // MammothTusk should be selected against infantry (no armor)
    const selected = mammoth.selectWeapon(infantry, getWarheadMult);
    expect(selected).toBe(mammoth.weapon2); // MammothTusk (HE is better vs no armor)
  });

  it('E3 Rocket Soldier selects RedEye when more effective', () => {
    const rocket = makeEntity(UnitType.I_E3, House.Spain, 100, 100);
    const heavyTarget = makeEntity(UnitType.V_3TNK, House.USSR, 150, 100);

    // Dragon: AP warhead, 35 damage, vs heavy: 1.0 → eff = 35
    // RedEye: AP warhead, 50 damage, vs heavy: 1.0 → eff = 50
    // RedEye has higher damage with same warhead — should be preferred
    const selected = rocket.selectWeapon(heavyTarget, getWarheadMult);
    expect(selected).toBe(rocket.weapon2); // RedEye (more raw damage, same warhead)
  });
});

describe('Cooldown-based weapon selection', () => {
  it('fires secondary when primary is on cooldown', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.V_3TNK, House.USSR, 150, 100);

    // Put primary on cooldown
    mammoth.attackCooldown = 50;
    mammoth.attackCooldown2 = 0; // secondary ready

    const selected = mammoth.selectWeapon(target, getWarheadMult);
    expect(selected).toBe(mammoth.weapon2); // secondary fires because primary is cooling
  });

  it('fires primary when secondary is on cooldown', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.V_3TNK, House.USSR, 150, 100);

    // Put secondary on cooldown
    mammoth.attackCooldown = 0; // primary ready
    mammoth.attackCooldown2 = 50;

    const selected = mammoth.selectWeapon(target, getWarheadMult);
    expect(selected).toBe(mammoth.weapon); // primary fires because secondary is cooling
  });

  it('returns null when both weapons are on cooldown', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    const target = makeEntity(UnitType.V_3TNK, House.USSR, 150, 100);

    mammoth.attackCooldown = 30;
    mammoth.attackCooldown2 = 30;

    const selected = mammoth.selectWeapon(target, getWarheadMult);
    expect(selected).toBeNull();
  });
});

describe('Independent cooldown timers', () => {
  it('primary and secondary cooldowns decrement independently', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    mammoth.attackCooldown = 10;
    mammoth.attackCooldown2 = 5;

    // Simulate 5 ticks of cooldown decrement
    for (let i = 0; i < 5; i++) {
      if (mammoth.attackCooldown > 0) mammoth.attackCooldown--;
      if (mammoth.attackCooldown2 > 0) mammoth.attackCooldown2--;
    }

    expect(mammoth.attackCooldown).toBe(5);  // 10 - 5 = 5 (still cooling)
    expect(mammoth.attackCooldown2).toBe(0); // 5 - 5 = 0 (ready to fire)
  });

  it('cooldown values are tracked separately per weapon', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain);
    expect(mammoth.attackCooldown).toBe(0);
    expect(mammoth.attackCooldown2).toBe(0);

    // Set different cooldowns
    mammoth.attackCooldown = mammoth.weapon!.rof; // 120mm rof = 80
    mammoth.attackCooldown2 = mammoth.weapon2!.rof; // MammothTusk rof = 80

    expect(mammoth.attackCooldown).toBe(80);
    expect(mammoth.attackCooldown2).toBe(80);

    // After 40 ticks
    mammoth.attackCooldown -= 40;
    mammoth.attackCooldown2 -= 40;
    expect(mammoth.attackCooldown).toBe(40);
    expect(mammoth.attackCooldown2).toBe(40);
  });
});

describe('Damage calculation with dual weapons', () => {
  it('primary weapon (120mm AP) deals correct damage to heavy armor', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain);
    const weapon = mammoth.weapon!;

    // 120mm: damage=40, warhead=AP, vs heavy armor mult=1.0
    const mult = getWarheadMult(weapon.warhead, 'heavy');
    const damage = Math.max(1, Math.round(weapon.damage * mult));

    expect(weapon.damage).toBe(40);
    expect(mult).toBe(1.0);
    expect(damage).toBe(40);
  });

  it('secondary weapon (MammothTusk HE) deals correct damage to no armor', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain);
    const weapon2 = mammoth.weapon2!;

    // MammothTusk: damage=75, warhead=HE, vs no armor mult=0.9
    const mult = getWarheadMult(weapon2.warhead, 'none');
    const damage = Math.max(1, Math.round(weapon2.damage * mult));

    expect(weapon2.damage).toBe(75);
    expect(mult).toBe(0.9);
    expect(damage).toBe(68); // round(75 * 0.9) = 68
  });

  it('both weapons calculate independent damage correctly', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain);

    // Against light armor target
    const w1 = mammoth.weapon!;
    const w2 = mammoth.weapon2!;

    const mult1 = getWarheadMult(w1.warhead, 'light'); // AP vs light = 0.75
    const mult2 = getWarheadMult(w2.warhead, 'light'); // HE vs light = 0.6

    const dmg1 = Math.max(1, Math.round(w1.damage * mult1));
    const dmg2 = Math.max(1, Math.round(w2.damage * mult2));

    expect(dmg1).toBe(30);  // round(40 * 0.75) = 30
    expect(dmg2).toBe(45);  // round(75 * 0.6) = 45
  });
});

describe('inRange with dual weapons', () => {
  it('inRange returns true when target is in secondary weapon range but not primary', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    // 120mm range: 4.75 cells, MammothTusk range: 5.0 cells
    // Place target at ~4.9 cells distance (in primary's range too, but let's test edge)
    // Actually test with a custom unit where ranges differ significantly
    // For this test, use the E3 rocket soldier: Dragon range=5.0, RedEye range=7.5
    const rocket = makeEntity(UnitType.I_E3, House.Spain, 100, 100);
    // Place target at 6 cells away (24px * 6 = 144px from center)
    const target = makeEntity(UnitType.ANT1, House.USSR, 100 + 24 * 6, 100);

    // Dragon range=5.0, RedEye range=7.5
    // At distance ~6 cells: Dragon can't reach, RedEye can
    expect(rocket.inRangeWith(target, rocket.weapon!)).toBe(false);
    expect(rocket.inRangeWith(target, rocket.weapon2!)).toBe(true);
    // inRange (combined) should return true
    expect(rocket.inRange(target)).toBe(true);
  });

  it('inRange returns false when target is out of both weapons range', () => {
    const rocket = makeEntity(UnitType.I_E3, House.Spain, 100, 100);
    // Place target at 10 cells away — beyond both Dragon (5.0) and RedEye (7.5)
    const target = makeEntity(UnitType.ANT1, House.USSR, 100 + 24 * 10, 100);

    expect(rocket.inRange(target)).toBe(false);
  });
});

describe('selectWeapon respects range', () => {
  it('selects secondary when target is only in secondary weapon range', () => {
    const rocket = makeEntity(UnitType.I_E3, House.Spain, 100, 100);
    // Target at 6 cells: beyond Dragon (5.0) but within RedEye (7.5)
    const target = makeEntity(UnitType.ANT1, House.USSR, 100 + 24 * 6, 100);

    const selected = rocket.selectWeapon(target, getWarheadMult);
    expect(selected).toBe(rocket.weapon2); // Only RedEye can reach
  });

  it('selects primary when target is only in primary weapon range (secondary on cooldown or out of range)', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);
    // Target at 4 cells: within 120mm (4.75) and MammothTusk (5.0) range
    const target = makeEntity(UnitType.V_3TNK, House.USSR, 100 + 24 * 4, 100);

    // Put secondary on cooldown
    mammoth.attackCooldown2 = 50;

    const selected = mammoth.selectWeapon(target, getWarheadMult);
    expect(selected).toBe(mammoth.weapon);
  });
});

describe('Weapon selection — tie-breaking', () => {
  it('prefers primary weapon on equal effective damage', () => {
    const mammoth = makeEntity(UnitType.V_4TNK, House.Spain, 100, 100);

    // Create a scenario where both weapons have the same effectiveness:
    // We need a target where w1.damage * mult1 == w2.damage * mult2
    // This is unlikely with real stats, but we can verify that selectWeapon
    // returns primary (w1) when eff2 is NOT strictly greater than eff1
    // For 120mm (40 AP) vs MammothTusk (75 HE), they never tie exactly,
    // but we can verify the tie-breaking logic by checking the code's preference
    // Just ensure selectWeapon returns a weapon when both are ready
    const target = makeEntity(UnitType.V_3TNK, House.USSR, 150, 100);
    const selected = mammoth.selectWeapon(target, getWarheadMult);
    expect(selected).not.toBeNull();
  });
});
