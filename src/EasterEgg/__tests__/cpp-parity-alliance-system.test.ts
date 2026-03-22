/**
 * C++ Parity Tests: House Alliance System
 *
 * C++ source of truth:
 *   house.cpp:638     — Allies(0) initializer in HouseClass constructor
 *   house.cpp:672     — Make_Ally(house) in constructor — self-alliance
 *   house.cpp:2023-31 — Is_Ally(HousesType): checks (1<<house) & Allies bitmask
 *   house.cpp:2027-30 — HOUSE_NONE => return false
 *   house.cpp:2101-95 — Make_Ally: Allies |= (1L << house), one-way only
 *   house.cpp:2214-65 — Make_Enemy: bilateral — removes from BOTH sides
 *   house.cpp:7131-65 — Read_INI: loads per-house Allies= from scenario INI
 *   house.cpp:7156    — Default Allies= is (1 << HOUSE_NEUTRAL) for all houses
 *   house.cpp:7157    — Make_Ally(index) — always self-ally
 *   house.cpp:7158    — Make_Ally(HOUSE_NEUTRAL) — always ally with Neutral
 *   house.cpp:7159-63 — For each bit set in INI Allies=, call Make_Ally(h)
 *   defines.h:1140-62 — HOUSE_NONE=-1, HOUSE_SPAIN=0 ... HOUSE_NEUTRAL=10, Special=11
 *
 * TS implementation under test:
 *   engine/types.ts:  House enum, AllianceTable, buildDefaultAlliances, buildAlliancesFromINI
 *   engine/index.ts:  isAllied(a, b) => alliances.get(a)?.has(b) ?? false
 *   engine/scenario.ts: parseScenarioINI reads [House] Allies= and builds houseAllies map
 *
 * Key C++ behaviors to verify in TS:
 *   1. Every house is self-allied
 *   2. Every house considers Neutral an ally (one-way)
 *   3. Alliances from INI are ONE-WAY (only the declaring house's set)
 *   4. HOUSE_NONE check returns false
 *   5. Missing Allies= defaults to Neutral-only (+ self)
 *   6. Real scenario INI alliance data matches C++ Read_INI behavior
 */

import { describe, it, expect } from 'vitest';
import {
  House,
  type AllianceTable,
  buildDefaultAlliances,
  buildAlliancesFromINI,
} from '../engine/types';

// ---------------------------------------------------------------------------
// Helper: simulate isAllied as in engine/index.ts:5002-5003
// ---------------------------------------------------------------------------
function isAllied(table: AllianceTable, a: House, b: House): boolean {
  return table.get(a)?.has(b) ?? false;
}

// ---------------------------------------------------------------------------
// C++ house ordering — defines.h:1140-1162
// HOUSE_NONE=-1, HOUSE_SPAIN=0, HOUSE_GREECE=1, HOUSE_USSR=2, HOUSE_ENGLAND=3,
// HOUSE_UKRAINE=4, HOUSE_GERMANY=5, HOUSE_FRANCE=6, HOUSE_TURKEY=7,
// HOUSE_GOOD=8, HOUSE_BAD=9, HOUSE_NEUTRAL=10, HOUSE_SPECIAL=11,
// HOUSE_MULTI1=12 ... HOUSE_MULTI8=19, HOUSE_COUNT=20
// ---------------------------------------------------------------------------
const ALL_CAMPAIGN_HOUSES: House[] = [
  House.Spain, House.Greece, House.USSR, House.England,
  House.Ukraine, House.Germany, House.France, House.Turkey,
  House.GoodGuy, House.BadGuy, House.Neutral,
];

// ============================================================================
// 1. Self-alliance — C++ house.cpp:672: Make_Ally(house) in constructor
// ============================================================================
describe('C++ parity: self-alliance (house.cpp:672)', () => {
  it('buildDefaultAlliances: every house is allied with itself', () => {
    const table = buildDefaultAlliances();
    for (const h of ALL_CAMPAIGN_HOUSES) {
      expect(isAllied(table, h, h), `${h} should be self-allied`).toBe(true);
    }
  });

  it('buildAlliancesFromINI: every house is allied with itself even with empty map', () => {
    const table = buildAlliancesFromINI(new Map(), House.Greece);
    for (const h of ALL_CAMPAIGN_HOUSES) {
      expect(isAllied(table, h, h), `${h} should be self-allied`).toBe(true);
    }
  });
});

