/**
 * C++ Parity Audit: Infantry Data Constants
 *
 * Verifies UNIT_STATS infantry entries against authoritative C++ rules.ini / aftrmath.ini values.
 * Tests that FAIL identify real divergences between TS engine and C++ originals.
 *
 * Source files:
 *   - rules.ini [E1]-[E7], [DOG], [SPY], [MEDI], [GNRL], [CHAN], [C1]-[C10], [EINSTEIN], [DELPHI], [THF]
 *   - aftrmath.ini [SHOK], [MECH], [E3] (override), [DOG] (override)
 *   - idata.cpp — infantry type class defaults (IsFraidyCat, IsCanine, etc.)
 *   - infantry.h — InfantryTypeClass fields (C4, Infiltrate, Crushable, etc.)
 *
 * DO NOT modify engine code to make these pass. Failures document real C++ divergences.
 */

import { describe, it, expect } from 'vitest';
import { UNIT_STATS, SUB_CELL_OFFSETS, type UnitStats } from '../engine/types';

// ============================================================================
// Helper: verify a single infantry stat field
// ============================================================================
function expectStat(unitId: string, field: keyof UnitStats, expected: unknown, cppRef: string) {
  const stats = UNIT_STATS[unitId];
  expect(stats, `UNIT_STATS['${unitId}'] must exist`).toBeDefined();
  expect(stats[field]).toBe(expected);
}

// ============================================================================
// 1. All infantry stats vs INI — comprehensive per-unit verification
// ============================================================================

