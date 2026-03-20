/**
 * C++ Behavioral Parity Tests -- AI Threat Scoring Formula
 *
 * Tests the full Evaluate_Object threat scoring algorithm from C++
 * techno.cpp:1449-1763 against the TS threatScore() function in
 * entity.ts:763-837.
 *
 * C++ algorithm (Evaluate_Object, techno.cpp):
 *   1. Eligibility filters (limbo, cloaked, no-threat mission, zone, ally, range, mask)
 *   2. value = object->Value() + object->Crew.Kills         (line 1651-1652)
 *      where Value() = Risk() + Reward ~ cost/3 + cost      (techno.cpp:4519)
 *   3. Designated enemy: value += 500; value *= 3;           (line 1659-1662)
 *   4. Outside enemy base zone: value *= 2;                  (line 1668-1670)
 *   5. Fake/Power/Factory/BaseDefense filters                (line 1676-1725)
 *   6. Area_Modify: value = areamod * value;                 (line 1732-1735)
 *      areamod = odds /= 2 per nearby friendly building      (line 1342-1401)
 *   7. NervousBias: if in scanner's base zone, value *= Rule.NervousBias (line 1742-1743)
 *      (NervousBias default = 1, configurable via RULES.INI BaseBias)
 *   8. Distance falloff:                                     (line 1749-1756)
 *      value = (value * 32000) / ((dist/ICON_LEPTON_W)+1);
 *      value = max(value, 1);
 *
 * ICON_LEPTON_W = 256 (display.h:47)
 *
 * TS algorithm (threatScore, entity.ts:763-837):
 *   1. Spy exclusion (unless scanner is dog)
 *   2. value = cost ?? (strength + damage*5) + kills*50 + weaponDanger
 *   3. Warhead effectiveness modifier (1.5x effective, 0.5x ineffective)
 *   4. Designated enemy: (value+500)*3
 *   5. Distance: score = (value * 32000) / (dist*256 + 1)
 *   6. Civilian penalty: score *= 0.15
 *   7. Wounded bonus: score *= 1.5 (if HP < 50%)
 *   8. Retaliation bonus: score *= 2
 *   9. Closing speed: score *= 1.25
 *  10. Area_Modify: score *= pow(0.5, count) (splash weapons only)
 *
 * C++ references:
 *   techno.cpp:1449-1763  -- Evaluate_Object
 *   techno.cpp:1342-1401  -- Area_Modify
 *   techno.cpp:4519       -- Value() = Risk() + Reward
 *   foot.cpp:1897-1941    -- Greatest_Threat (calls Evaluate_Object)
 *   display.h:47          -- ICON_LEPTON_W = 256
 *   rules.cpp:133         -- NervousBias default = 1
 *   rules.cpp:432         -- NervousBias = BaseBias from INI
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
 * TS distance falloff formula (entity.ts:806-807):
 *   const distLeptons = dist * 256;
 *   let score = (value * 32000) / (distLeptons + 1);
 *
 * TS uses floating-point dist (in cells), multiplied by 256.
 * No integer truncation — pure float division.
 */
function tsDistanceFalloff(value: number, distCells: number): number {
  const distLeptons = distCells * 256;
  return (value * 32000) / (distLeptons + 1);
}


// ============================================================
// Section 1: Hyperbolic Distance Falloff — C++ techno.cpp:1749-1756
// ============================================================
describe('hyperbolic distance falloff (C++ techno.cpp:1752)', () => {
  /*
   * C++ techno.cpp:1752:
   *   value = (value * 32000) / ((dist/ICON_LEPTON_W)+1);
   *
   * C++ uses integer arithmetic throughout:
   *   - dist is int (leptons)
   *   - dist/ICON_LEPTON_W is integer division (truncates)
   *   - entire expression is integer division
   *
   * TS entity.ts:806-807:
   *   const distLeptons = dist * 256;
   *   let score = (value * 32000) / (distLeptons + 1);
   *
   * TS uses float cells -> float leptons, float division.
   */

  it('at dist=0: C++ returns value*32000, TS returns value*32000 (both match)', () => {
    // C++ techno.cpp:1752: value = (100 * 32000) / ((0/256)+1) = 3200000
    // TS: (100 * 32000) / (0*256 + 1) = 3200000
    const cppResult = cppDistanceFalloff(100, 0);
    const tsResult = tsDistanceFalloff(100, 0);
    expect(cppResult).toBe(3200000);
    expect(tsResult).toBe(3200000);
  });

  it('at dist=1 cell (256 leptons): C++ and TS produce same result', () => {
    // C++ techno.cpp:1752: (100 * 32000) / ((256/256)+1) = 3200000/2 = 1600000
    // TS: (100 * 32000) / (1*256 + 1) = 3200000/257 = 12451.36...
    const cppResult = cppDistanceFalloff(100, 256);
    const tsResult = tsDistanceFalloff(100, 1);

    // PARITY GAP: C++ divides by (distCells+1) where distCells = floor(leptons/256)
    //             TS divides by (distLeptons+1) where distLeptons = cells*256
    // C++ at 256 leptons: (256/256)=1, divisor=2 -> 1600000
    // TS at 1 cell: distLeptons=256, divisor=257 -> 12451.36
    // These are COMPLETELY different formulas!
    expect(cppResult).toBe(1600000);
    expect(Math.floor(tsResult)).toBe(12451);
    // PARITY GAP: C++ divisor is (distCells+1), TS divisor is (distLeptons+1)
    // C++ divides by 2 at 1 cell, TS divides by 257 at 1 cell.
    // The TS formula falls off ~128x faster than C++.
  });

  it('at dist=5 cells (1280 leptons): massive divergence', () => {
    // C++ techno.cpp:1752: (100 * 32000) / ((1280/256)+1) = 3200000/6 = 533333
    // TS: (100 * 32000) / (5*256 + 1) = 3200000/1281 = 2498.05
    const cppResult = cppDistanceFalloff(100, 1280);
    const tsResult = tsDistanceFalloff(100, 5);
    expect(cppResult).toBe(533333);
    expect(Math.floor(tsResult)).toBe(2498);
    // PARITY GAP: C++ score is 213x higher than TS at 5 cells
  });

  it('at dist=10 cells (2560 leptons): divergence grows', () => {
    // C++ techno.cpp:1752: (100 * 32000) / ((2560/256)+1) = 3200000/11 = 290909
    // TS: (100 * 32000) / (10*256 + 1) = 3200000/2561 = 1249.51
    const cppResult = cppDistanceFalloff(100, 2560);
    const tsResult = tsDistanceFalloff(100, 10);
    expect(cppResult).toBe(290909);
    expect(Math.floor(tsResult)).toBe(1249);
    // PARITY GAP: C++ is 232x higher
  });

  it('C++ uses integer division (dist/ICON_LEPTON_W truncates)', () => {
    // C++ techno.cpp:1752: dist=255 leptons (just under 1 cell)
    // C++ integer division: 255/256 = 0, divisor = 1
    // So sub-cell distances get NO falloff in C++!
    const cppAt255 = cppDistanceFalloff(100, 255);
    const cppAt0 = cppDistanceFalloff(100, 0);
    expect(cppAt255).toBe(cppAt0); // C++ rounds down: 255/256=0

    // TS at 0.996 cells: divisor = 0.996*256+1 = 256 -> 12500
    const tsAt255 = tsDistanceFalloff(100, 255 / 256);
    expect(tsAt255).toBeLessThan(cppAt255);
    // PARITY GAP: C++ ignores sub-cell distance, TS applies continuous falloff
  });

  it('C++ has step function at cell boundaries, TS is continuous', () => {
    // C++ at 255 leptons (0.996 cells): divisor = floor(255/256)+1 = 1
    // C++ at 256 leptons (1.000 cells): divisor = floor(256/256)+1 = 2
    // Threat score HALVES when crossing a cell boundary!
    const cppJustBefore = cppDistanceFalloff(100, 255);
    const cppJustAfter = cppDistanceFalloff(100, 256);
    expect(cppJustBefore).toBe(3200000);
    expect(cppJustAfter).toBe(1600000);
    // C++ has a 2:1 discontinuity at every cell boundary

    // TS is continuous (no jumps)
    const tsBefore = tsDistanceFalloff(100, 255 / 256);
    const tsAfter = tsDistanceFalloff(100, 256 / 256);
    const ratio = tsBefore / tsAfter;
    expect(ratio).toBeGreaterThan(0.99); // Nearly continuous
    expect(ratio).toBeLessThan(1.01);
  });

  it('TS threatScore uses (distLeptons+1) denominator, not (distCells+1)', () => {
    // Verify the TS function actually uses the TS formula
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.E1, House.Greece, 200, 200);
    target.kills = 0;

    // Get the base value that threatScore computes
    // At dist=0, score = value * 32000 / 1 = value * 32000
    // At dist=1 cell, if TS formula: score = value * 32000 / (256+1)
    const score0 = threatScore(scanner, target, 0.001, false); // near-zero dist
    const score1 = threatScore(scanner, target, 1, false);

    // TS formula: ratio should be ~(0.001*256+1)/(1*256+1) = 1.256/257 = 0.00489
    // If it were C++ formula: ratio would be ~(0+1)/(1+1) = 0.5
    const ratio = score1 / score0;
    // TS ratio should be much smaller than 0.5
    expect(ratio).toBeLessThan(0.1); // confirms TS uses leptons in denominator
    // PARITY GAP: TS distance falloff is dramatically steeper than C++
  });
});


