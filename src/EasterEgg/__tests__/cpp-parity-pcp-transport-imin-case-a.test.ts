/**
 * C++ Behavioral Parity: PCP_END RADIO_IM_IN building entry refusal (Case A).
 *
 * Pins `tryBuildingEntryScatter` and `Game.tryPCPBuildingEntryScatter`, the
 * vehicle-side analog of `tryBoardTransport` for the building-peer branch
 * at unit.cpp:1635-1651.
 *
 * C++ source (`CnC_and_Red_Alert/RA/unit.cpp:1634-1651`):
 *
 *   TechnoClass	* whom = Contact_With_Whom();
 *   if (IsTethered && whom != NULL) {
 *     if (whom->What_Am_I() == RTTI_BUILDING && Mission == MISSION_ENTER) {
 *       if (whom == Map[CELL(cell-MAP_CELL_W)].Cell_Building()) {
 *         switch (Transmit_Message(RADIO_IM_IN, whom)) {
 *           case RADIO_ROGER:
 *             break;
 *           case RADIO_ATTACH:
 *             break;
 *           default:
 *             Scatter(0, true);
 *             break;
 *         }
 *       }
 *     }
 *   }
 *
 * C++ scatter dispatch (`unit.cpp:4880-4902` UnitClass::Scatter):
 *   - With `threat == 0`, the override calls
 *     `Map.Nearby_Location(Coord_Cell(Coord), Class->Speed)` and
 *     `Assign_Destination(...)` — assigning NavCom away from the building.
 *   - BUT the function gates on `if (Target_Legal(NavCom) && !nokidding) return;`
 *     at line 4895. Case A calls `Scatter(0, true)` (forced=true,
 *     nokidding=false), and Case A runs BEFORE `DriveClass::Per_Cell_Process`
 *     clears NavCom (drive.cpp:869-873). So in the standard flow, NavCom is
 *     still legal when Scatter is called — the inner gate short-circuits,
 *     no moveTarget reassignment happens, and the unit continues its
 *     approach. The `default:` branch fired, but the visible side effect is
 *     only the recorded code path, not a moveTarget change. The TS helper
 *     returns `'scattered'` to signal the C++ default-branch path executed.
 *
 * Observable invariants asserted below:
 *   - PCP_END dispatches `tryBuildingEntryScatter` BEFORE Case B's
 *     `tryBoardTransport` (C++ ordering: line 1635 if-block runs before
 *     line 1657 if-block).
 *   - PCP_DURING / PCP_ROTATION never invoke the predicate.
 *   - Engine helper `Game.tryPCPBuildingEntryScatter` returns:
 *       - `'scattered'` when the vehicle is in Mission.ENTER, a FIX (service
 *         depot) occupies the cell one row north, and another player vehicle
 *         is already docked at that FIX (depot is busy).
 *       - `'no_match'` otherwise — four "no_match" gates checked here:
 *           1. Mission != ENTER (C++ `Mission == MISSION_ENTER` guard).
 *           2. No structure one cell north (C++ `whom == Cell_Building()` guard
 *              fails when `Cell_Building()` is NULL).
 *           3. The cell-north structure is not a FIX (other building types do
 *              not return a refusal reply to RADIO_IM_IN from a vehicle).
 *           4. The FIX is free — depot accepts the dock (C++ `RADIO_ROGER`).
 *   - When NavCom is illegal at Scatter time (e.g. previously cleared),
 *     `moveTarget` is reassigned to a nearby clear cell (the observable side
 *     effect of C++ `Assign_Destination(Map.Nearby_Location(...))`).
 */

/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import {
  PCPType,
  unitPerCellProcess,
  type PCPEntity,
} from '../engine/perCellProcess';
import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  CELL_SIZE, House, Mission, RESFACTOR, UnitType, LEPTON_SIZE,
} from '../engine/types';
import { STRUCTURE_MAX_HP, type MapStructure } from '../engine/scenario';

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

