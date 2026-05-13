/**
 * C++ Behavioral Parity: PCP_END RADIO_IM_IN ground transport boarding.
 *
 * Pins the `tryBoardTransport` callback wired into the Per_Cell_Process hook
 * (see `engine/perCellProcess.ts`) for unit.cpp Case B and infantry.cpp's
 * matching boarding path.
 *
 * C++ source references (verbatim from `CnC_and_Red_Alert/RA/`):
 *
 *   unit.cpp:1657-1664   UnitClass::Per_Cell_Process — vehicle Case B
 *     TechnoClass * techno = Contact_With_Whom();
 *     if (Mission == MISSION_ENTER && techno
 *         && Coord_Cell(Coord) == Coord_Cell(techno->Coord)
 *         && techno == As_Techno(NavCom)) {
 *         if (Transmit_Message(RADIO_IM_IN) == RADIO_ATTACH) {
 *             Limbo();
 *             techno->Attach(this);
 *         }
 *         BEnd(BENCH_PCP);
 *         return;
 *     }
 *
 *   infantry.cpp:823-832  InfantryClass::Per_Cell_Process — same logic for
 *                         infantry. Identical structure to the vehicle path.
 *
 *   unit.cpp:761-766      APC RADIO_IM_IN receiver:
 *     case RADIO_IM_IN:
 *         if (How_Many() == Class->Max_Passengers()) APC_Close_Door();
 *         return(RADIO_ATTACH);
 *
 *   vessel.cpp:1388-1400  LST RADIO_IM_IN receiver — also returns RADIO_ATTACH.
 *
 * Observable invariants asserted by these tests:
 *   - `tryBoardTransport` predicate is invoked at PCP_END before Commence and
 *     before NavCom-at-destination clear.
 *   - When the predicate returns `'boarded'`, `result.boarded === true` and
 *     the hook returns early — neither Commence nor NavCom-clear fire.
 *   - When the predicate returns `'no_match'`, the hook continues with the
 *     existing Commence/NavCom-clear path.
 *   - PCP_DURING / PCP_ROTATION do not invoke the predicate.
 *   - In the engine integration: an infantry/vehicle in MISSION_ENTER reaching
 *     the same cell as a friendly transport whose NavCom == transport's cell
 *     ends up in `transport.passengers` and on the `_pendingTransportLoads`
 *     queue. End-of-tick processing removes it from `entities`.
 *
 * Case A note (unit.cpp:1635-1651): the building/service-depot RADIO_IM_IN
 * scatter branch is NOT modelled here because the TS engine does not yet
 * carry a STRUCT_REPAIR / service-depot building object in the cell
 * occupancy graph. That branch is documented as a follow-up in the
 * `perCellProcess.ts` header.
 */

/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import {
  PCPType,
  unitPerCellProcess,
  footPerCellProcess,
  type PCPEntity,
  type FootPCPEntity,
} from '../engine/perCellProcess';
import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  CELL_SIZE, House, MAP_CELLS, Mission, RESFACTOR, UnitType, LEPTON_SIZE,
} from '../engine/types';

// ── Hook-level tests (no engine wiring) ──────────────────────────────────────

type M = 'GUARD' | 'MOVE' | 'ATTACK' | 'ENTER';

function makeVehicle(overrides: Partial<PCPEntity<M>> = {}): PCPEntity<M> {
  return {
    moveTarget: null,
    cell: { cx: 0, cy: 0 },
    path: [],
    pathIndex: 0,
    missionQueue: null,
    mission: 'GUARD',
    missionTimer: 14,
    isDriving: true,
    ...overrides,
  };
}

function makeFoot(overrides: Partial<FootPCPEntity<M>> = {}): FootPCPEntity<M> {
  return {
    moveTarget: null,
    cell: { cx: 0, cy: 0 },
    path: [],
    pathIndex: 0,
    missionQueue: null,
    mission: 'GUARD',
    missionTimer: 14,
    isDriving: false,
    target: null,
    targetStructure: null,
    guardOrigin: null,
    ...overrides,
  };
}

const FOOT_MISSIONS = {
  guardMission: 'GUARD' as M,
  areaGuardMission: 'GUARD' as M,
  attackMission: 'ATTACK' as M,
  huntMission: 'ATTACK' as M,
  rescueMission: 'ATTACK' as M,
};

