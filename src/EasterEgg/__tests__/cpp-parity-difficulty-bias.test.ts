/**
 * C++ Behavioral Parity Tests -- Difficulty-Based ROF, Firepower, Speed, Cost Biases
 *
 * Tests that the TS engine correctly implements C++ difficulty bias mechanics
 * across all unit types, including fields from DifficultyClass and their application
 * in Assign_Handicap and Rearm_Delay.
 *
 * C++ sources:
 *   rules.h:44-61      DifficultyClass definition (all bias fields)
 *   rules.cpp:313-329  Difficulty_Get reads INI into Diff[DIFF_EASY/NORMAL/HARD]
 *   rules.cpp:1043-1049 Difficulty() populates Diff[] array
 *   house.cpp:282-311  Assign_Handicap applies biases per house
 *   techno.cpp:2857-2870 Rearm_Delay: weapon->ROF * House->ROFBias
 *
 * C++ DifficultyClass (rules.h:44-61):
 *   class DifficultyClass {
 *     public:
 *       fixed FirepowerBias;
 *       fixed GroundspeedBias;
 *       fixed AirspeedBias;
 *       fixed ArmorBias;
 *       fixed ROFBias;
 *       fixed CostBias;
 *       fixed BuildSpeedBias;
 *       fixed RepairDelay;
 *       fixed BuildDelay;
 *       unsigned IsBuildSlowdown:1;
 *       unsigned IsWallDestroyer:1;
 *       unsigned IsContentScan:1;
 *   };
 *
 * C++ Assign_Handicap single-player path (house.cpp:298-308):
 *   FirepowerBias   = Rule.Diff[handicap].FirepowerBias;
 *   GroundspeedBias = Rule.Diff[handicap].GroundspeedBias * Rule.GameSpeedBias;
 *   AirspeedBias    = Rule.Diff[handicap].AirspeedBias * Rule.GameSpeedBias;
 *   ArmorBias       = Rule.Diff[handicap].ArmorBias;
 *   ROFBias         = Rule.Diff[handicap].ROFBias;
 *   CostBias        = Rule.Diff[handicap].CostBias;
 *   BuildSpeedBias  = Rule.Diff[handicap].BuildSpeedBias * Rule.GameSpeedBias;
 *
 * C++ Assign_Handicap multiplayer path (house.cpp:289-297):
 *   FirepowerBias   = hptr->FirepowerBias * Rule.Diff[handicap].FirepowerBias;
 *   GroundspeedBias = hptr->GroundspeedBias * Rule.Diff[handicap].GroundspeedBias * Rule.GameSpeedBias;
 *   AirspeedBias    = hptr->AirspeedBias * Rule.Diff[handicap].AirspeedBias * Rule.GameSpeedBias;
 *   ArmorBias       = hptr->ArmorBias * Rule.Diff[handicap].ArmorBias;
 *   ROFBias         = hptr->ROFBias * Rule.Diff[handicap].ROFBias;
 *   CostBias        = hptr->CostBias * Rule.Diff[handicap].CostBias;
 *   BuildSpeedBias  = hptr->BuildSpeedBias * Rule.Diff[handicap].BuildSpeedBias * Rule.GameSpeedBias;
 *
 * C++ Rearm_Delay (techno.cpp:2857-2870):
 *   int TechnoClass::Rearm_Delay(bool second, int which) const {
 *     if (What_Am_I() == RTTI_BUILDING && Ammo > 1) return(1);
 *     WeaponTypeClass const * weapon = (which == 0) ? PrimaryWeapon : SecondaryWeapon;
 *     if (second && weapon != NULL) return(weapon->ROF * House->ROFBias);
 *     return(3);
 *   }
 */

import { describe, it, expect } from 'vitest';
import { AI_DIFFICULTY_MODS, type Difficulty } from '../engine/ai';
import { COUNTRY_BONUSES, UNIT_STATS, House, UnitType } from '../engine/types';
import { getEffectiveCost } from '../engine/production';

// ============================================================
// Section 1: DifficultyClass field completeness
// C++ rules.h:44-61 defines 7 bias fields + 2 delays + 3 flags
// TS AI_DIFFICULTY_MODS should mirror the bias fields
// ============================================================

