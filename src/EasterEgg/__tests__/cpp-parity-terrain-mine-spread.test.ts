/**
 * @vitest-environment jsdom
 *
 * C++ Behavioral Parity: TerrainClass::AI for TERRAIN_MINE.
 *
 * C++ terrain.cpp:497 calls CellClass::Spread_Tiberium(true) on Frame 0 and
 * every GrowthRate*TICKS_PER_MINUTE frames after that. This must mutate the ore
 * map, not just consume the two RNG calls.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Game } from '../engine/index';
import { GameMap, Terrain } from '../engine/map';
import { ScenarioRandom } from '../engine/random';
import { MAP_CELLS, RESFACTOR } from '../engine/types';
import { resetEntityIds } from '../engine/entity';

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

beforeAll(() => {
  vi.stubGlobal('Audio', FakeAudio);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => (
    { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D
  ));
});

beforeEach(() => {
  resetEntityIds();
  ScenarioRandom.seed = 4168801279;
  ScenarioRandom.callCount = 0;
  ScenarioRandom._tagLogging = false;
  ScenarioRandom._tagLoggingExternal = false;
});

describe('TerrainClass::AI TERRAIN_MINE forced spread', () => {
  it('places ore during the Frame 0 terrain-mine Logic slot', () => {
    const game = new Game(createCanvas());
    game.map.setBounds(3, 61, 94, 54);
    game.map.initDefault();

    for (let cy = 68; cy <= 70; cy++) {
      for (let cx = 4; cx <= 6; cx++) {
        const idx = cy * MAP_CELLS + cx;
        game.map.setTerrain(cx, cy, Terrain.CLEAR);
        game.map.overlay[idx] = 0xFF;
        game.map.oreDensity[idx] = 0xFF;
      }
    }

    // SCG06EA's first MINE is in INI cell 8709 (5,68). C++ Target_Coord for
    // TERRAIN_MINE uses CenterBase XYP_COORD(12,24), so Spread_Tiberium starts
    // from cell (5,69). With the synced C++ seed, direction=SE and visual=GOLD3.
    (game as unknown as { _terrainMineCount: number })._terrainMineCount = 1;
    (game as unknown as { _terrainMineSpreadCells: Array<{ cx: number; cy: number; logicIndex: number }> })._terrainMineSpreadCells = [
      { cx: 5, cy: 69, logicIndex: 43 },
    ];

    (game as unknown as { update(): void }).update();

    const idx = 70 * MAP_CELLS + 6;
    expect(game.map.overlay[idx]).toBe(GameMap.OVERLAY_GOLD3);
    expect(game.map.oreDensity[idx]).toBe(0);
    expect(game.map.cells[idx]).toBe(Terrain.ORE);
  });

  it('consumes the overlay RNG when a mine terrain object blocks the mark-down', () => {
    const map = new GameMap();
    map.setBounds(3, 61, 94, 54);
    map.initDefault();

    for (let cy = 104; cy <= 106; cy++) {
      for (let cx = 8; cx <= 9; cx++) {
        const idx = cy * MAP_CELLS + cx;
        map.setTerrain(cx, cy, Terrain.CLEAR);
        map.overlay[idx] = 0xFF;
        map.oreDensity[idx] = 0xFF;
      }
    }

    // SCG06EA's second MINE spreads from (9,105). After the first MINE's two
    // calls, C++ draws offset SW, rejects SW/W/NW, then wraps to N. The north
    // cell is the terrain object's origin: Can_Tiberium_Germinate passes, the
    // visual ore RNG is consumed, and OverlayClass::Mark then refuses to place
    // over the TerrainClass monolith occupy bit.
    map.overlay[106 * MAP_CELLS + 8] = 0x01; // SW blocked
    map.overlay[105 * MAP_CELLS + 8] = 0x01; // W blocked
    map.overlay[104 * MAP_CELLS + 8] = 0x01; // NW blocked
    map.addTerrainObject('mine', 9, 104, [[0, 0]]);

    ScenarioRandom.seed = 469088277;
    ScenarioRandom.callCount = 0;

    expect(map.spreadTiberiumFromCell(9, 105, true)).toBe(true);

    const targetIdx = 104 * MAP_CELLS + 9;
    expect(ScenarioRandom.callCount).toBe(2);
    expect(ScenarioRandom.seed >>> 0).toBe(2209036571);
    expect(map.overlay[targetIdx]).toBe(0xFF);
    expect(map.oreDensity[targetIdx]).toBe(0);
    expect(map.cells[targetIdx]).toBe(Terrain.CLEAR);
  });
});
