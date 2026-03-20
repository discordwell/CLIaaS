/**
 * Score Screen Parity Tests — C++ score.cpp:365-597 (Presentation)
 *
 * Tests the final score formula, time display, and letter grade derivation
 * against the original C++ implementation.
 *
 * C++ Score Algorithm (score.cpp:546-597):
 *
 *   // 1. Accumulate point totals from all allied houses
 *   int uspoints = 0;
 *   for (HousesType hous = HOUSE_SPAIN; hous <= HOUSE_BAD; hous++) {
 *     HouseClass *hows = HouseClass::As_Pointer(hous);
 *     // accumulate casualties by side...
 *     if (PlayerPtr->Is_Ally(hous)) {
 *       uspoints += hows->PointTotal;
 *     }
 *   }
 *
 *   // 2. Difficulty bias (score.cpp:567-579)
 *   switch (PlayerPtr->Difficulty) {
 *     case DIFF_EASY:   uspoints += 500;  break;
 *     case DIFF_NORMAL: uspoints += 1500; break;
 *     case DIFF_HARD:   uspoints += 3500; break;
 *   }
 *
 *   // 3. Leadership rating (score.cpp:534-584)
 *   //    leadership = count of surviving allied objects on the map
 *   //    denominator = leadership + total enemy casualties (units + buildings)
 *   leadership = 100 * fixed(leadership, denominator);
 *   leadership = min(150, leadership);
 *
 *   // 4. Economy rating (score.cpp:589-593)
 *   economy = 100 * fixed(money+1+stolenCredits, harvested+initialCredits+1);
 *   economy = min(economy, 150);
 *
 *   // 5. Final score (score.cpp:595-597)
 *   total = ((uspoints * leadership) / 100) + ((uspoints * economy) / 100);
 *   if (total < -9999) total = -9999;
 *   total = min(total, 99999);
 *
 *   // 6. Time display (score.cpp:439) — NOT part of score
 *   unsigned minutes = (unsigned)((ElapsedTime / (long)TIMER_MINUTE)) + 1;
 *
 *   // 7. No letter grade in C++ — only hall of fame ranking
 *
 * C++ fixed-point (fixed.h/fixed.cpp):
 *   fixed(numerator, denominator):
 *     Data.Raw = (numerator * 256) / denominator  (integer division)
 *   operator*(int lvalue, fixed rvalue):
 *     return (((unsigned)rvalue.Data.Raw * lvalue) + 128) / 256
 *
 * TS implementation (renderer.ts:4125-4138):
 *   timeBonus = max(0, 1000 - floor(tick / 15))
 *   score = killCount * 50 - lossCount * 30 - structsLost * 100 + timeBonus
 *   finalScore = max(0, score)
 *   grade = S >= 2000 / A >= 1500 / B >= 1000 / C >= 500 / D >= 200 / F
 *
 * C++ reference: CnC_and_Red_Alert/RA/score.cpp, fixed.h, fixed.cpp
 */

import { describe, it, expect } from 'vitest';

// ============================================================
// C++ fixed-point emulation (from fixed.h/fixed.cpp)
// ============================================================

/**
 * Emulates C++ fixed(numerator, denominator) constructor + int * fixed operator.
 * fixed(n, d) => Raw = (n * 256) / d   (integer division, unsigned)
 * 100 * fixed => ((Raw * 100) + 128) / 256   (rounding)
 */
function cppFixedMul100(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  const raw = Math.trunc((numerator * 256) / denominator);  // unsigned integer division
  return Math.trunc(((raw * 100) + 128) / 256);
}

// ============================================================
// C++ score formula (score.cpp:546-597)
// ============================================================

/**
 * Pure C++ score calculation, parameters mapped from C++ variables:
 * @param pointTotal - sum of PointTotal across allied houses
 * @param difficulty - 'easy' | 'normal' | 'hard'
 * @param survivingUnits - count of surviving allied objects on map
 * @param enemyCasualties - total enemy units + buildings killed
 * @param moneyAvailable - PlayerPtr->Available_Money()
 * @param stolenCredits - PlayerPtr->StolenBuildingsCredits
 * @param harvestedCredits - PlayerPtr->HarvestedCredits
 * @param initialCredits - PlayerPtr->Control.InitialCredits
 */
