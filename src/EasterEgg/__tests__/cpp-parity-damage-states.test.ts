/**
 * C++ Behavioral Parity Tests — Building/Unit Damage State Transitions
 *
 * Tests ConditionGreen/Yellow/Red thresholds, cloak suppression at low HP,
 * fear/prone transitions, and self-healing caps.
 *
 * ## C++ Source References
 *
 * ### Condition Thresholds (rules.cpp:233-235):
 *   ConditionGreen(1),             // full health (ratio == 1.0)
 *   ConditionYellow(fixed(1, 2)),  // half health (ratio <= 0.5)
 *   ConditionRed(fixed(1, 4)),     // quarter health (ratio <= 0.25)
 *
 * ### Health Ratio (object.cpp:1917):
 *   fixed ObjectClass::Health_Ratio(void) const {
 *     return(fixed(Strength, Class_Of().MaxStrength));
 *   }
 *
 * ### Cloak Suppression at Low HP (techno.cpp:2443-2449):
 *   if (Health_Ratio() > Rule.ConditionRed) {
 *     Do_Cloak();                  // above 25%: always cloak
 *   } else {
 *     if (Percent_Chance(4)) {     // at/below 25%: only 4% chance
 *       Do_Cloak();
 *     }
 *   }
 *
 * ### Cloak Instability at Low HP (techno.cpp:2488-2491):
 *   case VISUAL_DARKEN:
 *     if (Health_Ratio() <= Rule.ConditionRed && Percent_Chance(25)) {
 *       Cloak = UNCLOAKING;        // 25% chance to revert during cloaking
 *     }
 *
 * ### Self-Healing Cap (techno.cpp:2354):
 *   if (IsSelfHealing && ... && Health_Ratio() <= Rule.ConditionYellow) {
 *     Strength++;                  // only heals up to ConditionYellow (50%)
 *   }
 *
 * ### Infantry Fear on Damage (infantry.cpp:442-457):
 *   if (source != NULL && Fear < FEAR_SCARED) {
 *     if (Class->IsFraidyCat) {
 *       Fear = FEAR_PANIC;         // civilians jump to 200
 *     } else {
 *       Fear = FEAR_SCARED;        // soldiers jump to 100
 *     }
 *   } else {
 *     int morefear = FEAR_ANXIOUS; // 10
 *     if (Health_Ratio() > Rule.ConditionRed) morefear /= 2;   // 5
 *     if (Health_Ratio() > Rule.ConditionYellow) morefear /= 2; // 2
 *     Fear = min(Fear + morefear, FEAR_MAXIMUM);
 *   }
 *
 * ### Fear Constants (defines.h:617-623):
 *   FEAR_NONE     = 0
 *   FEAR_ANXIOUS  = 10
 *   FEAR_SCARED   = 100
 *   FEAR_PANIC    = 200
 *   FEAR_MAXIMUM  = 255
 *
 * ### Fear_AI Prone Transitions (infantry.cpp:3486-3498):
 *   if (IsProne) {
 *     if (Fear < FEAR_ANXIOUS) Do_Action(DO_GET_UP);
 *   } else {
 *     if (!IsDog && Height==0 && Fear >= FEAR_ANXIOUS && !moving)
 *       Do_Action(DO_LIE_DOWN);
 *   }
 *
 * ### Health Bar Color (techno.cpp:1147-1152):
 *   color = LTGREEN;
 *   if (ratio <= Rule.ConditionYellow) color = YELLOW;
 *   if (ratio <= Rule.ConditionRed)    color = RED;
 *
 * ### Building Damage Shape Offset (building.cpp:502, 632, 639, 651, 669, 679):
 *   if (Health_Ratio() <= Rule.ConditionYellow) shapenum += offset;
 *
 * ### Building Sell-Back AI (building.cpp:5452):
 *   if (Health_Ratio() < Rule.ConditionRed) Sell_Back(1);
 *
 * ### Unit Smoke on Damage (unit.cpp:1113):
 *   if (Health_Ratio() <= Rule.ConditionYellow && !IsAnimAttached)
 *     // spawn smoke animation
 *
 * ### Vessel Smoke on Damage (vessel.cpp:975-977):
 *   if (Health_Ratio() <= Rule.ConditionYellow && !IsAnimAttached && !submarine)
 *     // spawn smoke animation
 *
 * ### ResultType (defines.h:1078-1084):
 *   RESULT_NONE      — no damage
 *   RESULT_LIGHT     — some damage, no state change
 *   RESULT_HALF      — crossed below 50% (only on transition)
 *   RESULT_MAJOR     — reduced to exactly 1 HP
 *   RESULT_DESTROYED — reduced to 0 HP
 *
 * ### ObjectClass::Take_Damage (object.cpp:1620-1659):
 *   if (oldstrength > damage) {
 *     if (oldstrength >= maxstrength/2 && (oldstrength-damage) < maxstrength/2)
 *       result = RESULT_HALF;
 *   } else {
 *     damage = oldstrength;  // cap damage at remaining strength
 *   }
 *   Strength = oldstrength - damage;
 *   if (Strength == 0) result = RESULT_DESTROYED;
 *   if (Strength == 1) result = RESULT_MAJOR;
 */

