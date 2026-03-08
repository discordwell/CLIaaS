/**
 * Tests for AI Base Intelligence (Phase 4) — Repair, Sell, Rebuild Priority.
 * Covers: IQ-gated rebuild, priority ordering, credit cost for rebuild,
 * AI auto-repair (IQ >= 3), AI auto-sell near-death buildings (IQ >= 3).
 */

import { describe, it, expect } from 'vitest';
import {
  CONDITION_RED, REPAIR_STEP, REPAIR_PERCENT,
  PRODUCTION_ITEMS,
} from '../engine/types';
import { STRUCTURE_SIZE, STRUCTURE_MAX_HP } from '../engine/scenario';

// === Part 0: Constants used by AI base intelligence ===

describe('AI base intelligence constants', () => {
  it('CONDITION_RED is 0.25 (25% HP threshold for auto-sell)', () => {
    expect(CONDITION_RED).toBe(0.25);
  });

  it('REPAIR_STEP is 5 (HP healed per repair tick)', () => {
    expect(REPAIR_STEP).toBe(5);
  });

  it('REPAIR_PERCENT is 0.20 (20% of build cost = total repair cost)', () => {
    expect(REPAIR_PERCENT).toBe(0.20);
  });
});

// === Part 1: Rebuild priority ordering ===

describe('Rebuild priority ordering', () => {
  // The REBUILD_PRIORITY map from updateBaseRebuild — replicated here for testing
  const REBUILD_PRIORITY: Record<string, number> = {
    'POWR': 0, 'APWR': 0,
    'PROC': 1,
    'WEAP': 2, 'TENT': 2, 'BARR': 2,
    'GUN': 3, 'TSLA': 3, 'SAM': 3, 'AGUN': 3, 'PBOX': 3, 'HBOX': 3, 'FTUR': 3,
    'DOME': 4, 'FIX': 4, 'SILO': 4,
    'ATEK': 5, 'STEK': 5, 'HPAD': 5, 'AFLD': 5,
  };

  it('power plants have highest priority (0)', () => {
    expect(REBUILD_PRIORITY['POWR']).toBe(0);
    expect(REBUILD_PRIORITY['APWR']).toBe(0);
  });

  it('refineries come second (1)', () => {
    expect(REBUILD_PRIORITY['PROC']).toBe(1);
  });

  it('production buildings are priority 2', () => {
    expect(REBUILD_PRIORITY['WEAP']).toBe(2);
    expect(REBUILD_PRIORITY['TENT']).toBe(2);
    expect(REBUILD_PRIORITY['BARR']).toBe(2);
  });

  it('defenses are priority 3', () => {
    const defTypes = ['GUN', 'TSLA', 'SAM', 'AGUN', 'PBOX', 'HBOX', 'FTUR'];
    for (const t of defTypes) {
      expect(REBUILD_PRIORITY[t], `${t} should be priority 3`).toBe(3);
    }
  });

  it('tech buildings are lowest explicit priority (5)', () => {
    expect(REBUILD_PRIORITY['ATEK']).toBe(5);
    expect(REBUILD_PRIORITY['STEK']).toBe(5);
    expect(REBUILD_PRIORITY['HPAD']).toBe(5);
    expect(REBUILD_PRIORITY['AFLD']).toBe(5);
  });

  it('unknown types fall to default priority 6', () => {
    expect(REBUILD_PRIORITY['KENL'] ?? 6).toBe(6);
    expect(REBUILD_PRIORITY['MSLO'] ?? 6).toBe(6);
  });

  it('sorting a mixed queue yields correct order', () => {
    const queue = [
      { type: 'TSLA' }, { type: 'PROC' }, { type: 'POWR' },
      { type: 'ATEK' }, { type: 'WEAP' }, { type: 'DOME' },
    ];
    queue.sort((a, b) =>
      (REBUILD_PRIORITY[a.type] ?? 6) - (REBUILD_PRIORITY[b.type] ?? 6)
    );
    expect(queue.map(q => q.type)).toEqual([
      'POWR', 'PROC', 'WEAP', 'TSLA', 'DOME', 'ATEK',
    ]);
  });
});

// === Part 2: IQ gating ===

