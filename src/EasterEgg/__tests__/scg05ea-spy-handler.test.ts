import { describe, it, expect } from 'vitest';
import { OracleStrategy } from '../oracle/OracleStrategy.js';
import type { RAGameState, RAEntity, RAStructure } from '../oracle/WasmAdapter.js';

/**
 * SCG05EA "Paradox Equation" — spy infiltration + Tanya SAM destruction.
 *
 * Tests the custom handler phases: spy route, dog avoidance, WEAP infiltration,
 * Tanya SAM destruction, chinook evacuation, and fallthrough to generic.
 */

function makeEntity(
  id: number, t: string, house: string,
  cx: number, cy: number,
  hp = 100, mhp = 100, m = 5,
): RAEntity {
  return { id, t, house, cx, cy, hp, mhp, m, ally: house === 'Greece' || house === 'England' };
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
    credits: 13000,
    playerHouse: 'Greece',
    alliedHouses: ['Greece', 'England'],
    globals: [],
    missionTimer: 0,
    missionTimerActive: false,
    civEvacuated: false,
    winPending: false,
    losePending: false,
    power: { produced: 0, consumed: 0 },
    units: [],
    enemies: [],
    structures: [],
    production: [],
    buildable: { structures: [], units: [], infantry: [] },
    ...overrides,
  };
}

// BadGuy WEAP at (43, 50) — spy target
const TARGET_WEAP = makeStructure(8, 'WEAP', 'BadGuy', 43, 50, false);

// Dogs in the mission area
function staticDogs(): RAEntity[] {
  return [
    { ...makeEntity(100, 'DOG', 'BadGuy', 50, 52), ally: false },
    { ...makeEntity(101, 'DOG', 'BadGuy', 49, 52), ally: false },
    { ...makeEntity(102, 'DOG', 'USSR', 24, 54), ally: false },
    { ...makeEntity(103, 'USSR', 'DOG', 23, 55), ally: false },
  ].map((e) => ({ ...e, t: 'DOG', ally: false }));
}

describe('SCG05EA — spy infiltration phase', () => {
  it('spy uses waypoint route from peninsula (no LST boarding)', () => {
    const strategy = new OracleStrategy('SCG05EA');
    strategy['scg05eaSpyStopped'] = true; // past initial STOP phase
    const state = makeState({
      tick: 300,
      units: [
        makeEntity(1, 'SPY', 'Greece', 16, 50), // on peninsula
        makeEntity(2, 'LST', 'Greece', 15, 49), // LST nearby
      ],
      enemies: staticDogs(),
      structures: [TARGET_WEAP],
    });

    const decision = strategy.decide(state);
    console.log('Spy route:', decision.reason);
    // Spy uses waypoint route — moves toward first waypoint
    expect(decision.reason).toMatch(/spy wp\d|spy →/);
  });

  it('spy advances along safe route waypoints', () => {
    const strategy = new OracleStrategy('SCG05EA');
    // Simulate: spy already at first waypoint
    const state1 = makeState({
      tick: 400,
      units: [makeEntity(1, 'SPY', 'Greece', 16, 46)],
      enemies: staticDogs(),
      structures: [TARGET_WEAP],
    });
    strategy.decide(state1); // arrives at wp0, advances to wp1

    const state2 = makeState({
      tick: 500,
      units: [makeEntity(1, 'SPY', 'Greece', 16, 46)], // idle at wp0
      enemies: staticDogs(),
      structures: [TARGET_WEAP],
    });
    const decision = strategy.decide(state2);
    console.log('Spy advance:', decision.reason);
    // Should be heading to a waypoint — format is "spy wp{N} → (x,y)"
    expect(decision.reason).toMatch(/spy wp\d/);
  });

  it('spy continues waypoint route even with nearby dogs (no evasion — sprint strategy)', () => {
    const strategy = new OracleStrategy('SCG05EA');
    // Simulate spy already landed near base, past initial STOP
    strategy['scg05eaSpyLanded'] = true;
    strategy['scg05eaSpyStopped'] = true;
    const state = makeState({
      tick: 500,
      units: [makeEntity(1, 'SPY', 'Greece', 38, 52, 25, 25, 3)], // moving (m=3)
      enemies: [
        { ...makeEntity(100, 'DOG', 'BadGuy', 40, 53), ally: false }, // 3 cells away
      ],
      structures: [TARGET_WEAP],
    });

    const decision = strategy.decide(state);
    console.log('Spy with nearby dog:', decision.reason);
    // Spy sprints — no evasion, continues toward WEAP
    expect(decision.reason).toMatch(/spy|WEAP/);
  });

  it('spy infiltrates WEAP when close and no dogs nearby', () => {
    const strategy = new OracleStrategy('SCG05EA');
    // Advance spy route index to completion
    for (let i = 0; i < 5; i++) {
      strategy.decide(makeState({
        tick: 300 + i * 100,
        units: [makeEntity(1, 'SPY', 'Greece', 16 + i * 7, 46)],
        enemies: [],
        structures: [TARGET_WEAP],
      }));
    }

    const state = makeState({
      tick: 900,
      units: [makeEntity(1, 'SPY', 'Greece', 42, 47)], // near WEAP, idle
      enemies: [], // no dogs nearby
      structures: [TARGET_WEAP],
    });

    const decision = strategy.decide(state);
    console.log('Spy infiltrate:', decision.reason);
    expect(decision.reason).toContain('infiltrate WEAP');
    const attackCmds = decision.commands.filter((c) => c.cmd === 'attack' && typeof c.target === 'number');
    expect(attackCmds.length).toBe(1);
    expect(attackCmds[0].target).toBe(8);
  });
});

