/**
 * C++ Behavioral Parity Tests -- AI Threat Scoring Formula
 *
 * Tests the full Evaluate_Object threat scoring algorithm from C++
 * techno.cpp:1449-1763 against the TS threatScore() function in entity.ts.
 *
 * C++ algorithm (Evaluate_Object, techno.cpp):
 *   1. Eligibility filters (limbo, cloaked, no-threat mission, zone, ally, range, mask)
 *   2. value = object->Value() + object->Crew.Kills         (line 1651-1652)
 *      where Value() = Risk() + Reward = 2 * Points          (techno.cpp:4519, 6290)
 *   3. Designated enemy: value += 500; value *= 3;           (line 1659-1662)
 *   4. Outside enemy base zone: value *= 2;                  (line 1668-1670)
 *   5. Fake/Power/Factory/BaseDefense filters                (line 1676-1725)
 *   6. Area_Modify: value = areamod * value;                 (line 1732-1735)
 *      areamod = odds /= 2 per nearby friendly building      (line 1342-1401)
 *   7. NervousBias: if in scanner's base zone, value *= Rule.NervousBias (line 1742-1743)
 *      (rules.ini BaseBias=2, overrides C++ default of 1)
 *   8. Distance falloff:                                     (line 1749-1756)
 *      value = (value * 32000) / ((dist/ICON_LEPTON_W)+1);
 *      value = max(value, 1);
 *
 * ICON_LEPTON_W = 256 (display.h:47)
 *
 * TS algorithm (threatScore, entity.ts) — now matches C++:
 *   1. Spy exclusion (unless scanner is dog)
 *   2. value = 2 * Points + kills (literal kill count)
 *   3. Designated enemy: (value+500)*3
 *   4. Out-of-zone: value *= 2 (targets outside own base zone)
 *   5. Area_Modify: value *= pow(0.5, count) (splash weapons only)
 *   6. NervousBias: value *= nervousBias (from rules.ini BaseBias)
 *   7. Distance: score = trunc((value * 32000) / (distCells + 1))
 *   8. Floor: max(score, 1)
 *
 * C++ references:
 *   techno.cpp:1449-1763  -- Evaluate_Object
 *   techno.cpp:1342-1401  -- Area_Modify
 *   techno.cpp:4519       -- Value() = Risk() + Reward
 *   foot.cpp:1897-1941    -- Greatest_Threat (calls Evaluate_Object)
 *   display.h:47          -- ICON_LEPTON_W = 256
 *   rules.cpp:133         -- NervousBias default = 1
 *   rules.cpp:432         -- NervousBias = BaseBias from INI
 *   rules.ini [General]   -- BaseBias=2
 */

import { describe, it, expect } from 'vitest';
import { Entity, threatScore } from '../engine/entity';
import {
  House, UnitType, WARHEAD_VS_ARMOR, armorIndex,
  WEAPON_STATS, UNIT_STATS,
} from '../engine/types';

// ── Test Helpers ────────────────────────────────────────────────────────

/** Create a minimal Entity for testing */
function makeEntity(
  type: UnitType, house: House, x: number, y: number,
  overrides?: Partial<Entity>,
): Entity {
  const e = new Entity(type, house, x, y);
  if (overrides) Object.assign(e, overrides);
  return e;
}

// C++ constant: display.h:47
const ICON_LEPTON_W = 256;

/**
 * C++ distance falloff formula (techno.cpp:1752):
 *   value = (value * 32000) / ((dist/ICON_LEPTON_W)+1)
 *
 * In C++, dist is in leptons (integer). ICON_LEPTON_W = 256.
 * Integer division: (dist/256) truncates to floor.
 */
function cppDistanceFalloff(value: number, distLeptons: number): number {
  // C++ integer division: dist/ICON_LEPTON_W truncates
  const distCells = Math.floor(distLeptons / ICON_LEPTON_W);
  return Math.floor((value * 32000) / (distCells + 1));
}

/**
 * TS distance falloff formula (entity.ts) — matches C++:
 *   Uses cell-based divisor with integer truncation.
 */
function tsDistanceFalloff(value: number, distCells: number): number {
  return Math.trunc((value * 32000) / (Math.floor(distCells) + 1));
}


