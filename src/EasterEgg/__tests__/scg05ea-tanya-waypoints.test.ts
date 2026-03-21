import { describe, it, expect } from 'vitest';
import { OracleStrategy } from '../oracle/OracleStrategy.js';
import type { RAGameState, RAEntity, RAStructure } from '../oracle/WasmAdapter.js';

function makeEntity(
  id: number,
  t: string,
  house: string,
  cx: number,
  cy: number,
  ally = true,
): RAEntity {
  return { id, t, house, cx, cy, hp: 256, mhp: 256, m: 0, ally };
}

function makeStructure(
  id: number,
  t: string,
  house: string,
  cx: number,
  cy: number,
  ally = true,
): RAStructure {
  return { id, t, house, cx, cy, hp: 256, mhp: 256, m: 0, ally, repairing: false };
}

function makeState(overrides: Partial<RAGameState> = {}): RAGameState {
  return {
    tick: 500,
    credits: 5000,
    playerHouse: 'Greece',
    alliedHouses: ['Greece'],
    globals: [18],
    missionTimer: 0,
    missionTimerActive: false,
    civEvacuated: false,
    winPending: false,
    losePending: false,
    power: { produced: 300, consumed: 120 },
    units: [],
    enemies: [],
    structures: [],
    production: [],
    buildable: { structures: [], units: [], infantry: [], vessels: [] },
    ...overrides,
  };
}

/**
 * Build a state with Tanya at a given position and a SAM target.
 * Default: west SAM at (17,94), requiring the north-through-corridor route.
 */
function tanyaSamState(
  tanyCx: number,
  tanyCy: number,
  samId = 900,
  samCx = 17,
  samCy = 94,
): RAGameState {
  return makeState({
    units: [makeEntity(10, 'E7', 'Greece', tanyCx, tanyCy)],
    structures: [makeStructure(samId, 'SAM', 'USSR', samCx, samCy, false)],
  });
}

// Corridor waypoints from the production code (single route for all north SAMs)
const CORRIDOR_WAYPOINTS = [
  { cx: 24, cy: 104 },
  { cx: 24, cy: 103 },
  { cx: 24, cy: 102 },
  { cx: 24, cy: 101 },
  { cx: 24, cy: 100 },
  { cx: 23, cy: 99 },
  { cx: 22, cy: 98 },
  { cx: 21, cy: 97 },
];