describe('unitPerCellProcess RADIO_IM_IN hook (C++ unit.cpp:1657-1664)', () => {
  it('invokes tryBoardTransport at PCP_END before Commence and NavCom-clear', () => {
    const callOrder: string[] = [];
    // C++ ordering: line 1657 IM_IN block is BEFORE line 1756 Commence and
    // BEFORE DriveClass::Per_Cell_Process NavCom clear (drive.cpp:869-873).
    // The callback short-circuits both subsequent steps when it returns
    // 'boarded'.
    const e = makeVehicle({
      moveTarget: { lx: 10 * 256 + 128, ly: 20 * 256 + 128 },
      cell: { cx: 10, cy: 20 }, // at NavCom destination — would normally clear
      missionQueue: 'MOVE',     // would normally Commence
      mission: 'ENTER',
      missionTimer: 5,
    });
    const r = unitPerCellProcess(e, PCPType.PCP_END, {
      tryBoardTransport: () => {
        callOrder.push('board');
        return 'boarded';
      },
    });

    expect(r.boarded).toBe(true);
    expect(r.commenceFired).toBe(false); // C++ line 1664 `return;` short-circuits
    expect(r.navComCleared).toBe(false); // DriveClass::Per_Cell_Process never runs
    expect(callOrder).toEqual(['board']);
    // Commence / NavCom-clear MUST NOT have mutated entity state.
    expect(e.mission).toBe('ENTER');
    expect(e.missionQueue).toBe('MOVE');
    expect(e.missionTimer).toBe(5);
    expect(e.moveTarget).not.toBe(null);
  });

  it('no_match lets Commence and NavCom-clear continue (C++ line 1657 outer if false)', () => {
    // When the outer `if` at unit.cpp:1657 is false (e.g. Mission != ENTER or
    // no shared cell), C++ skips the entire boarding block and continues with
    // Look/Commence/etc. Our predicate returns 'no_match' to signal that.
    const e = makeVehicle({
      moveTarget: { lx: 10 * 256 + 128, ly: 20 * 256 + 128 },
      cell: { cx: 10, cy: 20 }, // arrived at destination
      missionQueue: 'MOVE',
      mission: 'GUARD',
      missionTimer: 5,
    });
    const r = unitPerCellProcess(e, PCPType.PCP_END, {
      tryBoardTransport: () => 'no_match',
    });
    expect(r.boarded).toBe(false);
    expect(r.commenceFired).toBe(true); // C++ unit.cpp:1756 Commence still fires
    expect(r.navComCleared).toBe(true); // C++ drive.cpp:869 NavCom-clear fires
    expect(e.mission).toBe('MOVE');     // popped from queue
    expect(e.moveTarget).toBe(null);    // cleared
  });

  it('PCP_DURING does NOT call tryBoardTransport (C++ unit.cpp:1629 guard `if (why == PCP_END)`)', () => {
    let called = false;
    const e = makeVehicle({ mission: 'ENTER' });
    const r = unitPerCellProcess(e, PCPType.PCP_DURING, {
      tryBoardTransport: () => { called = true; return 'boarded'; },
    });
    expect(called).toBe(false);
    expect(r.boarded).toBe(false);
  });

  it('PCP_ROTATION does NOT call tryBoardTransport', () => {
    let called = false;
    const e = makeVehicle({ mission: 'ENTER' });
    const r = unitPerCellProcess(e, PCPType.PCP_ROTATION, {
      tryBoardTransport: () => { called = true; return 'boarded'; },
    });
    expect(called).toBe(false);
    expect(r.boarded).toBe(false);
  });

  it('PCPResult.boarded defaults to false when no callback supplied', () => {
    const e = makeVehicle({ mission: 'GUARD' });
    const r = unitPerCellProcess(e, PCPType.PCP_END);
    expect(r.boarded).toBe(false);
  });
});