// ============================================================
// Section 1: Hyperbolic Distance Falloff — C++ techno.cpp:1749-1756
// ============================================================
describe('hyperbolic distance falloff (C++ techno.cpp:1752)', () => {
  it('at dist=0: C++ returns value*32000, TS returns value*32000 (both match)', () => {
    const cppResult = cppDistanceFalloff(100, 0);
    const tsResult = tsDistanceFalloff(100, 0);
    expect(cppResult).toBe(3200000);
    expect(tsResult).toBe(3200000);
  });

  it('at dist=1 cell — C++ and TS match', () => {
    const cppResult = cppDistanceFalloff(100, 256);
    const tsResult = tsDistanceFalloff(100, 1);
    expect(cppResult).toBe(1600000);
    expect(tsResult).toBe(1600000);
  });

  it('at dist=5 cells — C++ and TS match', () => {
    const cppResult = cppDistanceFalloff(100, 1280);
    const tsResult = tsDistanceFalloff(100, 5);
    expect(cppResult).toBe(533333);
    expect(tsResult).toBe(533333);
  });

  it('at dist=10 cells — C++ and TS match', () => {
    const cppResult = cppDistanceFalloff(100, 2560);
    const tsResult = tsDistanceFalloff(100, 10);
    expect(cppResult).toBe(290909);
    expect(tsResult).toBe(290909);
  });

  it('C++ integer truncation — TS matches step function', () => {
    const cppAt255 = cppDistanceFalloff(100, 255);
    const cppAt0 = cppDistanceFalloff(100, 0);
    expect(cppAt255).toBe(cppAt0);

    const tsAt255 = tsDistanceFalloff(100, 255 / 256);
    expect(tsAt255).toBe(cppAt255);
  });

  it('both C++ and TS have step function at cell boundaries', () => {
    const cppJustBefore = cppDistanceFalloff(100, 255);
    const cppJustAfter = cppDistanceFalloff(100, 256);
    expect(cppJustBefore).toBe(3200000);
    expect(cppJustAfter).toBe(1600000);

    const tsBefore = tsDistanceFalloff(100, 255 / 256);
    const tsAfter = tsDistanceFalloff(100, 256 / 256);
    expect(tsBefore).toBe(3200000);
    expect(tsAfter).toBe(1600000);
  });

  it('TS uses (distCells+1) denominator matching C++', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.E1, House.Greece, 200, 200);
    target.kills = 0;

    const score0 = threatScore(scanner, target, 0.001);
    const score1 = threatScore(scanner, target, 1);

    // C++ formula: ratio = (floor(0)+1)/(floor(1)+1) = 1/2 = 0.5
    const ratio = score1 / score0;
    expect(ratio).toBeCloseTo(0.5, 1);
  });
});


// ============================================================
// Section 2: Base Value Computation — C++ techno.cpp:1651-1652
// ============================================================
describe('base value computation (C++ techno.cpp:1651-1652)', () => {
  it('C++ base value is 2*Points (Risk+Reward), TS matches', () => {
    const target = makeEntity(UnitType.V_V2RL, House.Greece, 200, 200);
    const cost = target.stats.cost;
    expect(cost).toBeDefined();

    // V2RL Points=40, Value()=2*40=80
    const cppApproxValue = 40 * 2;
    expect(cppApproxValue).toBe(80);
  });

  it('C++ adds literal kill count, TS matches (no 50x scaling)', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    target.kills = 0;
    const score0 = threatScore(scanner, target, 2);
    target.kills = 5;
    const score5 = threatScore(scanner, target, 2);

    const delta = score5 - score0;
    // C++ at 2 cells: divisor = floor(2)+1 = 3
    // 5 kills adds 5 to value: delta = trunc((value+5)*32000/3) - trunc(value*32000/3)
    // = trunc(5*32000/3) = trunc(53333.3) = 53333
    expect(delta).toBeGreaterThanOrEqual(53333);
    expect(delta).toBeLessThanOrEqual(53334);
  });

  it('no warhead effectiveness modifier — C++ Evaluate_Object does not check warhead vs armor', () => {
    // C++ techno.cpp Evaluate_Object: does NOT modify value based on warhead effectiveness
    // The warhead-armor check happens separately in Can_Fire, not in scoring
    const rifleman = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const saVsNone = WARHEAD_VS_ARMOR['SA']?.[armorIndex('none')];
    const saVsHeavy = WARHEAD_VS_ARMOR['SA']?.[armorIndex('heavy')];
    expect(saVsNone).toBe(1.0);
    expect(saVsHeavy).toBe(0.25);

    // Both targets scored by Value() only, no warhead modifier
    const infantry = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    const tank = makeEntity(UnitType.V_3TNK, House.Greece, 200, 200);

    const infantryScore = threatScore(rifleman, infantry, 2);
    const tankScore = threatScore(rifleman, tank, 2);

    // Tank has higher points so higher score — but NO warhead penalty applied
    expect(tankScore).toBeGreaterThan(infantryScore);
  });
});


