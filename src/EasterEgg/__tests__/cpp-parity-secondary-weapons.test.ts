/**
 * C++ Behavioral Parity: Secondary Weapons
 *
 * Audits unit secondary weapon assignments and firing behavior against C++ rules.ini.
 * Each unit with Primary= and/or Secondary= in rules.ini is checked against UNIT_STATS.
 *
 * C++ source references:
 *   - rules.ini [UnitType] Primary=, Secondary= fields
 *   - aftrmath.ini [UnitType] Primary=, Secondary= fields (expansion overrides)
 *   - techno.cpp What_Weapon_Should_I_Use() — weapon selection logic
 *   - weapon.cpp / bbdata.cpp — weapon stat entries (Burst=, etc.)
 *
 * Tests that FAIL identify real C++ divergences.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR,
  COUNTRY_BONUSES, buildDefaultAlliances, armorIndex, getWarheadMultiplier,
  type WarheadType, type ArmorType,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

// =============================================================================
// 1. Secondary weapon assignments match INI
// =============================================================================
// C++ rules.ini [UnitType] entries specify Primary= and Secondary= fields.
// Every UNIT_STATS entry should match the INI exactly.

describe('Secondary weapon assignments from rules.ini', () => {
  // -- Units WITH secondaries per rules.ini --

  it('3TNK: Secondary=105mm (dual cannon) — rules.ini line 518', () => {
    const stats = UNIT_STATS['3TNK'];
    expect(stats.primaryWeapon).toBe('105mm');
    expect(stats.secondaryWeapon).toBe('105mm');
  });

  it('4TNK: Secondary=MammothTusk (tusk missiles) — rules.ini line 551', () => {
    const stats = UNIT_STATS['4TNK'];
    expect(stats.primaryWeapon).toBe('120mm');
    expect(stats.secondaryWeapon).toBe('MammothTusk');
  });

  it('DD: Secondary=DepthCharge — rules.ini line 721', () => {
    const stats = UNIT_STATS['DD'];
    expect(stats.primaryWeapon).toBe('Stinger');
    expect(stats.secondaryWeapon).toBe('DepthCharge');
  });

  it('PT: Secondary=DepthCharge — rules.ini line 766', () => {
    const stats = UNIT_STATS['PT'];
    expect(stats.primaryWeapon).toBe('2Inch');
    expect(stats.secondaryWeapon).toBe('DepthCharge');
  });

  it('CA: Secondary=8Inch (dual turrets) — rules.ini line 737', () => {
    const stats = UNIT_STATS['CA'];
    expect(stats.primaryWeapon).toBe('8Inch');
    expect(stats.secondaryWeapon).toBe('8Inch');
  });

  it('E3: Primary=RedEye, Secondary=Dragon (AA primary, AT secondary) — rules.ini line 822-823', () => {
    const stats = UNIT_STATS['E3'];
    expect(stats.primaryWeapon).toBe('RedEye');
    expect(stats.secondaryWeapon).toBe('Dragon');
  });

  it('MIG: Secondary=Maverick (dual missiles) — rules.ini line 1124-1125', () => {
    const stats = UNIT_STATS['MIG'];
    expect(stats.primaryWeapon).toBe('Maverick');
    expect(stats.secondaryWeapon).toBe('Maverick');
  });

  it('YAK: Secondary=ChainGun — rules.ini line 1141-1142', () => {
    const stats = UNIT_STATS['YAK'];
    expect(stats.primaryWeapon).toBe('ChainGun');
    expect(stats.secondaryWeapon).toBe('ChainGun');
  });

  it('HELI: Secondary=Hellfire — rules.ini line 1173-1174', () => {
    const stats = UNIT_STATS['HELI'];
    expect(stats.primaryWeapon).toBe('Hellfire');
    expect(stats.secondaryWeapon).toBe('Hellfire');
  });

  it('E7 (Tanya): Secondary=Colt45 — rules.ini line 889-890', () => {
    const stats = UNIT_STATS['E7'];
    expect(stats.primaryWeapon).toBe('Colt45');
    expect(stats.secondaryWeapon).toBe('Colt45');
  });
});

describe('HIND has no secondary weapon per rules.ini', () => {
  // C++ rules.ini [HIND] section (line 1189-1203) has Primary=ChainGun and NO Secondary= line.
  // TS should NOT assign a secondary weapon.

  it('HIND: Primary=ChainGun, no Secondary — rules.ini line 1191 (no Secondary= field)', () => {
    const stats = UNIT_STATS['HIND'];
    expect(stats.primaryWeapon).toBe('ChainGun');
    // HIND has no Secondary= in rules.ini; TS should match
    const hasSecondary = stats.secondaryWeapon !== undefined && stats.secondaryWeapon !== null;
    expect(hasSecondary, 'HIND should NOT have a secondary weapon per rules.ini').toBe(false);
  });
});

describe('Secondary weapon assignments from aftrmath.ini (expansion units)', () => {
  // aftrmath.ini expansion units — check if any have secondaries

  it('STNK (Phase Transport): Primary=APTusk, no Secondary — aftrmath.ini line 13-28', () => {
    const stats = UNIT_STATS['STNK'];
    expect(stats.primaryWeapon).toBe('APTusk');
    const hasSecondary = stats.secondaryWeapon !== undefined && stats.secondaryWeapon !== null;
    expect(hasSecondary, 'STNK has no Secondary= in aftrmath.ini').toBe(false);
  });

  it('CTNK (Chrono Tank): Primary=APTusk, no Secondary — aftrmath.ini line 46-58', () => {
    const stats = UNIT_STATS['CTNK'];
    expect(stats.primaryWeapon).toBe('APTusk');
    const hasSecondary = stats.secondaryWeapon !== undefined && stats.secondaryWeapon !== null;
    expect(hasSecondary, 'CTNK has no Secondary= in aftrmath.ini').toBe(false);
  });

  it('TTNK (Tesla Tank): Primary=TTankZap, no Secondary — aftrmath.ini line 61-74', () => {
    const stats = UNIT_STATS['TTNK'];
    expect(stats.primaryWeapon).toBe('TTankZap');
    const hasSecondary = stats.secondaryWeapon !== undefined && stats.secondaryWeapon !== null;
    expect(hasSecondary, 'TTNK has no Secondary= in aftrmath.ini').toBe(false);
  });

  it('DTRK (Demo Truck): Primary=Democharge, no Secondary — aftrmath.ini line 78-90', () => {
    const stats = UNIT_STATS['DTRK'];
    expect(stats.primaryWeapon).toBe('Democharge');
    const hasSecondary = stats.secondaryWeapon !== undefined && stats.secondaryWeapon !== null;
    expect(hasSecondary, 'DTRK has no Secondary= in aftrmath.ini').toBe(false);
  });

  it('MSUB (Missile Sub): Primary=SubSCUD, no Secondary — aftrmath.ini line 109-122', () => {
    const stats = UNIT_STATS['MSUB'];
    expect(stats.primaryWeapon).toBe('SubSCUD');
    const hasSecondary = stats.secondaryWeapon !== undefined && stats.secondaryWeapon !== null;
    expect(hasSecondary, 'MSUB has no Secondary= in aftrmath.ini').toBe(false);
  });

  it('SHOK (Shock Trooper): Primary=PortaTesla, no Secondary — aftrmath.ini line 125-138', () => {
    const stats = UNIT_STATS['SHOK'];
    expect(stats.primaryWeapon).toBe('PortaTesla');
    const hasSecondary = stats.secondaryWeapon !== undefined && stats.secondaryWeapon !== null;
    expect(hasSecondary, 'SHOK has no Secondary= in aftrmath.ini').toBe(false);
  });

  it('MECH (Mechanic): Primary=GoodWrench, no Secondary — aftrmath.ini line 141-151', () => {
    const stats = UNIT_STATS['MECH'];
    expect(stats.primaryWeapon).toBe('GoodWrench');
    const hasSecondary = stats.secondaryWeapon !== undefined && stats.secondaryWeapon !== null;
    expect(hasSecondary, 'MECH has no Secondary= in aftrmath.ini').toBe(false);
  });
});

// =============================================================================
// 2. Weapon selection logic
// =============================================================================
// C++ techno.cpp What_Weapon_Should_I_Use() selects between primary and secondary:
//   - If target is aircraft and weapon is AA -> prefer AA weapon
//   - E3 specifically: RedEye (AA missile, AG=no) vs aircraft; Dragon (AT) vs ground
//   - If both weapons are identical (MIG, YAK, HELI), selection is trivial
//
// C++ key logic (techno.cpp:1898-1941):
//   primary = Class->PrimaryWeapon; secondary = Class->SecondaryWeapon;
//   if (primary && !primary->IsAntiAircraft && secondary && secondary->IsAntiAircraft && target is aircraft)
//     -> use secondary
//   if (secondary && !secondary->IsAntiGround && target is ground)
//     -> use primary (skip non-AG secondary vs ground targets)

describe('Weapon selection logic — E3 (Rocket Soldier) dual weapon', () => {
  // C++ techno.cpp:1898-1941 What_Weapon_Should_I_Use
  // E3 has RedEye (AA-only missile: Projectile=AAMissile, AA=yes, AG=no) as primary
  // and Dragon (AT missile: Projectile=HeatSeeker, AA=yes, AG=yes) as secondary.
  //
  // C++ behavior:
  //   - vs aircraft: use RedEye (primary is AA)
  //   - vs ground: use Dragon (secondary), because primary AAMissile has AG=no

  it('E3 primary weapon (RedEye) projectile is AAMissile — AA=yes, AG=no per rules.ini', () => {
    const redEye = WEAPON_STATS['RedEye'];
    expect(redEye).toBeDefined();
    expect(redEye.isAntiAir).toBe(true);
    // RedEye uses AAMissile projectile which has AG=no — cannot fire at ground targets
    // In C++ this means E3 falls through to secondary (Dragon) for ground targets
  });

  it('E3 secondary weapon (Dragon) is AT missile — AA=yes per HeatSeeker, AG=yes per rules.ini', () => {
    const dragon = WEAPON_STATS['Dragon'];
    expect(dragon).toBeDefined();
    expect(dragon.warhead).toBe('AP');
    // Dragon uses HeatSeeker projectile which has AA=yes — can also target aircraft
    // But primary RedEye is preferred against aircraft in C++ due to weapon priority
  });

  it('E3 entity has both weapon and weapon2 initialized', () => {
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    expect(e3.weapon, 'E3 should have primary weapon').not.toBeNull();
    expect(e3.weapon2, 'E3 should have secondary weapon').not.toBeNull();
    expect(e3.weapon!.name).toBe('RedEye');
    expect(e3.weapon2!.name).toBe('Dragon');
  });

  it('E3 selectWeapon vs heavy-armor ground target should prefer Dragon (AT)', () => {
    // C++ techno.cpp: AAMissile (RedEye) has AG=no, so for ground targets E3 must use Dragon.
    // TS selectWeapon uses effective-damage comparison instead of AG flag.
    // If TS doesn't enforce AG=no for RedEye, it might pick RedEye vs ground incorrectly.
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    const heavyTank = entityAtCell(UnitType.V_3TNK, House.USSR, 11, 10);

    const getWhMult = (wh: WarheadType, armor: ArmorType) => getWarheadMultiplier(wh, armor);
    const selected = e3.selectWeapon(heavyTank, getWhMult);

    expect(selected, 'E3 should select a weapon vs ground target').not.toBeNull();
    // C++ mandates Dragon (secondary) vs ground because RedEye AAMissile AG=no
    expect(selected!.name, 'E3 should use Dragon vs ground heavy armor target').toBe('Dragon');
  });

  it('E3 selectWeapon vs infantry should prefer Dragon (RedEye AG=no in C++)', () => {
    // C++ behavior: RedEye (AAMissile, AG=no) cannot target infantry on the ground.
    // The only available weapon against ground infantry is Dragon.
    const e3 = entityAtCell(UnitType.I_E3, House.Spain, 10, 10);
    const rifleman = entityAtCell(UnitType.I_E1, House.USSR, 11, 10);

    const getWhMult = (wh: WarheadType, armor: ArmorType) => getWarheadMultiplier(wh, armor);
    const selected = e3.selectWeapon(rifleman, getWhMult);

    expect(selected).not.toBeNull();
    // C++ mandates Dragon: RedEye AG=no means it can't target ground at all
    expect(selected!.name, 'E3 should use Dragon vs ground infantry').toBe('Dragon');
  });
});

describe('Weapon selection logic — 4TNK (Mammoth) dual weapon', () => {
  // 4TNK: Primary=120mm (AP cannon), Secondary=MammothTusk (HE homing missiles).
  // C++ techno.cpp: both weapons can fire at ground targets.
  // MammothTusk is AA (HeatSeeker: AA=yes), 120mm is not.
  // C++ behavior:
  //   - vs ground: either weapon (C++ uses effective damage or alternation)
  //   - vs aircraft: prefer MammothTusk (secondary, AA-capable)

  it('4TNK entity has both weapons initialized', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    expect(mammoth.weapon).not.toBeNull();
    expect(mammoth.weapon2).not.toBeNull();
    expect(mammoth.weapon!.name).toBe('120mm');
    expect(mammoth.weapon2!.name).toBe('MammothTusk');
  });

  it('MammothTusk is AA-capable (HeatSeeker projectile, AA=yes)', () => {
    const mt = WEAPON_STATS['MammothTusk'];
    expect(mt.isAntiAir).toBe(true);
  });

  it('120mm is NOT AA-capable (Cannon projectile)', () => {
    const w120 = WEAPON_STATS['120mm'];
    // C++ Cannon projectile has AA=false (no AA flag in rules.ini [Cannon])
    expect(w120.isAntiAir).toBeFalsy();
  });
});

describe('Weapon selection — units with identical primary/secondary', () => {
  // MIG, YAK, HELI, CA, E7 have the same weapon for both slots.
  // C++ What_Weapon_Should_I_Use returns primary trivially since both are equivalent.

  const identicalWeaponUnits: [string, string][] = [
    ['MIG', 'Maverick'],
    ['YAK', 'ChainGun'],
    ['HELI', 'Hellfire'],
    ['CA', '8Inch'],
    ['E7', 'Colt45'],
    ['3TNK', '105mm'],
  ];

  for (const [unitKey, weaponName] of identicalWeaponUnits) {
    it(`${unitKey}: primary and secondary are both ${weaponName}`, () => {
      const stats = UNIT_STATS[unitKey];
      expect(stats.primaryWeapon).toBe(weaponName);
      expect(stats.secondaryWeapon).toBe(weaponName);
    });
  }
});

// =============================================================================
// 3. Units that should NOT have secondaries
// =============================================================================
// C++ rules.ini: units without a Secondary= line have no secondary weapon.
// Verify UNIT_STATS matches (secondaryWeapon is undefined or null).

describe('Units without secondary weapons (INI has no Secondary= line)', () => {
  const noSecondaryUnits: [string, string][] = [
    // Base game vehicles
    ['1TNK', 'Light Tank'],
    ['2TNK', 'Medium Tank'],
    ['JEEP', 'Ranger'],
    ['APC', 'APC'],
    ['ARTY', 'Artillery'],
    ['HARV', 'Harvester'],
    ['MCV', 'MCV'],
    ['TRUK', 'Supply Truck'],
    ['V2RL', 'V2 Rocket'],
    ['MNLY', 'Minelayer'],
    ['MRJ', 'Radar Jammer'],
    ['MGG', 'Mobile Gap Gen'],
    // Base game infantry
    ['E1', 'Rifle Infantry'],
    ['E2', 'Grenadier'],
    ['E4', 'Flamethrower'],
    ['E6', 'Engineer'],
    ['DOG', 'Attack Dog'],
    ['SPY', 'Spy'],
    ['MEDI', 'Medic'],
    ['GNRL', 'General'],
    // Naval (no secondary)
    ['SS', 'Submarine'],
    ['LST', 'Transport'],
    // Aircraft (no secondary)
    ['HIND', 'Hind'],
    ['TRAN', 'Chinook'],
    ['BADR', 'Badger'],
    ['U2', 'Spy Plane'],
    // Civilians
    ['C1', 'Civilian C1'],
    ['C2', 'Civilian C2'],
    ['CHAN', 'Specialist'],
    ['EINSTEIN', 'Einstein'],
    // Expansion
    ['STNK', 'Phase Transport'],
    ['CTNK', 'Chrono Tank'],
    ['TTNK', 'Tesla Tank'],
    ['QTNK', 'M.A.D. Tank'],
    ['DTRK', 'Demo Truck'],
    ['MSUB', 'Missile Sub'],
    ['SHOK', 'Shock Trooper'],
    ['MECH', 'Mechanic'],
  ];

  for (const [unitKey, unitName] of noSecondaryUnits) {
    it(`${unitKey} (${unitName}) has no secondary weapon`, () => {
      const stats = UNIT_STATS[unitKey];
      expect(stats, `${unitKey} should exist in UNIT_STATS`).toBeDefined();
      const secondary = stats.secondaryWeapon;
      // Should be undefined or null (not a weapon name string)
      const hasSecondary = secondary !== undefined && secondary !== null;
      expect(hasSecondary, `${unitKey} should NOT have a secondary weapon`).toBe(false);
    });
  }
});

// =============================================================================
// 4. Burst fire on secondary weapons
// =============================================================================
// C++ weapon.cpp: MammothTusk has Burst=2. 120mm also has Burst=2.
// Verify these weapon stats are accessible and correct in WEAPON_STATS.

describe('Burst fire stats on secondary-capable weapons', () => {
  it('MammothTusk burst=2 — rules.ini [MammothTusk] Burst=2', () => {
    const mt = WEAPON_STATS['MammothTusk'];
    expect(mt).toBeDefined();
    expect(mt.burst).toBe(2);
  });

  it('120mm burst=2 — rules.ini [120mm] Burst=2', () => {
    const w120 = WEAPON_STATS['120mm'];
    expect(w120).toBeDefined();
    expect(w120.burst).toBe(2);
  });

  it('Stinger (DD primary) burst=2 — rules.ini [Stinger] Burst=2', () => {
    const stinger = WEAPON_STATS['Stinger'];
    expect(stinger).toBeDefined();
    expect(stinger.burst).toBe(2);
  });

  it('DepthCharge (DD/PT secondary) has no burst — rules.ini [DepthCharge] no Burst= line', () => {
    const dc = WEAPON_STATS['DepthCharge'];
    expect(dc).toBeDefined();
    // No Burst= in INI means default burst=1 (single shot)
    const burst = dc.burst ?? 1;
    expect(burst).toBe(1);
  });

  it('8Inch (CA primary+secondary) has no burst — rules.ini [8Inch] no Burst= line', () => {
    const gun8 = WEAPON_STATS['8Inch'];
    expect(gun8).toBeDefined();
    // No Burst= in INI means default burst=1
    const burst = gun8.burst ?? 1;
    expect(burst).toBe(1);
  });

  it('Colt45 (E7 primary+secondary) has no burst — rules.ini [Colt45] no Burst= line', () => {
    const colt = WEAPON_STATS['Colt45'];
    expect(colt).toBeDefined();
    const burst = colt.burst ?? 1;
    expect(burst).toBe(1);
  });

  it('Dragon (E3 secondary) has no burst — rules.ini [Dragon] no Burst= line', () => {
    const dragon = WEAPON_STATS['Dragon'];
    expect(dragon).toBeDefined();
    const burst = dragon.burst ?? 1;
    expect(burst).toBe(1);
  });

  it('RedEye (E3 primary) has no burst — rules.ini [RedEye] no Burst= line', () => {
    const redEye = WEAPON_STATS['RedEye'];
    expect(redEye).toBeDefined();
    const burst = redEye.burst ?? 1;
    expect(burst).toBe(1);
  });
});

describe('MammothTusk secondary weapon full stat verification (rules.ini [MammothTusk])', () => {
  const mt = WEAPON_STATS['MammothTusk'];

  it('damage=75', () => {
    expect(mt.damage).toBe(75);
  });

  it('ROF=80', () => {
    expect(mt.rof).toBe(80);
  });

  it('range=5.0 cells', () => {
    expect(mt.range).toBe(5.0);
  });

  it('warhead=HE', () => {
    expect(mt.warhead).toBe('HE');
  });

  it('burst=2', () => {
    expect(mt.burst).toBe(2);
  });

  it('speed=30 (projectile speed from INI)', () => {
    expect(mt.projSpeed).toBe(30);
  });

  it('isAntiAir=true (HeatSeeker projectile has AA=yes)', () => {
    expect(mt.isAntiAir).toBe(true);
  });

  it('isFueled=true (HeatSeeker projectile has Ranged=yes)', () => {
    expect(mt.isFueled).toBe(true);
  });
});

describe('DepthCharge secondary weapon full stat verification (rules.ini [DepthCharge])', () => {
  const dc = WEAPON_STATS['DepthCharge'];

  it('damage=80', () => {
    expect(dc.damage).toBe(80);
  });

  it('ROF=60', () => {
    expect(dc.rof).toBe(60);
  });

  it('range=5.0 cells', () => {
    expect(dc.range).toBe(5.0);
  });

  it('warhead=AP', () => {
    expect(dc.warhead).toBe('AP');
  });

  it('isArcing=true (Catapult projectile has Arcing=yes)', () => {
    expect(dc.isArcing).toBe(true);
  });

  it('isAntiSub=true (Catapult projectile has ASW=yes)', () => {
    expect(dc.isAntiSub).toBe(true);
  });

  it('projSpeed=5 (Speed=5 in rules.ini)', () => {
    expect(dc.projSpeed).toBe(5);
  });
});

// =============================================================================
// 5. Entity weapon2 initialization from UNIT_STATS.secondaryWeapon
// =============================================================================
// C++ entity.cpp constructor reads Secondary weapon from UnitTypeClass.
// TS Entity constructor should initialize weapon2 from UNIT_STATS.secondaryWeapon.

describe('Entity weapon2 initialization matches secondaryWeapon stat', () => {
  const dualWeaponUnits: [UnitType, string, string][] = [
    [UnitType.V_4TNK, 'MammothTusk', '4TNK'],
    [UnitType.V_3TNK, '105mm', '3TNK'],
    [UnitType.I_E3, 'Dragon', 'E3'],
    [UnitType.V_DD, 'DepthCharge', 'DD'],
    [UnitType.V_PT, 'DepthCharge', 'PT'],
    [UnitType.V_CA, '8Inch', 'CA'],
    [UnitType.V_MIG, 'Maverick', 'MIG'],
    [UnitType.V_YAK, 'ChainGun', 'YAK'],
    [UnitType.V_HELI, 'Hellfire', 'HELI'],
    [UnitType.I_TANYA, 'Colt45', 'E7'],
  ];

  for (const [unitType, expectedSecondary, label] of dualWeaponUnits) {
    it(`${label} entity has weapon2 = ${expectedSecondary}`, () => {
      const entity = entityAtCell(unitType, House.Spain, 10, 10);
      expect(entity.weapon2, `${label} entity.weapon2 should be initialized`).not.toBeNull();
      expect(entity.weapon2!.name).toBe(expectedSecondary);
    });
  }

  it('E1 entity has weapon2 = null (no secondary)', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    expect(e1.weapon2).toBeNull();
  });

  it('HARV entity has weapon2 = null (no weapons at all)', () => {
    const harv = entityAtCell(UnitType.V_HARV, House.Spain, 10, 10);
    expect(harv.weapon2).toBeNull();
  });

  it('HIND entity has weapon2 = null (no secondary in INI)', () => {
    const hind = entityAtCell(UnitType.V_HIND, House.USSR, 10, 10);
    expect(hind.weapon2).toBeNull();
  });

  it('DOG entity has weapon2 = null (no secondary)', () => {
    const dog = entityAtCell(UnitType.I_DOG, House.USSR, 10, 10);
    expect(dog.weapon2).toBeNull();
  });
});

// =============================================================================
// 6. Secondary weapon stat cross-references with INI
// =============================================================================
// Verify that weapon stats in WEAPON_STATS match what rules.ini specifies
// for each secondary weapon entry.

describe('Dragon (E3 secondary) stat verification — rules.ini [Dragon]', () => {
  const dragon = WEAPON_STATS['Dragon'];

  it('damage=35', () => {
    expect(dragon.damage).toBe(35);
  });

  it('ROF=50', () => {
    expect(dragon.rof).toBe(50);
  });

  it('range=5.0 cells', () => {
    expect(dragon.range).toBe(5.0);
  });

  it('warhead=AP', () => {
    expect(dragon.warhead).toBe('AP');
  });

  it('projectile speed=25 (Speed=25 in rules.ini)', () => {
    expect(dragon.projSpeed).toBe(25);
  });
});

describe('105mm (3TNK secondary = same as primary) stat verification — rules.ini [105mm]', () => {
  const w105 = WEAPON_STATS['105mm'];

  it('damage=30', () => {
    expect(w105.damage).toBe(30);
  });

  it('ROF=70', () => {
    expect(w105.rof).toBe(70);
  });

  it('range=4.75 cells', () => {
    expect(w105.range).toBe(4.75);
  });

  it('warhead=AP', () => {
    expect(w105.warhead).toBe('AP');
  });
});