describe('cpp-parity: infantry stats vs rules.ini', () => {
  // ---- E1 (Rifle Infantry) ----
  // rules.ini [E1]: Primary=M1Carbine, Strength=50, Armor=none, TechLevel=1,
  //   Sight=4, Speed=4, Owner=allies,soviet, Cost=100
  describe('E1 (Rifle Infantry)', () => {
    it('Strength=50 (rules.ini line 798)', () => expectStat('E1', 'strength', 50, 'rules.ini:798'));
    it('Armor=none (rules.ini line 799)', () => expectStat('E1', 'armor', 'none', 'rules.ini:799'));
    it('Speed=4 (rules.ini line 802)', () => expectStat('E1', 'speed', 4, 'rules.ini:802'));
    it('Sight=4 (rules.ini line 801)', () => expectStat('E1', 'sight', 4, 'rules.ini:801'));
    it('Primary=M1Carbine (rules.ini line 797)', () => expectStat('E1', 'primaryWeapon', 'M1Carbine', 'rules.ini:797'));
    it('Cost=100 (rules.ini line 805)', () => expectStat('E1', 'cost', 100, 'rules.ini:805'));
    it('isInfantry=true', () => expectStat('E1', 'isInfantry', true, 'idata.cpp'));
    it('crushable=true (all infantry crushable by default)', () => expectStat('E1', 'crushable', true, 'infantry.h'));
  });

  // ---- E2 (Grenadier) ----
  // rules.ini [E2]: Primary=Grenade, Strength=50, Armor=none, TechLevel=1,
  //   Sight=4, Speed=5, Owner=soviet, Cost=160, Explodes=yes
  describe('E2 (Grenadier)', () => {
    it('Strength=50 (rules.ini line 810)', () => expectStat('E2', 'strength', 50, 'rules.ini:810'));
    it('Armor=none (rules.ini line 811)', () => expectStat('E2', 'armor', 'none', 'rules.ini:811'));
    it('Speed=5 (rules.ini line 814)', () => expectStat('E2', 'speed', 5, 'rules.ini:814'));
    it('Sight=4 (rules.ini line 813)', () => expectStat('E2', 'sight', 4, 'rules.ini:813'));
    it('Primary=Grenade (rules.ini line 809)', () => expectStat('E2', 'primaryWeapon', 'Grenade', 'rules.ini:809'));
    it('Owner=soviet (rules.ini line 815)', () => expectStat('E2', 'owner', 'soviet', 'rules.ini:815'));
    it('Cost=160 (rules.ini line 816)', () => expectStat('E2', 'cost', 160, 'rules.ini:816'));
    it('crushable=true', () => expectStat('E2', 'crushable', true, 'infantry.h'));
  });

  // ---- E3 (Rocket Soldier) ---- CRITICAL: weapon order audit
  // rules.ini [E3]: Primary=RedEye, Secondary=Dragon
  // aftrmath.ini [E3]: Primary=RedEye, Secondary=Dragon (confirms same order)
  // C++ idata.cpp: INFANTRY_E3 weapon assignments match INI
  describe('E3 (Rocket Soldier)', () => {
    it('Strength=45 (rules.ini line 824)', () => expectStat('E3', 'strength', 45, 'rules.ini:824'));
    it('Armor=none (rules.ini line 825)', () => expectStat('E3', 'armor', 'none', 'rules.ini:825'));
    it('Speed=3 (rules.ini line 828)', () => expectStat('E3', 'speed', 3, 'rules.ini:828'));
    it('Sight=4 (rules.ini line 827)', () => expectStat('E3', 'sight', 4, 'rules.ini:827'));
    it('Cost=300 (rules.ini line 830)', () => expectStat('E3', 'cost', 300, 'rules.ini:830'));
    it('Owner=allied (rules.ini line 829: Owner=allies)', () => expectStat('E3', 'owner', 'allied', 'rules.ini:829'));
    it('crushable=true', () => expectStat('E3', 'crushable', true, 'infantry.h'));
  });

  // ---- E3 weapon order (CRITICAL audit) ----
  // Both rules.ini and aftrmath.ini: Primary=RedEye, Secondary=Dragon
  // RedEye is AA-only (AG=no in [AAMissile] projectile), Dragon is anti-ground
  // This means E3 primary is the AA weapon, secondary is the ground weapon.
  describe('E3 weapon order (CRITICAL — selectWeapon logic depends on this)', () => {
    it('Primary=RedEye (rules.ini: Primary=RedEye — AA-only missile)', () => {
      expectStat('E3', 'primaryWeapon', 'RedEye', 'rules.ini:822 + aftrmath.ini:476');
    });
    it('Secondary=Dragon (rules.ini: Secondary=Dragon — anti-ground/air homing)', () => {
      expectStat('E3', 'secondaryWeapon', 'Dragon', 'rules.ini:823 + aftrmath.ini:477');
    });
    it('RedEye is AA-only (isAntiGround=false in WEAPON_STATS)', () => {
      // If this fails, E3 would fire the AA missile at ground targets
      const { WEAPON_STATS } = require('../engine/types');
      expect(WEAPON_STATS.RedEye.isAntiGround).toBe(false);
    });
    it('Dragon can target ground (no isAntiGround=false restriction)', () => {
      const { WEAPON_STATS } = require('../engine/types');
      // Dragon should be able to hit ground targets (default isAntiGround is undefined/true)
      expect(WEAPON_STATS.Dragon.isAntiGround).not.toBe(false);
    });
  });

  // ---- E4 (Flamethrower) ----
  // rules.ini [E4]: Prerequisite=stek, Primary=Flamer, Strength=40, Armor=none,
  //   TechLevel=6, Sight=4, Speed=3, Owner=soviet, Cost=300, Explodes=yes
  describe('E4 (Flamethrower)', () => {
    it('Strength=40 (rules.ini line 838)', () => expectStat('E4', 'strength', 40, 'rules.ini:838'));
    it('Armor=none (rules.ini line 839)', () => expectStat('E4', 'armor', 'none', 'rules.ini:839'));
    it('Speed=3 (rules.ini line 842)', () => expectStat('E4', 'speed', 3, 'rules.ini:842'));
    it('Sight=4 (rules.ini line 841)', () => expectStat('E4', 'sight', 4, 'rules.ini:841'));
    it('Primary=Flamer (rules.ini line 837)', () => expectStat('E4', 'primaryWeapon', 'Flamer', 'rules.ini:837'));
    it('Cost=300 (rules.ini line 845)', () => expectStat('E4', 'cost', 300, 'rules.ini:845'));
    it('crushable=true', () => expectStat('E4', 'crushable', true, 'infantry.h'));
  });

  // ---- E6 (Engineer) ----
  // rules.ini [E6]: Strength=25, Armor=none, TechLevel=5, Sight=4, Speed=4,
  //   Owner=soviet,allies, Cost=500, Infiltrate=yes (no weapon)
  describe('E6 (Engineer)', () => {
    it('Strength=25 (rules.ini line 850)', () => expectStat('E6', 'strength', 25, 'rules.ini:850'));
    it('Armor=none (rules.ini line 851)', () => expectStat('E6', 'armor', 'none', 'rules.ini:851'));
    it('Speed=4 (rules.ini line 854)', () => expectStat('E6', 'speed', 4, 'rules.ini:854'));
    it('Sight=4 (rules.ini line 853)', () => expectStat('E6', 'sight', 4, 'rules.ini:853'));
    it('no weapon (rules.ini: no Primary)', () => expectStat('E6', 'primaryWeapon', null, 'rules.ini'));
    it('Cost=500 (rules.ini line 856)', () => expectStat('E6', 'cost', 500, 'rules.ini:856'));
    it('crushable=true', () => expectStat('E6', 'crushable', true, 'infantry.h'));
  });

  // ---- E7 (Tanya) ----
  // rules.ini [E7]: Prerequisite=atek, Primary=Colt45, Secondary=Colt45,
  //   Strength=100, Armor=none, TechLevel=11, Sight=6, Speed=5,
  //   Owner=allies,soviet, Cost=1200, Infiltrate=yes, C4=yes, DoubleOwned=yes
  describe('E7 (Tanya)', () => {
    it('Strength=100 (rules.ini line 891)', () => expectStat('E7', 'strength', 100, 'rules.ini:891'));
    it('Armor=none (rules.ini line 892)', () => expectStat('E7', 'armor', 'none', 'rules.ini:892'));
    it('Speed=5 (rules.ini line 895)', () => expectStat('E7', 'speed', 5, 'rules.ini:895'));
    it('Sight=6 (rules.ini line 894)', () => expectStat('E7', 'sight', 6, 'rules.ini:894'));
    it('Primary=Colt45 (rules.ini line 889)', () => expectStat('E7', 'primaryWeapon', 'Colt45', 'rules.ini:889'));
    it('Secondary=Colt45 (rules.ini line 890)', () => expectStat('E7', 'secondaryWeapon', 'Colt45', 'rules.ini:890'));
    it('Owner=both (rules.ini line 896: Owner=allies,soviet)', () => expectStat('E7', 'owner', 'both', 'rules.ini:896'));
    it('Cost=1200 (rules.ini line 897)', () => expectStat('E7', 'cost', 1200, 'rules.ini:897'));
    it('crushable=true', () => expectStat('E7', 'crushable', true, 'infantry.h'));
  });

  // ---- DOG (Attack Dog) ----
  // rules.ini [DOG]: Prerequisite=kenn, Primary=DogJaw, Strength=12, Armor=none,
  //   TechLevel=3, Sight=5, Speed=4, Owner=soviet, Cost=200, IsCanine=yes, GuardRange=7
  // NOTE: rules.ini has Strength=12 (;Strength=5 is commented out) and Speed=4
  describe('DOG (Attack Dog)', () => {
    it('Strength=12 (rules.ini line 783 — active value, ;Strength=5 is commented out)', () =>
      expectStat('DOG', 'strength', 12, 'rules.ini:783'));
    it('Armor=none (rules.ini line 785)', () => expectStat('DOG', 'armor', 'none', 'rules.ini:785'));
    it('Speed=4 (rules.ini line 788)', () => expectStat('DOG', 'speed', 4, 'rules.ini:788'));
    it('Sight=5 (rules.ini line 787)', () => expectStat('DOG', 'sight', 5, 'rules.ini:787'));
    it('Primary=DogJaw (rules.ini line 782)', () => expectStat('DOG', 'primaryWeapon', 'DogJaw', 'rules.ini:782'));
    it('Cost=200 (rules.ini line 790)', () => expectStat('DOG', 'cost', 200, 'rules.ini:790'));
    it('crushable=true (dogs are crushable)', () => expectStat('DOG', 'crushable', true, 'infantry.h'));
  });

  // ---- SPY ----
  // rules.ini [SPY]: Prerequisite=dome, Strength=25, Armor=none, TechLevel=6,
  //   Sight=5, Speed=4, Owner=allies, Cost=500, Infiltrate=yes
  describe('SPY', () => {
    it('Strength=25 (rules.ini line 863)', () => expectStat('SPY', 'strength', 25, 'rules.ini:863'));
    it('Armor=none (rules.ini line 864)', () => expectStat('SPY', 'armor', 'none', 'rules.ini:864'));
    it('Speed=4 (rules.ini line 867)', () => expectStat('SPY', 'speed', 4, 'rules.ini:867'));
    it('Sight=5 (rules.ini line 866)', () => expectStat('SPY', 'sight', 5, 'rules.ini:866'));
    it('no combat weapon (rules.ini: no Primary)', () => expectStat('SPY', 'primaryWeapon', null, 'rules.ini'));
    it('Cost=500 (rules.ini line 869)', () => expectStat('SPY', 'cost', 500, 'rules.ini:869'));
    it('crushable=true', () => expectStat('SPY', 'crushable', true, 'infantry.h'));
  });

  // ---- MEDI (Field Medic) ----
  // rules.ini [MEDI]: Primary=Heal, Strength=80, Armor=none, TechLevel=2,
  //   Sight=3, Speed=4, Owner=allies, Cost=800
  describe('MEDI (Field Medic)', () => {
    it('Strength=80 (rules.ini line 906)', () => expectStat('MEDI', 'strength', 80, 'rules.ini:906'));
    it('Armor=none (rules.ini line 907)', () => expectStat('MEDI', 'armor', 'none', 'rules.ini:907'));
    it('Speed=4 (rules.ini line 910)', () => expectStat('MEDI', 'speed', 4, 'rules.ini:910'));
    it('Sight=3 (rules.ini line 909)', () => expectStat('MEDI', 'sight', 3, 'rules.ini:909'));
    it('Primary=Heal (rules.ini line 905)', () => expectStat('MEDI', 'primaryWeapon', 'Heal', 'rules.ini:905'));
    it('Cost=800 (rules.ini line 912)', () => expectStat('MEDI', 'cost', 800, 'rules.ini:912'));
    it('crushable=true', () => expectStat('MEDI', 'crushable', true, 'infantry.h'));
  });

  // ---- GNRL (Field Marshal / Stavros) ----
  // rules.ini [GNRL]: Primary=Pistol, Strength=80, Armor=none, TechLevel=-1,
  //   Sight=3, Speed=5, Owner=allies,soviet, Cost=0, Infiltrate=yes
  describe('GNRL (Stavros)', () => {
    it('Strength=80 (rules.ini line 918)', () => expectStat('GNRL', 'strength', 80, 'rules.ini:918'));
    it('Armor=none (rules.ini line 919)', () => expectStat('GNRL', 'armor', 'none', 'rules.ini:919'));
    it('Speed=5 (rules.ini line 922)', () => expectStat('GNRL', 'speed', 5, 'rules.ini:922'));
    it('Sight=3 (rules.ini line 921)', () => expectStat('GNRL', 'sight', 3, 'rules.ini:921'));
    it('Primary=Pistol (rules.ini line 917)', () => expectStat('GNRL', 'primaryWeapon', 'Pistol', 'rules.ini:917'));
    it('crushable=true', () => expectStat('GNRL', 'crushable', true, 'infantry.h'));
  });

  // ---- CHAN (Specialist) ----
  // rules.ini [CHAN]: Strength=25, Armor=none, TechLevel=-1, Sight=2, Speed=5,
  //   Owner=allies,soviet, Cost=10 (no weapon)
  describe('CHAN (Specialist)', () => {
    it('Strength=25 (rules.ini line 1080)', () => expectStat('CHAN', 'strength', 25, 'rules.ini:1080'));
    it('Armor=none (rules.ini line 1081)', () => expectStat('CHAN', 'armor', 'none', 'rules.ini:1081'));
    it('Speed=5 (rules.ini line 1084)', () => expectStat('CHAN', 'speed', 5, 'rules.ini:1084'));
    it('Sight=2 (rules.ini line 1083)', () => expectStat('CHAN', 'sight', 2, 'rules.ini:1083'));
    it('no weapon (rules.ini: no Primary)', () => expectStat('CHAN', 'primaryWeapon', null, 'rules.ini'));
    it('crushable=true', () => expectStat('CHAN', 'crushable', true, 'infantry.h'));
  });

  // ---- THF (Thief) ----
  // rules.ini [THF]: Prerequisite=atek, Strength=25, Armor=none, TechLevel=11,
  //   Sight=5, Speed=4, Owner=allies, Cost=500, Infiltrate=yes
  describe('THF (Thief)', () => {
    it('Strength=25 (rules.ini line 876)', () => expectStat('THF', 'strength', 25, 'rules.ini:876'));
    it('Armor=none (rules.ini line 877)', () => expectStat('THF', 'armor', 'none', 'rules.ini:877'));
    it('Speed=4 (rules.ini line 880)', () => expectStat('THF', 'speed', 4, 'rules.ini:880'));
    it('Sight=5 (rules.ini line 879)', () => expectStat('THF', 'sight', 5, 'rules.ini:879'));
    it('no combat weapon (rules.ini: no Primary)', () => expectStat('THF', 'primaryWeapon', null, 'rules.ini'));
    it('Owner=allied (rules.ini line 881: Owner=allies)', () => expectStat('THF', 'owner', 'allied', 'rules.ini:881'));
    it('Cost=500 (rules.ini line 882)', () => expectStat('THF', 'cost', 500, 'rules.ini:882'));
    it('crushable=true', () => expectStat('THF', 'crushable', true, 'infantry.h'));
  });

  // ---- EINSTEIN (Professor Einstein) ----
  // rules.ini [EINSTEIN]: Strength=25, Armor=none, TechLevel=-1, Sight=2,
  //   Speed=5, Owner=allies, Cost=10, Fraidycat=yes
  describe('EINSTEIN', () => {
    it('Strength=25 (rules.ini line 1055)', () => expectStat('EINSTEIN', 'strength', 25, 'rules.ini:1055'));
    it('Armor=none (rules.ini line 1056)', () => expectStat('EINSTEIN', 'armor', 'none', 'rules.ini:1056'));
    it('Speed=5 (rules.ini line 1059)', () => expectStat('EINSTEIN', 'speed', 5, 'rules.ini:1059'));
    it('Sight=2 (rules.ini line 1058)', () => expectStat('EINSTEIN', 'sight', 2, 'rules.ini:1058'));
    it('no weapon', () => expectStat('EINSTEIN', 'primaryWeapon', null, 'rules.ini'));
    it('isFraidyCat=true (rules.ini line 1063)', () => expectStat('EINSTEIN', 'isFraidyCat', true, 'rules.ini:1063'));
    it('crushable=true', () => expectStat('EINSTEIN', 'crushable', true, 'infantry.h'));
  });
});