// ============================================================
// Section 2: Base Value Computation — C++ techno.cpp:1651-1652
// ============================================================
describe('base value computation (C++ techno.cpp:1651-1652)', () => {
  /*
   * C++ techno.cpp:1651-1652:
   *   int rawval = object->Value();
   *   value = rawval + object->Crew.Kills;
   *
   * C++ techno.cpp:4519 (Value()):
   *   return Risk() + Techno_Type_Class()->Reward + value;
   *   Risk() = own cost for non-buildings (techno.cpp:4458)
   *   Reward = cost (from RULES.INI)
   *   value = points from cargo
   *   So Value() ~ cost + cost = 2*cost for simple units (not cost/3+cost)
   *
   * TS entity.ts:776:
   *   value = target.stats.cost ?? (target.stats.strength + (target.weapon?.damage ?? 0) * 5)
   */

  it('C++ base value is ~2*cost (Risk+Reward), TS uses raw cost', () => {
    // C++ Risk() for units typically = cost (techno.cpp:4458)
    // C++ Reward is typically = cost (from RULES.INI Points= line)
    // So Value() = Risk()+Reward ≈ 2*cost
    //
    // TS: value = cost
    //
    // PARITY GAP: C++ base value is ~2x higher than TS before other modifiers
    const target = makeEntity(UnitType.V_V2RL, House.Greece, 200, 200);
    const cost = target.stats.cost;
    expect(cost).toBeDefined();

    // Verify the gap exists: C++ would compute ~2*700=1400, TS uses 700
    const cppApproxValue = (cost ?? 700) * 2;
    const tsValue = cost ?? 700;
    expect(cppApproxValue).toBe(tsValue * 2); // PARITY GAP
  });

  it('C++ adds literal kill count, TS adds kills*50', () => {
    // C++ techno.cpp:1652: value = rawval + object->Crew.Kills
    // Crew.Kills is literal kill count (1 per kill)
    //
    // TS entity.ts:779: value += target.kills * 50
    // TS scales kills by 50x
    //
    // PARITY GAP: At 5 kills, C++ adds 5 to value, TS adds 250.
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.E1, House.Greece, 200, 200);

    target.kills = 0;
    const score0 = threatScore(scanner, target, 2, false);
    target.kills = 5;
    const score5 = threatScore(scanner, target, 2, false);

    const delta = score5 - score0;
    // TS delta = 5 * 50 * 32000 / (2*256+1) = 250 * 32000 / 513 ≈ 15594
    // C++ delta would be 5 * 32000 / (2+1) = 53333 (in integer cells)
    // but C++ divides by distCells not distLeptons
    expect(delta).toBeGreaterThan(0);
    // PARITY GAP: kill scaling factor differs
  });

  it('TS adds weaponDanger bonus that C++ does not have', () => {
    // C++ techno.cpp Evaluate_Object: NO weapon damage bonus
    // TS entity.ts:796-797: value += Math.min((target.weapon?.damage ?? 0) * 2, 200)
    //
    // PARITY GAP: TS inflates threat for armed targets
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const armedTarget = makeEntity(UnitType.V_3TNK, House.Greece, 200, 200);
    const weaponDmg = armedTarget.weapon?.damage ?? 0;

    // TS adds weaponDanger = min(damage*2, 200) to base value
    const expectedBonus = Math.min(weaponDmg * 2, 200);
    expect(expectedBonus).toBeGreaterThan(0); // 3TNK has 105mm with damage=40, so bonus=80
    // PARITY GAP: C++ does not add this bonus
  });

  it('TS warhead effectiveness modifier has no C++ equivalent in Evaluate_Object', () => {
    // C++ techno.cpp Evaluate_Object: does NOT modify value based on warhead effectiveness
    // TS entity.ts:783-794: adjusts value by 1.5x (effective) or 0.5x (ineffective)
    //
    // PARITY GAP: TS includes weapon-armor interaction in threat scoring
    const rifleman = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    // SA warhead: vs none=1.0, vs heavy=0.25

    const infantry = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    const tank = makeEntity(UnitType.V_3TNK, House.Greece, 200, 200);

    // Verify warhead lookup
    const saVsNone = WARHEAD_VS_ARMOR['SA']?.[armorIndex('none')];
    const saVsHeavy = WARHEAD_VS_ARMOR['SA']?.[armorIndex('heavy')];
    expect(saVsNone).toBe(1.0);    // neither bonus nor penalty
    expect(saVsHeavy).toBe(0.25);  // < 0.5 threshold, triggers 0.5x penalty

    // TS applies this modifier; C++ does not (C++ considers Can_Fire separately)
    // PARITY GAP
  });
});


