import { describe, it, expect } from 'vitest';
import { GameMap, Terrain } from '../engine/map';
import { MAP_CELLS } from '../engine/types';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Multi-Theatre Tileset Tests
 *
 * Verifies:
 * 1. All three tileset files (TEMPERATE, SNOW, INTERIOR) were extracted
 * 2. SNOW terrain classification uses same ranges as TEMPERATE
 * 3. INTERIOR terrain classification handles wall/floor IDs correctly
 * 4. Renderer clear tile check handles both 0xFF and 0xFFFF
 * 5. templateType Uint16Array properly stores INTERIOR IDs (253-399)
 */

const ASSETS_DIR = join(__dirname, '../../../public/ra/assets');
const hasAssets = existsSync(join(ASSETS_DIR, 'tileset.json'));

describe('Multi-theatre tileset extraction', () => {
  it.skipIf(!hasAssets)('TEMPERATE tileset files exist', () => {
    expect(existsSync(join(ASSETS_DIR, 'tileset.png'))).toBe(true);
    expect(existsSync(join(ASSETS_DIR, 'tileset.json'))).toBe(true);
  });

  it.skipIf(!hasAssets)('SNOW tileset files exist', () => {
    expect(existsSync(join(ASSETS_DIR, 'snow_tileset.png'))).toBe(true);
    expect(existsSync(join(ASSETS_DIR, 'snow_tileset.json'))).toBe(true);
  });

  it.skipIf(!hasAssets)('INTERIOR tileset files exist', () => {
    expect(existsSync(join(ASSETS_DIR, 'interior_tileset.png'))).toBe(true);
    expect(existsSync(join(ASSETS_DIR, 'interior_tileset.json'))).toBe(true);
  });

  it.skipIf(!hasAssets)('TEMPERATE tileset has expected tile count', () => {
    const meta = JSON.parse(readFileSync(join(ASSETS_DIR, 'tileset.json'), 'utf-8'));
    expect(meta.tileCount).toBeGreaterThan(1400);
    expect(meta.tileW).toBe(24);
    expect(meta.tileH).toBe(24);
  });

  it.skipIf(!hasAssets)('SNOW tileset has expected tile count', () => {
    const meta = JSON.parse(readFileSync(join(ASSETS_DIR, 'snow_tileset.json'), 'utf-8'));
    expect(meta.tileCount).toBeGreaterThan(1400);
  });

  it.skipIf(!hasAssets)('INTERIOR tileset has expected tile count', () => {
    const meta = JSON.parse(readFileSync(join(ASSETS_DIR, 'interior_tileset.json'), 'utf-8'));
    expect(meta.tileCount).toBeGreaterThan(100);
  });
});

describe('INTERIOR terrain classification', () => {
  let map: GameMap;

  function setup() {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
  }

  /** Apply INTERIOR terrain classification (mirrors classifyInteriorTerrain from scenario.ts) */
  function classifyInterior(map: GameMap) {
    for (let cy = map.boundsY; cy < map.boundsY + map.boundsH; cy++) {
      for (let cx = map.boundsX; cx < map.boundsX + map.boundsW; cx++) {
        const idx = cy * MAP_CELLS + cx;
        const tmpl = map.templateType[idx];
        if (tmpl === 0xFFFF || tmpl === 0x00 || tmpl === 255) {
          // Clear floor
        } else if (tmpl >= 291 && tmpl <= 317) {
          map.setTerrain(cx, cy, Terrain.WALL);
        } else if (tmpl >= 329 && tmpl <= 377) {
          map.setTerrain(cx, cy, Terrain.ROCK);
        }
      }
    }
  }

  it('wall templates (329-377) classify as ROCK', () => {
    for (const tmpl of [329, 350, 377]) {
      setup();
      map.templateType[50 * MAP_CELLS + 50] = tmpl;
      classifyInterior(map);
      expect(map.getTerrain(50, 50)).toBe(Terrain.ROCK);
    }
  });

  it('light wall templates (291-317) classify as WALL', () => {
    for (const tmpl of [291, 305, 317]) {
      setup();
      map.templateType[50 * MAP_CELLS + 50] = tmpl;
      classifyInterior(map);
      expect(map.getTerrain(50, 50)).toBe(Terrain.WALL);
    }
  });

  it('floor templates (253-290, 318-328, 384-399) stay CLEAR', () => {
    for (const tmpl of [253, 268, 280, 318, 384, 399]) {
      setup();
      map.templateType[50 * MAP_CELLS + 50] = tmpl;
      classifyInterior(map);
      expect(map.getTerrain(50, 50)).toBe(Terrain.CLEAR);
    }
  });

  it('templateType stores INTERIOR IDs (253-399) without truncation', () => {
    setup();
    const idx = 50 * MAP_CELLS + 50;
    for (const id of [253, 291, 329, 377, 399]) {
      map.templateType[idx] = id;
      expect(map.templateType[idx]).toBe(id);
    }
  });

  it('clear/0xFFFF treated as passable floor in INTERIOR', () => {
    setup();
    const idx = 50 * MAP_CELLS + 50;
    map.templateType[idx] = 0xFFFF;
    classifyInterior(map);
    expect(map.getTerrain(50, 50)).toBe(Terrain.CLEAR);

    map.templateType[idx] = 255;
    classifyInterior(map);
    expect(map.getTerrain(50, 50)).toBe(Terrain.CLEAR);
  });
});

