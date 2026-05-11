/**
 * @vitest-environment jsdom
 *
 * C++ parity: UnitClass::Mission_Unload for UNIT_MCV (unit.cpp:2546-2576).
 *
 * SCG02EA exposed this at tick 246: the Allied MCV entered MISSION_UNLOAD.
 * C++ advanced the MCV unload status and returned 1 with no Scen.RandomNumber
 * draw; TS had fallen through to the generic non-vessel unload jitter.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import { Terrain } from '../engine/map';
import { ScenarioRandom } from '../engine/random';
import {
  CELL_SIZE, Dir, House, Mission, RESFACTOR, UnitType, pixelToLepton,
} from '../engine/types';

class FakeAudio {
  src = ''; preload = ''; volume = 1; currentTime = 0; muted = false; loop = false;
  addEventListener(): void {} removeEventListener(): void {}
  play(): Promise<void> { return Promise.resolve(); } pause(): void {}
  cloneNode(): FakeAudio { return new FakeAudio(); }
}

type MissionDispatcher = {
  dispatchMission(entity: Entity, missionTimerFired: boolean): void;
};

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
      game.map.setTerrain(x, y, Terrain.CLEAR);
    }
  }
  return game;
}

function mcvAtCell(cx: number, cy: number): Entity {
  const mcv = new Entity(UnitType.V_MCV, House.Greece, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  mcv.mission = Mission.UNLOAD;
  mcv.missionTimer = 0;
  return mcv;
}

function resetScenarioRng(): void {
  ScenarioRandom.seed = 0x12345678;
  ScenarioRandom.callCount = 0;
  ScenarioRandom._sourceTag = 0;
  ScenarioRandom._entityTag = 0;
  ScenarioRandom._seedLog = [];
  ScenarioRandom._taggedLog = [];
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => {
  resetEntityIds();
  resetScenarioRng();
});

describe('MCV Mission_Unload state machine', () => {
  it('first dispatch clears path, advances status, returns 1, and consumes no unload jitter RNG', () => {
    const game = createGame();
    const mcv = mcvAtCell(10, 10);
    mcv.path = [{ cx: 11, cy: 10 }];
    mcv.drivePathFacings = [2];
    mcv.pathIndex = 0;
    mcv.moveTarget = {
      lx: pixelToLepton(11 * CELL_SIZE + CELL_SIZE / 2),
      ly: pixelToLepton(10 * CELL_SIZE + CELL_SIZE / 2),
    };

    (game as unknown as MissionDispatcher).dispatchMission(mcv, true);

    expect(ScenarioRandom.callCount).toBe(0);
    expect(mcv.mcvUnloadStatus).toBe(1);
    expect(mcv.mission).toBe(Mission.UNLOAD);
    expect(mcv.missionTimer).toBe(1);
    expect(mcv.path).toEqual([]);
    expect(mcv.drivePathFacings).toEqual([]);
    expect(mcv.moveTarget).toBeNull();
  });

  it('failed deploy from unload status 1 queues GUARD without consuming generic unload jitter RNG', () => {
    const game = createGame();
    const mcv = mcvAtCell(10, 10);
    mcv.mcvUnloadStatus = 1;
    game.map.setTerrain(10, 10, Terrain.WATER);

    (game as unknown as MissionDispatcher).dispatchMission(mcv, true);

    expect(ScenarioRandom.callCount).toBe(0);
    expect(mcv.alive).toBe(true);
    expect(mcv.mcvUnloadStatus).toBe(0);
    expect(mcv.mission).toBe(Mission.UNLOAD);
    expect(mcv.missionQueue).toBe(Mission.GUARD);
    expect(mcv.missionTimer).toBe(1);
  });

  it('status 1 starts DIR_SW deploy rotation instead of atomically creating FACT', () => {
    const game = createGame();
    const mcv = mcvAtCell(10, 10);
    mcv.mcvUnloadStatus = 1;
    mcv.facing = Dir.S;
    mcv.bodyFacing256 = Dir.S * 32;
    mcv.desiredFacing = Dir.S;
    mcv.desiredFacing256 = Dir.S * 32;

    (game as unknown as MissionDispatcher).dispatchMission(mcv, true);

    expect(ScenarioRandom.callCount).toBe(0);
    expect(mcv.alive).toBe(true);
    expect(mcv.mission).toBe(Mission.UNLOAD);
    expect(mcv.mcvUnloadStatus).toBe(2);
    expect(mcv.mcvIsDeploying).toBe(true);
    expect(mcv.desiredFacing).toBe(Dir.SW);
    expect(mcv.bodyFacing256).toBe(Dir.S * 32 + 5);
    expect(game.structures.some(s => s.type === 'FACT' && s.house === House.Greece)).toBe(false);
  });
});