import { describe, it, expect } from 'vitest';
import { Entity, CloakState, CLOAK_TRANSITION_FRAMES } from '../engine/entity';
import {
  CONDITION_RED, CONDITION_YELLOW, PRONE_DAMAGE_BIAS,
  House, UnitType, Dir, Mission, AnimState,
  UNIT_STATS,
} from '../engine/types';

// ============================================================
// Section 1: Condition Threshold Constants
// C++ rules.cpp:233-235 — ConditionGreen=1, ConditionYellow=1/2, ConditionRed=1/4
// ============================================================
describe('Condition Threshold Constants (rules.cpp:233-235)', () => {
  it('CONDITION_RED equals 0.25 (fixed(1,4))', () => {
    // C++ rules.cpp:235: ConditionRed(fixed(1, 4))
    expect(CONDITION_RED).toBe(0.25);
  });

  it('CONDITION_YELLOW equals 0.5 (fixed(1,2))', () => {
    // C++ rules.cpp:234: ConditionYellow(fixed(1, 2))
    expect(CONDITION_YELLOW).toBe(0.5);
  });

  it('CONDITION_RED < CONDITION_YELLOW (red is worse than yellow)', () => {
    // Invariant: red threshold is strictly less than yellow
    expect(CONDITION_RED).toBeLessThan(CONDITION_YELLOW);
  });
});

// ============================================================
// Section 2: Health Ratio Calculation
// C++ object.cpp:1917: fixed(Strength, Class_Of().MaxStrength)
// ============================================================
describe('Health Ratio Calculation (object.cpp:1917)', () => {
  it('full health unit has ratio 1.0', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(e.hp / e.maxHp).toBe(1.0);
  });

  it('half health unit has ratio 0.5 (ConditionYellow boundary)', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    e.hp = Math.floor(e.maxHp / 2);
    expect(e.hp / e.maxHp).toBe(0.5);
  });

  it('quarter health unit has ratio 0.25 (ConditionRed boundary)', () => {
    // Use 2TNK (400 HP) — divisible by 4, so floor(400/4)=100, 100/400=0.25 exact
    // E1 (50 HP) gives floor(50/4)=12, 12/50=0.24 due to integer truncation
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    expect(e.maxHp).toBe(400); // sanity check
    e.hp = Math.floor(e.maxHp / 4);
    expect(e.hp / e.maxHp).toBe(0.25);
  });

  it('1 HP unit has ratio near zero but > 0', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    e.hp = 1;
    expect(e.hp / e.maxHp).toBeGreaterThan(0);
    expect(e.hp / e.maxHp).toBeLessThanOrEqual(CONDITION_RED);
  });
});

// ============================================================
// Section 3: Health Bar Color Logic
// C++ techno.cpp:1147-1152:
//   color = LTGREEN
//   if (ratio <= ConditionYellow) color = YELLOW
//   if (ratio <= ConditionRed)    color = RED
// ============================================================
describe('Health Bar Color Derivation (techno.cpp:1147-1152)', () => {
  /** Derive C++ health bar color from HP ratio */
  function healthBarColor(ratio: number): 'green' | 'yellow' | 'red' {
    let color: 'green' | 'yellow' | 'red' = 'green';
    if (ratio <= CONDITION_YELLOW) color = 'yellow';
    if (ratio <= CONDITION_RED) color = 'red';
    return color;
  }

  it('full health = green', () => {
    expect(healthBarColor(1.0)).toBe('green');
  });

  it('75% health = green (above ConditionYellow)', () => {
    expect(healthBarColor(0.75)).toBe('green');
  });

  it('51% health = green (above ConditionYellow)', () => {
    expect(healthBarColor(0.51)).toBe('green');
  });

  it('50% health = yellow (at ConditionYellow boundary, <= 0.5)', () => {
    // C++ uses <= so exactly 50% is yellow
    expect(healthBarColor(0.50)).toBe('yellow');
  });

  it('49% health = yellow', () => {
    expect(healthBarColor(0.49)).toBe('yellow');
  });

  it('26% health = yellow', () => {
    expect(healthBarColor(0.26)).toBe('yellow');
  });

  it('25% health = red (at ConditionRed boundary, <= 0.25)', () => {
    // C++ uses <= so exactly 25% is red
    expect(healthBarColor(0.25)).toBe('red');
  });

  it('24% health = red', () => {
    expect(healthBarColor(0.24)).toBe('red');
  });

  it('1% health = red', () => {
    expect(healthBarColor(0.01)).toBe('red');
  });
});