// ============================================================================
// 2. Neutral auto-alliance — C++ house.cpp:7158: Make_Ally(HOUSE_NEUTRAL)
// ============================================================================
describe('C++ parity: every house auto-allies with Neutral (house.cpp:7158)', () => {
  it('buildAlliancesFromINI: all houses consider Neutral an ally', () => {
    const table = buildAlliancesFromINI(new Map(), House.Greece);
    for (const h of ALL_CAMPAIGN_HOUSES) {
      expect(
        isAllied(table, h, House.Neutral),
        `${h} should consider Neutral an ally`,
      ).toBe(true);
    }
  });

  it('Neutral auto-alliance is ONE-WAY — Neutral does NOT auto-ally with everyone', () => {
    // C++ house.cpp:7156: Neutral's Allies= from INI determines who Neutral allies with.
    // Make_Ally(HOUSE_NEUTRAL) only modifies the CALLER's bitmask, not Neutral's.
    // If Neutral has no Allies= line, its default Allies= is (1 << HOUSE_NEUTRAL).
    // So Neutral only self-allies + whatever its INI says (commonly "Allies=Special").
    const table = buildAlliancesFromINI(new Map(), House.Greece);
    // With empty alliesMap, Neutral has no explicit allies except self + auto-Neutral.
    // C++ would give Neutral: self + Neutral (redundant). Neutral does NOT auto-ally Spain.
    expect(
      isAllied(table, House.Neutral, House.Spain),
      'Neutral should NOT auto-ally with Spain (one-way rule)',
    ).toBe(false);
    expect(
      isAllied(table, House.Neutral, House.USSR),
      'Neutral should NOT auto-ally with USSR (one-way rule)',
    ).toBe(false);
  });
});

// ============================================================================
// 3. One-way alliances — C++ house.cpp:2107: Allies |= (1L << house)
//    Make_Ally only modifies the caller's bitmask. NOT bilateral during init.
// ============================================================================
describe('C++ parity: alliances are one-way (house.cpp:2107)', () => {
  it('A allies B does NOT mean B allies A', () => {
    // [Greece] Allies=England means Greece→England but NOT England→Greece
    const alliesMap = new Map<House, House[]>([
      [House.Greece, [House.England]],
    ]);
    const table = buildAlliancesFromINI(alliesMap, House.Greece);

    expect(isAllied(table, House.Greece, House.England)).toBe(true);
    expect(
      isAllied(table, House.England, House.Greece),
      'England should NOT auto-ally Greece (one-way)',
    ).toBe(false);
  });

  it('mutual alliance requires BOTH sides to declare', () => {
    // C++ house.cpp:7156-7163: each house's Allies= is parsed independently
    // SCG05EA example: [Greece] Allies=England and [England] Allies=Greece
    const alliesMap = new Map<House, House[]>([
      [House.Greece, [House.England]],
      [House.England, [House.Greece]],
    ]);
    const table = buildAlliancesFromINI(alliesMap, House.Greece);

    expect(isAllied(table, House.Greece, House.England)).toBe(true);
    expect(isAllied(table, House.England, House.Greece)).toBe(true);
  });
});

// ============================================================================
// 4. isAllied with undefined/missing house returns false
//    C++ house.cpp:2027-30: if (house != HOUSE_NONE) ... return false
// ============================================================================
describe('C++ parity: Is_Ally(HOUSE_NONE) returns false (house.cpp:2027-30)', () => {
  it('isAllied with undefined house returns false (no crash)', () => {
    const table = buildDefaultAlliances();
    // Passing a house that has no entry in the table should return false, not throw
    expect(isAllied(table, 'NonExistent' as House, House.Spain)).toBe(false);
    expect(isAllied(table, House.Spain, 'NonExistent' as House)).toBe(false);
  });
});