// ============================================================================
// 2. Aftermath expansion infantry
// ============================================================================

describe('cpp-parity: Aftermath infantry (aftrmath.ini)', () => {
  // ---- SHOK (Shock Trooper) ----
  // aftrmath.ini [SHOK]: Prerequisite=tsla, Primary=PortaTesla, Strength=80,
  //   Armor=none, TechLevel=7, Sight=4, Speed=3, Owner=soviet, Cost=900,
  //   Explodes=no, NoMovingFire=yes, Crushable=no
  describe('SHOK (Shock Trooper)', () => {
    it('Strength=80 (aftrmath.ini line 128)', () => expectStat('SHOK', 'strength', 80, 'aftrmath.ini:128'));
    it('Armor=none (aftrmath.ini line 129)', () => expectStat('SHOK', 'armor', 'none', 'aftrmath.ini:129'));
    it('Speed=3 (aftrmath.ini line 132)', () => expectStat('SHOK', 'speed', 3, 'aftrmath.ini:132'));
    it('Sight=4 (aftrmath.ini line 131)', () => expectStat('SHOK', 'sight', 4, 'aftrmath.ini:131'));
    it('Primary=PortaTesla (aftrmath.ini line 127)', () => expectStat('SHOK', 'primaryWeapon', 'PortaTesla', 'aftrmath.ini:127'));
    it('Cost=900 (aftrmath.ini line 134)', () => expectStat('SHOK', 'cost', 900, 'aftrmath.ini:134'));
    it('Crushable=no (aftrmath.ini line 138 — unique among infantry!)', () =>
      expectStat('SHOK', 'crushable', false, 'aftrmath.ini:138'));
    it('NoMovingFire=yes (aftrmath.ini line 137)', () =>
      expectStat('SHOK', 'noMovingFire', true, 'aftrmath.ini:137'));
  });

  // ---- MECH (Field Mechanic) ----
  // aftrmath.ini [MECH]: Prerequisite=fix, Primary=GoodWrench, Strength=60,
  //   Armor=none, TechLevel=7, Sight=3, Speed=4, Owner=allies, Cost=950
  describe('MECH (Field Mechanic)', () => {
    it('Strength=60 (aftrmath.ini line 144)', () => expectStat('MECH', 'strength', 60, 'aftrmath.ini:144'));
    it('Armor=none (aftrmath.ini line 145)', () => expectStat('MECH', 'armor', 'none', 'aftrmath.ini:145'));
    it('Speed=4 (aftrmath.ini line 148)', () => expectStat('MECH', 'speed', 4, 'aftrmath.ini:148'));
    it('Sight=3 (aftrmath.ini line 147)', () => expectStat('MECH', 'sight', 3, 'aftrmath.ini:147'));
    it('Primary=GoodWrench (aftrmath.ini line 143)', () => expectStat('MECH', 'primaryWeapon', 'GoodWrench', 'aftrmath.ini:143'));
    it('Cost=950 (aftrmath.ini line 150)', () => expectStat('MECH', 'cost', 950, 'aftrmath.ini:150'));
    it('crushable=true (default — no Crushable=no override)', () =>
      expectStat('MECH', 'crushable', true, 'aftrmath.ini'));
  });
});

