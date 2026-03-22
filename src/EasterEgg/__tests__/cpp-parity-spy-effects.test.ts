/**
 * C++ Parity Audit: Spy Infiltration Effects per Building Type
 *
 * Authoritative C++ source: infantry.cpp:645-671 (InfantryClass::Per_Cell_Process)
 *
 * The C++ spy infiltration handler is deliberately simple:
 *   1. Fire TEVENT_SPIED trigger on the building (line 649-651)
 *   2. Speak VOX_BUILDING_INFILTRATED (line 653)
 *   3. Set SpiedBy flag on the building — ALL buildings (line 656)
 *   4. If STRUCT_RADAR: additionally set House->RadarSpied (shared radar minimap, line 660-662)
 *   5. If STRUCT_SUB_PEN: grant SPC_SONAR_PULSE superweapon (line 664-670)
 *   6. Delete the spy (line 706: `delete this`)
 *
 * That is ALL. No credit theft (spy != thief), no power sabotage, no production
 * reset, no ATEK/STEK effects, no full map reveal. The existing TS implementation
 * fabricates numerous effects that do not exist in C++.
 *
 * Sonar recharge: rules.cpp:210 SonarTime(14) => TICKS_PER_MINUTE * 14 = 900*14 = 12600 ticks
 * (No rules.ini override found in the codebase.)
 *
 * Tests that FAIL are GOOD — they identify real C++ divergences.
 */

import { describe, it, expect } from 'vitest';
import {
  SuperweaponType, SUPERWEAPON_DEFS,
  SONAR_REVEAL_TICKS,
} from '../engine/types';

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Read the spyInfiltrate source at import time so tests can inspect it.
// ---------------------------------------------------------------------------

const indexSrc = fs.readFileSync(
  path.resolve(__dirname, '../engine/index.ts'),
  'utf-8',
);

function extractSpyInfiltrate(): string {
  const start = indexSrc.indexOf('private spyInfiltrate(');
  if (start === -1) throw new Error('spyInfiltrate method not found in index.ts');
  const methodRegion = indexSrc.slice(start);
  const endMatch = methodRegion.match(/\n  (?:\/\/ ===|(?:private|public|protected) \w)/);
  if (!endMatch || endMatch.index === undefined) return methodRegion;
  return methodRegion.slice(0, endMatch.index);
}

const spyMethodRaw = extractSpyInfiltrate();