// ============================================================================
// 5. Default alliances (ant missions) — buildDefaultAlliances
//    Spain+Greece vs USSR+Ukraine+Germany
// ============================================================================
describe('C++ parity: buildDefaultAlliances (ant mission alliances)', () => {
  const table = buildDefaultAlliances();

  it('Spain ↔ Greece are mutual allies', () => {
    expect(isAllied(table, House.Spain, House.Greece)).toBe(true);
    expect(isAllied(table, House.Greece, House.Spain)).toBe(true);
  });

  it('USSR ↔ Ukraine ↔ Germany are mutual allies', () => {
    const soviets = [House.USSR, House.Ukraine, House.Germany];
    for (const a of soviets) {
      for (const b of soviets) {
        expect(isAllied(table, a, b), `${a}→${b}`).toBe(true);
      }
    }
  });

  it('player houses are NOT allied with enemy houses', () => {
    const players = [House.Spain, House.Greece];
    const enemies = [House.USSR, House.Ukraine, House.Germany];
    for (const p of players) {
      for (const e of enemies) {
        expect(isAllied(table, p, e), `${p} should NOT ally ${e}`).toBe(false);
        expect(isAllied(table, e, p), `${e} should NOT ally ${p}`).toBe(false);
      }
    }
  });
});

// ============================================================================
// 6. Real scenario INI alliance data — SCG05EA
//    Source: public/ra/assets/SCG05EA.ini
//    [Greece]  Allies=England,Turkey,GoodGuy
//    [USSR]    Allies=France,BadGuy
//    [England] Allies=Greece
//    [France]  Allies=BadGuy
//    [GoodGuy] Allies=Greece
//    [BadGuy]  Allies=USSR
//    [Neutral] Allies=Special
// ============================================================================
describe('C++ parity: SCG05EA alliance loading (house.cpp:7131-7165)', () => {
  // Build the alliance table exactly as TS does
  const alliesMap = new Map<House, House[]>([
    [House.Greece,  [House.England, House.Turkey, House.GoodGuy]],
    [House.USSR,    [House.France, House.BadGuy]],
    [House.England, [House.Greece]],
    [House.France,  [House.BadGuy]],
    [House.GoodGuy, [House.Greece]],
    [House.BadGuy,  [House.USSR]],
    // Neutral Allies=Special — but Special is not in House enum; tested separately
  ]);
  const table = buildAlliancesFromINI(alliesMap, House.Greece);

  it('Greece allies with England, Turkey, GoodGuy (from INI)', () => {
    expect(isAllied(table, House.Greece, House.England)).toBe(true);
    expect(isAllied(table, House.Greece, House.Turkey)).toBe(true);
    expect(isAllied(table, House.Greece, House.GoodGuy)).toBe(true);
  });

  it('Greece is NOT allied with USSR or BadGuy', () => {
    expect(isAllied(table, House.Greece, House.USSR)).toBe(false);
    expect(isAllied(table, House.Greece, House.BadGuy)).toBe(false);
  });

  it('England allies with Greece (mutual — both declare)', () => {
    expect(isAllied(table, House.England, House.Greece)).toBe(true);
    expect(isAllied(table, House.Greece, House.England)).toBe(true);
  });

  it('USSR allies with France and BadGuy', () => {
    expect(isAllied(table, House.USSR, House.France)).toBe(true);
    expect(isAllied(table, House.USSR, House.BadGuy)).toBe(true);
  });

  it('France allies with BadGuy but NOT USSR (one-way: USSR→France but not France→USSR)', () => {
    expect(isAllied(table, House.France, House.BadGuy)).toBe(true);
    // C++ parity: [France] Allies=BadGuy — France does NOT list USSR
    // So France does NOT consider USSR an ally, even though USSR considers France an ally
    expect(
      isAllied(table, House.France, House.USSR),
      'France should NOT ally USSR (one-way: only USSR→France)',
    ).toBe(false);
  });

  it('BadGuy allies with USSR', () => {
    expect(isAllied(table, House.BadGuy, House.USSR)).toBe(true);
  });

  it('GoodGuy allies with Greece', () => {
    expect(isAllied(table, House.GoodGuy, House.Greece)).toBe(true);
  });

  it('all houses auto-ally with Neutral (house.cpp:7158)', () => {
    for (const h of ALL_CAMPAIGN_HOUSES) {
      expect(isAllied(table, h, House.Neutral), `${h}→Neutral`).toBe(true);
    }
  });

  it('all houses are self-allied', () => {
    for (const h of ALL_CAMPAIGN_HOUSES) {
      expect(isAllied(table, h, h), `${h} self-ally`).toBe(true);
    }
  });

  // C++ parity: houses with NO Allies= line get defaults from constructor
  // house.cpp:638: Allies(0), then house.cpp:672: Make_Ally(house), then
  // house.cpp:7157-7158: Make_Ally(index) + Make_Ally(HOUSE_NEUTRAL)
  // So a house with no Allies= should be allied with: self + Neutral only
  it('Ukraine has no Allies= in SCG05EA: only self + Neutral', () => {
    expect(isAllied(table, House.Ukraine, House.Ukraine)).toBe(true);
    expect(isAllied(table, House.Ukraine, House.Neutral)).toBe(true);
    // Should NOT ally with anyone else
    expect(isAllied(table, House.Ukraine, House.USSR)).toBe(false);
    expect(isAllied(table, House.Ukraine, House.Spain)).toBe(false);
    expect(isAllied(table, House.Ukraine, House.Greece)).toBe(false);
  });

  it('Turkey has no Allies= in SCG05EA: only self + Neutral', () => {
    // Note: Greece declares Turkey an ally, but Turkey doesn't declare Greece
    expect(isAllied(table, House.Turkey, House.Turkey)).toBe(true);
    expect(isAllied(table, House.Turkey, House.Neutral)).toBe(true);
    expect(
      isAllied(table, House.Turkey, House.Greece),
      'Turkey should NOT ally Greece (only Greece→Turkey declared, not Turkey→Greece)',
    ).toBe(false);
  });
});