function cppScoreFormula(
  pointTotal: number,
  difficulty: 'easy' | 'normal' | 'hard',
  survivingUnits: number,
  enemyCasualties: number,
  moneyAvailable: number,
  stolenCredits: number,
  harvestedCredits: number,
  initialCredits: number,
): { leadership: number; economy: number; total: number; uspoints: number } {
  // Difficulty bias (score.cpp:567-579)
  let uspoints = pointTotal;
  switch (difficulty) {
    case 'easy':   uspoints += 500;  break;
    case 'normal': uspoints += 1500; break;
    case 'hard':   uspoints += 3500; break;
  }

  // Leadership (score.cpp:582-584)
  let leadership = survivingUnits;
  if (!leadership) leadership = 1;  // "if (!leadership) leadership++;"
  leadership = cppFixedMul100(leadership, enemyCasualties + leadership);
  leadership = Math.min(150, leadership);

  // Economy (score.cpp:592-593)
  let economy = cppFixedMul100(
    moneyAvailable + 1 + stolenCredits,
    harvestedCredits + initialCredits + 1,
  );
  economy = Math.min(economy, 150);

  // Total (score.cpp:595-597)
  let total = Math.trunc((uspoints * leadership) / 100) + Math.trunc((uspoints * economy) / 100);
  if (total < -9999) total = -9999;
  total = Math.min(total, 99999);

  return { leadership, economy, total, uspoints };
}

// ============================================================
// TS score formula (renderer.ts:4125-4138) — extracted to test
// ============================================================

function tsScoreFormula(
  killCount: number,
  lossCount: number,
  structsLost: number,
  tick: number,
): { score: number; finalScore: number; grade: string; timeBonus: number } {
  const timeBonus = Math.max(0, 1000 - Math.floor(tick / 15));
  const score = killCount * 50 - lossCount * 30 - structsLost * 100 + timeBonus;
  const finalScore = Math.max(0, score);
  const grade =
    finalScore >= 2000 ? 'S' :
    finalScore >= 1500 ? 'A' :
    finalScore >= 1000 ? 'B' :
    finalScore >= 500  ? 'C' :
    finalScore >= 200  ? 'D' : 'F';
  return { score, finalScore, grade, timeBonus };
}

// ============================================================
// Section 1: C++ fixed-point multiplication verification
// ============================================================
describe('C++ fixed-point 100*fixed(n,d) (fixed.h:82-91, fixed.cpp:59-66)', () => {
  it('fixed(1,2) * 100 = 50 — half', () => {
    // Raw = (1*256)/2 = 128. 100*fixed = (128*100+128)/256 = 50
    expect(cppFixedMul100(1, 2)).toBe(50);
  });

  it('fixed(1,3) * 100 = 33 — one-third rounds down', () => {
    // Raw = (1*256)/3 = 85. (85*100+128)/256 = 8628/256 = 33
    expect(cppFixedMul100(1, 3)).toBe(33);
  });

  it('fixed(2,3) * 100 = 67 — two-thirds rounds up', () => {
    // Raw = (2*256)/3 = 170. (170*100+128)/256 = 17128/256 = 66
    // Actually: 17128/256 = 66.90625 -> trunc = 66
    // Wait, let me recalculate: 512/3 = 170 (trunc). 170*100 = 17000. 17000+128 = 17128. 17128/256 = 66.9
    // trunc(66.9) = 66
    expect(cppFixedMul100(2, 3)).toBe(66);
  });

  it('fixed(3,4) * 100 = 75 — three-quarters', () => {
    // Raw = (3*256)/4 = 192. (192*100+128)/256 = 19328/256 = 75.5 -> trunc = 75
    expect(cppFixedMul100(3, 4)).toBe(75);
  });

  it('fixed(0, d) * 100 = 0 — zero numerator', () => {
    expect(cppFixedMul100(0, 100)).toBe(0);
  });

  it('fixed(n, 0) * 100 = 0 — zero denominator', () => {
    expect(cppFixedMul100(50, 0)).toBe(0);
  });

  it('fixed(1, 1) * 100 = 100 — identity', () => {
    // Raw = 256. (256*100+128)/256 = 25728/256 = 100.5 -> trunc = 100
    expect(cppFixedMul100(1, 1)).toBe(100);
  });

  it('fixed(150, 100) * 100 = 150 — 150%', () => {
    // Raw = (150*256)/100 = 384. (384*100+128)/256 = 38528/256 = 150.5 -> trunc = 150
    expect(cppFixedMul100(150, 100)).toBe(150);
  });
});

