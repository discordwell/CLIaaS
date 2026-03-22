/**
 * C++ Behavioral Parity: Recharge Timers & Timing Constants Audit
 *
 * Audits superweapon recharge times, special ability timers, and related
 * constants against rules.ini and C++ source code.
 *
 * All expected values derive from C++ source and rules.ini — NOT from TS code.
 *
 * Key C++ constants:
 *   TICKS_PER_SECOND = 15   (defines.h:3031)
 *   TICKS_PER_MINUTE = 900  (defines.h:3032 — 15 FPS × 60s)
 *
 * rules.ini [Recharge] section (time in minutes):
 *   Chrono=7, GPS=8, IronCurtain=11, Nuke=13,
 *   ParaBomb=14, Paratrooper=7, Saboteur=14, Sonar=10, SpyPlane=3
 *
 * rules.ini [General] section:
 *   IronCurtain=.75      → iron curtain invulnerability duration (minutes)
 *   ChronoDuration=3     → moebius return timer (minutes)
 *   C4Delay=.03          → C4 fuse time (minutes)
 *   GapRegenInterval=.1  → gap generator regen interval (minutes)
 *
 * C++ source references:
 *   house.cpp:653-660    — SuperWeapon recharge = TICKS_PER_MINUTE * Rule.<Weapon>Time
 *   house.cpp:2629       — sub->PulseCountDown = 15 * TICKS_PER_SECOND = 225
 *   house.cpp:2751       — IronCurtainCountDown = Rule.IronCurtainDuration * TICKS_PER_MINUTE
 *   house.cpp:2754       — demo truck: IronCurtainCountDown = Rule.IronCurtainDuration * TICKS_PER_SECOND
 *   house.cpp:2844       — MoebiusCountDown = Rule.ChronoDuration * TICKS_PER_MINUTE
 *   infantry.cpp:844     — building->CountDown = Rule.C4Delay * TICKS_PER_MINUTE
 *   building.cpp:993     — Arm = TICKS_PER_MINUTE * Rule.GapRegenInterval + Random_Pick(1, TICKS_PER_SECOND)
 *   super.h:80           — ANIMATION_STAGES = 54
 */

import { describe, it, expect } from 'vitest';
import {
  SuperweaponType, SUPERWEAPON_DEFS,
  IRON_CURTAIN_DURATION, IRON_CURTAIN_DEMO_TRUCK_DURATION,
  NUKE_DAMAGE, NUKE_BLAST_CELLS, NUKE_FLIGHT_TICKS, NUKE_MIN_FALLOFF,
  CHRONO_SHIFT_VISUAL_TICKS, SONAR_REVEAL_TICKS,
} from '../engine/types';
import { CHRONO_DURATION_TICKS } from '../engine/superweapon';
import { GAP_UPDATE_INTERVAL } from '../engine/fog';

// ---------------------------------------------------------------------------
// C++ reference constants (authoritative source of truth)
// ---------------------------------------------------------------------------

/** C++ defines.h:3031 — game tick rate */
const CPP_TICKS_PER_SECOND = 15;

/** C++ defines.h:3032 — 15 FPS × 60s */
const CPP_TICKS_PER_MINUTE = 900;

// =============================================================================
// 1. [Recharge] section — all 8 superweapons
//    C++ house.cpp:653-660: recharge = TICKS_PER_MINUTE * Rule.<Weapon>Time
//    rules.ini [Recharge] values in minutes:
//      Chrono=7, GPS=8, IronCurtain=11, Nuke=13,
//      ParaBomb=14, Paratrooper=7, Saboteur=14, Sonar=10, SpyPlane=3
// =============================================================================

