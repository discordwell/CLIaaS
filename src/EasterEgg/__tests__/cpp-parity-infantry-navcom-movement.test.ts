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
import { CELL_SIZE, House, Mission, RESFACTOR, UnitType, cellTargetToLepton, pixelToLepton } from '../engine/types';

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

describe('InfantryClass::Movement_AI NavCom path continuation', () => {
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
});