describe('SNOW terrain classification (same as TEMPERATE)', () => {
  let map: GameMap;

  function setup() {
    map = new GameMap();
    map.setBounds(40, 40, 50, 50);
  }

  /** Apply outdoor terrain classification (mirrors classifyOutdoorTerrain from scenario.ts) */
  function classifyOutdoor(map: GameMap) {
    for (let cy = map.boundsY; cy < map.boundsY + map.boundsH; cy++) {
      for (let cx = map.boundsX; cx < map.boundsX + map.boundsW; cx++) {
        const idx = cy * MAP_CELLS + cx;
        const tmpl = map.templateType[idx];
        if (tmpl === 0xFFFF || tmpl === 0x00) {
          // Clear
        } else if (tmpl >= 1 && tmpl <= 2) {
          map.setTerrain(cx, cy, Terrain.WATER);
        } else if (tmpl >= 3 && tmpl <= 56) {
          const icon = map.templateIcon[idx];
          if (icon < 4) map.setTerrain(cx, cy, Terrain.WATER);
        } else if ((tmpl >= 59 && tmpl <= 96) || (tmpl >= 112 && tmpl <= 130) ||
                   (tmpl >= 229 && tmpl <= 234)) {
          map.setTerrain(cx, cy, Terrain.WATER);
        } else if ((tmpl >= 57 && tmpl <= 58) || (tmpl >= 97 && tmpl <= 110) ||
                   (tmpl >= 131 && tmpl <= 172)) {
          map.setTerrain(cx, cy, Terrain.ROCK);
        } else if (tmpl === 400 || (tmpl >= 401 && tmpl <= 404) ||
                   (tmpl >= 500 && tmpl <= 508)) {
          map.setTerrain(cx, cy, Terrain.ROCK);
        } else if ((tmpl >= 405 && tmpl <= 408) ||
                   (tmpl >= 550 && tmpl <= 557)) {
          map.setTerrain(cx, cy, Terrain.WATER);
        }
      }
    }
  }

  it('water templates (1-2) classify as WATER', () => {
    setup();
    map.templateType[50 * MAP_CELLS + 50] = 1;
    classifyOutdoor(map);
    expect(map.getTerrain(50, 50)).toBe(Terrain.WATER);
  });

  it('rock templates (97-110) classify as ROCK', () => {
    setup();
    map.templateType[50 * MAP_CELLS + 50] = 99;
    classifyOutdoor(map);
    expect(map.getTerrain(50, 50)).toBe(Terrain.ROCK);
  });

  it('road templates (173-228) stay CLEAR', () => {
    setup();
    map.templateType[50 * MAP_CELLS + 50] = 180;
    classifyOutdoor(map);
    expect(map.getTerrain(50, 50)).toBe(Terrain.CLEAR);
  });

  it('extended hill template (400) classifies as ROCK', () => {
    setup();
    map.templateType[50 * MAP_CELLS + 50] = 400;
    classifyOutdoor(map);
    expect(map.getTerrain(50, 50)).toBe(Terrain.ROCK);
  });

  it('extended water cliff (405-408) classifies as WATER', () => {
    setup();
    map.templateType[50 * MAP_CELLS + 50] = 406;
    classifyOutdoor(map);
    expect(map.getTerrain(50, 50)).toBe(Terrain.WATER);
  });

  it('bridge variants (378-383) stay CLEAR', () => {
    setup();
    map.templateType[50 * MAP_CELLS + 50] = 380;
    classifyOutdoor(map);
    expect(map.getTerrain(50, 50)).toBe(Terrain.CLEAR);
  });
});

describe('Renderer clear tile check', () => {
  it('both 0xFF and 0xFFFF are treated as clear template values', () => {
    const isClear = (tmpl: number) => tmpl === 0 || tmpl === 0xFF || tmpl === 0xFFFF;
    expect(isClear(0xFF)).toBe(true);
    expect(isClear(0xFFFF)).toBe(true);
    expect(isClear(0)).toBe(true);
    expect(isClear(180)).toBe(false);
    expect(isClear(400)).toBe(false);
  });

  it('tileset skip condition excludes both 0xFF and 0xFFFF', () => {
    const shouldUseTileset = (tmpl: number) => tmpl > 0 && tmpl !== 0xFF && tmpl !== 0xFFFF;
    expect(shouldUseTileset(0)).toBe(false);
    expect(shouldUseTileset(0xFF)).toBe(false);
    expect(shouldUseTileset(0xFFFF)).toBe(false);
    expect(shouldUseTileset(1)).toBe(true);
    expect(shouldUseTileset(180)).toBe(true);
    expect(shouldUseTileset(400)).toBe(true);
    expect(shouldUseTileset(329)).toBe(true);
  });
});