// ============================================================================
// 3. Tanya special abilities (C++ infantry.h/idata.cpp)
// ============================================================================

describe('cpp-parity: Tanya special abilities', () => {
  // C++ infantry.h: InfantryTypeClass has IsCivilian, IsCanine, C4, Infiltrate
  // rules.ini [E7]: Infiltrate=yes, C4=yes, DoubleOwned=yes
  // idata.cpp:530-531: INFANTRY_TANYA — amphibious (canSwim)

  it('Tanya exists in UNIT_STATS as E7', () => {
    expect(UNIT_STATS.E7).toBeDefined();
    expect(UNIT_STATS.E7.name).toBe('Tanya');
  });

  it('canSwim=true (C++ amphibious flag — idata.cpp:530 Tanya can traverse water)', () => {
    expect(UNIT_STATS.E7.canSwim).toBe(true);
  });

  it('Primary=Colt45 dual pistols (rules.ini line 889: Primary=Colt45)', () => {
    expect(UNIT_STATS.E7.primaryWeapon).toBe('Colt45');
  });

  it('Secondary=Colt45 (rules.ini line 890: Secondary=Colt45)', () => {
    expect(UNIT_STATS.E7.secondaryWeapon).toBe('Colt45');
  });

  // C4 placement: rules.ini C4=yes — UnitStats interface lacks hasC4 / c4 field
  // This documents a missing capability flag on the type system
  it('UnitStats should have a C4/hasC4 boolean (rules.ini C4=yes — C++ infantry.h:IsC4)', () => {
    const e7 = UNIT_STATS.E7 as Record<string, unknown>;
    // C++ infantry.h: bool IsC4; idata.cpp: Tanya has C4=yes
    // If this fails, the TS type system doesn't track C4 ability
    const hasC4Field = 'c4' in e7 || 'hasC4' in e7 || 'C4' in e7;
    expect(hasC4Field).toBe(true);
  });

  // Infiltrate: rules.ini Infiltrate=yes — UnitStats interface lacks infiltrate field
  it('UnitStats should have an infiltrate boolean (rules.ini Infiltrate=yes — C++ infantry.h:IsInfiltrate)', () => {
    const e7 = UNIT_STATS.E7 as Record<string, unknown>;
    const hasInfiltrateField = 'infiltrate' in e7 || 'isInfiltrate' in e7 || 'canInfiltrate' in e7;
    expect(hasInfiltrateField).toBe(true);
  });
});

