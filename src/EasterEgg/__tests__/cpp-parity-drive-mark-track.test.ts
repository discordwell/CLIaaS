/**
 * @vitest-environment jsdom
 *
 * C++ parity: DriveClass::Mark_Track reservations.
 *
 * Matches:
 * - drive.cpp:285-322    DriveClass::Stop_Driver releases Mark_Track(HeadTo, MARK_UP)
 * - drive.cpp:1087-1277 DriveClass::Start_Of_Move checks Can_Enter_Cell before Start_Driver
 * - drive.cpp:1649-1680 DriveClass::Mark_Track reserves HeadToCoord and unpassed midpoint
 * - unit.cpp:3361-3371  UnitClass::Start_Driver calls Mark_Track(headto, MARK_DOWN)
 * - vessel.cpp:2104-2113 VesselClass::Start_Driver calls Mark_Track(headto, MARK_DOWN)
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import { Dir, House, Mission, RESFACTOR, UnitType } from '../engine/types';
import { MoveResult } from '../engine/map';
import { ScenarioRandom } from '../engine/random';

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
    for (let x = 0; x < 64; x++) game.map.setTerrain(x, y, 0);
  }
  return game;
}

function placeVehicle(game: Game, type: UnitType, cx: number, cy: number, facing: Dir): Entity {
  const e = new Entity(type, House.BadGuy, cx * 24 + 12, cy * 24 + 12);
  e.mission = Mission.MOVE;
  e.facing = facing;
  e.desiredFacing = facing;
  game.entities.push(e);
  game.entityById.set(e.id, e);
  return e;
}

function updateMove(game: Game, entity: Entity): void {
  (game as unknown as { updateMove(e: Entity): void }).updateMove(entity);
}

function stopDriveTrack(game: Game, entity: Entity): void {
  (game as unknown as { stopDriveTrack(e: Entity): void }).stopDriveTrack(entity);
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => {
  resetEntityIds();
  ScenarioRandom.seed = 1;
  ScenarioRandom.callCount = 0;
});

describe('DriveClass::Mark_Track vehicle reservations', () => {
  it('reserves HeadToCoord so a second drive-class unit cannot start into it', () => {
    const game = createGame();
    const first = placeVehicle(game, UnitType.V_3TNK, 10, 10, Dir.E);
    first.moveTarget = { lx: 11 * 256 + 128, ly: 10 * 256 + 128 };
    first.path = [{ cx: 11, cy: 10 }];

    updateMove(game, first);

    expect(first.isDriving).toBe(true);
    expect(game.map.getVehicleTrackReservation(11, 10)).toBe(first.id);

    const second = placeVehicle(game, UnitType.V_3TNK, 11, 11, Dir.N);
    second.moveTarget = { lx: 11 * 256 + 128, ly: 10 * 256 + 128 };
    second.path = [{ cx: 11, cy: 10 }];
    const callsBefore = ScenarioRandom.callCount;

    updateMove(game, second);

    expect(second.isDriving).toBe(false);
    expect(second.trackNumber).toBe(-1);
    expect(second.trackReservationCells).toEqual([]);
    expect(ScenarioRandom.callCount, 'blocked Start_Driver path does not add Mission_Move jitter RNG').toBe(callsBefore);
  });

  it('reserves the unpassed midpoint for long two-cell tracks', () => {
    const game = createGame();
    const tank = placeVehicle(game, UnitType.V_3TNK, 10, 10, Dir.E);
    tank.moveTarget = { lx: 12 * 256 + 128, ly: 9 * 256 + 128 };
    tank.path = [{ cx: 11, cy: 10 }, { cx: 12, cy: 9 }];

    updateMove(game, tank);

    expect(tank.isDriving).toBe(true);
    expect(game.map.getVehicleTrackReservation(11, 10), 'midpoint reservation').toBe(tank.id);
    expect(game.map.getVehicleTrackReservation(12, 9), 'head-to reservation').toBe(tank.id);
    expect(tank.trackReservationCells).toHaveLength(2);
  });

  it('Stop_Driver clears Mark_Track reservations generically', () => {
    const game = createGame();
    const tank = placeVehicle(game, UnitType.V_3TNK, 10, 10, Dir.E);
    tank.moveTarget = { lx: 11 * 256 + 128, ly: 10 * 256 + 128 };
    tank.path = [{ cx: 11, cy: 10 }];

    updateMove(game, tank);
    expect(game.map.canEnterCell(11, 10, false, undefined, false, tank.id)).toBe(MoveResult.OK);
    expect(game.map.canEnterCell(11, 10, false)).toBe(MoveResult.OCCUPIED);

    stopDriveTrack(game, tank);

    expect(tank.isDriving).toBe(false);
    expect(game.map.getVehicleTrackReservation(11, 10)).toBe(0);
    expect(game.map.canEnterCell(11, 10, false)).toBe(MoveResult.OK);
  });
});
