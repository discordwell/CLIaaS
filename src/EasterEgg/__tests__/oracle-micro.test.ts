import { describe, it, expect } from 'vitest';
import { OracleStrategy } from '../oracle/OracleStrategy.js';
import type { RAGameState, RAEntity, RAStructure } from '../oracle/WasmAdapter.js';

/**
 * Tactical micro-management tests — verify the OracleStrategy's focus-fire,
 * weapon-matching, pullback, and priority-targeting behaviour using pure
 * data fixtures (no WASM or browser needed).
 */

function makeEntity(
  id: number, t: string, house: string,
  cx: number, cy: number,
  hp = 100, mhp = 100, m = 5, // m=5 is MISSION_GUARD
): RAEntity {
  return { id, t, house, cx, cy, hp, mhp, m, ally: true };
}

function makeStructure(
  id: number, t: string, house: string,
  cx: number, cy: number,
  ally = true,
): RAStructure {
  return { id, t, house, cx, cy, hp: 256, mhp: 256, m: 0, ally, repairing: false };
}

function makeState(overrides: Partial<RAGameState> = {}): RAGameState {
  return {
    tick: 100,
    credits: 5000,
    playerHouse: 'Greece',
    alliedHouses: ['Greece'],
    globals: [],
    missionTimer: 0,
    missionTimerActive: false,
    civEvacuated: false,
    winPending: false,
    losePending: false,
    power: { produced: 100, consumed: 40 },
    units: [],
    enemies: [],
    structures: [],
    production: [],
    buildable: { structures: [], units: [], infantry: [] },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// Focus Fire
// ═══════════════════════════════════════════════════════════

describe('micro — focus fire', () => {
  it('all tanks target the same enemy (focus fire via attack+target)', () => {
    const strategy = new OracleStrategy('SCG04EA');
    // 5 heavy tanks (str ~15) vs 2 light (str ~6) — clear 1.5x advantage
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 89, 52)],
      units: [
        makeEntity(1, '3TNK', 'Greece', 50, 50),
        makeEntity(2, '3TNK', 'Greece', 51, 50),
        makeEntity(3, '3TNK', 'Greece', 52, 50),
        makeEntity(4, '3TNK', 'Greece', 53, 50),
        makeEntity(5, '3TNK', 'Greece', 54, 50),
      ],
      enemies: [
        { ...makeEntity(60, '1TNK', 'USSR', 55, 55), ally: false },
        { ...makeEntity(61, '1TNK', 'USSR', 56, 55), ally: false },
      ],
    });

    const decision = strategy.decide(state);
    // Should have at least one attack command with a target field (focus fire)
    const attackCmds = decision.commands.filter(
      (c) => c.cmd === 'attack' && typeof c.target === 'number',
    );
    expect(attackCmds.length).toBeGreaterThan(0);

    // Anti-armor tanks should all focus the same target
    const aaCmd = attackCmds.find((c) => {
      const ids = c.ids as number[];
      return ids.includes(1) || ids.includes(2) || ids.includes(3);
    });
    expect(aaCmd).toBeDefined();
    expect(typeof aaCmd!.target).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════
// Pullback — damaged units retreat
// ═══════════════════════════════════════════════════════════

describe('micro — pullback', () => {
  it('damaged units get move to rally, not attack', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 89, 52)],
      units: [
        // Badly damaged unit — should retreat
        makeEntity(1, '3TNK', 'Greece', 55, 55, 20, 100),
        // Healthy units
        makeEntity(2, '3TNK', 'Greece', 50, 50),
        makeEntity(3, '3TNK', 'Greece', 51, 50),
      ],
      enemies: [
        { ...makeEntity(60, '2TNK', 'USSR', 58, 58), ally: false },
      ],
    });

    const decision = strategy.decide(state);

    // Damaged unit (id=1) should appear in a 'move' command, not 'attack'
    const moveCmd = decision.commands.find(
      (c) => c.cmd === 'move' && (c.ids as number[]).includes(1),
    );
    expect(moveCmd).toBeDefined();

    // Damaged unit should NOT appear in any 'attack' command
    const attackCmds = decision.commands.filter((c) => c.cmd === 'attack');
    for (const cmd of attackCmds) {
      const ids = cmd.ids as number[] | undefined;
      if (ids) {
        expect(ids).not.toContain(1);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Weapon Matching — role-based targeting
// ═══════════════════════════════════════════════════════════

describe('micro — weapon matching', () => {
  it('E3 rockets target tanks, E1 rifles target infantry', () => {
    const strategy = new OracleStrategy('SCG04EA');
    // 4 E3 rockets (str=4) + 4 E1 rifles (str=4) + 2 tanks (str=6) = 14
    // vs 1 tank (str=3) + 1 infantry (str=1) = 4   → 14 > 6 ✓
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 89, 52)],
      units: [
        makeEntity(1, 'E3', 'Greece', 50, 50),  // anti-armor
        makeEntity(2, 'E1', 'Greece', 51, 50),  // anti-infantry
        makeEntity(3, 'E3', 'Greece', 52, 50),  // anti-armor
        makeEntity(4, 'E1', 'Greece', 53, 50),  // anti-infantry
        makeEntity(5, 'E3', 'Greece', 50, 51),  // anti-armor
        makeEntity(6, 'E1', 'Greece', 51, 51),  // anti-infantry
        makeEntity(7, 'E3', 'Greece', 52, 51),  // anti-armor
        makeEntity(8, 'E1', 'Greece', 53, 51),  // anti-infantry
        makeEntity(9, '3TNK', 'Greece', 49, 50), // anti-armor
        makeEntity(10, '3TNK', 'Greece', 54, 50), // anti-armor
      ],
      enemies: [
        { ...makeEntity(60, '2TNK', 'USSR', 55, 55), ally: false },  // vehicle
        { ...makeEntity(61, 'E2', 'USSR', 56, 55), ally: false },    // infantry
      ],
    });

    const decision = strategy.decide(state);
    const attackCmds = decision.commands.filter(
      (c) => c.cmd === 'attack' && typeof c.target === 'number',
    );

    // E3 (anti-armor ids 1,3) should target the tank (id 60)
    const e3Cmd = attackCmds.find((c) => {
      const ids = c.ids as number[];
      return ids.includes(1) || ids.includes(3);
    });
    expect(e3Cmd).toBeDefined();
    expect(e3Cmd!.target).toBe(60); // the 2TNK vehicle

    // E1 (anti-infantry ids 2,4) should target the infantry (id 61)
    const e1Cmd = attackCmds.find((c) => {
      const ids = c.ids as number[];
      return ids.includes(2) || ids.includes(4);
    });
    expect(e1Cmd).toBeDefined();
    expect(e1Cmd!.target).toBe(61); // the E2 infantry
  });
});

