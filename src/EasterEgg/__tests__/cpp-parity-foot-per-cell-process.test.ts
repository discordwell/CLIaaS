/**
 * C++ Parity: `InfantryClass::Per_Cell_Process(PCP_END)` + chained
 * `FootClass::Per_Cell_Process`, ported into `footPerCellProcess`.
 *
 * ## C++ refs (authoritative)
 *
 *   - infantry.cpp:3992-4010  Cell-arrival snap (Distance(Head_To_Coord())<0x0010)
 *   - infantry.cpp:911-914    Enter_Idle_Mode + Commence at PCP_END end
 *   - foot.cpp:1471-1483      Path-shorten when target in weapon range
 *   - mission.cpp:343-359     Commence: MissionQueue → Mission, Timer=0
 *
 * ## What this file tests
 *
 *   1. Enter_Idle_Mode fires when ALL FOUR C++ guards hold, queuing
 *      `missionQueue=GUARD` (or `AREA_GUARD` when `guardOrigin` is set).
 *   2. Enter_Idle_Mode does NOT fire when any guard is violated:
 *        - `missionQueue` already non-null
 *        - `moveTarget` still set (NavCom legal)
 *        - `target.alive === true` (TarCom legal via target)
 *        - `targetStructure != null` (TarCom legal via structure)
 *        - caller-supplied `inRadioContact=true`
 *   3. Commence (infantry.cpp:914) pops the queue after Enter_Idle_Mode:
 *      `mission=GUARD`, `missionQueue=null`, `missionTimer=0`.
 *   4. When a pre-existing `missionQueue` (e.g. from Coordinate_Move queueing
 *      MOVE) is present, Enter_Idle_Mode's first guard (`missionQueue===null`)
 *      blocks its queue-overwrite — Commence pops the existing queue instead.
 *   5. PCP_DURING / PCP_ROTATION are no-ops.
 *   6. Flag gate: `FOOT_PER_CELL_ENABLED` is the master switch.
 *
 * Tests are data-driven over the six four-guard violations to document each
 * guard's C++ reference inline.
 */

import { describe, it, expect } from 'vitest';
import {
  PCPType,
  FOOT_PER_CELL_ENABLED,
  footPerCellProcess,
  type FootPCPEntity,
  type EnterIdleModeOptions,
} from '../engine/perCellProcess';

type M = 'GUARD' | 'AREA_GUARD' | 'MOVE' | 'HUNT' | 'ATTACK' | 'RESCUE';
const MISSIONS: EnterIdleModeOptions<M> = {
  guardMission: 'GUARD',
  areaGuardMission: 'AREA_GUARD',
  attackMission: 'ATTACK',
  huntMission: 'HUNT',
  rescueMission: 'RESCUE',
};

/** Factory for a baseline idle-infantry entity that would satisfy all four Enter_Idle_Mode guards. */
function idleInfantry(overrides: Partial<FootPCPEntity<M>> = {}): FootPCPEntity<M> {
  return {
    moveTarget: null,
    cell: { cx: 10, cy: 10 },
    path: [],
    pathIndex: 0,
    missionQueue: null,
    mission: 'MOVE',
    missionTimer: 5,
    isDriving: false,
    target: null,
    targetStructure: null,
    guardOrigin: null,
    ...overrides,
  };
}

