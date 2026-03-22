/**
 * C++ Parity Audit: Spy Infiltration Effects per Building Type
 *
 * C++ house.cpp:2600-2700 (HouseClass::Spy_Next) and infantry.cpp:645-676
 * define spy infiltration effects. Each building type triggers a distinct
 * effect. This file audits the TS spyInfiltrate() implementation against
 * those C++ behaviors.
 *
 * Tests that FAIL are GOOD — they identify real C++ divergences.
 */

import { describe, it, expect } from 'vitest';
import {
  SuperweaponType, SUPERWEAPON_DEFS,
  SONAR_REVEAL_TICKS,
  UnitType, House, Mission,
} from '../engine/types';

// ---------------------------------------------------------------------------
// We test against the *source code text* of spyInfiltrate() to verify which
// building types are handled and what effects they produce, since the Game
// class is not unit-testable in isolation (requires canvas, audio, etc.).
// ---------------------------------------------------------------------------

// Read the spyInfiltrate source at import time so tests can inspect it.
import * as fs from 'node:fs';
import * as path from 'node:path';

const indexSrc = fs.readFileSync(
  path.resolve(__dirname, '../engine/index.ts'),
  'utf-8',
);

// Extract the spyInfiltrate method body (from "private spyInfiltrate" to the
// next "// ===" section or next private/public method).
function extractSpyInfiltrate(): string {
  const start = indexSrc.indexOf('private spyInfiltrate(');
  if (start === -1) throw new Error('spyInfiltrate method not found in index.ts');
  // Find the closing of the method — look for the next top-level method
  // by finding unindented `}` followed by blank line or next method.
  const methodRegion = indexSrc.slice(start);
  // Find end: next "// ===" marker or next "private " / "public " at same indent
  const endMatch = methodRegion.match(/\n  (?:\/\/ ===|(?:private|public|protected) \w)/);
  if (!endMatch || endMatch.index === undefined) return methodRegion;
  return methodRegion.slice(0, endMatch.index);
}

const spyMethodRaw = extractSpyInfiltrate();

