/**
 * C++ DriveClass::AI clears NavCom for locked drive-class objects when their
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

function allUnits(state: ReturnType<NodeAgentAdapter['observe']>) {
  return [...state.units, ...state.enemies];
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

  it('SCG10EA off-map west-edge reinforcement keeps NavCom until it enters radar', async () => {
    // C++ drive.cpp:1396 gates the out-of-zone NavCom clear on IsLocked.
    // The Greek 2TNK at (23,97) is one cell outside SCG10EA's [Map] rectangle
    // at tick 121, and the WASM trace reports lock=false with NavCom preserved.
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCG10EA', 'normal');

    adapter.step(120);
    const before = allUnits(adapter.observe())
      .find(unit => unit.t === '2TNK' && unit.cx === 23 && unit.cy === 97);
    expect(before, 'expected west-edge 2TNK at SCG10EA tick 120').toBeDefined();
    expect(before?.lock).toBe(false);
    expect(before?.mtx).toBe(29);
    expect(before?.mty).toBe(92);

    adapter.step(1);
    const after = allUnits(adapter.observe()).find(unit => unit.id === before!.id);
    expect(after?.lock).toBe(false);
    expect(after?.mtx).toBe(29);
    expect(after?.mty).toBe(92);
  });

  it('SCU14EA naval LST clears out-of-zone NavCom before first track', async () => {
    // C++ trace:
    //   tick 13: USSR LST has rotated to waypoint 10, DriveClass clears NavCom
    //            because the target is outside the current water zone, and post-
    //            DriveClass Commence idles it back to GUARD.
    //   tick 14: TeamClass requeues MOVE and Start_Of_Move starts a drive track;
    //            the vessel remains in GUARD long enough to fire Mission_Guard.
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCU14EA', 'normal');

    adapter.step(13);
    const after13 = allUnits(adapter.observe())
      .find(unit => unit.t === 'LST' && unit.h === 'USSR' && unit.cx === 91 && unit.cy === 86);
    expect(after13, 'expected starting USSR LST at SCU14EA tick 13').toBeDefined();
    expect(after13?.m).toBe('GUARD');
    expect(after13?.mq).toBeNull();
    expect(after13?.drv).toBe(false);
    expect(after13?.mtx).toBeUndefined();
    expect(after13?.mty).toBeUndefined();

    adapter.step(1);
    const after14 = allUnits(adapter.observe()).find(unit => unit.id === after13!.id);
    expect(after14?.m).toBe('GUARD');
    expect(after14?.mq).toBe('MOVE');
    expect(after14?.drv).toBe(true);
    expect(after14?.mtx).toBe(74);
    expect(after14?.mty).toBe(110);
  });

  it('SCU14EA leaving-map LST keeps the off-radar NavCom after it has locked', async () => {
    // C++ tick-229 trace: the starting USSR LST is locked, still driving under
    // GUARD with a queued MOVE to waypoint 10 (74,110). Treating the off-radar
    // waypoint as impassable makes TS finish an in-map detour here and creates
    // the tick-230 Mission_Move RNG divergence.
    adapter = new NodeAgentAdapter();
    await adapter.loadScenario('SCU14EA', 'normal');

    adapter.step(229);
    const lst = allUnits(adapter.observe())
      .find(unit => unit.t === 'LST' && unit.h === 'USSR' && unit.cx === 79 && unit.cy === 93);

    expect(lst, 'expected starting USSR LST near SCU14EA exit route at tick 229').toBeDefined();
    expect(lst?.lock).toBe(true);
    expect(lst?.m).toBe('GUARD');
    expect(lst?.mq).toBe('MOVE');
    expect(lst?.drv).toBe(true);
    expect(lst?.mtx).toBe(74);
    expect(lst?.mty).toBe(110);
  }, 15_000);
});