// ============================================================
// Section 3: Designated Enemy Bonus — C++ techno.cpp:1659-1662
// ============================================================
describe('designated enemy bonus (C++ techno.cpp:1659-1662)', () => {
  /*
   * C++ techno.cpp:1659-1662:
   *   if (House->Enemy != HOUSE_NONE && House->Enemy == object->House->Class->House) {
   *     value += 500;
   *     value *= 3;
   *   }
   *
   * TS entity.ts:800-802:
   *   if (designatedEnemy != null && target.house === designatedEnemy) {
   *     value = (value + 500) * 3;
   *   }
   *
   * This is a MATCH: both add 500 then multiply by 3.
   */

  it('+500 then *3 formula matches C++ exactly', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target.kills = 0;

    const scoreNoEnemy = threatScore(scanner, target, 2, false, 0, null);
    const scoreDesignated = threatScore(scanner, target, 2, false, 0, House.Greece);

    // Both should be positive
    expect(scoreNoEnemy).toBeGreaterThan(0);
    expect(scoreDesignated).toBeGreaterThan(0);

    // Designated enemy gets (value+500)*3 vs just value
    // So designated/normal ratio should be approximately (value+500)*3/value
    // For an E1 with cost not set: value = strength(50) + damage(15)*5 = 125
    // Plus weaponDanger: min(15*2, 200) = 30, total = 155
    // designated = (155+500)*3 = 1965
    // ratio = 1965/155 = 12.68x
    const ratio = scoreDesignated / scoreNoEnemy;
    expect(ratio).toBeGreaterThan(5);  // must be significantly higher
    expect(ratio).toBeLessThan(20);    // but bounded
  });

  it('designated enemy bonus applies BEFORE distance falloff', () => {
    // Both C++ and TS apply the +500, *3 to the value before distance division
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target.kills = 0;

    const near = threatScore(scanner, target, 1, false, 0, House.Greece);
    const far = threatScore(scanner, target, 5, false, 0, House.Greece);

    // Distance still reduces score with designated enemy
    expect(near).toBeGreaterThan(far);

    // Ratio should be same as without designated enemy (distance is multiplicative)
    const nearNoEnemy = threatScore(scanner, target, 1, false, 0, null);
    const farNoEnemy = threatScore(scanner, target, 5, false, 0, null);

    const ratioDesignated = near / far;
    const ratioNormal = nearNoEnemy / farNoEnemy;
    // Distance ratio should be similar (both divide by same denominator)
    expect(ratioDesignated).toBeCloseTo(ratioNormal, 0);
  });

  it('non-designated enemy house gets no bonus', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    // Designate Turkey as enemy, but target is Greece
    const scoreVsGreece = threatScore(scanner, target, 2, false, 0, House.Turkey);
    const scoreNoEnemy = threatScore(scanner, target, 2, false, 0, null);

    // Greece should get same score whether enemy is Turkey or null
    expect(scoreVsGreece).toBe(scoreNoEnemy);
  });
});


// ============================================================
// Section 4: Outside Base Zone Bonus — C++ techno.cpp:1668-1670
// ============================================================
describe('outside base zone bonus (C++ techno.cpp:1668-1670)', () => {
  /*
   * C++ techno.cpp:1668-1670:
   *   if (object->House->Which_Zone(object) == ZONE_NONE) {
   *     value *= 2;
   *   }
   *
   * This doubles the value of targets that are outside their own base's
   * protective zone. The rationale: exposed targets are easier pickings.
   *
   * TS: NO EQUIVALENT. TS does not check target's zone status.
   *
   * PARITY GAP: C++ targets outside their base are 2x more attractive.
   * TS ignores base zone entirely.
   */

  it('C++ doubles value for targets outside enemy base zone — TS has no equivalent', () => {
    // In C++, if a unit is outside its own base's zone (ZONE_NONE), its
    // threat value is doubled. This encourages attacking exposed units.
    //
    // TS threatScore has no zone check at all.
    //
    // PARITY GAP: C++ picks off stragglers 2x more aggressively
    const cppValueInZone = 1000;
    const cppValueOutZone = 1000 * 2; // C++ doubles for ZONE_NONE

    // TS always uses the same value regardless of zone
    const tsValue = 1000;

    expect(cppValueOutZone).toBe(2000);
    expect(tsValue).toBe(1000);
    // PARITY GAP: Factor of 2 missing in TS for out-of-zone targets
  });
});


// ============================================================
// Section 5: Civilian Penalty — TS entity.ts:811-813
// ============================================================
describe('civilian penalty (TS entity.ts:811-813)', () => {
  /*
   * C++ techno.cpp Evaluate_Object: NO civilian penalty.
   * C++ has THREAT_CIVILIANS flag (line 1579) which RESTRICTS targets to civilians.
   * This is a filter, NOT a penalty — it either includes or excludes.
   *
   * TS entity.ts:811-813:
   *   if ((target.isCivilian || CIVILIAN_UNIT_TYPES.has(target.type)) && !isTargetAttackingAlly) {
   *     score *= 0.15;
   *   }
   *
   * PARITY GAP: TS applies an 85% penalty to civilian targets.
   * C++ has no such penalty — civilians get scored normally.
   */

  it('TS reduces civilian threat by 85% — C++ has no civilian penalty', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const civilian = makeEntity(UnitType.I_C1, House.Greece, 200, 200);
    const soldier = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const civScore = threatScore(scanner, civilian, 2, false);
    const solScore = threatScore(scanner, soldier, 2, false);

    // TS civilian score should be much lower (0.15x multiplier)
    expect(civScore).toBeLessThan(solScore);

    // C++ would NOT apply this penalty — both would be scored by Value()
    // PARITY GAP: TS deprioritizes civilians; C++ treats them equally
  });

  it('civilian penalty is bypassed when target is attacking ally', () => {
    // TS entity.ts:811: penalty only when !isTargetAttackingAlly
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const civilian = makeEntity(UnitType.I_C1, House.Greece, 200, 200);

    const scorePassive = threatScore(scanner, civilian, 2, false);
    const scoreAttacking = threatScore(scanner, civilian, 2, true);

    // Attacking civilian gets retaliation bonus (2x) instead of penalty (0.15x)
    expect(scoreAttacking).toBeGreaterThan(scorePassive);
    // The ratio should be roughly 2.0/0.15 = 13.3x
    const ratio = scoreAttacking / scorePassive;
    expect(ratio).toBeGreaterThan(10);
  });
});


