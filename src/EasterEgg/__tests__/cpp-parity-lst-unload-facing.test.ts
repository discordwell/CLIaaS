/**
 * @vitest-environment jsdom
 *
 * C++ parity: VesselClass::Mission_Unload INITIAL_CHECK.
 *
 * C++ source refs:
 *   vessel.cpp:1563-1636 — Desired_Load_Dir chooses the adjacent staging cell
 *   vessel.cpp:1727-1730 — INITIAL_CHECK calls Desired_Load_Dir + Do_Turn
 *   drive.cpp:1369-1379  — DriveClass::AI rotates PrimaryFacing after dispatch
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import { ScenarioRandom } from '../engine/random';
import { Terrain } from '../engine/map';
import {
  CELL_SIZE, House, Mission, RESFACTOR, UnitType, cellTargetToLepton,
  cellToLepton,
} from '../engine/types';

class FakeAudio {
  src = ''; preload = ''; volume = 1; currentTime = 0; muted = false; loop = false;
  addEventListener(): void {} removeEventListener(): void {}
  play(): Promise<void> { return Promise.resolve(); } pause(): void {}
  cloneNode(): FakeAudio { return new FakeAudio(); }
}

type GroundProcessor = {
  tick: number;
  _processGroundEntity(entity: Entity): void;
};

type LogicHintProbe = {
  logicIndexHintForNewObject(): number;
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

function processGroundEntity(game: Game, entity: Entity): void {
  const g = game as unknown as GroundProcessor;
  g._processGroundEntity(entity);
  g.tick++;
}

function placeUnloadingLST(game: Game, cx: number, cy: number, passenger: Entity): Entity {
  const lst = new Entity(UnitType.V_LST, House.Greece, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  lst.mission = Mission.UNLOAD;
  lst.missionTimer = 0;
  lst.vesselUnloadStatus = 0;
  lst.bodyFacing256 = 0;
  lst.desiredFacing256 = 0;
  lst.facing = 0;
  lst.desiredFacing = 0;
  lst.passengers.push(passenger);

  passenger.inLimbo = true;
  passenger.transportRef = lst;

  game.entities.push(lst);
  game.entityById.set(lst.id, lst);
  return lst;
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

describe('LST Mission_Unload facing setup', () => {
  it('INITIAL_CHECK sets Desired_Load_Dir facing and rotates once before the next tick', () => {
    const game = createGame();
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 0, 0);
    const lst = placeUnloadingLST(game, 20, 20, mcv);

    processGroundEntity(game, lst);

    expect(ScenarioRandom.callCount).toBe(0);
    expect(lst.vesselUnloadStatus).toBe(1);
    expect(lst.desiredFacing256).toBe(128);
    expect(lst.bodyFacing256).toBe(246);
    expect(lst.missionTimer).toBe(0);
  });

  it('unloads the first passenger toward the selected staging cell, not current hull facing', () => {
    const game = createGame();
    const mcv = new Entity(UnitType.V_MCV, House.Greece, 0, 0);
    const lst = placeUnloadingLST(game, 20, 20, mcv);

    for (let i = 0; i < 80 && mcv.inLimbo; i++) {
      processGroundEntity(game, lst);
    }

    expect(mcv.inLimbo).toBe(false);
    expect(mcv.bodyFacing256).toBe(0);
    expect(mcv.moveTarget).toEqual(cellTargetToLepton(20, 19));
  });

  it('snaps infantry passenger unlimbo coord to the C++ ScenarioInit subcell', () => {
    const game = createGame();
    const rifle = new Entity(UnitType.E3, House.Greece, 0, 0);
    const lst = placeUnloadingLST(game, 20, 20, rifle);
    lst.vesselUnloadStatus = 3;
    lst.bodyFacing256 = 128;
    lst.desiredFacing256 = 128;
    lst.facing = 4;
    lst.desiredFacing = 4;
    game.map.setVehicleOccupancy(20, 19, 999);

    processGroundEntity(game, lst);

    const center = cellToLepton(20, 20);
    expect(rifle.inLimbo).toBe(false);
    expect(rifle.leptonX).toBe(center.lx + 64);
    expect(rifle.leptonY).toBe(center.ly - 64);
    expect(rifle.subCell).toBe(2);
    expect(rifle.bodyFacing256).toBe(32);
    expect(rifle.moveTarget).toEqual(cellTargetToLepton(21, 19));
    expect(rifle.logicIndexHint).toBeDefined();
    expect((game as unknown as LogicHintProbe).logicIndexHintForNewObject())
      .toBeGreaterThan(rifle.logicIndexHint!);
  });
});
