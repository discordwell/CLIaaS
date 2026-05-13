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
import { Team } from '../engine/team';
import {
  Dir, House, Mission, UnitType, CELL_SIZE, RESFACTOR, pixelToLepton, cellTargetToLepton,
} from '../engine/types';
import { MoveResult, Terrain } from '../engine/map';
import { ScenarioRandom } from '../engine/random';
import { F_D, RAW_TRACKS, TRACK_CONTROL } from '../engine/tracks';

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

  it('vehicle in GUARD keeps driving an active path after NavCom is cleared', () => {
    // C++ Assign_Destination(TARGET_NONE) clears NavCom, not the current driver.
    // DriveClass::AI must keep following TrackNumber/Path until Stop_Driver.
    const game = createGame();
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.USSR, 10, 10);
    jeep.facing = Dir.E;
    jeep.desiredFacing = Dir.E;
    jeep.bodyFacing256 = Dir.E * 32;
    jeep.bodyFacing32 = Dir.E * 4;
    jeep.missionQueue = Mission.MOVE;
    jeep.moveTarget = null;
    jeep.path = [{ cx: 11, cy: 10 }];
    jeep.pathIndex = 0;
    jeep.isDriving = true;

    const startLX = jeep.leptonX;
    tickEntity(game, jeep);

    expect(jeep.mission, 'mission stays GUARD while active driver finishes').toBe(Mission.GUARD);
    expect(jeep.missionQueue, 'queued MOVE remains blocked by isDriving').toBe(Mission.MOVE);
    expect(
      jeep.leptonX > startLX || jeep.trackNumber > 0 || jeep.pathIndex > 0,
      'DriveClass::AI advances or starts the preserved path even with NavCom cleared'
    ).toBe(true);
  });

  it('vehicle track speed uses destination-cell terrain cost', () => {
    const game = createGame();
    game.map.setTerrain(10, 10, Terrain.ROAD);
    game.map.setTerrain(10, 11, Terrain.CLEAR);

    const jeep = placeVehicle(game, UnitType.V_JEEP, House.Greece, 10, 10);
    jeep.facing = Dir.S;
    jeep.desiredFacing = Dir.S;
    jeep.bodyFacing256 = Dir.S * 32;
    jeep.bodyFacing32 = Dir.S * 4;
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

  it('blocked close-enough MISSION_MOVE enters idle via DriveClass Assign_Destination(None)', () => {
    // C++ drive.cpp:1114 calls Assign_Destination(TARGET_NONE) when
    // Start_Of_Move cannot enter the next cell and NavCom is close enough.
    // DriveClass::Assign_Destination then immediately re-enters Start_Of_Move
    // for a non-driving unit; the no-NavCom guard queues Enter_Idle_Mode, and
    // UnitClass::AI's post-Drive Commence pops GUARD in the same object tick.
    const game = createGame();
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.Greece, 10, 10);
    jeep.mission = Mission.MOVE;
    jeep.missionTimer = 10;
    jeep.missionQueue = null;
    jeep.facing = Dir.SE;
    jeep.desiredFacing = Dir.SE;
    jeep.bodyFacing256 = Dir.SE * 32;
    jeep.bodyFacing32 = Dir.SE * 4;
    jeep.prevBodyFacing32 = jeep.bodyFacing32;
    jeep.moveTarget = {
      lx: pixelToLepton(11 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(11 * CELL_SIZE + CELL_SIZE / 2),
    };
    jeep.path = [{ cx: 11, cy: 11 }];

    const blocker = placeVehicle(game, UnitType.V_JEEP, House.Greece, 11, 11);
    blocker.mission = Mission.GUARD;

    tickEntity(game, jeep);

    expect(jeep.moveTarget).toBeNull();
    expect(jeep.path).toEqual([]);
    expect(jeep.mission, 'post-Drive Commence popped queued idle mission').toBe(Mission.GUARD);
    expect(jeep.missionQueue).toBeNull();
    expect(jeep.missionTimer).toBe(0);
  });

  it('blocked close-enough vessel MISSION_MOVE enters idle via DriveClass Assign_Destination(None)', () => {
    // C++ drive.cpp:1114-1115 is in DriveClass, so VesselClass inherits the same
    // blocked close-enough behavior. SCG07EA tick 1134 BadGuy SS hits this path:
    // Can_Enter_Cell fails, Assign_Destination(TARGET_NONE) re-enters
    // Start_Of_Move while not driving, and Enter_Idle_Mode queues GUARD for the
    // same-tick post-Drive Commence.
    const game = createGame();
    for (let y = 8; y <= 12; y++) {
      for (let x = 8; x <= 12; x++) {
        game.map.setTerrain(x, y, Terrain.WATER);
      }
    }

    const sub = placeVehicle(game, UnitType.V_SS, House.BadGuy, 10, 10);
    sub.mission = Mission.MOVE;
    sub.missionTimer = 10;
    sub.missionQueue = null;
    sub.facing = Dir.E;
    sub.desiredFacing = Dir.E;
    sub.bodyFacing256 = Dir.E * 32;
    sub.desiredFacing256 = Dir.E * 32;
    sub.bodyFacing32 = Dir.E * 4;
    sub.prevBodyFacing32 = sub.bodyFacing32;
    sub.moveTarget = {
      lx: pixelToLepton(11 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2),
    };
    sub.path = [{ cx: 11, cy: 10 }];

    const blocker = placeVehicle(game, UnitType.V_PT, House.Greece, 11, 10);
    blocker.mission = Mission.GUARD;
    game.map.setVehicleOccupancy(11, 10, blocker.id);

    tickEntity(game, sub);

    expect(sub.moveTarget).toBeNull();
    expect(sub.path).toEqual([]);
    expect(sub.mission, 'post-Drive Commence popped queued vessel idle mission').toBe(Mission.GUARD);
    expect(sub.missionQueue).toBeNull();
    expect(sub.missionTimer).toBe(0);
  });

  it('exhausted C++ Path does not preserve stale absolute path after track completion', () => {
    // C++ DriveClass keeps Path[] as facings. After a long/curved track has
    // consumed every facing, DriveClass::AI re-enters Start_Of_Move with
    // Path[0] == FACING_NONE. A stale TS absolute path tail must not be treated
    // as a real residual path; Basic_Path should fail against the occupied
    // close-enough NavCom cell and Assign_Destination(TARGET_NONE) idles.
    const game = createGame();
    const jeep = placeVehicle(game, UnitType.V_JEEP, House.Greece, 10, 11);
    jeep.mission = Mission.MOVE;
    jeep.missionTimer = 3;
    jeep.missionQueue = null;
    jeep.facing = Dir.SE;
    jeep.desiredFacing = Dir.SE;
    jeep.bodyFacing256 = Dir.SE * 32;
    jeep.desiredFacing256 = Dir.SE * 32;
    jeep.bodyFacing32 = Dir.SE * 4;
    jeep.prevBodyFacing32 = jeep.bodyFacing32;
    jeep.leptonX = 10 * 256 + 112;
    jeep.leptonY = 11 * 256 + 112;
    jeep.syncPosFromLeptons();
    jeep.moveTarget = {
      lx: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2),
    };
    jeep.headToLX = 10 * 256 + 128;
    jeep.headToLY = 11 * 256 + 128;
    jeep.isDriving = true;
    jeep.trackNumber = 3;
    jeep.trackControlIndex = 35;
    jeep.trackIndex = 53;
    jeep.trackCellSpan = 1;
    jeep.speedAccum = 10;
    jeep.driveSpeed = 153;
    jeep.path = [{ cx: 9, cy: 10 }, { cx: 10, cy: 11 }];
    jeep.pathIndex = 1;
    jeep.drivePathFacings = [];

    const blocker = new Entity(UnitType.I_E1, House.Greece, 10 * CELL_SIZE + CELL_SIZE / 2, 10 * CELL_SIZE + CELL_SIZE / 2);
    blocker.mission = Mission.GUARD;
    game.entities.push(blocker);
    game.entityById.set(blocker.id, blocker);

    tickEntity(game, jeep);

    expect(jeep.moveTarget).toBeNull();
    expect(jeep.path).toEqual([]);
    expect(jeep.drivePathFacings).toEqual([]);
    expect(jeep.mission).toBe(Mission.GUARD);
    expect(jeep.missionQueue).toBeNull();
    expect(jeep.missionTimer).toBe(0);
  });

  it('Basic_Path friendly blocker close-enough clears NavCom before turning', () => {
    // C++ drive.cpp:1052-1067 runs this immediately after Basic_Path succeeds,
    // before Do_Turn. A stationary allied unit in Path[0] is MOVE_TEMP; when
    // NavCom is already close enough, Assign_Destination(TARGET_NONE) re-enters
    // Start_Of_Move and queues the idle mission for the post-Drive Commence.
    const game = createGame();
    const tank = placeVehicle(game, UnitType.V_4TNK, House.USSR, 55, 60);
    const blocker = placeVehicle(game, UnitType.V_4TNK, House.USSR, 56, 59);

    blocker.mission = Mission.GUARD;
    blocker.missionQueue = null;
    blocker.isDriving = false;
    blocker.moveTarget = null;

    tank.mission = Mission.MOVE;
    tank.missionTimer = 8;
    tank.missionQueue = null;
    tank.isDriving = false;
    tank.trackNumber = -1;
    tank.trackControlIndex = -1;
    tank.path = [];
    tank.pathIndex = 0;
    tank.pathDelay = 0;
    tank.facing = Dir.N;
    tank.desiredFacing = Dir.N;
    tank.bodyFacing256 = Dir.N * 32;
    tank.desiredFacing256 = Dir.N * 32;
    tank.moveTarget = cellTargetToLepton(56, 59);

    tickEntity(game, tank);

    expect(tank.moveTarget).toBeNull();
    expect(tank.path).toEqual([]);
    expect(tank.mission, 'post-Drive Commence should pop queued GUARD').toBe(Mission.GUARD);
    expect(tank.missionQueue).toBeNull();
    expect(tank.missionTimer).toBe(0);
    expect(tank.desiredFacing256, 'no pre-idle Do_Turn toward the blocked cell').toBe(Dir.N * 32);
  });

  it('active track jump uses mirrored C++ Path, not stale absolute path cells', () => {
    // C++ DriveClass::While_Moving computes nextface from Path[0] at AI entry.
    // If Start_Of_Move already consumed every Path[] facing for a long F_D
    // track, Path[0] is FACING_NONE and the jump branch at drive.cpp:734 cannot
    // fire. TS may still have an absolute path tail for bookkeeping; that tail
    // must not invent a nextface during the active track.
    const game = createGame();
    const tank = placeVehicle(game, UnitType.V_3TNK, House.Greece, 10, 10);
    const startControlIndex = 0 * 8 + 1; // N -> NE, raw track 3, F_D
    const startControl = TRACK_CONTROL[startControlIndex];
    const headCell = { cx: 11, cy: 8 };
    const staleNextCell = { cx: 12, cy: 8 };

    expect(startControl.track).toBe(3);
    expect(startControl.flag & F_D).toBeTruthy();

    tank.mission = Mission.MOVE;
    tank.isDriving = true;
    tank.moveTarget = { lx: 20 * 256 + 128, ly: 8 * 256 + 128 };
    tank.trackNumber = startControl.track;
    tank.trackControlIndex = startControlIndex;
    tank.trackFlags = startControl.flag & ~F_D;
    tank.trackIndex = RAW_TRACKS[startControl.track - 1].jump;
    tank.trackCellSpan = 2;
    tank.speedAccum = 11;
    tank.driveSpeed = 1;
    tank.headToLX = headCell.cx * 256 + 128;
    tank.headToLY = headCell.cy * 256 + 128;
    tank.path = [headCell, staleNextCell];
    tank.pathIndex = 0;
    tank.drivePathFacings = [];

    (game as unknown as {
      followTrackStep(e: Entity, speedThrottleRaw: number, targetX: number, targetY: number): boolean;
    }).followTrackStep(
      tank,
      1,
      headCell.cx * CELL_SIZE + CELL_SIZE / 2,
      headCell.cy * CELL_SIZE + CELL_SIZE / 2,
    );

    expect(tank.trackNumber, 'no fabricated jump to the NE->E track').toBe(3);
    expect(tank.trackIndex).toBe(RAW_TRACKS[2].jump + 1);
    expect(tank.headToLX).toBe(headCell.cx * 256 + 128);
    expect(tank.headToLY).toBe(headCell.cy * 256 + 128);
    expect(tank.pathIndex).toBe(0);
  });

  it('team conscript Assign_Destination requests Start_Of_Move before same-tick DriveClass rotation', () => {
    // C++ TeamClass::Coordinate_Conscript calls Assign_Destination(Zone).
    // DriveClass::Assign_Destination immediately calls Start_Of_Move, which
    // sets PrimaryFacing.Desired before this object's later DriveClass::AI pass.
    // The same frame therefore spends one Rotation_Adjust step.
    const game = createGame();
    const leader = placeVehicle(game, UnitType.V_3TNK, House.USSR, 10, 10);
    const conscript = placeVehicle(game, UnitType.V_3TNK, House.USSR, 10, 13);
    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.V_3TNK, count: 2 }],
      missionList: [],
      forcedActive: true,
    });

    team.add(leader);
    team.add(conscript);
    leader.teamInitiated = true;
    conscript.teamInitiated = false;
    conscript.facing = Dir.W;
    conscript.desiredFacing = Dir.W;
    conscript.bodyFacing256 = Dir.W * 32;
    conscript.desiredFacing256 = Dir.W * 32;
    conscript.bodyFacing32 = Dir.W * 4;
    team.zone = {
      x: 10 * CELL_SIZE + CELL_SIZE / 2,
      y: 10 * CELL_SIZE + CELL_SIZE / 2,
    };
    team.zoneLeptonX = 10 * 256 + 128;
    team.zoneLeptonY = 10 * 256 + 128;

    team.coordinateRegroup({
      entities: game.entities,
      map: game.map,
      canEnterCell: (entity, cx, cy) =>
        (game as unknown as {
          canEnterTrackJumpCell(e: Entity, cx: number, cy: number): MoveResult;
        }).canEnterTrackJumpCell(entity, cx, cy) === MoveResult.OK,
      startDriveClassMove: unit =>
        (game as unknown as { startDriveClassMove(e: Entity): void }).startDriveClassMove(unit),
    });

    expect(conscript.moveTarget).not.toBeNull();
    expect(conscript.desiredFacing256).toBe(Dir.N * 32);
    expect(conscript.path.length).toBeGreaterThan(0);

    tickEntity(game, conscript);

    expect(conscript.mission).toBe(Mission.MOVE);
    expect(conscript.bodyFacing256).toBe((Dir.W * 32 + conscript.stats.rot) & 0xff);
  });

  it('GUARD return delay is overwritten by same-tick PCP Commence after track completion', () => {
    // C++ order for UnitClass::AI:
    //   MissionClass::AI -> Mission_Guard() returns a delay
    //   DriveClass::AI -> Per_Cell_Process(PCP_END) -> Commence()
    //
    // Commence() resets Timer=0 after popping the queued MOVE. TS must not
    // write the Mission_Guard return delay after the movement-side Commence.
    const game = createGame();
    const tank = placeVehicle(game, UnitType.V_JEEP, House.USSR, 10, 11);
    tank.mission = Mission.GUARD;
    tank.missionQueue = Mission.MOVE;
    tank.missionTimer = 0;
    tank.facing = Dir.SE;
    tank.desiredFacing = Dir.SE;
    tank.bodyFacing256 = Dir.SE * 32;
    tank.desiredFacing256 = Dir.SE * 32;
    tank.bodyFacing32 = Dir.SE * 4;
    tank.prevBodyFacing32 = tank.bodyFacing32;
    tank.leptonX = 10 * 256 + 112;
    tank.leptonY = 11 * 256 + 112;
    tank.syncPosFromLeptons();
    tank.moveTarget = {
      lx: pixelToLepton(11 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(12 * CELL_SIZE + CELL_SIZE / 2),
    };
    tank.headToLX = 11 * 256 + 128;
    tank.headToLY = 12 * 256 + 128;
    tank.isDriving = true;
    tank.trackNumber = 3;
    tank.trackControlIndex = 35;
    tank.trackIndex = 53;
    tank.trackCellSpan = 1;
    tank.speedAccum = 10;
    tank.driveSpeed = 153;
    tank.path = [{ cx: 11, cy: 12 }];
    tank.pathIndex = 0;
    tank.drivePathFacings = [];

    ScenarioRandom.seed = 0x12345678;
    ScenarioRandom.callCount = 0;

    tickEntity(game, tank);

    expect(tank.mission, 'PCP Commence popped queued MOVE after Mission_Guard').toBe(Mission.MOVE);
    expect(tank.missionQueue).toBeNull();
    expect(tank.missionTimer, 'Commence Timer=0 must survive the guard dispatch').toBe(0);
  });
});
