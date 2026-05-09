/**
 * C++ parity: non-tree TerrainClass objects occupy cells.
 *
 * Reference: RA/tdata.cpp `BOXES01..09` and `MINE` use `_List10={0}`.
 * C++ pathing sees these objects through the CellClass occupier chain; they
 * are not just visual scenario decoration.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameMap, MoveResult, TERRAIN_OBJECT_OCCUPY } from '../engine/map';
import { loadScenario } from '../engine/scenario';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TerrainClass object occupancy (tdata.cpp Occupy_List)', () => {
  it('BOXES02 blocks ground movement on its origin cell', () => {
    const map = new GameMap();
    map.setBounds(0, 0, 128, 128);

    expect(map.canEnterCell(82, 75, false, undefined, true)).toBe(MoveResult.OK);

    map.addTerrainObject('boxes02', 82, 75, TERRAIN_OBJECT_OCCUPY.boxes02);

    expect(map.isTerrainObjectOccupied(82, 75)).toBe(true);
    expect(map.isTerrainPassable(82, 75)).toBe(false);
    expect(map.canEnterCell(82, 75, false, undefined, true)).toBe(MoveResult.IMPASSABLE);
  });

  it('loads SCG13EA BOXES02 at (82,75) as a pathing blocker', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      const scenarioId = url.split('/').pop()?.replace(/\.ini$/i, '');
      if (scenarioId !== 'SCG13EA') {
        return { ok: false, text: async () => '' } as Response;
      }
      const text = readFileSync(join(__dirname, '../../../public/ra/assets/SCG13EA.ini'), 'utf-8');
      return { ok: true, text: async () => text } as Response;
    });

    const scenario = await loadScenario('SCG13EA');

    expect(scenario.map.getTerrainObjectAtCell(82, 75)?.type).toBe('boxes02');
    expect(scenario.map.canEnterCell(82, 75, false, undefined, true)).toBe(MoveResult.IMPASSABLE);
  });
});
