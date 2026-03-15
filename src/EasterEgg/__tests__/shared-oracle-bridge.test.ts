import { describe, expect, it } from 'vitest';

import type { AgentState } from '../engine/agentHarness.js';
import type { OracleDecision } from '../oracle/OracleStrategy.js';
import {
  normalizeTsState,
  translateOracleDecisionToTs,
} from '../oracle/SharedOracleBridge.js';

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    tick: 120,
    state: 'playing',
    playerHouse: 'Greece',
    alliedHouses: ['Greece', 'England', 'GoodGuy'],
    credits: 0,
    power: { produced: 0, consumed: 0, multiplier: 1 },
    siloCapacity: 0,
    units: [],
    enemies: [],
    structures: [],
    production: [],
    pending: undefined,
    available: [],
    availableItems: [],
    superweapons: [],
    mapBounds: { x: 0, y: 0, w: 64, h: 64 },
    killCount: 0,
    lossCount: 0,
    missionTimer: 900,
    missionTimerExpired: false,
    allowWin: false,
    globals: [],
    unitsLeftMap: 0,
    civiliansEvacuated: 0,
    triggers: [],
    ...overrides,
  };
}

describe('SharedOracleBridge', () => {
  it('normalizes TS allied sightings and mission signals into RA oracle state', () => {
    const bridge = normalizeTsState(makeState({
      units: [
        {
          id: 1,
          t: 'E1',
          h: 'Greece',
          cx: 10,
          cy: 10,
          hp: 50,
          mhp: 50,
          m: 'GUARD',
          ally: true,
          cargo: undefined,
          cargoTop: undefined,
        },
      ],
      enemies: [
        {
          id: 2,
          t: 'EINSTEIN',
          h: 'GoodGuy',
          cx: 11,
          cy: 10,
          hp: 25,
          mhp: 25,
          m: 'MOVE',
          ally: false,
          cargo: undefined,
          cargoTop: undefined,
        },
        {
          id: 3,
          t: 'E2',
          h: 'USSR',
          cx: 40,
          cy: 40,
          hp: 50,
          mhp: 50,
          m: 'AREA_GUARD',
          ally: false,
          cargo: undefined,
          cargoTop: undefined,
        },
      ],
      structures: [
        {
          idx: 7,
          t: 'FACT',
          h: 'Greece',
          cx: 20,
          cy: 20,
          hp: 1000,
          mhp: 1000,
          ally: true,
          rep: false,
        },
      ],
      globals: [1],
      civiliansEvacuated: 1,
    }));

    expect(bridge.normalizedState.units.map((unit) => unit.id)).toEqual([1, 2]);
    expect(bridge.normalizedState.enemies.map((unit) => unit.id)).toEqual([3]);
    expect(bridge.normalizedState.civEvacuated).toBe(true);
    expect(bridge.normalizedState.globals).toEqual([1]);
    expect(bridge.normalizedState.structures[0]?.id).toBe(1_000_000_007);
    expect(bridge.structureIndexById.get(1_000_000_007)).toBe(7);
  });

  it('translates oracle structure and enter commands into TS harness commands', () => {
    const bridge = normalizeTsState(makeState({
      structures: [
        {
          idx: 4,
          t: 'WEAP',
          h: 'USSR',
          cx: 30,
          cy: 30,
          hp: 1000,
          mhp: 1000,
          ally: false,
          rep: false,
        },
      ],
    }));

    const decision: OracleDecision = {
      commands: [
        { cmd: 'attack', ids: [10, 11], target: 1_000_000_004 },
        { cmd: 'enter', ids: [12], target: 99 },
        { cmd: 'move', ids: [13], cx: 20, cy: 21 },
      ],
      reason: 'test',
    };

    const translated = translateOracleDecisionToTs(decision, bridge);

    expect(translated.warnings).toEqual([]);
    expect(translated.commands).toEqual([
      { cmd: 'attack_struct', unitIds: [10, 11], structIdx: 4 },
      { cmd: 'enter', unitId: 12, transportId: 99 },
      { cmd: 'move', unitIds: [13], cx: 20, cy: 21 },
    ]);
  });
});