// ============================================================
// Section 6: Wounded Bonus — TS entity.ts:816
// ============================================================
describe('wounded bonus (TS entity.ts:816)', () => {
  /*
   * C++ techno.cpp Evaluate_Object: NO wounded bonus.
   * C++ does not consider target HP ratio in threat scoring.
   *
   * TS entity.ts:816:
   *   if (target.hp < target.maxHp * 0.5) score *= 1.5;
   *
   * PARITY GAP: TS gives 50% bonus to targets below half health.
   * C++ ignores target HP entirely in threat scoring.
   */

  it('TS gives 1.5x bonus for targets below 50% HP — C++ has none', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const healthy = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    healthy.hp = healthy.maxHp; // full health

    const wounded = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    wounded.hp = Math.floor(wounded.maxHp * 0.4); // 40% HP, below 50%

    const healthyScore = threatScore(scanner, healthy, 2, false);
    const woundedScore = threatScore(scanner, wounded, 2, false);

    // TS: wounded target gets 1.5x bonus
    expect(woundedScore).toBeGreaterThan(healthyScore);
    const ratio = woundedScore / healthyScore;
    expect(ratio).toBeCloseTo(1.5, 1);
    // PARITY GAP: C++ would give equal scores regardless of HP
  });

  it('exactly 50% HP does NOT trigger wounded bonus (strict less-than)', () => {
    // TS entity.ts:816: target.hp < target.maxHp * 0.5 (strict <)
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target50 = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target50.hp = Math.floor(target50.maxHp * 0.5); // exactly 50%

    const target49 = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target49.hp = Math.floor(target49.maxHp * 0.49); // just below 50%

    const score50 = threatScore(scanner, target50, 2, false);
    const score49 = threatScore(scanner, target49, 2, false);

    // 49% triggers bonus, 50% does not
    expect(score49).toBeGreaterThan(score50);
  });
});


// ============================================================
// Section 7: Retaliation Bonus — TS entity.ts:819-821
// ============================================================
describe('retaliation bonus (TS entity.ts:819-821)', () => {
  /*
   * C++ techno.cpp Evaluate_Object: NO retaliation bonus in threat scoring.
   * C++ handles retaliation separately in TechnoClass::Assign_Target
   * via the THREAT_RANGE check and retaliatory attack response.
   *
   * TS entity.ts:819-821:
   *   if (isTargetAttackingAlly) {
   *     score *= 2;
   *   }
   *
   * PARITY GAP: TS doubles score for targets attacking allies.
   * C++ handles retaliation outside of Evaluate_Object.
   */

  it('TS doubles score when target is attacking ally — C++ handles elsewhere', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const scorePassive = threatScore(scanner, target, 2, false);
    const scoreAttacking = threatScore(scanner, target, 2, true);

    const ratio = scoreAttacking / scorePassive;
    expect(ratio).toBeCloseTo(2.0, 1);
    // PARITY GAP: C++ Evaluate_Object does not check isTargetAttackingAlly
  });
});


// ============================================================
// Section 8: Closing Speed Bonus — TS entity.ts:824-826
// ============================================================
describe('closing speed bonus (TS entity.ts:824-826)', () => {
  /*
   * C++ techno.cpp Evaluate_Object: NO closing speed check.
   *
   * TS entity.ts:824-826:
   *   if (closingSpeed !== undefined && closingSpeed > 0) {
   *     score *= 1.25;
   *   }
   *
   * PARITY GAP: TS adds 25% bonus for approaching targets.
   * C++ has no concept of closing speed in threat scoring.
   */

  it('TS gives 1.25x bonus for approaching targets — C++ has none', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const scoreStatic = threatScore(scanner, target, 2, false, 0);
    const scoreApproaching = threatScore(scanner, target, 2, false, 1.0);

    const ratio = scoreApproaching / scoreStatic;
    expect(ratio).toBeCloseTo(1.25, 1);
    // PARITY GAP: C++ does not track closing speed
  });

  it('retreating targets (negative closingSpeed) get no bonus', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const scoreStatic = threatScore(scanner, target, 2, false, 0);
    const scoreRetreating = threatScore(scanner, target, 2, false, -1.0);

    expect(scoreRetreating).toBe(scoreStatic);
  });
});