// ============================================================================
// 4. Dog speed audit
// ============================================================================

describe('cpp-parity: Dog speed and special properties', () => {
  // rules.ini [DOG]: Speed=4 (NOT 12 as some documentation claims)
  // The ;Strength=5 line is commented out; active Strength=12
  // aftrmath.ini [DOG]: confirms Speed=4, Strength=12

  it('DOG Speed=4 (rules.ini line 788 — infantry speed, not vehicle speed)', () => {
    expect(UNIT_STATS.DOG.speed).toBe(4);
  });

  it('DOG Strength=12 (rules.ini line 783 — ;Strength=5 is COMMENTED OUT)', () => {
    expect(UNIT_STATS.DOG.strength).toBe(12);
  });

  // C++ IsCanine flag — rules.ini IsCanine=yes
  // The UnitStats interface does not have an isCanine field
  it('UnitStats should have isCanine boolean (rules.ini IsCanine=yes — C++ infantry.h:IsCanine)', () => {
    const dog = UNIT_STATS.DOG as Record<string, unknown>;
    const hasCanineField = 'isCanine' in dog || 'IsCanine' in dog;
    expect(hasCanineField).toBe(true);
  });

  it('DOG GuardRange=7 (rules.ini line 793: GuardRange=7)', () => {
    const dog = UNIT_STATS.DOG;
    // C++ guard range for dogs is 7 cells (more aggressive patrolling)
    expect(dog.guardRange).toBe(7);
  });

  it('DOG should be faster than standard infantry in game terms', () => {
    // While DOG INI Speed=4 equals E1 Speed=4, in C++ idata.cpp the dog
    // has MPH_MEDIUM_FAST=14 — same as E1's MPH_KINDA_SLOW=4
    // The rules.ini Speed= field maps to different MPH constants per unit type
    // This test verifies the TS speed value represents the same relative speed
    expect(UNIT_STATS.DOG.speed).toBeGreaterThanOrEqual(UNIT_STATS.E1.speed);
  });
});