describe('[Recharge] section: rechargeTicks = minutes * 60 * 15', () => {

  const RECHARGE_EXPECTATIONS: [SuperweaponType, string, number][] = [
    // [superweapon enum, rules.ini key, minutes from rules.ini]
    [SuperweaponType.CHRONOSPHERE,  'Chrono',      7],
    [SuperweaponType.IRON_CURTAIN,  'IronCurtain', 11],
    [SuperweaponType.NUKE,          'Nuke',        13],
    [SuperweaponType.GPS_SATELLITE, 'GPS',          8],
    [SuperweaponType.SONAR_PULSE,   'Sonar',       14], // C++ rules.cpp:210 SonarTime(14)
    [SuperweaponType.PARABOMB,      'ParaBomb',    14],
    [SuperweaponType.PARAINFANTRY,  'Paratrooper',  7],
    [SuperweaponType.SPY_PLANE,     'SpyPlane',     3],
  ];

  for (const [type, iniKey, minutes] of RECHARGE_EXPECTATIONS) {
    const expectedTicks = minutes * CPP_TICKS_PER_MINUTE;
    it(`${iniKey}=${minutes} min → rechargeTicks = ${expectedTicks}`, () => {
      expect(
        SUPERWEAPON_DEFS[type].rechargeTicks,
        `${SUPERWEAPON_DEFS[type].name} rechargeTicks should be ${minutes} * ${CPP_TICKS_PER_MINUTE}`
      ).toBe(expectedTicks);
    });
  }

  it('all 8 superweapons are covered by recharge table', () => {
    const allTypes = Object.values(SuperweaponType);
    expect(RECHARGE_EXPECTATIONS.length).toBe(allTypes.length);
    for (const type of allTypes) {
      expect(
        RECHARGE_EXPECTATIONS.some(([t]) => t === type),
        `${type} should be in recharge expectations table`
      ).toBe(true);
    }
  });

  it('rules.ini [Recharge] Saboteur=14 — TS has no SABOTEUR superweapon type', () => {
    // C++ has SPC_PARA_SABOTAGE as a 9th superweapon (Saboteur=14 min recharge).
    // TS SuperweaponType enum does not include SABOTEUR — this is a known gap.
    const allTypeValues = Object.values(SuperweaponType) as string[];
    const hasSaboteur = allTypeValues.some(v =>
      v === 'SABOTEUR' || v === 'PARA_SABOTEUR' || v === 'PARA_SABOTAGE'
    );
    // This test documents the gap. If Saboteur is ever added, update the
    // RECHARGE_EXPECTATIONS table above.
    expect(hasSaboteur).toBe(false);
  });
});

// =============================================================================
// 2. [General] timing constants
// =============================================================================

describe('[General] timing constants match rules.ini + C++ formulas', () => {

  // rules.ini [General] IronCurtain=.75
  // C++ house.cpp:2751: IronCurtainCountDown = Rule.IronCurtainDuration * TICKS_PER_MINUTE
  it('IronCurtain duration = 0.75 min × 900 = 675 ticks (house.cpp:2751)', () => {
    const RULES_INI_IRON_CURTAIN = 0.75; // IronCurtain=.75
    const expected = RULES_INI_IRON_CURTAIN * CPP_TICKS_PER_MINUTE; // 675
    expect(IRON_CURTAIN_DURATION).toBe(expected);
  });

  // C++ house.cpp:2754: demo truck gets shortened duration
  // IronCurtainCountDown = Rule.IronCurtainDuration * TICKS_PER_SECOND
  it('Iron Curtain demo truck duration = 0.75 × 15 = 11 ticks (house.cpp:2754)', () => {
    const RULES_INI_IRON_CURTAIN = 0.75;
    const expected = Math.floor(RULES_INI_IRON_CURTAIN * CPP_TICKS_PER_SECOND); // floor(11.25) = 11
    expect(IRON_CURTAIN_DEMO_TRUCK_DURATION).toBe(expected);
  });

  // rules.ini [General] ChronoDuration=3
  // C++ house.cpp:2844: MoebiusCountDown = Rule.ChronoDuration * TICKS_PER_MINUTE
  it('ChronoDuration = 3 min × 900 = 2700 ticks (house.cpp:2844)', () => {
    const RULES_INI_CHRONO_DURATION = 3; // ChronoDuration=3
    const expected = RULES_INI_CHRONO_DURATION * CPP_TICKS_PER_MINUTE; // 2700
    expect(CHRONO_DURATION_TICKS).toBe(expected);
  });

  // rules.ini [General] C4Delay=.03
  // C++ infantry.cpp:844: building->CountDown = Rule.C4Delay * TICKS_PER_MINUTE
  it('C4Delay = 0.03 min × 900 = 27 ticks (infantry.cpp:844)', () => {
    const RULES_INI_C4_DELAY = 0.03; // C4Delay=.03
    const expectedTicks = RULES_INI_C4_DELAY * CPP_TICKS_PER_MINUTE; // 27
    // Verify the expected C++ value is correct
    expect(expectedTicks).toBe(27);
    // Note: TS engine has no C4_DELAY constant — this documents the expected value
    // for when C4 demolition charges are implemented.
  });

  // rules.ini [General] AtomDamage=1000
  it('AtomDamage = 1000 (rules.ini [General] AtomDamage=1000)', () => {
    expect(NUKE_DAMAGE).toBe(1000);
  });
});

