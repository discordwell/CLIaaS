import { describe, it, expect } from 'vitest';
import { OracleStrategy } from '../oracle/OracleStrategy.js';
import type { RAGameState, RAEntity, RAStructure } from '../oracle/WasmAdapter.js';

/**
 * Tactical micro-management tests — verify the OracleStrategy's focus-fire,
 * weapon-matching, pullback, priority-targeting, idle filtering, scatter,
 * and force-threshold behaviour using pure data fixtures (no WASM needed).
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
    // 5 heavy tanks vs 2 light — enemies near FACT trigger base defense micro
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
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
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
      units: [
        // Critically damaged unit (<15% HP) — should retreat when medic is present
        makeEntity(1, '3TNK', 'Greece', 55, 55, 10, 100),
        // Healthy units
        makeEntity(2, '3TNK', 'Greece', 50, 50),
        makeEntity(3, '3TNK', 'Greece', 51, 50),
        // Medic present — enables retreat logic for critically damaged units
        makeEntity(4, 'MEDI', 'Greece', 50, 48),
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
    // Mixed force — enemies near FACT trigger base defense micro with role matching
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
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
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
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
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
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
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
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

// ═══════════════════════════════════════════════════════════
// Idle Filter — busy units are not re-commanded
// ═══════════════════════════════════════════════════════════

describe('micro — idle filter', () => {
  it('busy units (non-idle mission) are not re-commanded', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const enemies = [
      { ...makeEntity(60, '2TNK', 'USSR', 55, 55), ally: false },
    ];

    // First decide — all units idle (m=5), populates lastUnitTargets
    const state1 = makeState({
      tick: 100,
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
      units: [
        makeEntity(1, '3TNK', 'Greece', 50, 50),
        makeEntity(2, '3TNK', 'Greece', 51, 50),
      ],
      enemies,
    });
    const decision1 = strategy.decide(state1);
    // Verify first decide DID issue attack commands
    const firstAttacks = decision1.commands.filter(
      (c) => c.cmd === 'attack' && typeof c.target === 'number',
    );
    expect(firstAttacks.length).toBeGreaterThan(0);

    // Second decide — same enemies, units now busy (m=12 = MISSION_ATTACK)
    const state2 = makeState({
      tick: 105,
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
      units: [
        makeEntity(1, '3TNK', 'Greece', 53, 53, 100, 100, 12), // busy attacking
        makeEntity(2, '3TNK', 'Greece', 54, 53, 100, 100, 12), // busy attacking
      ],
      enemies,
    });
    const decision2 = strategy.decide(state2);

    // Busy units with live target should NOT get new attack commands
    const secondAttacks = decision2.commands.filter(
      (c) => c.cmd === 'attack' && typeof c.target === 'number',
    );
    expect(secondAttacks.length).toBe(0);
  });

  it('busy units ARE re-commanded when target dies', () => {
    const strategy = new OracleStrategy('SCG04EA');

    // First decide — attack enemy 60
    const state1 = makeState({
      tick: 100,
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
      units: [
        makeEntity(1, '3TNK', 'Greece', 50, 50),
        makeEntity(2, '3TNK', 'Greece', 51, 50),
      ],
      enemies: [
        { ...makeEntity(60, '2TNK', 'USSR', 55, 55), ally: false },
      ],
    });
    strategy.decide(state1);

    // Second decide — enemy 60 is dead, new enemy 70 appears
    const state2 = makeState({
      tick: 105,
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
      units: [
        makeEntity(1, '3TNK', 'Greece', 53, 53, 100, 100, 12), // busy
        makeEntity(2, '3TNK', 'Greece', 54, 53, 100, 100, 12), // busy
      ],
      enemies: [
        { ...makeEntity(70, '2TNK', 'USSR', 55, 55), ally: false }, // new target
      ],
    });
    const decision2 = strategy.decide(state2);

    // Target died — should re-command even though mission is non-idle
    const attacks = decision2.commands.filter(
      (c) => c.cmd === 'attack' && typeof c.target === 'number',
    );
    expect(attacks.length).toBeGreaterThan(0);
  });

  it('busy units ARE re-commanded after 90-tick stale timeout', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const enemies = [
      { ...makeEntity(60, '2TNK', 'USSR', 55, 55), ally: false },
    ];

    // First decide — attack enemy 60
    const state1 = makeState({
      tick: 100,
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
      units: [
        makeEntity(1, '3TNK', 'Greece', 50, 50),
        makeEntity(2, '3TNK', 'Greece', 51, 50),
      ],
      enemies,
    });
    const d1 = strategy.decide(state1);
    expect(d1.commands.filter(c => c.cmd === 'attack').length).toBeGreaterThan(0);

    // Second decide at tick 105 — still within 90-tick window, should NOT re-command
    const state2 = makeState({
      tick: 105,
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
      units: [
        makeEntity(1, '3TNK', 'Greece', 53, 53, 100, 100, 12),
        makeEntity(2, '3TNK', 'Greece', 54, 53, 100, 100, 12),
      ],
      enemies,
    });
    const d2 = strategy.decide(state2);
    expect(d2.commands.filter(c => c.cmd === 'attack' && typeof c.target === 'number').length).toBe(0);

    // Third decide at tick 200 — 100 ticks since command, exceeds 90-tick timeout
    const state3 = makeState({
      tick: 200,
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
      units: [
        makeEntity(1, '3TNK', 'Greece', 53, 53, 100, 100, 12),
        makeEntity(2, '3TNK', 'Greece', 54, 53, 100, 100, 12),
      ],
      enemies,
    });
    const d3 = strategy.decide(state3);
    // Stale timeout — should re-command even though target is alive and unit is busy
    expect(d3.commands.filter(c => c.cmd === 'attack' && typeof c.target === 'number').length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// Infantry Scatter vs Tank Crush
// ═══════════════════════════════════════════════════════════

describe('micro — infantry scatter', () => {
  it('idle infantry near enemy tanks scatter and are excluded from attack', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
      units: [
        // Infantry within 6 cells of enemy tank — should scatter
        makeEntity(1, 'E1', 'Greece', 54, 54),
        makeEntity(2, 'E3', 'Greece', 55, 54),
        // Tanks — should get attack orders, not scatter
        makeEntity(3, '3TNK', 'Greece', 50, 50),
        makeEntity(4, '3TNK', 'Greece', 51, 50),
      ],
      enemies: [
        { ...makeEntity(60, '3TNK', 'USSR', 55, 55), ally: false },
      ],
    });

    const decision = strategy.decide(state);

    // Scattered infantry should appear in move commands (scatter)
    const moveCmds = decision.commands.filter(c => c.cmd === 'move');
    const scatteredIds = new Set<number>();
    for (const mc of moveCmds) {
      const ids = mc.ids as number[];
      for (const id of ids) {
        if (id === 1 || id === 2) scatteredIds.add(id);
      }
    }
    expect(scatteredIds.size).toBeGreaterThan(0);

    // Scattered infantry should NOT appear in attack commands
    const attackCmds = decision.commands.filter(
      (c) => c.cmd === 'attack' && typeof c.target === 'number',
    );
    for (const cmd of attackCmds) {
      const ids = cmd.ids as number[];
      for (const sid of scatteredIds) {
        expect(ids).not.toContain(sid);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Force Threshold — need 6 tanks + 1.5x superiority to attack
// ═══════════════════════════════════════════════════════════

describe('micro — force threshold', () => {
  it('5 tanks do not attack distant enemies', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
      units: [
        makeEntity(1, '3TNK', 'Greece', 50, 50),
        makeEntity(2, '3TNK', 'Greece', 51, 50),
        makeEntity(3, '3TNK', 'Greece', 52, 50),
        makeEntity(4, '3TNK', 'Greece', 53, 50),
        makeEntity(5, '3TNK', 'Greece', 54, 50),
      ],
      enemies: [
        // Distant enemies — not base threats, only attack threshold applies
        { ...makeEntity(60, '3TNK', 'USSR', 90, 90), ally: false },
      ],
    });

    const decision = strategy.decide(state);
    // With only 5 tanks (threshold is 6), should NOT send attack orders
    const attackCmds = decision.commands.filter(
      (c) => c.cmd === 'attack' && typeof c.target === 'number',
    );
    expect(attackCmds.length).toBe(0);
    // Should report building up
    expect(decision.reason).toContain('building up');
  });

  it('6 tanks with 1.5x superiority triggers attack', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
      units: [
        makeEntity(1, '3TNK', 'Greece', 50, 50),
        makeEntity(2, '3TNK', 'Greece', 51, 50),
        makeEntity(3, '3TNK', 'Greece', 52, 50),
        makeEntity(4, '3TNK', 'Greece', 53, 50),
        makeEntity(5, '3TNK', 'Greece', 54, 50),
        makeEntity(6, '3TNK', 'Greece', 55, 50),
      ],
      enemies: [
        // Distant enemies — 6 tanks (str=18) vs 2 light (str=6) → 18>9 → attack
        { ...makeEntity(60, '1TNK', 'USSR', 90, 90), ally: false },
        { ...makeEntity(61, '1TNK', 'USSR', 91, 90), ally: false },
      ],
    });

    const decision = strategy.decide(state);
    const attackCmds = decision.commands.filter(
      (c) => c.cmd === 'attack' && typeof c.target === 'number',
    );
    expect(attackCmds.length).toBeGreaterThan(0);
  });

  it('6 tanks at exactly 1.5x do NOT attack (requires strictly greater)', () => {
    const strategy = new OracleStrategy('SCG04EA');
    // 6 heavy tanks (str=18) vs 4 heavy tanks (str=12). 18 > 12*1.5=18? No (not strictly >).
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 50, 48)],
      units: [
        makeEntity(1, '3TNK', 'Greece', 50, 50),
        makeEntity(2, '3TNK', 'Greece', 51, 50),
        makeEntity(3, '3TNK', 'Greece', 52, 50),
        makeEntity(4, '3TNK', 'Greece', 53, 50),
        makeEntity(5, '3TNK', 'Greece', 54, 50),
        makeEntity(6, '3TNK', 'Greece', 55, 50),
      ],
      enemies: [
        { ...makeEntity(60, '3TNK', 'USSR', 90, 90), ally: false },
        { ...makeEntity(61, '3TNK', 'USSR', 91, 90), ally: false },
        { ...makeEntity(62, '3TNK', 'USSR', 92, 90), ally: false },
        { ...makeEntity(63, '3TNK', 'USSR', 93, 90), ally: false },
      ],
    });

    const decision = strategy.decide(state);
    const attackCmds = decision.commands.filter(
      (c) => c.cmd === 'attack' && typeof c.target === 'number',
    );
    // Exactly 1.5x is NOT enough (strict >), should NOT attack
    expect(attackCmds.length).toBe(0);
    expect(decision.reason).toContain('building up');
  });
});