// ============================================================================
// 5. Civilian IsFraidyCat audit
// ============================================================================

describe('cpp-parity: all C1-C10 civilians have IsFraidyCat=true', () => {
  const civilians = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10'];

  for (const id of civilians) {
    it(`${id} has isFraidyCat=true (rules.ini: Fraidycat=yes)`, () => {
      const stats = UNIT_STATS[id];
      expect(stats, `UNIT_STATS['${id}'] must exist`).toBeDefined();
      expect(stats.isFraidyCat).toBe(true);
    });

    it(`${id} Strength=25 (rules.ini)`, () => {
      expect(UNIT_STATS[id].strength).toBe(25);
    });

    it(`${id} Speed=5 (rules.ini)`, () => {
      expect(UNIT_STATS[id].speed).toBe(5);
    });

    it(`${id} Armor=none (rules.ini)`, () => {
      expect(UNIT_STATS[id].armor).toBe('none');
    });

    it(`${id} Sight=2 (rules.ini)`, () => {
      expect(UNIT_STATS[id].sight).toBe(2);
    });

    it(`${id} crushable=true`, () => {
      expect(UNIT_STATS[id].crushable).toBe(true);
    });
  }

  // EINSTEIN also has Fraidycat=yes
  it('EINSTEIN has isFraidyCat=true (rules.ini line 1063: Fraidycat=yes)', () => {
    expect(UNIT_STATS.EINSTEIN.isFraidyCat).toBe(true);
  });
});