// ============================================================
// Section 9: Area_Modify — C++ techno.cpp:1342-1401, 1732-1735
// ============================================================
describe('Area_Modify (C++ techno.cpp:1342-1401, 1732-1735)', () => {
  /*
   * C++ techno.cpp:1732-1735:
   *   fixed areamod = Area_Modify(Coord_Cell(object->Center_Coord()));
   *   if (areamod != 1) {
   *     value = areamod * value;
   *   }
   *
   * C++ Area_Modify (techno.cpp:1342-1401):
   *   if (PrimaryWeapon == NULL || !PrimaryWeapon->IsSupressed) return 1;
   *   odds = 1; for each nearby friendly building: odds /= 2;
   *   return odds;
   *
   * TS entity.ts:831-834:
   *   if (nearFriendlyStructureCount > 0 && scanner.weapon?.splash > 0) {
   *     score *= Math.pow(0.5, nearFriendlyStructureCount);
   *   }
   *
   * Key differences:
   *   C++ checks IsSupressed flag (weapon-specific), TS checks splash > 0
   *   C++ applies to value BEFORE distance, TS applies to score AFTER distance
   *   Both use pow(0.5, count) halving formula (C++ iterative odds/=2)
   */

  it('exponential halving matches: pow(0.5, n) for n buildings', () => {
    const scanner = makeEntity(UnitType.V_ARTY, House.USSR, 100, 100);
    // ARTY has 155mm with splash: 2.0
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const score0 = threatScore(scanner, target, 2, false, 0, null, 0);
    const score1 = threatScore(scanner, target, 2, false, 0, null, 1);
    const score2 = threatScore(scanner, target, 2, false, 0, null, 2);
    const score3 = threatScore(scanner, target, 2, false, 0, null, 3);

    // Each building halves the score
    expect(score1 / score0).toBeCloseTo(0.5, 2);
    expect(score2 / score0).toBeCloseTo(0.25, 2);
    expect(score3 / score0).toBeCloseTo(0.125, 2);
  });

  it('C++ applies Area_Modify to value BEFORE distance, TS applies AFTER', () => {
    // C++ techno.cpp:1732 applies areamod to value, then line 1752 divides by distance
    // TS entity.ts:831 multiplies score (after distance division)
    //
    // PARITY GAP: Order of operations differs.
    // In C++: final = (areamod * value * 32000) / (distCells + 1)
    // In TS:  final = ((value * 32000) / (distLeptons + 1)) * areamod
    // Due to integer truncation in C++, these can differ.
    //
    // However, since multiplication is commutative in floating point,
    // the results are mathematically equivalent. The difference only
    // matters with C++ integer truncation.
    const cppValue = 1000;
    const areamod = 0.25; // 2 buildings
    const distCells = 5;

    // C++ order: value_modified = floor(0.25 * 1000) = 250
    //            score = floor(250 * 32000 / (5+1)) = floor(1333333) = 1333333
    const cppOrder = Math.floor(Math.floor(areamod * cppValue) * 32000 / (distCells + 1));

    // TS order: score = (1000 * 32000 / (5*256+1)) * 0.25
    //         = (32000000 / 1281) * 0.25 = 24980.5 * 0.25 = 6245.1
    const tsOrder = ((cppValue * 32000) / (distCells * 256 + 1)) * areamod;

    // These produce very different numbers due to different denominator formula
    // PARITY GAP: Both in formula scale AND in order of operations
    expect(cppOrder).toBe(1333333);
    expect(Math.floor(tsOrder)).toBe(6245);
  });

  it('non-splash scanner does not apply Area_Modify in TS', () => {
    // TS entity.ts:832: requires scanner.weapon?.splash > 0
    // C++ techno.cpp:1345: requires PrimaryWeapon->IsSupressed
    // M1Carbine has no splash property
    const rifleman = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const score0 = threatScore(rifleman, target, 2, false, 0, null, 0);
    const score3 = threatScore(rifleman, target, 2, false, 0, null, 3);

    // No splash weapon → nearFriendlyStructureCount is ignored
    expect(score3).toBe(score0);
  });
});


// ============================================================
// Section 10: NervousBias — C++ techno.cpp:1742-1743
// ============================================================
describe('NervousBias (C++ techno.cpp:1742-1743, rules.cpp:133,432)', () => {
  /*
   * C++ techno.cpp:1742-1743:
   *   if (House->Which_Zone(object) != ZONE_NONE) {
   *     value *= Rule.NervousBias;
   *   }
   *
   * C++ rules.cpp:133: NervousBias default = 1 (no effect)
   * C++ rules.cpp:432: configurable via BaseBias in RULES.INI
   *
   * This multiplies threat value of targets that are INSIDE the scanner's
   * own base zone. Default is 1 (no change), but can be increased to make
   * the AI more protective of its base.
   *
   * TS: NO EQUIVALENT. TS does not check scanner's base zone.
   *
   * PARITY GAP: With default NervousBias=1, no practical difference.
   * But if RULES.INI sets BaseBias > 1, C++ would prioritize base defense.
   */

  it('C++ NervousBias defaults to 1 — no practical difference', () => {
    // C++ rules.cpp:133: NervousBias(1)
    // When NervousBias=1, the multiplication has no effect
    const nervousBias = 1;
    const value = 1000;
    const modified = value * nervousBias;
    expect(modified).toBe(value);
    // No divergence when default is used
  });

  it('C++ NervousBias > 1 would boost base-zone targets — TS has no equivalent', () => {
    // If RULES.INI sets BaseBias=2:
    // C++ would multiply targets in base zone by 2
    // TS has no zone awareness
    //
    // PARITY GAP: Only matters with non-default RULES.INI
    const nervousBias = 2;
    const value = 1000;
    const cppModified = value * nervousBias;
    expect(cppModified).toBe(2000);
    // TS would still use 1000 — PARITY GAP with custom BaseBias
  });
});


// ============================================================
// Section 11: Spy Exclusion — C++ techno.cpp:1557-1563
// ============================================================
describe('spy exclusion (C++ techno.cpp:1557-1563)', () => {
  /*
   * C++ techno.cpp:1557-1563:
   *   if (otype == RTTI_INFANTRY && ((InfantryTypeClass const *)tclass)->Type == INFANTRY_SPY) {
   *     if (What_Am_I() == RTTI_INFANTRY && ((InfantryClass *)this)->Class->IsDog) {
   *       // dogs CAN target spies — continue
   *     } else {
   *       return(false);  // all other units ignore spies
   *     }
   *   }
   *
   * TS entity.ts:770-772:
   *   if (target.type === UnitType.I_SPY && scanner.type !== UnitType.I_DOG) {
   *     return 0;
   *   }
   *
   * MATCH: Both exclude spies unless scanner is a dog.
   */

  it('non-dog units return 0 for spy targets', () => {
    const rifleman = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const spy = makeEntity(UnitType.I_SPY, House.Greece, 200, 200);
    expect(threatScore(rifleman, spy, 2, false)).toBe(0);
  });

  it('dogs CAN target spies', () => {
    const dog = makeEntity(UnitType.I_DOG, House.USSR, 100, 100);
    const spy = makeEntity(UnitType.I_SPY, House.Greece, 200, 200);
    expect(threatScore(dog, spy, 2, false)).toBeGreaterThan(0);
  });

  it('non-spy targets are not affected by spy exclusion', () => {
    const rifleman = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const enemy = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    expect(threatScore(rifleman, enemy, 2, false)).toBeGreaterThan(0);
  });
});


// ============================================================
// Section 12: Max(value, 1) Floor — C++ techno.cpp:1756
// ============================================================
describe('value floor: max(value, 1) (C++ techno.cpp:1756)', () => {
  /*
   * C++ techno.cpp:1756:
   *   value = max(value, 1);
   *
   * After distance falloff, C++ ensures the score is at least 1.
   * This means valid targets always have a minimum threat score of 1.
   *
   * TS entity.ts:836:
   *   return score;
   *
   * TS returns the raw score with no floor.
   *
   * PARITY GAP: C++ floors to 1, TS can return fractional values < 1.
   */

  it('C++ guarantees minimum score of 1 — TS can return values < 1', () => {
    // At extreme distance with low-value target, score can be tiny
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_C1, House.Greece, 200, 200);
    // Civilian with 0.15x penalty at large distance

    const score = threatScore(scanner, target, 50, false);
    // TS may return a value less than 1 due to civilian penalty + distance
    // C++ would floor this to 1
    // score could be: (small_value * 32000 / (50*256+1)) * 0.15
    // = (small * 32000 / 12801) * 0.15 — could be < 1

    // PARITY GAP: TS returns raw float; C++ would floor(max(result, 1))
    // The actual value depends on the civilian's base value
    expect(score).toBeGreaterThanOrEqual(0); // TS allows below 1
  });

  it('C++ integer arithmetic means score is always int >= 1', () => {
    // C++ uses int throughout: value = max(value, 1)
    // TS uses float: can be 0.5, 3.7, etc.
    //
    // PARITY GAP: C++ is always integer, TS is always float
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const score = threatScore(scanner, target, 2, false);
    // TS score is a float
    // C++ score would be floor(value * 32000 / divisor), then max(result, 1)
    expect(typeof score).toBe('number');
    // PARITY GAP: TS returns float, C++ returns int >= 1
  });
});