describe('footPerCellProcess RADIO_IM_IN hook (C++ infantry.cpp:823-832)', () => {
  it('invokes tryBoardTransport at PCP_END before Enter_Idle_Mode and Commence', () => {
    // C++ infantry.cpp:823-832 fires BEFORE FootClass::Per_Cell_Process is
    // chained (line 963). InfantryClass also runs Enter_Idle_Mode at line
    // 808-817 BEFORE the boarding check — but the tests pin the callback's
    // short-circuit observable behavior: when 'boarded', neither
    // Enter_Idle_Mode queue assignment nor Commence nor path-shorten fire.
    const e = makeFoot({
      mission: 'ENTER',
      moveTarget: { lx: 10 * 256 + 128, ly: 20 * 256 + 128 },
      cell: { cx: 10, cy: 20 },
      missionQueue: 'MOVE',
      missionTimer: 5,
    });
    const r = footPerCellProcess(
      e,
      PCPType.PCP_END,
      {
        hasLegalTarCom: false,
        inRadioContact: false,
        pathShortenEligible: false,
        targetInRange: false,
        tryBoardTransport: () => 'boarded',
      },
      FOOT_MISSIONS,
    );
    expect(r.boarded).toBe(true);
    expect(r.commenceFired).toBe(false);
    expect(r.navComCleared).toBe(false);
    expect(e.mission).toBe('ENTER');     // not touched
    expect(e.missionQueue).toBe('MOVE'); // not popped
  });

  it('no_match continues with the existing PCP_END chain (Enter_Idle_Mode + Commence)', () => {
    const e = makeFoot({
      mission: 'MOVE',
      moveTarget: null,
      cell: { cx: 5, cy: 5 },
      missionQueue: null,
      missionTimer: 7,
      target: null,
      targetStructure: null,
      guardOrigin: null,
    });
    const r = footPerCellProcess(
      e,
      PCPType.PCP_END,
      {
        hasLegalTarCom: false,
        inRadioContact: false,
        tryBoardTransport: () => 'no_match',
      },
      FOOT_MISSIONS,
    );
    expect(r.boarded).toBe(false);
    // Enter_Idle_Mode queued GUARD; Commence then popped → mission=GUARD,timer=0
    expect(e.mission).toBe('GUARD');
    expect(e.missionQueue).toBe(null);
    expect(e.missionTimer).toBe(0);
  });
});

// ── Engine integration tests ─────────────────────────────────────────────────

class FakeAudio {
  src = ''; preload = ''; volume = 1; currentTime = 0; muted = false; loop = false;
  addEventListener(): void {} removeEventListener(): void {}
  play(): Promise<void> { return Promise.resolve(); } pause(): void {}
  cloneNode(): FakeAudio { return new FakeAudio(); }
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320 * RESFACTOR;
  canvas.height = 200 * RESFACTOR;
  return canvas;
}

function createGame(width = 64, height = 64): Game {
  const game = new Game(createCanvas());
  game.map.setBounds(0, 0, width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) game.map.setTerrain(x, y, 0);
  }
  return game;
}

function placeAtCell(entity: Entity, cx: number, cy: number): void {
  entity.leptonX = cx * LEPTON_SIZE + 128;
  entity.leptonY = cy * LEPTON_SIZE + 128;
  entity.syncPosFromLeptons();
  entity.prevPos = { x: entity.pos.x, y: entity.pos.y };
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => { resetEntityIds(); });