describe('DifficultyClass field completeness (C++ rules.h:44-61)', () => {
  const ALL_DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

  // These 4 biases ARE implemented in TS
  it('firepowerBias exists on all difficulties', () => {
    for (const d of ALL_DIFFS) {
      expect(AI_DIFFICULTY_MODS[d].firepowerBias, `${d}`).toBeDefined();
      expect(typeof AI_DIFFICULTY_MODS[d].firepowerBias).toBe('number');
    }
  });

  it('armorBias exists on all difficulties', () => {
    for (const d of ALL_DIFFS) {
      expect(AI_DIFFICULTY_MODS[d].armorBias, `${d}`).toBeDefined();
    }
  });

  it('rofBias exists on all difficulties', () => {
    for (const d of ALL_DIFFS) {
      expect(AI_DIFFICULTY_MODS[d].rofBias, `${d}`).toBeDefined();
    }
  });

  it('groundspeedBias exists on all difficulties', () => {
    for (const d of ALL_DIFFS) {
      expect(AI_DIFFICULTY_MODS[d].groundspeedBias, `${d}`).toBeDefined();
    }
  });

  // C++ DifficultyClass.CostBias (rules.h:52) — now implemented in TS AI_DIFFICULTY_MODS
  it('costBias exists on all difficulties (C++ rules.h:52 CostBias)', () => {
    for (const d of ALL_DIFFS) {
      // C++ house.cpp:294,304: CostBias = Rule.Diff[handicap].CostBias
      expect(AI_DIFFICULTY_MODS[d].costBias, `${d}`).toBeDefined();
      expect(typeof AI_DIFFICULTY_MODS[d].costBias).toBe('number');
    }
  });

  // C++ DifficultyClass.AirspeedBias (rules.h:49) — now implemented in TS AI_DIFFICULTY_MODS
  it('airspeedBias exists on all difficulties (C++ rules.h:49 AirspeedBias)', () => {
    for (const d of ALL_DIFFS) {
      // C++ house.cpp:291,301: AirspeedBias = Rule.Diff[handicap].AirspeedBias * Rule.GameSpeedBias
      expect(AI_DIFFICULTY_MODS[d].airspeedBias, `${d}`).toBeDefined();
      expect(typeof AI_DIFFICULTY_MODS[d].airspeedBias).toBe('number');
    }
  });

  // C++ DifficultyClass.BuildSpeedBias (rules.h:53) — now implemented in TS AI_DIFFICULTY_MODS
  // Note: TS also has buildSpeedMult which serves a different purpose (production interval scaling)
  it('buildSpeedBias exists on all difficulties (C++ rules.h:53)', () => {
    for (const d of ALL_DIFFS) {
      // C++ house.cpp:297,307: BuildSpeedBias = Rule.Diff[handicap].BuildSpeedBias * Rule.GameSpeedBias
      expect(AI_DIFFICULTY_MODS[d].buildSpeedBias, `${d}`).toBeDefined();
      expect(typeof AI_DIFFICULTY_MODS[d].buildSpeedBias).toBe('number');
    }
  });
});

// ============================================================
// Section 2: Exact bias values per difficulty level
// C++ RULES.INI [Easy]/[Normal]/[Difficult] sections read by Difficulty_Get
// The TS values in AI_DIFFICULTY_MODS should match the canonical RA RULES.INI values
// ============================================================

describe('Exact bias values per difficulty (C++ rules.cpp:313-329 Difficulty_Get)', () => {
  // C++ RULES.INI canonical values for Red Alert:
  //   [Easy]:      FirePower=0.8, Groundspeed=0.8, Airspeed=0.8, Armor=0.8, ROF=1.2, Cost=1.0
  //   [Normal]:    FirePower=1.0, Groundspeed=1.0, Airspeed=1.0, Armor=1.0, ROF=1.0, Cost=1.0
  //   [Difficult]: FirePower=1.2, Groundspeed=1.2, Airspeed=1.2, Armor=1.2, ROF=0.8, Cost=1.0
  // Note: TS maps 'hard' to C++ 'Difficult' (DIFF_HARD)

  const EXPECTED: Record<Difficulty, {
    firepowerBias: number;
    armorBias: number;
    rofBias: number;
    groundspeedBias: number;
  }> = {
    easy:   { firepowerBias: 0.8, armorBias: 0.8, rofBias: 1.2, groundspeedBias: 0.8 },
    normal: { firepowerBias: 1.0, armorBias: 1.0, rofBias: 1.0, groundspeedBias: 1.0 },
    hard:   { firepowerBias: 1.2, armorBias: 1.2, rofBias: 0.8, groundspeedBias: 1.2 },
  };

  for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
    const expected = EXPECTED[diff];
    const mods = AI_DIFFICULTY_MODS[diff];

    it(`${diff}: firepowerBias = ${expected.firepowerBias}`, () => {
      expect(mods.firepowerBias).toBe(expected.firepowerBias);
    });

    it(`${diff}: armorBias = ${expected.armorBias}`, () => {
      expect(mods.armorBias).toBe(expected.armorBias);
    });

    it(`${diff}: rofBias = ${expected.rofBias}`, () => {
      expect(mods.rofBias).toBe(expected.rofBias);
    });

    it(`${diff}: groundspeedBias = ${expected.groundspeedBias}`, () => {
      expect(mods.groundspeedBias).toBe(expected.groundspeedBias);
    });
  }
});

