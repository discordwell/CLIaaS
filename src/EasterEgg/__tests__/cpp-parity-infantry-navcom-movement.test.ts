/**
 * @vitest-environment jsdom
 *
 * C++ behavioral parity: InfantryClass::Movement_AI continues legal NavCom
 * paths independently of TarCom liveness.
 *
 * C++ reference:
 *   infantry.cpp:3765-4060  InfantryClass::Movement_AI
 *
 * Movement_AI starts/continues the driver when NavCom and the stored path are
 * legal. It does not require a live TarCom at the moment of the next hop.
 * This matters for AREA_GUARD/ATTACK style movement where Approach_Target has
 * already assigned NavCom, then the target dies before the path completes.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import { Terrain } from '../engine/map';
import { CELL_SIZE, House, MAP_CELLS, Mission, RESFACTOR, UnitType, cellTargetToLepton, pixelToLepton } from '../engine/types';

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

function tickEntity(game: Game, entity: Entity): void {
  (game as unknown as { updateEntity(e: Entity): void }).updateEntity(entity);
}

function placeAtLeptons(entity: Entity, lx: number, ly: number): void {
  entity.leptonX = lx;
  entity.leptonY = ly;
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

describe('InfantryClass::Movement_AI NavCom path continuation', () => {
  it('HUNT Approach_Target lets Basic_Path avoid stationary allied vehicle blockers', () => {
    // C++ FootClass::Approach_Target only calls Assign_Destination(); it does
    // not precompute Path[]. InfantryClass::Movement_AI then calls Basic_Path,
    // whose InfantryClass::Can_Enter_Cell reports stationary allied vehicles as
    // MOVE_TEMP. This pins the SCG06EA t1105 shape without hardcoding mission
    // logic: a rifleman approaching an MCV must route around the friendly 3TNK
    // at (17,82), not through it via a generic MOVE_MOVING_BLOCK path.
    const game = createGame(128, 128);
    for (const [cx, cy] of [
      [15, 81], [16, 81], [19, 81],
      [16, 82], [19, 82],
      [15, 83], [16, 83],
      [15, 84], [16, 84],
    ]) {
      game.map.setTerrain(cx, cy, Terrain.ROCK);
    }

    const rifle = new Entity(UnitType.I_E1, House.USSR, 0, 0);
    placeAtLeptons(rifle, 4288, 21824); // cell (16,85), SCG06EA BadGuy E1 sub-cell
    rifle.mission = Mission.HUNT;
    rifle.missionTimer = 0;
    rifle.path = [];
    rifle.pathIndex = 0;

    const mcv = new Entity(UnitType.V_MCV, House.Greece, 0, 0);
    placeAtLeptons(mcv, 6016, 16512); // cell (23,64)
    rifle.target = mcv;

    const blocker = new Entity(UnitType.V_3TNK, House.USSR, 0, 0);
    placeAtLeptons(blocker, 17 * 256 + 128, 82 * 256 + 128);

    for (const e of [rifle, mcv, blocker]) {
      game.entities.push(e);
      game.entityById.set(e.id, e);
    }
    game.map.setVehicleOccupancy(23, 64, mcv.id);
    game.map.setVehicleOccupancy(17, 82, blocker.id);

    tickEntity(game, rifle);

    expect(rifle.moveTarget).toEqual(cellTargetToLepton(22, 63));
    expect(rifle.isDriving).toBe(true);
    expect(rifle.path.slice(0, 5)).toEqual([
      { cx: 17, cy: 84 },
      { cx: 17, cy: 83 },
      { cx: 18, cy: 82 },
      { cx: 17, cy: 81 },
      { cx: 16, cy: 80 },
    ]);
    expect(rifle.path).not.toContainEqual({ cx: 17, cy: 82 });
  });

  it('AREA_GUARD infantry starts the next stored path hop even when TarCom is gone', () => {
    const game = createGame();
    const e4 = new Entity(
      UnitType.I_E4,
      House.USSR,
      29 * CELL_SIZE + CELL_SIZE / 2,
      61 * CELL_SIZE + CELL_SIZE / 2
    );
    e4.mission = Mission.AREA_GUARD;
    e4.missionTimer = 10;
    e4.target = null;
    e4.moveTarget = {
      lx: pixelToLepton(27 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(61 * CELL_SIZE + CELL_SIZE / 2),
    };
    e4.path = [{ cx: 28, cy: 61 }, { cx: 27, cy: 61 }];
    e4.pathIndex = 0;
    e4.isDriving = false;
    e4.doing = 'stand_ready';
    game.entities.push(e4);
    game.entityById.set(e4.id, e4);

    tickEntity(game, e4);

    expect(e4.mission).toBe(Mission.AREA_GUARD);
    expect(e4.isDriving).toBe(true);
    expect(e4.headToLX).toBeGreaterThan(0);
    expect(e4.headToLY).toBeGreaterThan(0);
    expect(e4.pathIndex).toBe(0);
  });

  it('MOVE infantry shortens cached Path[] by rounded NavCom distance before the next hop', () => {
    const game = createGame(128, 128);
    const e1 = new Entity(UnitType.I_E1, House.USSR, 0, 0);
    placeAtLeptons(e1, 17603, 25783); // SCG06EA route shape: cell (68,100)
    e1.mission = Mission.MOVE;
    e1.missionTimer = 10;
    e1.moveTarget = { lx: 17544, ly: 23944 }; // C++ NavCom for waypoint (68,93)
    e1.path = [
      { cx: 68, cy: 100 },
      { cx: 69, cy: 99 },
      { cx: 70, cy: 99 },
      { cx: 71, cy: 99 },
      { cx: 72, cy: 98 },
      { cx: 72, cy: 97 },
      { cx: 72, cy: 96 },
      { cx: 71, cy: 95 },
      { cx: 70, cy: 95 },
      { cx: 69, cy: 95 },
      { cx: 68, cy: 94 },
      { cx: 68, cy: 93 },
    ];
    e1.pathIndex = 1;
    e1.isDriving = false;
    e1.doing = 'stand_ready';
    game.entities.push(e1);
    game.entityById.set(e1.id, e1);

    tickEntity(game, e1);

    // C++ infantry.cpp:3843 writes FACING_NONE at
    // Path[Lepton_To_Cell(Distance(NavCom))]. At this coordinate the rounded
    // distance is 7 cells, so the cached path must end at (71,95). The final
    // west/north-west tail is discarded and later recomputed from the closer
    // cell, matching SCG06EA's (71,95)->(70,94)->(69,93)->(68,93) route.
    expect(e1.isDriving).toBe(true);
    expect(e1.path.slice(e1.pathIndex)).toEqual([
      { cx: 69, cy: 99 },
      { cx: 70, cy: 99 },
      { cx: 71, cy: 99 },
      { cx: 72, cy: 98 },
      { cx: 72, cy: 97 },
      { cx: 72, cy: 96 },
      { cx: 71, cy: 95 },
    ]);
  });

  it('MOVE infantry applies the NavCom-distance cap to a newly regenerated Basic_Path', () => {
    const game = createGame(128, 128);
    for (const [cx, cy] of [
      [69, 98], [69, 97], [69, 96],
      [68, 98], [68, 97], [68, 96], [68, 95],
      [69, 94],
      [70, 98], [70, 97], [70, 96],
    ]) {
      game.map.setTerrain(cx, cy, Terrain.ROCK);
    }

    const e1 = new Entity(UnitType.I_E1, House.USSR, 0, 0);
    placeAtLeptons(e1, 69 * 256 + 128, 99 * 256 + 128);
    e1.mission = Mission.MOVE;
    e1.missionTimer = 10;
    e1.moveTarget = cellTargetToLepton(68, 93);
    e1.path = [];
    e1.pathIndex = 0;
    e1.pathDelay = 0;
    e1.isDriving = false;
    e1.doing = 'stand_ready';
    game.entities.push(e1);
    game.entityById.set(e1.id, e1);

    tickEntity(game, e1);

    // C++ checks Lepton_To_Cell(Distance(NavCom)) against FootClass::Path[]
    // before Start_Driver. Even when TS has to regenerate Basic_Path because
    // its absolute-cell cursor exhausted the old path, the effective cached
    // prefix must still stop at that rounded distance so stale tail cells are
    // not consumed as live commands.
    expect(e1.isDriving).toBe(true);
    expect(e1.path.slice(e1.pathIndex)).toEqual([
      { cx: 70, cy: 99 },
      { cx: 71, cy: 98 },
      { cx: 71, cy: 97 },
      { cx: 71, cy: 96 },
      { cx: 70, cy: 95 },
      { cx: 69, cy: 95 },
    ]);
  });

  it('Start_Driver honors C++ anonymous sub-cell bits after a same-spot clear', () => {
    const game = createGame(128, 128);
    const cellIdx = 78 * MAP_CELLS + 40;

    const flamer = new Entity(UnitType.I_E4, House.USSR, 0, 0);
    placeAtLeptons(flamer, 40 * 256 + 192, 78 * 256 + 64);
    flamer.claimedCellIdx = cellIdx;
    flamer.claimedSubCell = 2;
    expect(game.map.occupyClaimedSubCell(cellIdx, flamer.id, 2)).toBe(true);

    // C++ CellClass has no owner per sub-cell bit. If any infantry clears the
    // same coordinate spot, the bit is gone even if another infantry still sits
    // there visually. SCG13EA's E1 at (41,78) then reserves the NE spot in
    // (40,78) instead of falling back to the center and drifting diagonally.
    game.map.vacateClaimedSubCell(cellIdx, 999, 2);

    const rifle = new Entity(UnitType.I_E1, House.USSR, 0, 0);
    placeAtLeptons(rifle, 10694, 20032);
    const started = (game as unknown as {
      infantryStartDriver(e: Entity, cx: number, cy: number): { lx: number; ly: number } | null;
    }).infantryStartDriver(rifle, 40, 78);

    expect(started).toEqual({ lx: 10432, ly: 20032 });
    expect(rifle.headToLX).toBe(10432);
    expect(rifle.headToLY).toBe(20032);
  });

  it('Start_Driver invalidates stale per-entity claims after an anonymous same-spot clear', () => {
    const game = createGame(128, 128);
    const cellIdx = 78 * MAP_CELLS + 40;

    const flamer = new Entity(UnitType.I_E4, House.USSR, 0, 0);
    placeAtLeptons(flamer, 40 * 256 + 192, 78 * 256 + 64);
    flamer.claimedCellIdx = cellIdx;
    flamer.claimedSubCell = 2;
    expect(game.map.occupyClaimedSubCell(cellIdx, flamer.id, 2)).toBe(true);

    const rifle = new Entity(UnitType.I_E1, House.USSR, 0, 0);
    placeAtLeptons(rifle, 10477, 20094);
    rifle.mission = Mission.MOVE;
    rifle.missionTimer = 10;

    game.entities.push(flamer, rifle);
    game.entityById.set(flamer.id, flamer);
    game.entityById.set(rifle.id, rifle);

    const started = (game as unknown as {
      infantryStartDriver(e: Entity, cx: number, cy: number): { lx: number; ly: number } | null;
    }).infantryStartDriver(rifle, 41, 78);

    expect(started).not.toBeNull();
    expect(game.map.subCellOccupancy.get(cellIdx)?.[2] ?? 0).toBe(0);
    expect(flamer.claimedCellIdx).toBe(-1);
    expect(flamer.claimedSubCell).toBe(-1);

    (game as unknown as { update(): void }).update();

    expect(game.map.subCellOccupancy.get(cellIdx)?.[2] ?? 0).toBe(0);
  });

  it('AREA_GUARD timer fire assigns NavCom, then Movement_AI builds Basic_Path before walking', () => {
    const game = createGame(128, 128);
    game.playerHouse = House.Greece;

    const guard = new Entity(UnitType.I_E1, House.USSR, 0, 0);
    placeAtLeptons(guard, 6208, 17344); // cell (24,67), SCG06EA USSR E1
    guard.mission = Mission.AREA_GUARD;
    guard.missionTimer = 0;
    guard.guardOrigin = { x: guard.pos.x, y: guard.pos.y };
    guard.path = [];
    guard.pathIndex = 0;

    const greek = new Entity(UnitType.I_E1, House.Greece, 0, 0);
    placeAtLeptons(greek, 20 * 256 + 128, 64 * 256 + 128);
    guard.target = greek;

    game.entities.push(guard, greek);
    game.entityById.set(guard.id, guard);
    game.entityById.set(greek.id, greek);

    const startLX = guard.leptonX;
    const startLY = guard.leptonY;

    tickEntity(game, guard);

    // C++ Mission_Guard_Area calls Approach_Target during MissionClass::AI.
    // InfantryClass::Movement_AI later in the same object AI computes
    // Basic_Path and Start_Driver, then returns; Coord_Move begins next tick.
    // There is no intermediate `IsDriving=true` state with empty Path[] and
    // no Head_To_Coord, and no direct walk toward NavCom.
    expect(guard.leptonX).toBe(startLX);
    expect(guard.leptonY).toBe(startLY);
    expect(guard.moveTarget).not.toBeNull();
    expect(guard.isDriving).toBe(true);
    expect(guard.headToLX).toBeGreaterThan(0);
    expect(guard.headToLY).toBeGreaterThan(0);
    expect(guard.path.length).toBeGreaterThan(0);
    expect(guard.pathIndex).toBe(0);
  });

  it('HUNT infantry starts driving on a timer-fired tick when Scatter left NavCom but no TarCom', () => {
    const game = createGame();
    const crew = new Entity(
      UnitType.I_E1,
      House.England,
      27 * CELL_SIZE + CELL_SIZE / 2,
      58 * CELL_SIZE + CELL_SIZE / 2
    );
    crew.mission = Mission.HUNT;
    crew.missionTimer = 0;
    crew.target = null;
    crew.moveTarget = cellTargetToLepton(26, 57);
    crew.doing = 'stand_ready';
    game.entities.push(crew);
    game.entityById.set(crew.id, crew);

    tickEntity(game, crew);

    expect(crew.mission).toBe(Mission.HUNT);
    expect(crew.isDriving).toBe(true);
    expect(crew.doing).toBe('walk');
    expect(crew.headToLX).toBeGreaterThan(0);
    expect(crew.headToLY).toBeGreaterThan(0);
  });

  it('invalidated HUNT infantry path regeneration keeps the C++ 12-slot Path buffer', () => {
    const game = createGame(128, 128);
    const rifle = new Entity(UnitType.I_E1, House.USSR, 0, 0);
    placeAtLeptons(rifle, 47 * 256 + 128, 37 * 256 + 128);
    rifle.mission = Mission.HUNT;
    rifle.missionTimer = 10;
    rifle.moveTarget = cellTargetToLepton(70, 61);
    rifle.path = [{ cx: 48, cy: 38 }];
    rifle.pathIndex = 0;
    rifle.pathDelay = 0;

    const jeep = new Entity(UnitType.V_JEEP, House.Greece, 0, 0);
    placeAtLeptons(jeep, 70 * 256 + 128, 60 * 256 + 128);
    rifle.target = jeep;

    const blocker = new Entity(UnitType.V_3TNK, House.USSR, 0, 0);
    placeAtLeptons(blocker, 48 * 256 + 128, 38 * 256 + 128);

    game.entities.push(rifle, jeep, blocker);
    game.entityById.set(rifle.id, rifle);
    game.entityById.set(jeep.id, jeep);
    game.entityById.set(blocker.id, blocker);
    game.map.setVehicleOccupancy(48, 38, blocker.id);

    tickEntity(game, rifle);

    // C++ InfantryClass::Movement_AI clears Path[0] when the next cell is no
    // longer MOVE_OK, then Basic_Path refills FootClass::Path[12]. It must not
    // keep TS's full findPath route; SCG04EA exhausts this buffer and repaths.
    expect(rifle.path.length).toBeGreaterThan(0);
    expect(rifle.path.length).toBeLessThanOrEqual(12);
    expect(rifle.path[0]).not.toEqual({ cx: 48, cy: 38 });
    expect(rifle.isDriving).toBe(true);
  });

  it('HUNT infantry commences queued MOVE before Movement_AI starts a Scatter NavCom driver', () => {
    const game = createGame();
    const crew = new Entity(
      UnitType.I_E1,
      House.England,
      27 * CELL_SIZE + CELL_SIZE / 2,
      58 * CELL_SIZE + CELL_SIZE / 2
    );
    // C++ order:
    //   MissionClass::AI(Mission_Hunt) returns its delay.
    //   InfantryClass::AI Commence() then pops Scatter's queued MOVE while
    //   IsDriving is still false.
    //   Movement_AI starts the NavCom driver after the queue has been promoted.
    crew.mission = Mission.HUNT;
    crew.missionQueue = Mission.MOVE;
    crew.missionTimer = 0;
    crew.idleAnimTimer = 10;
    crew.target = null;
    crew.moveTarget = cellTargetToLepton(26, 57);
    crew.doing = 'stand_ready';
    game.entities.push(crew);
    game.entityById.set(crew.id, crew);

    tickEntity(game, crew);

    expect(crew.mission).toBe(Mission.MOVE);
    expect(crew.missionQueue).toBeNull();
    expect(crew.missionTimer).toBe(0);
    expect(crew.isDriving).toBe(true);
    expect(crew.doing).toBe('walk');
    expect(crew.headToLX).toBeGreaterThan(0);
    expect(crew.headToLY).toBeGreaterThan(0);
  });

  it('ATTACK infantry Enter_Idle_Mode queues MOVE when NavCom is still legal', () => {
    const game = createGame();
    const e1 = new Entity(
      UnitType.I_E1,
      House.BadGuy,
      71 * CELL_SIZE + CELL_SIZE / 2,
      38 * CELL_SIZE + CELL_SIZE / 2
    );
    // C++ FootClass::Mission_Attack calls InfantryClass::Enter_Idle_Mode when
    // TarCom is gone. Enter_Idle_Mode then checks legal NavCom before default
    // idle state and queues MISSION_MOVE, even while the current hop is still
    // driving and Commence cannot pop the queue yet.
    e1.mission = Mission.ATTACK;
    e1.missionTimer = 0;
    e1.target = null;
    e1.moveTarget = cellTargetToLepton(89, 53);
    e1.path = [{ cx: 71, cy: 38 }, { cx: 71, cy: 37 }, { cx: 71, cy: 36 }];
    e1.pathIndex = 0;
    e1.isDriving = true;
    e1.headToLX = 71 * 256 + 128;
    e1.headToLY = 38 * 256;
    e1.doing = 'walk';
    e1.idleAnimTimer = 10;
    game.entities.push(e1);
    game.entityById.set(e1.id, e1);

    tickEntity(game, e1);

    expect(e1.mission).toBe(Mission.ATTACK);
    expect(e1.missionQueue).toBe(Mission.MOVE);
    expect(e1.missionTimer).toBeGreaterThanOrEqual(13);
    expect(e1.missionTimer).toBeLessThanOrEqual(15);
    expect(e1.moveTarget).not.toBeNull();
  });

  it('vehicle crew dispatches Unlimbo idle mission before queued HUNT and Movement_AI', () => {
    const game = createGame();
    const crew = new Entity(
      UnitType.I_E1,
      House.England,
      27 * CELL_SIZE + CELL_SIZE / 2,
      58 * CELL_SIZE + CELL_SIZE / 2
    );
    // C++ UnitClass crew spawn path:
    //   new InfantryClass -> TechnoClass::Unlimbo -> Enter_Idle_Mode(true) + Commence()
    //   UnitClass death code then calls Scatter() and Assign_Mission(HUNT).
    // The next same-tick Logic.AI pass dispatches the current GUARD mission,
    // then InfantryClass::AI Commence pops queued HUNT before Movement_AI.
    crew.mission = Mission.GUARD;
    crew.missionQueue = Mission.HUNT;
    crew.missionTimer = 0;
    crew.idleAnimTimer = 10; // keep this test focused on mission ordering, not Random_Animate RNG.
    crew.target = null;
    crew.moveTarget = cellTargetToLepton(26, 57);
    crew.doing = 'stand_ready';
    game.entities.push(crew);
    game.entityById.set(crew.id, crew);

    tickEntity(game, crew);

    expect(crew.mission).toBe(Mission.HUNT);
    expect(crew.missionQueue).toBeNull();
    expect(crew.missionTimer).toBe(0);
    expect(crew.isDriving).toBe(true);
    expect(crew.doing).toBe('walk');
  });

  it('vehicle crew commences queued MOVE before same-tick guard firing', () => {
    const game = createGame();
    game.playerHouse = House.Greece;

    const crew = new Entity(
      UnitType.I_C1,
      House.Greece,
      30 * CELL_SIZE + CELL_SIZE / 2,
      30 * CELL_SIZE + CELL_SIZE / 2
    );
    const enemy = new Entity(
      UnitType.I_E1,
      House.BadGuy,
      31 * CELL_SIZE + CELL_SIZE / 2,
      30 * CELL_SIZE + CELL_SIZE / 2
    );

    // C++ order for spawned infantry is:
    //   MissionClass::AI(Mission_Guard) acquires TarCom
    //   InfantryClass::AI Commence() pops Scatter's queued MOVE
    //   Firing_AI runs against the retained TarCom before Movement_AI
    // A target found by Mission_Guard must not block the queue pop.
    crew.mission = Mission.GUARD;
    crew.missionQueue = Mission.MOVE;
    crew.missionTimer = 0;
    crew.idleAnimTimer = 10;
    crew.target = null;
    crew.moveTarget = cellTargetToLepton(32, 30);
    crew.doing = 'stand_ready';
    enemy.mission = Mission.GUARD;
    enemy.missionTimer = 10;
    game.entities.push(crew, enemy);
    game.entityById.set(crew.id, crew);
    game.entityById.set(enemy.id, enemy);
    (game as unknown as { discoveredEntityIds: Set<number> }).discoveredEntityIds.add(enemy.id);

    tickEntity(game, crew);

    expect(crew.target).toBe(enemy);
    expect(crew.mission).toBe(Mission.MOVE);
    expect(crew.missionQueue).toBeNull();
    expect(crew.missionTimer).toBe(0);
    expect(crew.firePrepActive || crew.isFiringAnim).toBe(true);
    expect(crew.isDriving).toBe(false);
  });

  it('MISSION_MOVE infantry queues idle after Movement_AI without same-tick Commence', () => {
    const game = createGame();
    game.playerHouse = House.Greece;

    const e1 = new Entity(
      UnitType.I_E1,
      House.Greece,
      10 * CELL_SIZE + CELL_SIZE / 2,
      10 * CELL_SIZE + CELL_SIZE / 2
    );
    const headLX = 10 * 256 + 128;
    const headLY = 10 * 256 + 128;
    e1.leptonX = headLX - 6;
    e1.leptonY = headLY;
    e1.syncPosFromLeptons();
    e1.mission = Mission.MOVE;
    e1.missionTimer = 0;
    e1.missionQueue = null;
    e1.moveTarget = cellTargetToLepton(10, 10);
    e1.path = [{ cx: 10, cy: 10 }];
    e1.pathIndex = 0;
    e1.isDriving = true;
    e1.headToLX = headLX;
    e1.headToLY = headLY;
    e1.doing = 'walk';
    e1.idleAnimTimer = 10;
    game.entities.push(e1);
    game.entityById.set(e1.id, e1);

    tickEntity(game, e1);

    // C++ order for this state:
    //   MissionClass::AI(Mission_Move) returns its 14-16 tick delay.
    //   InfantryClass::AI Commence() then runs before Movement_AI, while no
    //   idle mission has been queued yet.
    //   Movement_AI reaches Head_To_Coord, clears NavCom, and Enter_Idle_Mode
    //   queues GUARD. That queue is not popped until the next object AI pass.
    expect(e1.mission).toBe(Mission.MOVE);
    expect(e1.missionQueue).toBe(Mission.GUARD);
    expect(e1.missionTimer).toBeGreaterThanOrEqual(13);
    expect(e1.missionTimer).toBeLessThanOrEqual(15);
    expect(e1.moveTarget).toBeNull();
    expect(e1.path).toEqual([]);
    expect(e1.isDriving).toBe(false);

    tickEntity(game, e1);

    expect(e1.mission).toBe(Mission.GUARD);
    expect(e1.missionQueue).toBeNull();
    expect(e1.missionTimer).toBe(0);
  });

  it('MISSION_MOVE infantry regenerates Basic_Path when the C++ path buffer is exhausted', () => {
    const game = createGame();
    const e1 = new Entity(
      UnitType.I_E1,
      House.USSR,
      30 * CELL_SIZE + CELL_SIZE / 2,
      30 * CELL_SIZE + CELL_SIZE / 2
    );
    const startLX = e1.leptonX;
    const startLY = e1.leptonY;

    e1.mission = Mission.MOVE;
    e1.missionTimer = 10;
    e1.moveTarget = cellTargetToLepton(12, 30);
    e1.path = Array.from({ length: 12 }, (_, i) => ({ cx: 29 - i, cy: 30 }));
    e1.pathIndex = e1.path.length;
    e1.isDriving = false;
    e1.headToLX = 0;
    e1.headToLY = 0;
    e1.pathDelay = 0;
    e1.doing = 'stand_ready';
    game.entities.push(e1);
    game.entityById.set(e1.id, e1);

    tickEntity(game, e1);

    // C++ Path[CONQUER_PATH_MAX] exhaustion leaves Path[0] == FACING_NONE while
    // NavCom is still legal. InfantryClass::Movement_AI calls Basic_Path and
    // Start_Driver; it does not free-form walk directly toward NavCom.
    expect(e1.leptonX).toBe(startLX);
    expect(e1.leptonY).toBe(startLY);
    expect(e1.mission).toBe(Mission.MOVE);
    expect(e1.moveTarget).not.toBeNull();
    expect(e1.path.length).toBeGreaterThan(0);
    expect(e1.pathIndex).toBe(0);
    expect(e1.isDriving).toBe(true);
    expect(e1.headToLX).toBeGreaterThan(0);
    expect(e1.headToLY).toBeGreaterThan(0);
  });

});