// ============================================================================
// 6. Civilian weapon audit
// ============================================================================

describe('cpp-parity: civilian weapon assignments', () => {
  // rules.ini: C1 has Primary=Pistol + Ammo=10, C7 has Primary=Pistol + Ammo=10
  // All other civilians (C2-C6, C8-C10) have no weapon in rules.ini
  // aftrmath.ini overrides: C2 Primary=none, C3 Primary=none, C6 Primary=none, C9 Primary=none

  it('C1 has Primary=Pistol (rules.ini line 931)', () => {
    expect(UNIT_STATS.C1.primaryWeapon).toBe('Pistol');
  });

  it('C1 has maxAmmo=10 (rules.ini line 940: Ammo=10)', () => {
    expect(UNIT_STATS.C1.maxAmmo).toBe(10);
  });

  it('C7 has Primary=Pistol (rules.ini line 1005)', () => {
    expect(UNIT_STATS.C7.primaryWeapon).toBe('Pistol');
  });

  it('C7 has maxAmmo=10 (rules.ini line 1014: Ammo=10)', () => {
    expect(UNIT_STATS.C7.maxAmmo).toBe(10);
  });

  // C2-C6, C8-C10 should have no weapon
  for (const id of ['C2', 'C3', 'C4', 'C5', 'C6', 'C8', 'C9', 'C10']) {
    it(`${id} has no weapon (rules.ini: no Primary or aftrmath.ini Primary=none)`, () => {
      expect(UNIT_STATS[id].primaryWeapon).toBeNull();
    });
  }
});

// ============================================================================
// 7. Infantry subcell positions (5 positions per cell)
// ============================================================================

describe('cpp-parity: infantry subcell positions', () => {
  // C++ infantry.cpp / cell.cpp: infantry occupy sub-cell positions within a cell
  // 5 positions: center (0) + 4 corners (1-4)
  // This enables multiple infantry to share a single cell

  it('SUB_CELL_OFFSETS has exactly 5 positions (center + 4 corners)', () => {
    expect(SUB_CELL_OFFSETS).toHaveLength(5);
  });

  it('position 0 is center (0,0)', () => {
    expect(SUB_CELL_OFFSETS[0]).toEqual({ x: 0, y: 0 });
  });

  it('positions 1-4 are corner offsets (non-zero x and y)', () => {
    for (let i = 1; i <= 4; i++) {
      expect(SUB_CELL_OFFSETS[i].x).not.toBe(0);
      expect(SUB_CELL_OFFSETS[i].y).not.toBe(0);
    }
  });

  it('corner offsets are symmetric (equal magnitude)', () => {
    const magnitudes = SUB_CELL_OFFSETS.slice(1).map(o => Math.abs(o.x) + Math.abs(o.y));
    // All corners should have the same total offset magnitude
    const first = magnitudes[0];
    for (const m of magnitudes) {
      expect(m).toBe(first);
    }
  });
});