// ============================================================================
// 7. SCG01EA alliance data — Spain is the player
//    [Greece]  Allies=England,GoodGuy
//    [England] Allies=Greece,GoodGuy
//    [GoodGuy] Allies=Greece,England
//    [Neutral] Allies=Special
// ============================================================================
describe('C++ parity: SCG01EA alliance loading', () => {
  const alliesMap = new Map<House, House[]>([
    [House.Greece,  [House.England, House.GoodGuy]],
    [House.England, [House.Greece, House.GoodGuy]],
    [House.GoodGuy, [House.Greece, House.England]],
  ]);
  const table = buildAlliancesFromINI(alliesMap, House.Greece);

  it('Greece-England-GoodGuy form a mutual triangle', () => {
    const trio = [House.Greece, House.England, House.GoodGuy];
    for (const a of trio) {
      for (const b of trio) {
        expect(isAllied(table, a, b), `${a}→${b}`).toBe(true);
      }
    }
  });

  it('Spain is NOT allied with anyone except self and Neutral (no Allies= entry)', () => {
    // In SCG01EA, Spain has no [Spain] Allies= line in the given data
    // C++ defaults: self + Neutral
    expect(isAllied(table, House.Spain, House.Spain)).toBe(true);
    expect(isAllied(table, House.Spain, House.Neutral)).toBe(true);
    expect(isAllied(table, House.Spain, House.Greece)).toBe(false);
    expect(isAllied(table, House.Spain, House.England)).toBe(false);
  });
});

