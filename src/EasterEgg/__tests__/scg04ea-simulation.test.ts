import { describe, it, expect } from 'vitest';
import { OracleStrategy } from '../oracle/OracleStrategy.js';
import type { RAGameState, RAEntity, RAStructure, RABuildable } from '../oracle/WasmAdapter.js';

/**
 * SCG04EA "Ten to One" — simulation test.
 *
 * Walks through the mission timeline with synthetic game states to identify
 * where the generic oracle handler struggles. SCG04EA starts the player with
 * just a JEEP + 1 E1 on the east side of a snow map. An MCV reinforcement
 * arrives via team movement (waypoints 17→15→26). Enemy (BadGuy+USSR) has
 * a full base NW with heavy tanks, flame turrets, airfields.
 *
 * Win: destroy ALL enemy forces (both houses).
 * Player: Greece, TechLevel 4, Credits 5000 (INI Credits=50 * 100).
 * Enemy base center: ~(49, 24). Player base destination: ~(88, 52).
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

const EMPTY_BUILDABLE: RABuildable = { structures: [], units: [], infantry: [] };

function makeState(overrides: Partial<RAGameState> = {}): RAGameState {
  return {
    tick: 0,
    credits: 5000,
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
    buildable: EMPTY_BUILDABLE,
    ...overrides,
  };
}

// Enemy base structures (BadGuy, NW corner)
function enemyStructures(): RAStructure[] {
  return [
    makeStructure(200, 'FACT', 'BadGuy', 49, 24, false),
    makeStructure(201, 'POWR', 'BadGuy', 47, 21, false),
    makeStructure(202, 'BARR', 'BadGuy', 53, 26, false),
    makeStructure(203, 'PROC', 'BadGuy', 54, 21, false),
    makeStructure(204, 'WEAP', 'BadGuy', 60, 28, false),
    makeStructure(205, 'FTUR', 'BadGuy', 51, 27, false),
    makeStructure(206, 'FTUR', 'BadGuy', 68, 32, false),
    makeStructure(207, 'FTUR', 'BadGuy', 62, 30, false),
    makeStructure(208, 'AFLD', 'BadGuy', 43, 23, false),
    makeStructure(209, 'AFLD', 'BadGuy', 45, 21, false),
  ];
}

// Enemy units (mix of BadGuy + USSR)
function enemyUnits(): RAEntity[] {
  return [
    // BadGuy heavy tanks near base
    makeEntity(300, '3TNK', 'BadGuy', 54, 35, 256, 256, 5),
    makeEntity(301, '3TNK', 'BadGuy', 50, 34, 256, 256, 5),
    makeEntity(302, '3TNK', 'BadGuy', 46, 31, 256, 256, 5),
    // BadGuy harvester
    makeEntity(303, 'HARV', 'BadGuy', 44, 24, 256, 256, 5),
    // BadGuy infantry
    makeEntity(310, 'E2', 'BadGuy', 56, 40, 50, 50, 5),
    makeEntity(311, 'E2', 'BadGuy', 55, 40, 50, 50, 5),
    makeEntity(312, 'E2', 'BadGuy', 57, 39, 50, 50, 5),
    makeEntity(313, 'E2', 'BadGuy', 56, 39, 50, 50, 5),
    makeEntity(314, 'E2', 'BadGuy', 55, 39, 50, 50, 5),
    makeEntity(315, 'E2', 'BadGuy', 56, 38, 50, 50, 5),
    // USSR hunting infantry
    makeEntity(320, 'E1', 'USSR', 54, 34, 50, 50, 13), // m=13 HUNT
    makeEntity(321, 'E1', 'USSR', 57, 37, 50, 50, 13),
  ].map((e) => ({ ...e, ally: false }));
}

describe('SCG04EA simulation — generic handler analysis', () => {

  // ─── Phase 1: Mission start — JEEP + E1 only, no MCV yet ──────────
  it('phase 1 (tick 0): holds position with JEEP + E1 before MCV arrives', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      tick: 10,
      units: [
        makeEntity(1, 'JEEP', 'Greece', 70, 60),
        makeEntity(2, 'E1', 'Greece', 70, 59),
      ],
      enemies: enemyUnits(),
      structures: enemyStructures(),
    });

    const decision = strategy.decide(state);
    console.log('Phase 1:', decision.reason);
    // Should hold position, not attack
    expect(decision.reason).toContain('waiting for MCV');
    const attackCmds = decision.commands.filter((c) => c.cmd === 'attack' || c.cmd === 'attack_move');
    expect(attackCmds.length).toBe(0);
  });

  // ─── Phase 2: MCV arrives (in team movement, not idle) ────────────
  it('phase 2 (tick 50): MCV on map but moving — waits, escorts', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      tick: 50,
      units: [
        makeEntity(1, 'JEEP', 'Greece', 70, 60),
        makeEntity(2, 'E1', 'Greece', 70, 59),
        makeEntity(3, 'MCV', 'Greece', 92, 68, 256, 256, 3), // m=3 MOVE (team movement)
      ],
      enemies: enemyUnits(),
      structures: enemyStructures(),
    });

    const decision = strategy.decide(state);
    console.log('Phase 2:', decision.reason);
    // Should detect MCV, not try to deploy (it's moving)
    expect(decision.reason).toContain('MCV moving');
    const deployCmds = decision.commands.filter((c) => c.cmd === 'deploy');
    expect(deployCmds.length).toBe(0);
  });

  // ─── Phase 3: MCV arrives at destination, idle ─────────────────────
  it('phase 3 (tick 300): MCV idle at destination — deploys', () => {
    const strategy = new OracleStrategy('SCG04EA');
    // Warm up tick tracking
    strategy.decide(makeState({
      tick: 50,
      units: [makeEntity(3, 'MCV', 'Greece', 88, 52, 256, 256, 3)],
      enemies: enemyUnits(), structures: enemyStructures(),
    }));

    const state = makeState({
      tick: 300,
      units: [
        makeEntity(1, 'JEEP', 'Greece', 86, 53),
        makeEntity(2, 'E1', 'Greece', 87, 52),
        makeEntity(3, 'MCV', 'Greece', 88, 52, 256, 256, 5), // m=5 GUARD (idle)
      ],
      enemies: enemyUnits(),
      structures: enemyStructures(),
    });

    const decision = strategy.decide(state);
    console.log('Phase 3:', decision.reason);
    const deployCmds = decision.commands.filter((c) => c.cmd === 'deploy');
    expect(deployCmds.length).toBe(1);
  });

  // ─── Phase 4: ConYard placed, start building ──────────────────────
  it('phase 4 (tick 400): ConYard up — starts build order (POWR)', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      tick: 400,
      credits: 4800,
      power: { produced: 0, consumed: 0 },
      units: [
        makeEntity(1, 'JEEP', 'Greece', 86, 53),
        makeEntity(2, 'E1', 'Greece', 87, 52),
      ],
      enemies: enemyUnits(),
      structures: [
        makeStructure(100, 'FACT', 'Greece', 88, 52),
        ...enemyStructures(),
      ],
      buildable: { structures: ['POWR', 'PROC'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    console.log('Phase 4:', decision.reason);
    const produceCmds = decision.commands.filter((c) => c.cmd === 'produce');
    expect(produceCmds.length).toBeGreaterThan(0);
    // Should build POWR first
    expect(decision.reason).toContain('POWR');
  });

  // ─── Phase 5: First attack wave hits during base building ─────────
  it('phase 5 (tick 800): enemy attack wave — defends base', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      tick: 800,
      credits: 3000,
      power: { produced: 100, consumed: 40 },
      units: [
        makeEntity(1, 'JEEP', 'Greece', 86, 53),
        makeEntity(2, 'E1', 'Greece', 87, 52),
      ],
      enemies: [
        ...enemyUnits(),
        // Attack wave arriving near base
        { ...makeEntity(350, '3TNK', 'BadGuy', 82, 50, 256, 256, 0), ally: false },
        { ...makeEntity(351, 'E2', 'BadGuy', 83, 51, 50, 50, 0), ally: false },
        { ...makeEntity(352, 'E2', 'BadGuy', 83, 52, 50, 50, 0), ally: false },
      ],
      structures: [
        makeStructure(100, 'FACT', 'Greece', 88, 52),
        makeStructure(101, 'POWR', 'Greece', 92, 52),
        makeStructure(102, 'PROC', 'Greece', 84, 52),
        ...enemyStructures(),
      ],
      buildable: { structures: ['WEAP'], units: [], infantry: [] },
      production: [{ t: 'WEAP', prog: 45, rtti: 6 }],
    });

    const decision = strategy.decide(state);
    console.log('Phase 5:', decision.reason);
    // Should defend — JEEP and E1 engage the attack wave
    const attackCmds = decision.commands.filter(
      (c) => c.cmd === 'attack' || c.cmd === 'attack_move',
    );
    expect(decision.reason).toMatch(/defend|threat/i);
  });

  // ─── Phase 6: Mid-game — WEAP up, producing tanks ─────────────────
  it('phase 6 (tick 2000): WEAP up — produces tanks correctly', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      tick: 2000,
      credits: 2500,
      power: { produced: 200, consumed: 80 },
      units: [
        makeEntity(1, 'JEEP', 'Greece', 86, 53),
        makeEntity(2, 'E1', 'Greece', 87, 52),
        makeEntity(4, 'HARV', 'Greece', 80, 48),
        makeEntity(5, '1TNK', 'Greece', 85, 51),
        makeEntity(6, '1TNK', 'Greece', 86, 51),
      ],
      enemies: enemyUnits(),
      structures: [
        makeStructure(100, 'FACT', 'Greece', 88, 52),
        makeStructure(101, 'POWR', 'Greece', 92, 52),
        makeStructure(102, 'PROC', 'Greece', 84, 52),
        makeStructure(103, 'WEAP', 'Greece', 92, 56),
        ...enemyStructures(),
      ],
      buildable: {
        structures: ['POWR', 'PROC', 'TENT', 'FIX'],
        units: ['HARV', '1TNK', 'APC', 'JEEP', 'MNLY'],
        infantry: ['E1', 'E3', 'MEDI'],
      },
    });

    const decision = strategy.decide(state);
    console.log('Phase 6:', decision.reason);
    // Should be producing units (tanks or harvester)
    const produceCmds = decision.commands.filter((c) => c.cmd === 'produce');
    expect(produceCmds.length).toBeGreaterThan(0);
  });

  // ─── Phase 7: Attack threshold — enough tanks to attack ───────────
  it('phase 7 (tick 5000): 8 tanks + economy — attacks enemy base', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const tanks = Array.from({ length: 8 }, (_, i) =>
      makeEntity(10 + i, '1TNK', 'Greece', 85 + (i % 4), 51 + Math.floor(i / 4), 256, 256, 5),
    );
    const state = makeState({
      tick: 5000,
      credits: 4000,
      power: { produced: 300, consumed: 120 },
      units: [
        makeEntity(1, 'JEEP', 'Greece', 86, 53),
        ...tanks,
        makeEntity(4, 'HARV', 'Greece', 80, 48),
        makeEntity(5, 'HARV', 'Greece', 78, 46),
      ],
      enemies: enemyUnits(),
      structures: [
        makeStructure(100, 'FACT', 'Greece', 88, 52),
        makeStructure(101, 'POWR', 'Greece', 92, 52),
        makeStructure(102, 'PROC', 'Greece', 84, 52),
        makeStructure(103, 'WEAP', 'Greece', 92, 56),
        makeStructure(104, 'PROC', 'Greece', 80, 56),
        makeStructure(105, 'POWR', 'Greece', 96, 52),
        ...enemyStructures(),
      ],
      buildable: {
        structures: ['POWR', 'TENT', 'FIX', 'AGUN'],
        units: ['HARV', '1TNK', 'APC', 'JEEP', 'MNLY'],
        infantry: ['E1', 'E3', 'MEDI'],
      },
    });

    const decision = strategy.decide(state);
    console.log('Phase 7:', decision.reason);
    // With 8 tanks and favorable force ratio, should be attacking
    const attackCmds = decision.commands.filter(
      (c) => c.cmd === 'attack' || c.cmd === 'attack_move',
    );
    // Log whether it decides to attack or is still building up
    console.log('Phase 7 attack cmds:', attackCmds.length);
    console.log('Phase 7 all cmds:', decision.commands.map((c) => c.cmd));
  });

  // ─── Phase 7b: Attack threshold — autocreate inflates enemy count ──
  it('phase 7b (tick 8000): enemy autocreate keeps producing — oracle turtles forever', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const tanks = Array.from({ length: 12 }, (_, i) =>
      makeEntity(10 + i, '1TNK', 'Greece', 85 + (i % 4), 51 + Math.floor(i / 4), 256, 256, 5),
    );
    // Enemy has been autocreating — more units than initial
    const reinforcedEnemies = [
      ...enemyUnits(),
      // Autocreated tanks
      { ...makeEntity(400, '3TNK', 'BadGuy', 50, 30, 256, 256, 5), ally: false },
      { ...makeEntity(401, '3TNK', 'BadGuy', 52, 31, 256, 256, 5), ally: false },
      { ...makeEntity(402, '3TNK', 'BadGuy', 48, 29, 256, 256, 5), ally: false },
      // Autocreated infantry
      { ...makeEntity(410, 'E2', 'BadGuy', 54, 32, 50, 50, 5), ally: false },
      { ...makeEntity(411, 'E2', 'BadGuy', 55, 32, 50, 50, 5), ally: false },
      { ...makeEntity(412, 'E2', 'BadGuy', 56, 32, 50, 50, 5), ally: false },
      { ...makeEntity(413, 'E1', 'BadGuy', 53, 33, 50, 50, 5), ally: false },
    ];

    const state = makeState({
      tick: 8000,
      credits: 6000,
      power: { produced: 400, consumed: 160 },
      units: [
        makeEntity(1, 'JEEP', 'Greece', 86, 53),
        ...tanks,
        makeEntity(4, 'HARV', 'Greece', 80, 48),
        makeEntity(5, 'HARV', 'Greece', 78, 46),
        makeEntity(30, 'E1', 'Greece', 87, 53),
        makeEntity(31, 'E1', 'Greece', 88, 53),
      ],
      enemies: reinforcedEnemies,
      structures: [
        makeStructure(100, 'FACT', 'Greece', 88, 52),
        makeStructure(101, 'POWR', 'Greece', 92, 52),
        makeStructure(102, 'PROC', 'Greece', 84, 52),
        makeStructure(103, 'WEAP', 'Greece', 92, 56),
        makeStructure(104, 'PROC', 'Greece', 80, 56),
        makeStructure(105, 'POWR', 'Greece', 96, 52),
        makeStructure(106, 'TENT', 'Greece', 84, 56),
        ...enemyStructures(),
      ],
      buildable: {
        structures: ['POWR', 'FIX', 'AGUN'],
        units: ['HARV', '1TNK', 'APC', 'JEEP', 'MNLY'],
        infantry: ['E1', 'E3', 'MEDI'],
      },
    });

    const decision = strategy.decide(state);
    // friendlyStr = 12*3 + JEEP*1 + 2*E1*1 = 39
    // enemyStr = 6*3TNK*3 + HARV + 9*E2 + 3*E1 = 18 + 1 + 9 + 3 = 31
    // threshold: 31 * 1.5 = 46.5 → 39 < 46.5 → WON'T ATTACK
    console.log('Phase 7b:', decision.reason);
    const attackCmds = decision.commands.filter(
      (c) => c.cmd === 'attack' || c.cmd === 'attack_move',
    );
    console.log('Phase 7b attack cmds:', attackCmds.length);
    // This demonstrates the problem: even with 12 tanks, oracle won't attack
    // because autocreate keeps inflating enemy strength
  });

  // ─── Phase 8: Only JEEP + E1, tick > 1500, no MCV ─────────────────
  // This simulates the worst case: MCV was destroyed before deploying
  it('phase 8 (tick 2000): MCV lost, no base — what happens?', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      tick: 2000,
      credits: 100,
      units: [
        makeEntity(1, 'JEEP', 'Greece', 70, 60),
      ],
      enemies: enemyUnits(),
      structures: enemyStructures(),
    });

    const decision = strategy.decide(state);
    console.log('Phase 8 (MCV lost):', decision.reason);
    console.log('Phase 8 cmds:', decision.commands.map((c) => `${c.cmd}→(${c.cx},${c.cy})`));
    // This is the danger zone — what does the oracle do with just a JEEP?
  });

  // ─── Phase 9: Paratroopers drop behind base ───────────────────────
  it('phase 9 (tick 3000): paratroopers behind base — responds', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      tick: 3000,
      credits: 3000,
      power: { produced: 200, consumed: 80 },
      units: [
        makeEntity(1, 'JEEP', 'Greece', 86, 53),
        makeEntity(5, '1TNK', 'Greece', 85, 51),
        makeEntity(6, '1TNK', 'Greece', 86, 51),
        makeEntity(7, '1TNK', 'Greece', 87, 51),
        makeEntity(4, 'HARV', 'Greece', 80, 48),
      ],
      enemies: [
        ...enemyUnits(),
        // Paratroopers dropped east of base
        { ...makeEntity(360, 'E1', 'BadGuy', 94, 53, 50, 50, 0), ally: false },
        { ...makeEntity(361, 'E1', 'BadGuy', 95, 53, 50, 50, 0), ally: false },
      ],
      structures: [
        makeStructure(100, 'FACT', 'Greece', 88, 52),
        makeStructure(101, 'POWR', 'Greece', 92, 52),
        makeStructure(102, 'PROC', 'Greece', 84, 52),
        makeStructure(103, 'WEAP', 'Greece', 92, 56),
        ...enemyStructures(),
      ],
      buildable: {
        structures: ['POWR', 'PROC', 'TENT'],
        units: ['HARV', '1TNK'],
        infantry: ['E1', 'E3'],
      },
    });

    const decision = strategy.decide(state);
    console.log('Phase 9:', decision.reason);
    // Should detect paratroopers near structures and defend
    expect(decision.reason).toMatch(/defend|threat/i);
  });

  // ─── Phase 10: Minelayer arrives — dispatched correctly? ───────────
  it('phase 10 (tick 500): minelayer arrives — gets dispatched to mine waypoints', () => {
    const strategy = new OracleStrategy('SCG04EA');
    const state = makeState({
      tick: 500,
      credits: 4500,
      units: [
        makeEntity(1, 'JEEP', 'Greece', 86, 53),
        makeEntity(2, 'E1', 'Greece', 87, 52),
        { ...makeEntity(8, 'MNLY', 'Greece', 88, 52, 256, 256, 5), ammo: 5, maxAmmo: 5 }, // Idle at base
      ],
      enemies: enemyUnits(),
      structures: [
        makeStructure(100, 'FACT', 'Greece', 88, 52),
        ...enemyStructures(),
      ],
      buildable: { structures: ['POWR', 'PROC'], units: [], infantry: [] },
    });

    const decision = strategy.decide(state);
    console.log('Phase 10:', decision.reason);
    // Should dispatch minelayer to first mine waypoint
    const mineCmds = decision.commands.filter(
      (c) => c.cmd === 'move' && (c.ids as number[])?.includes(8),
    );
    console.log('Phase 10 mine cmds:', mineCmds);
    expect(decision.reason).toMatch(/MNLY|mine/i);
  });
});