describe('footPerCellProcess — C++ infantry.cpp:911-914 + foot.cpp PCP_END chain', () => {
  it('flag is ENABLED (Session 2.3 flip)', () => {
    expect(FOOT_PER_CELL_ENABLED).toBe(true);
  });

  // === Enter_Idle_Mode path (infantry.cpp:911) ===

  it('queues GUARD then Commence pops to Mission=GUARD when all 4 guards hold (no guardOrigin)', () => {
    const entity = idleInfantry();
    const r = footPerCellProcess(entity, PCPType.PCP_END,
      { hasLegalTarCom: false, inRadioContact: false }, MISSIONS);
    expect(entity.mission).toBe('GUARD');
    expect(entity.missionQueue).toBe(null);
    expect(entity.missionTimer).toBe(0); // C++ mission.cpp:354
    expect(r.commenceFired).toBe(true);
  });

  it('queues AREA_GUARD when guardOrigin is set (C++ Enter_Idle_Mode AreaPos branch)', () => {
    const entity = idleInfantry({ guardOrigin: { x: 240, y: 240 } });
    footPerCellProcess(entity, PCPType.PCP_END,
      { hasLegalTarCom: false, inRadioContact: false }, MISSIONS);
    expect(entity.mission).toBe('AREA_GUARD');
    expect(entity.missionQueue).toBe(null);
    expect(entity.missionTimer).toBe(0);
  });

  // === Guard-violation path ===

  it('skips Enter_Idle_Mode when missionQueue is already non-null (guard #1 violation)', () => {
    // C++ infantry.cpp:911: `MissionQueue == MISSION_NONE` required.
    // When violated, Enter_Idle_Mode doesn't run — BUT Commence still pops
    // the existing queue (e.g. Coordinate_Move queued a MOVE).
    const entity = idleInfantry({ missionQueue: 'MOVE' });
    const r = footPerCellProcess(entity, PCPType.PCP_END,
      { hasLegalTarCom: false, inRadioContact: false }, MISSIONS);
    expect(entity.mission).toBe('MOVE'); // popped existing queue, not GUARD
    expect(entity.missionQueue).toBe(null);
    expect(entity.missionTimer).toBe(0);
    expect(r.commenceFired).toBe(true);
  });

  it('skips Enter_Idle_Mode when moveTarget is set (guard #2 — NavCom legal)', () => {
    // C++ `!Target_Legal(NavCom)` required.
    const entity = idleInfantry({ moveTarget: { lx: 2000, ly: 2000 } });
    footPerCellProcess(entity, PCPType.PCP_END,
      { hasLegalTarCom: false, inRadioContact: false }, MISSIONS);
    expect(entity.mission).toBe('MOVE'); // unchanged — still on MOVE with live nav
    expect(entity.missionQueue).toBe(null); // never got queued
  });

  it('skips Enter_Idle_Mode when hasLegalTarCom=true (guard #3 — TarCom legal)', () => {
    // C++ `!Target_Legal(TarCom)` required. Caller supplies hasLegalTarCom.
    const entity = idleInfantry();
    footPerCellProcess(entity, PCPType.PCP_END,
      { hasLegalTarCom: true, inRadioContact: false }, MISSIONS);
    expect(entity.mission).toBe('MOVE');
    expect(entity.missionQueue).toBe(null);
  });

  it('skips Enter_Idle_Mode when inRadioContact=true (guard #4 — radio handshake)', () => {
    // C++ `!In_Radio_Contact()` required. TS infantry always pass false today
    // but the plumbing must honor true for forward-compatibility.
    const entity = idleInfantry();
    footPerCellProcess(entity, PCPType.PCP_END,
      { hasLegalTarCom: false, inRadioContact: true }, MISSIONS);
    expect(entity.mission).toBe('MOVE');
    expect(entity.missionQueue).toBe(null);
  });

  it('TarCom via live target alone (target.alive=true, no structure) blocks Enter_Idle_Mode', () => {
    // Caller computes hasLegalTarCom=true from entity.target.alive.
    const entity = idleInfantry({ target: { alive: true } });
    footPerCellProcess(entity, PCPType.PCP_END,
      { hasLegalTarCom: true, inRadioContact: false }, MISSIONS);
    expect(entity.mission).toBe('MOVE');
    expect(entity.missionQueue).toBe(null);
  });

  it('TarCom via targetStructure alone blocks Enter_Idle_Mode', () => {
    const entity = idleInfantry({ targetStructure: { id: 'S1' } });
    footPerCellProcess(entity, PCPType.PCP_END,
      { hasLegalTarCom: true, inRadioContact: false }, MISSIONS);
    expect(entity.mission).toBe('MOVE');
    expect(entity.missionQueue).toBe(null);
  });

  // === Non-PCP_END calls are no-ops ===

  it('PCP_DURING does not fire Commence or Enter_Idle_Mode', () => {
    const entity = idleInfantry();
    const r = footPerCellProcess(entity, PCPType.PCP_DURING,
      { hasLegalTarCom: false, inRadioContact: false }, MISSIONS);
    expect(entity.mission).toBe('MOVE');
    expect(entity.missionQueue).toBe(null);
    expect(r.commenceFired).toBe(false);
    expect(r.navComCleared).toBe(false);
  });

  it('PCP_ROTATION does not fire Commence or Enter_Idle_Mode', () => {
    const entity = idleInfantry();
    const r = footPerCellProcess(entity, PCPType.PCP_ROTATION,
      { hasLegalTarCom: false, inRadioContact: false }, MISSIONS);
    expect(entity.mission).toBe('MOVE');
    expect(entity.missionQueue).toBe(null);
    expect(r.commenceFired).toBe(false);
  });

  // === Commence semantics ===

  it('Commence after Enter_Idle_Mode matches C++ mission.cpp:343-359 (Timer=0 reset)', () => {
    const entity = idleInfantry({ missionTimer: 42 }); // stale timer from prior Mission.MOVE
    footPerCellProcess(entity, PCPType.PCP_END,
      { hasLegalTarCom: false, inRadioContact: false }, MISSIONS);
    expect(entity.missionTimer).toBe(0); // C++ mission.cpp:354
  });

  it('Commence pops existing queue (e.g. Coordinate_Move queued MOVE) without running Enter_Idle_Mode', () => {
    // SCG04-like scenario: a team coordinator queued MOVE; the unit is in GUARD.
    // At cell-arrival, infantry.cpp:911 guard #1 (missionQueue==null) blocks
    // Enter_Idle_Mode (MissionQueue is MOVE, not NONE). Commence at infantry.cpp:914
    // still fires and pops MOVE → Mission=MOVE.
    const entity = idleInfantry({ mission: 'GUARD', missionQueue: 'MOVE', missionTimer: 7 });
    const r = footPerCellProcess(entity, PCPType.PCP_END,
      { hasLegalTarCom: false, inRadioContact: false }, MISSIONS);
    expect(entity.mission).toBe('MOVE');
    expect(entity.missionQueue).toBe(null);
    expect(entity.missionTimer).toBe(0);
    expect(r.commenceFired).toBe(true);
  });

  it('runs FootClass path-shorten after infantry Commence, using the post-queue mission', () => {
    // C++ infantry.cpp:914 calls Commence() before chaining to
    // FootClass::Per_Cell_Process at infantry.cpp:963. Therefore a unit that
    // enters PCP_END as Mission=MOVE with MissionQueue=ATTACK is already on
    // Mission=ATTACK by the time foot.cpp:1479 checks the attack-type mission
    // gate, so path-shorten may clear NavCom immediately.
    const entity = idleInfantry({
      mission: 'MOVE',
      missionQueue: 'ATTACK',
      missionTimer: 7,
      moveTarget: { lx: 2000, ly: 2000 },
      path: [{ cx: 10, cy: 10 }, { cx: 11, cy: 10 }],
      pathIndex: 1,
      target: { alive: true },
    });
    const r = footPerCellProcess(entity, PCPType.PCP_END,
      {
        hasLegalTarCom: true,
        inRadioContact: false,
        pathShortenEligible: true,
        targetInRange: true,
      }, MISSIONS);

    expect(entity.mission).toBe('ATTACK');
    expect(entity.missionQueue).toBe(null);
    expect(entity.missionTimer).toBe(0);
    expect(entity.moveTarget).toBe(null);
    expect(entity.path).toEqual([]);
    expect(entity.pathIndex).toBe(0);
    expect(r.commenceFired).toBe(true);
    expect(r.navComCleared).toBe(true);
  });
});
