import { describe, it, expect } from 'vitest';
import { OracleStrategy } from '../oracle/OracleStrategy.js';
import type { RAGameState, RAEntity, RAStructure, RABuildable } from '../oracle/WasmAdapter.js';

/**
 * Base-Building Oracle Tests — verify the OracleStrategy's base-building
 * decision pipeline using pure data fixtures (no WASM or browser needed).
 *
 * Tests the new produce/place/buildable functionality added for the
 * base-building strategy.
 */

// RTTIType constants matching C++ defines.h
const RTTI_BUILDINGTYPE = 6;
const RTTI_UNITTYPE = 29;
const RTTI_INFANTRYTYPE = 14;

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
    power: { produced: 0, consumed: 0 },
    units: [],
    enemies: [],
    structures: [],
    production: [],
    buildable: { structures: [], units: [], infantry: [] },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// MCV Detection & Deployment
// ═══════════════════════════════════════════════════════════

describe('base building — MCV deployment', () => {
  it('sends deploy command when idle MCV present and no ConYard', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      units: [makeEntity(1, 'MCV', 'Greece', 50, 50)],
    });

    const decision = strategy.decide(state);
    const deployCmd = decision.commands.find((c) => c.cmd === 'deploy');
    expect(deployCmd).toBeDefined();
    expect(deployCmd!.ids).toEqual([1]);
    expect(decision.reason).toContain('deploy MCV');
  });

  it('does not re-send deploy when MCV is not idle (already deploying)', () => {
    const strategy = new OracleStrategy('SCG04EA');
    // m=12 is MISSION_UNLOAD (deploying)
    const state = makeState({
      units: [makeEntity(1, 'MCV', 'Greece', 50, 50, 100, 100, 12)],
    });

    const decision = strategy.decide(state);
    const deployCmd = decision.commands.find((c) => c.cmd === 'deploy');
    expect(deployCmd).toBeUndefined();
    expect(decision.reason).toContain('MCV deploying');
  });
});

// ═══════════════════════════════════════════════════════════
// Build Order — Structure Production
// ═══════════════════════════════════════════════════════════

describe('base building — build order', () => {
  it('produces POWR first when ConYard exists and nothing in production', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 89, 52)],
      power: { produced: 0, consumed: 0 },
      buildable: { structures: ['POWR', 'SBAG'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const prodCmd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(prodCmd).toBeDefined();
    expect(prodCmd!.type_id).toBe(17); // STRUCT_POWER
    expect(decision.reason).toContain('produce POWR');
  });

  it('produces PROC when POWR already exists (refinery before barracks)', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [
        makeStructure(100, 'FACT', 'Greece', 89, 52),
        makeStructure(101, 'POWR', 'Greece', 86, 52),
      ],
      power: { produced: 100, consumed: 0 },
      buildable: { structures: ['PROC', 'POWR', 'TENT', 'SBAG'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const prodCmd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(prodCmd).toBeDefined();
    expect(prodCmd!.type_id).toBe(12); // STRUCT_REFINERY
    expect(decision.reason).toContain('produce PROC');
  });

  it('produces BARR after POWR and PROC exist (Soviet barracks preferred)', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [
        makeStructure(100, 'FACT', 'Greece', 89, 52),
        makeStructure(101, 'POWR', 'Greece', 86, 52),
        makeStructure(102, 'PROC', 'Greece', 92, 52),
      ],
      power: { produced: 100, consumed: 40 },
      buildable: { structures: ['BARR', 'SBAG'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const prodCmd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(prodCmd).toBeDefined();
    expect(prodCmd!.type_id).toBe(21); // STRUCT_BARRACKS
    expect(decision.reason).toContain('produce BARR');
  });

  it('places completed building near ConYard', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 89, 52)],
      power: { produced: 0, consumed: 0 },
      production: [{ t: 'POWR', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['POWR'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const placeCmd = decision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(placeCmd).toBeDefined();
    expect(typeof placeCmd!.cx).toBe('number');
    expect(typeof placeCmd!.cy).toBe('number');
    expect(decision.reason).toContain('place POWR');
  });

  it('does not produce when something is already building', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 89, 52)],
      power: { produced: 0, consumed: 0 },
      production: [{ t: 'POWR', prog: 25, rtti: RTTI_BUILDINGTYPE, done: false }],
      buildable: { structures: ['POWR', 'TENT'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const prodCmd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(prodCmd).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════
// Unit & Infantry Production
// ═══════════════════════════════════════════════════════════

describe('base building — unit production', () => {
  it('produces tanks when War Factory exists and credits sufficient', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      credits: 2000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 89, 52),
        makeStructure(101, 'POWR', 'Greece', 86, 52),
        makeStructure(102, 'TENT', 'Greece', 89, 55),
        makeStructure(103, 'PROC', 'Greece', 92, 52),
        makeStructure(104, 'WEAP', 'Greece', 86, 55),
      ],
      units: [
        makeEntity(10, 'HARV', 'Greece', 90, 55),
        makeEntity(11, 'HARV', 'Greece', 91, 55),
      ],
      power: { produced: 100, consumed: 60 },
      buildable: {
        structures: ['POWR'],
        units: ['3TNK', '2TNK', '1TNK', 'HARV'],
        infantry: ['E1', 'E3'],
      },
    });

    const decision = strategy.decide(state);
    const unitProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_UNITTYPE,
    );
    expect(unitProd).toBeDefined();
    // Should prefer 3TNK (Heavy/Mammoth tank) over lighter options
    expect(unitProd!.type_id).toBe(1); // UNIT_MTANK = 3TNK
    expect(decision.reason).toContain('produce 3TNK');
  });

  it('produces infantry when Barracks exists', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      credits: 2000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 89, 52),
        makeStructure(101, 'POWR', 'Greece', 86, 52),
        makeStructure(102, 'TENT', 'Greece', 89, 55),
        makeStructure(103, 'PROC', 'Greece', 92, 52),
        makeStructure(104, 'WEAP', 'Greece', 86, 55),
      ],
      power: { produced: 100, consumed: 60 },
      buildable: {
        structures: ['POWR'],
        units: ['1TNK'],
        infantry: ['E1', 'E3'],
      },
    });

    const decision = strategy.decide(state);
    const infProd = decision.commands.find(
      (c) => c.cmd === 'produce' && c.rtti === RTTI_INFANTRYTYPE,
    );
    expect(infProd).toBeDefined();
    // Should prefer E3 (rocket) over E1 (rifle)
    expect(infProd!.type_id).toBe(2); // INFANTRY_E3
    expect(decision.reason).toContain('produce E3');
  });

  it('exits completed units with place command (no cx/cy)', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      credits: 2000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 89, 52),
        makeStructure(101, 'WEAP', 'Greece', 86, 55),
      ],
      power: { produced: 100, consumed: 30 },
      production: [
        { t: '3TNK', prog: 100, rtti: RTTI_UNITTYPE, done: true },
      ],
      buildable: { structures: [], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const placeCmd = decision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_UNITTYPE,
    );
    expect(placeCmd).toBeDefined();
    // Units exit via Place_Object with cell=-1, so no cx/cy needed
    expect(placeCmd!.cx).toBeUndefined();
    expect(decision.reason).toContain('exit 3TNK');
  });
});

