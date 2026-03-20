import { describe, it, expect } from 'vitest';
import { translateOracleDecisionToTs, normalizeTsState, type TsStateBridge } from '../oracle/SharedOracleBridge';
import type { AgentState } from '../engine/agentHarness';

const EMPTY_BRIDGE: TsStateBridge = {
  normalizedState: {} as any,
  structureIndexById: new Map(),
};

describe('translateOracleDecisionToTs — production commands', () => {
  it('translates produce RTTI_BUILDINGTYPE to build command', () => {
    const decision = { commands: [{ cmd: 'produce', rtti: 6, type_id: 17 }], reason: 'test' };
    const { commands, warnings } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toEqual([{ cmd: 'build', type: 'POWR' }]);
    expect(warnings).toHaveLength(0);
  });

  it('translates produce RTTI_UNITTYPE to build command', () => {
    const decision = { commands: [{ cmd: 'produce', rtti: 29, type_id: 2 }], reason: 'test' };
    const { commands } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toEqual([{ cmd: 'build', type: '2TNK' }]);
  });

  it('translates produce RTTI_INFANTRYTYPE to build command', () => {
    const decision = { commands: [{ cmd: 'produce', rtti: 14, type_id: 2 }], reason: 'test' };
    const { commands } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toEqual([{ cmd: 'build', type: 'E3' }]);
  });

  it('translates produce RTTI_VESSELTYPE to build command', () => {
    const decision = { commands: [{ cmd: 'produce', rtti: 31, type_id: 1 }], reason: 'test' };
    const { commands } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toEqual([{ cmd: 'build', type: 'DD' }]);
  });

  it('translates place with coordinates to place command', () => {
    const decision = { commands: [{ cmd: 'place', rtti: 6, cx: 10, cy: 20 }], reason: 'test' };
    const { commands } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toEqual([{ cmd: 'place', cx: 10, cy: 20 }]);
  });

  it('skips place without coordinates (unit exit — TS handles automatically)', () => {
    const decision = { commands: [{ cmd: 'place', rtti: 29 }], reason: 'test' };
    const { commands, warnings } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('translates sell command', () => {
    const bridge: TsStateBridge = {
      normalizedState: {} as any,
      structureIndexById: new Map([[1_000_000_005, 5]]),
    };
    const decision = { commands: [{ cmd: 'sell', target: 1_000_000_005 }], reason: 'test' };
    const { commands } = translateOracleDecisionToTs(decision, bridge);
    expect(commands).toEqual([{ cmd: 'sell', structIdx: 5 }]);
  });

  it('translates repair command', () => {
    const bridge: TsStateBridge = {
      normalizedState: {} as any,
      structureIndexById: new Map([[1_000_000_003, 3]]),
    };
    const decision = { commands: [{ cmd: 'repair', target: 1_000_000_003 }], reason: 'test' };
    const { commands } = translateOracleDecisionToTs(decision, bridge);
    expect(commands).toEqual([{ cmd: 'repair', structIdx: 3 }]);
  });

  it('warns when sell target structure not found', () => {
    const decision = { commands: [{ cmd: 'sell', target: 999 }], reason: 'test' };
    const { commands, warnings } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('sell');
  });

  it('warns when repair target structure not found', () => {
    const decision = { commands: [{ cmd: 'repair', target: 999 }], reason: 'test' };
    const { commands, warnings } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('repair');
  });

  it('warns on unknown produce rtti', () => {
    const decision = { commands: [{ cmd: 'produce', rtti: 99, type_id: 0 }], reason: 'test' };
    const { commands, warnings } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });
});

describe('normalizeTsState — buildable field', () => {
  const MINIMAL_STATE: AgentState = {
    tick: 100,
    credits: 5000,
    playerHouse: 'Greece',
    alliedHouses: ['Greece'],
    globals: [],
    missionTimer: 0,
    civiliansEvacuated: 0,
    state: 'playing',
    power: { produced: 200, consumed: 100, multiplier: 1 },
    units: [],
    enemies: [],
    structures: [],
    production: [],
    available: ['POWR', 'WEAP', '2TNK', 'E3', 'DD'],
    availableItems: [
      { t: 'POWR', name: 'Power Plant', cost: 300, time: 100, side: 'left', isStruct: true },
      { t: 'WEAP', name: 'War Factory', cost: 2000, time: 200, side: 'left', isStruct: true },
      { t: '2TNK', name: 'Medium Tank', cost: 800, time: 150, side: 'right', isStruct: false },
      { t: 'E3', name: 'Rocket Soldier', cost: 300, time: 80, side: 'right', isStruct: false },
      { t: 'DD', name: 'Destroyer', cost: 1000, time: 200, side: 'right', isStruct: false },
    ],
    superweapons: [],
    mapBounds: { x: 0, y: 0, w: 128, h: 128 },
    kills: 0,
    losses: 0,
  } as AgentState;

  it('includes buildable with categorized available items', () => {
    const bridge = normalizeTsState(MINIMAL_STATE);
    const buildable = bridge.normalizedState.buildable;
    expect(buildable).toBeDefined();
    expect(buildable!.structures).toEqual(['POWR', 'WEAP']);
    expect(buildable!.units).toEqual(['2TNK']);
    expect(buildable!.infantry).toEqual(['E3']);
    expect(buildable!.vessels).toEqual(['DD']);
  });

  it('returns empty arrays when no items available', () => {
    const emptyState = { ...MINIMAL_STATE, availableItems: [] };
    const bridge = normalizeTsState(emptyState);
    const buildable = bridge.normalizedState.buildable;
    expect(buildable).toBeDefined();
    expect(buildable!.structures).toEqual([]);
    expect(buildable!.units).toEqual([]);
    expect(buildable!.infantry).toEqual([]);
  });
});

describe('normalizeTsState — production rtti and done fields', () => {
  // C++ parity: Oracle checks state.production.find(p => p.rtti === RTTI_BUILDINGTYPE)
  // to detect current building production. Without rtti, Oracle can't tell what's
  // in the queue and keeps issuing new produce commands every tick.

  const STATE_WITH_PRODUCTION = {
    tick: 500,
    credits: 3000,
    playerHouse: 'Greece',
    alliedHouses: ['Greece'],
    globals: [],
    missionTimer: 0,
    civiliansEvacuated: 0,
    state: 'playing',
    power: { produced: 200, consumed: 100, multiplier: 1 },
    units: [],
    enemies: [],
    structures: [],
    production: [
      { t: 'POWR', name: 'Power Plant', prog: 0.5, q: 1, cost: 300, paid: 150 },
      { t: '2TNK', name: 'Medium Tank', prog: 0.8, q: 1, cost: 800, paid: 640 },
      { t: 'E3', name: 'Rocket Soldier', prog: 1.0, q: 1, cost: 300, paid: 300 },
    ],
    available: [],
    availableItems: [],
    superweapons: [],
    mapBounds: { x: 0, y: 0, w: 128, h: 128 },
    kills: 0,
    losses: 0,
  } as AgentState;

  it('includes rtti for building production (RTTI_BUILDINGTYPE = 6)', () => {
    const bridge = normalizeTsState(STATE_WITH_PRODUCTION);
    const powr = bridge.normalizedState.production.find(p => p.t === 'POWR');
    expect(powr).toBeDefined();
    expect(powr!.rtti).toBe(6); // RTTI_BUILDINGTYPE
  });

  it('includes rtti for unit production (RTTI_UNITTYPE = 29)', () => {
    const bridge = normalizeTsState(STATE_WITH_PRODUCTION);
    const tank = bridge.normalizedState.production.find(p => p.t === '2TNK');
    expect(tank).toBeDefined();
    expect(tank!.rtti).toBe(29); // RTTI_UNITTYPE
  });

  it('includes rtti for infantry production (RTTI_INFANTRYTYPE = 14)', () => {
    const bridge = normalizeTsState(STATE_WITH_PRODUCTION);
    const e3 = bridge.normalizedState.production.find(p => p.t === 'E3');
    expect(e3).toBeDefined();
    expect(e3!.rtti).toBe(14); // RTTI_INFANTRYTYPE
  });

  it('marks completed items with done=true (prog >= 1.0)', () => {
    const bridge = normalizeTsState(STATE_WITH_PRODUCTION);
    const e3 = bridge.normalizedState.production.find(p => p.t === 'E3');
    expect(e3!.done).toBe(true);
    const powr = bridge.normalizedState.production.find(p => p.t === 'POWR');
    expect(powr!.done).toBe(false);
  });

  it('converts prog from 0-1 to 0-100 scale', () => {
    const bridge = normalizeTsState(STATE_WITH_PRODUCTION);
    const powr = bridge.normalizedState.production.find(p => p.t === 'POWR');
    expect(powr!.prog).toBe(50); // 0.5 * 100
    const tank = bridge.normalizedState.production.find(p => p.t === '2TNK');
    expect(tank!.prog).toBe(80); // 0.8 * 100
  });
});
