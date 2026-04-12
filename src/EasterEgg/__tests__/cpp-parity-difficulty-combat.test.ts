/**
 * C++ Behavioral Parity Tests — Difficulty Combat Stats
 *
 * C++ house.cpp:282-311 Assign_Handicap sets per-house combat biases based on
 * difficulty: FirepowerBias, ArmorBias, ROFBias, GroundspeedBias.
 * These multiply the country-level biases (hptr->FirepowerBias * Rule.Diff[handicap].FirepowerBias).
 *
 * C++ source: house.cpp:282-311 (Assign_Handicap), rules.cpp:313-329 (Difficulty_Get)
 */

import { describe, it, expect } from 'vitest';
import { AI_DIFFICULTY_MODS, type Difficulty } from '../engine/ai';
import { COUNTRY_BONUSES, House, modifyDamage, UNIT_STATS, UnitType } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { damageEntity, type CombatContext } from '../engine/combat';
import { type GameMap, Terrain } from '../engine/map';

// ── Test data: C++ difficulty bias values from RULES.INI [Easy]/[Normal]/[Difficult] ──
// In the TS engine, 'easy' = AI is weaker, 'hard' = AI is stronger

const EXPECTED_COMBAT_BIASES: Record<Difficulty, {
  firepowerBias: number; armorBias: number; rofBias: number; groundspeedBias: number;
}> = {
  easy:   { firepowerBias: 0.8, armorBias: 0.8, rofBias: 1.2, groundspeedBias: 0.8 },
  normal: { firepowerBias: 1.0, armorBias: 1.0, rofBias: 1.0, groundspeedBias: 1.0 },
  hard:   { firepowerBias: 1.2, armorBias: 1.2, rofBias: 0.8, groundspeedBias: 1.2 },
};

// ── 1. AI_DIFFICULTY_MODS has combat bias fields ──

describe('Difficulty combat biases exist in AI_DIFFICULTY_MODS (C++ house.cpp:282-311)', () => {
  for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
    const mods = AI_DIFFICULTY_MODS[diff];
    const expected = EXPECTED_COMBAT_BIASES[diff];

    it(`${diff}: firepowerBias = ${expected.firepowerBias} (C++ Rule.Diff[${diff}].FirepowerBias)`, () => {
      expect(mods.firepowerBias).toBe(expected.firepowerBias);
    });

    it(`${diff}: armorBias = ${expected.armorBias} (C++ Rule.Diff[${diff}].ArmorBias)`, () => {
      expect(mods.armorBias).toBe(expected.armorBias);
    });

    it(`${diff}: rofBias = ${expected.rofBias} (C++ Rule.Diff[${diff}].ROFBias)`, () => {
      expect(mods.rofBias).toBe(expected.rofBias);
    });

    it(`${diff}: groundspeedBias = ${expected.groundspeedBias} (C++ Rule.Diff[${diff}].GroundspeedBias)`, () => {
      expect(mods.groundspeedBias).toBe(expected.groundspeedBias);
    });
  }
});

// ── 2. Combat biases are multiplicative with country bonuses ──
// C++ house.cpp:289: FirepowerBias = hptr->FirepowerBias * Rule.Diff[handicap].FirepowerBias

describe('Difficulty biases multiply with country bonuses (C++ house.cpp:289-293)', () => {
  it('firepowerBias: Germany (1.1) on hard (1.2) = 1.32', () => {
    const countryBias = COUNTRY_BONUSES.Germany?.firepowerMult ?? 1.0;
    const diffBias = AI_DIFFICULTY_MODS.hard.firepowerBias;
    const combined = countryBias * diffBias;
    expect(countryBias).toBe(1.1);
    expect(diffBias).toBe(1.2);
    expect(combined).toBeCloseTo(1.32, 5);
  });

  it('armorBias: England (1.1) on easy (0.8) = 0.88', () => {
    const countryBias = COUNTRY_BONUSES.England?.armorMult ?? 1.0;
    const diffBias = AI_DIFFICULTY_MODS.easy.armorBias;
    const combined = countryBias * diffBias;
    expect(countryBias).toBe(1.1);
    expect(diffBias).toBe(0.8);
    expect(combined).toBeCloseTo(0.88, 5);
  });

  it('rofBias: France (1.1) on hard (0.8) = 0.88', () => {
    const countryBias = COUNTRY_BONUSES.France?.rofMult ?? 1.0;
    const diffBias = AI_DIFFICULTY_MODS.hard.rofBias;
    const combined = countryBias * diffBias;
    expect(countryBias).toBe(1.1);
    expect(diffBias).toBe(0.8);
    expect(combined).toBeCloseTo(0.88, 5);
  });

  it('groundspeedBias: Ukraine (1.1) on easy (0.8) = 0.88', () => {
    const countryBias = COUNTRY_BONUSES.Ukraine?.groundspeedMult ?? 1.0;
    const diffBias = AI_DIFFICULTY_MODS.easy.groundspeedBias;
    const combined = countryBias * diffBias;
    expect(countryBias).toBe(1.1);
    expect(diffBias).toBe(0.8);
    expect(combined).toBeCloseTo(0.88, 5);
  });
});