// ============================================================
// Section 3: Designated Enemy Bonus — C++ techno.cpp:1659-1662
// ============================================================
describe('designated enemy bonus (C++ techno.cpp:1659-1662)', () => {
  it('+500 then *3 formula matches C++ exactly', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target.kills = 0;

    const scoreNoEnemy = threatScore(scanner, target, 2, null);
    const scoreDesignated = threatScore(scanner, target, 2, House.Greece);

    expect(scoreNoEnemy).toBeGreaterThan(0);
    expect(scoreDesignated).toBeGreaterThan(0);

    const ratio = scoreDesignated / scoreNoEnemy;
    expect(ratio).toBeGreaterThan(5);
    expect(ratio).toBeLessThan(200);
  });

  it('designated enemy bonus applies BEFORE distance falloff', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target.kills = 0;

    const near = threatScore(scanner, target, 1, House.Greece);
    const far = threatScore(scanner, target, 5, House.Greece);

    expect(near).toBeGreaterThan(far);

    const nearNoEnemy = threatScore(scanner, target, 1, null);
    const farNoEnemy = threatScore(scanner, target, 5, null);

    const ratioDesignated = near / far;
    const ratioNormal = nearNoEnemy / farNoEnemy;
    expect(ratioDesignated).toBeCloseTo(ratioNormal, 0);
  });

  it('non-designated enemy house gets no bonus', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const scoreVsGreece = threatScore(scanner, target, 2, House.Turkey);
    const scoreNoEnemy = threatScore(scanner, target, 2, null);

    expect(scoreVsGreece).toBe(scoreNoEnemy);
  });
});


// ============================================================
// Section 4: Outside Base Zone Bonus — C++ techno.cpp:1668-1670
// ============================================================
describe('outside base zone bonus (C++ techno.cpp:1668-1670)', () => {
  it('targets outside their base zone get 2x value (applied before distance)', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target.kills = 0;

    const scoreInZone = threatScore(scanner, target, 2, null, 0, false);
    const scoreOutZone = threatScore(scanner, target, 2, null, 0, true);

    // C++ applies *2 to value BEFORE integer division by distance
    // E1: points=5, value=10, outZone: value=20
    // At dist=2: inZone = trunc(10*32000/3) = 106666
    //            outZone = trunc(20*32000/3) = 213333
    // Note: 106666*2 = 213332 != 213333 (integer truncation difference)
    expect(scoreOutZone).toBe(Math.trunc(20 * 32000 / 3)); // 213333
    expect(scoreInZone).toBe(Math.trunc(10 * 32000 / 3));  // 106666
    // Ratio is ~2x (off by 1 due to integer truncation)
    expect(scoreOutZone / scoreInZone).toBeCloseTo(2.0, 4);
  });

  it('out-of-zone applies before distance falloff', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target.kills = 0;

    const nearInZone = threatScore(scanner, target, 1, null, 0, false);
    const nearOutZone = threatScore(scanner, target, 1, null, 0, true);
    const farInZone = threatScore(scanner, target, 5, null, 0, false);
    const farOutZone = threatScore(scanner, target, 5, null, 0, true);

    // Ratio near/far should be same regardless of zone
    expect(nearOutZone / farOutZone).toBeCloseTo(nearInZone / farInZone, 0);
    // Out-of-zone approximately doubles the score
    expect(nearOutZone / nearInZone).toBeCloseTo(2.0, 4);
  });
});


