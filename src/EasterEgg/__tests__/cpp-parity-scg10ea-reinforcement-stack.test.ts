/**
 * @vitest-environment jsdom
 *
 * C++ parity: SCG10EA opening west-edge reinforcements.
 *
 * WASM trace at tick 1 keeps all four Greek 2TNKs from team `arnf0` stacked at
 * the same off-radar Calculated_Cell (23,98), with IsLocked=false. TS must not
 * fan out same-team off-radar ground reinforcements into adjacent cells.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { NodeAgentAdapter } from './node-agent-adapter';

describe('SCG10EA off-radar ground reinforcement stacking', () => {
  let adapter: NodeAgentAdapter | null = null;

  afterEach(() => {
    adapter?.disconnect();
    adapter = null;
  });

  it('keeps same-team 2TNKs stacked on the west-edge Calculated_Cell at arrival', async () => {
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCG10EA', 'normal');

    adapter.step(1);
    const state = adapter.observe();
    const greek2Tanks = [...state.units, ...state.enemies]
      .filter(unit => unit.t === '2TNK' && unit.h === 'Greece')
      .sort((a, b) => a.id - b.id);

    expect(greek2Tanks).toHaveLength(4);
    for (const unit of greek2Tanks) {
      expect(unit.cx).toBe(23);
      expect(unit.cy).toBe(98);
      expect(unit.m).toBe('GUARD');
      expect(unit.lock).toBe(false);
      expect(unit.mtx).toBeUndefined();
      expect(unit.mty).toBeUndefined();
    }
  });
});