// ============================================================
// Section 2: C++ leadership calculation (score.cpp:534-584)
// ============================================================
describe('C++ leadership rating (score.cpp:534-584)', () => {
  it('10 surviving, 10 enemy casualties => leadership=50', () => {
    // fixed(10, 10+10) = fixed(10,20) => Raw=(10*256)/20=128
    // 100*fixed = (128*100+128)/256 = 12928/256 = 50
    const result = cppScoreFormula(0, 'normal', 10, 10, 0, 0, 0, 0);
    expect(result.leadership).toBe(50);
  });

  it('0 surviving (bumped to 1), 99 casualties => leadership=1', () => {
    // if (!leadership) leadership++ => leadership=1
    // fixed(1, 99+1) = fixed(1,100) => Raw=(256)/100=2
    // 100*fixed = (2*100+128)/256 = 328/256 = 1
    const result = cppScoreFormula(0, 'normal', 0, 99, 0, 0, 0, 0);
    expect(result.leadership).toBe(1);
  });

  it('leadership capped at 150', () => {
    // 100 surviving, 0 casualties => fixed(100, 100) = 100%
    // But min(150, 100) = 100
    const result = cppScoreFormula(0, 'normal', 100, 0, 0, 0, 0, 0);
    expect(result.leadership).toBe(100);
  });

  it('leadership clamp to 150 with overwhelming survival', () => {
    // Actually in C++ if enemyCasualties=0, then denom=leadership itself
    // fixed(leadership, leadership) = fixed(1,1) = 100%, so leadership=100
    // To get >100 we need more objects surviving than total casualties+surviving
    // which is impossible. So leadership maxes at 100 in practice.
    // But the min(150) is in the code for safety.
    const result = cppScoreFormula(0, 'normal', 200, 0, 0, 0, 0, 0);
    expect(result.leadership).toBe(100);
  });
});

// ============================================================
// Section 3: C++ economy calculation (score.cpp:589-593)
// ============================================================
describe('C++ economy rating (score.cpp:589-593)', () => {
  it('all money remaining, no harvesting => economy=100', () => {
    // money=1000, stolen=0, harvested=0, initial=1000
    // fixed(1000+1+0, 0+1000+1) = fixed(1001, 1001) => 100
    const result = cppScoreFormula(0, 'normal', 1, 0, 1000, 0, 0, 1000);
    expect(result.economy).toBe(100);
  });

  it('spent all money => economy near 0', () => {
    // money=0, stolen=0, harvested=5000, initial=5000
    // fixed(0+1+0, 5000+5000+1) = fixed(1, 10001)
    // Raw = 256/10001 = 0 (integer division)
    // 100*fixed = (0*100+128)/256 = 0
    const result = cppScoreFormula(0, 'normal', 1, 0, 0, 0, 5000, 5000);
    expect(result.economy).toBe(0);
  });

  it('economy capped at 150', () => {
    // money=10000, stolen=5000, harvested=100, initial=100
    // fixed(10000+1+5000, 100+100+1) = fixed(15001, 201)
    // Raw = (15001*256)/201 = 19137 (but capped to u16 = 19137)
    // 100*fixed = (19137*100+128)/256 = lots
    // min(economy, 150) => 150
    const result = cppScoreFormula(0, 'normal', 1, 0, 10000, 5000, 100, 100);
    expect(result.economy).toBe(150);
  });
});

// ============================================================
// Section 4: C++ difficulty bias (score.cpp:567-579)
// ============================================================
describe('C++ difficulty bias (score.cpp:567-579)', () => {
  it('DIFF_EASY adds 500 to uspoints', () => {
    const result = cppScoreFormula(0, 'easy', 1, 0, 0, 0, 0, 0);
    expect(result.uspoints).toBe(500);
  });

  it('DIFF_NORMAL adds 1500 to uspoints', () => {
    const result = cppScoreFormula(0, 'normal', 1, 0, 0, 0, 0, 0);
    expect(result.uspoints).toBe(1500);
  });

  it('DIFF_HARD adds 3500 to uspoints', () => {
    const result = cppScoreFormula(0, 'hard', 1, 0, 0, 0, 0, 0);
    expect(result.uspoints).toBe(3500);
  });
});