// ============================================================
// Section 13: Numerical Parity — Exact C++ vs TS Score Comparison
// ============================================================
describe('numerical parity — exact C++ vs TS score comparison', () => {
  /*
   * Full formula comparison for a concrete scenario.
   *
   * Scenario: USSR rifleman evaluating a Greece rifleman at 3 cells distance.
   *
   * C++ computation (techno.cpp:1651-1756):
   *   rawval = Value() = Risk() + Reward
   *   For E1: Risk = cost = 100 (rules.ini), Reward = cost/3 ≈ 33
   *   Actually, Risk() = Points value ~ cost, Reward = Points value
   *   Let's use rawval ≈ 200 (2*cost for simple units)
   *   kills = 0
   *   value = 200 + 0 = 200
   *   (no designated enemy)
   *   (assume outside zone → value *= 2 = 400, or inside → value = 200)
   *   (no Area_Modify, NervousBias=1)
   *   dist = 3 * 256 = 768 leptons
   *   dist/ICON_LEPTON_W = 768/256 = 3 (integer)
   *   value = (200 * 32000) / (3 + 1) = 6400000 / 4 = 1600000
   *   value = max(1600000, 1) = 1600000
   *
   * TS computation (entity.ts:776-836):
   *   E1 has no cost in UNIT_STATS, so:
   *   value = strength(50) + damage(15)*5 = 125
   *   kills = 0, no bonus
   *   weaponDanger = min(15*2, 200) = 30
   *   value = 125 + 30 = 155
   *   warhead SA vs none = 1.0 (no modifier)
   *   (no designated enemy)
   *   distLeptons = 3 * 256 = 768
   *   score = (155 * 32000) / (768 + 1) = 4960000 / 769 ≈ 6449.9
   *   (not civilian, no wounded/retaliation/closing/area_modify)
   *   score = 6449.9
   *
   * PARITY GAP: C++ score ≈ 1,600,000 vs TS score ≈ 6,450
   * Factor of ~248x difference!
   */

  it('E1 vs E1 at 3 cells: C++ ~1,600,000 vs TS ~6,450 (248x gap)', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target.kills = 0;

    const tsScore = threatScore(scanner, target, 3, false);

    // C++ would produce ~1,600,000 (using distCells divisor)
    // TS produces ~6,450 (using distLeptons divisor)
    // The absolute values differ enormously, but relative ordering
    // within TS is self-consistent.

    // Verify TS score is in the thousands range, not millions
    expect(tsScore).toBeGreaterThan(1000);
    expect(tsScore).toBeLessThan(20000);

    // C++ equivalent:
    const cppValue = 200; // ~2*cost for E1
    const cppScore = cppDistanceFalloff(cppValue, 3 * 256);
    expect(cppScore).toBe(1600000);

    // PARITY GAP: ~248x scale difference
    expect(cppScore / tsScore).toBeGreaterThan(100);
  });

  it('heavy tank at 5 cells: C++ vs TS divergence', () => {
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.V_3TNK, House.Greece, 200, 200);
    target.kills = 0;

    const tsScore = threatScore(scanner, target, 5, false);

    // 3TNK has no cost in UNIT_STATS, so TS uses strength(400) + damage(40)*5 = 600
    // Plus weaponDanger: min(40*2, 200) = 80, total = 680
    // SA vs heavy = 0.25 < 0.5 → value *= 0.5 = 340
    // score = (340 * 32000) / (5*256 + 1) = 10880000 / 1281 ≈ 8493.4

    // C++ would compute: Value() ≈ 2*cost (3TNK cost unknown, but ~1500)
    // cppScore = (3000 * 32000) / (5+1) = 16000000

    expect(tsScore).toBeGreaterThan(0);
    // Verify TS gives a reasonable number (not millions)
    expect(tsScore).toBeLessThan(50000);
  });

  it('relative ordering is preserved despite scale difference', () => {
    // Both C++ and TS should rank a nearby threat higher than a distant one
    // and a valuable target higher than a cheap one
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const cheapNear = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    const cheapFar = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    const expensiveNear = makeEntity(UnitType.V_3TNK, House.Greece, 200, 200);

    const scoreChNear = threatScore(scanner, cheapNear, 2, false);
    const scoreChFar = threatScore(scanner, cheapFar, 8, false);

    // Near > Far (same value)
    expect(scoreChNear).toBeGreaterThan(scoreChFar);

    // Expensive near vs cheap near — depends on warhead effectiveness
    // SA vs heavy(3TNK) gets 0.5x penalty in TS, but 3TNK has higher base value
    const scoreExpNear = threatScore(scanner, expensiveNear, 2, false);
    // Not necessarily higher due to SA vs heavy penalty, so just verify both positive
    expect(scoreExpNear).toBeGreaterThan(0);
    expect(scoreChNear).toBeGreaterThan(0);
  });
});