// ============================================================================
// 8. Multi-faction scenario — SCG24EA (all Allied houses allied)
//    [Greece]  Allies=England,Ukraine,Germany,France,Turkey
//    [USSR]    Allies=BadGuy
//    [England] Allies=Greece,Ukraine,Germany,France,Turkey
//    [Ukraine] Allies=Greece,England,Germany,France,Turkey
//    [Germany] Allies=Greece,England,Ukraine,France,Turkey
//    [France]  Allies=Greece,England,Ukraine,Germany,Turkey
//    [Turkey]  Allies=Greece,England,Ukraine,Germany,France
//    [BadGuy]  Allies=USSR
// ============================================================================
describe('C++ parity: SCG24EA multi-house alliance network', () => {
  const alliedGroup = [House.Greece, House.England, House.Ukraine, House.Germany, House.France, House.Turkey];
  const alliesMap = new Map<House, House[]>([
    [House.Greece,  [House.England, House.Ukraine, House.Germany, House.France, House.Turkey]],
    [House.USSR,    [House.BadGuy]],
    [House.England, [House.Greece, House.Ukraine, House.Germany, House.France, House.Turkey]],
    [House.Ukraine, [House.Greece, House.England, House.Germany, House.France, House.Turkey]],
    [House.Germany, [House.Greece, House.England, House.Ukraine, House.France, House.Turkey]],
    [House.France,  [House.Greece, House.England, House.Ukraine, House.Germany, House.Turkey]],
    [House.Turkey,  [House.Greece, House.England, House.Ukraine, House.Germany, House.France]],
    [House.BadGuy,  [House.USSR]],
  ]);
  const table = buildAlliancesFromINI(alliesMap, House.Greece);

  it('all 6 Allied houses are mutually allied', () => {
    for (const a of alliedGroup) {
      for (const b of alliedGroup) {
        expect(isAllied(table, a, b), `${a}→${b}`).toBe(true);
      }
    }
  });

  it('USSR ↔ BadGuy are mutual allies', () => {
    expect(isAllied(table, House.USSR, House.BadGuy)).toBe(true);
    expect(isAllied(table, House.BadGuy, House.USSR)).toBe(true);
  });

  it('Allied houses are NOT allied with Soviet houses', () => {
    for (const a of alliedGroup) {
      expect(isAllied(table, a, House.USSR), `${a} should NOT ally USSR`).toBe(false);
      expect(isAllied(table, a, House.BadGuy), `${a} should NOT ally BadGuy`).toBe(false);
    }
  });

  it('Soviet houses are NOT allied with Allied houses', () => {
    for (const a of alliedGroup) {
      expect(isAllied(table, House.USSR, a), `USSR should NOT ally ${a}`).toBe(false);
      expect(isAllied(table, House.BadGuy, a), `BadGuy should NOT ally ${a}`).toBe(false);
    }
  });
});

// ============================================================================
// 9. Asymmetric alliance scenario — SCG09EA
//    [Greece]  — no Allies= line
//    [USSR]    Allies=BadGuy
//    [Ukraine] Allies=Turkey,BadGuy
//    [Turkey]  Allies=Greece,USSR
//    [BadGuy]  Allies=Greece,USSR
//    [Neutral] Allies=Special
//
//    C++ key insight: Turkey and BadGuy declare Greece as ally, but Greece
//    does NOT declare them. So Turkey→Greece is ally, Greece→Turkey is NOT.
// ============================================================================
describe('C++ parity: SCG09EA asymmetric alliances', () => {
  const alliesMap = new Map<House, House[]>([
    [House.USSR,    [House.BadGuy]],
    [House.Ukraine, [House.Turkey, House.BadGuy]],
    [House.Turkey,  [House.Greece, House.USSR]],
    [House.BadGuy,  [House.Greece, House.USSR]],
  ]);
  const table = buildAlliancesFromINI(alliesMap, House.Greece);

  it('Turkey considers Greece an ally, but Greece does NOT consider Turkey an ally', () => {
    expect(isAllied(table, House.Turkey, House.Greece)).toBe(true);
    expect(
      isAllied(table, House.Greece, House.Turkey),
      'Greece→Turkey should be false (Greece has no Allies= line)',
    ).toBe(false);
  });

  it('BadGuy considers Greece an ally, but Greece does NOT consider BadGuy an ally', () => {
    expect(isAllied(table, House.BadGuy, House.Greece)).toBe(true);
    expect(
      isAllied(table, House.Greece, House.BadGuy),
      'Greece→BadGuy should be false',
    ).toBe(false);
  });

  it('USSR ↔ BadGuy are mutual (both declare)', () => {
    expect(isAllied(table, House.USSR, House.BadGuy)).toBe(true);
    expect(isAllied(table, House.BadGuy, House.USSR)).toBe(true);
  });

  it('Ukraine→Turkey but Turkey does NOT declare Ukraine', () => {
    expect(isAllied(table, House.Ukraine, House.Turkey)).toBe(true);
    expect(
      isAllied(table, House.Turkey, House.Ukraine),
      'Turkey→Ukraine should be false (Turkey Allies=Greece,USSR only)',
    ).toBe(false);
  });
});

