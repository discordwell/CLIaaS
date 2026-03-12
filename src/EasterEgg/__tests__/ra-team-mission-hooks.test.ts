/**
 * @vitest-environment jsdom
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Entity, resetEntityIds } from '../engine/entity';
import { House, Mission, UnitType, CELL_SIZE } from '../engine/types';
import type { MapStructure } from '../engine/scenario';

class FakeAudio {
  src = '';
  preload = '';
  volume = 1;
  currentTime = 0;
  muted = false;
  loop = false;

  addEventListener(): void {}
  removeEventListener(): void {}
  play(): Promise<void> { return Promise.resolve(); }
  pause(): void {}
  cloneNode(): FakeAudio { return new FakeAudio(); }
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 400;
  return canvas;
}

function createGame(): Game {
  const game = new Game(createCanvas());
  game.map.setBounds(0, 0, 24, 24);
  return game;
}

function callUpdateTeamMission(game: Game, entity: Entity): void {
  (game as unknown as { updateTeamMission(entity: Entity): void }).updateTeamMission(entity);
}

function callUpdateEntity(game: Game, entity: Entity): void {
  (game as unknown as { updateEntity(entity: Entity): void }).updateEntity(entity);
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

describe('Team mission parity hooks', () => {
  it('TMISSION_DEPLOY turns an MCV into a FACT owned by the MCV house', () => {
    const game = createGame();
    game.playerHouse = House.Greece;

    const mcv = new Entity(UnitType.V_MCV, House.England, 10 * CELL_SIZE + CELL_SIZE / 2, 10 * CELL_SIZE + CELL_SIZE / 2);
    mcv.teamMissions = [{ mission: 9, data: 0 }];
    game.entities.push(mcv);
    game.entityById.set(mcv.id, mcv);

    callUpdateTeamMission(game, mcv);

    expect(mcv.alive).toBe(false);
    expect(mcv.teamMissionIndex).toBe(1);
    expect(game.structures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'FACT',
          house: House.England,
          cx: 9,
          cy: 9,
        }),
      ]),
    );
  });

  it('TMISSION_DEPLOY drops a minelayer mine at the current cell', () => {
    const game = createGame();

    const mnly = new Entity(UnitType.V_MNLY, House.USSR, 7 * CELL_SIZE + CELL_SIZE / 2, 8 * CELL_SIZE + CELL_SIZE / 2);
    mnly.teamMissions = [{ mission: 9, data: 0 }];
    game.entities.push(mnly);
    game.entityById.set(mnly.id, mnly);

    callUpdateTeamMission(game, mnly);

    expect(mnly.teamMissionIndex).toBe(1);
    expect(mnly.ammo).toBe(4);
    expect(game.mines).toContainEqual({
      cx: 7,
      cy: 8,
      house: House.USSR,
      damage: 1000,
    });
  });

  it('TMISSION_SPY turns a waypoint-on-building into a spy infiltration', () => {
    const game = createGame();
    game.playerHouse = House.Greece;
    game.tick = 8;

    const structure: MapStructure = {
      type: 'POWR',
      image: 'powr',
      house: House.USSR,
      cx: 5,
      cy: 5,
      hp: 200,
      maxHp: 200,
      alive: true,
      rubble: false,
      attackCooldown: 0,
      ammo: -1,
      maxAmmo: -1,
      triggerName: 'SPYS',
    };
    game.structures.push(structure);

    const spy = new Entity(
      UnitType.I_SPY,
      House.Greece,
      5 * CELL_SIZE + CELL_SIZE,
      5 * CELL_SIZE + CELL_SIZE,
    );
    spy.teamMissions = [{ mission: 15, data: 6 }];
    spy.lastAIScan = 0;
    game.entities.push(spy);
    game.entityById.set(spy.id, spy);
    ((game as unknown as { waypoints: Map<number, { cx: number; cy: number }> }).waypoints).set(6, { cx: 5, cy: 5 });

    callUpdateEntity(game, spy);

    expect(spy.alive).toBe(false);
    expect(spy.mission).toBe(Mission.DIE);
    expect(
      ((game as unknown as { spiedBuildingTriggers: Set<string> }).spiedBuildingTriggers).has('SPYS'),
    ).toBe(true);
  });
});
