/**
 * @vitest-environment jsdom
 *
 * C++ behavioral parity: FootClass::Per_Cell_Process(PCP_END) springs
 * cell triggers immediately as the moving object reaches the cell.
 *
 * C++ refs:
 *   foot.cpp:1489-1497  Map[Coord].Trigger->Spring(TEVENT_PLAYER_ENTERED, this)
 *   trigger.cpp:227-358 TriggerClass::Spring executes actions immediately
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import { Terrain } from '../engine/map';
import {
  CELL_SIZE,
  House,
  MAP_CELLS,
  Mission,
  RESFACTOR,
  UnitType,
} from '../engine/types';
import {
  TEVENT_NONE,
  TEVENT_PLAYER_ENTERED,
  type ScenarioTrigger,
} from '../engine/scenario';

const TACTION_NONE = 0;
const TACTION_SET_GLOBAL = 28;

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
  game.map.setBounds(0, 0, 16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) game.map.setTerrain(x, y, Terrain.CLEAR);
  }
  return game;
}

function makeTrigger(name: string, globalIndex: number): ScenarioTrigger {
  return {
    name,
    persistence: 0,
    house: 0,
    eventControl: 0,
    actionControl: 0,
    event1: { type: TEVENT_PLAYER_ENTERED, team: -1, data: 0 },
    event2: { type: TEVENT_NONE, team: -1, data: 0 },
    action1: { action: TACTION_SET_GLOBAL, team: -1, trigger: -1, data: globalIndex },
    action2: { action: TACTION_NONE, team: -1, trigger: -1, data: 0 },
    fired: false,
    timerTick: 0,
    playerEntered: false,
    playerEnteredHouse: -1,
    objectDiscovered: false,
    enteredZone: false,
    crossedHorizontal: false,
    crossedVertical: false,
    forceFirePending: false,
    pendingDestroyedCount: 0,
    triggeringEntityIds: [],
  };
}

function placeInfantryAtCell(game: Game, cx: number, cy: number): Entity {
  const unit = new Entity(UnitType.I_E1, House.Spain, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
  unit.mission = Mission.MOVE;
  unit.missionTimer = 10;
  unit.isDriving = true;
  unit.headToLX = unit.leptonX;
  unit.headToLY = unit.leptonY;
  game.entities.push(unit);
  game.entityById.set(unit.id, unit);
  return unit;
}

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => {
  resetEntityIds();
});

describe('FootClass::Per_Cell_Process cell trigger spring timing', () => {
  it('springs PLAYER_ENTERED and executes actions during the movement PCP_END call', () => {
    const game = createGame();
    const trigger = makeTrigger('walk', 6);
    const cellIdx = 5 * MAP_CELLS + 5;
    game.map.cellTriggers.set(cellIdx, trigger.name);
    (game as unknown as { triggers: ScenarioTrigger[] }).triggers = [trigger];

    const unit = placeInfantryAtCell(game, 5, 5);

    (game as unknown as { updateMove(entity: Entity): void }).updateMove(unit);

    expect((game as unknown as { globals: Set<number> }).globals.has(6)).toBe(true);
    expect(trigger.fired).toBe(true);
    expect(trigger.triggeringEntityIds).toEqual([unit.id]);
  });
});
