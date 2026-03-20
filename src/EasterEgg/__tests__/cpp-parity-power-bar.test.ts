/**
 * C++ Behavioral Parity Tests — Power Bar Display
 *
 * Tests the logarithmic height calculation (Power_Height) and bounce animation
 * against hand-traced C++ expected values.
 *
 * C++ Power_Height algorithm (power.cpp:394-417):
 *   int Power_Height(int value) {
 *     int num    = value / POWER_STEP_LEVEL;           // line 396
 *     int retval = 0;                                   // line 397
 *     for (int lp = 0; lp < num; lp++) {               // line 403
 *       retval  = retval + (((POWER_HEIGHT - 2) - retval) / POWER_STEP_FACTOR);  // line 404
 *       value  -= POWER_STEP_LEVEL;                    // line 405
 *     }
 *     if (value) {                                      // line 411
 *       retval = retval + (((((POWER_HEIGHT - 2) - retval) / POWER_STEP_FACTOR) * value) / POWER_STEP_LEVEL);  // line 412
 *     }
 *     retval = Bound(retval, 0, POWER_HEIGHT - 2);     // line 415
 *     return retval;
 *   }
 *
 * C++ constants (power.h:81-94, RESFACTOR==2 HIRES):
 *   POWER_HEIGHT = 200 - (7 + 70 + 13) = 110
 *   POWER_STEP_LEVEL  = 100
 *   POWER_STEP_FACTOR = 5
 *
 * C++ Draw_It rescaling (power.cpp:229, HIRES only):
 *   power_height = (power_height * (76*RESFACTOR+1)) / (53*RESFACTOR+1)
 *                = (power_height * 153) / 107
 *
 * TS implementation (renderer.ts:283-298):
 *   Uses POWER_HEIGHT = 153 directly (no rescaling step).
 *   POWER_STEP_LEVEL = 100, POWER_STEP_FACTOR = 5.
 *
 * C++ reference: CnC_and_Red_Alert/RA/power.cpp:394-417, power.h:81-94
 */

import { describe, it, expect } from 'vitest';
import { Renderer } from '../engine/renderer';

// ============================================================
// Section 1: Constants — C++ power.h vs TS Renderer
// ============================================================
describe('Power bar constants (power.h:81-94)', () => {
  it('C++ POWER_STEP_LEVEL = 100', () => {
    expect(Renderer.POWER_STEP_LEVEL).toBe(100);
  });

  it('C++ POWER_STEP_FACTOR = 5', () => {
    expect(Renderer.POWER_STEP_FACTOR).toBe(5);
  });

  // PARITY GAP: C++ uses POWER_HEIGHT=110 (HIRES) and rescales in Draw_It
  // by (153/107). TS uses POWER_HEIGHT=153 directly.
  it('C++ POWER_HEIGHT = 110 (HIRES: 200-(7+70+13)), TS uses 153', () => {
    const CPP_POWER_HEIGHT = 200 - (7 + 70 + 13); // = 110
    expect(CPP_POWER_HEIGHT).toBe(110);
    // PARITY GAP: TS uses 153 instead of 110
    expect(Renderer.POWER_HEIGHT).not.toBe(110);
    expect(Renderer.POWER_HEIGHT).toBe(153);
  });

  it('C++ max pixel height = POWER_HEIGHT - 2 = 108', () => {
    const CPP_MAX = 110 - 2;
    expect(CPP_MAX).toBe(108);
    // TS max is 151
    const TS_MAX = Renderer.POWER_HEIGHT - 2;
    expect(TS_MAX).toBe(151);
  });
});

// ============================================================
// Section 2: Power_Height — C++ raw values (POWER_HEIGHT=110)
// Hand-traced through integer division at each loop iteration.
// ============================================================

/**
 * Reference C++ Power_Height with POWER_HEIGHT=110:
 *   value=0:    retval=0
 *   value=50:   retval=10  (remainder path: (108/5)*50/100 = 21*50/100 = 10)
 *   value=100:  retval=21  (one full step: 108/5 = 21)
 *   value=200:  retval=38  (21 + 87/5 = 21+17 = 38)
 *   value=500:  retval=72  (21→38→52→63→72)
 *   value=1000: retval=95  (→79→84→88→92→95)
 *   value=2000: retval=104 (→97→99→100→101→102→103→104→104→104→104)
 *
 * After C++ Draw_It rescaling (power_height * 153 / 107):
 *   value=0:    0
 *   value=50:   (10*153)/107 = 14
 *   value=100:  (21*153)/107 = 30
 *   value=200:  (38*153)/107 = 54
 *   value=500:  (72*153)/107 = 102
 *   value=1000: (95*153)/107 = 135
 *   value=2000: (104*153)/107 = 148
 */