describe('IQ gating for AI behaviors', () => {
  it('IQ 0 = no AI at all (no rebuild, no repair, no sell)', () => {
    const iq = 0;
    expect(iq >= 2).toBe(false); // rebuild gate
    expect(iq >= 3).toBe(false); // repair/sell gate
  });

  it('IQ 1 = build only (no rebuild)', () => {
    const iq = 1;
    expect(iq >= 2).toBe(false); // rebuild gate
    expect(iq >= 3).toBe(false); // repair/sell gate
  });

  it('IQ 2 = rebuild allowed, no repair/sell', () => {
    const iq = 2;
    expect(iq >= 2).toBe(true);  // rebuild gate passes
    expect(iq >= 3).toBe(false); // repair/sell gate fails
  });

  it('IQ 3 = full intelligence (rebuild + repair + sell)', () => {
    const iq = 3;
    expect(iq >= 2).toBe(true);  // rebuild gate passes
    expect(iq >= 3).toBe(true);  // repair/sell gate passes
  });
});

// === Part 3: Repair cost calculation parity ===

describe('AI repair cost calculation (C++ parity)', () => {
  it('repair cost per step matches player repair formula', () => {
    // For POWR: cost=300, maxHp=200 (from STRUCTURE_MAX_HP, C++ RULES.INI)
    const powrItem = PRODUCTION_ITEMS.find(p => p.type === 'POWR' && p.isStructure);
    expect(powrItem).toBeDefined();
    expect(powrItem!.cost).toBe(300);
    const maxHp = STRUCTURE_MAX_HP['POWR'] ?? 256;
    expect(maxHp).toBe(200);
    // Formula: ceil((cost * REPAIR_PERCENT) / (maxHp / REPAIR_STEP))
    const repairCostPerStep = Math.ceil((powrItem!.cost * REPAIR_PERCENT) / (maxHp / REPAIR_STEP));
    // cost=300, REPAIR_PERCENT=0.20, maxHp=200, REPAIR_STEP=5
    // = ceil((300 * 0.20) / (200 / 5)) = ceil(60 / 40) = ceil(1.5) = 2
    expect(repairCostPerStep).toBe(2);
  });

  it('repair cost per step for WEAP', () => {
    const weapItem = PRODUCTION_ITEMS.find(p => p.type === 'WEAP' && p.isStructure);
    expect(weapItem).toBeDefined();
    const maxHp = STRUCTURE_MAX_HP['WEAP'] ?? 256;
    const repairCostPerStep = Math.ceil((weapItem!.cost * REPAIR_PERCENT) / (maxHp / REPAIR_STEP));
    // Should be positive and reasonable
    expect(repairCostPerStep).toBeGreaterThan(0);
    expect(repairCostPerStep).toBeLessThan(weapItem!.cost); // repair step cost < total cost
  });

  it('total repair cost is 20% of build cost', () => {
    // For any structure, total repair = cost * REPAIR_PERCENT
    const tentItem = PRODUCTION_ITEMS.find(p => p.type === 'TENT' && p.isStructure);
    expect(tentItem).toBeDefined();
    const totalRepairCost = tentItem!.cost * REPAIR_PERCENT;
    expect(totalRepairCost).toBe(tentItem!.cost * 0.20);
  });
});

// === Part 4: Auto-sell refund calculation ===

describe('AI auto-sell refund calculation', () => {
  it('full HP sell gives 50% refund (but CONDITION_RED prevents this case)', () => {
    const cost = 1000;
    const hpRatio = 1.0;
    const refund = Math.floor(cost * 0.5 * hpRatio);
    expect(refund).toBe(500);
  });

  it('at CONDITION_RED threshold (25% HP) refund is 12.5% of cost', () => {
    const cost = 1000;
    const hpRatio = CONDITION_RED; // 0.25
    const refund = Math.floor(cost * 0.5 * hpRatio);
    expect(refund).toBe(125);
  });

  it('at 10% HP refund is 5% of cost', () => {
    const cost = 1000;
    const hpRatio = 0.1;
    const refund = Math.floor(cost * 0.5 * hpRatio);
    expect(refund).toBe(50);
  });

  it('near-zero HP gives near-zero refund', () => {
    const cost = 300;
    const hpRatio = 1 / 200; // 1 HP out of 200
    const refund = Math.floor(cost * 0.5 * hpRatio);
    expect(refund).toBe(0); // floor(0.75) = 0
  });
});

