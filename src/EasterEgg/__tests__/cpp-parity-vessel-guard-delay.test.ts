/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { NodeAgentAdapter } from './node-agent-adapter';

function allUnits(state: ReturnType<NodeAgentAdapter['observe']>) {
  return [...state.units, ...state.enemies];
}

describe('Vessel Mission_Guard delay parity', () => {
  let adapter: NodeAgentAdapter | null = null;

  afterEach(() => {
    adapter?.disconnect();
    adapter = null;
  });

  it('SCU14EA STICKY cruisers double the active mission normal delay', async () => {
    // C++ FootClass::Mission_Guard starts with MissionControl[Mission].
    // Normal_Delay(), then VesselClass CA doubles that active mission delay.
    // For [Sticky] Rate=.016 this is 14 * 2 before Random_Pick(0,2).
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCU14EA', 'normal');

    adapter.step(1);

    const cruisers = allUnits(adapter.observe())
      .filter(unit => unit.t === 'CA' && unit.h === 'Greece')
      .sort((a, b) => a.cx - b.cx || a.cy - b.cy);

    expect(cruisers.map(unit => ({ cx: unit.cx, cy: unit.cy, mt: unit.mt }))).toEqual([
      { cx: 37, cy: 27, mt: 29 },
      { cx: 68, cy: 33, mt: 27 },
      { cx: 94, cy: 41, mt: 28 },
    ]);
  });
});
