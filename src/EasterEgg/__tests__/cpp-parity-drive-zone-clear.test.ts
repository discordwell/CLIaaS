/**
 * C++ DriveClass::AI clears NavCom for locked land vehicles when their
 * destination is outside the current movement zone (drive.cpp:1385-1388).
 *
 * SCG01EA's opening player JEEP order to (45,84) exercises this: the direct
 * Assign_Destination call starts the first track, but after that track the
 * out-of-zone NavCom is cleared and Mission_Move idles back to GUARD.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { NodeAgentAdapter } from './node-agent-adapter';

function firstJeep(state: ReturnType<NodeAgentAdapter['observe']>) {
  const jeep = [...state.units]
    .filter(unit => unit.t === 'JEEP')
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx || a.id - b.id)[0];
  expect(jeep).toBeDefined();
  return jeep;
}

describe('DriveClass out-of-zone NavCom clear', () => {
  let adapter: NodeAgentAdapter | null = null;

  afterEach(() => {
    adapter?.disconnect();
    adapter = null;
  });

  it('SCG01EA player JEEP stops after first unreachable-zone leg', async () => {
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCG01EA', 'normal');

    adapter.step(60);
    const jeep = firstJeep(adapter.observe());

    adapter.step(0, [{ cmd: 'move', unitIds: [jeep.id], cx: 45, cy: 84 }]);
    const ordered = adapter.observe().units.find(unit => unit.id === jeep.id);
    expect(ordered?.mtx).toBe(45);
    expect(ordered?.mty).toBe(84);

    adapter.step(60);
    const after = adapter.observe().units.find(unit => unit.id === jeep.id);
    expect(after).toMatchObject({ cx: 63, cy: 52, m: 'GUARD' });
    expect(after?.mtx).toBeUndefined();
    expect(after?.mty).toBeUndefined();
  });
});