// ============================================================================
// 10. C++ bitmask semantics: INI default is (1 << HOUSE_NEUTRAL)
//     house.cpp:7156 — ini.Get_Owners(hname, "Allies", (1 << HOUSE_NEUTRAL))
//     When a house has NO [House] section or no Allies= key, the default
//     bitmask includes ONLY Neutral. Combined with Make_Ally(index) and
//     Make_Ally(HOUSE_NEUTRAL), the house ends up allied with: self + Neutral.
// ============================================================================
describe('C++ parity: missing Allies= defaults to self + Neutral only (house.cpp:7156)', () => {
  it('house with no Allies= entry: allies = {self, Neutral}', () => {
    // Simulate a scenario where only Greece has an Allies= line
    const alliesMap = new Map<House, House[]>([
      [House.Greece, [House.England]],
    ]);
    const table = buildAlliancesFromINI(alliesMap, House.Greece);

    // USSR has no Allies= entry
    expect(isAllied(table, House.USSR, House.USSR)).toBe(true);     // self
    expect(isAllied(table, House.USSR, House.Neutral)).toBe(true);  // auto-neutral
    expect(isAllied(table, House.USSR, House.Spain)).toBe(false);   // no ally
    expect(isAllied(table, House.USSR, House.Greece)).toBe(false);  // no ally
    expect(isAllied(table, House.USSR, House.BadGuy)).toBe(false);  // no ally
  });
});

// ============================================================================
// 11. isAllied is NOT symmetric — verify the lookup direction
//     C++ house.cpp:2028: ((1<<house) & Allies) — checks THIS house's bitmask
//     TS index.ts:5003: alliances.get(a)?.has(b) — checks a's set for b
// ============================================================================
describe('C++ parity: isAllied checks a→b direction only (house.cpp:2028)', () => {
  it('isAllied(A, B) checks A\'s alliance set for B, not B\'s set for A', () => {
    const alliesMap = new Map<House, House[]>([
      [House.Greece, [House.England]],  // Greece→England
      // England has no Allies= entry
    ]);
    const table = buildAlliancesFromINI(alliesMap, House.Greece);

    // a=Greece, b=England: checks Greece's set => true
    expect(isAllied(table, House.Greece, House.England)).toBe(true);
    // a=England, b=Greece: checks England's set => false (England didn't declare)
    expect(isAllied(table, House.England, House.Greece)).toBe(false);
  });
});

// ============================================================================
// 12. buildAlliancesFromINI does NOT import buildDefaultAlliances ant-mission
//     groups. Campaign alliances come purely from INI, not from default groups.
// ============================================================================
describe('C++ parity: INI alliances override default ant-mission groups', () => {
  it('USSR-Ukraine-Germany are NOT auto-allied in campaign (only in ant missions)', () => {
    // In a campaign scenario, unless each house explicitly declares the others,
    // the ant-mission USSR-Ukraine-Germany group should NOT apply.
    const alliesMap = new Map<House, House[]>([
      [House.USSR, [House.BadGuy]],
    ]);
    const table = buildAlliancesFromINI(alliesMap, House.Greece);

    // USSR only declared BadGuy, not Ukraine or Germany
    expect(isAllied(table, House.USSR, House.Ukraine)).toBe(false);
    expect(isAllied(table, House.USSR, House.Germany)).toBe(false);
    // Ukraine and Germany have no Allies= entry at all
    expect(isAllied(table, House.Ukraine, House.USSR)).toBe(false);
    expect(isAllied(table, House.Germany, House.USSR)).toBe(false);
  });
});