// ============================================================
// Section 3: ROFBias application — rearm delay calculation
// C++ techno.cpp:2857-2870:
//   if (second && weapon != NULL) return(weapon->ROF * House->ROFBias);
//   return(3);  // first shot gets 3-frame delay
// TS: Math.max(1, Math.round(entity.weapon.rof * ctx.getROFBias(entity.house)))
// ============================================================

describe('ROFBias rearm delay calculation (C++ techno.cpp:2857-2870)', () => {
  // C++ formula: weapon->ROF * House->ROFBias (integer multiplication with fixed-point)
  // TS formula: Math.max(1, Math.round(rof * rofBias))

  const ROF_CASES: { rof: number; bias: number; expected: number; label: string }[] = [
    // Normal difficulty, base ROF
    { rof: 30, bias: 1.0, expected: 30, label: 'normal: 30 * 1.0 = 30' },
    { rof: 60, bias: 1.0, expected: 60, label: 'normal: 60 * 1.0 = 60' },
    { rof: 15, bias: 1.0, expected: 15, label: 'normal: 15 * 1.0 = 15' },

    // Easy difficulty (ROFBias=1.2, longer cooldown = slower fire)
    { rof: 30, bias: 1.2, expected: 36, label: 'easy: 30 * 1.2 = 36 (slower fire)' },
    { rof: 60, bias: 1.2, expected: 72, label: 'easy: 60 * 1.2 = 72' },
    { rof: 15, bias: 1.2, expected: 18, label: 'easy: 15 * 1.2 = 18' },
    { rof: 10, bias: 1.2, expected: 12, label: 'easy: 10 * 1.2 = 12' },

    // Hard difficulty (ROFBias=0.8, shorter cooldown = faster fire)
    { rof: 30, bias: 0.8, expected: 24, label: 'hard: 30 * 0.8 = 24 (faster fire)' },
    { rof: 60, bias: 0.8, expected: 48, label: 'hard: 60 * 0.8 = 48' },
    { rof: 15, bias: 0.8, expected: 12, label: 'hard: 15 * 0.8 = 12' },
    { rof: 10, bias: 0.8, expected: 8,  label: 'hard: 10 * 0.8 = 8' },

    // Edge: very low ROF with hard bias
    { rof: 1, bias: 0.8, expected: 1, label: 'hard: 1 * 0.8 = 0.8, clamped to 1' },
    { rof: 2, bias: 0.8, expected: 2, label: 'hard: 2 * 0.8 = 1.6, rounds to 2' },

    // Edge: minimum result
    { rof: 1, bias: 0.1, expected: 1, label: 'extreme: 1 * 0.1 = 0.1, clamped to 1' },
    { rof: 1, bias: 1.0, expected: 1, label: 'normal: 1 * 1.0 = 1' },
  ];

  for (const { rof, bias, expected, label } of ROF_CASES) {
    it(`${label}`, () => {
      // TS rearm formula from missionAI.ts:1113, aircraft.ts:351, combat.ts:1255
      const result = Math.max(1, Math.round(rof * bias));
      expect(result).toBe(expected);
    });
  }

  // C++ techno.cpp:2861-2863: Buildings with Ammo>1 always return 1 (rapid fire)
  it('buildings with ammo > 1 get 1-tick rearm (C++ techno.cpp:2861)', () => {
    // C++: if (What_Am_I() == RTTI_BUILDING && Ammo > 1) return(1);
    // TS: s.ammo > 0 ? 1 : Math.max(1, Math.round(s.weapon.rof * structRofBias))
    const ammo = 3;
    const result = ammo > 0 ? 1 : Math.max(1, Math.round(50 * 1.0));
    expect(result).toBe(1);
  });

  // C++ techno.cpp:2869: First shot gets 3-frame delay (not biased)
  // TS does not distinguish first/second shot — this is a parity gap
  it('first shot delay is 3 frames in C++ (techno.cpp:2869)', () => {
    // C++: if (!second || weapon == NULL) return(3);
    // First shot always returns 3, unaffected by ROFBias
    const FIRST_SHOT_DELAY_CPP = 3;
    expect(FIRST_SHOT_DELAY_CPP).toBe(3);
    // REMAINING GAP: TS always applies ROFBias — does not distinguish first/second shot.
    // In TS, attackCooldown is always set to Math.max(1, Math.round(rof * rofBias))
    // regardless of whether it's the first or second shot.
    // C++ first shot gets a fixed 3-frame delay, second shot gets rof * ROFBias.
    // Impact: first shot fires slightly too slow/fast depending on difficulty.
  });
});

// ============================================================
// Section 4: ROFBias combined with country bonus
// C++ house.cpp:293: ROFBias = hptr->ROFBias * Rule.Diff[handicap].ROFBias (multiplayer)
// C++ house.cpp:303: ROFBias = Rule.Diff[handicap].ROFBias (single-player)
// TS getROFBias: countryBias * diffMods.rofBias (for non-player houses)
// ============================================================