describe('SCG05EA — Tanya SAM destruction phase', () => {
  it('Tanya attacks nearest SAM directly (she spawns at 25,107 near SAMs)', () => {
    const strategy = new OracleStrategy('SCG05EA');
    // Simulate spy already infiltrated
    strategy.decide(makeState({
      tick: 100,
      globals: [1],
    }));

    // Tanya spawns near SAMs via reinforcement at (25, 107), team-moves to (23, 105)
    const state = makeState({
      tick: 1000,
      globals: [1],
      units: [makeEntity(2, 'E7', 'Greece', 23, 105)], // Tanya at team destination
      enemies: [],
      structures: [
        makeStructure(53, 'SAM', 'USSR', 28, 107, false), // nearest (3 cells)
        makeStructure(52, 'SAM', 'USSR', 16, 107, false),
        makeStructure(51, 'SAM', 'USSR', 28, 94, false),
        makeStructure(50, 'SAM', 'USSR', 17, 94, false),
      ],
    });

    const decision = strategy.decide(state);
    console.log('Tanya SAM attack:', decision.reason);
    // Should directly attack nearest SAM — no route needed
    expect(decision.reason).toMatch(/SAM 1\/4/);
    const attackCmds = decision.commands.filter((c) => c.cmd === 'attack' && typeof c.target === 'number');
    expect(attackCmds.length).toBe(1);
    expect(attackCmds[0].target).toBe(53); // nearest SAM at (28, 107)
  });

  it('advances to next SAM when current one is destroyed', () => {
    const strategy = new OracleStrategy('SCG05EA');
    strategy.decide(makeState({ tick: 100, globals: [1] }));

    // First SAM destroyed, only 3 remain
    const state = makeState({
      tick: 2000,
      globals: [1],
      units: [makeEntity(2, 'E7', 'Greece', 28, 107)],
      enemies: [],
      structures: [
        // SAM at (28,107) is gone — first target destroyed
        makeStructure(52, 'SAM', 'USSR', 16, 107, false), // next target
        makeStructure(51, 'SAM', 'USSR', 28, 94, false),
        makeStructure(50, 'SAM', 'USSR', 17, 94, false),
      ],
    });

    const decision = strategy.decide(state);
    console.log('SAM advance:', decision.reason);
    // Should advance past destroyed SAM and target next one
    expect(decision.reason).toMatch(/SAM.*advancing|SAM 2/);
  });

  it('Tanya evades dogs near SAM area', () => {
    const strategy = new OracleStrategy('SCG05EA');
    strategy.decide(makeState({ tick: 100, globals: [1] }));

    const state = makeState({
      tick: 2000,
      globals: [1],
      units: [makeEntity(2, 'E7', 'Greece', 20, 95)],
      enemies: [
        { ...makeEntity(200, 'DOG', 'USSR', 22, 96), ally: false }, // 3 cells away
      ],
      structures: [makeStructure(50, 'SAM', 'USSR', 17, 94, false)],
    });

    const decision = strategy.decide(state);
    console.log('Tanya evade:', decision.reason);
    expect(decision.reason).toContain('evade dog');
  });
});

describe('SCG05EA — chinook evacuation phase', () => {
  it('Tanya boards chinook after all SAMs destroyed', () => {
    const strategy = new OracleStrategy('SCG05EA');
    // Set up spy infiltrated
    strategy.decide(makeState({ tick: 100, globals: [1] }));

    // Advance SAM index by presenting states with no SAM structures
    for (let i = 0; i < 5; i++) {
      strategy.decide(makeState({
        tick: 2000 + i * 100,
        globals: [1],
        units: [makeEntity(2, 'E7', 'Greece', 20, 94)],
        enemies: [],
        structures: [], // no SAMs left
      }));
    }

    const state = makeState({
      tick: 6000,
      globals: [1],
      units: [
        makeEntity(2, 'E7', 'Greece', 20, 94),
        makeEntity(3, 'TRAN', 'Greece', 18, 92),
      ],
      enemies: [],
      structures: [],
    });

    const decision = strategy.decide(state);
    console.log('Board chinook:', decision.reason);
    expect(decision.reason).toContain('board chinook');
    const enterCmds = decision.commands.filter((c) => c.cmd === 'enter');
    expect(enterCmds.length).toBe(1);
  });
});

describe('SCG05EA — generic fallthrough', () => {
  it('falls through to generic handler after spy infiltrated and no Tanya/chinook', () => {
    const strategy = new OracleStrategy('SCG05EA');
    strategy['scg05eaSpyInfiltrated'] = true;
    strategy.decide(makeState({ tick: 100, globals: [1] }));

    const state = makeState({
      tick: 8000,
      globals: [1],
      credits: 5000,
      units: [
        makeEntity(10, '1TNK', 'Greece', 30, 60),
        makeEntity(11, '1TNK', 'Greece', 31, 60),
      ],
      enemies: [
        { ...makeEntity(300, '3TNK', 'USSR', 60, 60), ally: false },
      ],
      structures: [
        makeStructure(100, 'FACT', 'Greece', 25, 55),
      ],
      buildable: { structures: ['POWR', 'PROC'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    console.log('Generic fallthrough:', decision.reason);
    // Should be doing base building stuff, not spy/Tanya logic
    expect(decision.reason).not.toContain('spy');
    expect(decision.reason).not.toContain('Tanya');
  });
});
