/**
 * @vitest-environment jsdom
 *
 * C++ parity tests for off-map vessel movement.
 *
 * C++ refs:
 * - vessel.cpp:249-266 — VesselClass::Can_Enter_Cell blocks out-of-radar cells
 *   unless Is_Allowed_To_Leave_Map() is already true.
 * - foot.cpp:2464-2478 — Is_Allowed_To_Leave_Map returns false before IsLocked.
 * - drive.cpp:559-609,878-1105 — Assign_Destination calls Start_Of_Move;
 *   a blocked first outside cell forces Basic_Path to enter the map instead.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import { MoveResult, Terrain } from '../engine/map';
import { Team, TMISSION_MOVE } from '../engine/team';
import { CELL_SIZE, cellTargetToLepton, House, Mission, RESFACTOR, UnitType } from '../engine/types';

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

function createWaterGame(): Game {
  const game = new Game(createCanvas());
  game.map.setBounds(18, 40, 92, 55);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      game.map.setTerrain(x, y, Terrain.WATER);
    }
  }
  return game;
}

describe('Vessel off-map movement — C++ parity', () => {
  beforeAll(() => {
    resetEntityIds();
    (globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
      { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
    ));
  });

  it('unlocked off-map LST paths into the radar rectangle before it can leave-map path', () => {
    const game = createWaterGame();
    const lst = new Entity(UnitType.V_LST, House.Greece, 17 * CELL_SIZE + CELL_SIZE / 2, 85 * CELL_SIZE + CELL_SIZE / 2);
    lst.mission = Mission.GUARD;
    lst.missionQueue = Mission.MOVE;
    lst.missionTimer = 42;
    lst.moveTarget = cellTargetToLepton(20, 78);
    lst.isALoaner = true;
    lst.isLocked = false;
    lst.bodyFacing256 = 0;
    lst.facing = 0;
    lst.desiredFacing = 0;
    lst.desiredFacing256 = 0;
    game.entities.push(lst);
    game.entityById.set(lst.id, lst);
    game.map.setVehicleOccupancy(17, 85, lst.id);

    (game as unknown as { startDriveClassMove: (entity: Entity) => void }).startDriveClassMove(lst);

    expect(lst.path[0]).toEqual({ cx: 18, cy: 84 });
    expect(lst.drivePathFacings[0]).toBe(1); // NE, not N along the outside edge.
    expect(lst.isDriving).toBe(false);
    expect(lst.desiredFacing256).toBe(32);
    expect(lst.mission).toBe(Mission.GUARD);
    expect(lst.missionQueue).toBe(Mission.MOVE);
  });

  it('locked team vessel can enter off-radar water while its current team MOVE leaves the map', () => {
    const game = createWaterGame();
    const lst = new Entity(UnitType.V_LST, House.USSR, 80 * CELL_SIZE + CELL_SIZE / 2, 92 * CELL_SIZE + CELL_SIZE / 2);
    lst.mission = Mission.GUARD;
    lst.missionQueue = Mission.MOVE;
    lst.moveTarget = cellTargetToLepton(74, 110);
    lst.isLocked = true;

    const team = new Team({
      house: House.USSR,
      desiredMembers: [{ type: UnitType.V_LST, count: 1 }],
      missionList: [{ mission: TMISSION_MOVE, data: 10 }],
      forcedActive: true,
    });
    team.add(lst);
    team.isMoving = true;
    team.currentMission = 0;
    (game as unknown as { waypoints: Map<number, { cx: number; cy: number }> }).waypoints.set(10, { cx: 74, cy: 110 });

    expect(team.isLeavingMap(game.map, (game as unknown as { waypoints: Map<number, { cx: number; cy: number }> }).waypoints)).toBe(true);
    expect((game as unknown as { canEnterTrackJumpCell: (entity: Entity, cx: number, cy: number) => MoveResult }).canEnterTrackJumpCell(lst, 74, 110))
      .toBe(MoveResult.OK);

    team.currentMission = -1;
    expect((game as unknown as { canEnterTrackJumpCell: (entity: Entity, cx: number, cy: number) => MoveResult }).canEnterTrackJumpCell(lst, 74, 110))
      .toBe(MoveResult.IMPASSABLE);
  });
});
