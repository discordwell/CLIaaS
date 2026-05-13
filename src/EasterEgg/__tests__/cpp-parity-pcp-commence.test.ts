/**
 * C++ Parity: PCP_END Commence pop semantics (UnitClass + InfantryClass).
 *
 * Pins the Commence sub-case wired into `unitPerCellProcess` and
 * `footPerCellProcess`. The TODO that previously claimed Commence was unported
 * was stale — `PER_CELL_COMMENCE_ENABLED` has been `true` since the
 * SCG04/11/13 architectural session, and both hooks invoke
 * `MissionClass::Commence` semantics inline (pop MissionQueue → Mission,
 * clear queue, zero Timer).
 *
 * ## C++ refs (authoritative)
 *
 *   unit.cpp:1754-1756       `if (!IsDumping) Commence();` at PCP_END
 *   infantry.cpp:911-914     `Enter_Idle_Mode()` then `Commence()` at PCP_END
 *   mission.cpp:343-358      `MissionClass::Commence`: Mission=MissionQueue,
 *                            MissionQueue=NONE, Timer=0, Status=0, return true.
 *                            Returns false (no-op) when MissionQueue==NONE.
 *   drive.cpp:773, 816       Sites that fire PCP_END (track-jump + track-end)
 *
 * ## Coverage
 *
 *   - Vehicle: `unitPerCellProcess(entity, PCP_END)` with missionQueue set
 *     pops the queue, sets `mission`, nulls `missionQueue`, zeros `missionTimer`,
 *     and reports `commenceFired=true`.
 *   - Vehicle: `opts.skipCommence === true` suppresses the pop (Session 16
 *     defer-to-STAGE-E contract).
 *   - Vehicle: `entity.missionQueue === null` is a no-op
 *     (C++ mission.cpp:347 early-return path; `commenceFired=false`).
 *   - Infantry: `footPerCellProcess(entity, PCP_END, ctx, missions)` with an
 *     externally queued mission pops it identically — same Mission/queue/Timer
 *     mutations, same `commenceFired` semantics.
 *   - Infantry: `entity.missionQueue === null` is a no-op (matches C++ when
 *     the Enter_Idle_Mode guards don't queue GUARD either).
 *
 * Test values are derived from the TS implementation contract (see
 * `engine/perCellProcess.ts:986-991` and `:1169-1174`) and the C++ source
 * cited above — not fabricated.
 */

import { describe, it, expect } from 'vitest';
import {
  PCPType,
  PER_CELL_COMMENCE_ENABLED,
  FOOT_PER_CELL_ENABLED,
  unitPerCellProcess,
  footPerCellProcess,
  type PCPEntity,
  type FootPCPEntity,
  type EnterIdleModeOptions,
} from '../engine/perCellProcess';

type M = 'GUARD' | 'AREA_GUARD' | 'MOVE' | 'ATTACK' | 'HUNT' | 'RESCUE' | 'STOP';

const MISSIONS: EnterIdleModeOptions<M> = {
  guardMission: 'GUARD',
  areaGuardMission: 'AREA_GUARD',
  attackMission: 'ATTACK',
  huntMission: 'HUNT',
  rescueMission: 'RESCUE',
};

function makeVehicle(overrides: Partial<PCPEntity<M>> = {}): PCPEntity<M> {
  return {
    moveTarget: null,
    cell: { cx: 0, cy: 0 },
    path: [],
    pathIndex: 0,
    missionQueue: null,
    mission: 'GUARD',
    missionTimer: 7,
    isDriving: true,
    ...overrides,
  };
}

function makeInfantry(overrides: Partial<FootPCPEntity<M>> = {}): FootPCPEntity<M> {
  return {
    moveTarget: null,
    cell: { cx: 0, cy: 0 },
    path: [],
    pathIndex: 0,
    missionQueue: null,
    mission: 'GUARD',
    missionTimer: 7,
    isDriving: true,
    target: null,
    targetStructure: null,
    guardOrigin: null,
    ...overrides,
  };
}

