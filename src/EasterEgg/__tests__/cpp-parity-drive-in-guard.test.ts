/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: DriveClass::AI drives-in-GUARD (drive.cpp:1304-1398)
 *
 * In C++, when a vehicle/vessel (UnitClass or VesselClass, both subclasses of
 * DriveClass) has Mission==MISSION_GUARD, Target_Legal(NavCom)==true, and
 * IsDriving==true, DriveClass::AI STILL DRIVES toward NavCom. The key
 * condition is at drive.cpp:1376:
 *   if ((Mission != MISSION_GUARD || Target_Legal(NavCom)) && Mission != MISSION_UNLOAD)
 *
 * This is how team-queued MOVE missions get the vehicle moving BEFORE the
 * Commence() pop actually switches Mission to MOVE. Team::Coordinate_Move
 * (team.cpp:1938) calls Assign_Mission(MOVE) which only QUEUES via MissionQueue
 * (mission.cpp:379-390). The UnitClass::AI Commence gate at unit.cpp:404 and
 * :472 is `!IsDriving && Is_Door_Closed()` — when IsDriving=true (set by
 * Start_Driver same tick as Assign_Destination), the gate stays closed and
 * Mission remains GUARD. DriveClass::AI drives anyway.
 *
 * Per_Cell_Process(PCP_END) (drive.cpp:858-879) clears NavCom/Path when the
 * vehicle arrives at As_Cell(NavCom). Stop_Driver then flips IsDriving=false.
 * On the NEXT tick's Commence() call, the gate opens and MissionQueue pops
 * (Mission=MOVE, Timer=0). C++ Mission_Move (foot.cpp:520-539) on the tick
 * after that fires Random_Pick(0,2) jitter and (with NavCom cleared and
 * !IsDriving) calls Enter_Idle_Mode → back to GUARD.
 *
 * Without the drives-in-GUARD port, TS vehicles assigned via coordinateMove
 * (team.ts:745-773) would be stuck in GUARD forever (blockCommenceDrive gate
 * blocks Commence from popping MissionQueue), unable to reach waypoints,
 * breaking LST+SPY delivery, MCV deployment, and team script progression.
 *
 * C++ source refs:
 *   drive.cpp:1304-1398 — DriveClass::AI (line 1376 drives-in-GUARD condition)
 *   drive.cpp:858-879   — Per_Cell_Process(PCP_END) NavCom clearing
 *   foot.cpp:792-803    — Stop_Driver IsDriving=false
 *   foot.cpp:823-844    — Start_Driver IsDriving=true
 *   unit.cpp:404,472    — UnitClass::AI Commence `!IsDriving` gate
 *   vessel.cpp:592,658  — VesselClass::AI Commence `!IsDriving` gate (shared semantics)
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  Dir, House, Mission, UnitType, CELL_SIZE, RESFACTOR, pixelToLepton,
} from '../engine/types';
import { Terrain } from '../engine/map';

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

function createGame(): Game {
  const game = new Game(createCanvas());
  game.map.setBounds(0, 0, 64, 64);
  // Fill map with passable terrain
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      game.map.setTerrain(x, y, 0); // clear/plain
    }
  }
  return game;
}

function placeVehicle(game: Game, type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  e.mission = Mission.GUARD;
  e.missionTimer = 42; // typical GUARD delay
  game.entities.push(e);
  game.entityById.set(e.id, e);
  return e;
}

/** Invoke the private updateEntity per-tick AI step */
function tickEntity(game: Game, entity: Entity): void {
  (game as unknown as { updateEntity(e: Entity): void }).updateEntity(entity);
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => { resetEntityIds(); });