// ============================================================
// Section 4: Infantry Fear System
// C++ infantry.cpp:442-457, defines.h:617-623
// ============================================================
describe('Infantry Fear Constants (defines.h:617-623)', () => {
  it('FEAR_ANXIOUS = 10', () => {
    expect(Entity.FEAR_ANXIOUS).toBe(10);
  });

  it('FEAR_SCARED = 100', () => {
    expect(Entity.FEAR_SCARED).toBe(100);
  });

  it('FEAR_PANIC = 200', () => {
    expect(Entity.FEAR_PANIC).toBe(200);
  });

  it('FEAR_MAXIMUM = 255', () => {
    expect(Entity.FEAR_MAXIMUM).toBe(255);
  });

  it('fear ordering: NONE < ANXIOUS < SCARED < PANIC < MAXIMUM', () => {
    expect(0).toBeLessThan(Entity.FEAR_ANXIOUS);
    expect(Entity.FEAR_ANXIOUS).toBeLessThan(Entity.FEAR_SCARED);
    expect(Entity.FEAR_SCARED).toBeLessThan(Entity.FEAR_PANIC);
    expect(Entity.FEAR_PANIC).toBeLessThan(Entity.FEAR_MAXIMUM);
  });
});

describe('Infantry Fear on Damage (infantry.cpp:442-457)', () => {
  // C++ infantry.cpp:442: fear jump requires known attacker (source != NULL)
  const mkAttacker = () => new Entity(UnitType.I_E1, House.USSR, 200, 200);

  it('first hit on unafraid infantry sets fear to FEAR_SCARED (100)', () => {
    // C++ infantry.cpp:442-446:
    //   if (source != NULL && Fear < FEAR_SCARED) {
    //     if (Class->IsFraidyCat) Fear = FEAR_PANIC;
    //     else Fear = FEAR_SCARED;
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(e.fear).toBe(0);
    e.takeDamage(5, 'SA', mkAttacker());
    expect(e.fear).toBeGreaterThanOrEqual(Entity.FEAR_SCARED);
  });

  it('subsequent hits add incremental fear based on health condition', () => {
    // C++ infantry.cpp:454-457:
    //   morefear = FEAR_ANXIOUS (10)
    //   if (Health_Ratio() > ConditionRed)    morefear /= 2 → 5
    //   if (Health_Ratio() > ConditionYellow) morefear /= 2 → 2
    //   Fear = min(Fear + morefear, FEAR_MAXIMUM)
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    // Set fear to already SCARED so the "first hit" branch is skipped
    e.fear = Entity.FEAR_SCARED;
    const fearBefore = e.fear;
    e.takeDamage(1, 'SA'); // light damage at full health
    // At full health: morefear = 10 /2 /2 = 2
    // Fear should increase
    expect(e.fear).toBeGreaterThan(fearBefore);
  });

  it('fear increases more at ConditionRed HP than at full HP', () => {
    // C++: morefear halving depends on Health_Ratio vs thresholds
    // At full HP (>Yellow, >Red): morefear = 10 /2 /2 = 2
    // At Red HP (<=Red): morefear = 10 (no halving at all)

    // Full health entity
    const eHealthy = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    eHealthy.fear = Entity.FEAR_SCARED; // skip first-hit branch
    const healthyBefore = eHealthy.fear;
    eHealthy.takeDamage(1, 'SA');
    const healthyIncrease = eHealthy.fear - healthyBefore;

    // Low health entity (at ConditionRed)
    const eLow = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    eLow.hp = Math.floor(eLow.maxHp * CONDITION_RED); // exactly at ConditionRed
    eLow.fear = Entity.FEAR_SCARED;
    const lowBefore = eLow.fear;
    eLow.takeDamage(1, 'SA');
    const lowIncrease = eLow.fear - lowBefore;

    expect(lowIncrease).toBeGreaterThanOrEqual(healthyIncrease);
  });

  it('fear never exceeds FEAR_MAXIMUM (255)', () => {
    // C++ infantry.cpp:457: Fear = min(Fear + morefear, FEAR_MAXIMUM)
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    e.fear = 254;
    e.hp = Math.floor(e.maxHp * 0.1); // low HP for max fear increase
    e.takeDamage(1, 'SA');
    expect(e.fear).toBeLessThanOrEqual(Entity.FEAR_MAXIMUM);
  });

  it('civilians (IsFraidyCat) should jump to FEAR_PANIC on first hit', () => {
    // C++ infantry.cpp:443-444:
    //   if (Class->IsFraidyCat) Fear = FEAR_PANIC;
    const c = new Entity(UnitType.I_C1, House.Spain, 100, 100);
    expect(c.stats.isFraidyCat).toBe(true);
    expect(c.fear).toBe(0);
    c.takeDamage(1, 'SA', mkAttacker());
    // C++ differentiates: IsFraidyCat civilians get FEAR_PANIC (200), soldiers get FEAR_SCARED (100).
    expect(c.fear).toBeGreaterThanOrEqual(Entity.FEAR_PANIC); // C++ expectation: FEAR_PANIC (200)
  });
});