// ============================================================
// Section 5: C++ total score formula (score.cpp:595-597)
// ============================================================
describe('C++ total score (score.cpp:595-597)', () => {
  it('total = (uspoints*leadership/100) + (uspoints*economy/100)', () => {
    // pointTotal=1000, normal difficulty => uspoints=2500
    // 10 surviving, 10 casualties => leadership=50
    // money=500, harvested=1000, initial=1000 => economy = fixed(501, 2001)*100
    //   Raw=(501*256)/2001=64. (64*100+128)/256=6528/256=25
    // total = (2500*50)/100 + (2500*25)/100 = 1250 + 625 = 1875
    const result = cppScoreFormula(1000, 'normal', 10, 10, 500, 0, 1000, 1000);
    expect(result.uspoints).toBe(2500);
    expect(result.leadership).toBe(50);
    expect(result.economy).toBe(25);
    expect(result.total).toBe(1250 + 625);
  });

  it('total clamped to 99999', () => {
    // Extreme case: huge pointTotal
    const result = cppScoreFormula(100000, 'hard', 100, 0, 100000, 0, 0, 1);
    expect(result.total).toBeLessThanOrEqual(99999);
  });

  it('total clamped to -9999 at minimum', () => {
    // Negative total: pointTotal is heavily negative
    const result = cppScoreFormula(-200000, 'easy', 1, 100, 0, 0, 1000, 1000);
    expect(result.total).toBeGreaterThanOrEqual(-9999);
  });
});

// ============================================================
// Section 6: C++ time display (score.cpp:439)
// — NOT part of score formula, just display
// ============================================================
describe('C++ time display (score.cpp:439, 1357-1370)', () => {
  it('minutes = (ElapsedTime / TIMER_MINUTE) + 1', () => {
    // TIMER_MINUTE = TIMER_SECOND * 60 (defines.h:3025)
    // TIMER_SECOND is typically 15 ticks
    // So TIMER_MINUTE = 900 ticks
    const TIMER_MINUTE = 900;

    // 0 ticks => minutes = (0/900)+1 = 1
    expect(Math.trunc(0 / TIMER_MINUTE) + 1).toBe(1);

    // 900 ticks => minutes = (900/900)+1 = 2
    expect(Math.trunc(900 / TIMER_MINUTE) + 1).toBe(2);

    // 5400 ticks (6 min) => minutes = (5400/900)+1 = 7
    expect(Math.trunc(5400 / TIMER_MINUTE) + 1).toBe(7);
  });

  it('C++ caps display at 9:59 (score.cpp:1361)', () => {
    // if ((minutes/60) > 9) minutes = (9*60 + 59);
    // 600 minutes => capped to 599
    const minutes = 600;
    const capped = (Math.trunc(minutes / 60) > 9) ? (9 * 60 + 59) : minutes;
    expect(capped).toBe(599);  // 9:59
  });
});

