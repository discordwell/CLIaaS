/**
 * @vitest-environment jsdom
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Entity } from '../engine/entity';
import { Game } from '../engine/index';
import { GameMap, Terrain } from '../engine/map';
import { ScenarioRandom } from '../engine/random';
import { type MapStructure } from '../engine/scenario';
import { CELL_SIZE, House, MAP_CELLS, Mission, RESFACTOR, UnitType } from '../engine/types';

class FakeAudio {
  src = ''; preload = ''; volume = 1; currentTime = 0; muted = false; loop = false;
  addEventListener(): void {}
  removeEventListener(): void {}
  play(): Promise<void> { return Promise.resolve(); }
  pause(): void {}
  cloneNode(): FakeAudio { return new FakeAudio(); }
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320 * RESFACTOR;
  canvas.height = 200 * RESFACTOR;
  return canvas;
}

function dispatchMission(game: Game, entity: Entity): void {
  (game as unknown as { dispatchMission(entity: Entity, missionTimerFired: boolean): void })
    .dispatchMission(entity, true);
}

function makeRefinery(house: House, cx: number, cy: number): MapStructure {
  return {
    type: 'PROC', image: 'proc', house, cx, cy,
    hp: 900, maxHp: 900, alive: true, rubble: false,
    attackCooldown: 0, ammo: -1, maxAmmo: -1,
  } as MapStructure;
}

function placeGold(game: Game, cx: number, cy: number): void {
  const idx = cy * MAP_CELLS + cx;
  game.map.overlay[idx] = GameMap.OVERLAY_GOLD1;
  game.map.oreDensity[idx] = 0x0E - 0x03;
  game.map.setTerrain(cx, cy, Terrain.ORE);
}

function markPlayerMapped(game: Game, cx: number, cy: number): void {
  (game as unknown as { playerMappedCells: Uint8Array }).playerMappedCells[cy * MAP_CELLS + cx] = 1;
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

describe('C++ parity: MISSION_HARVEST on non-harvesters', () => {
  it('uses MissionClass fixed 30-second delay for infantry without consuming RNG', () => {
    const game = new Game(createCanvas());
    const civilian = new Entity(UnitType.I_C5, House.France, 46 * 24, 61 * 24);
    civilian.mission = Mission.HARVEST;
    civilian.missionTimer = 0;

    ScenarioRandom.seed = 0x12345678;
    ScenarioRandom.callCount = 0;

    dispatchMission(game, civilian);

    expect(ScenarioRandom.callCount).toBe(0);
    expect(ScenarioRandom.seed).toBe(0x12345678);
    expect(civilian.mission).toBe(Mission.HARVEST);
    expect(civilian.missionTimer).toBe(450);
  });

  it('uses UnitClass fixed 30-second delay for non-harvester vehicles without consuming RNG', () => {
    const game = new Game(createCanvas());
    const jeep = new Entity(UnitType.V_JEEP, House.France, 46 * 24, 52 * 24);
    jeep.mission = Mission.HARVEST;
    jeep.missionTimer = 0;

    ScenarioRandom.seed = 0x87654321;
    ScenarioRandom.callCount = 0;

    dispatchMission(game, jeep);

    expect(ScenarioRandom.callCount).toBe(0);
    expect(ScenarioRandom.seed).toBe(0x87654321);
    expect(jeep.mission).toBe(Mission.HARVEST);
    expect(jeep.missionTimer).toBe(450);
  });
});

describe('C++ parity: MISSION_HARVEST harvester timer returns', () => {
  it('starts current-cell harvesting with fixed delay 1 and no RNG', () => {
    const game = new Game(createCanvas());
    game.map.setBounds(0, 0, 128, 128);
    game.structures.push(makeRefinery(House.Greece, 24, 9));
    placeGold(game, 12, 10);

    const harv = new Entity(
      UnitType.V_HARV,
      House.Greece,
      12 * CELL_SIZE + CELL_SIZE / 2,
      10 * CELL_SIZE + CELL_SIZE / 2,
    );
    harv.mission = Mission.HARVEST;
    harv.missionTimer = 0;
    harv.harvesterState = 'idle';

    ScenarioRandom.seed = 0x2468ace0;
    ScenarioRandom.callCount = 0;

    dispatchMission(game, harv);

    expect(ScenarioRandom.callCount).toBe(0);
    expect(ScenarioRandom.seed).toBe(0x2468ace0);
    expect(harv.harvesterState).toBe('harvesting');
    expect(harv.missionTimer).toBe(1);
  });

  it('ignores unmapped remote ore for player harvesters and enters GOINGTOIDLE without RNG', () => {
    const game = new Game(createCanvas());
    game.map.setBounds(28, 36, 80, 54);
    game.structures.push(makeRefinery(House.Greece, 60, 43));
    placeGold(game, 51, 38);

    const harv = new Entity(
      UnitType.V_HARV,
      House.Greece,
      60 * CELL_SIZE + CELL_SIZE / 2,
      47 * CELL_SIZE + CELL_SIZE / 2,
    );
    harv.mission = Mission.HARVEST;
    harv.missionTimer = 0;
    harv.harvesterState = 'idle';
    game.entities.push(harv);
    game.entityById.set(harv.id, harv);
    game.map.setVehicleOccupancy(60, 47, harv.id);
    game.map.updateFogOfWar([{ x: harv.pos.x, y: harv.pos.y, sight: harv.stats.sight }]);

    ScenarioRandom.seed = 0x31415926;
    ScenarioRandom.callCount = 0;

    dispatchMission(game, harv);

    expect(game.map.getVisibility(51, 38)).toBe(0);
    expect(ScenarioRandom.callCount).toBe(0);
    expect(ScenarioRandom.seed).toBe(0x31415926);
    expect(harv.harvesterState).toBe('goingtoidle');
    expect(harv.moveTarget).toBeNull();
    expect(harv.mission).toBe(Mission.HARVEST);
    expect(harv.missionTimer).toBe(105);
  });

  it('accepts mapped remote ore for player harvesters using the harvest fallthrough jitter', () => {
    const game = new Game(createCanvas());
    game.map.setBounds(28, 36, 80, 54);
    game.structures.push(makeRefinery(House.Greece, 60, 43));
    placeGold(game, 51, 38);
    game.map.setVisibility(51, 38, 1);
    markPlayerMapped(game, 51, 38);

    const harv = new Entity(
      UnitType.V_HARV,
      House.Greece,
      60 * CELL_SIZE + CELL_SIZE / 2,
      47 * CELL_SIZE + CELL_SIZE / 2,
    );
    harv.mission = Mission.HARVEST;
    harv.missionTimer = 0;
    harv.harvesterState = 'idle';
    game.entities.push(harv);
    game.entityById.set(harv.id, harv);
    game.map.setVehicleOccupancy(60, 47, harv.id);

    ScenarioRandom.seed = 0x27182818;
    ScenarioRandom.callCount = 0;

    dispatchMission(game, harv);

    expect(ScenarioRandom.callCount).toBe(1);
    expect(harv.harvesterState).toBe('seeking');
    expect(harv.moveTarget).not.toBeNull();
    expect(harv.mission).toBe(Mission.HARVEST);
    expect(harv.missionTimer).toBeGreaterThanOrEqual(14);
    expect(harv.missionTimer).toBeLessThanOrEqual(16);
  });
});