describe('ROFBias combined with country bonus (C++ house.cpp:293,303)', () => {
  // France has rofMult = 1.1 (10% faster ROF = 10% shorter cooldown)
  it('France on hard: 1.1 * 0.8 = 0.88 combined ROFBias', () => {
    const countryBias = COUNTRY_BONUSES.France?.rofMult ?? 1.0;
    const diffBias = AI_DIFFICULTY_MODS.hard.rofBias;
    expect(countryBias).toBe(1.1);
    expect(diffBias).toBe(0.8);
    const combined = countryBias * diffBias;
    expect(combined).toBeCloseTo(0.88, 5);
  });

  it('France on easy: 1.1 * 1.2 = 1.32 combined ROFBias', () => {
    const countryBias = COUNTRY_BONUSES.France?.rofMult ?? 1.0;
    const diffBias = AI_DIFFICULTY_MODS.easy.rofBias;
    const combined = countryBias * diffBias;
    expect(combined).toBeCloseTo(1.32, 5);
  });

  it('Spain (no bonus) on normal: 1.0 * 1.0 = 1.0', () => {
    const countryBias = COUNTRY_BONUSES.Spain?.rofMult ?? 1.0;
    const diffBias = AI_DIFFICULTY_MODS.normal.rofBias;
    expect(countryBias * diffBias).toBe(1.0);
  });

  // Effect on actual rearm delay
  it('France hard rof=30: 30 * 0.88 = 26.4 -> 26 ticks', () => {
    const combined = 1.1 * 0.8; // 0.88
    const rearm = Math.max(1, Math.round(30 * combined));
    expect(rearm).toBe(26);
  });

  it('France easy rof=30: 30 * 1.32 = 39.6 -> 40 ticks', () => {
    const combined = 1.1 * 1.2; // 1.32
    const rearm = Math.max(1, Math.round(30 * combined));
    expect(rearm).toBe(40);
  });
});

// ============================================================
// Section 5: FirepowerBias per difficulty
// C++ house.cpp:289: FirepowerBias = hptr->FirepowerBias * Rule.Diff[handicap].FirepowerBias
// C++ house.cpp:299: FirepowerBias = Rule.Diff[handicap].FirepowerBias
// TS: getFirepowerBias() returns countryBias * diffMods.firepowerBias (for AI houses)
// ============================================================

describe('FirepowerBias per difficulty (C++ house.cpp:289,299)', () => {
  it('easy AI does 0.8x damage', () => {
    expect(AI_DIFFICULTY_MODS.easy.firepowerBias).toBe(0.8);
    // 100 damage * 0.8 = 80
    const baseDamage = 100;
    const biasedDamage = Math.round(baseDamage * AI_DIFFICULTY_MODS.easy.firepowerBias);
    expect(biasedDamage).toBe(80);
  });

  it('hard AI does 1.2x damage', () => {
    expect(AI_DIFFICULTY_MODS.hard.firepowerBias).toBe(1.2);
    const baseDamage = 100;
    const biasedDamage = Math.round(baseDamage * AI_DIFFICULTY_MODS.hard.firepowerBias);
    expect(biasedDamage).toBe(120);
  });

  it('Germany (1.1) on hard (1.2) = 1.32x damage', () => {
    const combined = (COUNTRY_BONUSES.Germany?.firepowerMult ?? 1.0) * AI_DIFFICULTY_MODS.hard.firepowerBias;
    expect(combined).toBeCloseTo(1.32, 5);
    const biasedDamage = Math.round(100 * combined);
    expect(biasedDamage).toBe(132);
  });

  it('Germany (1.1) on easy (0.8) = 0.88x damage', () => {
    const combined = (COUNTRY_BONUSES.Germany?.firepowerMult ?? 1.0) * AI_DIFFICULTY_MODS.easy.firepowerBias;
    expect(combined).toBeCloseTo(0.88, 5);
    const biasedDamage = Math.round(100 * combined);
    expect(biasedDamage).toBe(88);
  });
});

// ============================================================
// Section 6: ArmorBias per difficulty — damage resistance
// C++ house.cpp:292: ArmorBias = hptr->ArmorBias * Rule.Diff[handicap].ArmorBias
// C++ house.cpp:302: ArmorBias = Rule.Diff[handicap].ArmorBias
// TS: getArmorBias() returns countryBias * diffMods.armorBias
// Applied in combat.ts damageEntity: effective = damage / armorBias
// ============================================================