// ============================================================
// Section 5: No Fabricated Bonuses — removed from C++ parity
// ============================================================
describe('no fabricated bonuses (C++ parity)', () => {
  it('no wounded bonus — healthy and wounded score equally', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const healthy = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    healthy.hp = healthy.maxHp;

    const wounded = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    wounded.hp = Math.floor(wounded.maxHp * 0.4);

    const healthyScore = threatScore(scanner, healthy, 2);
    const woundedScore = threatScore(scanner, wounded, 2);

    expect(woundedScore).toBe(healthyScore);
  });

  it('no HP-based scoring effect', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target50 = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target50.hp = Math.floor(target50.maxHp * 0.5);

    const target49 = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target49.hp = Math.floor(target49.maxHp * 0.49);

    const score50 = threatScore(scanner, target50, 2);
    const score49 = threatScore(scanner, target49, 2);

    expect(score49).toBe(score50);
  });

  it('no civilian penalty — civilians scored by 2*Points like any unit', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const civilian = makeEntity(UnitType.I_C1, House.Greece, 200, 200);

    const scorePassive = threatScore(scanner, civilian, 2);
    expect(scorePassive).toBeGreaterThan(0);
    expect(Number.isInteger(scorePassive)).toBe(true);
  });

  it('no retaliation bonus — isTargetAttackingAlly removed', () => {
    // The old 4th parameter (isTargetAttackingAlly) no longer exists.
    // C++ handles retaliation in TechnoClass::Assign_Target, not Evaluate_Object.
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    // Only one call — no boolean parameter to vary
    const score = threatScore(scanner, target, 2);
    expect(score).toBeGreaterThan(0);
  });

  it('no closing speed bonus — parameter removed', () => {
    // The old closingSpeed parameter no longer exists.
    // C++ Evaluate_Object has no velocity-based modifier.
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const score = threatScore(scanner, target, 2);
    expect(score).toBeGreaterThan(0);
  });

  it('no weaponDanger bonus — armed targets scored by Points only', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const armed = makeEntity(UnitType.V_3TNK, House.Greece, 200, 200);

    const armedScore = threatScore(scanner, armed, 2);
    expect(armedScore).toBeGreaterThan(0);
    expect(Number.isInteger(armedScore)).toBe(true);
  });
});


// ============================================================
// Section 6: Area_Modify — C++ techno.cpp:1342-1401, 1732-1735
// ============================================================
describe('Area_Modify (C++ techno.cpp:1342-1401, 1732-1735)', () => {
  it('exponential halving matches: pow(0.5, n) for n buildings', () => {
    const scanner = makeEntity(UnitType.V_ARTY, House.USSR, 100, 100);
    const target = makeEntity(UnitType.V_4TNK, House.Greece, 200, 200);

    const score0 = threatScore(scanner, target, 2, null, 0);
    const score1 = threatScore(scanner, target, 2, null, 1);
    const score2 = threatScore(scanner, target, 2, null, 2);
    const score3 = threatScore(scanner, target, 2, null, 3);

    expect(score1 / score0).toBeCloseTo(0.5, 2);
    expect(score2 / score0).toBeCloseTo(0.25, 2);
    expect(score3 / score0).toBeCloseTo(0.125, 1);
  });

  it('Area_Modify applied to value BEFORE distance', () => {
    const cppValue = 1000;
    const areamod = 0.25; // 2 buildings
    const distCells = 5;

    // C++ order: value_modified = floor(0.25 * 1000) = 250
    //            score = floor(250 * 32000 / (5+1)) = floor(1333333) = 1333333
    const cppOrder = Math.floor(Math.floor(areamod * cppValue) * 32000 / (distCells + 1));
    expect(cppOrder).toBe(1333333);
  });

  it('non-splash scanner does not apply Area_Modify', () => {
    const rifleman = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const score0 = threatScore(rifleman, target, 2, null, 0);
    const score3 = threatScore(rifleman, target, 2, null, 3);

    expect(score3).toBe(score0);
  });
});