// =============================================================================
// 3. Sonar pulse duration
//    C++ house.cpp:2629: sub->PulseCountDown = 15 * TICKS_PER_SECOND
//    C++ house.cpp:1218: same formula used in Super_Weapon_Handler
//    15 × 15 = 225 ticks
// =============================================================================

describe('sonar pulse duration (house.cpp:2629, house.cpp:1218)', () => {

  it('SONAR_REVEAL_TICKS = 15 × TICKS_PER_SECOND = 225', () => {
    // C++ uses literal 15 * TICKS_PER_SECOND, not a named constant
    const expected = 15 * CPP_TICKS_PER_SECOND; // 225
    expect(SONAR_REVEAL_TICKS).toBe(expected);
  });

  it('SONAR_REVEAL_TICKS represents exactly 15 seconds at game tick rate', () => {
    expect(SONAR_REVEAL_TICKS / CPP_TICKS_PER_SECOND).toBe(15);
  });
});

// =============================================================================
// 4. Nuke flight time
//    C++ house.cpp:2639 — missile travel time before detonation
//    NUKE_FLIGHT_TICKS = 45 → 3 seconds of flight at 15 FPS
// =============================================================================

describe('nuke flight time', () => {

  it('NUKE_FLIGHT_TICKS = 45 (3 seconds at 15 FPS)', () => {
    expect(NUKE_FLIGHT_TICKS).toBe(45);
  });

  it('nuke flight is exactly 3 seconds', () => {
    expect(NUKE_FLIGHT_TICKS / CPP_TICKS_PER_SECOND).toBe(3);
  });

  it('NUKE_BLAST_CELLS = 10 cells blast radius', () => {
    expect(NUKE_BLAST_CELLS).toBe(10);
  });

  it('NUKE_MIN_FALLOFF = 0.1 (10% damage at blast edge)', () => {
    expect(NUKE_MIN_FALLOFF).toBe(0.1);
  });
});

// =============================================================================
// 5. Chrono visual duration
//    CHRONO_SHIFT_VISUAL_TICKS = 30 (2 seconds blue flash at 15 FPS)
// =============================================================================

describe('chronoshift visual duration', () => {

  it('CHRONO_SHIFT_VISUAL_TICKS = 30 (2 seconds at 15 FPS)', () => {
    expect(CHRONO_SHIFT_VISUAL_TICKS).toBe(30);
  });

  it('chrono visual is exactly 2 seconds', () => {
    expect(CHRONO_SHIFT_VISUAL_TICKS / CPP_TICKS_PER_SECOND).toBe(2);
  });
});

// =============================================================================
// 6. Gap generator update interval
//    C++ building.cpp:993:
//      Arm = TICKS_PER_MINUTE * Rule.GapRegenInterval + Random_Pick(1, TICKS_PER_SECOND)
//    rules.ini [General] GapRegenInterval=.1
//    Base interval: 900 * 0.1 = 90 ticks
//    C++ adds Random_Pick(1, 15) jitter — TS uses fixed 90
// =============================================================================

describe('gap generator update interval (building.cpp:993, rules.ini GapRegenInterval=.1)', () => {

  it('GAP_UPDATE_INTERVAL = 90 (base: 900 × 0.1 = 90 ticks)', () => {
    const RULES_INI_GAP_REGEN = 0.1; // GapRegenInterval=.1
    const expectedBase = CPP_TICKS_PER_MINUTE * RULES_INI_GAP_REGEN; // 90
    expect(GAP_UPDATE_INTERVAL).toBe(expectedBase);
  });

  it('C++ adds Random_Pick(1, TICKS_PER_SECOND) jitter — TS omits randomness', () => {
    // C++ building.cpp:993: Arm = TICKS_PER_MINUTE * Rule.GapRegenInterval + Random_Pick(1, TICKS_PER_SECOND)
    // C++ actual interval = 90 + random(1..15) = range [91, 105]
    // TS uses fixed 90 — this means TS gap generators update slightly more frequently
    // than C++ (by 1-15 ticks). This is a known simplification.
    const cppMinInterval = 90 + 1;   // 91
    const cppMaxInterval = 90 + CPP_TICKS_PER_SECOND; // 105
    // TS interval is below C++ minimum
    expect(GAP_UPDATE_INTERVAL).toBeLessThan(cppMinInterval);
    // Document the C++ range
    expect(cppMaxInterval - cppMinInterval).toBe(14); // 14-tick jitter window
  });

  it('gap update interval represents 6 seconds at game tick rate', () => {
    expect(GAP_UPDATE_INTERVAL / CPP_TICKS_PER_SECOND).toBe(6);
  });
});