/** Strip single-line and multi-line comments so regex tests only match executable code */
function stripComments(src: string): string {
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const spyMethod = stripComments(spyMethodRaw);

// ---------------------------------------------------------------------------
// Helper: extract the code block between two case labels (or case to default)
// ---------------------------------------------------------------------------
function sliceBetween(from: string, to: string): string {
  const a = spyMethod.indexOf(from);
  const b = spyMethod.indexOf(to, a + 1);
  if (a === -1) return '';
  if (b === -1) return spyMethod.slice(a);
  return spyMethod.slice(a, b);
}

// ===========================================================================
// 1. PROC/SILO: C++ does NOT steal credits for spy (only Thief does)
//    C++ infantry.cpp:645-671 — spy handler has no STRUCT_REFINERY or
//    STRUCT_STORAGE case. Only the generic SpiedBy flag is set.
//    Credit theft is ONLY in the Thief handler (infantry.cpp:675-701).
// ===========================================================================

describe('PROC/SILO spy infiltration — C++ sets SpiedBy only, NO credit theft (infantry.cpp:645-671)', () => {
  it('PROC spy should NOT steal credits (credit theft is Thief-only in C++)', () => {
    // C++ infantry.cpp:645-671: spy handler does NOT check building type for
    // STRUCT_REFINERY. It just sets SpiedBy on ALL buildings.
    // The TS implementation INCORRECTLY steals half of enemy credits.
    const procSection = sliceBetween("case 'PROC'", "case 'DOME'");
    const stealsCredits = /houseCredits|stolen|steal|enemyCredits|addCredits/i.test(procSection);
    expect(
      stealsCredits,
      'PROC spy should NOT steal credits — C++ infantry.cpp:645-671 has no credit theft for spy. ' +
      'Only the Thief (infantry.cpp:675-701) steals. TS diverges by stealing Math.floor(enemyCredits*0.5).',
    ).toBe(false);
  });

  it('SILO spy should NOT have its own case (C++ has no STRUCT_STORAGE spy case)', () => {
    // C++ infantry.cpp:645-671: no per-building-type switch at all for spy.
    // Only STRUCT_RADAR and STRUCT_SUB_PEN get special treatment.
    // The TS fallthrough from PROC → SILO with credit theft is fabricated.
    const procSection = sliceBetween("case 'PROC'", "case 'DOME'");
    const hasSiloWithCredits = /case\s+['"]SILO['"]/.test(procSection) &&
      /houseCredits|stolen|steal|enemyCredits/i.test(procSection);
    expect(
      hasSiloWithCredits,
      'SILO spy case with credit theft is fabricated — C++ has no STRUCT_STORAGE spy handler.',
    ).toBe(false);
  });
});

// ===========================================================================
// 2. DOME: C++ sets RadarSpied only (shared radar minimap), NOT full map reveal
//    C++ infantry.cpp:660-662: if (build == STRUCT_RADAR) tech->House->RadarSpied |= housespy
//    C++ display.cpp:1435: RadarSpied causes shared cell visibility on radar only
//    There is NO fogDisabled, NO full map reveal, NO timer.
// ===========================================================================

describe('DOME spy infiltration — C++ sets RadarSpied only, NOT full map reveal (infantry.cpp:660-662)', () => {
  it('DOME should set radarSpiedHouses (shared radar), NOT fogDisabled (full map reveal)', () => {
    // C++ behavior: tech->House->RadarSpied |= housespy
    // This shares the enemy's explored radar cells, NOT a full map reveal.
    // TS INCORRECTLY sets fogDisabled=true which reveals EVERYTHING.
    const domeSection = sliceBetween("case 'DOME'", "case 'POWR'");
    const setsFogDisabled = /fogDisabled\s*=\s*true/.test(domeSection);
    expect(
      setsFogDisabled,
      'DOME spy should NOT set fogDisabled — C++ only sets RadarSpied (shared radar minimap, display.cpp:1435). ' +
      'Full map reveal is fabricated.',
    ).toBe(false);
  });

  it('DOME should NOT have a fogReEnableTick timer (no such concept in C++)', () => {
    // C++ infantry.cpp:660-662: RadarSpied is a permanent flag, not timed.
    // The TS fogReEnableTick=450 is entirely fabricated.
    const domeSection = sliceBetween("case 'DOME'", "case 'POWR'");
    const hasFogTimer = /fogReEnableTick/.test(domeSection);
    expect(
      hasFogTimer,
      'fogReEnableTick is fabricated — C++ RadarSpied is a permanent flag, not timed.',
    ).toBe(false);
  });
});

// ===========================================================================
// 3. POWR/APWR: C++ has NO power sabotage for spy infiltration
//    C++ infantry.cpp:645-671: no STRUCT_POWER or STRUCT_ADVANCED_POWER case.
//    The SpiedBy flag is set (generic for all buildings) and that's it.
// ===========================================================================

describe('POWR/APWR spy infiltration — C++ has NO power sabotage effect (infantry.cpp:645-671)', () => {
  it('POWR spy should NOT sabotage power (no such effect in C++)', () => {
    // C++ infantry.cpp:645-671: spy handler has no check for STRUCT_POWER.
    // SpiedBy is set (same as all buildings). No power drain, no blackout.
    // The TS power sabotage (powerSabotageTicks, powerDrainAmount) is fabricated.
    const powrSection = sliceBetween("case 'POWR'", "case 'SPEN'");
    const hasPowerSabotage = /powerSabotage|powerDrain|blackout/i.test(powrSection);
    expect(
      hasPowerSabotage,
      'POWR spy power sabotage is fabricated — C++ infantry.cpp has no STRUCT_POWER spy case.',
    ).toBe(false);
  });

  it('APWR should NOT have its own spy case (no such effect in C++)', () => {
    const apwrSection = sliceBetween("case 'APWR'", "case 'SPEN'");
    const hasPowerEffect = /powerSabotage|powerDrain|blackout/i.test(apwrSection);
    expect(
      hasPowerEffect,
      'APWR spy power sabotage is fabricated — C++ has no STRUCT_ADVANCED_POWER spy case.',
    ).toBe(false);
  });
});

// ===========================================================================
// 4. SPEN (Sub Pen): C++ grants SPC_SONAR_PULSE — this is CORRECT in TS
//    C++ infantry.cpp:664-670:
//      if (build == STRUCT_SUB_PEN) {
//        House->SuperWeapon[SPC_SONAR_PULSE].Enable(false, true, false);
//      }
// ===========================================================================

describe('SPEN spy infiltration — sonar pulse grant (infantry.cpp:664-670)', () => {
  it('SPEN case should exist and grant sonar pulse (matches C++)', () => {
    const hasSpen = /case\s+['"]SPEN['"]/.test(spyMethod);
    expect(hasSpen, 'SPEN case exists in spyInfiltrate').toBe(true);

    const spenSection = sliceBetween("case 'SPEN'", "case 'BARR'");
    if (!spenSection) {
      // Try alternate boundary
      const spenSection2 = sliceBetween("case 'SPEN'", "case 'WEAP'");
      const grantsSonar = /SONAR_PULSE|sonar/i.test(spenSection2);
      expect(grantsSonar, 'SPEN should grant sonar pulse superweapon').toBe(true);
    } else {
      const grantsSonar = /SONAR_PULSE|sonar/i.test(spenSection);
      expect(grantsSonar, 'SPEN should grant sonar pulse superweapon').toBe(true);
    }
  });

  it('SYRD should NOT grant sonar pulse (C++ only handles STRUCT_SUB_PEN, not STRUCT_SHIP_YARD)', () => {
    // C++ infantry.cpp:664: if (build == STRUCT_SUB_PEN) — ONLY sub pen.
    // STRUCT_SHIP_YARD is NOT checked. The TS case 'SYRD' with sonar is fabricated.
    const hasSyrdSonar = /case\s+['"]SYRD['"]/.test(spyMethod);
    // If SYRD case exists and grants sonar, that's a divergence
    if (hasSyrdSonar) {
      const syrdSection = sliceBetween("case 'SYRD'", "case 'BARR'");
      const syrdSonar = /SONAR_PULSE|sonar/i.test(syrdSection || '');
      expect(
        syrdSonar,
        'SYRD (Ship Yard) should NOT grant sonar pulse — C++ infantry.cpp:664 checks ' +
        'STRUCT_SUB_PEN only, not STRUCT_SHIP_YARD. SYRD sonar is fabricated.',
      ).toBe(false);
    }
    // If no SYRD case at all, that's actually correct per C++
  });
});

// ===========================================================================
// 5. SONAR_PULSE recharge time: C++ = TICKS_PER_MINUTE * SonarTime = 900 * 14 = 12600
//    rules.cpp:210: SonarTime(14) — constructor default, no rules.ini override found
//    rules.cpp:575: SonarTime = ini.Get_Fixed(RECHARGE, "Sonar", SonarTime)
//    house.cpp:654:  new (&SuperWeapon[SPC_SONAR_PULSE]) SuperClass(TICKS_PER_MINUTE * Rule.SonarTime, ...)
//    TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
//    TS has rechargeTicks=9000 (10 min) — MISMATCH
// ===========================================================================

describe('SONAR_PULSE recharge time (rules.cpp:210, house.cpp:654)', () => {
  it('sonar pulse recharge should be 12600 ticks (14 min), not 9000 (10 min)', () => {
    // C++ rules.cpp:210: SonarTime(14) — 14 minutes
    // C++ house.cpp:654: TICKS_PER_MINUTE * Rule.SonarTime = 900 * 14 = 12600
    // TS has 9000 (10 min) — off by 3600 ticks (4 minutes)
    const def = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE];
    expect(def.rechargeTicks).toBe(12600);
  });
});

// ===========================================================================
// 6. SONAR_REVEAL_TICKS: C++ uses 15 * TICKS_PER_SECOND = 225 for sub pulse
//    house.cpp:1218: sub->PulseCountDown = 15 * TICKS_PER_SECOND (auto-sonar context)
//    TS SONAR_REVEAL_TICKS = 225 — this is CORRECT
// ===========================================================================

describe('SONAR_REVEAL_TICKS (house.cpp:1218)', () => {
  it('sonar reveal duration should be 225 ticks (15s) — matches C++', () => {
    expect(SONAR_REVEAL_TICKS).toBe(225);
  });
});

// ===========================================================================
// 7. WEAP: C++ has NO production reset for spy infiltration
//    C++ infantry.cpp:645-671: no STRUCT_WEAP case. SpiedBy is set (generic).
//    The SpiedBy flag on WEAP lets the player see the production cameo overlay
//    (building.cpp:517-548), but does NOT reset/abandon the factory.
// ===========================================================================

describe('WEAP spy infiltration — C++ has NO production reset (infantry.cpp:645-671)', () => {
  it('WEAP spy should NOT reset/abandon enemy production', () => {
    // C++ infantry.cpp:645-671: no STRUCT_WEAP spy case. SpiedBy is set same as all.
    // building.cpp:517-548: SpiedBy on a factory shows cameo overlay (visual only).
    // The TS productionQueue.delete() for WEAP is fabricated.
    const weapSection = sliceBetween("case 'WEAP'", 'default:');
    const resetsProduction = /productionQueue\.delete|abandon|cancel.*production/i.test(weapSection);
    expect(
      resetsProduction,
      'WEAP spy should NOT reset production — C++ only sets SpiedBy (shows cameo overlay). ' +
      'Production queue deletion is fabricated.',
    ).toBe(false);
  });
});

// ===========================================================================
// 8. BARR/TENT: C++ has NO special barracks spy case
//    C++ infantry.cpp:645-671: no STRUCT_BARRACKS or STRUCT_TENT case.
//    SpiedBy is set (generic). building.cpp:5705 uses SpiedBy on BARR/TENT
//    for a wider overlap list (rendering detail), not a distinct spy effect.
// ===========================================================================

describe('BARR/TENT spy infiltration — C++ has no special case (infantry.cpp:645-671)', () => {
  it('BARR/TENT spy handling should be same as generic SpiedBy (no productionSpiedHouses)', () => {
    // C++ infantry.cpp:645-671: no check for STRUCT_BARRACKS or STRUCT_TENT.
    // The SpiedBy flag is set on ALL buildings equally.
    // building.cpp:5705: SpiedBy on BARR/TENT only affects Overlap_List (rendering).
    // TS creates a distinct "productionSpiedHouses" concept that doesn't exist in C++.
    // Per C++, BARR should be treated same as any other building (SpiedBy only).
    const barrSection = sliceBetween("case 'BARR'", "case 'TENT'");
    const hasDistinctEffect = /productionSpiedHouses/.test(barrSection);
    // This is an over-specification but acceptable; the real issue is that WEAP/ATEK/etc
    // have fabricated effects. We flag it here as a note.
    expect(
      hasDistinctEffect,
      'BARR spy uses productionSpiedHouses — C++ only sets SpiedBy (generic for all buildings). ' +
      'productionSpiedHouses is a TS invention. In C++, SpiedBy on any factory shows cameo overlay.',
    ).toBe(false);
  });
});

// ===========================================================================
// 9. ATEK: C++ has NO GPS satellite grant for spy infiltration
//    C++ infantry.cpp:645-671: no STRUCT_ADVANCED_TECH case.
//    GPS satellite is a separate superweapon that charges from owning ATEK,
//    not from spy infiltration.
// ===========================================================================

describe('ATEK spy infiltration — C++ has NO GPS satellite grant (infantry.cpp:645-671)', () => {
  it('ATEK spy should NOT grant GPS satellite (fabricated effect)', () => {
    // C++ infantry.cpp:645-671: no STRUCT_ADVANCED_TECH spy case.
    // The TS creates a GPS_SATELLITE superweapon and sets gpsActive=true — fabricated.
    const hasAtek = /case\s+['"]ATEK['"]/.test(spyMethod);
    if (hasAtek) {
      const atekSection = sliceBetween("case 'ATEK'", "case 'STEK'");
      const grantsGps = /GPS_SATELLITE|gpsActive/i.test(atekSection);
      expect(
        grantsGps,
        'ATEK spy GPS satellite grant is fabricated — C++ infantry.cpp has no STRUCT_ADVANCED_TECH spy case.',
      ).toBe(false);
    }
  });
});

// ===========================================================================
// 10. STEK: C++ has NO tech reveal for spy infiltration
//     C++ infantry.cpp:645-671: no STRUCT_SOVIET_TECH case.
// ===========================================================================

describe('STEK spy infiltration — C++ has NO tech reveal (infantry.cpp:645-671)', () => {
  it('STEK spy should NOT have a special case (fabricated effect)', () => {
    // C++ infantry.cpp:645-671: no STRUCT_SOVIET_TECH spy case.
    // The TS sets spiedHouses + productionSpiedHouses — fabricated.
    const hasStek = /case\s+['"]STEK['"]/.test(spyMethod);
    if (hasStek) {
      const stekSection = sliceBetween("case 'STEK'", 'default:');
      const hasTechEffect = /productionSpiedHouses|spiedHouses/i.test(stekSection);
      expect(
        hasTechEffect,
        'STEK spy tech reveal is fabricated — C++ infantry.cpp has no STRUCT_SOVIET_TECH spy case.',
      ).toBe(false);
    }
  });
});

// ===========================================================================
// 11. Spy consumption — spy dies after infiltration
//     C++ infantry.cpp:706: `delete this` (spy is removed from game)
//     TS sets alive=false, mission=DIE, clears disguise and trigger
// ===========================================================================

describe('Spy consumption after infiltration (infantry.cpp:706)', () => {
  it('spy should be killed after infiltration (alive=false, mission=DIE)', () => {
    const killsSpy = /spy\.alive\s*=\s*false/.test(spyMethod) &&
                     /spy\.mission\s*=\s*Mission\.DIE/.test(spyMethod);
    expect(killsSpy, 'spy should be consumed (alive=false, mission=DIE) after infiltration').toBe(true);
  });

  it('spy disguise should be cleared on infiltration', () => {
    const clearsDisguise = /spy\.disguisedAs\s*=\s*null/.test(spyMethod);
    expect(clearsDisguise, 'spy disguise should be cleared on infiltration').toBe(true);
  });

  it('spy trigger name should be cleared before death (prevent TEVENT_DESTROYED)', () => {
    const clearsTrigger = /spy\.triggerName\s*=\s*undefined/.test(spyMethod);
    expect(clearsTrigger, 'spy triggerName should be cleared before death').toBe(true);
  });
});

// ===========================================================================
// 12. TEVENT_SPIED trigger — C++ fires before any effect
//     C++ infantry.cpp:649-651: if (tech->Trigger.Is_Valid()) tech->Trigger->Spring(TEVENT_SPIED, this)
//     TS stores building trigger name into spiedBuildingTriggers set
// ===========================================================================

describe('TEVENT_SPIED trigger firing (infantry.cpp:649-651)', () => {
  it('spy infiltration should record the building trigger for TEVENT_SPIED', () => {
    const firesTrigger = /spiedBuildingTriggers\.add/.test(spyMethodRaw); // use raw (with comments) is fine
    expect(firesTrigger, 'spiedBuildingTriggers should be populated for TEVENT_SPIED').toBe(true);
  });
});

// ===========================================================================
// 13. Building type coverage — C++ only has special handling for 2 building types
//     STRUCT_RADAR and STRUCT_SUB_PEN get extra effects beyond SpiedBy.
//     ALL other building types only get the generic SpiedBy flag.
//     The TS switch statement should NOT have distinct cases for:
//     PROC, SILO, POWR, APWR, WEAP, BARR, TENT, ATEK, STEK, SYRD
// ===========================================================================

describe('Spy infiltration building type coverage — C++ only has RADAR and SUB_PEN special cases', () => {
  const fabricatedCases = ['PROC', 'SILO', 'POWR', 'APWR', 'WEAP', 'ATEK', 'STEK', 'SYRD'];

  for (const btype of fabricatedCases) {
    it(`${btype} should NOT have a distinct spy case with special effects (fabricated)`, () => {
      // C++ infantry.cpp:645-671: only STRUCT_RADAR (RadarSpied) and
      // STRUCT_SUB_PEN (sonar pulse) have special handling.
      // All other buildings just get SpiedBy flag.
      const caseRegex = new RegExp(`case\\s+['"]${btype}['"]`);
      const hasCase = caseRegex.test(spyMethod);
      if (hasCase) {
        // Having the case is acceptable IF it only does what C++ does (set SpiedBy).
        // But if it has side effects beyond that, it's fabricated.
        const caseStart = spyMethod.indexOf(`case '${btype}'`);
        if (caseStart === -1) return; // double-check
        const nextCase = spyMethod.indexOf('case ', caseStart + 10);
        const defaultIdx = spyMethod.indexOf('default:', caseStart);
        const end = Math.min(
          nextCase > -1 ? nextCase : Infinity,
          defaultIdx > -1 ? defaultIdx : Infinity,
        );
        const section = spyMethod.slice(caseStart, end);
        const hasFabricatedEffect = /houseCredits|fogDisabled|powerSabotage|powerDrain|productionQueue\.delete|GPS_SATELLITE|gpsActive|productionSpiedHouses|SONAR_PULSE/.test(section);
        expect(
          hasFabricatedEffect,
          `${btype} spy case has fabricated effects — C++ infantry.cpp:645-671 only sets SpiedBy for this building type.`,
        ).toBe(false);
      }
    });
  }

  // SPEN (Sub Pen) SHOULD have a special case — this is correct per C++
  it('SPEN should have a distinct spy case with sonar pulse (matches C++ infantry.cpp:664-670)', () => {
    const hasSpen = /case\s+['"]SPEN['"]/.test(spyMethod);
    expect(hasSpen, 'SPEN case should exist — C++ grants sonar pulse on sub pen spy').toBe(true);
  });
});

// ===========================================================================
// 14. Thief vs Spy distinction — credit theft is Thief-only
//     C++ infantry.cpp:675-701: Thief (INFANTRY_THIEF) steals Available_Money()/2
//     C++ infantry.cpp:645-671: Spy (INFANTRY_SPY) only sets SpiedBy
//     The two code paths are completely separate in C++.
// ===========================================================================

describe('Thief vs Spy credit theft distinction (infantry.cpp:645-701)', () => {
  const specialUnitsSrc = fs.readFileSync(
    path.resolve(__dirname, '../engine/specialUnits.ts'),
    'utf-8',
  );

  it('Thief correctly steals 50% credits from PROC/SILO (baseline)', () => {
    // C++ infantry.cpp:696: cash = bldg->House->Available_Money() / 2
    const thiefSteals = /enemyCredits\s*\*\s*0\.5|Math\.floor.*0\.5/.test(specialUnitsSrc);
    expect(thiefSteals, 'Thief should steal 50% of enemy credits').toBe(true);
  });

  it('Spy on PROC should NOT steal credits (only set SpiedBy)', () => {
    // C++ infantry.cpp:645-671: spy handler has NO credit theft.
    // Only the Thief handler (infantry.cpp:675-701) steals.
    const procSection = sliceBetween("case 'PROC'", "case 'DOME'");
    const spySteals = /houseCredits|stolen|steal|addCredits/i.test(procSection);
    expect(
      spySteals,
      'Spy infiltrating PROC should NOT steal credits — that is Thief-only (infantry.cpp:675-701).',
    ).toBe(false);
  });
});