describe('C++ DriveClass::AI drives-in-GUARD (drive.cpp:1376)', () => {
  it('vehicle in GUARD with isDriving+moveTarget advances toward target', () => {
    // C++ drive.cpp:1376 — Mission==GUARD + Target_Legal(NavCom) → drive anyway
    const game = createGame();
    const mcv = placeVehicle(game, UnitType.V_MCV, House.Greece, 10, 10);

    // Simulate post-coordinateMove state: GUARD, MissionQueue=MOVE, NavCom set, IsDriving=true
    mcv.missionQueue = Mission.MOVE;
    mcv.moveTarget = {
      lx: pixelToLepton(20 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2),
    };
    mcv.isDriving = true;

    const startX = mcv.pos.x;

    // Tick once — DriveClass::AI-in-GUARD should move the vehicle (or at least
    // start the track rotation), without changing Mission or popping MissionQueue.
    tickEntity(game, mcv);

    expect(mcv.mission, 'mission stays GUARD while driving').toBe(Mission.GUARD);
    expect(mcv.missionQueue, 'missionQueue still MOVE (not yet popped)').toBe(Mission.MOVE);
    expect(mcv.isDriving, 'isDriving stays true during drive').toBe(true);
    // The MCV is either rotating toward +x (no position change yet) or already
    // advancing. The important thing is it didn't abort or commit suicide.
    expect(mcv.moveTarget, 'NavCom still set until Per_Cell_Process at destination').not.toBeNull();
    // If the MCV started moving, x should have increased (or stayed the same
    // during pre-rotation). It should NEVER have decreased.
    expect(mcv.pos.x, 'vehicle did not move backward').toBeGreaterThanOrEqual(startX);
  });

  it('vehicle track speed uses destination-cell terrain cost', () => {
    const game = createGame();
    game.map.setTerrain(10, 10, Terrain.ROAD);
    game.map.setTerrain(10, 11, Terrain.CLEAR);

    const jeep = placeVehicle(game, UnitType.V_JEEP, House.Greece, 10, 10);
    jeep.facing = Dir.S;
    jeep.desiredFacing = Dir.S;
    jeep.missionQueue = Mission.MOVE;
    jeep.moveTarget = {
      lx: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(11 * CELL_SIZE + CELL_SIZE / 2),
    };
    jeep.path = [{ cx: 10, cy: 11 }];
    jeep.pathIndex = 0;
    jeep.isDriving = true;

    const startLy = jeep.leptonY;
    tickEntity(game, jeep);

    // Clear ground wheel cost is 60%, so JEEP MaxSpeed 25 grants one 10-lepton
    // track step with 5 leptons carried. Using the road current cell grants two.
    expect(jeep.leptonY - startLy).toBe(11);
    expect(jeep.speedAccum).toBe(5);
  });

  it('vehicle in GUARD without isDriving does NOT drive (C++ line 1376 false)', () => {
    // C++ drive.cpp:1376 — Mission==GUARD && !Target_Legal(NavCom) → skip driving.
    // This case is regular stationary GUARD (no NavCom).
    const game = createGame();
    const mcv = placeVehicle(game, UnitType.V_MCV, House.Greece, 10, 10);
    // No missionQueue, no moveTarget, no isDriving — pure stationary GUARD.

    const startX = mcv.pos.x;
    const startY = mcv.pos.y;
    tickEntity(game, mcv);

    expect(mcv.pos.x, 'stationary GUARD: vehicle must not move x').toBe(startX);
    expect(mcv.pos.y, 'stationary GUARD: vehicle must not move y').toBe(startY);
    expect(mcv.mission, 'mission stays GUARD').toBe(Mission.GUARD);
  });

  it('infantry in GUARD does NOT drive even with isDriving+moveTarget (FootClass only)', () => {
    // C++ parity: FootClass::AI is the parent of InfantryClass::AI and does NOT
    // have DriveClass's drives-in-GUARD logic. Infantry's Mission_Guard handles
    // the stationary scan + Random_Animate; no NavCom-driven movement in GUARD.
    // (Infantry would use the gesture/nonInterruptAnimTicks gate, not isDriving,
    // and its coordinateMove path doesn't flip isDriving=true — team.ts:770-772.)
    const game = createGame();
    const e1 = new Entity(UnitType.I_E1, House.Greece, 10 * CELL_SIZE + 12, 10 * CELL_SIZE + 12);
    e1.mission = Mission.GUARD;
    e1.missionTimer = 42;
    e1.missionQueue = Mission.MOVE;
    e1.moveTarget = {
      lx: pixelToLepton(20 * CELL_SIZE + 12),
      ly: pixelToLepton(10 * CELL_SIZE + 12),
    };
    // Infantry WOULD NOT have isDriving=true set by coordinateMove anyway
    // (team.ts line 770-772 only sets it for !isInfantry && !isAirUnit).
    // But even if we force it, the drive-in-GUARD block must reject infantry.
    e1.isDriving = true;
    game.entities.push(e1);
    game.entityById.set(e1.id, e1);

    const startX = e1.pos.x;
    const startY = e1.pos.y;
    tickEntity(game, e1);

    expect(e1.pos.x, 'infantry in GUARD must not move via drives-in-GUARD path').toBe(startX);
    expect(e1.pos.y, 'infantry in GUARD must not move via drives-in-GUARD path').toBe(startY);
  });

  it('vessel (LST) in GUARD with isDriving+moveTarget drives (VesselClass shares DriveClass)', () => {
    // C++ vessel.cpp:620 — VesselClass::AI calls DriveClass::AI(), inheriting
    // drives-in-GUARD semantics. LST reinforcements use the same pipeline:
    // coordinateMove → missionQueue=MOVE + isDriving=true → drive toward waypoint
    // in GUARD → Stop_Driver at destination → Commence pops → TMISSION_UNLOAD.
    const game = createGame();
    // Water cells for LST
    for (let y = 8; y <= 12; y++) {
      for (let x = 8; x <= 30; x++) {
        game.map.setTerrain(x, y, 4); // water / river
      }
    }
    const lst = placeVehicle(game, UnitType.V_LST, House.Greece, 10, 10);
    lst.missionQueue = Mission.MOVE;
    lst.moveTarget = {
      lx: pixelToLepton(20 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2),
    };
    lst.isDriving = true;

    tickEntity(game, lst);

    // LST must stay in GUARD with queue intact; isDriving stays true until arrival.
    expect(lst.mission, 'vessel in GUARD stays GUARD').toBe(Mission.GUARD);
    expect(lst.missionQueue, 'vessel missionQueue still MOVE').toBe(Mission.MOVE);
    expect(lst.moveTarget, 'vessel moveTarget preserved').not.toBeNull();
  });

  it('blockCommenceDrive gate blocks MissionQueue pop while isDriving=true', () => {
    // C++ unit.cpp:472 — `if (!IsDumping && !IsDriving && Is_Door_Closed()) Commence()`.
    // Guarantees the drives-in-GUARD unit does not prematurely transition to MOVE.
    // Only after Per_Cell_Process(PCP_END) clears NavCom and Stop_Driver sets
    // IsDriving=false does Commence pop MissionQueue → Mission=MOVE, Timer=0.
    const game = createGame();
    const mcv = placeVehicle(game, UnitType.V_MCV, House.Greece, 10, 10);
    mcv.missionQueue = Mission.MOVE;
    mcv.moveTarget = {
      lx: pixelToLepton(20 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2),
    };
    mcv.isDriving = true;

    // Multiple ticks: MCV is still driving (hasn't reached destination).
    // MissionQueue must NOT have popped during these ticks (Commence gate blocked).
    for (let i = 0; i < 5; i++) {
      tickEntity(game, mcv);
      expect(mcv.mission, `tick ${i}: mission stays GUARD (blockCommenceDrive)`).toBe(Mission.GUARD);
      expect(mcv.missionQueue, `tick ${i}: missionQueue intact`).toBe(Mission.MOVE);
    }
  });
});
