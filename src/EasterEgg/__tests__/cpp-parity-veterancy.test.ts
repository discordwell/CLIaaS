/**
 * C++ Behavioral Parity Tests — Veterancy / Experience System
 *
 * Red Alert 1 does NOT have a full veterancy/promotion system with stat bonuses.
 * That was introduced in Tiberian Sun / RA2. In RA1, kills are tracked on units
 * (Crew.Kills in C++) but they confer NO stat bonuses — no firepower, armor,
 * speed, ROF, or sight improvements from kills.
 *
 * What C++ RA1 DOES have:
 *   1. Kill tracking: crew.h Made_A_Kill() increments Crew.Kills
 *      NOTE: In C++, Record_The_Kill(source) at techno.cpp:3904 calls
 *      this->Crew.Made_A_Kill() on the DYING unit (a no-op since it's destroyed).
 *      The killer is NOT credited. The TS port credits the killer instead,
 *      which makes the AI threat scoring at line 1652 actually meaningful.
 *   2. Kill-weighted target value: techno.cpp:1651 Value() + Crew.Kills for AI threat
 *   3. "Veterancy" crate: Not in Counterstrike/Aftermath crate enum (defines.h:759-781).
 *      TS maps the name 'veterancy' -> 'heal' in CRATE_NAME_MAP.
 *
 * What C++ RA1 does NOT have:
 *   - Veteran/Elite promotion thresholds
 *   - Stat bonuses from kills (firepower, armor, speed, ROF, sight)
 *   - VeteranRatio, VeteranCombat, VeteranSpeed, VeteranSight, VeteranArmor, VeteranROF
 *   - Visual rank insignia or promotion audio cues
 *   - Any rules.ini keys related to veterancy bonuses
 *
 * Failing tests are EXPECTED — they document real C++ divergences.
 *
 * C++ source references:
 *   crew.h:53               — CrewClass: unsigned short Kills; no rank/level
 *   crew.h:62-64            — Made_A_Kill(): Kills++ and return
 *   techno.cpp:3886-3904   — Record_The_Kill(source): calls this->Crew.Made_A_Kill()
 *                             on the DYING unit (effectively dead code)
 *   techno.cpp:1651-1652   — Best_Object threat: value = rawval + object->Crew.Kills
 *   techno.cpp:4519         — Value() = Risk() + Reward (no veterancy modifier)
 *   techno.cpp:6290         — Risk = Reward = Points (from RULES.INI "Points=")
 *   defines.h:759-781       — CrateType enum: NO CRATE_EXPERIENCE in CS/AM source
 *   rules.ini [General]     — No veteran-related keys exist in RA1
 *   rules.ini [IQ]          — AI intelligence levels, no veterancy
 */

import { describe, it, expect } from 'vitest';
import { Entity } from '../engine/entity';
import { CRATE_NAME_MAP } from '../engine/crates';
import {
  UnitType, House, UNIT_STATS, CELL_SIZE,
} from '../engine/types';

// ══════════════════════════════════════════════════════════════════════════════
// Helper: create a minimal entity for testing
// ══════════════════════════════════════════════════════════════════════════════