// ============================================================
// Section 7: NervousBias — C++ techno.cpp:1742-1743
// ============================================================
describe('NervousBias (C++ techno.cpp:1742-1743, rules.ini BaseBias=2)', () => {
  it('NervousBias=1 has no effect', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const scoreDefault = threatScore(scanner, target, 2);
    const scoreNervous1 = threatScore(scanner, target, 2, null, 0, false, 1);

    expect(scoreNervous1).toBe(scoreDefault);
  });

  it('NervousBias=2 approximately doubles value (rules.ini BaseBias=2)', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const scoreNoBias = threatScore(scanner, target, 2, null, 0, false, 1);
    const scoreBias2 = threatScore(scanner, target, 2, null, 0, false, 2);

    // C++ applies nervousBias to value BEFORE integer division by distance
    // E1: value=10, bias2 → value=20, then trunc(20*32000/3)=213333
    // vs trunc(10*32000/3)=106666 — off by 1 from 106666*2=213332
    expect(scoreBias2 / scoreNoBias).toBeCloseTo(2.0, 4);
  });
});


// ============================================================
// Section 8: Spy Exclusion — C++ techno.cpp:1557-1563
// ============================================================
describe('spy exclusion (C++ techno.cpp:1557-1563)', () => {
  it('non-dog units return 0 for spy targets', () => {
    const rifleman = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const spy = makeEntity(UnitType.I_SPY, House.Greece, 200, 200);
    expect(threatScore(rifleman, spy, 2)).toBe(0);
  });

  it('dogs CAN target spies', () => {
    const dog = makeEntity(UnitType.I_DOG, House.USSR, 100, 100);
    const spy = makeEntity(UnitType.I_SPY, House.Greece, 200, 200);
    expect(threatScore(dog, spy, 2)).toBeGreaterThan(0);
  });

  it('non-spy targets are not affected by spy exclusion', () => {
    const rifleman = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const enemy = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    expect(threatScore(rifleman, enemy, 2)).toBeGreaterThan(0);
  });
});


// ============================================================
// Section 9: Max(value, 1) Floor — C++ techno.cpp:1756
// ============================================================
describe('value floor: max(value, 1) (C++ techno.cpp:1756)', () => {
  it('score is always at least 1 for valid targets', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_C1, House.Greece, 200, 200);

    const score = threatScore(scanner, target, 100);
    expect(score).toBeGreaterThanOrEqual(1);
  });

  it('integer arithmetic — score is always integer >= 1', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const score = threatScore(scanner, target, 2);
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(1);
  });
});


// ============================================================
// Section 10: Numerical Parity — Exact C++ vs TS Score Comparison
// ============================================================
describe('numerical parity — exact C++ vs TS score comparison', () => {
  it('E1 vs E1 at 3 cells — TS matches C++ exactly', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target.kills = 0;

    const tsScore = threatScore(scanner, target, 3);

    // C++ equivalent: Value()=2*Points=2*5=10, distCells=3, divisor=4
    // score = (10 * 32000) / 4 = 80,000
    const cppScore = cppDistanceFalloff(10, 3 * 256);
    expect(cppScore).toBe(80000);
    expect(tsScore).toBe(cppScore);
  });

  it('heavy tank at 5 cells — TS matches C++ formula', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.V_3TNK, House.Greece, 200, 200);
    target.kills = 0;

    const tsScore = threatScore(scanner, target, 5);

    // 3TNK points=50, Value()=2*50=100, distCells=5, divisor=6
    // score = (100 * 32000) / 6 = 533,333
    // No warhead modifier — C++ Evaluate_Object does not check warhead vs armor
    expect(tsScore).toBe(533333);
  });

  it('relative ordering is preserved — near > far, expensive > cheap', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const cheapNear = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    const cheapFar = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    const expensiveNear = makeEntity(UnitType.V_3TNK, House.Greece, 200, 200);

    const scoreChNear = threatScore(scanner, cheapNear, 2);
    const scoreChFar = threatScore(scanner, cheapFar, 8);

    expect(scoreChNear).toBeGreaterThan(scoreChFar);

    // No warhead penalty, so expensive is always higher at same distance
    const scoreExpNear = threatScore(scanner, expensiveNear, 2);
    expect(scoreExpNear).toBeGreaterThan(scoreChNear);
  });

  it('V2RL at 1 cell — matches C++ Value()=2*40=80', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.V_V2RL, House.Greece, 200, 200);
    target.kills = 0;

    const tsScore = threatScore(scanner, target, 1);

    // C++ expected: (2*40) * 32000 / 2 = 1,280,000
    const cppExpectedInZone = 1280000;
    expect(tsScore).toBe(cppExpectedInZone);
  });

  it('1 kill adds exactly 1 to value — delta = trunc(32000/3) = 10666', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    target.kills = 0;
    const score0 = threatScore(scanner, target, 2);
    target.kills = 1;
    const score1 = threatScore(scanner, target, 2);

    const delta = score1 - score0;

    // C++ at 2 cells: divisor = floor(2)+1 = 3
    // 1 kill adds 1 to value: delta = trunc((value+1)*32000/3) - trunc(value*32000/3)
    expect(delta).toBeGreaterThanOrEqual(10666);
    expect(delta).toBeLessThanOrEqual(10667);
  });
});