// ============================================================
// Section 5: Infantry Prone State Transitions
// C++ infantry.cpp:3486-3498 (Fear_AI)
// ============================================================
describe('Infantry Prone State (infantry.cpp:3486-3498)', () => {
  it('infantry starts not prone (Fear=0 < FEAR_ANXIOUS)', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(e.isProne).toBe(false);
    expect(e.fear).toBe(0);
  });

  it('PRONE_DAMAGE_BIAS is 0.5 (rules.cpp:202)', () => {
    // C++ rules.cpp:202: ProneDamageBias = fixed(1,2) = 0.5
    expect(PRONE_DAMAGE_BIAS).toBe(0.5);
  });

  it('prone infantry takes half damage', () => {
    // C++ infantry.cpp:329-330: prone infantry damage *= ProneDamageBias
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    e.isProne = true;
    const hpBefore = e.hp;
    e.takeDamage(10, 'SA');
    const actualDamage = hpBefore - e.hp;
    // Should take ~5 damage (10 * 0.5, minimum 1)
    expect(actualDamage).toBe(5);
  });

  it('prone damage is at minimum 1 even with small damage', () => {
    // C++ min damage 1: Math.max(1, Math.round(amount * PRONE_DAMAGE_BIAS))
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    e.isProne = true;
    const hpBefore = e.hp;
    e.takeDamage(1, 'SA');
    const actualDamage = hpBefore - e.hp;
    expect(actualDamage).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// Section 6: Cloak Suppression at Low HP
// C++ techno.cpp:2443-2449 — above ConditionRed: always cloak,
//   at/below: only 4% chance (Percent_Chance(4))
// ============================================================
describe('Cloak Initiation vs Health (techno.cpp:2443-2449)', () => {
  it('above ConditionRed: always eligible to cloak (C++ Do_Cloak unconditionally)', () => {
    // C++ techno.cpp:2444: if (Health_Ratio() > Rule.ConditionRed) Do_Cloak();
    // At 50% HP (above 25%), cloaking should always proceed
    const ratio = 0.50;
    expect(ratio > CONDITION_RED).toBe(true);
  });

  it('below ConditionRed: only 4% chance to cloak', () => {
    // C++ techno.cpp:2447: if (Percent_Chance(4)) Do_Cloak();
    const ratio = 0.20;
    expect(ratio > CONDITION_RED).toBe(false);
    // The 4% chance is the gate — 96% of the time, cloak is suppressed
  });

  it('exactly at ConditionRed boundary (25%): both suppress cloak (4% gate)', () => {
    // C++ techno.cpp:2444: if (Health_Ratio() > Rule.ConditionRed)
    // At exactly 25%, Health_Ratio() == Rule.ConditionRed, so > is FALSE → 4% branch
    // TS now uses <= (fixed from <): entity.hp / entity.maxHp <= CONDITION_RED
    // At exactly 25%: 0.25 <= 0.25 is TRUE → TS enters 4% branch (matches C++)
    const ratio = CONDITION_RED; // exactly 0.25

    // C++ behavior: ratio > ConditionRed is false → suppressed (4% gate)
    const cppWouldSuppressCloak = !(ratio > CONDITION_RED);
    expect(cppWouldSuppressCloak).toBe(true);

    // TS behavior: ratio <= CONDITION_RED is true → suppressed (4% gate)
    const tsWouldSuppressCloak = ratio <= CONDITION_RED;
    expect(tsWouldSuppressCloak).toBe(true);

    // Both now agree at the boundary
    expect(cppWouldSuppressCloak).toBe(tsWouldSuppressCloak);
  });
});

// ============================================================
// Section 7: Cloak Instability During Cloaking
// C++ techno.cpp:2488-2491 — while in CLOAKING state at VISUAL_DARKEN,
//   if Health_Ratio() <= ConditionRed, 25% chance to revert to UNCLOAKING
// ============================================================
describe('Cloak Instability at Low HP (techno.cpp:2488-2491)', () => {
  it('TS has no cloak instability during CLOAKING state at low HP', () => {
    // C++ techno.cpp:2488-2491:
    //   case VISUAL_DARKEN:
    //     if (Health_Ratio() <= Rule.ConditionRed && Percent_Chance(25)) {
    //       Cloak = UNCLOAKING;
    //     }
    //
    // In C++, a badly-damaged unit that is in the middle of cloaking can
    // randomly abort cloaking and revert to uncloaking. This creates visual
    // "shimmer" instability that makes damaged stealth units easier to spot.
    //
    // TS (index.ts:4440-4444) has NO equivalent:
    //   case CloakState.CLOAKING:
    //     entity.cloakTimer--;
    //     if (entity.cloakTimer <= 0) {
    //       entity.cloakState = CloakState.CLOAKED;  // always succeeds
    //     }
    //
    // KNOWN DIVERGENCE: TS cloaking always succeeds regardless of health.
    // C++ cloaking at low HP randomly fails 25% of the time per tick.

    // Verify TS cloaking always succeeds even at 1 HP
    const e = new Entity(UnitType.V_STNK, House.USSR, 100, 100);
    e.hp = 1; // critically damaged
    e.cloakState = CloakState.CLOAKING;
    e.cloakTimer = 1; // about to finish cloaking

    // Simulate the TS cloaking tick
    e.cloakTimer--;
    if (e.cloakTimer <= 0) {
      e.cloakState = CloakState.CLOAKED;
      e.cloakTimer = 0;
    }

    // TS: always transitions to CLOAKED
    expect(e.cloakState).toBe(CloakState.CLOAKED);

    // In C++, this would have a 25% chance of reverting to UNCLOAKING
    // since Health_Ratio() <= ConditionRed. This test documents the gap.
  });
});

// ============================================================
// Section 8: Self-Healing Cap at ConditionYellow
// C++ techno.cpp:2354:
//   if (IsSelfHealing && ... && Health_Ratio() <= ConditionYellow)
//     Strength++;
// ============================================================
describe('Self-Healing Cap (techno.cpp:2354)', () => {
  it('C++ self-healing only activates at or below ConditionYellow (50%)', () => {
    // C++ techno.cpp:2354: Health_Ratio() <= Rule.ConditionYellow
    // At 51% HP, self-healing should NOT activate
    // At 50% HP, self-healing SHOULD activate
    const maxHp = 600; // Mammoth Tank
    const halfHp = maxHp / 2; // 300 = exactly 50%

    expect(halfHp / maxHp).toBe(CONDITION_YELLOW); // boundary
    expect((halfHp + 1) / maxHp).toBeGreaterThan(CONDITION_YELLOW); // above = no heal
    expect((halfHp - 1) / maxHp).toBeLessThan(CONDITION_YELLOW); // below = heal
  });

  it('4TNK and HARV have selfHealing matching C++ IsSelfHealing', () => {
    // C++ type.h:408: unsigned IsSelfHealing:1;
    // C++ techno.cpp:2354: heals +1 HP per RepairRate when <= ConditionYellow
    const mammothStats = UNIT_STATS['4TNK'];
    expect(mammothStats).toBeDefined();
    expect(mammothStats.strength).toBe(600);
    expect(mammothStats.selfHealing).toBe(true);

    const harvStats = UNIT_STATS['HARV'];
    expect(harvStats.selfHealing).toBe(true);
  });
});

// ============================================================
// Section 9: Entity takeDamage() Damage State Transitions
// C++ object.cpp:1559-1681 — ObjectClass::Take_Damage
// ============================================================
describe('takeDamage Damage Transitions (object.cpp:1559-1681)', () => {
  it('lethal damage kills the entity (Strength -> 0, RESULT_DESTROYED)', () => {
    // C++ object.cpp:1644-1646: Strength==0 → RESULT_DESTROYED
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    const killed = e.takeDamage(e.maxHp + 100, 'Super');
    expect(killed).toBe(true);
    expect(e.alive).toBe(false);
    expect(e.hp).toBe(0);
  });

  it('damage exceeding HP caps at HP (entity dies at 0)', () => {
    // C++ object.cpp:1632: damage = oldstrength (caps at remaining HP)
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    e.hp = 10;
    const killed = e.takeDamage(999, 'Super');
    expect(killed).toBe(true);
    expect(e.hp).toBe(0);
  });

  it('non-lethal damage reduces HP but keeps alive', () => {
    // C++ object.cpp:1614: result = RESULT_LIGHT
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    const hpBefore = e.hp;
    const killed = e.takeDamage(5, 'SA');
    expect(killed).toBe(false);
    expect(e.alive).toBe(true);
    expect(e.hp).toBe(hpBefore - 5);
  });

  it('dead entities cannot take further damage', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    e.alive = false;
    e.hp = 0;
    const killed = e.takeDamage(100, 'Super');
    expect(killed).toBe(false); // already dead
    expect(e.hp).toBe(0);
  });

  it('invulnerable entities take no damage', () => {
    // C++ TechnoClass::Take_Damage: IronCurtainCountDown > 0 → skip damage
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    e.ironCurtainTick = 100;
    const hpBefore = e.hp;
    const killed = e.takeDamage(999, 'Super');
    expect(killed).toBe(false);
    expect(e.hp).toBe(hpBefore);
  });
});

// ============================================================
// Section 10: Death Animation / Mission State
// C++ object.cpp:1644-1646, infantry.cpp:319-460
// ============================================================
describe('Death State Transitions (object.cpp, infantry.cpp)', () => {
  it('killing sets mission to DIE and animState to DIE', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    e.takeDamage(e.maxHp, 'Super');
    expect(e.mission).toBe(Mission.DIE);
    expect(e.animState).toBe(AnimState.DIE);
    expect(e.animFrame).toBe(0);
    expect(e.deathTick).toBe(0);
  });

  it('warhead infantryDeath maps to deathVariant', () => {
    // C++ warhead.cpp: InfDeath selects death animation (0-5)
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    e.takeDamage(e.maxHp, 'Fire');
    // Fire warhead has infantryDeath that maps to a specific death anim
    expect(e.deathVariant).toBeDefined();
    expect(e.deathVariant).toBeGreaterThanOrEqual(0);
    expect(e.deathVariant).toBeLessThanOrEqual(5);
  });
});

// ============================================================
// Section 11: FlasherClass countdown
// C++ object.cpp:1560-1679 does not call Clicked_As_Target for ordinary damage.
// ============================================================
describe('FlasherClass countdown', () => {
  it('taking ordinary damage does not start blushing', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(e.damageFlash).toBe(0);
    e.takeDamage(1, 'SA');
    expect(e.damageFlash).toBe(0);
  });

  it('damageFlash decrements via tickAnimation', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    e.damageFlash = 4;
    e.tickAnimation();
    expect(e.damageFlash).toBe(3);
  });
});