// ============================================================================
// 8. Missing infantry type flags audit
// ============================================================================

describe('cpp-parity: missing UnitStats fields vs C++ infantry.h', () => {
  // C++ InfantryTypeClass has several boolean fields that UnitStats may lack.
  // These tests document which C++ capabilities are NOT tracked in TS.

  // C++ infantry.h: bool IsInfiltrate — spy/engineer/thief can enter buildings
  // rules.ini: E6 Infiltrate=yes, SPY Infiltrate=yes, THF Infiltrate=yes, E7 Infiltrate=yes
  const infiltrators = ['E6', 'SPY', 'THF', 'E7'];
  for (const id of infiltrators) {
    it(`${id} should track infiltrate capability (rules.ini Infiltrate=yes)`, () => {
      const unit = UNIT_STATS[id] as Record<string, unknown>;
      const hasField = 'infiltrate' in unit || 'isInfiltrate' in unit || 'canInfiltrate' in unit;
      expect(hasField).toBe(true);
    });
  }

  // C++ infantry.h: bool IsCivilian — C1-C10 are civilian type (affects targeting, scoring)
  it('civilian type should be distinguishable from military infantry', () => {
    const c1 = UNIT_STATS.C1 as Record<string, unknown>;
    // Either isCivilian, or isFraidyCat can serve as distinguisher
    const isCivilian = 'isCivilian' in c1 || c1.isFraidyCat === true;
    expect(isCivilian).toBe(true);
  });

  // E2 and E4 have Explodes=yes — they explode on death (grenadier/flamethrower)
  for (const id of ['E2', 'E4']) {
    it(`${id} should track Explodes=yes (rules.ini) — explodes on death`, () => {
      const unit = UNIT_STATS[id] as Record<string, unknown>;
      const hasField = 'explodes' in unit || 'isExploding' in unit || 'explodesOnDeath' in unit;
      expect(hasField).toBe(true);
    });
  }
});

// ============================================================================
// 9. Cost and owner completeness check
// ============================================================================

describe('cpp-parity: infantry cost and owner fields populated', () => {
  // Many infantry entries in UNIT_STATS lack cost/owner fields.
  // In C++, every unit type has a defined cost and owner list.
  // Missing cost/owner means production logic can't properly gate these units.

  const infantryWithCosts: [string, number][] = [
    ['E1', 100],
    ['E2', 160],
    ['E3', 300],
    ['E4', 300],
    ['E6', 500],
    ['E7', 1200],
    ['DOG', 200],
    ['SPY', 500],
    ['MEDI', 800],
    ['THF', 500],
    ['SHOK', 900],
    ['MECH', 950],
  ];

  for (const [id, expectedCost] of infantryWithCosts) {
    it(`${id} cost=${expectedCost} (rules.ini/aftrmath.ini)`, () => {
      const stats = UNIT_STATS[id];
      expect(stats.cost).toBe(expectedCost);
    });
  }

  const infantryOwners: [string, string][] = [
    // Owner field uses 'allied', 'soviet', or 'both'
    ['E1', 'both'],       // Owner=allies,soviet → 'both'
    ['E2', 'soviet'],     // Owner=soviet
    ['E3', 'allied'],     // Owner=allies (DoubleOwned=yes but Owner field is allies)
    ['E4', 'soviet'],     // Owner=soviet
    ['E6', 'both'],       // Owner=soviet,allies → 'both'
    ['E7', 'both'],       // Owner=allies,soviet → 'both'
    ['DOG', 'soviet'],    // Owner=soviet
    ['SPY', 'allied'],    // Owner=allies
    ['MEDI', 'allied'],   // Owner=allies
    ['THF', 'allied'],    // Owner=allies
    ['SHOK', 'soviet'],   // Owner=soviet
    ['MECH', 'allied'],   // Owner=allies
  ];

  for (const [id, expectedOwner] of infantryOwners) {
    it(`${id} owner=${expectedOwner} (rules.ini)`, () => {
      const stats = UNIT_STATS[id];
      expect(stats.owner).toBe(expectedOwner);
    });
  }
});
