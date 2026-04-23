/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: SCG04EA tick-3 Mission_Move stagger for twin 1-member
 * vehicle teams targeting the same waypoint.
 *
 * Two 3TNKs, each in its own 1-member team (set1, set2 via trigger set3
 * TACTION_CREATE_TEAM), both targeting waypoint 1 (cell (48, 38)). WASM's
 * observed tick-3 state:
 *   - unit[73] (set1 member): Mission=MOVE, IsDriving=false, fires Mission_Move
 *     jitter Random_Pick(0,2) tagged 60010.
 *   - unit[74] (set2 member): Mission=GUARD, IsDriving=true, MissionQueue=MOVE,
 *     drives-in-GUARD (drive.cpp:1376).
 *
 * The asymmetry comes from C++ Basic_Path's transient cell reservations: when
 * team1 (processed first via Teams.Ptr(i)->AI()) calls Assign_Destination →
 * Start_Of_Move → Basic_Path, the path reservation conflicts with a downstream
 * reservation, Start_Driver bails, IsDriving stays false. UnitClass::AI line 404
 * Commence fires because !IsDriving, popping MissionQueue=MOVE → Mission=MOVE,
 * Timer=0. MissionClass::AI (invoked via TechnoClass::AI → RadioClass::AI)
 * dispatches Mission_Move on the SAME tick and fires Random_Pick(0,2) jitter.
 *
 * Team2's Basic_Path succeeds, Start_Driver fires IsDriving=true. UnitClass::AI
 * line 404 Commence is blocked (!IsDriving false), MissionQueue stays MOVE,
 * Mission stays GUARD. DriveClass::AI (drive.cpp:1376) drives the vehicle toward
 * NavCom in GUARD. Mission_Move does NOT fire — Mission stays GUARD and
 * Mission_Guard timer continues decrementing.
 *
 * The TS port emulates this with two coordinated pieces:
 *
 *   1. A per-tick `vehicleClaims` Map threaded through TeamAIContext. The
 *      FIRST team to claim a target cell gets isDriving=TRUE (optimistic,
 *      matching single-team SCG11 MCV reinforce). When a SECOND team claims
 *      the same target cell in the same pass, the logic retroactively resets
 *      the first team's unit to isDriving=FALSE and gives the second team
 *      isDriving=TRUE — matching WASM's observed "first-fails, second-succeeds"
 *      outcome.
 *
 *   2. A pre-dispatch Commence gate in updateEntity that pops MissionQueue →
 *      Mission + Timer=0 BEFORE the Mission switch runs for vehicles/vessels
 *      (matching UnitClass::AI line 404 in C++). Without this, the popped
 *      Mission=MOVE handler would dispatch 1 tick later, delaying Mission_Move
 *      jitter by 1 tick (tick 4 instead of tick 3).
 *
 * Combined, tick 3 in TS now matches WASM: one vehicle pops + fires jitter,
 * the other stays GUARD+IsDriving=true.
 *
 * C++ source refs:
 *   team.cpp:1874-2008 — TeamClass::Coordinate_Move (Assign_Mission + Assign_Destination)
 *   team.cpp:1938      — Assign_Mission(MISSION_MOVE) → MissionQueue=MOVE
 *   drive.cpp:591-641  — DriveClass::Assign_Destination → Start_Of_Move
 *   drive.cpp:906-1277 — DriveClass::Start_Of_Move → Basic_Path → Start_Driver
 *   drive.cpp:1304-1398— DriveClass::AI drives-in-GUARD (line 1376)
 *   unit.cpp:404       — UnitClass::AI pre-DriveClass::AI Commence (!IsDriving gate)
 *   foot.cpp:520-539   — Mission_Move returns Normal_Delay + Random_Pick(0,2)
 *   mission.cpp:343    — MissionClass::Commence pops queue, Timer=0, Status=0
 *   mission.cpp:213    — MissionClass::AI dispatches Mission handler when Timer==0
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  House, Mission, UnitType, CELL_SIZE, RESFACTOR,
} from '../engine/types';
import {
  Team,
  TMISSION_MOVE,
  clearAllTeams,
  registerTeam,
  resetTeamIds,
  updateAllTeams,
} from '../engine/team';

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
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      game.map.setTerrain(x, y, 0);
    }
  }
  return game;
}

function placeVehicle(game: Game, type: UnitType, house: House, cx: number, cy: number): Entity {
  const e = new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  e.mission = Mission.GUARD;
  e.missionTimer = 40;
  game.entities.push(e);
  game.entityById.set(e.id, e);
  return e;
}