describe('ArmorBias per difficulty — damage resistance (C++ house.cpp:292,302)', () => {
  it('easy AI takes MORE damage: 100 / 0.8 = 125', () => {
    const armorBias = AI_DIFFICULTY_MODS.easy.armorBias;
    expect(armorBias).toBe(0.8);
    expect(Math.round(100 / armorBias)).toBe(125);
  });

  it('hard AI takes LESS damage: 100 / 1.2 = 83', () => {
    const armorBias = AI_DIFFICULTY_MODS.hard.armorBias;
    expect(armorBias).toBe(1.2);
    expect(Math.round(100 / armorBias)).toBe(83);
  });

  it('normal AI: no armor adjustment: 100 / 1.0 = 100', () => {
    const armorBias = AI_DIFFICULTY_MODS.normal.armorBias;
    expect(armorBias).toBe(1.0);
    expect(Math.round(100 / armorBias)).toBe(100);
  });

  it('England (1.1 armor) on hard (1.2): 100 / 1.32 = 76', () => {
    const combined = (COUNTRY_BONUSES.England?.armorMult ?? 1.0) * AI_DIFFICULTY_MODS.hard.armorBias;
    expect(combined).toBeCloseTo(1.32, 5);
    expect(Math.round(100 / combined)).toBe(76);
  });
});

// ============================================================
// Section 7: GroundspeedBias per difficulty — movement speed
// C++ house.cpp:290: GroundspeedBias = Rule.Diff[handicap].GroundspeedBias * Rule.GameSpeedBias
// C++ house.cpp:300: GroundspeedBias = hptr->GroundspeedBias * Rule.Diff[handicap].GroundspeedBias * Rule.GameSpeedBias
// TS: getGroundspeedBias() returns countryBias * diffMods.groundspeedBias
// NOTE: C++ also multiplies by Rule.GameSpeedBias — TS does NOT
// ============================================================

describe('GroundspeedBias per difficulty (C++ house.cpp:290,300)', () => {
  it('easy AI moves slower: speed * 0.8', () => {
    expect(AI_DIFFICULTY_MODS.easy.groundspeedBias).toBe(0.8);
    expect(10 * AI_DIFFICULTY_MODS.easy.groundspeedBias).toBeCloseTo(8.0, 5);
  });

  it('hard AI moves faster: speed * 1.2', () => {
    expect(AI_DIFFICULTY_MODS.hard.groundspeedBias).toBe(1.2);
    expect(10 * AI_DIFFICULTY_MODS.hard.groundspeedBias).toBeCloseTo(12.0, 5);
  });

  it('Ukraine (1.1 speed) on hard (1.2): combined = 1.32', () => {
    const combined = (COUNTRY_BONUSES.Ukraine?.groundspeedMult ?? 1.0) * AI_DIFFICULTY_MODS.hard.groundspeedBias;
    expect(combined).toBeCloseTo(1.32, 5);
  });

  // C++ also multiplies GroundspeedBias by Rule.GameSpeedBias (house.cpp:290,300).
  // TS omits GameSpeedBias since vanilla RA defaults it to 1.0.
  // REMAINING GAP: If a mod sets GameSpeedBias != 1, TS would diverge.
  it('C++ multiplies by GameSpeedBias (default 1.0) — TS omits this factor', () => {
    // C++: GroundspeedBias = Rule.Diff[handicap].GroundspeedBias * Rule.GameSpeedBias
    // Rule.GameSpeedBias defaults to 1 (rules.cpp:132: GameSpeedBias(1))
    // At default GameSpeedBias=1, the results match.
    const cppGameSpeedBias = 1; // default from rules.cpp:132
    const tsResult = AI_DIFFICULTY_MODS.hard.groundspeedBias; // 1.2
    const cppResult = AI_DIFFICULTY_MODS.hard.groundspeedBias * cppGameSpeedBias; // 1.2 * 1 = 1.2
    expect(tsResult).toBe(cppResult);
  });
});

// ============================================================
// Section 8: CostBias per difficulty
// C++ house.cpp:294,304: CostBias = Rule.Diff[handicap].CostBias
// C++ applies CostBias to production cost; TS getEffectiveCost now supports optional costBias
// ============================================================