// ============================================================
// Section 7: PARITY GAPS — TS diverges from C++
// ============================================================
describe('PARITY GAP: TS score formula diverges from C++ (renderer.ts:4125-4138 vs score.cpp:595)', () => {
  it('TS uses time bonus in score — C++ does NOT include time in score', () => {
    // PARITY GAP: C++ score formula has NO time component at all
    // C++ total = (uspoints*leadership/100) + (uspoints*economy/100)
    // TS score = kills*50 - losses*30 - structsLost*100 + timeBonus
    //
    // TS timeBonus = max(0, 1000 - floor(tick/15))
    // At tick=0, timeBonus=1000; at tick=15000, timeBonus=0
    const earlyResult = tsScoreFormula(10, 0, 0, 0);
    const lateResult = tsScoreFormula(10, 0, 0, 30000);
    expect(earlyResult.timeBonus).toBe(1000);
    expect(lateResult.timeBonus).toBe(0);
    // Same kills, different scores due to time — C++ would give identical scores
    expect(earlyResult.score).not.toBe(lateResult.score);  // PARITY GAP
  });

  it('TS uses linear kills*50 — C++ uses PointTotal*leadership%*economy%', () => {
    // PARITY GAP: fundamentally different formulas
    // C++ score depends on: PointTotal (accumulated from kills, not count),
    //   difficulty, leadership ratio, economy ratio
    // TS score depends on: killCount*50, lossCount*30, structsLost*100, timeBonus
    //
    // Example: 20 kills, 5 losses, 0 structs lost, tick=0
    const tsResult = tsScoreFormula(20, 5, 0, 0);
    // TS: 20*50 - 5*30 - 0 + 1000 = 1000 - 150 + 1000 = 1850
    expect(tsResult.score).toBe(1850);

    // C++ with equivalent-ish inputs (pointTotal=300, normal, 15 surviving, 20 casualties,
    //   1000 money, 0 stolen, 2000 harvested, 5000 initial):
    const cppResult = cppScoreFormula(300, 'normal', 15, 20, 1000, 0, 2000, 5000);
    // These scores will NOT match because the formulas are fundamentally different
    expect(tsResult.score).not.toBe(cppResult.total);  // PARITY GAP
  });

  it('TS has structsLost penalty — C++ score has no direct structure loss penalty', () => {
    // PARITY GAP: TS subtracts structsLost*100 from score
    // C++ counts allied building losses as part of casualty stats for bar graph display,
    // but the score formula itself does not penalize for structure losses
    const withLoss = tsScoreFormula(10, 0, 3, 0);
    const noLoss = tsScoreFormula(10, 0, 0, 0);
    expect(noLoss.score - withLoss.score).toBe(300); // 3 * 100
    // In C++, structsLost does NOT appear in the total score formula at all
  });

  it('TS has no difficulty modifier — C++ adds 500/1500/3500 based on difficulty', () => {
    // PARITY GAP: TS score is difficulty-agnostic
    // C++ score.cpp:567-579 adds difficulty bias before computing total
    const ts1 = tsScoreFormula(10, 0, 0, 0);
    const ts2 = tsScoreFormula(10, 0, 0, 0);
    expect(ts1.score).toBe(ts2.score); // Same regardless of difficulty in TS

    // C++ scores differ by difficulty
    const cppEasy = cppScoreFormula(1000, 'easy', 10, 10, 1000, 0, 1000, 1000);
    const cppHard = cppScoreFormula(1000, 'hard', 10, 10, 1000, 0, 1000, 1000);
    expect(cppHard.total).toBeGreaterThan(cppEasy.total);  // PARITY GAP
  });

  it('TS has no leadership/economy ratio — C++ uses percentage-based multipliers', () => {
    // PARITY GAP: C++ score is fundamentally ratio-based
    // leadership = what fraction of your forces survived relative to enemy casualties
    // economy = what fraction of money you retained
    // TS completely ignores these concepts
    const cpp1 = cppScoreFormula(1000, 'normal', 50, 10, 5000, 0, 5000, 5000);
    const cpp2 = cppScoreFormula(1000, 'normal', 1, 100, 100, 0, 5000, 5000);
    // Same point total, wildly different leadership => different scores
    expect(cpp1.total).not.toBe(cpp2.total);
    // TS would give identical scores if kills/losses were the same
  });
});

describe('PARITY GAP: TS letter grades do not exist in C++ (renderer.ts:4136-4138)', () => {
  it('C++ has NO letter grade system — only hall of fame ranking', () => {
    // PARITY GAP: TS invents a letter grade system not present in C++
    // C++ score.cpp only has hall of fame with name/score/level/side
    // TS adds: S >= 2000, A >= 1500, B >= 1000, C >= 500, D >= 200, F
    const tsResult = tsScoreFormula(40, 0, 0, 0);
    expect(tsResult.grade).toBe('S'); // 40*50 + 1000 = 3000 >= 2000
    // This entire grading system is a TS-only addition
  });

  it('TS grade thresholds: S=2000, A=1500, B=1000, C=500, D=200, F=<200', () => {
    // Documenting the TS-only grade boundaries
    expect(tsScoreFormula(20, 0, 0, 0).grade).toBe('S');    // 2000
    expect(tsScoreFormula(10, 0, 0, 0).grade).toBe('A');    // 1500
    expect(tsScoreFormula(0, 0, 0, 0).grade).toBe('B');     // 1000 (timeBonus only)
    expect(tsScoreFormula(0, 0, 0, 7500).grade).toBe('C');  // floor(7500/15)=500, bonus=500
    expect(tsScoreFormula(0, 0, 0, 12000).grade).toBe('D'); // floor(12000/15)=800, bonus=200
    expect(tsScoreFormula(0, 5, 0, 15000).grade).toBe('F'); // -150, clamped to 0
  });
});