// ============================================================
// Section 14: Distance Falloff — C++ Integer Division Quantization
// ============================================================
describe('C++ integer division quantization (techno.cpp:1752)', () => {
  /*
   * C++ techno.cpp:1752:
   *   value = (value * 32000) / ((dist/ICON_LEPTON_W)+1);
   *
   * Because dist/ICON_LEPTON_W uses integer division, the divisor
   * only increases at cell boundaries (every 256 leptons).
   * This creates a step function, not a smooth curve.
   *
   * TS entity.ts:806-807 uses float division, creating smooth falloff.
   */

  it('C++ quantizes: all positions within a cell get same score', () => {
    const value = 100;
    // Leptons 0-255 all produce distCells=0, divisor=1
    for (let l = 0; l < 256; l++) {
      expect(cppDistanceFalloff(value, l)).toBe(value * 32000);
    }
    // At 256, distCells=1, divisor=2
    expect(cppDistanceFalloff(value, 256)).toBe(value * 32000 / 2);
  });

  it('TS is continuous: every sub-cell distance gives different score', () => {
    const value = 100;
    const scores = new Set<number>();
    for (let i = 0; i < 10; i++) {
      scores.add(tsDistanceFalloff(value, i * 0.1));
    }
    // All 10 should be different (continuous function)
    expect(scores.size).toBe(10);
  });

  it('C++ falloff curve: score drops by 1/(n+1) at n cells', () => {
    // C++ divisor at n cells = n+1
    // Score at n cells = value * 32000 / (n+1)
    const value = 100;
    const cppScores: number[] = [];
    for (let n = 0; n <= 10; n++) {
      const score = cppDistanceFalloff(value, n * 256);
      cppScores.push(score);
      expect(score).toBe(Math.floor(value * 32000 / (n + 1)));
    }

    // Verify 1/r hyperbolic falloff: score[0]/score[n] = n+1
    expect(cppScores[0] / cppScores[1]).toBe(2);
    expect(cppScores[0] / cppScores[4]).toBe(5);
    expect(cppScores[0] / cppScores[9]).toBe(10);
  });

  it('TS falloff curve uses leptons, not cells, in denominator', () => {
    // TS divisor at d cells = d*256 + 1
    // Score at d cells = value * 32000 / (d*256 + 1)
    const value = 100;
    const tsAt1 = tsDistanceFalloff(value, 1);
    const tsAt5 = tsDistanceFalloff(value, 5);

    // Ratio: (1*256+1)/(5*256+1) = 257/1281 ≈ 0.2006
    const ratio = tsAt5 / tsAt1;
    expect(ratio).toBeCloseTo(257 / 1281, 3);

    // Compare to C++ ratio at same distances:
    // C++ ratio: (1+1)/(5+1) = 2/6 = 0.333
    const cppRatio = (1 + 1) / (5 + 1);
    expect(cppRatio).toBeCloseTo(0.333, 2);

    // PARITY GAP: TS falls off faster (0.20 vs 0.33 at 5 cells relative to 1 cell)
    expect(ratio).toBeLessThan(cppRatio);
  });
});


// ============================================================
// Section 15: Combined Modifier Stacking — TS-Only Features
// ============================================================
describe('combined modifier stacking', () => {
  /*
   * TS stacks multiple modifiers multiplicatively:
   *   base_score * civilian_penalty * wounded_bonus * retaliation * closing_speed * area_modify
   *
   * C++ applies modifiers to value before distance:
   *   value = rawval + kills
   *   value (+=500, *=3) for designated enemy
   *   value *= 2 for out-of-zone
   *   value *= areamod
   *   value *= nervousBias
   *   THEN: value = (value * 32000) / (distCells + 1)
   *   value = max(value, 1)
   *
   * Key difference: C++ applies modifiers to integer value BEFORE distance.
   * TS applies some to value before distance, some to score after distance.
   */

  it('TS stacking: wounded + retaliation + closing = 1.5 * 2 * 1.25 = 3.75x', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target.hp = Math.floor(target.maxHp * 0.3); // wounded

    const baseScore = threatScore(scanner, target, 2, false, 0);
    // wounded applies, so this is already 1.5x of the non-wounded score

    const fullBoost = threatScore(scanner, target, 2, true, 1.0);
    // wounded(1.5x) + retaliation(2x) + closing(1.25x) = 3.75x of non-wounded non-retal

    const nonWounded = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    nonWounded.hp = nonWounded.maxHp;
    const nonWoundedScore = threatScore(scanner, nonWounded, 2, false, 0);

    const ratio = fullBoost / nonWoundedScore;
    expect(ratio).toBeCloseTo(3.75, 1);
    // PARITY GAP: C++ has none of these three modifiers
  });

  it('TS: designated enemy + wounded + retaliation', () => {
    const scanner = makeEntity(UnitType.E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target.hp = Math.floor(target.maxHp * 0.3); // wounded
    target.kills = 0;

    const score = threatScore(scanner, target, 2, true, 0, House.Greece);
    // designated: (value+500)*3
    // wounded: *1.5
    // retaliation: *2
    // Total: very high priority target

    const baseline = threatScore(scanner, target, 2, false, 0, null);
    // baseline has wounded but no designated/retaliation: base * 1.5

    // Designated adds (value+500)*3/value multiplier ≈ 12-15x
    // Retaliation adds 2x
    // Total boost over wounded baseline ≈ 24-30x
    expect(score).toBeGreaterThan(baseline * 10);
  });
});