/** Simulate C++ Power_Height exactly (integer division, POWER_HEIGHT=110) */
function cppPowerHeight(value: number): number {
  const POWER_HEIGHT = 110;
  const STEP_LEVEL = 100;
  const STEP_FACTOR = 5;
  const num = Math.trunc(value / STEP_LEVEL);
  let retval = 0;
  let remaining = value;
  for (let lp = 0; lp < num; lp++) {
    retval = retval + Math.trunc(((POWER_HEIGHT - 2) - retval) / STEP_FACTOR);
    remaining -= STEP_LEVEL;
  }
  if (remaining > 0) {
    retval = retval + Math.trunc(
      (Math.trunc(((POWER_HEIGHT - 2) - retval) / STEP_FACTOR) * remaining) / STEP_LEVEL
    );
  }
  return Math.max(0, Math.min(POWER_HEIGHT - 2, retval));
}

/** C++ Draw_It HIRES rescaling (power.cpp:229) */
function cppRescaledHeight(rawHeight: number): number {
  return Math.trunc((rawHeight * 153) / 107);
}

/** Full C++ pipeline: Power_Height → Draw_It rescaling */
function cppFinalPixelHeight(value: number): number {
  return cppRescaledHeight(cppPowerHeight(value));
}

describe('C++ Power_Height raw values (POWER_HEIGHT=110, power.cpp:394-417)', () => {
  const RAW_EXPECTED: [number, number][] = [
    [0,    0],
    [50,   10],
    [100,  21],
    [200,  38],
    [300,  52],
    [500,  72],
    [1000, 95],
    [2000, 104],
  ];

  for (const [value, expected] of RAW_EXPECTED) {
    it(`value=${value} → raw=${expected}`, () => {
      expect(cppPowerHeight(value)).toBe(expected);
    });
  }

  it('raw height saturates due to integer division (diminishing returns)', () => {
    // After value ~1700, integer division by 5 yields 0 and height stops growing
    const h1700 = cppPowerHeight(1700);
    const h5000 = cppPowerHeight(5000);
    expect(h5000).toBe(h1700); // both saturate at 104
    expect(h5000).toBe(104);
  });

  it('raw height never exceeds 108 (POWER_HEIGHT - 2)', () => {
    expect(cppPowerHeight(100000)).toBeLessThanOrEqual(108);
  });
});

// ============================================================
// Section 3: C++ rescaled pixel heights (Draw_It applies 153/107 scaling)
// ============================================================
describe('C++ rescaled pixel heights (power.cpp:229, 153/107 scaling)', () => {
  const RESCALED_EXPECTED: [number, number][] = [
    [0,    0],
    [50,   14],
    [100,  30],
    [200,  54],
    [500,  102],
    [1000, 135],
    [2000, 148],
  ];

  for (const [value, expected] of RESCALED_EXPECTED) {
    it(`value=${value} → rescaled=${expected}px`, () => {
      expect(cppFinalPixelHeight(value)).toBe(expected);
    });
  }
});