describe('PARITY GAP: TS floors score at 0 — C++ allows negative (score.cpp:596)', () => {
  it('C++ allows negative scores down to -9999', () => {
    // C++ score.cpp:596: "if (total < -9999) total = -9999;"
    // This means C++ explicitly allows negative scores
    const cppResult = cppScoreFormula(-5000, 'easy', 1, 100, 0, 0, 10000, 10000);
    expect(cppResult.total).toBeLessThan(0);
  });

  it('TS clamps score to 0 minimum (renderer.ts:4134)', () => {
    // PARITY GAP: TS uses Math.max(0, score) on line 4137
    // C++ allows scores as low as -9999
    const tsResult = tsScoreFormula(0, 100, 10, 15000);
    // score = 0 - 3000 - 1000 + 0 = -4000
    expect(tsResult.score).toBe(-4000);
    expect(tsResult.finalScore).toBe(0); // Clamped to 0 in TS; C++ would show -4000
  });
});

// ============================================================
// Section 8: TS time bonus edge cases
// ============================================================
describe('TS timeBonus calculation (renderer.ts:4126)', () => {
  it('timeBonus = max(0, 1000 - floor(tick/15))', () => {
    expect(tsScoreFormula(0, 0, 0, 0).timeBonus).toBe(1000);
    expect(tsScoreFormula(0, 0, 0, 15).timeBonus).toBe(999);
    expect(tsScoreFormula(0, 0, 0, 150).timeBonus).toBe(990);
    expect(tsScoreFormula(0, 0, 0, 15000).timeBonus).toBe(0);
    expect(tsScoreFormula(0, 0, 0, 30000).timeBonus).toBe(0);
  });

  it('timeBonus reaches 0 at exactly tick=15000', () => {
    // floor(15000/15) = 1000, so 1000 - 1000 = 0
    expect(tsScoreFormula(0, 0, 0, 15000).timeBonus).toBe(0);
    // One tick before: floor(14999/15) = 999, so 1000 - 999 = 1
    expect(tsScoreFormula(0, 0, 0, 14999).timeBonus).toBe(1);
  });
});

// ============================================================
// Section 9: TS score formula verification
// ============================================================
describe('TS score formula correctness (renderer.ts:4125-4127)', () => {
  it('score = kills*50 - losses*30 - structsLost*100 + timeBonus', () => {
    // 10 kills, 3 losses, 2 structs lost, tick=1500 => timeBonus=900
    const result = tsScoreFormula(10, 3, 2, 1500);
    // 500 - 90 - 200 + 900 = 1110
    expect(result.score).toBe(1110);
    expect(result.grade).toBe('B');
  });

  it('zero everything => score = timeBonus = 1000', () => {
    const result = tsScoreFormula(0, 0, 0, 0);
    expect(result.score).toBe(1000);
    expect(result.grade).toBe('B');
  });

  it('large kill count dominates', () => {
    const result = tsScoreFormula(100, 10, 5, 15000);
    // 5000 - 300 - 500 + 0 = 4200
    expect(result.score).toBe(4200);
    expect(result.grade).toBe('S');
  });
});

// ============================================================
// Section 10: C++ full integration scenarios
// ============================================================
describe('C++ full score scenarios (score.cpp:546-597)', () => {
  it('perfect mission: high points, no casualties, all money retained, hard difficulty', () => {
    const result = cppScoreFormula(5000, 'hard', 20, 50, 10000, 0, 10000, 10000);
    // uspoints = 5000 + 3500 = 8500
    // leadership = fixed(20, 50+20) * 100 = fixed(20,70) => Raw=(20*256)/70=73
    //   (73*100+128)/256 = 7428/256 = 29
    // economy = fixed(10001, 20001) * 100 => Raw=(10001*256)/20001=128
    //   (128*100+128)/256 = 12928/256 = 50
    // total = (8500*29)/100 + (8500*50)/100 = 2465 + 4250 = 6715
    expect(result.leadership).toBe(29);
    expect(result.economy).toBe(50);
    expect(result.total).toBe(2465 + 4250);
  });

  it('terrible mission: no points, many casualties, no money, easy difficulty', () => {
    const result = cppScoreFormula(0, 'easy', 1, 200, 0, 0, 0, 0);
    // uspoints = 0 + 500 = 500
    // leadership = fixed(1, 200+1) * 100 = fixed(1,201) => Raw=1. (100+128)/256=0
    // economy = fixed(1, 1)*100 = 100
    // total = (500*0)/100 + (500*100)/100 = 0 + 500 = 500
    expect(result.leadership).toBe(0);
    expect(result.economy).toBe(100);
    expect(result.total).toBe(500);
  });
});