function makeEntity(type: UnitType, house: House = House.GoodGuy): Entity {
  const stats = UNIT_STATS[type];
  if (!stats) throw new Error(`No stats for ${type}`);
  const e = new Entity(
    1, type, stats, house,
    { x: CELL_SIZE * 10, y: CELL_SIZE * 10 },
    0,
  );
  return e;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Kill Tracking — C++ techno.cpp Crew.Kills
// ══════════════════════════════════════════════════════════════════════════════

describe('cpp-parity: veterancy — kill tracking', () => {
  it('Entity starts with zero kills (C++ CrewClass default)', () => {
    // C++ crew.h: CrewClass constructor initializes Kills=0
    const tank = makeEntity(UnitType.V_4TNK);
    expect(tank.kills).toBe(0);
  });

  it('creditKill increments kill counter by 1 (C++ crew.h Made_A_Kill)', () => {
    // C++ crew.h:62-64: Made_A_Kill() { Kills++; return(Kills); }
    const tank = makeEntity(UnitType.V_4TNK);
    tank.creditKill();
    expect(tank.kills).toBe(1);
    tank.creditKill();
    tank.creditKill();
    expect(tank.kills).toBe(3);
  });

  it('kills counter has no upper bound / cap in C++', () => {
    // C++ Crew.Kills is an int with no cap. Verify TS doesn't cap it.
    const tank = makeEntity(UnitType.V_4TNK);
    for (let i = 0; i < 100; i++) tank.creditKill();
    expect(tank.kills).toBe(100);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. No Stat Bonuses From Kills — RA1 has NO veterancy promotion
// ══════════════════════════════════════════════════════════════════════════════

describe('cpp-parity: veterancy — no stat bonuses from kills (RA1 has no promotion system)', () => {
  /**
   * In C++ RA1, accumulating kills does NOT change:
   *   - Firepower (no FirepowerBias change from kills)
   *   - Armor (no ArmorBias change from kills)
   *   - Speed (no SpeedBias change from kills)
   *   - Rate of Fire (no ROF modification from kills)
   *   - Sight range (no sight bonus from kills)
   *
   * These biases CAN be changed by crate pickups, but never by kill count.
   */

  it('firepower bias remains 1.0 after many kills', () => {
    const tank = makeEntity(UnitType.V_4TNK);
    const originalBias = tank.firepowerBias;
    for (let i = 0; i < 50; i++) tank.creditKill();
    expect(tank.firepowerBias).toBe(originalBias);
    expect(tank.firepowerBias).toBe(1.0);
  });

  it('armor bias remains 1.0 after many kills', () => {
    const tank = makeEntity(UnitType.V_4TNK);
    const originalBias = tank.armorBias;
    for (let i = 0; i < 50; i++) tank.creditKill();
    expect(tank.armorBias).toBe(originalBias);
    expect(tank.armorBias).toBe(1.0);
  });

  it('speed bias remains 1.0 after many kills', () => {
    const tank = makeEntity(UnitType.V_4TNK);
    const originalBias = tank.speedBias;
    for (let i = 0; i < 50; i++) tank.creditKill();
    expect(tank.speedBias).toBe(originalBias);
    expect(tank.speedBias).toBe(1.0);
  });

  it('weapon damage is unchanged by kills (no firepower multiplier from veterancy)', () => {
    // C++ techno.cpp Fire_At: damage = weapon->Attack, no veteran modifier
    const tank = makeEntity(UnitType.V_4TNK);
    const weaponDamage = tank.weapon?.damage;
    expect(weaponDamage).toBeDefined();
    for (let i = 0; i < 50; i++) tank.creditKill();
    expect(tank.weapon?.damage).toBe(weaponDamage);
  });

  it('sight range is unchanged by kills', () => {
    const tank = makeEntity(UnitType.V_4TNK);
    const sight = tank.stats.sight;
    for (let i = 0; i < 50; i++) tank.creditKill();
    expect(tank.stats.sight).toBe(sight);
  });

  it('hit points / max HP are unchanged by kills', () => {
    const tank = makeEntity(UnitType.V_4TNK);
    const maxHp = tank.maxHp;
    const hp = tank.hp;
    for (let i = 0; i < 50; i++) tank.creditKill();
    expect(tank.maxHp).toBe(maxHp);
    expect(tank.hp).toBe(hp);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. No Veterancy Rank/Level Property — RA1 has no promotion tiers
// ══════════════════════════════════════════════════════════════════════════════

describe('cpp-parity: veterancy — no rank/level/promotion properties', () => {
  it('Entity has no "rank" or "level" or "veteranLevel" property', () => {
    // C++ RA1 CrewClass has only Kills, no rank field.
    // Tiberian Sun introduced VeteranLevel. RA1 should not have it.
    const tank = makeEntity(UnitType.V_4TNK) as Record<string, unknown>;
    expect(tank['rank']).toBeUndefined();
    expect(tank['level']).toBeUndefined();
    expect(tank['veteranLevel']).toBeUndefined();
    expect(tank['veterancy']).toBeUndefined();
    expect(tank['experience']).toBeUndefined();
    expect(tank['xp']).toBeUndefined();
    expect(tank['promotionLevel']).toBeUndefined();
  });

  it('Entity has no "isVeteran" or "isElite" flag', () => {
    const tank = makeEntity(UnitType.V_4TNK) as Record<string, unknown>;
    expect(tank['isVeteran']).toBeUndefined();
    expect(tank['isElite']).toBeUndefined();
    expect(tank['promoted']).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. "Veterancy" Crate — Maps to Heal, Not Promotion
// ══════════════════════════════════════════════════════════════════════════════

describe('cpp-parity: veterancy — crate type mapping', () => {
  it('"veterancy" crate name maps to heal effect (no CRATE_EXPERIENCE in CS/AM)', () => {
    // C++ defines.h:759-781: CrateType enum has no CRATE_EXPERIENCE in Counterstrike/Aftermath
    // TS maps the legacy name 'veterancy' -> 'heal' in CRATE_NAME_MAP
    expect(CRATE_NAME_MAP['veterancy']).toBe('heal');
  });

  it('no dedicated "veterancy" or "experience" or "promotion" crate type exists', () => {
    // C++ CS/AM crate enum has no CRATE_EXPERIENCE entry.
    // TS should not have a separate 'veterancy' crate type — it maps to 'heal'.
    const crateTypes = new Set(Object.values(CRATE_NAME_MAP));
    expect(crateTypes.has('veterancy')).toBe(false);
    expect(crateTypes.has('experience')).toBe(false);
    expect(crateTypes.has('promotion')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. Kill Count Affects AI Target Value — C++ techno.cpp:1651
// ══════════════════════════════════════════════════════════════════════════════

describe('cpp-parity: veterancy — kills affect target threat value', () => {
  it('C++ Best_Object uses Value() + Crew.Kills for threat scoring', () => {
    // C++ techno.cpp:1651-1652:
    //   int value = object->Value() + object->Crew.Kills;
    //   Value() = Risk() + Reward = 2 * Points
    //
    // Verify TS entity.ts threatScore uses kills in value calculation.
    // The entity.ts line 835: let value = Math.trunc(points * 2) + target.kills;
    //
    // We can't call threatScore directly without a scanner, but we verify
    // the kills property is a plain number that the scoring formula can read.
    const tank = makeEntity(UnitType.V_4TNK);
    expect(typeof tank.kills).toBe('number');
    tank.creditKill();
    tank.creditKill();
    tank.creditKill();
    expect(tank.kills).toBe(3);
    // A unit with kills should be a higher-value target (kills add to Value())
    // This is behavioral documentation: kills make the unit more "valuable" as a target
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. rules.ini Has No Veterancy-Related Keys
// ══════════════════════════════════════════════════════════════════════════════

describe('cpp-parity: veterancy — rules.ini contains no veterancy config', () => {
  /**
   * RA1 rules.ini does NOT contain any of the Tiberian Sun / RA2 veterancy keys:
   *   - VeteranRatio (TS: kill threshold for promotion)
   *   - VeteranCombat (TS: firepower multiplier for veterans)
   *   - VeteranSpeed (TS: speed multiplier for veterans)
   *   - VeteranSight (TS: sight bonus for veterans)
   *   - VeteranArmor (TS: armor multiplier for veterans)
   *   - VeteranROF (TS: rate-of-fire multiplier for veterans)
   *
   * This is documentation only — we test that the TS engine does not
   * read or apply any such keys from the unit stats.
   */

  it('UNIT_STATS entries have no veterancy-related stat fields', () => {
    // Check a representative sample of unit types
    const sampleTypes = [
      UnitType.V_4TNK, UnitType.V_3TNK, UnitType.V_2TNK, UnitType.V_1TNK,
      UnitType.I_E1, UnitType.I_E2, UnitType.I_E3, UnitType.I_E4,
    ];
    for (const unitType of sampleTypes) {
      const stats = UNIT_STATS[unitType] as Record<string, unknown>;
      if (!stats) continue;
      expect(stats['veteranRatio'], `${unitType} should not have veteranRatio`).toBeUndefined();
      expect(stats['veteranCombat'], `${unitType} should not have veteranCombat`).toBeUndefined();
      expect(stats['veteranSpeed'], `${unitType} should not have veteranSpeed`).toBeUndefined();
      expect(stats['veteranSight'], `${unitType} should not have veteranSight`).toBeUndefined();
      expect(stats['veteranArmor'], `${unitType} should not have veteranArmor`).toBeUndefined();
      expect(stats['veteranROF'], `${unitType} should not have veteranROF`).toBeUndefined();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. Infantry and Vehicle Kill Tracking Consistency
// ══════════════════════════════════════════════════════════════════════════════

describe('cpp-parity: veterancy — all unit categories track kills identically', () => {
  it('infantry track kills the same as vehicles (C++ Crew is in TechnoClass base)', () => {
    // C++ CrewClass is a member of TechnoClass, inherited by InfantryClass and UnitClass equally
    const rifle = makeEntity(UnitType.I_E1);
    const tank = makeEntity(UnitType.V_4TNK);
    rifle.creditKill();
    tank.creditKill();
    expect(rifle.kills).toBe(1);
    expect(tank.kills).toBe(1);
    // Both increment identically — no class-specific behavior
  });

  it('creditKill does nothing beyond incrementing the counter', () => {
    // C++ crew.h Made_A_Kill() literally just does Kills++
    // Verify no side effects: HP, biases, weapon stats remain unchanged
    const e1 = makeEntity(UnitType.I_E1);
    const hpBefore = e1.hp;
    const fpBias = e1.firepowerBias;
    const aBias = e1.armorBias;
    const sBias = e1.speedBias;
    const weaponDmg = e1.weapon?.damage;

    e1.creditKill();

    expect(e1.hp).toBe(hpBefore);
    expect(e1.firepowerBias).toBe(fpBias);
    expect(e1.armorBias).toBe(aBias);
    expect(e1.speedBias).toBe(sBias);
    expect(e1.weapon?.damage).toBe(weaponDmg);
    expect(e1.kills).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. IQ System Is Separate From Veterancy
// ══════════════════════════════════════════════════════════════════════════════

describe('cpp-parity: veterancy — IQ system is not veterancy', () => {
  /**
   * rules.ini [IQ] section (line 269-280) controls AI intelligence levels.
   * This is a HOUSE-level setting (MaxIQLevels=5), not a unit-level property.
   * IQ determines which behaviors the AI can use (auto-crush, scatter, etc.)
   * but does NOT provide combat bonuses to individual units.
   *
   * C++ house.h IQLevel: controls AI decision-making complexity
   * This is fundamentally different from Tiberian Sun veterancy which gives
   * per-unit stat bonuses based on kill count.
   */
  it('IQ is not tracked on individual entities', () => {
    const tank = makeEntity(UnitType.V_4TNK) as Record<string, unknown>;
    expect(tank['iq']).toBeUndefined();
    expect(tank['iqLevel']).toBeUndefined();
  });
});