// ═══════════════════════════════════════════════════════════
// Combat Splitting
// ═══════════════════════════════════════════════════════════

describe('base building — combat', () => {
  it('keeps defenders near base when threats present', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [
        makeStructure(100, 'FACT', 'Greece', 89, 52),
        makeStructure(101, 'POWR', 'Greece', 86, 52),
        makeStructure(102, 'TENT', 'Greece', 89, 55),
        makeStructure(103, 'PROC', 'Greece', 92, 52),
        makeStructure(104, 'WEAP', 'Greece', 86, 55),
      ],
      units: [
        makeEntity(1, 'E3', 'Greece', 88, 53),
        makeEntity(2, 'E3', 'Greece', 90, 53),
        makeEntity(3, 'E3', 'Greece', 87, 54),
        makeEntity(4, '3TNK', 'Greece', 85, 50),
        makeEntity(5, '3TNK', 'Greece', 86, 50),
      ],
      enemies: [
        { ...makeEntity(50, 'E2', 'USSR', 85, 50), ally: false },
      ],
      power: { produced: 100, consumed: 60 },
      buildable: { structures: [], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    // Should have defender commands (attack with target via micro-management) for some units
    const defenderCmd = decision.commands.find(
      (c) => c.cmd === 'attack' || c.cmd === 'attack_move',
    );
    expect(defenderCmd).toBeDefined();
    expect(decision.reason).toContain('defend base');
  });

  it('filters non-combat units from attack orders', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      structures: [makeStructure(100, 'FACT', 'Greece', 89, 52)],
      units: [
        makeEntity(1, 'HARV', 'Greece', 88, 53),
        makeEntity(2, 'MCV', 'Greece', 90, 53),
      ],
      enemies: [
        { ...makeEntity(50, 'E2', 'USSR', 85, 50), ally: false },
      ],
      power: { produced: 100, consumed: 0 },
      buildable: { structures: [], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    // HARV and MCV should not appear in any attack_move command IDs
    const attackCmds = decision.commands.filter(
      (c) => c.cmd === 'attack_move' || c.cmd === 'attack',
    );
    for (const cmd of attackCmds) {
      const ids = cmd.ids as number[] | undefined;
      if (ids) {
        expect(ids).not.toContain(1); // HARV
        expect(ids).not.toContain(2); // MCV
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Generic fallback — no MCV/ConYard
// ═══════════════════════════════════════════════════════════

describe('base building — fallback to generic', () => {
  it('falls back to generic combat when no MCV and no ConYard', () => {
    const strategy = new OracleStrategy('SCG04EA');
    // Give friendly units clear force advantage (1.5x) so they attack
    // tick > 1500 to bypass early-game holding pattern
    const state = makeState({
      tick: 2000,
      units: [
        makeEntity(1, 'E1', 'Greece', 50, 50),
        makeEntity(2, 'E1', 'Greece', 51, 50),
        makeEntity(3, 'E1', 'Greece', 52, 50),
      ],
      enemies: [
        { ...makeEntity(50, 'E2', 'USSR', 55, 55), ally: false },
      ],
    });

    const decision = strategy.decide(state);
    // With micro-management, attack commands use 'attack' (with target) instead of 'attack_move'
    const attackCmd = decision.commands.find(
      (c) => c.cmd === 'attack' || c.cmd === 'attack_move',
    );
    expect(attackCmd).toBeDefined();
    expect(decision.reason).toContain('attack');
  });
});

// ═══════════════════════════════════════════════════════════
// Summarize includes production info
// ═══════════════════════════════════════════════════════════

describe('summarize', () => {
  it('includes production items in summary', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      production: [
        { t: 'POWR', prog: 42, rtti: RTTI_BUILDINGTYPE, done: false },
        { t: 'E3', prog: 80, rtti: RTTI_INFANTRYTYPE, done: false },
      ],
    });

    const summary = strategy.summarize(state, 10, { commands: [], reason: 'test' });
    expect(summary).toContain('POWR:42%');
    expect(summary).toContain('E3:80%');
  });

  it('marks completed production with asterisk', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      production: [
        { t: 'TENT', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true },
      ],
    });

    const summary = strategy.summarize(state, 5, { commands: [], reason: 'test' });
    expect(summary).toContain('TENT:54%*');
  });
});