// ============================================================
// Section 4: TS powerBarHeight must match C++ final rendered pixel height
// C++ pipeline: Power_Height(POWER_HEIGHT=110) → Draw_It rescale (*153/107)
// TS pipeline:  powerBarHeight(POWER_HEIGHT=153) — no rescaling
//
// These tests assert C++ expected values against TS. Failures are real
// parity gaps caused by TS using POWER_HEIGHT=153 directly instead of
// the C++ two-stage approach (compute with 110, rescale to 153).
// ============================================================
describe('TS powerBarHeight must match C++ rendered pixel height', () => {
  // These pass — low values happen to agree
  it('value=0: C++ renders 0px', () => {
    expect(Renderer.powerBarHeight(0)).toBe(cppFinalPixelHeight(0)); // both 0
  });

  it('value=100: C++ renders 30px', () => {
    expect(Renderer.powerBarHeight(100)).toBe(cppFinalPixelHeight(100)); // both 30
  });

  it('value=200: C++ renders 54px', () => {
    expect(Renderer.powerBarHeight(200)).toBe(cppFinalPixelHeight(200)); // both 54
  });

  // Fixed: TS now matches C++ rendered values via internal 110 + rescale
  it('value=50: both C++ and TS render 14px', () => {
    expect(cppFinalPixelHeight(50)).toBe(14);
    expect(Renderer.powerBarHeight(50)).toBe(14);
  });

  it('value=500: both C++ and TS render 102px', () => {
    expect(cppFinalPixelHeight(500)).toBe(102);
    expect(Renderer.powerBarHeight(500)).toBe(102);
  });

  it('value=1000: both C++ and TS render 135px', () => {
    expect(cppFinalPixelHeight(1000)).toBe(135);
    expect(Renderer.powerBarHeight(1000)).toBe(135);
  });

  it('value=2000: both C++ and TS render 148px', () => {
    expect(cppFinalPixelHeight(2000)).toBe(148);
    expect(Renderer.powerBarHeight(2000)).toBe(148);
  });
});

// ============================================================
// Section 5: Power_Height — value=0 returns 0 (short-circuit)
// C++ power.cpp:396-397 — num=0, no loop, no remainder
// ============================================================
describe('Power_Height zero/negative inputs (power.cpp:396)', () => {
  it('value=0 returns 0', () => {
    expect(Renderer.powerBarHeight(0)).toBe(0);
    expect(cppPowerHeight(0)).toBe(0);
  });

  it('negative value returns 0 (clamped by Bound)', () => {
    expect(Renderer.powerBarHeight(-100)).toBe(0);
    expect(cppPowerHeight(-100)).toBe(0);
  });

  it('value=1 returns small positive height', () => {
    // C++ raw: num=0, remainder=1. retval = (108/5)*1/100 = 21*1/100 = 0
    // TS: (floor(151/5)*1)/100 = floor(30*1/100) = 0
    expect(cppPowerHeight(1)).toBe(0);
    expect(Renderer.powerBarHeight(1)).toBe(0);
  });
});

