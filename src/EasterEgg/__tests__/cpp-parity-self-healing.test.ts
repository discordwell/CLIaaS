/**
 * C++ Behavioral Parity: Unit Self-Healing (4TNK Mammoth Tank, HARV Harvester)
 *
 * Tests verify self-healing behavior matches C++ RA source code.
 *
 * ## C++ Source References
 *
 * ### Self-Healing Trigger (techno.cpp:2354):
 *   if (IsOwnedByPlayer && IsSelfHealing && Strength > 0
 *       && Health_Ratio() <= Rule.ConditionYellow) {
 *     Strength++;   // +1 HP per call
 *   }
 *   // Called every 14 game ticks (same timer as structure repair)
 *
 * ### IsSelfHealing Units (udata.cpp):
 *   4TNK: IsSelfHealing=yes  (Mammoth Tank)
 *   HARV: IsSelfHealing=yes  (Harvester)
 *   All other units: IsSelfHealing=no (default)
 *
 * ### ConditionYellow Threshold (rules.cpp:234):
 *   ConditionYellow = fixed(1, 2)  // 0.5 = 50%
 *
 * ### Healing Rate:
 *   14 ticks per heal cycle (RepairRate, same interval as structure repair)
 *   +1 HP per cycle
 *
 * ### Healing Cap:
 *   Healing stops when Health_Ratio() > ConditionYellow (above 50%)
 *   For 4TNK (600 HP): heals up to 301 HP (301/600 = 0.5017 > 0.5)
 *   For HARV (600 HP): heals up to 301 HP (301/600 = 0.5017 > 0.5)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, UNIT_STATS, CONDITION_YELLOW,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';

beforeEach(() => resetEntityIds());

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

/**
 * Simulate self-healing logic for N ticks (mirrors engine/index.ts game loop).
 * This reproduces the exact check from the game loop:
 *   if (tick % 14 === 0 && e.alive && e.stats.selfHealing && e.hp > 0 && e.hp / e.maxHp <= CONDITION_YELLOW)
 *     e.hp = Math.min(e.maxHp, e.hp + 1);
 */
function simulateSelfHealing(entity: Entity, ticks: number): void {
  for (let tick = 1; tick <= ticks; tick++) {
    if (tick % 14 === 0) {
      if (entity.alive && entity.stats.selfHealing && entity.hp > 0 && entity.hp / entity.maxHp <= CONDITION_YELLOW) {
        entity.hp = Math.min(entity.maxHp, entity.hp + 1);
      }
    }
  }
}

// == Stats Flags (udata.cpp / rules.ini) ======================================

describe('selfHealing flag on unit stats (udata.cpp IsSelfHealing)', () => {
  it('4TNK has selfHealing=true', () => {
    expect(UNIT_STATS['4TNK'].selfHealing).toBe(true);
  });

  it('HARV has selfHealing=true', () => {
    expect(UNIT_STATS['HARV'].selfHealing).toBe(true);
  });

  it('other tanks do NOT have selfHealing', () => {
    for (const key of ['1TNK', '2TNK', '3TNK'] as const) {
      expect(UNIT_STATS[key].selfHealing, `${key} should not self-heal`).toBeFalsy();
    }
  });

  it('infantry do NOT have selfHealing', () => {
    for (const key of ['E1', 'E2', 'E3', 'E4', 'E7'] as const) {
      expect(UNIT_STATS[key].selfHealing, `${key} should not self-heal`).toBeFalsy();
    }
  });
});

// == 4TNK Self-Healing Behavior (techno.cpp:2354) =============================