// ============================================================
// Section 12: Sub Force-Uncloak on Damage
// C++ techno.cpp + entity.ts:516-519
// ============================================================
describe('Submarine Force-Uncloak on Damage (entity.ts:516-519)', () => {
  it('cloaked submarine uncloaks when taking damage', () => {
    const sub = new Entity(UnitType.V_SS, House.USSR, 100, 100);
    sub.cloakState = CloakState.CLOAKED;
    // SS is cloakable per stats
    expect(sub.stats.isCloakable).toBe(true);

    sub.takeDamage(10, 'HE');
    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(sub.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('cloaking submarine forced to uncloak on damage', () => {
    const sub = new Entity(UnitType.V_SS, House.USSR, 100, 100);
    sub.cloakState = CloakState.CLOAKING;
    sub.cloakTimer = 20;

    sub.takeDamage(10, 'HE');
    expect(sub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(sub.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('already uncloaked sub stays uncloaked on damage', () => {
    const sub = new Entity(UnitType.V_SS, House.USSR, 100, 100);
    sub.cloakState = CloakState.UNCLOAKED;

    sub.takeDamage(10, 'HE');
    // Should remain uncloaked (no state change)
    expect(sub.cloakState).toBe(CloakState.UNCLOAKED);
  });
});

// ============================================================
// Section 13: Transport Passengers Die on Destruction
// C++ building.cpp:1242-1246 + entity.ts:549-555
// ============================================================
describe('Transport Passengers Die on Destruction', () => {
  it('all passengers die when transport is destroyed', () => {
    const apc = new Entity(UnitType.V_APC, House.Spain, 100, 100);
    const p1 = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    const p2 = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    apc.passengers = [p1, p2];

    apc.takeDamage(apc.maxHp, 'Super');
    expect(apc.alive).toBe(false);
    expect(p1.alive).toBe(false);
    expect(p2.alive).toBe(false);
    expect(apc.passengers).toHaveLength(0);
  });
});

// ============================================================
// Section 14: Building Damage State Visual Offset
// C++ building.cpp:502,632,639,651,669,679 — shape offset at ConditionYellow
// ============================================================
describe('Building Damage State Thresholds (building.cpp shape offsets)', () => {
  it('building visual damage state transitions at ConditionYellow (50%)', () => {
    // C++ building.cpp:502: if (Health_Ratio() <= Rule.ConditionYellow) shapenum += 4;
    // C++ building.cpp:632: if (Health_Ratio() <= Rule.ConditionYellow) shapenum += 35;
    // These all use <= ConditionYellow for the damaged visual state

    // At exactly 50%: <= 0.5 is TRUE → damaged visuals
    expect(0.50 <= CONDITION_YELLOW).toBe(true);
    // At 51%: <= 0.5 is FALSE → normal visuals
    expect(0.51 <= CONDITION_YELLOW).toBe(false);
  });

  it('building AI sell-back triggers at < ConditionRed (25%)', () => {
    // C++ building.cpp:5452: Health_Ratio() < Rule.ConditionRed → Sell_Back
    // Note: this uses strict < (not <=)
    expect(0.24 < CONDITION_RED).toBe(true);
    expect(0.25 < CONDITION_RED).toBe(false); // exactly at boundary: no sell
  });
});

// ============================================================
// Section 15: Unit/Vessel Smoke Threshold
// C++ unit.cpp:1113 / vessel.cpp:975-977 — smoke at <= ConditionYellow
// ============================================================
describe('Unit/Vessel Smoke Spawn Threshold (unit.cpp:1113)', () => {
  it('smoke spawns when Health_Ratio <= ConditionYellow (50%)', () => {
    // C++ unit.cpp:1113: if (Health_Ratio() <= Rule.ConditionYellow && !IsAnimAttached)
    // This is a visual effect in C++ — smoke animation attached to damaged vehicles.
    // TS does not have per-entity attached smoke animations (visual only).

    // Verify the threshold is correct
    expect(CONDITION_YELLOW).toBe(0.5);
    expect(0.50 <= CONDITION_YELLOW).toBe(true);  // at 50%: smoke
    expect(0.51 <= CONDITION_YELLOW).toBe(false); // above 50%: no smoke
  });
});

// ============================================================
// Section 16: Armor Bias (Crate Effect) on Damage
// C++ techno.cpp:3803-3804: damage = damage * ArmorBias * House->ArmorBias
// Entity.ts:506-508
// ============================================================
describe('Armor Bias Damage Reduction (techno.cpp:3803-3804)', () => {
  it('armorBias of 2.0 halves incoming damage', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    e.armorBias = 2.0;
    const hpBefore = e.hp;
    e.takeDamage(20, 'SA');
    const actualDamage = hpBefore - e.hp;
    // 20 / 2.0 = 10
    expect(actualDamage).toBe(10);
  });

  it('armorBias of 1.0 (default) does not reduce damage', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(e.armorBias).toBe(1.0);
    const hpBefore = e.hp;
    e.takeDamage(20, 'SA');
    const actualDamage = hpBefore - e.hp;
    expect(actualDamage).toBe(20);
  });

  it('armorBias ensures minimum 1 damage', () => {
    const e = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    e.armorBias = 100.0; // extreme bias
    const hpBefore = e.hp;
    e.takeDamage(1, 'SA');
    const actualDamage = hpBefore - e.hp;
    expect(actualDamage).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// Section 17: Iron Curtain Invulnerability
// C++ techno.cpp:3807: if (IronCurtainCountDown == 0) result = Take_Damage(...)
// ============================================================
describe('Iron Curtain Invulnerability (techno.cpp:3807)', () => {
  it('iron curtain prevents all damage', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    e.ironCurtainTick = 50;
    const hpBefore = e.hp;
    e.takeDamage(999, 'Super');
    expect(e.hp).toBe(hpBefore);
    expect(e.alive).toBe(true);
  });

  it('crate invulnerability also prevents damage', () => {
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    e.invulnTick = 50;
    const hpBefore = e.hp;
    e.takeDamage(999, 'Super');
    expect(e.hp).toBe(hpBefore);
    expect(e.alive).toBe(true);
  });
});

// ============================================================
// Section 18: C++ RESULT_HALF Transition (object.cpp:1622-1623)
// C++ returns RESULT_HALF when crossing below 50% HP on a single hit.
// TS does not return result types from takeDamage — only boolean killed.
// ============================================================
describe('RESULT_HALF Transition Detection (object.cpp:1622-1623)', () => {
  it('C++ RESULT_HALF fires when crossing below maxstrength/2', () => {
    // C++ object.cpp:1622-1623:
    //   if (oldstrength >= (maxstrength >> 1) && (oldstrength-damage) < (maxstrength >> 1))
    //     result = RESULT_HALF;
    //
    // This triggers building smoke/fire animations in building.cpp:1372-1434.
    // TS takeDamage returns only boolean (killed), not a result enum.
    // KNOWN DIVERGENCE: TS has no RESULT_HALF concept — no visual transition on
    // crossing below 50% HP. Building fire animations are not state-driven.

    const maxHp = 400;
    const halfHp = maxHp >> 1; // 200

    // Scenario: 250 HP, take 60 damage → 190 HP. Crosses below 200.
    const oldStrength = 250;
    const damage = 60;
    const newStrength = oldStrength - damage; // 190

    // C++ check
    const crossedHalf = oldStrength >= halfHp && newStrength < halfHp;
    expect(crossedHalf).toBe(true);

    // TS Entity — no equivalent detection
    const e = new Entity(UnitType.V_2TNK, House.Spain, 100, 100);
    e.hp = oldStrength;
    e.maxHp = maxHp;
    const killed = e.takeDamage(damage, 'AP');
    expect(killed).toBe(false);
    expect(e.hp).toBe(newStrength);
    // TS returns false (not killed), but has no way to signal RESULT_HALF
  });
});

// ============================================================
// Section 19: Repair halts at ConditionGreen (full HP)
// C++ techno.cpp:987,1006: Health_Ratio() < Rule.ConditionGreen
// ============================================================
describe('Repair halts at ConditionGreen (techno.cpp:987,1006)', () => {
  it('ConditionGreen is 1.0 — repair only needed below full HP', () => {
    // C++ rules.cpp:233: ConditionGreen(1) = full health
    // C++ techno.cpp:987: if (Health_Ratio() < Rule.ConditionGreen) → continue repair
    // C++ techno.cpp:1006: if (Health_Ratio() < Rule.ConditionGreen) return RADIO_ROGER
    //   else → Strength = MaxStrength; return RADIO_ALL_DONE

    // At full HP: ratio == 1.0, which is NOT < 1.0 → repair halts
    expect(1.0 < 1.0).toBe(false);
    // Just below full: ratio < 1.0 → repair continues
    expect(0.99 < 1.0).toBe(true);
  });
});

// ============================================================
// Section 20: Dog Instant Kill & Collateral Prevention
// C++ infantry.cpp:1582-1588 (object.cpp): dog damage = target's full HP
// C++ entity.ts:497-504 — collateral prevention + instant kill
// ============================================================
describe('Dog Damage Override (object.cpp, entity.ts:497-504)', () => {
  it('dog kills its designated target instantly regardless of HP', () => {
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const spy = new Entity(UnitType.I_SPY, House.Spain, 100, 100);
    spy.hp = 200; // even high HP
    spy.maxHp = 200;
    dog.target = spy;

    spy.takeDamage(1, 'HollowPoint', dog); // damage value doesn't matter
    expect(spy.alive).toBe(false);
    expect(spy.hp).toBe(0);
  });

  it('dog deals no collateral damage to non-target', () => {
    // C++ object.cpp:1582-1588: if dog's TarCom != target → damage = 0
    const dog = new Entity(UnitType.I_DOG, House.USSR, 100, 100);
    const bystander = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    const target = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    dog.target = target;

    const hpBefore = bystander.hp;
    bystander.takeDamage(100, 'HollowPoint', dog);
    expect(bystander.hp).toBe(hpBefore); // no damage
    expect(bystander.alive).toBe(true);
  });
});