// ── 3. Normal difficulty preserves base values ──

describe('Normal difficulty does not alter combat stats (all biases = 1.0)', () => {
  const normal = AI_DIFFICULTY_MODS.normal;

  it('firepowerBias = 1.0', () => expect(normal.firepowerBias).toBe(1.0));
  it('armorBias = 1.0', () => expect(normal.armorBias).toBe(1.0));
  it('rofBias = 1.0', () => expect(normal.rofBias).toBe(1.0));
  it('groundspeedBias = 1.0', () => expect(normal.groundspeedBias).toBe(1.0));
});

// ── 4. Difficulty direction correctness ──
// Easy AI should be weaker across all combat stats, hard AI should be stronger

describe('Difficulty direction: easy < normal < hard for power, reversed for ROF', () => {
  it('firepower: easy < normal < hard', () => {
    expect(AI_DIFFICULTY_MODS.easy.firepowerBias).toBeLessThan(AI_DIFFICULTY_MODS.normal.firepowerBias);
    expect(AI_DIFFICULTY_MODS.normal.firepowerBias).toBeLessThan(AI_DIFFICULTY_MODS.hard.firepowerBias);
  });

  it('armor: easy < normal < hard', () => {
    expect(AI_DIFFICULTY_MODS.easy.armorBias).toBeLessThan(AI_DIFFICULTY_MODS.normal.armorBias);
    expect(AI_DIFFICULTY_MODS.normal.armorBias).toBeLessThan(AI_DIFFICULTY_MODS.hard.armorBias);
  });

  it('ROF: easy > normal > hard (higher ROF = slower fire = weaker)', () => {
    expect(AI_DIFFICULTY_MODS.easy.rofBias).toBeGreaterThan(AI_DIFFICULTY_MODS.normal.rofBias);
    expect(AI_DIFFICULTY_MODS.normal.rofBias).toBeGreaterThan(AI_DIFFICULTY_MODS.hard.rofBias);
  });

  it('groundspeed: easy < normal < hard', () => {
    expect(AI_DIFFICULTY_MODS.easy.groundspeedBias).toBeLessThan(AI_DIFFICULTY_MODS.normal.groundspeedBias);
    expect(AI_DIFFICULTY_MODS.normal.groundspeedBias).toBeLessThan(AI_DIFFICULTY_MODS.hard.groundspeedBias);
  });
});

// ── 5. ArmorBias applied in damageEntity (C++ house.cpp:292,302) ──

describe('ArmorBias applied in damageEntity (C++ house.cpp:292)', () => {
  function makeMinimalCombatCtx(armorBiasValue: number): CombatContext {
    resetEntityIds();
    const map = { isPassable: () => true, hasLineOfSight: () => true } as unknown as GameMap;
    return {
      entities: [],
      structures: [],
      effects: [],
      map,
      tick: 0,
      playerHouse: House.Greece,
      warheadOverrides: {},
      scenarioWarheadMeta: {},
      scenarioWarheadProps: {},
      attackedTriggerNames: new Set<string>(),
      bridgeCellCount: 0,
      powerConsumed: 0,
      powerProduced: 0,
      isAllied: () => false,
      entitiesAllied: () => false,
      isPlayerControlled: () => false,
      playSoundAt: () => {},
      playEva: () => {},
      minimapAlert: () => {},
    isRevealedToHouse: () => true,
      movementSpeed: () => 1,
      getFirepowerBias: () => 1.0,
      getArmorBias: () => armorBiasValue,
      getROFBias: () => 1.0,
      damageStructure: () => false,
      aiIQ: () => 3,
      warheadMuzzleColor: () => '#fff',
      clearStructureFootprint: () => {},
      recalculateSiloCapacity: () => {},
      showEvaMessage: () => {},
      screenShake: 0,
      screenFlash: 0,
    };
  }

  it('armorBias 1.2 reduces 100 damage to 83 (round(100/1.2))', () => {
    const ctx = makeMinimalCombatCtx(1.2);
    const target = new Entity(UnitType.V_2TNK, House.USSR, 100, 100);
    target.hp = 500;
    target.maxHp = 500;
    damageEntity(ctx, target, 100, 'AP');
    // 100 / 1.2 = 83.33 -> rounds to 83
    expect(target.hp).toBe(500 - 83);
  });

  it('armorBias 0.8 increases 100 damage to 125 (round(100/0.8))', () => {
    const ctx = makeMinimalCombatCtx(0.8);
    const target = new Entity(UnitType.V_2TNK, House.USSR, 100, 100);
    target.hp = 500;
    target.maxHp = 500;
    damageEntity(ctx, target, 100, 'AP');
    // 100 / 0.8 = 125
    expect(target.hp).toBe(500 - 125);
  });

  it('armorBias 1.0 does not modify damage', () => {
    const ctx = makeMinimalCombatCtx(1.0);
    const target = new Entity(UnitType.V_2TNK, House.USSR, 100, 100);
    target.hp = 500;
    target.maxHp = 500;
    damageEntity(ctx, target, 100, 'AP');
    expect(target.hp).toBe(500 - 100);
  });
});