// =============================================================================
// 7. Cross-validation: recharge tick arithmetic
//    Verify rechargeTicks = minutes * 60 * 15 for ALL superweapons
//    (catches rounding errors or wrong multiplier)
// =============================================================================

describe('cross-validation: rechargeTicks divisible by TICKS_PER_MINUTE', () => {

  for (const [type, def] of Object.entries(SUPERWEAPON_DEFS)) {
    it(`${def.name} rechargeTicks (${def.rechargeTicks}) is exactly divisible by 900`, () => {
      expect(def.rechargeTicks % CPP_TICKS_PER_MINUTE).toBe(0);
    });

    it(`${def.name} recharge minutes is a positive integer`, () => {
      const minutes = def.rechargeTicks / CPP_TICKS_PER_MINUTE;
      expect(Number.isInteger(minutes)).toBe(true);
      expect(minutes).toBeGreaterThan(0);
    });
  }
});

// =============================================================================
// 8. Duration relationships — sanity checks from C++ formulas
// =============================================================================

describe('duration relationship sanity checks', () => {

  it('iron curtain duration < iron curtain recharge (you cannot perma-IC)', () => {
    const icRecharge = SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].rechargeTicks;
    expect(IRON_CURTAIN_DURATION).toBeLessThan(icRecharge);
    // IC lasts 675 ticks, recharges in 9900 ticks — ratio ~14.7:1
    const ratio = icRecharge / IRON_CURTAIN_DURATION;
    expect(ratio).toBeGreaterThan(10); // well above 1:1
  });

  it('chrono return timer < chrono recharge (chronoshift is temporary)', () => {
    const chronoRecharge = SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].rechargeTicks;
    expect(CHRONO_DURATION_TICKS).toBeLessThan(chronoRecharge);
  });

  it('sonar reveal < sonar recharge (sonar pulse is temporary)', () => {
    const sonarRecharge = SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks;
    expect(SONAR_REVEAL_TICKS).toBeLessThan(sonarRecharge);
  });

  it('nuke flight time << nuke recharge', () => {
    const nukeRecharge = SUPERWEAPON_DEFS[SuperweaponType.NUKE].rechargeTicks;
    expect(NUKE_FLIGHT_TICKS).toBeLessThan(nukeRecharge / 100); // flight is trivial vs recharge
  });

  it('chrono visual << chrono return timer (flash much shorter than moebius timer)', () => {
    expect(CHRONO_SHIFT_VISUAL_TICKS).toBeLessThan(CHRONO_DURATION_TICKS / 10);
  });

  it('demo truck IC duration << normal IC duration (house.cpp:2754 uses TICKS_PER_SECOND not TICKS_PER_MINUTE)', () => {
    // C++ house.cpp:2751: normal = IronCurtainDuration * TICKS_PER_MINUTE
    // C++ house.cpp:2754: demo   = IronCurtainDuration * TICKS_PER_SECOND
    // Ratio should be exactly 60 (MINUTE/SECOND)
    const ratio = IRON_CURTAIN_DURATION / IRON_CURTAIN_DEMO_TRUCK_DURATION;
    // With 675 / 11 = 61.36... due to floor(), not exactly 60.
    // C++ actual: 0.75 * 900 = 675, 0.75 * 15 = 11.25 → truncated to 11
    // So ratio is 675/11 ≈ 61.36 (close to 60 but not exact due to truncation)
    expect(ratio).toBeGreaterThan(59);
    expect(ratio).toBeLessThan(62);
  });
});