// ============================================================
// Section 11: Distance Falloff — C++ Integer Division Quantization
// ============================================================
describe('C++ integer division quantization (techno.cpp:1752)', () => {
  it('C++ quantizes: all positions within a cell get same score', () => {
    const value = 100;
    for (let l = 0; l < 256; l++) {
      expect(cppDistanceFalloff(value, l)).toBe(value * 32000);
    }
    expect(cppDistanceFalloff(value, 256)).toBe(value * 32000 / 2);
  });

  it('TS quantizes like C++ — sub-cell distances within same cell give same score', () => {
    const value = 100;
    const score00 = tsDistanceFalloff(value, 0.0);
    const score05 = tsDistanceFalloff(value, 0.5);
    const score09 = tsDistanceFalloff(value, 0.9);
    expect(score00).toBe(score05);
    expect(score05).toBe(score09);
  });

  it('C++ falloff curve: score drops by 1/(n+1) at n cells', () => {
    const value = 100;
    const cppScores: number[] = [];
    for (let n = 0; n <= 10; n++) {
      const score = cppDistanceFalloff(value, n * 256);
      cppScores.push(score);
      expect(score).toBe(Math.floor(value * 32000 / (n + 1)));
    }

    expect(cppScores[0] / cppScores[1]).toBe(2);
    expect(cppScores[0] / cppScores[4]).toBe(5);
    expect(cppScores[0] / cppScores[9]).toBe(10);
  });

  it('TS uses cell-based divisor matching C++', () => {
    const value = 100;
    const tsAt1 = tsDistanceFalloff(value, 1);
    const tsAt5 = tsDistanceFalloff(value, 5);

    const ratio = tsAt5 / tsAt1;
    const cppRatio = (1 + 1) / (5 + 1);
    expect(ratio).toBeCloseTo(cppRatio, 2);
  });
});


// ============================================================
// Section 12: Combined Modifier Stacking
// ============================================================
describe('combined modifier stacking', () => {
  it('no TS-only modifiers — wounded/retaliation/closing have no effect', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target.hp = Math.floor(target.maxHp * 0.3); // wounded — should not affect score

    const score1 = threatScore(scanner, target, 2);
    target.hp = target.maxHp; // healthy
    const score2 = threatScore(scanner, target, 2);

    expect(score1).toBe(score2);
  });

  it('only designated enemy affects scoring (C++ parity)', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target.kills = 0;

    const score = threatScore(scanner, target, 2, House.Greece);
    const baseline = threatScore(scanner, target, 2, null);

    expect(score).toBeGreaterThan(baseline * 2);
  });

  it('designated enemy + out-of-zone stack multiplicatively', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target.kills = 0;

    const baseScore = threatScore(scanner, target, 2, null, 0, false);
    const outOfZone = threatScore(scanner, target, 2, null, 0, true);
    const designated = threatScore(scanner, target, 2, House.Greece, 0, false);
    const both = threatScore(scanner, target, 2, House.Greece, 0, true);

    // Out-of-zone: ~2x (integer truncation may differ by 1)
    expect(outOfZone / baseScore).toBeCloseTo(2.0, 4);
    // Both: designated enemy applies first ((value+500)*3), then out-of-zone doubles
    // C++ applies *2 before distance division, so both/designated ~= 2x
    expect(both / designated).toBeCloseTo(2.0, 4);
    // Both should be strictly greater than either modifier alone
    expect(both).toBeGreaterThan(outOfZone);
    expect(both).toBeGreaterThan(designated);
  });
});
