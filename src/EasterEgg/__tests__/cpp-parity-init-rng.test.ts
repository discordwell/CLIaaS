/**
 * C++ parity: scenario-init RNG is source-derived, not scenario-ID keyed.
 *
 * C++ startup consumes gameplay RNG while reading the scenario:
 * - HouseClass::Read_INI creates all 20 houses; each constructor seeds Attack.
 * - Map.Overpass randomizes every ore/gem overlay variant inside map bounds.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Game } from '../engine/index';
import { GameMap } from '../engine/map';
import { ScenarioRandom } from '../engine/random';

function resetScenarioRandom(): void {
  ScenarioRandom.seed = 0;
  ScenarioRandom.callCount = 0;
  ScenarioRandom.debugLog = [];
  ScenarioRandom.debugLogStart = 0;
  ScenarioRandom._seedLog = [];
  ScenarioRandom._taggedLog = [];
}

function installScenarioFetch(): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.pathname
        : input.url;
    const filePath = resolve(__dirname, '../../../public', url.replace(/^\//, ''));
    try {
      const text = readFileSync(filePath, 'utf8');
      return { ok: true, text: async () => text };
    } catch {
      return { ok: false, status: 404, text: async () => 'Not found' };
    }
  });
}

function createHeadlessGame(): Game {
  vi.stubGlobal('Audio', function Audio() {
    return {
      addEventListener: () => {},
      removeEventListener: () => {},
      play: () => Promise.resolve(),
      pause: () => {},
      load: () => {},
      canPlayType: () => '',
      set src(_value: string) {},
    };
  });
  vi.stubGlobal('window', {
    addEventListener: () => {},
    removeEventListener: () => {},
    devicePixelRatio: 1,
  });
  const canvas = {
    width: 640,
    height: 400,
    style: {},
    getContext: () => ({
      imageSmoothingEnabled: false,
      fillRect: () => {},
      clearRect: () => {},
      drawImage: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      beginPath: () => {},
      rect: () => {},
      clip: () => {},
      stroke: () => {},
      fillText: () => {},
      measureText: () => ({ width: 0 }),
      createPattern: () => null,
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 400 }),
  } as unknown as HTMLCanvasElement;
  const game = new Game(canvas);
  game.assets.loadAll = async () => {};
  const assetsDir = resolve(__dirname, '../../../public/ra/assets');
  for (const [theatre, prefix] of [['TEMPERATE', ''], ['SNOW', 'snow_'], ['INTERIOR', 'interior_']] as const) {
    const meta = JSON.parse(readFileSync(resolve(assetsDir, `${prefix}tileset.json`), 'utf8'));
    game.assets.setTilesetMeta(theatre, meta);
  }
  game.audio.init = () => {};
  game.audio.resume = () => {};
  game.audio.loadSamples = () => {};
  (game.audio as unknown as { startAmbient: () => void }).startAmbient = () => {};
  (game.audio.music as unknown as { play: () => void }).play = () => {};
  (game as unknown as { render: () => void }).render = () => {};
  (game as unknown as { gameLoop: () => void }).gameLoop = () => {};
  return game;
}

describe('scenario init RNG parity', () => {
  beforeEach(() => {
    resetScenarioRandom();
    installScenarioFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replays C++ ore/gem overpass RNG in playable-map scan order', () => {
    const map = new GameMap();
    map.setBounds(10, 20, 3, 2);
    map.overlay[20 * 128 + 10] = GameMap.OVERLAY_GOLD1;
    map.overlay[20 * 128 + 11] = GameMap.OVERLAY_GEMS1;
    map.overlay[21 * 128 + 12] = GameMap.OVERLAY_GOLD4;
    map.overlay[19 * 128 + 10] = GameMap.OVERLAY_GOLD1; // outside bounds: no C++ overpass RNG

    map.applyScenarioOreOverpass();

    expect(ScenarioRandom.callCount).toBe(3);
    expect(map.overlay[20 * 128 + 10]).toBe(GameMap.OVERLAY_GOLD1);
    expect(map.overlay[20 * 128 + 11]).toBe(GameMap.OVERLAY_GEMS2);
    expect(map.overlay[21 * 128 + 12]).toBe(GameMap.OVERLAY_GOLD2);
    expect(map.overlay[19 * 128 + 10]).toBe(GameMap.OVERLAY_GOLD1);
  });

  it('does not fall back to an SCG01 seed for unlisted campaign scenarios', async () => {
    const game = createHeadlessGame();

    await game.start('SCG05EA', 'normal');
    game.consumeInitRNG();

    expect(ScenarioRandom.seed).toBe(2254773699);
    expect(ScenarioRandom.seed).not.toBe(3520260643);
    expect(ScenarioRandom.debugLogStart).toBe(ScenarioRandom.callCount);
  });
});