// ═══════════════════════════════════════════════════════════
// Fallback — no matching target type
// ═══════════════════════════════════════════════════════════

describe('micro — fallback targeting', () => {
  it('anti-infantry units attack tanks when no infantry present', () => {
    const strategy = new OracleStrategy('SCG04EA');
    // 6 E1 (str=6) + 2 tanks (str=6) = 12 vs 1 tank (str=3) → 12 > 4.5 ✓
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 89, 52)],
      units: [
        makeEntity(1, 'E1', 'Greece', 50, 50),
        makeEntity(2, 'E1', 'Greece', 51, 50),
        makeEntity(3, 'E1', 'Greece', 52, 50),
        makeEntity(4, 'E1', 'Greece', 53, 50),
        makeEntity(5, 'E1', 'Greece', 50, 51),
        makeEntity(6, 'E1', 'Greece', 51, 51),
        makeEntity(7, '3TNK', 'Greece', 49, 50),
        makeEntity(8, '3TNK', 'Greece', 54, 50),
      ],
      enemies: [
        { ...makeEntity(60, '3TNK', 'USSR', 55, 55), ally: false },  // vehicle only
      ],
    });

    const decision = strategy.decide(state);
    const attackCmds = decision.commands.filter(
      (c) => c.cmd === 'attack' && typeof c.target === 'number',
    );
    expect(attackCmds.length).toBeGreaterThan(0);

    // E1 should fall back to attacking the tank since no infantry exists
    const e1Cmd = attackCmds.find((c) => {
      const ids = c.ids as number[];
      return ids.includes(1) || ids.includes(2);
    });
    expect(e1Cmd).toBeDefined();
    expect(e1Cmd!.target).toBe(60); // the 3TNK
  });
});

// ═══════════════════════════════════════════════════════════
// Priority Targeting — damaged enemies first
// ═══════════════════════════════════════════════════════════

describe('micro — priority targeting', () => {
  it('damaged enemy targeted before healthy one', () => {
    const strategy = new OracleStrategy('SCG04EA');
    // 5 heavy tanks (str=15) vs 2 medium (str ~4.2) → 15 > 6.3 ✓
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 89, 52)],
      units: [
        makeEntity(1, '3TNK', 'Greece', 50, 50),
        makeEntity(2, '3TNK', 'Greece', 51, 50),
        makeEntity(3, '3TNK', 'Greece', 52, 50),
        makeEntity(4, '3TNK', 'Greece', 53, 50),
        makeEntity(5, '3TNK', 'Greece', 54, 50),
      ],
      enemies: [
        // Healthy enemy — closer
        { ...makeEntity(60, '2TNK', 'USSR', 52, 52, 100, 100), ally: false },
        // Damaged enemy — slightly further
        { ...makeEntity(61, '2TNK', 'USSR', 54, 54, 40, 100), ally: false },
      ],
    });

    const decision = strategy.decide(state);
    const attackCmds = decision.commands.filter(
      (c) => c.cmd === 'attack' && typeof c.target === 'number',
    );
    expect(attackCmds.length).toBeGreaterThan(0);

    // Should target the damaged enemy (id 61, 40/100 HP) over the healthy one (id 60)
    const tankCmd = attackCmds.find((c) => {
      const ids = c.ids as number[];
      return ids.includes(1) || ids.includes(2);
    });
    expect(tankCmd).toBeDefined();
    expect(tankCmd!.target).toBe(61); // the damaged 2TNK
  });
});

// ═══════════════════════════════════════════════════════════
// Empty inputs
// ═══════════════════════════════════════════════════════════

describe('micro — empty inputs', () => {
  it('no enemies returns no micro commands', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 89, 52)],
      units: [
        makeEntity(1, '3TNK', 'Greece', 50, 50),
      ],
      enemies: [],
    });

    const decision = strategy.decide(state);
    // With no enemies, there should be no attack commands with target
    const attackWithTarget = decision.commands.filter(
      (c) => c.cmd === 'attack' && typeof c.target === 'number',
    );
    expect(attackWithTarget.length).toBe(0);
  });
});