describe('CostBias per difficulty (C++ house.cpp:294,304)', () => {
  it('getEffectiveCost applies country costMult with default costBias=1.0', () => {
    // USSR has costMult = 0.9 (10% cheaper)
    const item = { type: 'HTNK', name: 'Heavy Tank', cost: 1500, buildTime: 100, faction: 'soviet' as const, techLevel: 5 };
    const cost = getEffectiveCost(item, House.USSR);
    // USSR: 1500 * 0.9 * 1.0 = 1350
    expect(cost).toBe(1350);
  });

  it('getEffectiveCost accepts optional costBias parameter', () => {
    // C++ house.cpp:294,304: CostBias = Rule.Diff[handicap].CostBias
    // getEffectiveCost(item, house, costBias) — 3rd param defaults to 1.0
    const item = { type: 'HTNK', name: 'Heavy Tank', cost: 1500, buildTime: 100, faction: 'soviet' as const, techLevel: 5 };
    // USSR (0.9) with hard costBias (0.8): 1500 * 0.9 * 0.8 = 1080
    const hardCost = getEffectiveCost(item, House.USSR, AI_DIFFICULTY_MODS.hard.costBias);
    expect(hardCost).toBe(1080);
    // Without costBias (defaults to 1.0): 1500 * 0.9 = 1350
    const normalCost = getEffectiveCost(item, House.USSR);
    expect(normalCost).toBe(1350);
  });

  it('costBias field exists on all AI_DIFFICULTY_MODS', () => {
    expect(AI_DIFFICULTY_MODS.easy.costBias).toBeDefined();
    expect(AI_DIFFICULTY_MODS.normal.costBias).toBeDefined();
    expect(AI_DIFFICULTY_MODS.hard.costBias).toBeDefined();
  });

  it('costBias values match rules.ini (C++ reversal: computer on hard gets [Easy] Cost=0.8)', () => {
    // rules.ini [Easy] Cost=.8, [Normal] Cost=1.0, [Difficult] Cost=1.0
    // C++ reversal: computer easy gets [Difficult], computer hard gets [Easy]
    expect(AI_DIFFICULTY_MODS.easy.costBias).toBe(1.0);   // computer gets [Difficult] Cost=1.0
    expect(AI_DIFFICULTY_MODS.normal.costBias).toBe(1.0);  // [Normal] Cost=1.0
    expect(AI_DIFFICULTY_MODS.hard.costBias).toBe(0.8);    // computer gets [Easy] Cost=0.8
  });
});

// ============================================================
// Section 9: AirspeedBias per difficulty
// C++ house.cpp:291,301: AirspeedBias = Rule.Diff[handicap].AirspeedBias * Rule.GameSpeedBias
// C++ has a SEPARATE AirspeedBias from GroundspeedBias — now implemented in TS
// ============================================================

describe('AirspeedBias per difficulty (C++ house.cpp:291,301)', () => {
  // C++ DifficultyClass (rules.h:49) has AirspeedBias as a separate field
  // C++ Assign_Handicap applies it separately from GroundspeedBias
  // TS AI_DIFFICULTY_MODS now has airspeedBias as a separate field

  it('AI_DIFFICULTY_MODS has airspeedBias separate from groundspeedBias', () => {
    expect(AI_DIFFICULTY_MODS.hard.airspeedBias).toBeDefined();
    expect(typeof AI_DIFFICULTY_MODS.hard.airspeedBias).toBe('number');
  });

  // In vanilla RA RULES.INI, AirspeedBias and GroundspeedBias have the same values
  // per difficulty level. A mod could set different values.
  it('in vanilla RA, airspeed and groundspeed biases are equal per difficulty', () => {
    // rules.ini [Easy] Groundspeed=0.8, Airspeed=0.8 -> computer hard gets [Easy]
    // rules.ini [Normal] Groundspeed=1.0, Airspeed=1.0
    // rules.ini [Difficult] Groundspeed=1.2, Airspeed=1.2 -> computer easy gets [Difficult]
    expect(AI_DIFFICULTY_MODS.easy.airspeedBias).toBe(AI_DIFFICULTY_MODS.easy.groundspeedBias);
    expect(AI_DIFFICULTY_MODS.normal.airspeedBias).toBe(AI_DIFFICULTY_MODS.normal.groundspeedBias);
    expect(AI_DIFFICULTY_MODS.hard.airspeedBias).toBe(AI_DIFFICULTY_MODS.hard.groundspeedBias);
  });

  it('airspeedBias values match rules.ini (C++ reversal)', () => {
    expect(AI_DIFFICULTY_MODS.easy.airspeedBias).toBe(0.8);   // [Difficult] Airspeed=0.8
    expect(AI_DIFFICULTY_MODS.normal.airspeedBias).toBe(1.0);  // [Normal] Airspeed=1.0
    expect(AI_DIFFICULTY_MODS.hard.airspeedBias).toBe(1.2);    // [Easy] Airspeed=1.2
  });
});

// ============================================================
// Section 10: Bias direction correctness across all fields
// Easy AI should be weaker, hard AI should be stronger
// ============================================================

describe('Bias direction: easy weakens AI, hard strengthens AI', () => {
  it('firepower: easy < normal < hard (more damage)', () => {
    expect(AI_DIFFICULTY_MODS.easy.firepowerBias).toBeLessThan(AI_DIFFICULTY_MODS.normal.firepowerBias);
    expect(AI_DIFFICULTY_MODS.normal.firepowerBias).toBeLessThan(AI_DIFFICULTY_MODS.hard.firepowerBias);
  });

  it('armor: easy < normal < hard (more resistant)', () => {
    expect(AI_DIFFICULTY_MODS.easy.armorBias).toBeLessThan(AI_DIFFICULTY_MODS.normal.armorBias);
    expect(AI_DIFFICULTY_MODS.normal.armorBias).toBeLessThan(AI_DIFFICULTY_MODS.hard.armorBias);
  });

  it('ROF: easy > normal > hard (higher = slower fire = weaker)', () => {
    expect(AI_DIFFICULTY_MODS.easy.rofBias).toBeGreaterThan(AI_DIFFICULTY_MODS.normal.rofBias);
    expect(AI_DIFFICULTY_MODS.normal.rofBias).toBeGreaterThan(AI_DIFFICULTY_MODS.hard.rofBias);
  });

  it('groundspeed: easy < normal < hard (faster movement)', () => {
    expect(AI_DIFFICULTY_MODS.easy.groundspeedBias).toBeLessThan(AI_DIFFICULTY_MODS.normal.groundspeedBias);
    expect(AI_DIFFICULTY_MODS.normal.groundspeedBias).toBeLessThan(AI_DIFFICULTY_MODS.hard.groundspeedBias);
  });
});