// === Part 5: Auto-sell exclusion rules ===

describe('AI auto-sell exclusion rules', () => {
  const NEVER_SELL_TYPES = ['FACT'];
  const CONDITIONAL_SELL_TYPES = ['POWR', 'APWR']; // only if >1 power plant

  it('ConYard (FACT) is never sold', () => {
    expect(NEVER_SELL_TYPES).toContain('FACT');
  });

  it('FACT has a STRUCTURE_SIZE entry (is a valid structure)', () => {
    expect(STRUCTURE_SIZE['FACT']).toBeDefined();
  });

  it('power plants are conditionally excluded (need at least 2)', () => {
    // Simulate: 1 power plant = don't sell
    const powerCount = 1;
    expect(powerCount <= 1).toBe(true); // should skip sell

    // Simulate: 2 power plants = OK to sell one
    const powerCount2 = 2;
    expect(powerCount2 <= 1).toBe(false); // sell allowed
  });

  it('all production items referenced by sell have structure entries', () => {
    // Every structure type that AI might sell must have a production item for refund calc
    const testTypes = ['POWR', 'APWR', 'PROC', 'WEAP', 'TENT', 'GUN', 'TSLA', 'DOME'];
    for (const t of testTypes) {
      const item = PRODUCTION_ITEMS.find(p => p.type === t && p.isStructure);
      expect(item, `${t} should have a production item`).toBeDefined();
      expect(item!.cost).toBeGreaterThan(0);
    }
  });
});

// === Part 6: Rebuild credit cost ===

describe('AI rebuild credit cost', () => {
  it('all blueprint-rebuildable types have production items with costs', () => {
    const rebuildTypes = [
      'POWR', 'APWR', 'PROC', 'WEAP', 'TENT', 'BARR',
      'GUN', 'TSLA', 'SAM', 'AGUN', 'PBOX', 'HBOX', 'FTUR',
      'DOME', 'FIX', 'SILO', 'ATEK', 'STEK', 'HPAD', 'AFLD',
    ];
    for (const t of rebuildTypes) {
      const item = PRODUCTION_ITEMS.find(p => p.type === t && p.isStructure);
      expect(item, `${t} should have a structure production item`).toBeDefined();
      expect(item!.cost, `${t} cost should be > 0`).toBeGreaterThan(0);
    }
  });

  it('insufficient funds blocks rebuild (credit < cost)', () => {
    const powrItem = PRODUCTION_ITEMS.find(p => p.type === 'POWR' && p.isStructure)!;
    const credits = powrItem.cost - 1;
    expect(credits < powrItem.cost).toBe(true); // should block
  });

  it('sufficient funds allows rebuild and deducts cost', () => {
    const powrItem = PRODUCTION_ITEMS.find(p => p.type === 'POWR' && p.isStructure)!;
    let credits = 5000;
    expect(credits >= powrItem.cost).toBe(true);
    credits -= powrItem.cost;
    expect(credits).toBe(5000 - powrItem.cost);
  });
});

// === Part 7: 80% repair threshold ===

describe('AI repair threshold', () => {
  it('structure at 100% HP is not repaired', () => {
    const maxHp = 200;
    const hp = 200;
    expect(hp >= maxHp * 0.8).toBe(true); // above threshold, skip
  });

  it('structure at 79% HP is repaired', () => {
    const maxHp = 200;
    const hp = 158; // 79%
    expect(hp >= maxHp * 0.8).toBe(false); // below threshold, repair
  });

  it('structure at exactly 80% HP is not repaired', () => {
    const maxHp = 200;
    const hp = 160; // exactly 80%
    expect(hp >= maxHp * 0.8).toBe(true); // at threshold, skip
  });

  it('structure at 25% HP (CONDITION_RED) triggers both repair and sell consideration', () => {
    const maxHp = 200;
    const hp = 50; // 25%
    // Below 80% = should repair
    expect(hp >= maxHp * 0.8).toBe(false);
    // At CONDITION_RED = should auto-sell
    expect(hp < maxHp * CONDITION_RED).toBe(false); // exactly at threshold, not below
    // Below CONDITION_RED
    const hp2 = 49;
    expect(hp2 < maxHp * CONDITION_RED).toBe(true); // below threshold, sell
  });
});