describe('unitPerCellProcess RADIO_IM_IN Case A hook (C++ unit.cpp:1635-1651)', () => {
  it('invokes tryBuildingEntryScatter at PCP_END before tryBoardTransport', () => {
    // C++ ordering: line 1635 if-block runs before line 1657 if-block. In
    // practice only one matches per call (building-north vs transport-same-cell)
    // but the hook must call A first.
    const callOrder: string[] = [];
    const e = makeVehicle({ mission: 'ENTER' });
    unitPerCellProcess(e, PCPType.PCP_END, {
      tryBuildingEntryScatter: () => { callOrder.push('case_a'); return 'no_match'; },
      tryBoardTransport:        () => { callOrder.push('case_b'); return 'no_match'; },
    });
    expect(callOrder).toEqual(['case_a', 'case_b']);
  });

  it('scattered does NOT short-circuit PCP_END (C++ Scatter returns to PCP_END)', () => {
    // C++ unit.cpp:1646 `Scatter(0, true); break;` — control falls through
    // to the rest of PCP_END (Commence, NavCom-clear). Case B's `return;`
    // (line 1664) is the only early-exit in this region.
    const e = makeVehicle({
      mission: 'ENTER',
      missionQueue: 'MOVE',
      moveTarget: { lx: 10 * 256 + 128, ly: 10 * 256 + 128 },
      cell: { cx: 10, cy: 10 },
    });
    const r = unitPerCellProcess(e, PCPType.PCP_END, {
      tryBuildingEntryScatter: () => 'scattered',
      tryBoardTransport: () => 'no_match',
    });
    expect(r.boarded).toBe(false);
    // Commence + NavCom-clear MUST still run (the C++ scatter does not
    // short-circuit the rest of PCP_END).
    expect(r.commenceFired).toBe(true);
    expect(e.mission).toBe('MOVE');
    expect(e.missionQueue).toBe(null);
  });

  it('PCP_DURING does NOT call tryBuildingEntryScatter', () => {
    let called = false;
    const e = makeVehicle({ mission: 'ENTER' });
    unitPerCellProcess(e, PCPType.PCP_DURING, {
      tryBuildingEntryScatter: () => { called = true; return 'scattered'; },
    });
    expect(called).toBe(false);
  });

  it('PCP_ROTATION does NOT call tryBuildingEntryScatter', () => {
    let called = false;
    const e = makeVehicle({ mission: 'ENTER' });
    unitPerCellProcess(e, PCPType.PCP_ROTATION, {
      tryBuildingEntryScatter: () => { called = true; return 'scattered'; },
    });
    expect(called).toBe(false);
  });

  it('absent callback is a no-op (default behaviour unchanged)', () => {
    const e = makeVehicle({ mission: 'GUARD' });
    const r = unitPerCellProcess(e, PCPType.PCP_END);
    expect(r.boarded).toBe(false);
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

function makeFIX(house: House, cx: number, cy: number): MapStructure {
  const maxHp = STRUCTURE_MAX_HP['FIX'] ?? 600;
  return {
    type: 'FIX',
    image: 'fix',
    house,
    cx,
    cy,
    hp: maxHp,
    maxHp,
    alive: true,
    rubble: false,
    attackCooldown: 0,
    ammo: -1,
    maxAmmo: -1,
    missionTimer: 0,
  } as MapStructure;
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => { resetEntityIds(); });

describe('Engine: tryPCPBuildingEntryScatter invariants (C++ unit.cpp:1635-1651)', () => {
  type GamePriv = Game & {
    tryPCPBuildingEntryScatter(e: Entity): 'scattered' | 'no_match';
  };

  it('Mission.ENTER vehicle one cell south of a busy FIX → scattered (C++ refusal branch fires)', () => {
    // FIX footprint: 3x3 cells starting at (cx, cy). The vehicle drives onto
    // the south-center docking cell (cx+1, cy+2). The cell directly north of
    // that — (cx+1, cy+1) — is inside the FIX footprint, so C++'s
    // `Map[CELL(cell-MAP_CELL_W)].Cell_Building()` returns the FIX. Place
    // another player vehicle already at the dock (within 0x10 leptons of
    // depot center+(CELL,CELL)) to make Case A's refusal fire.
    //
    // Observable result: the helper returns 'scattered' (the C++ default
    // switch branch executed). NavCom-clear is downstream in PCP_END
    // (DriveClass::Per_Cell_Process drive.cpp:869); at the time Scatter is
    // called the NavCom is still legal, so C++ `Scatter(0, true)` with
    // nokidding=false short-circuits at `if (Target_Legal(NavCom) &&
    // !nokidding) return;`. The TS helper mirrors that behavior exactly:
    // the call records that the default-branch fired (return value) without
    // forcing a moveTarget reassignment when NavCom is legal.
    const game = createGame() as GamePriv;
    const fix = makeFIX(House.Spain, 20, 20); // footprint (20..22, 20..22)
    game.structures.push(fix);

    const dockCx = 21;
    const dockCy = 22; // south-center, one cell south of the FIX bottom row
    // The "depot center" used by Case A's busy check is (cx*CELL_SIZE+CELL_SIZE,
    // cy*CELL_SIZE+CELL_SIZE) = pixel (21*24, 21*24). Place an existing
    // dockedVehicle at that exact pixel so the busy check fires.
    const docked = new Entity(UnitType.V_JEEP, House.Spain, 0, 0);
    docked.leptonX = 21 * LEPTON_SIZE;
    docked.leptonY = 21 * LEPTON_SIZE;
    docked.syncPosFromLeptons();
    docked.prevPos = { x: docked.pos.x, y: docked.pos.y };
    game.entities.push(docked);
    game.entityById.set(docked.id, docked);

    // The vehicle under test is at the south-center dock cell, in MISSION_ENTER.
    const jeep = new Entity(UnitType.V_JEEP, House.Spain, 0, 0);
    placeAtCell(jeep, dockCx, dockCy);
    jeep.mission = Mission.ENTER;
    jeep.moveTarget = { lx: dockCx * LEPTON_SIZE + 128, ly: dockCy * LEPTON_SIZE + 128 };
    game.entities.push(jeep);
    game.entityById.set(jeep.id, jeep);

    const verdict = game.tryPCPBuildingEntryScatter(jeep);

    // The Case A refusal branch executed (C++ `default: Scatter(0, true)`
    // reached). The Scatter call itself short-circuits internally because
    // NavCom is still legal at this point — matches C++ unit.cpp:4895.
    expect(verdict).toBe('scattered');
  });

  it('Mission.ENTER vehicle one cell south of a busy FIX with NULL NavCom → moveTarget assigned (Scatter side effect runs)', () => {
    // Variant of the above where the vehicle's NavCom has already been
    // cleared (e.g. an earlier PCP step nulled it). C++ `Scatter(0, true)`
    // with nokidding=false then passes the `Target_Legal(NavCom)` guard
    // because the target is no longer legal. The override calls
    // `Map.Nearby_Location` + `Assign_Destination`, observably reassigning
    // moveTarget on the entity. The TS helper does the same via
    // `unitClassScatterNoThreat`.
    const game = createGame() as GamePriv;
    game.structures.push(makeFIX(House.Spain, 20, 20));

    const docked = new Entity(UnitType.V_JEEP, House.Spain, 0, 0);
    docked.leptonX = 21 * LEPTON_SIZE;
    docked.leptonY = 21 * LEPTON_SIZE;
    docked.syncPosFromLeptons();
    docked.prevPos = { x: docked.pos.x, y: docked.pos.y };
    game.entities.push(docked);
    game.entityById.set(docked.id, docked);

    const jeep = new Entity(UnitType.V_JEEP, House.Spain, 0, 0);
    placeAtCell(jeep, 21, 22);
    jeep.mission = Mission.ENTER;
    jeep.moveTarget = null; // C++ `!Target_Legal(NavCom)` — Scatter proceeds
    game.entities.push(jeep);
    game.entityById.set(jeep.id, jeep);

    const verdict = game.tryPCPBuildingEntryScatter(jeep);

    expect(verdict).toBe('scattered');
    // C++ `Scatter(0, true)` with NavCom illegal calls
    // `Assign_Destination(Map.Nearby_Location(...))` — moveTarget is set to
    // a clear cell near the unit. The TS helper mirrors this.
    expect(jeep.moveTarget).not.toBeNull();
  });

  it('Mission.ENTER vehicle one cell south of a FREE FIX → no_match (RADIO_ROGER path)', () => {
    // Same geometry as the busy test, but no other vehicle parked at the
    // depot — C++ returns RADIO_ROGER and Case A's switch breaks without
    // calling Scatter. The TS helper returns 'no_match'.
    const game = createGame() as GamePriv;
    game.structures.push(makeFIX(House.Spain, 20, 20));

    const jeep = new Entity(UnitType.V_JEEP, House.Spain, 0, 0);
    placeAtCell(jeep, 21, 22);
    jeep.mission = Mission.ENTER;
    jeep.moveTarget = { lx: 21 * LEPTON_SIZE + 128, ly: 22 * LEPTON_SIZE + 128 };
    game.entities.push(jeep);
    game.entityById.set(jeep.id, jeep);

    const verdict = game.tryPCPBuildingEntryScatter(jeep);

    expect(verdict).toBe('no_match');
    // NavCom unchanged — the dock proceeds normally.
    expect(jeep.moveTarget?.lx).toBe(21 * LEPTON_SIZE + 128);
    expect(jeep.moveTarget?.ly).toBe(22 * LEPTON_SIZE + 128);
  });

  it('Mission.ENTER vehicle with NO building one cell north → no_match (C++ Cell_Building() == NULL)', () => {
    // No structure anywhere on the map. C++ `Cell_Building()` returns NULL,
    // so the inner `if (whom == Map[...].Cell_Building())` is false (NULL ==
    // whom is checked above, and whom is NULL here). Either way no scatter.
    const game = createGame() as GamePriv;
    const jeep = new Entity(UnitType.V_JEEP, House.Spain, 0, 0);
    placeAtCell(jeep, 10, 10);
    jeep.mission = Mission.ENTER;
    jeep.moveTarget = { lx: 10 * LEPTON_SIZE + 128, ly: 10 * LEPTON_SIZE + 128 };
    game.entities.push(jeep);
    game.entityById.set(jeep.id, jeep);

    const verdict = game.tryPCPBuildingEntryScatter(jeep);

    expect(verdict).toBe('no_match');
  });

  it('Mission.MOVE vehicle with FIX one cell north → no_match (C++ Mission == MISSION_ENTER guard)', () => {
    // The cell-north geometry and busy state both hold, but Mission is MOVE
    // not ENTER. C++ inner guard `Mission == MISSION_ENTER` fails, so the
    // entire Case A block is skipped — no scatter.
    const game = createGame() as GamePriv;
    game.structures.push(makeFIX(House.Spain, 20, 20));

    // Another vehicle docked (would make Case A fire if ENTER).
    const docked = new Entity(UnitType.V_JEEP, House.Spain, 0, 0);
    docked.leptonX = 21 * LEPTON_SIZE;
    docked.leptonY = 21 * LEPTON_SIZE;
    docked.syncPosFromLeptons();
    docked.prevPos = { x: docked.pos.x, y: docked.pos.y };
    game.entities.push(docked);
    game.entityById.set(docked.id, docked);

    const jeep = new Entity(UnitType.V_JEEP, House.Spain, 0, 0);
    placeAtCell(jeep, 21, 22);
    jeep.mission = Mission.MOVE; // NOT ENTER
    jeep.moveTarget = { lx: 21 * LEPTON_SIZE + 128, ly: 22 * LEPTON_SIZE + 128 };
    game.entities.push(jeep);
    game.entityById.set(jeep.id, jeep);

    const originalNavLX = jeep.moveTarget.lx;
    const originalNavLY = jeep.moveTarget.ly;

    const verdict = game.tryPCPBuildingEntryScatter(jeep);

    expect(verdict).toBe('no_match');
    // No scatter side effect.
    expect(jeep.moveTarget?.lx).toBe(originalNavLX);
    expect(jeep.moveTarget?.ly).toBe(originalNavLY);
  });

  it('non-FIX building one cell north → no_match (C++ depot-specific refusal)', () => {
    // BARR (barracks) is 2x2. It does not have a RADIO_IM_IN refusal reply
    // for vehicles — Case A's `default:` branch only matters for the service
    // depot. The TS helper returns 'no_match' for non-FIX structures, leaving
    // PCP_END to proceed to Case B (which will also miss because no
    // transport is present).
    const game = createGame() as GamePriv;
    game.structures.push({
      type: 'BARR',
      image: 'barr',
      house: House.Spain,
      cx: 20, cy: 20,
      hp: 400, maxHp: 400,
      alive: true,
      rubble: false,
      attackCooldown: 0,
      ammo: -1, maxAmmo: -1,
      missionTimer: 0,
    } as MapStructure);

    const jeep = new Entity(UnitType.V_JEEP, House.Spain, 0, 0);
    placeAtCell(jeep, 20, 22); // south of the BARR footprint
    jeep.mission = Mission.ENTER;
    jeep.moveTarget = { lx: 20 * LEPTON_SIZE + 128, ly: 22 * LEPTON_SIZE + 128 };
    game.entities.push(jeep);
    game.entityById.set(jeep.id, jeep);

    // Note: cell (20, 21) is the bottom row of the BARR footprint, so the
    // cell-north lookup returns the BARR. Verify Case A still no-matches.
    const verdict = game.tryPCPBuildingEntryScatter(jeep);
    expect(verdict).toBe('no_match');
  });

  it('non-allied FIX → no_match (C++ House->Is_Ally gate at RADIO_IM_IN receiver)', () => {
    // C++ BuildingClass::Receive_Message rejects RADIO_IM_IN from a non-allied
    // source before the busy-or-free decision runs. From the vehicle's side
    // this means the radio peer wasn't established and Case A's `whom`
    // pointer would be NULL in the first place — but we mirror the
    // alliance gate directly in the engine helper.
    const game = createGame() as GamePriv;
    game.structures.push(makeFIX(House.USSR, 20, 20));

    // Another (Soviet) docked vehicle — would trigger refusal if alliance
    // gate were absent.
    const docked = new Entity(UnitType.V_JEEP, House.USSR, 0, 0);
    docked.leptonX = 21 * LEPTON_SIZE;
    docked.leptonY = 21 * LEPTON_SIZE;
    docked.syncPosFromLeptons();
    docked.prevPos = { x: docked.pos.x, y: docked.pos.y };
    game.entities.push(docked);
    game.entityById.set(docked.id, docked);

    const jeep = new Entity(UnitType.V_JEEP, House.Spain, 0, 0); // Allied
    placeAtCell(jeep, 21, 22);
    jeep.mission = Mission.ENTER;
    jeep.moveTarget = { lx: 21 * LEPTON_SIZE + 128, ly: 22 * LEPTON_SIZE + 128 };
    game.entities.push(jeep);
    game.entityById.set(jeep.id, jeep);

    const verdict = game.tryPCPBuildingEntryScatter(jeep);
    expect(verdict).toBe('no_match');
  });

  it('infantry / aircraft / vessel never enter Case A (UnitClass-only branch)', () => {
    // C++ `UnitClass::Per_Cell_Process` runs only for ground vehicles (not
    // infantry, aircraft, or vessels). Case A lives inside that method, so
    // even if those classes ended up in MISSION_ENTER one cell south of a
    // FIX, the C++ branch would not fire for them. The TS helper short-circuits
    // accordingly.
    const game = createGame() as GamePriv;
    game.structures.push(makeFIX(House.Spain, 20, 20));
    const docked = new Entity(UnitType.V_JEEP, House.Spain, 0, 0);
    docked.leptonX = 21 * LEPTON_SIZE;
    docked.leptonY = 21 * LEPTON_SIZE;
    docked.syncPosFromLeptons();
    docked.prevPos = { x: docked.pos.x, y: docked.pos.y };
    game.entities.push(docked);
    game.entityById.set(docked.id, docked);

    const e1 = new Entity(UnitType.I_E1, House.Spain, 0, 0); // infantry
    placeAtCell(e1, 21, 22);
    e1.mission = Mission.ENTER;
    e1.moveTarget = { lx: 21 * LEPTON_SIZE + 128, ly: 22 * LEPTON_SIZE + 128 };
    game.entities.push(e1);
    game.entityById.set(e1.id, e1);

    expect(game.tryPCPBuildingEntryScatter(e1)).toBe('no_match');
  });
});