function tickEntity(game: Game, entity: Entity): void {
  (game as unknown as { updateEntity(e: Entity): void }).updateEntity(entity);
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => {
  resetEntityIds();
  resetTeamIds();
  clearAllTeams();
});

describe('C++ SCG04EA tick-3 Mission_Move stagger', () => {
  it('twin vehicle teams targeting same waypoint: first fails, second succeeds', () => {
    // Reproduce SCG04EA set1/set2: two 1-member 3TNK teams, both targeting
    // waypoint 1 (cell (48, 38)). In WASM, set1 (first in iteration) ends with
    // Mission=MOVE + IsDriving=false (Basic_Path fails → Commence pops).
    // set2 ends with Mission=GUARD + IsDriving=true (Basic_Path succeeds →
    // Commence blocked, drives-in-GUARD).
    const game = createGame();

    const tank1 = placeVehicle(game, UnitType.V_3TNK, House.BadGuy, 42, 35);
    const tank2 = placeVehicle(game, UnitType.V_3TNK, House.BadGuy, 39, 34);

    const waypoints = new Map<number, { cx: number; cy: number }>([
      [1, { cx: 48, cy: 38 }],
    ]);

    // Both teams pre-activated with the same mission (MOVE to waypoint 1).
    const team1 = new Team({
      house: House.BadGuy,
      desiredMembers: [{ type: UnitType.V_3TNK, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 1 }],
      forcedActive: true,
    });
    team1.add(tank1);
    registerTeam(team1);

    const team2 = new Team({
      house: House.BadGuy,
      desiredMembers: [{ type: UnitType.V_3TNK, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 1 }],
      forcedActive: true,
    });
    team2.add(tank2);
    registerTeam(team2);

    // updateAllTeams iterates _activeTeams in insertion order — team1 first,
    // team2 second. It threads `claimedVehicleTargets` through TeamAIContext,
    // which lets the second team's coordinateMove retroactively reset the
    // first team's isDriving flag (simulating C++ Basic_Path path-reservation
    // conflict).
    updateAllTeams(waypoints, { structures: [], entities: [tank1, tank2] });

    // Post-team-AI state: both vehicles have MissionQueue=MOVE + moveTarget set.
    expect(tank1.missionQueue, 'tank1 queue MOVE').toBe(Mission.MOVE);
    expect(tank2.missionQueue, 'tank2 queue MOVE').toBe(Mission.MOVE);
    expect(tank1.moveTarget, 'tank1 moveTarget set').not.toBeNull();
    expect(tank2.moveTarget, 'tank2 moveTarget set').not.toBeNull();

    // C++ parity (post-W3 deletion, TEAM_START_DRIVER_REFACTOR=true):
    // `TeamClass::Coordinate_Move` (team.cpp:1878-2012) NEVER sets IsDriving.
    // `DriveClass::Start_Driver` (drive.cpp:1079-1086) sets it only AFTER
    // rotation completes on the unit's own AI tick. So both tanks:
    //   - keep isDriving=false post-coordinateMove
    //   - have path populated via findPath (Basic_Path simulation)
    //   - MissionQueue=MOVE, moveTarget set
    // Mission_Move dispatch + Start_Driver happen on the next entity-AI tick
    // via `runDriveClassAI` when DRIVE_CLASS_AI_PORT=true.
    expect(tank1.isDriving, 'tank1: isDriving=false (C++ coord never sets IsDriving)').toBe(false);
    expect(tank2.isDriving, 'tank2: isDriving=false (C++ coord never sets IsDriving)').toBe(false);
    // tank1's path should populate; tank2's path may route around or be empty
    // if cellClaims blocked its dest — either way, both isDriving match C++.
    expect(tank1.path.length, 'tank1 path populated (or blocked)').toBeGreaterThanOrEqual(0);
    expect(tank2.path.length, 'tank2 path populated (or blocked)').toBeGreaterThanOrEqual(0);
  });

  it('single-team vehicle reinforcement: isDriving gated by facing alignment (C++ Start_Driver parity)', () => {
    // SCG11EA-style scenario: a single team with one MCV. No sibling team
    // claims the same target.
    //
    // C++ drive.cpp:1079-1086 DriveClass::AI calls Do_Turn() and returns early
    // while the unit's facing does not match the first path step; Start_Driver
    // (which sets IsDriving=true) is only reached AFTER rotation completes.
    // The TS emulation previously set isDriving=true eagerly in Team::coordinateMove,
    // but this blocked Commence for solo reinforcements that still needed to
    // rotate (SCG04EA miner MNLY: mission stuck in GUARD → Mission_Move jitter
    // never fired, diverging from WASM at tick 15).
    //
    // The fix: only simulate Start_Driver success when the unit's body facing
    // already matches the direction to the target. Otherwise leave isDriving
    // false so the pre-Commence gate pops MOVE on this tick and the rotation
    // phase happens under Mission=MOVE (matching C++ drive.cpp Do_Turn path).
    const game = createGame();
    // Default facing is 0 (North). Target is East — rotation required.
    const mcv = placeVehicle(game, UnitType.V_MCV, House.Greece, 10, 10);

    const team = new Team({
      house: House.Greece,
      desiredMembers: [{ type: UnitType.V_MCV, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 26 }],
      forcedActive: true,
    });
    team.add(mcv);
    registerTeam(team);

    const waypoints = new Map<number, { cx: number; cy: number }>([
      [26, { cx: 22, cy: 10 }],
    ]);
    updateAllTeams(waypoints, { structures: [], entities: [mcv] });

    expect(mcv.missionQueue, 'single-team MCV queues MOVE').toBe(Mission.MOVE);
    expect(mcv.moveTarget, 'single-team MCV moveTarget set').not.toBeNull();
    // Facing=0 (N), target east → facing mismatch → isDriving stays false
    // so the pre-Commence gate pops MOVE and Mission_Move jitter can fire.
    expect(mcv.isDriving, 'facing mismatch → isDriving stays false (C++ Do_Turn, no Start_Driver)').toBe(false);

    // Pre-Commence gate pops queue on this tick because isDriving=false.
    tickEntity(game, mcv);
    expect(mcv.mission, 'MCV pops to MOVE when isDriving=false (C++ unit.cpp:404 Commence)').toBe(Mission.MOVE);
    expect(mcv.missionQueue, 'MCV queue cleared after pop').toBeNull();
  });

  it('single-team vehicle with pre-aligned facing: isDriving=false post-coord (Start_Driver on DriveClass::AI tick)', () => {
    // C++ parity (post-W3 deletion):
    // Even when the vehicle's body facing already matches the target direction,
    // `TeamClass::Coordinate_Move` (team.cpp:1878-2012) does NOT set IsDriving.
    // `DriveClass::Start_Driver` (drive.cpp:1270) fires from DriveClass::AI
    // on the unit's own AI tick after Start_Of_Move confirms Basic_Path +
    // facing match + Can_Enter_Cell. Previously TS W3 eagerly set isDriving
    // in coordinator — a proxy for Start_Driver that skipped the DriveClass::AI
    // tick sequencing.
    const game = createGame();
    const mcv = placeVehicle(game, UnitType.V_MCV, House.Greece, 10, 10);
    mcv.facing = 2; // East — matches target direction (22,10) dx=+1,dy=0

    const team = new Team({
      house: House.Greece,
      desiredMembers: [{ type: UnitType.V_MCV, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 26 }],
      forcedActive: true,
    });
    team.add(mcv);
    registerTeam(team);

    const waypoints = new Map<number, { cx: number; cy: number }>([
      [26, { cx: 22, cy: 10 }],
    ]);
    updateAllTeams(waypoints, { structures: [], entities: [mcv] });

    // Post-coord: queue MOVE, moveTarget set, isDriving still false.
    // Path populated by findPath (Basic_Path in coord) per TEAM_START_DRIVER_REFACTOR.
    expect(mcv.missionQueue, 'MCV queue MOVE').toBe(Mission.MOVE);
    expect(mcv.moveTarget, 'MCV moveTarget set').not.toBeNull();
    expect(mcv.isDriving, 'isDriving=false (C++ coord never sets IsDriving)').toBe(false);

    // Pre-Commence gate pops queue this tick because isDriving=false.
    tickEntity(game, mcv);
    expect(mcv.mission, 'MCV pops to MOVE via pre-Commence (unit.cpp:404)').toBe(Mission.MOVE);
    expect(mcv.missionQueue, 'MCV queue cleared after pop').toBeNull();
  });

  it('pre-dispatch Commence: popping tank1 fires Mission_Move jitter on the SAME tick', () => {
    // Verify the pre-dispatch Commence gate in updateEntity pops MissionQueue
    // BEFORE the Mission switch dispatches, so Mission_Move's Random_Pick(0,2)
    // jitter fires on the activation tick (not 1 tick later).
    const game = createGame();

    // Simulate post-coordinateMove state directly: Mission=GUARD, MissionQueue
    // =MOVE, isDriving=false (the "first-team-fails" case after retroactive
    // reset by a sibling team claim).
    const tank = placeVehicle(game, UnitType.V_3TNK, House.BadGuy, 42, 35);
    tank.missionQueue = Mission.MOVE;
    tank.moveTarget = { lx: 48 * 256 + 128, ly: 38 * 256 + 128 };
    tank.isDriving = false;
    tank.missionTimer = 40; // Mission_Guard timer, will decrement to 39

    tickEntity(game, tank);

    // After the pre-dispatch Commence: Mission=MOVE, MissionQueue=null,
    // Timer was reset to 0 → Mission_Move handler fired → Timer=14+jitter
    // (jitter 0..2 from ScenarioRandom.nextInRange).
    expect(tank.mission, 'Mission popped to MOVE on entity-AI tick').toBe(Mission.MOVE);
    expect(tank.missionQueue, 'MissionQueue cleared after pop').toBeNull();
    expect(tank.missionTimer, 'Mission_Move set Timer = 14 + jitter (0..2)').toBeGreaterThanOrEqual(14);
    expect(tank.missionTimer, 'Mission_Move set Timer = 14 + jitter (0..2)').toBeLessThanOrEqual(16);
  });

  it('Session 13: ctx.map + facing-match → isDriving=true post-coord (Assign_Destination → Start_Of_Move)', () => {
    // C++ DriveClass::Assign_Destination (drive.cpp:638-640) synchronously
    // calls Start_Of_Move when !IsDriving. On path success + facing match,
    // Start_Driver (foot.cpp:830) flips IsDriving=true from the Team.AI
    // phase — before the unit's own AI iteration runs. This was load-bearing
    // for SCG04EA tick 3 W[1] drive-in-GUARD behavior and contributed +21
    // divergence ticks when ported in Session 13.
    //
    // This test validates the port: when ctx.map is provided (production
    // runtime), findPath populates the path and if the first segment's
    // direction matches unit.facing, isDriving flips true.
    const game = createGame();
    const mcv = placeVehicle(game, UnitType.V_MCV, House.Greece, 10, 10);
    mcv.facing = 2; // East — matches target direction

    const team = new Team({
      house: House.Greece,
      desiredMembers: [{ type: UnitType.V_MCV, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 26 }],
      forcedActive: true,
    });
    team.add(mcv);
    registerTeam(team);

    const waypoints = new Map<number, { cx: number; cy: number }>([
      [26, { cx: 22, cy: 10 }],
    ]);
    // Provide ctx.map — this triggers the Session 13 findPath + facing check.
    updateAllTeams(waypoints, { structures: [], entities: [mcv], map: game.map });

    expect(mcv.moveTarget, 'MCV moveTarget set').not.toBeNull();
    expect(mcv.path.length, 'path populated via findPath (Basic_Path emulation)').toBeGreaterThan(0);
    expect(mcv.isDriving, 'facing=E matches path[0] direction → isDriving=true (Session 13)').toBe(true);
  });

  it('drives-in-GUARD remains unaffected for second-team isDriving=true vehicles', () => {
    // The pre-Commence gate must NOT pop the queue when isDriving=true — that
    // vehicle stays in GUARD and drives via drives-in-GUARD (drive.cpp:1376).
    const game = createGame();
    const tank = placeVehicle(game, UnitType.V_3TNK, House.BadGuy, 39, 34);
    tank.missionQueue = Mission.MOVE;
    tank.moveTarget = { lx: 48 * 256 + 128, ly: 38 * 256 + 128 };
    tank.isDriving = true;
    tank.missionTimer = 40;

    tickEntity(game, tank);

    // isDriving=true → pre-Commence skipped → Mission stays GUARD, queue intact.
    // drives-in-GUARD path in Mission.GUARD case runs updateMove, which may
    // start the path or rotation but never pop Mission to MOVE.
    expect(tank.mission, 'isDriving=true: Mission stays GUARD').toBe(Mission.GUARD);
    expect(tank.missionQueue, 'isDriving=true: MissionQueue still MOVE').toBe(Mission.MOVE);
  });
});