describe('Engine: tryPCPBoardTransport invariants (Game.tryPCPBoardTransport)', () => {
  type GamePriv = Game & {
    tryPCPBoardTransport(e: Entity): 'boarded' | 'no_match';
    _pendingTransportLoads: number[];
  };

  it('Mission.ENTER infantry on transport cell with NavCom == transport cell → boards (Limbo+Attach)', () => {
    const game = createGame() as GamePriv;
    const apc = new Entity(UnitType.V_APC, House.Spain, 0, 0);
    placeAtCell(apc, 10, 10);

    const e1 = new Entity(UnitType.I_E1, House.Spain, 0, 0);
    placeAtCell(e1, 10, 10); // same cell as APC
    e1.mission = Mission.ENTER;
    e1.moveTarget = { lx: 10 * LEPTON_SIZE + 128, ly: 10 * LEPTON_SIZE + 128 };

    for (const ent of [apc, e1]) {
      game.entities.push(ent);
      game.entityById.set(ent.id, ent);
    }

    const verdict = game.tryPCPBoardTransport(e1);

    expect(verdict).toBe('boarded');
    // C++ techno->Attach(this): infantry now lives in apc.passengers.
    expect(apc.passengers).toContain(e1);
    expect(e1.transportRef).toBe(apc);
    // C++ Limbo(): pending removal from active list (end-of-tick flush).
    expect(game._pendingTransportLoads).toContain(e1.id);
    // Mission set to SLEEP per existing TS limbo convention (line 6302).
    expect(e1.mission).toBe(Mission.SLEEP);
  });

  it('vehicle (MCV) in MISSION_ENTER on LST cell with NavCom == LST cell → boards', () => {
    // C++ vessel.cpp:1388-1400 — LST RADIO_IM_IN returns RADIO_ATTACH for
    // FootClass cargo (Max_Passengers=5). The MCV in MISSION_ENTER on the
    // same cell as the LST drives onto the deck and attaches.
    const game = createGame() as GamePriv;
    const lst = new Entity(UnitType.V_LST, House.Spain, 0, 0);
    placeAtCell(lst, 15, 15);

    const mcv = new Entity(UnitType.V_MCV, House.Spain, 0, 0);
    placeAtCell(mcv, 15, 15);
    mcv.mission = Mission.ENTER;
    mcv.moveTarget = { lx: 15 * LEPTON_SIZE + 128, ly: 15 * LEPTON_SIZE + 128 };

    for (const ent of [lst, mcv]) {
      game.entities.push(ent);
      game.entityById.set(ent.id, ent);
    }

    const verdict = game.tryPCPBoardTransport(mcv);

    expect(verdict).toBe('boarded');
    expect(lst.passengers).toContain(mcv);
    expect(mcv.transportRef).toBe(lst);
    expect(game._pendingTransportLoads).toContain(mcv.id);
  });

  it('full transport: still returns "boarded" but does NOT attach (C++ unit.cpp:1664 early return is unconditional)', () => {
    // C++ unit.cpp:1657-1664: `return;` lives OUTSIDE the
    // `if (Transmit_Message(RADIO_IM_IN) == RADIO_ATTACH)` block. The
    // boarding check short-circuits PCP_END regardless of whether Attach
    // actually succeeded.
    const game = createGame() as GamePriv;
    const apc = new Entity(UnitType.V_APC, House.Spain, 0, 0);
    placeAtCell(apc, 10, 10);
    // Fill APC to max capacity (5).
    for (let i = 0; i < apc.maxPassengers; i++) {
      const filler = new Entity(UnitType.I_E1, House.Spain, 0, 0);
      apc.passengers.push(filler);
    }

    const e1 = new Entity(UnitType.I_E1, House.Spain, 0, 0);
    placeAtCell(e1, 10, 10);
    e1.mission = Mission.ENTER;
    e1.moveTarget = { lx: 10 * LEPTON_SIZE + 128, ly: 10 * LEPTON_SIZE + 128 };
    game.entities.push(apc, e1);
    game.entityById.set(apc.id, apc);
    game.entityById.set(e1.id, e1);

    const verdict = game.tryPCPBoardTransport(e1);

    expect(verdict).toBe('boarded'); // C++ early-return still fires
    expect(apc.passengers.length).toBe(5); // not attached (capacity full)
    expect(apc.passengers).not.toContain(e1);
    expect(e1.transportRef).toBeNull();
    expect(game._pendingTransportLoads).not.toContain(e1.id);
    expect(e1.mission).toBe(Mission.ENTER); // not Limbo'd
  });

  it('unit not in same cell as transport → no_match (C++ Coord_Cell(Coord) != Coord_Cell(techno->Coord))', () => {
    const game = createGame() as GamePriv;
    const apc = new Entity(UnitType.V_APC, House.Spain, 0, 0);
    placeAtCell(apc, 10, 10);

    const e1 = new Entity(UnitType.I_E1, House.Spain, 0, 0);
    placeAtCell(e1, 9, 10); // adjacent — NOT same cell
    e1.mission = Mission.ENTER;
    e1.moveTarget = { lx: 10 * LEPTON_SIZE + 128, ly: 10 * LEPTON_SIZE + 128 };

    game.entities.push(apc, e1);
    game.entityById.set(apc.id, apc);
    game.entityById.set(e1.id, e1);

    const verdict = game.tryPCPBoardTransport(e1);

    expect(verdict).toBe('no_match');
    expect(apc.passengers).not.toContain(e1);
    expect(e1.mission).toBe(Mission.ENTER); // still trying
  });

  it('NavCom does NOT point at transport cell → no_match (C++ techno != As_Techno(NavCom))', () => {
    // The unit happens to be on the transport's cell but its NavCom points
    // elsewhere (e.g. unit is walking past the transport on the way to
    // another destination). C++ requires `techno == As_Techno(NavCom)` —
    // i.e. the transport IS the NavCom target — so this is a no-match.
    const game = createGame() as GamePriv;
    const apc = new Entity(UnitType.V_APC, House.Spain, 0, 0);
    placeAtCell(apc, 10, 10);

    const e1 = new Entity(UnitType.I_E1, House.Spain, 0, 0);
    placeAtCell(e1, 10, 10);
    e1.mission = Mission.ENTER;
    e1.moveTarget = { lx: 20 * LEPTON_SIZE + 128, ly: 20 * LEPTON_SIZE + 128 }; // ≠ APC cell

    game.entities.push(apc, e1);
    game.entityById.set(apc.id, apc);
    game.entityById.set(e1.id, e1);

    const verdict = game.tryPCPBoardTransport(e1);

    expect(verdict).toBe('no_match');
    expect(apc.passengers).not.toContain(e1);
  });

  it('Mission != ENTER → no_match (C++ Mission == MISSION_ENTER guard)', () => {
    const game = createGame() as GamePriv;
    const apc = new Entity(UnitType.V_APC, House.Spain, 0, 0);
    placeAtCell(apc, 10, 10);

    const e1 = new Entity(UnitType.I_E1, House.Spain, 0, 0);
    placeAtCell(e1, 10, 10);
    e1.mission = Mission.MOVE; // NOT ENTER
    e1.moveTarget = { lx: 10 * LEPTON_SIZE + 128, ly: 10 * LEPTON_SIZE + 128 };

    game.entities.push(apc, e1);
    game.entityById.set(apc.id, apc);
    game.entityById.set(e1.id, e1);

    const verdict = game.tryPCPBoardTransport(e1);

    expect(verdict).toBe('no_match');
    expect(apc.passengers).not.toContain(e1);
  });

  it('non-allied transport in same cell → no_match (C++ House->Is_Ally guard)', () => {
    // C++ unit.cpp:730 / vessel.cpp:1365 RADIO_CAN_LOAD has the
    // House->Is_Ally(from->Owner()) gate before allowing RADIO_ROGER.
    // RADIO_IM_IN reuses the radio peer set up via RADIO_HELLO, which is
    // alliance-gated, so an enemy transport never enters that contact in
    // the first place. We mirror the alliance check directly in the
    // boarding lookup.
    const game = createGame() as GamePriv;
    const apc = new Entity(UnitType.V_APC, House.USSR, 0, 0); // Soviet
    placeAtCell(apc, 10, 10);

    const e1 = new Entity(UnitType.I_E1, House.Spain, 0, 0); // Allied
    placeAtCell(e1, 10, 10);
    e1.mission = Mission.ENTER;
    e1.moveTarget = { lx: 10 * LEPTON_SIZE + 128, ly: 10 * LEPTON_SIZE + 128 };

    game.entities.push(apc, e1);
    game.entityById.set(apc.id, apc);
    game.entityById.set(e1.id, e1);

    const verdict = game.tryPCPBoardTransport(e1);

    expect(verdict).toBe('no_match');
    expect(apc.passengers).not.toContain(e1);
  });

  it('end-of-tick processing removes Limbo\'d unit from active entities (C++ Limbo() effect)', () => {
    // C++ Limbo() detaches the object from Map.Layer / Logic.Get() so AI no
    // longer iterates over it. TS mirrors this via _pendingTransportLoads
    // which is flushed in advanceTick (index.ts:2358-2378). Verify the flush
    // actually drops the entity.
    const game = createGame() as GamePriv;
    const apc = new Entity(UnitType.V_APC, House.Spain, 0, 0);
    placeAtCell(apc, 10, 10);

    const e1 = new Entity(UnitType.I_E1, House.Spain, 0, 0);
    placeAtCell(e1, 10, 10);
    e1.mission = Mission.ENTER;
    e1.moveTarget = { lx: 10 * LEPTON_SIZE + 128, ly: 10 * LEPTON_SIZE + 128 };
    game.entities.push(apc, e1);
    game.entityById.set(apc.id, apc);
    game.entityById.set(e1.id, e1);

    expect(game.tryPCPBoardTransport(e1)).toBe('boarded');
    expect(game.entities).toContain(e1);

    // Drive the end-of-tick flush. `update()` is the per-tick entry; the
    // _pendingTransportLoads block lives near line 2358.
    (game as unknown as { update(): void }).update();

    expect(game.entities).not.toContain(e1);
    expect(game.entityById.get(e1.id)).toBeUndefined();
    expect(apc.passengers).toContain(e1); // still attached
  });
});