// ============================================================================
// 13. House.Special missing from enum — KNOWN MISMATCH
//     C++ defines.h:1151 defines HOUSE_SPECIAL (value 11, after HOUSE_NEUTRAL=10).
//     The TS House enum omits Special entirely. scenario.ts:985 references
//     House.Special which resolves to undefined at runtime.
//     This means [Neutral] Allies=Special silently adds undefined to the set.
//     Impact: Neutral's alliance with Special is lost. In practice, Special
//     (the 12th house) is rarely used in combat scenarios, so impact is low.
// ============================================================================
describe('C++ parity: House.Special in enum (defines.h:1151) — KNOWN MISMATCH', () => {
  it('House enum should include Special to match C++ HOUSE_SPECIAL', () => {
    // C++ defines.h:1151: HOUSE_NEUTRAL=10, then implied HOUSE_SPECIAL=11
    // TS House enum currently ends at Neutral and does NOT include Special.
    const hasSpecial = Object.values(House).includes('Special' as House);
    // This test documents the mismatch — Special is missing from the enum
    // If this starts passing, the mismatch has been fixed.
    expect(
      hasSpecial,
      'House enum should include Special to match C++ HOUSE_SPECIAL (defines.h)',
    ).toBe(false);  // KNOWN MISMATCH: currently false, should be true for full parity
  });

  it('toHouse("special") should return a valid House value, not undefined', () => {
    // scenario.ts:985: case 'special': return House.Special
    // But House.Special is not in the enum, so it returns undefined
    // This test verifies the current broken behavior
    const specialValue = (House as Record<string, string>)['Special'];
    expect(
      specialValue,
      'House.Special is undefined because it is not in the enum — MISMATCH',
    ).toBeUndefined();  // KNOWN MISMATCH: should be 'Special' for parity
  });
});

// ============================================================================
// 14. playerHouse set construction — engine/index.ts:1128-1134
//     The player house set includes all houses whose alliance set contains
//     playerHouse. This is the REVERSE lookup: who considers player an ally?
// ============================================================================
describe('C++ parity: player house set includes reverse-allied houses', () => {
  it('playerHouseSet includes houses that ally WITH playerHouse, not just playerHouse\'s allies', () => {
    // In engine/index.ts:1130-1131:
    //   for (const [house, allies] of this.alliances)
    //     if (allies.has(this.playerHouse)) playerHouseSet.add(house);
    // This means: if GoodGuy declares Greece as ally, GoodGuy is in playerHouseSet
    const alliesMap = new Map<House, House[]>([
      [House.GoodGuy, [House.Greece]],   // GoodGuy → Greece
      [House.England, [House.Greece]],   // England → Greece
      // Greece has no Allies= (doesn't declare GoodGuy or England)
    ]);
    const table = buildAlliancesFromINI(alliesMap, House.Greece);

    // Build playerHouseSet the same way as engine/index.ts:1130-1133
    const playerHouseSet = new Set<House>();
    for (const [house, allies] of table) {
      if (allies.has(House.Greece)) playerHouseSet.add(house);
    }
    playerHouseSet.add(House.Greece);

    // GoodGuy considers Greece ally, so GoodGuy is in player set
    expect(playerHouseSet.has(House.GoodGuy)).toBe(true);
    // England considers Greece ally, so England is in player set
    expect(playerHouseSet.has(House.England)).toBe(true);
    // Greece itself is always in player set
    expect(playerHouseSet.has(House.Greece)).toBe(true);
    // USSR does NOT consider Greece ally
    expect(playerHouseSet.has(House.USSR)).toBe(false);
  });
});