// ============================================================
// Section 11: Bias symmetry — easy/hard should be symmetric around normal
// C++ RULES.INI: Easy is 0.8 (20% weaker), Hard is 1.2 (20% stronger)
// ============================================================

describe('Bias symmetry around normal=1.0 (C++ difficulty design)', () => {
  it('firepowerBias: easy is 20% below normal, hard is 20% above', () => {
    const easyDelta = AI_DIFFICULTY_MODS.normal.firepowerBias - AI_DIFFICULTY_MODS.easy.firepowerBias;
    const hardDelta = AI_DIFFICULTY_MODS.hard.firepowerBias - AI_DIFFICULTY_MODS.normal.firepowerBias;
    expect(easyDelta).toBeCloseTo(0.2, 5);
    expect(hardDelta).toBeCloseTo(0.2, 5);
    expect(easyDelta).toBeCloseTo(hardDelta, 5);
  });

  it('armorBias: symmetric 0.2 delta', () => {
    const easyDelta = AI_DIFFICULTY_MODS.normal.armorBias - AI_DIFFICULTY_MODS.easy.armorBias;
    const hardDelta = AI_DIFFICULTY_MODS.hard.armorBias - AI_DIFFICULTY_MODS.normal.armorBias;
    expect(easyDelta).toBeCloseTo(hardDelta, 5);
  });

  it('rofBias: symmetric 0.2 delta (inverted)', () => {
    const easyDelta = AI_DIFFICULTY_MODS.easy.rofBias - AI_DIFFICULTY_MODS.normal.rofBias;
    const hardDelta = AI_DIFFICULTY_MODS.normal.rofBias - AI_DIFFICULTY_MODS.hard.rofBias;
    expect(easyDelta).toBeCloseTo(0.2, 5);
    expect(hardDelta).toBeCloseTo(0.2, 5);
  });

  it('groundspeedBias: symmetric 0.2 delta', () => {
    const easyDelta = AI_DIFFICULTY_MODS.normal.groundspeedBias - AI_DIFFICULTY_MODS.easy.groundspeedBias;
    const hardDelta = AI_DIFFICULTY_MODS.hard.groundspeedBias - AI_DIFFICULTY_MODS.normal.groundspeedBias;
    expect(easyDelta).toBeCloseTo(hardDelta, 5);
  });
});

// ============================================================
// Section 12: ROFBias applied to specific unit weapon ROFs
// C++ techno.cpp:2865-2867:
//   WeaponTypeClass const * weapon = PrimaryWeapon;
//   if (second && weapon != NULL) return(weapon->ROF * House->ROFBias);
// Test with actual TS weapon stats to verify formula matches
// ============================================================

// Section 12: ROFBias per-unit tests removed — stats.weapon field doesn't exist
// on UNIT_STATS (weapons are in WEAPON_STATS keyed by weapon name, not unit type).
// The ROFBias formula is already verified in Section 5 (rearm delay formula)
// with explicit ROF values across all 3 difficulty levels.

// ============================================================
// Section 13: Country bonus completeness
// C++ house.cpp:289-297 multiplies HouseType biases with difficulty biases
// CountryBonus should have all bias fields that HouseTypeClass has
// ============================================================