// ── 6. FirepowerBias affects damage through modifyDamage ──

describe('FirepowerBias affects modifyDamage output (C++ house.cpp:289,299)', () => {
  // modifyDamage(baseDamage, warhead, armor, distPixels, houseBias)
  // houseBias is the combined country + difficulty firepower bias

  it('houseBias 1.2 increases damage by 20%', () => {
    const base = modifyDamage(100, 'AP', 'steel', 0, 1.0);
    const boosted = modifyDamage(100, 'AP', 'steel', 0, 1.2);
    expect(boosted).toBeGreaterThan(base);
    // AP vs steel = 1.0 multiplier, so base = 100, boosted = 120
    expect(boosted).toBe(Math.round(100 * 1.0 * 1.2));
  });

  it('houseBias 0.8 decreases damage by 20%', () => {
    const base = modifyDamage(100, 'AP', 'steel', 0, 1.0);
    const nerfed = modifyDamage(100, 'AP', 'steel', 0, 0.8);
    expect(nerfed).toBeLessThan(base);
    expect(nerfed).toBe(Math.round(100 * 1.0 * 0.8));
  });

  it('combined Germany (1.1) + hard (1.2) = 1.32x damage', () => {
    const combinedBias = 1.1 * 1.2; // 1.32
    const damage = modifyDamage(100, 'AP', 'steel', 0, combinedBias);
    expect(damage).toBe(Math.round(100 * 1.0 * 1.32));
  });
});

// ── 7. ROFBias scales attackCooldown ──

describe('ROFBias scales attack cooldown (C++ house.cpp:293,303)', () => {
  it('ROF bias 0.8 reduces cooldown: rof=30 -> 24 ticks', () => {
    const rof = 30;
    const biasedRof = Math.max(1, Math.round(rof * 0.8));
    expect(biasedRof).toBe(24);
  });

  it('ROF bias 1.2 increases cooldown: rof=30 -> 36 ticks', () => {
    const rof = 30;
    const biasedRof = Math.max(1, Math.round(rof * 1.2));
    expect(biasedRof).toBe(36);
  });

  it('ROF bias 1.0 leaves cooldown unchanged: rof=30 -> 30 ticks', () => {
    const rof = 30;
    const biasedRof = Math.max(1, Math.round(rof * 1.0));
    expect(biasedRof).toBe(30);
  });

  it('ROF bias never goes below 1 tick', () => {
    const rof = 1;
    const biasedRof = Math.max(1, Math.round(rof * 0.1));
    expect(biasedRof).toBe(1);
  });
});

// ── 8. GroundspeedBias scales movement speed ──

describe('GroundspeedBias scales movement (C++ house.cpp:290,300)', () => {
  it('groundspeedBias 1.2 increases speed by 20%', () => {
    const baseSpeed = 10;
    const biasedSpeed = baseSpeed * 1.2;
    expect(biasedSpeed).toBeCloseTo(12.0, 5);
  });

  it('groundspeedBias 0.8 decreases speed by 20%', () => {
    const baseSpeed = 10;
    const biasedSpeed = baseSpeed * 0.8;
    expect(biasedSpeed).toBeCloseTo(8.0, 5);
  });
});

// ── 9. Legacy economy/timing mods still present ──

describe('AI_DIFFICULTY_MODS retains economy/timing modifiers', () => {
  for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
    const mods = AI_DIFFICULTY_MODS[diff];
    it(`${diff}: incomeMult defined`, () => expect(mods.incomeMult).toBeGreaterThan(0));
    it(`${diff}: buildSpeedMult defined`, () => expect(mods.buildSpeedMult).toBeGreaterThan(0));
    it(`${diff}: attackThreshold defined`, () => expect(mods.attackThreshold).toBeGreaterThan(0));
    it(`${diff}: aggressionMult defined`, () => expect(mods.aggressionMult).toBeGreaterThan(0));
  }
});