// ═══════════════════════════════════════════════════════════
// SYRD Placement — uses enemy vessels to find water
// ═══════════════════════════════════════════════════════════

describe('SYRD placement — vessel-based water detection', () => {
  it('places SYRD near enemy submarine positions using coastal cells', () => {
    // Use SCG07EA which has no mission-specific handler — it routes through
    // the generic decideBaseBuilding path with coastal cells at cx=52,50,54.
    const strategy = new OracleStrategy('SCG07EA');
    // Subs are on the EAST side of the map at x=67-72
    const state = makeState({
      tick: 8000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 26, 50),
        makeStructure(101, 'POWR', 'Greece', 24, 50),
      ],
      production: [{ t: 'SYRD', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['SYRD'], units: [], infantry: [] },
      enemies: [
        makeEntity(200, 'SS', 'USSR', 67, 42, 100, 100, 5),
        makeEntity(201, 'SS', 'USSR', 72, 97, 100, 100, 5),
        makeEntity(202, 'SS', 'USSR', 68, 31, 100, 100, 5),
      ],
    });
    // Mark enemies as non-ally
    state.enemies.forEach((e) => { e.ally = false; });

    const decision = strategy.decide(state);
    const placeCmd = decision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(placeCmd).toBeDefined();
    // SCG07EA coastal cells are around cx=48-56, cy=47-60 — well east of base (x=26)
    expect(placeCmd!.cx).toBeGreaterThan(35);
  });

  it('dispatches water scout when naval enemies detected', () => {
    // Use SCG07EA — generic path dispatches tank as water scout
    const strategy = new OracleStrategy('SCG07EA');
    const state = makeState({
      tick: 500,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 26, 50),
        makeStructure(101, 'POWR', 'Greece', 24, 50),
        makeStructure(102, 'WEAP', 'Greece', 28, 50),
      ],
      units: [
        makeEntity(10, '2TNK', 'Greece', 27, 49),
      ],
      enemies: [
        makeEntity(200, 'SS', 'USSR', 67, 42, 100, 100, 5),
      ],
      buildable: { structures: [], units: ['2TNK'], infantry: [] },
    });
    state.enemies.forEach((e) => { e.ally = false; });

    const decision = strategy.decide(state);
    const moveCmd = decision.commands.find(
      (c) => c.cmd === 'move' && c.ids?.includes(10),
    );
    // Should send the tank to scout toward the water (east, toward subs)
    expect(moveCmd).toBeDefined();
    expect(moveCmd!.cx).toBeGreaterThan(40); // heading east toward water
  });

  it('re-dispatches scout if original scout is destroyed', () => {
    // Use SCG07EA — generic path handles scout re-dispatch
    const strategy = new OracleStrategy('SCG07EA');
    const sub = makeEntity(200, 'SS', 'USSR', 67, 42, 100, 100, 5);
    sub.ally = false;

    // First call: scout dispatched (tank id=10)
    const state1 = makeState({
      tick: 500,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 26, 50),
        makeStructure(101, 'WEAP', 'Greece', 28, 50),
      ],
      units: [makeEntity(10, '2TNK', 'Greece', 27, 49)],
      enemies: [sub],
      buildable: { structures: [], units: ['2TNK'], infantry: [] },
    });
    strategy.decide(state1);

    // Second call: scout tank destroyed (id=10 gone), new tank available (id=11)
    const state2 = makeState({
      tick: 1000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 26, 50),
        makeStructure(101, 'WEAP', 'Greece', 28, 50),
      ],
      units: [makeEntity(11, '2TNK', 'Greece', 27, 49)],
      enemies: [sub],
      buildable: { structures: [], units: ['2TNK'], infantry: [] },
    });
    const decision2 = strategy.decide(state2);
    const moveCmd = decision2.commands.find(
      (c) => c.cmd === 'move' && c.ids?.includes(11),
    );
    expect(moveCmd).toBeDefined();
    expect(moveCmd!.cx).toBeGreaterThan(40);
  });

  it('falls back to hardcoded coastal cells when no enemy vessels present', () => {
    // Use SCG07EA — coastal cells are at cx=52,50,54 (east of base)
    const strategy = new OracleStrategy('SCG07EA');
    const state = makeState({
      tick: 8000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 26, 50),
      ],
      production: [{ t: 'SYRD', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['SYRD'], units: [], infantry: [] },
      enemies: [], // No vessels
    });

    const decision = strategy.decide(state);
    const placeCmd = decision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(placeCmd).toBeDefined();
    // Without vessels, falls back to hardcoded coastal cells for SCG07EA
    // which are around cx=48-56, cy=47-60
    expect(placeCmd!.cx).toBeGreaterThan(44);
    expect(placeCmd!.cy).toBeGreaterThan(44);
  });

  it('keeps SCG11EA refineries biased toward the ore field instead of the east chain', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const state = makeState({
      tick: 8000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 28, 80),
      ],
      production: [{ t: 'PROC', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['PROC', 'POWR', 'WEAP', 'SYRD'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    const placeCmd = decision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(placeCmd).toBeDefined();
    expect(placeCmd!.cy).toBeLessThan(80);
    expect(placeCmd!.cx).toBeLessThan(40);
  });

  it('keeps the SCG11EA bootstrap power local, then starts the east chain from the first slot', () => {
    const strategy = new OracleStrategy('SCG11EA');

    const bootstrapDecision = strategy.decide(makeState({
      tick: 400,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
      ],
      production: [{ t: 'POWR', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['POWR', 'PROC'], units: [], infantry: [] },
    }));

    const bootstrapPlace = bootstrapDecision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(bootstrapPlace).toBeDefined();
    expect(bootstrapPlace!.cx).toBeGreaterThanOrEqual(25);
    expect(bootstrapPlace!.cx).toBeLessThanOrEqual(35);
    expect(bootstrapPlace!.cy).toBeGreaterThanOrEqual(75);
    expect(bootstrapPlace!.cy).toBeLessThanOrEqual(83);

    const chainDecision = strategy.decide(makeState({
      tick: 8000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 33, 80),
        makeStructure(102, 'PROC', 'Greece', 26, 80),
        makeStructure(103, 'WEAP', 'Greece', 32, 76),
      ],
      production: [{ t: 'POWR', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['POWR', 'SYRD'], units: [], infantry: [] },
    }));

    const chainPlace = chainDecision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(chainPlace).toBeDefined();
    expect(chainPlace!.cx).toBe(32);
    expect(chainPlace!.cy).toBe(88);
  });

  it('pins SCG11EA shipyard placement to the east-coast real-water band', () => {
    const strategy = new OracleStrategy('SCG11EA');
    const state = makeState({
      tick: 8000,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 30, 80),
        makeStructure(101, 'POWR', 'Greece', 58, 90),
      ],
      production: [{ t: 'SYRD', prog: 54, rtti: RTTI_BUILDINGTYPE, done: true }],
      buildable: { structures: ['SYRD'], units: [], infantry: [] },
      enemies: [
        makeEntity(200, 'SS', 'USSR', 70, 42, 100, 100, 5),
      ],
    });
    state.enemies.forEach((e) => { e.ally = false; });

    const decision = strategy.decide(state);
    const placeCmd = decision.commands.find(
      (c) => c.cmd === 'place' && c.rtti === RTTI_BUILDINGTYPE,
    );
    expect(placeCmd).toBeDefined();
    expect(placeCmd!.cx).toBe(63);
    expect(placeCmd!.cy).toBeGreaterThanOrEqual(84);
    expect(placeCmd!.cy).toBeLessThanOrEqual(96);
  });
});