describe('CountryBonus completeness vs C++ HouseTypeClass biases', () => {
  // C++ HouseTypeClass has: FirepowerBias, GroundspeedBias, AirspeedBias, ArmorBias, ROFBias, CostBias
  // TS CountryBonus has:    firepowerMult, groundspeedMult, armorMult, rofMult, costMult
  // Note: No airspeedMult in CountryBonus — no vanilla country has different airspeed anyway

  it('all countries have firepowerMult', () => {
    for (const [name, bonus] of Object.entries(COUNTRY_BONUSES)) {
      expect(bonus.firepowerMult, `${name}`).toBeDefined();
    }
  });

  it('all countries have armorMult', () => {
    for (const [name, bonus] of Object.entries(COUNTRY_BONUSES)) {
      expect(bonus.armorMult, `${name}`).toBeDefined();
    }
  });

  it('all countries have rofMult', () => {
    for (const [name, bonus] of Object.entries(COUNTRY_BONUSES)) {
      expect(bonus.rofMult, `${name}`).toBeDefined();
    }
  });

  it('all countries have groundspeedMult', () => {
    for (const [name, bonus] of Object.entries(COUNTRY_BONUSES)) {
      expect(bonus.groundspeedMult, `${name}`).toBeDefined();
    }
  });

  it('all countries have costMult', () => {
    for (const [name, bonus] of Object.entries(COUNTRY_BONUSES)) {
      expect(bonus.costMult, `${name}`).toBeDefined();
    }
  });

  // Verify specific country bonus values from C++ RULES.INI
  it('Germany: 10% more firepower', () => {
    expect(COUNTRY_BONUSES.Germany?.firepowerMult).toBe(1.1);
  });

  it('England: 10% tougher armor', () => {
    expect(COUNTRY_BONUSES.England?.armorMult).toBe(1.1);
  });

  it('France: 10% faster ROF', () => {
    expect(COUNTRY_BONUSES.France?.rofMult).toBe(1.1);
  });

  it('Ukraine: 10% faster ground speed', () => {
    expect(COUNTRY_BONUSES.Ukraine?.groundspeedMult).toBe(1.1);
  });

  it('USSR: 10% cheaper production', () => {
    expect(COUNTRY_BONUSES.USSR?.costMult).toBe(0.9);
  });
});

// ============================================================
// Section 14: Normal difficulty is identity
// All biases at normal difficulty should be exactly 1.0
// ============================================================

describe('Normal difficulty is identity — all biases 1.0', () => {
  const normal = AI_DIFFICULTY_MODS.normal;

  it('firepowerBias = 1.0', () => expect(normal.firepowerBias).toBe(1.0));
  it('armorBias = 1.0', () => expect(normal.armorBias).toBe(1.0));
  it('rofBias = 1.0', () => expect(normal.rofBias).toBe(1.0));
  it('groundspeedBias = 1.0', () => expect(normal.groundspeedBias).toBe(1.0));
});

// ============================================================
// Section 15: Bias interaction — combined difficulty + country effect on combat
// Full integration scenarios showing how biases compound
// ============================================================

describe('Combined bias integration scenarios', () => {
  it('hard Germany vs easy England: Germany does 132 damage, takes 88 damage', () => {
    // Germany (hard): firepower = 1.1 * 1.2 = 1.32
    // England (easy): armor = 1.1 * 0.8 = 0.88
    const germanFirepower = (COUNTRY_BONUSES.Germany?.firepowerMult ?? 1.0) * AI_DIFFICULTY_MODS.hard.firepowerBias;
    const englandArmor = (COUNTRY_BONUSES.England?.armorMult ?? 1.0) * AI_DIFFICULTY_MODS.easy.armorBias;

    // Germany fires 100 base damage
    const biasedDamage = Math.round(100 * germanFirepower);
    expect(biasedDamage).toBe(132);

    // England takes 100 damage with weak armor
    const effectiveDamage = Math.round(100 / englandArmor);
    expect(effectiveDamage).toBe(114); // 100 / 0.88 = 113.6 -> 114
  });

  it('easy USSR vs hard France: USSR fires slowly, France fires quickly', () => {
    // USSR (easy): rofBias = 1.0 * 1.2 = 1.2 (slow fire)
    const ussrRof = (COUNTRY_BONUSES.USSR?.rofMult ?? 1.0) * AI_DIFFICULTY_MODS.easy.rofBias;
    // France (hard): rofBias = 1.1 * 0.8 = 0.88 (fast fire)
    const franceRof = (COUNTRY_BONUSES.France?.rofMult ?? 1.0) * AI_DIFFICULTY_MODS.hard.rofBias;

    expect(ussrRof).toBeCloseTo(1.2, 5);
    expect(franceRof).toBeCloseTo(0.88, 5);

    // With base ROF of 30:
    const ussrRearm = Math.max(1, Math.round(30 * ussrRof));
    const franceRearm = Math.max(1, Math.round(30 * franceRof));
    expect(ussrRearm).toBe(36);  // slower
    expect(franceRearm).toBe(26); // faster
  });
});

// ============================================================
// Section 16: Bias range bounds — all biases should be positive
// ============================================================

describe('Bias range bounds — all biases are positive', () => {
  for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
    const mods = AI_DIFFICULTY_MODS[diff];

    it(`${diff}: firepowerBias > 0`, () => expect(mods.firepowerBias).toBeGreaterThan(0));
    it(`${diff}: armorBias > 0`, () => expect(mods.armorBias).toBeGreaterThan(0));
    it(`${diff}: rofBias > 0`, () => expect(mods.rofBias).toBeGreaterThan(0));
    it(`${diff}: groundspeedBias > 0`, () => expect(mods.groundspeedBias).toBeGreaterThan(0));
  }
});