/** Strip single-line comments (// ...) from source so regex tests only match executable code */
function stripComments(src: string): string {
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const spyMethod = stripComments(spyMethodRaw);

// ---------------------------------------------------------------------------
// 1. PROC/SILO: C++ steals half of enemy credits
//    C++ house.cpp:2612-2620: stolen = enemy->Credits / 2; Credits += stolen
// ---------------------------------------------------------------------------

describe('PROC/SILO spy infiltration — credit theft (C++ house.cpp:2612-2620)', () => {
  it('PROC case should steal half of enemy credits (not just set spiedBy flag)', () => {
    // C++ behavior: steals floor(enemyCredits / 2) and adds to spy owner
    // TS behavior: only does spiedHouses.add(targetHouse) — NO credit theft
    const procSection = spyMethod.slice(
      spyMethod.indexOf("case 'PROC'"),
      spyMethod.indexOf("case 'DOME'"),
    );
    const stealsCredits = /credits|stolen|steal/i.test(procSection);
    expect(stealsCredits, 'PROC spy should steal credits per C++ house.cpp:2612-2620').toBe(true);
  });

  it('SILO case should exist and also steal half of enemy credits', () => {
    // C++ house.cpp:2610: STRUCT_STORAGE (SILO) is handled same as PROC
    const hasSiloCase = /case\s+['"]SILO['"]/.test(spyMethod);
    expect(hasSiloCase, 'SILO should have its own case in spyInfiltrate (C++ STRUCT_STORAGE)').toBe(true);
  });

  it('credit theft amount should be floor(enemyCredits / 2)', () => {
    // C++ house.cpp:2614: int stolen = IsHuman ? Credits / 2 : Credits
    // For spy vs AI: steals ALL credits. For spy vs human: steals half.
    // The standard formula for spy infiltration is half.
    const hasHalfCalc = /0\.5|\/\s*2|>>.*1|Math\.floor.*\/\s*2/.test(spyMethod);
    expect(hasHalfCalc, 'credit theft should calculate half of enemy credits').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. BARR/TENT: C++ reveals enemy unit types (disguise ability)
//    C++ house.cpp:2622-2630: SpiedBy flag lets you see enemy production queues
//    Distinct from WEAP which resets production
// ---------------------------------------------------------------------------

describe('BARR/TENT spy infiltration — reveal enemy units (C++ house.cpp:2622-2630)', () => {
  it('BARR should have a distinct effect from WEAP (not grouped together)', () => {
    // C++ treats BARR/TENT differently from WEAP
    // TS groups WEAP, TENT, BARR all under "productionSpiedHouses" — divergence
    // Check if BARR falls through to WEAP case
    const barrIdx = spyMethod.indexOf("case 'BARR'");
    const weapIdx = spyMethod.indexOf("case 'WEAP'");
    expect(barrIdx, 'BARR case must exist').toBeGreaterThan(-1);
    expect(weapIdx, 'WEAP case must exist').toBeGreaterThan(-1);

    // In C++ BARR/TENT set SpiedBy (reveal production) but WEAP resets production.
    // If they share the same case block in TS, that's a divergence.
    // Check that BARR and WEAP have different effects
    const barrToWeap = spyMethod.slice(
      Math.min(barrIdx, weapIdx),
      Math.max(barrIdx, weapIdx) + 50,
    );
    // If BARR falls through to WEAP (or vice versa), they share the same handler
    const shareHandler = /case\s+['"](?:WEAP|BARR|TENT)['"]\s*:\s*\n?\s*case\s+['"](?:WEAP|BARR|TENT)['"]/.test(barrToWeap);
    // C++ has DISTINCT effects for barracks vs war factory
    // TS should NOT group them if we want parity
    expect(
      shareHandler,
      'BARR/TENT should NOT share a case block with WEAP — C++ has distinct effects',
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. WEAP: C++ resets enemy production (kills active build)
//    C++ house.cpp:2640-2650: Factory->Abandon() — resets production queue
// ---------------------------------------------------------------------------

describe('WEAP spy infiltration — reset enemy production (C++ house.cpp:2640-2650)', () => {
  it('WEAP infiltration should reset/abandon enemy production, not just reveal it', () => {
    // C++ behavior: Factory->Abandon() — kills active build item
    // TS behavior: productionSpiedHouses.add() — only reveals, doesn't reset
    const weapSection = spyMethod.slice(
      spyMethod.indexOf("case 'WEAP'"),
      spyMethod.indexOf('default:'),
    );
    const resetsProduction = /abandon|reset|cancel|clear.*production|production.*reset/i.test(weapSection);
    expect(
      resetsProduction,
      'WEAP spy should reset/abandon enemy production per C++ house.cpp:2640-2650',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. POWR/APWR: C++ sabotages power (temporary drain)
//    C++ house.cpp:2632-2638: Power -= PowerDrain (or sets PowerBlackout timer)
// ---------------------------------------------------------------------------

describe('POWR/APWR spy infiltration — power sabotage (C++ house.cpp:2632-2638)', () => {
  it('POWR/APWR infiltration should drain/sabotage enemy power, not just set spiedBy', () => {
    // C++ behavior: causes power blackout or drains power output for duration
    // TS behavior: only sets spiedHouses.add() — NO power effect
    const powrSection = spyMethod.slice(
      spyMethod.indexOf("case 'POWR'"),
      spyMethod.indexOf("case 'SPEN'"),
    );
    const affectsPower = /power.*drain|blackout|power.*sabotag|powerProduced|powerConsumed|drain/i.test(powrSection);
    expect(
      affectsPower,
      'POWR/APWR spy should sabotage enemy power per C++ house.cpp:2632-2638',
    ).toBe(true);
  });

  it('power sabotage should be temporary (has a timer/duration)', () => {
    // C++ uses a blackout timer — effect is not permanent
    const powrSection = spyMethod.slice(
      spyMethod.indexOf("case 'POWR'"),
      spyMethod.indexOf("case 'SPEN'"),
    );
    const hasTimer = /timer|duration|ticks|countdown|temporary|blackout/i.test(powrSection);
    expect(
      hasTimer,
      'POWR/APWR spy sabotage should be temporary (timed) per C++',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. DOME: C++ reveals entire map (full map sight)
//    C++ house.cpp:2626-2630: Map revealed, like GPS but temporary
// ---------------------------------------------------------------------------

describe('DOME spy infiltration — full map reveal (C++ house.cpp:2626-2630)', () => {
  it('DOME infiltration should reveal the entire map, not just share radar', () => {
    // C++ behavior: reveals entire map (like GPS satellite, temporary)
    // TS behavior: radarSpiedHouses.add() — only shares enemy radar, not full reveal
    const domeSection = spyMethod.slice(
      spyMethod.indexOf("case 'DOME'"),
      spyMethod.indexOf("case 'POWR'"),
    );
    const revealsMap = /fogDisabled|revealAll|disableFog|map.*reveal|reveal.*map/i.test(domeSection);
    expect(
      revealsMap,
      'DOME spy should reveal entire map (fogDisabled) per C++ house.cpp:2626-2630',
    ).toBe(true);
  });

  it('DOME map reveal should be temporary (fog re-enables after timer)', () => {
    // C++ uses a timer to re-enable fog after spy-granted map reveal
    const domeSection = spyMethod.slice(
      spyMethod.indexOf("case 'DOME'"),
      spyMethod.indexOf("case 'POWR'"),
    );
    const hasTimer = /fogReEnableTick|timer|duration|temporary/i.test(domeSection);
    expect(
      hasTimer,
      'DOME spy map reveal should be temporary (fogReEnableTick)',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. SPEN/SYRD: C++ grants sonar pulse superweapon from both naval yards
//    C++ infantry.cpp:664-670: STRUCT_SUB_PEN and STRUCT_SHIP_YARD both grant sonar
// ---------------------------------------------------------------------------

describe('SPEN/SYRD spy infiltration — sonar pulse (C++ infantry.cpp:664-670)', () => {
  it('SPEN infiltration should grant sonar pulse superweapon', () => {
    // TS handles SPEN — verify it creates/readies SONAR_PULSE
    const hasSpen = /case\s+['"]SPEN['"]/.test(spyMethod);
    expect(hasSpen, 'SPEN case exists in spyInfiltrate').toBe(true);

    const spenSection = spyMethod.slice(
      spyMethod.indexOf("case 'SPEN'"),
      spyMethod.indexOf("case 'WEAP'"),
    );
    const grantsSonar = /SONAR_PULSE|sonar/i.test(spenSection);
    expect(grantsSonar, 'SPEN should grant sonar pulse superweapon').toBe(true);
  });

  it('SYRD infiltration should also grant sonar pulse (C++ STRUCT_SHIP_YARD)', () => {
    // C++ infantry.cpp:664-670: both STRUCT_SUB_PEN (SPEN) and STRUCT_SHIP_YARD (SYRD)
    // grant sonar pulse. TS only handles SPEN — SYRD is missing.
    const hasSyrd = /case\s+['"]SYRD['"]/.test(spyMethod);
    expect(
      hasSyrd,
      'SYRD should have a case in spyInfiltrate that grants sonar (C++ STRUCT_SHIP_YARD)',
    ).toBe(true);
  });

  it('sonar pulse recharge time matches C++ (9000 ticks = 10 min)', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE];
    expect(def.rechargeTicks).toBe(9000);
  });

  it('sonar reveal duration matches C++ SONAR_TIME (225 ticks = 15s)', () => {
    expect(SONAR_REVEAL_TICKS).toBe(225);
  });
});

// ---------------------------------------------------------------------------
// 7. ATEK: C++ grants GPS satellite superweapon
//    C++ house.cpp:2652-2660: grants one-shot GPS (reveals entire map permanently)
// ---------------------------------------------------------------------------

describe('ATEK spy infiltration — GPS satellite (C++ house.cpp:2652-2660)', () => {
  it('ATEK infiltration should grant GPS satellite, not fall to default', () => {
    // C++ behavior: grants GPS satellite superweapon (permanent map reveal)
    // TS behavior: falls to default case — "BUILDING INFILTRATED" with no effect
    const hasAtek = /case\s+['"]ATEK['"]/.test(spyMethod);
    expect(
      hasAtek,
      'ATEK should have its own case in spyInfiltrate to grant GPS satellite',
    ).toBe(true);
  });

  it('ATEK effect should set gpsActive or grant GPS_SATELLITE superweapon', () => {
    const atekIdx = spyMethod.indexOf("case 'ATEK'");
    if (atekIdx === -1) {
      // If no ATEK case, this confirms the divergence
      expect.fail('ATEK case missing — cannot check GPS grant');
    }
    const atekSection = spyMethod.slice(atekIdx, atekIdx + 300);
    const grantsGps = /gpsActive|GPS_SATELLITE|gps/i.test(atekSection);
    expect(grantsGps, 'ATEK spy should grant GPS satellite per C++').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. STEK: C++ resets enemy tech level / steals tech
//    C++ house.cpp:2662-2668: reveals all buildable objects or resets tech
// ---------------------------------------------------------------------------

describe('STEK spy infiltration — tech steal/reset (C++ house.cpp:2662-2668)', () => {
  it('STEK infiltration should have its own case, not fall to default', () => {
    // C++ behavior: reveals buildable tech or resets enemy tech level
    // TS behavior: falls to default case — no effect
    const hasStek = /case\s+['"]STEK['"]/.test(spyMethod);
    expect(
      hasStek,
      'STEK should have its own case in spyInfiltrate for tech effects',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Spy consumption — spy dies after infiltration (both C++ and TS agree)
// ---------------------------------------------------------------------------

describe('Spy consumption after infiltration', () => {
  it('spy should be killed after infiltration (alive=false, mission=DIE)', () => {
    // Both C++ and TS should consume the spy
    const killsSpy = /spy\.alive\s*=\s*false/.test(spyMethod) &&
                     /spy\.mission\s*=\s*Mission\.DIE/.test(spyMethod);
    expect(killsSpy, 'spy should be consumed (alive=false, mission=DIE) after infiltration').toBe(true);
  });

  it('spy disguise should be cleared on infiltration', () => {
    const clearsDisguise = /spy\.disguisedAs\s*=\s*null/.test(spyMethod);
    expect(clearsDisguise, 'spy disguise should be cleared on infiltration').toBe(true);
  });

  it('spy trigger name should be cleared before death (prevent TEVENT_DESTROYED)', () => {
    // C++ parity: clear trigger so spy death doesn't fire destroy events
    const clearsTrigger = /spy\.triggerName\s*=\s*undefined/.test(spyMethod);
    expect(clearsTrigger, 'spy triggerName should be cleared before death').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Thief vs Spy credit theft distinction
//     C++ has TWO different credit-theft paths:
//     - Thief (THF): infiltrates PROC/SILO, steals 50% of houseCredits
//     - Spy on PROC: steals 50% of enemy Credits (player credits)
//     The TS Thief implementation correctly steals, but Spy on PROC does not.
// ---------------------------------------------------------------------------

describe('Thief vs Spy credit theft — both should steal (C++ parity)', () => {
  const specialUnitsSrc = fs.readFileSync(
    path.resolve(__dirname, '../engine/specialUnits.ts'),
    'utf-8',
  );

  it('Thief correctly steals 50% credits from PROC/SILO (baseline)', () => {
    // Thief implementation in specialUnits.ts IS correct
    const thiefSteals = /enemyCredits\s*\*\s*0\.5|Math\.floor.*0\.5/.test(specialUnitsSrc);
    expect(thiefSteals, 'Thief should steal 50% of enemy credits').toBe(true);
  });

  it('Spy on PROC should ALSO steal credits (distinct from Thief)', () => {
    // In C++, spy infiltrating PROC steals half credits (house.cpp:2612-2620)
    // This is separate from the Thief unit which uses infantry.cpp enter logic
    const procSection = spyMethod.slice(
      spyMethod.indexOf("case 'PROC'"),
      spyMethod.indexOf("case 'DOME'"),
    );
    const spySteals = /credit|stolen|steal/i.test(procSection);
    expect(
      spySteals,
      'Spy infiltrating PROC should steal credits per C++ house.cpp:2612-2620',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. Building type coverage — all C++ spy-target building types accounted for
// ---------------------------------------------------------------------------

describe('Spy infiltration building type coverage', () => {
  const cppBuildingTypes = [
    'PROC', 'SILO', 'BARR', 'TENT', 'WEAP', 'POWR', 'APWR',
    'DOME', 'SPEN', 'SYRD', 'ATEK', 'STEK',
  ];

  for (const btype of cppBuildingTypes) {
    it(`${btype} should have an explicit case in spyInfiltrate`, () => {
      const hasCase = new RegExp(`case\\s+['"]${btype}['"]`).test(spyMethod);
      expect(
        hasCase,
        `${btype} should have an explicit case (not fall to default)`,
      ).toBe(true);
    });
  }
});
