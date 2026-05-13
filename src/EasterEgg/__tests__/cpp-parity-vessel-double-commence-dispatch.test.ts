/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: vessels do not run UnitClass PCP Commence.
 *
 * A prior docs test claimed vessel Mission_Move multi-fires were caused by
 * UnitClass::Per_Cell_Process Commence during DriveClass double-cycles. The
 * C++ inheritance chain refutes that:
 *
 *   VesselClass::Per_Cell_Process
 *     -> DriveClass::Per_Cell_Process
 *     -> FootClass::Per_Cell_Process
 *
 * It never enters UnitClass::Per_Cell_Process, so unit.cpp:1756 cannot pop a
 * vessel MissionQueue. Vessels only pop queued missions at VesselClass::AI's
 * pre/post Commence gates, both guarded by !IsDriving and Is_Door_Closed.
 */

import { describe, expect, it } from 'vitest';

import { PCPType, drivePerCellProcess, unitPerCellProcess, type PCPEntity } from '../engine/perCellProcess';

type M = 'GUARD' | 'MOVE' | 'ATTACK';

function makeVessel(overrides: Partial<PCPEntity<M>> = {}): PCPEntity<M> {
  return {
    moveTarget: null,
    cell: { cx: 0, cy: 0 },
    path: [],
    pathIndex: 0,
    missionQueue: null,
    mission: 'GUARD' as M,
    missionTimer: 14,
    isDriving: true,
    stats: { isVessel: true },
    ...overrides,
  };
}

describe('Vessel per-cell process class routing', () => {
  it('does not pop MissionQueue at vessel PCP_END while still en route', () => {
    const ca = makeVessel({
      moveTarget: { lx: 84 * 256 + 128, ly: 84 * 256 + 128 },
      cell: { cx: 84, cy: 87 },
      path: [{ cx: 84, cy: 86 }, { cx: 84, cy: 85 }, { cx: 84, cy: 84 }],
      missionQueue: 'MOVE',
      mission: 'GUARD',
      missionTimer: 35,
    });

    const r = drivePerCellProcess(ca, PCPType.PCP_END);

    expect(r.commenceFired).toBe(false);
    expect(r.navComCleared).toBe(false);
    expect(ca.mission).toBe('GUARD');
    expect(ca.missionQueue).toBe('MOVE');
    expect(ca.missionTimer).toBe(35);
  });

  it('still performs shared DriveClass NavCom clear for vessels at destination', () => {
    const ca = makeVessel({
      moveTarget: { lx: 84 * 256 + 128, ly: 84 * 256 + 128 },
      cell: { cx: 84, cy: 84 },
      path: [{ cx: 84, cy: 84 }],
      missionQueue: 'MOVE',
      mission: 'GUARD',
      missionTimer: 35,
    });

    const r = drivePerCellProcess(ca, PCPType.PCP_END);

    expect(r.commenceFired).toBe(false);
    expect(r.navComCleared).toBe(true);
    expect(ca.mission).toBe('GUARD');
    expect(ca.missionQueue).toBe('MOVE');
    expect(ca.missionTimer).toBe(35);
    expect(ca.moveTarget).toBe(null);
    expect(ca.path).toEqual([]);
  });

  it('guards against accidental UnitClass PCP routing for real vessel-like entities', () => {
    const ca = makeVessel({
      moveTarget: { lx: 84 * 256 + 128, ly: 84 * 256 + 128 },
      cell: { cx: 84, cy: 87 },
      missionQueue: 'MOVE',
      mission: 'GUARD',
      missionTimer: 35,
    });

    const r = unitPerCellProcess(ca, PCPType.PCP_END);

    expect(r.commenceFired).toBe(false);
    expect(ca.mission).toBe('GUARD');
    expect(ca.missionQueue).toBe('MOVE');
    expect(ca.missionTimer).toBe(35);
  });

  it('documents the C++ call-chain distinction from land UnitClass PCP', () => {
    const refs = {
      vesselClassPcp: 'vessel.cpp:696-760',
      driveClassPcp: 'drive.cpp:858-879',
      footClassPcp: 'foot.cpp:1438-1505',
      unitClassCommence: 'unit.cpp:1815',
      vesselAiCommenceGates: ['vessel.cpp:606', 'vessel.cpp:673'],
    };

    expect(refs.vesselClassPcp).toBe('vessel.cpp:696-760');
    expect(refs.unitClassCommence).toBe('unit.cpp:1815');
    expect(refs.vesselAiCommenceGates).toEqual(['vessel.cpp:606', 'vessel.cpp:673']);
  });
});
