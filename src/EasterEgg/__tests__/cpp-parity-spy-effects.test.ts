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
 * has been corrected to match C++.
 *
 * Sonar recharge: rules.cpp:210 SonarTime(14) => TICKS_PER_MINUTE * 14 = 900*14 = 12600 ticks
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

// ===========================================================================
// 1. PROC/SILO: C++ does NOT steal credits for spy (only Thief does)
//    C++ infantry.cpp:645-671 — spy handler has no STRUCT_REFINERY or
//    STRUCT_STORAGE case. Only the generic SpiedBy flag is set.
//    Credit theft is ONLY in the Thief handler (infantry.cpp:675-701).
// ===========================================================================

describe('PROC/SILO spy infiltration — C++ sets SpiedBy only, NO credit theft (infantry.cpp:645-671)', () => {
  it('spyInfiltrate does NOT steal credits (no houseCredits/stolen/steal)', () => {
    // C++ infantry.cpp:645-671: spy handler does NOT check building type for
    // STRUCT_REFINERY. It just sets SpiedBy on ALL buildings.
    const stealsCredits = /houseCredits|stolen|steal|enemyCredits|addCredits/i.test(spyMethod);
    expect(
      stealsCredits,
      'spyInfiltrate should NOT steal credits — C++ infantry.cpp:645-671 has no credit theft for spy. ' +
      'Only the Thief (infantry.cpp:675-701) steals.',
    ).toBe(false);
  });

  it('No PROC or SILO case exists in spyInfiltrate (C++ has no per-type case for these)', () => {
    // C++ infantry.cpp:645-671: only STRUCT_RADAR and STRUCT_SUB_PEN get special treatment.
    const hasProcCase = /case\s+['"]PROC['"]/.test(spyMethod);
    const hasSiloCase = /case\s+['"]SILO['"]/.test(spyMethod);
    expect(hasProcCase, 'PROC should not have a switch case in spyInfiltrate').toBe(false);
    expect(hasSiloCase, 'SILO should not have a switch case in spyInfiltrate').toBe(false);
  });
});

// ===========================================================================
// 2. DOME: C++ sets RadarSpied only (shared radar minimap), NOT full map reveal
//    C++ infantry.cpp:660-662: if (build == STRUCT_RADAR) tech->House->RadarSpied |= housespy
//    C++ display.cpp:1435: RadarSpied causes shared cell visibility on radar only
//    There is NO fogDisabled, NO full map reveal, NO timer.
// ===========================================================================

describe('DOME spy infiltration — C++ sets RadarSpied only, NOT full map reveal (infantry.cpp:660-662)', () => {
  it('DOME does NOT set fogDisabled (C++ only sets RadarSpied)', () => {
    const setsFogDisabled = /fogDisabled\s*=\s*true/.test(spyMethod);
    expect(
      setsFogDisabled,
      'DOME spy should NOT set fogDisabled — C++ only sets RadarSpied (shared radar minimap, display.cpp:1435).',
    ).toBe(false);
  });

  it('DOME does NOT have a fogReEnableTick timer (no such concept in C++)', () => {
    const hasFogTimer = /fogReEnableTick/.test(spyMethod);
    expect(
      hasFogTimer,
      'fogReEnableTick is fabricated — C++ RadarSpied is a permanent flag, not timed.',
    ).toBe(false);
  });

  it('DOME sets radarSpiedHouses (matching C++ RadarSpied)', () => {
    const setsRadarSpied = /radarSpiedHouses\.add/.test(spyMethod);
    expect(setsRadarSpied, 'DOME should set radarSpiedHouses for shared radar').toBe(true);
  });
});

// ===========================================================================
// 3. POWR/APWR: C++ has NO power sabotage for spy infiltration
//    C++ infantry.cpp:645-671: no STRUCT_POWER or STRUCT_ADVANCED_POWER case.
//    The SpiedBy flag is set (generic for all buildings) and that's it.
// ===========================================================================

describe('POWR/APWR spy infiltration — C++ has NO power sabotage effect (infantry.cpp:645-671)', () => {
  it('spyInfiltrate has NO power sabotage logic', () => {
    const hasPowerSabotage = /powerSabotage|powerDrain|blackout/i.test(spyMethod);
    expect(
      hasPowerSabotage,
      'Power sabotage is fabricated — C++ infantry.cpp has no STRUCT_POWER spy case.',
    ).toBe(false);
  });

  it('No POWR or APWR case exists in spyInfiltrate', () => {
    const hasPowrCase = /case\s+['"]POWR['"]/.test(spyMethod);
    const hasApwrCase = /case\s+['"]APWR['"]/.test(spyMethod);
    expect(hasPowrCase, 'POWR should not have a switch case').toBe(false);
    expect(hasApwrCase, 'APWR should not have a switch case').toBe(false);
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
  it('SPEN handling exists and grants sonar pulse (matches C++)', () => {
    const hasSpen = /SPEN/.test(spyMethod);
    expect(hasSpen, 'SPEN handling exists in spyInfiltrate').toBe(true);

    const grantsSonar = /SONAR_PULSE|sonar/i.test(spyMethod);
    expect(grantsSonar, 'SPEN should grant sonar pulse superweapon').toBe(true);
  });

  it('SYRD does NOT grant sonar pulse (C++ only handles STRUCT_SUB_PEN)', () => {
    // C++ infantry.cpp:664: if (build == STRUCT_SUB_PEN) — ONLY sub pen.
    // In the rewritten code, there is no SYRD handling at all.
    const hasSyrdSonar = /SYRD/.test(spyMethod) && /SONAR_PULSE/.test(spyMethod);
    // The method may mention SYRD in a comment but the executable code should not
    // grant sonar for SYRD. Check that SYRD is not in the condition.
    const syrdInCondition = /structure\.type\s*===?\s*['"]SYRD['"]/.test(spyMethod);
    expect(
      syrdInCondition,
      'SYRD (Ship Yard) should NOT have a condition — C++ infantry.cpp:664 checks STRUCT_SUB_PEN only.',
    ).toBe(false);
  });
});

// ===========================================================================
// 5. SONAR_PULSE recharge time: C++ = TICKS_PER_MINUTE * SonarTime = 900 * 14 = 12600
//    rules.cpp:210: SonarTime(14) — constructor default
//    house.cpp:654:  new (&SuperWeapon[SPC_SONAR_PULSE]) SuperClass(TICKS_PER_MINUTE * Rule.SonarTime, ...)
//    TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900
// ===========================================================================

describe('SONAR_PULSE recharge time (rules.cpp:210, house.cpp:654)', () => {
  it('sonar pulse recharge should be 9000 ticks (10 min per rules.ini)', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE];
    expect(def.rechargeTicks).toBe(9000);  // rules.ini [Recharge] Sonar=10
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
// ===========================================================================

describe('WEAP spy infiltration — C++ has NO production reset (infantry.cpp:645-671)', () => {
  it('spyInfiltrate does NOT reset production queues', () => {
    const resetsProduction = /productionQueue\.delete|abandon|cancel.*production/i.test(spyMethod);
    expect(
      resetsProduction,
      'WEAP spy should NOT reset production — C++ only sets SpiedBy.',
    ).toBe(false);
  });
});

// ===========================================================================
// 8. BARR/TENT: C++ has NO special barracks spy case
// ===========================================================================

describe('BARR/TENT spy infiltration — C++ has no special case (infantry.cpp:645-671)', () => {
  it('No productionSpiedHouses concept in spyInfiltrate', () => {
    const hasProductionSpied = /productionSpiedHouses/.test(spyMethod);
    expect(
      hasProductionSpied,
      'productionSpiedHouses is a TS invention — C++ only sets SpiedBy (generic for all buildings).',
    ).toBe(false);
  });
});

// ===========================================================================
// 9. ATEK: C++ has NO GPS satellite grant for spy infiltration
// ===========================================================================

describe('ATEK spy infiltration — C++ has NO GPS satellite grant (infantry.cpp:645-671)', () => {
  it('spyInfiltrate does NOT grant GPS satellite', () => {
    const grantsGps = /GPS_SATELLITE|gpsActive/i.test(spyMethod);
    expect(
      grantsGps,
      'ATEK spy GPS satellite grant is fabricated — C++ infantry.cpp has no STRUCT_ADVANCED_TECH spy case.',
    ).toBe(false);
  });
});

// ===========================================================================
// 10. STEK: C++ has NO tech reveal for spy infiltration
// ===========================================================================

describe('STEK spy infiltration — C++ has NO tech reveal (infantry.cpp:645-671)', () => {
  it('No STEK case or tech reveal in spyInfiltrate', () => {
    const hasStekCase = /case\s+['"]STEK['"]/.test(spyMethod);
    expect(hasStekCase, 'STEK should not have a case in spyInfiltrate').toBe(false);
  });
});

// ===========================================================================
// 11. Spy consumption — spy dies after infiltration
//     C++ infantry.cpp:706: `delete this` (spy is removed from game)
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
// ===========================================================================

describe('TEVENT_SPIED trigger firing (infantry.cpp:649-651)', () => {
  it('spy infiltration should record the building trigger for TEVENT_SPIED', () => {
    const firesTrigger = /spiedBuildingTriggers\.add/.test(spyMethodRaw);
    expect(firesTrigger, 'spiedBuildingTriggers should be populated for TEVENT_SPIED').toBe(true);
  });
});

// ===========================================================================
// 13. SpiedBy flag set on ALL buildings — C++ infantry.cpp:656
// ===========================================================================

describe('SpiedBy flag on all buildings (infantry.cpp:656)', () => {
  it('spyInfiltrate sets structure.spiedBy (per-building bitmask)', () => {
    const setsSpiedBy = /structure\.spiedBy/.test(spyMethod);
    expect(setsSpiedBy, 'structure.spiedBy should be set for C++ SpiedBy parity').toBe(true);
  });

  it('spyInfiltrate adds target house to spiedHouses (house-level tracking)', () => {
    const addsSpiedHouse = /spiedHouses\.add/.test(spyMethod);
    expect(addsSpiedHouse, 'spiedHouses.add should be called for all buildings').toBe(true);
  });
});

// ===========================================================================
// 14. No fabricated switch cases — only DOME and SPEN should have conditions
// ===========================================================================

describe('Only DOME and SPEN have special handling (infantry.cpp:658-670)', () => {
  const fabricatedCases = ['PROC', 'SILO', 'POWR', 'APWR', 'WEAP', 'BARR', 'TENT', 'ATEK', 'STEK', 'SYRD'];

  for (const btype of fabricatedCases) {
    it(`${btype} should NOT have a case/condition with fabricated effects`, () => {
      const caseRegex = new RegExp(`case\\s+['"]${btype}['"]`);
      const conditionRegex = new RegExp(`structure\\.type\\s*===?\\s*['"]${btype}['"]`);
      const hasCase = caseRegex.test(spyMethod);
      const hasCondition = conditionRegex.test(spyMethod);
      expect(
        hasCase || hasCondition,
        `${btype} should not have special handling — C++ only has STRUCT_RADAR and STRUCT_SUB_PEN.`,
      ).toBe(false);
    });
  }
});

// ===========================================================================
// 15. Thief vs Spy distinction — credit theft is Thief-only
// ===========================================================================

describe('Thief vs Spy credit theft distinction (infantry.cpp:645-701)', () => {
  const specialUnitsSrc = fs.readFileSync(
    path.resolve(__dirname, '../engine/specialUnits.ts'),
    'utf-8',
  );

  it('Thief correctly steals 50% credits from PROC/SILO (baseline)', () => {
    const thiefSteals = /enemyCredits\s*\*\s*0\.5|Math\.floor.*0\.5/.test(specialUnitsSrc);
    expect(thiefSteals, 'Thief should steal 50% of enemy credits').toBe(true);
  });

  it('Spy on PROC should NOT steal credits (only set SpiedBy)', () => {
    const spySteals = /houseCredits|stolen|steal|addCredits/i.test(spyMethod);
    expect(
      spySteals,
      'Spy infiltrating PROC should NOT steal credits — that is Thief-only (infantry.cpp:675-701).',
    ).toBe(false);
  });
});
