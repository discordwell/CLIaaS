import { describe, it, expect } from 'vitest';
import { translateOracleDecisionToTs, type TsStateBridge } from '../oracle/SharedOracleBridge';

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
    const decision = { commands: [{ cmd: 'produce', rtti: 33, type_id: 1 }], reason: 'test' };
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

  it('warns on unknown produce rtti', () => {
    const decision = { commands: [{ cmd: 'produce', rtti: 99, type_id: 0 }], reason: 'test' };
    const { commands, warnings } = translateOracleDecisionToTs(decision, EMPTY_BRIDGE);
    expect(commands).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });
});