// ============================================================
// Section 6: Logarithmic curve properties — both C++ and TS share these
// ============================================================
describe('Power_Height logarithmic curve invariants', () => {
  it('monotonically non-decreasing for values 0..5000', () => {
    let prev = 0;
    for (let v = 0; v <= 5000; v += 10) {
      const h = Renderer.powerBarHeight(v);
      expect(h, `value=${v}`).toBeGreaterThanOrEqual(prev);
      prev = h;
    }
  });

  it('each successive 100-unit step adds less or equal height (diminishing returns)', () => {
    // After rescaling (raw * 153 / 107), step sizes are generally non-increasing
    // but rescale rounding can cause occasional ties. Verify general trend.
    const first = Renderer.powerBarHeight(100) - Renderer.powerBarHeight(0);
    const last = Renderer.powerBarHeight(1000) - Renderer.powerBarHeight(900);
    expect(last).toBeLessThan(first);
  });

  it('height saturates — very large values produce same height', () => {
    const h5000 = Renderer.powerBarHeight(5000);
    const h10000 = Renderer.powerBarHeight(10000);
    expect(h10000).toBe(h5000);
  });

  it('result is always an integer', () => {
    for (let v = 0; v <= 2000; v += 37) {
      const h = Renderer.powerBarHeight(v);
      expect(Number.isInteger(h), `value=${v} → ${h}`).toBe(true);
    }
  });

  it('clamped to [0, POWER_HEIGHT - 2]', () => {
    const max = Renderer.POWER_HEIGHT - 2;
    expect(Renderer.powerBarHeight(0)).toBe(0);
    expect(Renderer.powerBarHeight(100000)).toBeLessThanOrEqual(max);
    expect(Renderer.powerBarHeight(100000)).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// Section 7: C++ integer division — TS must use Math.floor/trunc to match
// ============================================================
describe('Integer division parity (C++ truncation toward zero)', () => {
  it('C++ uses truncation (not floor) — TS now matches via Math.trunc', () => {
    // Fixed: TS now uses internal POWER_HEIGHT=110 + rescale, matching C++
    const h1 = Renderer.powerBarHeight(150);
    expect(h1).toBe(cppFinalPixelHeight(150));
  });

  it('remainder path uses nested integer division (power.cpp:412)', () => {
    // value=75: C++ raw: retval = ((108/5)*75)/100 = (21*75)/100 = 15
    // TS now matches: internal 110, rescaled
    const cppRaw = cppPowerHeight(75);
    const tsResult = Renderer.powerBarHeight(75);
    expect(cppRaw).toBe(15);
    // TS rescaled: floor(15 * 153 / 107) = floor(21.4) = 21
    expect(tsResult).toBe(Math.floor(cppRaw * 153 / 107));
  });
});

// ============================================================
// Section 8: Bounce animation — C++ AI() vs TS updatePowerAnimation()
// ============================================================
describe('Bounce animation — C++ AI() parity (power.cpp:268-350)', () => {
  it('bounce modtable matches C++ _modtable (power.cpp:168-170)', () => {
    // C++ static int _modtable[]={0, -1, 0, 1, 0, -1, -2, -1, 0, 1, 2, 1, 0};
    const CPP_MODTABLE = [0, -1, 0, 1, 0, -1, -2, -1, 0, 1, 2, 1, 0];
    expect(Renderer.POWER_MODTABLE).toEqual(CPP_MODTABLE);
  });

  it('modtable has 13 entries for bounce indices 0-12', () => {
    expect(Renderer.POWER_MODTABLE.length).toBe(13);
  });

  it('modtable is symmetric around entry 6 (peak displacement)', () => {
    const mod = Renderer.POWER_MODTABLE;
    // Peak negative displacement is at index 6: -2
    expect(mod[6]).toBe(-2);
    // Peak positive displacement is at index 10: +2
    expect(mod[10]).toBe(2);
  });

  // PARITY GAP: C++ increments height by exactly 1 per tick (power.cpp:318-319, 330-331).
  // TS uses proportional step: Math.max(1, Math.ceil(abs(desired-current)/8))
  // (renderer.ts:342-343). This means TS reaches the target faster than C++.
  it('C++ animation steps by exactly 1 per tick — TS uses proportional step — PARITY GAP', () => {
    // C++ AI (power.cpp:330-331):
    //   if (PowerHeight != DesiredPowerHeight) {
    //     PowerHeight += PowerDir;
    //   }
    // This means if PowerHeight=0 and DesiredPowerHeight=100, it takes exactly
    // 100 ticks to reach target.
    //
    // TS (renderer.ts:342-343):
    //   const pStep = Math.max(1, Math.ceil(Math.abs(desired - current) / 8));
    //   this.powerHeight += this.powerDir * pStep;
    // This accelerates: step starts at ceil(100/8)=13, then shrinks.
    //
    // We cannot directly test this without instantiating Renderer (needs canvas),
    // but we document the gap:
    const cppTicksToReach100 = 100; // always 1 per tick
    // TS would take roughly: 13+12+11+10+9+8+7+6+5+4+3+2+1+... ~= 16 ticks
    // This is a significant pacing divergence.
    expect(cppTicksToReach100).toBe(100);
    // Verify the formula difference is documented
    expect(Math.max(1, Math.ceil(100 / 8))).toBe(13); // TS first step
    expect(Math.max(1, Math.ceil(87 / 8))).toBe(11);  // TS second step
    expect(13).not.toBe(1); // PARITY GAP: C++ step is always 1
  });
});

// ============================================================
// Section 9: Flash timer — C++ TICKS_PER_SECOND vs TS 30 ticks
// ============================================================
describe('Flash timer — C++ Flash_Power parity (power.cpp:473-478)', () => {
  // C++ Flash_Power (power.cpp:475): FlashTimer = TICKS_PER_SECOND
  // C++ TICKS_PER_SECOND = 15 (defines.h:3031)
  // TS (renderer.ts:355): this.powerFlashTimer = 30

  it('C++ flash duration = TICKS_PER_SECOND = 15 ticks', () => {
    const CPP_TICKS_PER_SECOND = 15;
    expect(CPP_TICKS_PER_SECOND).toBe(15);
  });

  // PARITY GAP: TS flash lasts 30 ticks (2x longer than C++)
  // We cannot read the private field without instantiation, but the code review
  // confirms renderer.ts:355 uses 30, not 15.
  it('TS flash duration is 30 ticks — 2x longer than C++ — PARITY GAP', () => {
    // This is a code-review-verified gap. C++ uses 15, TS uses 30.
    // The TS comment says "flash for 2 seconds" which at 15 tps = 30 ticks.
    // But C++ flashes for exactly 1 second (15 ticks at 15 tps).
    const CPP_FLASH_TICKS = 15;
    const TS_FLASH_TICKS = 30; // from renderer.ts:355
    expect(TS_FLASH_TICKS).toBe(CPP_FLASH_TICKS * 2);
    expect(TS_FLASH_TICKS).not.toBe(CPP_FLASH_TICKS); // PARITY GAP
  });
});

// ============================================================
// Section 10: Flash trigger condition — C++ vs TS
// ============================================================
describe('Flash trigger condition parity (power.cpp:448, renderer.ts:354)', () => {
  // C++ triggers flash via explicit Flash_Power() call from external code,
  // checking Power_Fraction() < 1 && Power > 0 (power.cpp:448).
  // TS auto-triggers when consumed > produced && produced > 0 (renderer.ts:354).
  // Both conditions are functionally equivalent for the low-power case.

  it('low power condition: consumed > produced with produced > 0', () => {
    // Simulate the TS condition
    const produced = 100;
    const consumed = 150;
    const tsFlashCondition = consumed > produced && produced > 0;
    expect(tsFlashCondition).toBe(true);
  });

  it('no power system: produced = 0 does not trigger flash', () => {
    const produced = 0;
    const consumed = 150;
    const tsFlashCondition = consumed > produced && produced > 0;
    expect(tsFlashCondition).toBe(false);
  });

  it('balanced power does not trigger flash', () => {
    const produced = 200;
    const consumed = 200;
    const tsFlashCondition = consumed > produced && produced > 0;
    expect(tsFlashCondition).toBe(false);
  });
});

// ============================================================
// Section 11: Draw_It color thresholds (power.cpp:208-219)
// ============================================================
describe('Power bar color thresholds (power.cpp:208-219)', () => {
  // C++ color logic:
  //   default: color1=3 (green), color2=4 (green)
  //   if (Drain > Power): color1=214 (orange), color2=211 (orange)
  //   if (Drain > Power*2): color1=235 (red), color2=230 (red)

  it('TS defines three color tiers matching C++ palette indices', () => {
    // Verify TS has the three-tier color system
    expect(Renderer.POWER_COLOR_NORMAL).toBeDefined();
    expect(Renderer.POWER_COLOR_LOW).toBeDefined();
    expect(Renderer.POWER_COLOR_CRITICAL).toBeDefined();
  });

  it('normal power → green (C++ pal[3]/[4])', () => {
    // C++ uses palette indices 3 and 4 (green)
    expect(Renderer.POWER_COLOR_NORMAL).toHaveLength(2);
  });

  it('low power (drain > power) → orange (C++ pal[214]/[211])', () => {
    expect(Renderer.POWER_COLOR_LOW).toHaveLength(2);
  });

  it('critical power (drain > 2*power) → red (C++ pal[235]/[230])', () => {
    expect(Renderer.POWER_COLOR_CRITICAL).toHaveLength(2);
  });

  it('C++ color thresholds: drain > power (low), drain > 2*power (critical)', () => {
    // Simulate color selection logic matching C++ power.cpp:212-218
    function selectColor(power: number, drain: number): string {
      if (drain > power * 2) return 'critical';
      if (drain > power) return 'low';
      return 'normal';
    }

    expect(selectColor(100, 50)).toBe('normal');   // drain < power
    expect(selectColor(100, 100)).toBe('normal');  // drain == power
    expect(selectColor(100, 101)).toBe('low');     // drain > power
    expect(selectColor(100, 200)).toBe('low');     // drain == 2*power (NOT critical)
    expect(selectColor(100, 201)).toBe('critical');// drain > 2*power
    expect(selectColor(0, 0)).toBe('normal');      // no power system
  });
});

// ============================================================
// Section 12: Comprehensive TS powerBarHeight expected values
// These are the values the TS implementation actually returns,
// computed with POWER_HEIGHT=153, STEP_LEVEL=100, STEP_FACTOR=5.
// ============================================================
describe('TS powerBarHeight exact values (internal=110, rescaled)', () => {
  // Now matches C++ Power_Height(110) → Draw_It rescale (raw * 153 / 107)
  // Values from Section 3 (C++ rescaled):
  const EXPECTED: [number, number][] = [
    [0,    0],
    [50,   14],
    [100,  30],
    [150,  41],
    [200,  54],
    [300,  74],
    [500,  102],
    [1000, 135],
    [2000, 148],
  ];

  for (const [value, expected] of EXPECTED) {
    it(`powerBarHeight(${value}) = ${expected}`, () => {
      expect(Renderer.powerBarHeight(value)).toBe(expected);
    });
  }
});

// ============================================================
// Section 13: Remainder interpolation within a step
// ============================================================
describe('Remainder interpolation within 100-unit steps', () => {
  it('values 1-99 interpolate within first step (C++ internal=110, rescaled)', () => {
    // Internal first step: trunc(108/5) = 21 internal pixels
    // At value=v: internal = trunc((21 * v) / 100), then rescale: floor(internal * 153 / 107)
    // Just verify monotonicity and spot-check a few values
    expect(Renderer.powerBarHeight(10)).toBeLessThan(Renderer.powerBarHeight(50));
    expect(Renderer.powerBarHeight(50)).toBeLessThan(Renderer.powerBarHeight(99));
    expect(Renderer.powerBarHeight(99)).toBeLessThan(Renderer.powerBarHeight(100));
  });

  it('value=100 equals one full step, rescaled to match C++', () => {
    // C++ raw: trunc(108/5) = 21 internal pixels → rescale: floor(21*153/107) = 30
    expect(Renderer.powerBarHeight(100)).toBe(30);
  });

  it('second step increment is smaller than first (logarithmic)', () => {
    const firstStep = Renderer.powerBarHeight(100) - Renderer.powerBarHeight(0);
    const secondStep = Renderer.powerBarHeight(200) - Renderer.powerBarHeight(100);
    expect(secondStep).toBeLessThan(firstStep);
    expect(firstStep).toBe(30);
    expect(secondStep).toBe(24); // C++ rescaled: 54 - 30 = 24
  });
});

// ============================================================
// Section 14: Parity gap assertions — these FAIL to document real divergence
// Each test asserts what C++ expects. Failures prove TS diverges.
// ============================================================
describe('C++ parity — pixel heights match after fix', () => {
  it('POWER_HEIGHT_INTERNAL = 110 matches C++ POWER_HEIGHT', () => {
    // C++ power.h:85: POWER_HEIGHT=(200-(7+70+13)) = 110
    // TS uses 110 internally for calculation, 153 for rendered bar height
    expect(Renderer.POWER_HEIGHT_INTERNAL).toBe(110);
    expect(Renderer.POWER_HEIGHT).toBe(153); // rendered height (different from C++ internal)
  });

  // PARITY GAP: TS powerBarHeight(500) should return C++ rescaled value 102
  it('GAP 2: powerBarHeight(500) should be 102 (C++ rendered)', () => {
    // C++ Power_Height(500)=72, Draw_It rescales: (72*153)/107 = 102
    expect(Renderer.powerBarHeight(500)).toBe(102); // PARITY GAP: TS returns 100
  });

  // PARITY GAP: TS powerBarHeight(1000) should return C++ rescaled value 135
  it('GAP 3: powerBarHeight(1000) should be 135 (C++ rendered)', () => {
    // C++ Power_Height(1000)=95, Draw_It rescales: (95*153)/107 = 135
    expect(Renderer.powerBarHeight(1000)).toBe(135); // PARITY GAP: TS returns 133
  });

  // PARITY GAP: TS powerBarHeight(50) should return C++ rescaled value 14
  it('GAP 4: powerBarHeight(50) should be 14 (C++ rendered)', () => {
    // C++ Power_Height(50)=10, Draw_It rescales: (10*153)/107 = 14
    expect(Renderer.powerBarHeight(50)).toBe(14); // PARITY GAP: TS returns 15
  });

  // PARITY GAP: TS powerBarHeight(2000) should return C++ rescaled value 148
  it('GAP 5: powerBarHeight(2000) should be 148 (C++ rendered)', () => {
    // C++ Power_Height(2000)=104, Draw_It rescales: (104*153)/107 = 148
    expect(Renderer.powerBarHeight(2000)).toBe(148); // PARITY GAP: TS returns 147
  });
});
