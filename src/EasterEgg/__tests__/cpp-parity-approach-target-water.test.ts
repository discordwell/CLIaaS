/**
 * @vitest-environment jsdom
 *
 * C++ parity: FootClass::Approach_Target uses the object's SpeedType when
 * checking candidate approach cells (foot.cpp:992). FLOAT vessels must accept
 * water cells, then Assign_Destination(::As_Target(CELL)) stores a TARGET cell
 * coordinate that round-trips to cell*256+0x88.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { Terrain } from '../engine/map';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  CELL_SIZE, House, Mission, RESFACTOR, UnitType, cellTargetToLepton,
} from '../engine/types';

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

function atCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

describe('FootClass::Approach_Target — FLOAT passability and TARGET cell coords', () => {
  beforeAll(() => {
    vi.stubGlobal('Audio', FakeAudio);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
      { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
    ));
  });

  beforeEach(() => {
    resetEntityIds();
  });

  it('submarine approach accepts water cells and writes As_Target(CELL) NavCom coords', () => {
    const game = new Game(createCanvas());
    game.map.setBounds(0, 0, 128, 128);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        game.map.setTerrain(x, y, Terrain.WATER);
      }
    }

    const sub = atCell(UnitType.V_SS, House.USSR, 21, 53);
    const lst = atCell(UnitType.V_LST, House.Greece, 9, 53);
    sub.mission = Mission.HUNT;
    sub.target = lst;
    game.entities.push(sub, lst);
    game.entityById.set(sub.id, sub);
    game.entityById.set(lst.id, lst);

    (game as unknown as { approachTarget(e: Entity): void }).approachTarget(sub);

    expect(sub.moveTarget).toEqual(cellTargetToLepton(17, 53));
    expect(sub.path[0]).toEqual({ cx: 20, cy: 53 });
  });
});