describe('4TNK self-healing behavior (techno.cpp:2354)', () => {
  it('heals +1 HP at exactly 50% health after 14 ticks', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.hp = 300; // exactly 50% of 600
    expect(mammoth.hp / mammoth.maxHp).toBe(CONDITION_YELLOW);

    simulateSelfHealing(mammoth, 14);
    expect(mammoth.hp).toBe(301);
  });

  it('heals +1 HP below 50% health after 14 ticks', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.hp = 200; // 33% of 600
    expect(mammoth.hp / mammoth.maxHp).toBeLessThan(CONDITION_YELLOW);

    simulateSelfHealing(mammoth, 14);
    expect(mammoth.hp).toBe(201);
  });

  it('does NOT heal above 50% health', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.hp = 301; // just above 50%
    expect(mammoth.hp / mammoth.maxHp).toBeGreaterThan(CONDITION_YELLOW);

    simulateSelfHealing(mammoth, 14);
    expect(mammoth.hp).toBe(301); // unchanged
  });

  it('stops healing once HP crosses above 50%', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.hp = 300; // exactly 50%

    // First 14 ticks: heals to 301
    simulateSelfHealing(mammoth, 14);
    expect(mammoth.hp).toBe(301);

    // Next 14 ticks: 301/600 > 0.5, no healing
    simulateSelfHealing(mammoth, 14);
    expect(mammoth.hp).toBe(301);
  });

  it('heals +1 per 14-tick cycle, not +1 per tick', () => {
    // After 13 ticks: no heal yet (no tick divisible by 14)
    const mammoth13 = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth13.hp = 100; // well below 50%
    simulateSelfHealing(mammoth13, 13);
    expect(mammoth13.hp).toBe(100);

    // After 14 ticks: exactly one heal
    const mammoth14 = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth14.hp = 100;
    simulateSelfHealing(mammoth14, 14);
    expect(mammoth14.hp).toBe(101);

    // After 27 ticks: still only one heal (14 divides 14 but not 15-27)
    const mammoth27 = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth27.hp = 100;
    simulateSelfHealing(mammoth27, 27);
    expect(mammoth27.hp).toBe(101);
  });

  it('heals multiple times over many cycles', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.hp = 100;

    // 5 full cycles = 70 ticks = 5 HP healed
    simulateSelfHealing(mammoth, 70);
    expect(mammoth.hp).toBe(105);
  });

  it('dead unit does NOT heal (hp=0, alive=false)', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    mammoth.hp = 0;
    mammoth.alive = false;

    simulateSelfHealing(mammoth, 14);
    expect(mammoth.hp).toBe(0);
    expect(mammoth.alive).toBe(false);
  });

  it('does NOT heal at full health', () => {
    const mammoth = entityAtCell(UnitType.V_4TNK, House.USSR, 10, 10);
    expect(mammoth.hp).toBe(600);
    expect(mammoth.hp).toBe(mammoth.maxHp);

    simulateSelfHealing(mammoth, 14);
    expect(mammoth.hp).toBe(600);
  });
});

// == HARV Self-Healing Behavior (techno.cpp:2354) =============================

describe('HARV self-healing behavior (techno.cpp:2354)', () => {
  it('heals +1 HP at exactly 50% health after 14 ticks', () => {
    const harv = entityAtCell(UnitType.V_HARV, House.Spain, 5, 5);
    harv.hp = 300; // exactly 50% of 600
    expect(harv.hp / harv.maxHp).toBe(CONDITION_YELLOW);

    simulateSelfHealing(harv, 14);
    expect(harv.hp).toBe(301);
  });

  it('heals +1 HP below 50% health after 14 ticks', () => {
    const harv = entityAtCell(UnitType.V_HARV, House.Spain, 5, 5);
    harv.hp = 150; // 25% of 600
    expect(harv.hp / harv.maxHp).toBeLessThan(CONDITION_YELLOW);

    simulateSelfHealing(harv, 14);
    expect(harv.hp).toBe(151);
  });

  it('does NOT heal above 50% health', () => {
    const harv = entityAtCell(UnitType.V_HARV, House.Spain, 5, 5);
    harv.hp = 301;
    expect(harv.hp / harv.maxHp).toBeGreaterThan(CONDITION_YELLOW);

    simulateSelfHealing(harv, 14);
    expect(harv.hp).toBe(301);
  });

  it('stops healing once HP crosses above 50%', () => {
    const harv = entityAtCell(UnitType.V_HARV, House.Spain, 5, 5);
    harv.hp = 300;

    simulateSelfHealing(harv, 14);
    expect(harv.hp).toBe(301);

    simulateSelfHealing(harv, 14);
    expect(harv.hp).toBe(301); // cap reached
  });

  it('dead harvester does NOT heal', () => {
    const harv = entityAtCell(UnitType.V_HARV, House.Spain, 5, 5);
    harv.hp = 0;
    harv.alive = false;

    simulateSelfHealing(harv, 14);
    expect(harv.hp).toBe(0);
    expect(harv.alive).toBe(false);
  });
});

// == Non-Self-Healing Units (negative cases) ==================================

describe('non-self-healing units do NOT heal (techno.cpp:2354 IsSelfHealing=false)', () => {
  it('2TNK (Medium Tank) does not self-heal at low HP', () => {
    const med = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    med.hp = 100; // well below 50% of 400

    simulateSelfHealing(med, 14);
    expect(med.hp).toBe(100); // unchanged
  });

  it('E1 (Rifle Infantry) does not self-heal at low HP', () => {
    const e1 = entityAtCell(UnitType.E1, House.Spain, 10, 10);
    e1.hp = 10; // well below 50% of 50

    simulateSelfHealing(e1, 14);
    expect(e1.hp).toBe(10); // unchanged
  });
});