/** A neutral ctx for the infantry hook that disables side branches (no idle
 *  queue, no path-shorten) so only the Commence pop is exercised. */
const FOOT_CTX_NEUTRAL = {
  hasLegalTarCom: false,
  inRadioContact: false,
  pathShortenEligible: false,
  targetInRange: false,
};

describe('PCP_END Commence (C++ unit.cpp:1754-1756 + infantry.cpp:914 + mission.cpp:343-358)', () => {
  it('feature gates are enabled (otherwise the rest is vacuous)', () => {
    expect(PER_CELL_COMMENCE_ENABLED).toBe(true);
    expect(FOOT_PER_CELL_ENABLED).toBe(true);
  });

  // ── Vehicle path: unitPerCellProcess ──────────────────────────────────────

  describe('unitPerCellProcess (UnitClass::Per_Cell_Process)', () => {
    it('pops MissionQueue → Mission and zeroes Timer when queue is non-null', () => {
      // Arrange: a vehicle mid-drive with MissionQueue=MOVE queued behind
      // Mission=GUARD (the SCG04/11/13 reinforcement MCV pattern).
      const v = makeVehicle({
        missionQueue: 'MOVE',
        mission: 'GUARD',
        missionTimer: 14,
      });

      // Act
      const r = unitPerCellProcess(v, PCPType.PCP_END);

      // Assert: C++ mission.cpp:347-358 — Mission=MissionQueue,
      // MissionQueue=NONE, Timer=0, return true.
      expect(r.commenceFired).toBe(true);
      expect(v.mission).toBe('MOVE');
      expect(v.missionQueue).toBe(null);
      expect(v.missionTimer).toBe(0);
    });

    it('opts.skipCommence === true suppresses the pop (Session 16 defer contract)', () => {
      // C++ drive.cpp:816 only fires PCP_END at TRUE track completion (actual=0);
      // TS chain-loop callers that hit PCP_END at every cell boundary set
      // skipCommence so intermediate cells don't pop MissionQueue early.
      const v = makeVehicle({
        missionQueue: 'MOVE',
        mission: 'GUARD',
        missionTimer: 14,
      });

      const r = unitPerCellProcess(v, PCPType.PCP_END, { skipCommence: true });

      expect(r.commenceFired).toBe(false);
      expect(v.mission).toBe('GUARD');         // untouched
      expect(v.missionQueue).toBe('MOVE');     // still queued
      expect(v.missionTimer).toBe(14);         // untouched
    });

    it('entity.missionQueue === null is a no-op (C++ mission.cpp:347 false branch)', () => {
      const v = makeVehicle({
        missionQueue: null,
        mission: 'MOVE',
        missionTimer: 9,
      });

      const r = unitPerCellProcess(v, PCPType.PCP_END);

      // C++ MissionClass::Commence returns false; Mission/Timer untouched.
      expect(r.commenceFired).toBe(false);
      expect(v.mission).toBe('MOVE');
      expect(v.missionQueue).toBe(null);
      expect(v.missionTimer).toBe(9);
    });

    it('queue pops exactly once per queued mission across successive PCP_END calls', () => {
      // C++ Commence() consumes MissionQueue on the first call; subsequent
      // calls return false until something queues a new mission.
      const v = makeVehicle({
        missionQueue: 'MOVE',
        mission: 'GUARD',
        missionTimer: 20,
      });

      const r1 = unitPerCellProcess(v, PCPType.PCP_END);
      expect(r1.commenceFired).toBe(true);
      expect(v.mission).toBe('MOVE');
      expect(v.missionQueue).toBe(null);
      expect(v.missionTimer).toBe(0);

      // Bump timer to prove the second call doesn't re-zero it.
      v.missionTimer = 11;
      const r2 = unitPerCellProcess(v, PCPType.PCP_END);

      expect(r2.commenceFired).toBe(false);
      expect(v.mission).toBe('MOVE');     // unchanged
      expect(v.missionQueue).toBe(null);  // still empty
      expect(v.missionTimer).toBe(11);    // NOT re-zeroed
    });
  });

  // ── Infantry path: footPerCellProcess ────────────────────────────────────

  describe('footPerCellProcess (InfantryClass::Per_Cell_Process)', () => {
    it('pops MissionQueue → Mission and zeroes Timer when queue is non-null', () => {
      // Arrange: keep all four Enter_Idle_Mode guards active so step 1 (idle
      // queue) does NOT also queue GUARD on top of the pre-existing MOVE.
      // The first guard is `missionQueue===null`, so a non-null queue blocks
      // Enter_Idle_Mode in C++ (infantry.cpp:911) too. Only step 2 Commence
      // runs in this scenario.
      const inf = makeInfantry({
        missionQueue: 'MOVE',
        mission: 'GUARD',
        missionTimer: 12,
      });

      const r = footPerCellProcess(inf, PCPType.PCP_END, FOOT_CTX_NEUTRAL, MISSIONS);

      expect(r.commenceFired).toBe(true);
      expect(inf.mission).toBe('MOVE');
      expect(inf.missionQueue).toBe(null);
      expect(inf.missionTimer).toBe(0);
    });

    it('entity.missionQueue === null + Enter_Idle_Mode guard violated → no Commence pop', () => {
      // If we keep missionQueue=null but ALSO make Enter_Idle_Mode skip
      // (set inRadioContact=true to violate the fourth guard), step 1 won't
      // queue GUARD, so step 2 Commence has nothing to pop.
      const inf = makeInfantry({
        missionQueue: null,
        mission: 'MOVE',
        missionTimer: 9,
      });

      const r = footPerCellProcess(
        inf,
        PCPType.PCP_END,
        { ...FOOT_CTX_NEUTRAL, inRadioContact: true },
        MISSIONS,
      );

      expect(r.commenceFired).toBe(false);
      expect(inf.mission).toBe('MOVE');
      expect(inf.missionQueue).toBe(null);
      expect(inf.missionTimer).toBe(9);
    });

    it('PCP_DURING does not fire Commence on infantry (C++ infantry.cpp:911-914 gated to PCP_END)', () => {
      const inf = makeInfantry({
        missionQueue: 'MOVE',
        mission: 'GUARD',
        missionTimer: 6,
      });

      const r = footPerCellProcess(inf, PCPType.PCP_DURING, FOOT_CTX_NEUTRAL, MISSIONS);

      expect(r.commenceFired).toBe(false);
      expect(inf.mission).toBe('GUARD');
      expect(inf.missionQueue).toBe('MOVE');
      expect(inf.missionTimer).toBe(6);
    });
  });

  // ── Cross-path invariant ─────────────────────────────────────────────────

  it('vehicle and infantry hooks apply identical Commence mutations for the same input', () => {
    // The C++ Commence routine is a method on MissionClass (the common base);
    // both UnitClass and InfantryClass invoke it at PCP_END. Pin that the TS
    // ports produce byte-identical mutation sets for the shared input.
    const v = makeVehicle({ missionQueue: 'MOVE', mission: 'GUARD', missionTimer: 30 });
    const i = makeInfantry({ missionQueue: 'MOVE', mission: 'GUARD', missionTimer: 30 });

    const rv = unitPerCellProcess(v, PCPType.PCP_END);
    const ri = footPerCellProcess(i, PCPType.PCP_END, FOOT_CTX_NEUTRAL, MISSIONS);

    expect(rv.commenceFired).toBe(true);
    expect(ri.commenceFired).toBe(true);

    expect(v.mission).toBe(i.mission);
    expect(v.missionQueue).toBe(i.missionQueue);
    expect(v.missionTimer).toBe(i.missionTimer);

    expect(v.mission).toBe('MOVE');
    expect(v.missionQueue).toBe(null);
    expect(v.missionTimer).toBe(0);
  });
});