describe('SCG05EA Tanya waypoint navigation', () => {
  it('sends Tanya to the first waypoint on initial call', () => {
    const strategy = new OracleStrategy('SCG05EA');
    (strategy as any).scg05eaSpyInfiltrated = true;

    // Tanya starts at spawn (22,105), far from all waypoints and SAM
    const d = strategy.decide(tanyaSamState(22, 105));
    expect(d.commands.length).toBeGreaterThan(0);
    const move = d.commands[0] as { cx: number; cy: number };
    // Should target wp0 (24,104)
    expect(move.cx).toBe(24);
    expect(move.cy).toBe(104);
    expect((strategy as any).scg05eaTanyaWpIdx).toBe(0);
  });

  it('advances waypoint index when Tanya arrives at current waypoint', () => {
    const strategy = new OracleStrategy('SCG05EA');
    (strategy as any).scg05eaSpyInfiltrated = true;

    // First call: send to wp0
    strategy.decide(tanyaSamState(22, 105));
    expect((strategy as any).scg05eaTanyaWpIdx).toBe(0);

    // Tanya arrives at wp0 (24,104) — index should advance
    strategy.decide(tanyaSamState(24, 104));
    expect((strategy as any).scg05eaTanyaWpIdx).toBeGreaterThanOrEqual(1);

    // The move target should be wp1 (24,103), not back to wp0
    const d = strategy.decide(tanyaSamState(24, 104));
    const move = d.commands[0] as { cx: number; cy: number };
    expect(move.cy).toBeLessThan(104);
  });

  it('never sends Tanya backward to already-passed waypoints', () => {
    const strategy = new OracleStrategy('SCG05EA');
    (strategy as any).scg05eaSpyInfiltrated = true;

    // Walk Tanya through the first 5 waypoints step by step
    const positions = [
      { cx: 22, cy: 105 }, // start
      { cx: 24, cy: 104 }, // arrive at wp0
      { cx: 24, cy: 103 }, // arrive at wp1
      { cx: 24, cy: 102 }, // arrive at wp2
      { cx: 24, cy: 101 }, // arrive at wp3
      { cx: 24, cy: 100 }, // arrive at wp4
    ];

    let lastCy = Infinity;
    for (const pos of positions) {
      const d = strategy.decide(tanyaSamState(pos.cx, pos.cy));
      if (d.commands.length > 0) {
        const move = d.commands[0] as { cx: number; cy: number };
        // Move target should never go south (cy should not increase)
        expect(move.cy, `at (${pos.cx},${pos.cy}): target cy=${move.cy} went south of previous ${lastCy}`).toBeLessThanOrEqual(lastCy);
        lastCy = move.cy;
      }
    }

    // After arriving at wp4, index should be >= 5
    expect((strategy as any).scg05eaTanyaWpIdx).toBeGreaterThanOrEqual(5);
  });

  it('shoots SAM from corridor endpoint when in range', () => {
    const strategy = new OracleStrategy('SCG05EA');
    (strategy as any).scg05eaSpyInfiltrated = true;

    // Walk Tanya through ALL corridor waypoints sequentially
    const allPositions = [
      { cx: 22, cy: 105 }, // start
      ...CORRIDOR_WAYPOINTS,
    ];

    for (const pos of allPositions) {
      strategy.decide(tanyaSamState(pos.cx, pos.cy, 900, 17, 94));
    }

    // SAM comes into shoot range before all waypoints are exhausted.
    // From wp6 (22,98), SAM(17,94) is distSq=41 ≤ 64 → shoot_struct triggers.
    const d = strategy.decide(tanyaSamState(22, 98, 900, 17, 94));
    expect(d.reason).toContain('SHOOT SAM');
  });

  it('resets waypoint index when SAM target changes', () => {
    const strategy = new OracleStrategy('SCG05EA');
    (strategy as any).scg05eaSpyInfiltrated = true;

    // Walk through first two waypoints targeting SAM id=900
    strategy.decide(tanyaSamState(22, 105, 900, 10, 85));
    strategy.decide(tanyaSamState(24, 104, 900, 10, 85));
    const idxAfterWp0 = (strategy as any).scg05eaTanyaWpIdx;
    expect(idxAfterWp0).toBeGreaterThanOrEqual(1);
    expect((strategy as any).scg05eaTanyaLastSamId).toBe(900);

    // Now target a DIFFERENT SAM (id=901) — index must reset
    strategy.decide(tanyaSamState(24, 104, 901, 10, 85));
    expect((strategy as any).scg05eaTanyaLastSamId).toBe(901);
    // Index resets to 0, then re-advances past wp0 (we're at 24,104 which is wp0)
    // so it ends up at 1 again
    expect((strategy as any).scg05eaTanyaWpIdx).toBeGreaterThanOrEqual(1);
  });

  it('progresses monotonically through the full west corridor', () => {
    const strategy = new OracleStrategy('SCG05EA');
    (strategy as any).scg05eaSpyInfiltrated = true;

    // Simulate stepping Tanya through the west corridor start to finish.
    // Start from spawn, then visit each waypoint.
    const positions = [
      { cx: 22, cy: 105 }, // start
      ...CORRIDOR_WAYPOINTS,
    ];

    const targets: Array<{ cx: number; cy: number }> = [];

    for (const pos of positions) {
      const d = strategy.decide(tanyaSamState(pos.cx, pos.cy));
      if (d.commands.length > 0) {
        const move = d.commands[0] as { cx: number; cy: number };
        if (move.cx !== undefined && move.cy !== undefined) {
          targets.push({ cx: move.cx, cy: move.cy });
        }
      }
    }

    // Verify monotonic northward progress: cy should never increase
    for (let i = 1; i < targets.length; i++) {
      const prev = targets[i - 1];
      const curr = targets[i];
      expect(
        curr.cy,
        `step ${i}: target cy went south (${prev.cy} -> ${curr.cy})`
      ).toBeLessThanOrEqual(prev.cy);
    }
  });

  it('uses single corridor route for all north SAMs', () => {
    // Both north SAMs use the same corridor waypoints starting at (24,104)
    const strategy1 = new OracleStrategy('SCG05EA');
    (strategy1 as any).scg05eaSpyInfiltrated = true;
    const dWest = strategy1.decide(tanyaSamState(22, 105, 900, 17, 94));
    const moveWest = dWest.commands[0] as { cx: number; cy: number };
    expect(moveWest.cx).toBe(24);
    expect(moveWest.cy).toBe(104);

    const strategy2 = new OracleStrategy('SCG05EA');
    (strategy2 as any).scg05eaSpyInfiltrated = true;
    const dEast = strategy2.decide(tanyaSamState(22, 105, 901, 28, 94));
    const moveEast = dEast.commands[0] as { cx: number; cy: number };
    // Same corridor route for both north SAMs
    expect(moveEast.cx).toBe(24);
    expect(moveEast.cy).toBe(104);
  });
});