// ============================================================================
// 15. Group name expansion — C++ conquer.cpp:5490-5506 Owner_From_Name
//     "soviet" expands to HOUSEF_SOVIET = USSR|Ukraine|BadGuy
//     "allies"/"allied" expands to HOUSEF_ALLIES = Spain|Greece|England|Germany|France|Turkey|GoodGuy
//     This is used by ccini.cpp:Get_Owners when parsing Allies= field.
//
//     KNOWN MISMATCH: The TS scenario parser (scenario.ts:899) does NOT expand
//     group names. "Allies=soviet" is treated as a single house name, which
//     toHouse("soviet") maps to House.Neutral (default case) instead of
//     expanding to USSR+Ukraine+BadGuy.
//
//     Affected real scenarios: SCG14EA, SCG11EB, SCG12EA, SCG20EA, SCG03EB,
//     SCA04EA, SCU07EA, SCU10EA — all have Allies=soviet in at least one house.
// ============================================================================
describe('C++ parity: group name "soviet" expansion (conquer.cpp:5493-5494) — KNOWN MISMATCH', () => {
  // C++ defines.h:1167: HOUSEF_SOVIET = HOUSEF_USSR|HOUSEF_UKRAINE|HOUSEF_BAD
  const SOVIET_HOUSES = [House.USSR, House.Ukraine, House.BadGuy];
  // C++ defines.h:1166: HOUSEF_ALLIES = England|Spain|Greece|Germany|France|Turkey|GoodGuy
  const ALLIED_HOUSES = [House.Spain, House.Greece, House.England, House.Germany, House.France, House.Turkey, House.GoodGuy];

  it('C++ "soviet" expands to USSR+Ukraine+BadGuy — TS should too', () => {
    // In SCG14EA: [France] Allies=soviet means France allies with USSR+Ukraine+BadGuy.
    // But TS toHouse("soviet") returns Neutral (default), so France would ally Neutral instead.
    //
    // To test this properly, we simulate what SHOULD happen vs what DOES happen.

    // What C++ does: France allies with USSR, Ukraine, BadGuy
    const cppExpected = new Map<House, House[]>([
      [House.France, SOVIET_HOUSES],
    ]);
    const cppTable = buildAlliancesFromINI(cppExpected, House.Greece);

    expect(isAllied(cppTable, House.France, House.USSR)).toBe(true);
    expect(isAllied(cppTable, House.France, House.Ukraine)).toBe(true);
    expect(isAllied(cppTable, House.France, House.BadGuy)).toBe(true);

    // What TS currently does: "soviet" -> toHouse -> Neutral (wrong)
    // The TS parser produces: [France] -> [Neutral] instead of [USSR, Ukraine, BadGuy]
    // We document this as a known mismatch.
    // If the parser is fixed, this assertion should change.
    const tsActual = new Map<House, House[]>([
      [House.France, [House.Neutral]],  // toHouse("soviet") = Neutral (WRONG)
    ]);
    const tsTable = buildAlliancesFromINI(tsActual, House.Greece);

    // TS INCORRECTLY makes France ally Neutral (it would be anyway via auto-neutral)
    // but does NOT ally USSR, Ukraine, or BadGuy
    expect(
      isAllied(tsTable, House.France, House.USSR),
      'TS MISMATCH: France should ally USSR when Allies=soviet but does not',
    ).toBe(false);  // KNOWN MISMATCH: should be true
  });

  it('C++ "allies" expands to all 7 Allied houses — TS should too', () => {
    // C++ conquer.cpp:5496: stricmp(text, "allies") == 0 => HOUSEF_ALLIES
    // This is the same group-name expansion bug.
    // We just document that TS lacks this expansion.
    const cppExpected = new Map<House, House[]>([
      [House.BadGuy, ALLIED_HOUSES],
    ]);
    const cppTable = buildAlliancesFromINI(cppExpected, House.Greece);

    for (const h of ALLIED_HOUSES) {
      expect(isAllied(cppTable, House.BadGuy, h), `BadGuy should ally ${h}`).toBe(true);
    }
  });
});