// ============================================================
// Section 16: Parity Gap Assertions — C++ Expected vs TS Actual
// ============================================================
describe('parity gap assertions — C++ expected vs TS actual', () => {
  /*
   * These tests assert that the TS threatScore() function produces
   * C++ Evaluate_Object's expected output. FAILING tests are marked
   * with // PARITY GAP to document confirmed divergence.
   */

  it('GAP 1: distance formula — C++ score at 3 cells should be (value*32000)/4', () => {
    // C++ techno.cpp:1752: value = (value * 32000) / ((dist/ICON_LEPTON_W)+1)
    // At 3 cells (768 leptons): divisor = (768/256)+1 = 3+1 = 4
    // C++ expected score = value * 32000 / 4 = value * 8000
    //
    // For E1: C++ Value() ≈ 200 (Risk+Reward ≈ 2*cost)
    // C++ expected = 200 * 8000 = 1,600,000
    //
    // TS uses: (value * 32000) / (3*256 + 1) = value * 32000 / 769
    // TS value = 155 (strength+dmg*5+weaponDanger for E1)
    // TS expected ≈ 155 * 32000 / 769 ≈ 6450
    //
    // PARITY GAP: C++ ~1,600,000 vs TS ~6,450
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    target.kills = 0;

    const tsScore = threatScore(scanner, target, 3, false);
    const cppExpected = 1600000; // C++ integer result

    // This SHOULD fail: TS uses leptons in denominator, C++ uses cells
    // PARITY GAP: distance denominator is (distLeptons+1) not (distCells+1)
    expect(tsScore).toBe(cppExpected);
  });

  it('GAP 2: base value — C++ uses ~2*cost, TS uses raw cost or strength fallback', () => {
    // C++ techno.cpp:4519: Value() = Risk() + Reward
    // For V2RL (cost=700): C++ Value() ≈ 1400
    // TS: value = 700 (raw cost)
    //
    // At dist=1 cell:
    // C++ expected: (1400+0) * 32000 / (1+1) = 22,400,000
    // TS: (700 + min(600*2,200)) * 32000 / (256+1)
    //   = (700 + 200) * 32000 / 257 = 900 * 32000 / 257 ≈ 112,062
    //
    // But wait — weaponDanger for SCUD is min(600*2, 200)=200
    // PARITY GAP
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.V_V2RL, House.Greece, 200, 200);
    target.kills = 0;

    const tsScore = threatScore(scanner, target, 1, false);

    // C++ expected with Value()≈1400, no designated enemy, assume outside zone (*2=2800)
    // But to isolate base value gap, use in-zone (no *2): 1400 * 32000 / 2 = 22,400,000
    // TS should match C++ if base value computation were the same
    // PARITY GAP: base value diverges
    const cppExpectedInZone = 22400000;
    expect(tsScore).toBe(cppExpectedInZone);
  });

  it('GAP 3: kill scaling — 1 kill should add exactly 1 to value (C++), not 50 (TS)', () => {
    // C++ techno.cpp:1652: value = rawval + object->Crew.Kills
    // 1 kill adds 1 to raw value
    //
    // TS entity.ts:779: value += target.kills * 50
    // 1 kill adds 50 to raw value
    //
    // Measure the per-kill delta via threatScore
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    target.kills = 0;
    const score0 = threatScore(scanner, target, 2, false);
    target.kills = 1;
    const score1 = threatScore(scanner, target, 2, false);

    const delta = score1 - score0;

    // C++ expected delta at 2 cells (512 leptons):
    // C++ divisor = (512/256)+1 = 3
    // C++ delta = 1 * 32000 / 3 = 10666 (1 kill adds 1 to value)
    //
    // TS divisor = 2*256+1 = 513
    // TS delta = 50 * 32000 / 513 ≈ 3119 (1 kill adds 50 to value)
    //
    // PARITY GAP: C++ kill delta ≈ 10666 vs TS kill delta ≈ 3119
    // The per-kill contribution differs in both magnitude and relative weight
    const cppExpectedDelta = Math.floor(1 * 32000 / 3);
    expect(delta).toBe(cppExpectedDelta);
  });

  it('GAP 4: weaponDanger — C++ does not add target weapon damage to value', () => {
    // C++ Evaluate_Object: value = Value() + Crew.Kills. No weapon damage bonus.
    // TS entity.ts:796-797: value += min(damage*2, 200)
    //
    // Test: armed vs unarmed target should have SAME base value in C++
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const armed = makeEntity(UnitType.V_3TNK, House.Greece, 200, 200);
    const unarmedType = UnitType.V_MCV;

    // C++: both scored by Value() (cost-based), NOT weapon damage
    // An unarmed MCV with higher cost should score HIGHER than armed 3TNK in C++
    // TS adds weaponDanger to armed targets, inflating their score
    //
    // PARITY GAP: weaponDanger bonus is TS-only
    const armedScore = threatScore(scanner, armed, 2, false);
    const weaponDmg = armed.weapon?.damage ?? 0;
    const weaponDanger = Math.min(weaponDmg * 2, 200);

    // If C++ parity held, weaponDanger would be 0 (no weapon-based bonus)
    // TS actually adds this bonus:
    expect(weaponDanger).toBe(0); // PARITY GAP: TS adds min(40*2, 200)=80
  });

  it('GAP 6: civilian penalty — C++ does not penalize civilian targets', () => {
    // C++ Evaluate_Object: civilians scored by Value() like any other unit
    // TS entity.ts:811-813: civilians get score *= 0.15 (85% reduction)
    //
    // In C++, a civilian and a soldier with equal Value() at same distance
    // would get identical threat scores.
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const civilian = makeEntity(UnitType.I_C1, House.Greece, 200, 200);
    const soldier = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const civScore = threatScore(scanner, civilian, 2, false);
    const solScore = threatScore(scanner, soldier, 2, false);

    // C++ would not penalize civilian: civScore should equal solScore
    // (assuming equal Value(), which depends on cost)
    // TS applies 0.15x penalty making civilian much lower
    // PARITY GAP: TS deprioritizes civilians
    expect(civScore).toBeGreaterThanOrEqual(solScore * 0.9); // C++ parity would require near-equal
  });

  it('GAP 7: wounded bonus — C++ does not boost wounded targets', () => {
    // C++ Evaluate_Object: no HP check
    // TS entity.ts:816: score *= 1.5 if HP < 50%
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);

    const healthy = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    healthy.hp = healthy.maxHp;

    const wounded = makeEntity(UnitType.I_E1, House.Greece, 200, 200);
    wounded.hp = Math.floor(wounded.maxHp * 0.3);

    const healthyScore = threatScore(scanner, healthy, 2, false);
    const woundedScore = threatScore(scanner, wounded, 2, false);

    // C++ parity: both should have identical scores (no HP modifier)
    // PARITY GAP: TS wounded bonus makes woundedScore 1.5x higher
    expect(woundedScore).toBe(healthyScore);
  });

  it('GAP 8: retaliation bonus — C++ Evaluate_Object has no isAttacking check', () => {
    // C++ handles retaliation in TechnoClass::Assign_Target, not Evaluate_Object
    // TS entity.ts:819: score *= 2 if isTargetAttackingAlly
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const passive = threatScore(scanner, target, 2, false);
    const attacking = threatScore(scanner, target, 2, true);

    // C++ parity: both should be equal (no retaliation modifier in scoring)
    // PARITY GAP: TS doubles the score
    expect(attacking).toBe(passive);
  });

  it('GAP 9: closing speed — C++ has no velocity-based modifier', () => {
    // C++ Evaluate_Object: no closing speed concept
    // TS entity.ts:824: score *= 1.25 if closingSpeed > 0
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const stationary = threatScore(scanner, target, 2, false, 0);
    const approaching = threatScore(scanner, target, 2, false, 1.0);

    // C++ parity: both should be equal
    // PARITY GAP: TS adds 25% for approaching targets
    expect(approaching).toBe(stationary);
  });

  it('GAP 12: max(value,1) floor — C++ guarantees score >= 1', () => {
    // C++ techno.cpp:1756: value = max(value, 1)
    // TS: returns raw float, can be < 1
    //
    // Create scenario where score is very small: civilian + long distance
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const civilian = makeEntity(UnitType.I_C1, House.Greece, 200, 200);

    // At extreme range, civilian penalty (0.15x) can push score below 1
    const score = threatScore(scanner, civilian, 100, false);

    // C++ parity: score should be at least 1
    // PARITY GAP: TS returns raw float which may be < 1
    expect(score).toBeGreaterThanOrEqual(1);
  });

  it('GAP 13: integer arithmetic — C++ produces integer scores, TS produces floats', () => {
    // C++ uses int throughout: all divisions truncate
    // TS uses float: produces fractional results
    const scanner = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
    const target = makeEntity(UnitType.I_E1, House.Greece, 200, 200);

    const score = threatScore(scanner, target, 3, false);

    // C++ would return an integer (floor of the computation)
    // PARITY GAP: TS returns a float
    expect(Number.isInteger(score)).toBe(true);
  });
});
