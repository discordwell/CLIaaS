/**
 * C++ parity: SCG10EA west-edge Basic_Path.
 *
 * WASM region trace at SCG10EA tick 51 reports the three Greek 2TNKs stacked
 * at (23,98) with Path[0..] = N,N,NE,N,NE,SE,NE,E,NE. TS used to leave clear
 * MapPack tiles on the one-cell map-border pathing band as ROCK after
 * GameMap.initDefault(), forcing an E-first route around the cliff.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { GameMap, MoveResult, Terrain } from '../engine/map';
import { classifyOutdoorTerrain } from '../engine/scenario';
import { findPath } from '../engine/pathfinding';
import { MAP_CELLS, SpeedClass } from '../engine/types';
import type { TilesetMeta } from '../engine/assets';

const ASSETS_DIR = join(__dirname, '../../../public/ra/assets');
const snowTilesetPath = join(ASSETS_DIR, 'snow_tileset.json');
const snowTilesetMeta: TilesetMeta | null = existsSync(snowTilesetPath)
  ? JSON.parse(readFileSync(snowTilesetPath, 'utf-8'))
  : null;

function cellIndex(cx: number, cy: number): number {
  return cy * MAP_CELLS + cx;
}

function makeScg10EdgeMap(): GameMap {
  const map = new GameMap();
  map.setBounds(24, 48, 80, 56);
  map.initDefault();

  const setTemplate = (cx: number, cy: number, tmpl: number, icon = 0) => {
    const idx = cellIndex(cx, cy);
    map.templateType[idx] = tmpl;
    map.templateIcon[idx] = icon;
  };

  for (let cy = 92; cy <= 99; cy++) {
    for (let cx = 22; cx <= 30; cx++) setTemplate(cx, cy, 0xFF, 0);
  }

  for (const [cx, cy] of [
    [25, 94], [25, 95], [25, 96], [25, 97],
    [26, 95], [26, 96], [26, 97],
    [27, 94], [27, 95], [27, 96],
    [28, 95], [28, 96],
  ]) {
    setTemplate(cx, cy, 163, 0);
  }

  classifyOutdoorTerrain(map, map.templateType, map.templateIcon, 'SNOW', snowTilesetMeta);
  return map;
}

describe('SCG10EA west-edge Basic_Path parity', () => {
  it.skipIf(!snowTilesetMeta)('classifies clear MapPack tiles outside the scenario viewport as CLEAR', () => {
    const map = makeScg10EdgeMap();

    expect(map.getTerrain(23, 97)).toBe(Terrain.CLEAR);
    expect(map.isPassable(23, 97)).toBe(true);
    expect(map.getTerrain(22, 95)).toBe(Terrain.CLEAR);
    expect(map.canEnterCell(22, 95, false, undefined, false, 170)).toBe(MoveResult.OK);
  });

  it.skipIf(!snowTilesetMeta)('routes stacked 2TNKs north first around the SCG10EA west-edge cliff', () => {
    const map = makeScg10EdgeMap();

    // Live SCG10EA tick-50 occupancy from the region trace: the lead 2TNK and
    // MCV are moving blockers, and the 1TNK at (26,93) is a stationary friendly.
    map.setVehicleOccupancy(23, 98, 170);
    map.setVehicleOccupancy(24, 96, 173);
    map.setVehicleTrackReservation(cellIndex(24, 96), 173);
    map.setVehicleOccupancy(26, 93, 102);
    map.setVehicleOccupancy(24, 92, 169);
    map.setVehicleTrackReservation(cellIndex(25, 92), 169);

    const isMoving = (id: number) => id === 169 || id === 173;
    const path = findPath(
      map,
      { cx: 23, cy: 98 },
      { cx: 29, cy: 92 },
      false,
      false,
      SpeedClass.TRACK,
      isMoving,
      undefined,
      undefined,
      false,
      MoveResult.CLOAK,
      (cx, cy) => map.canEnterCell(cx, cy, false, isMoving, false, 170),
    );

    expect(path).toEqual([
      { cx: 23, cy: 97 },
      { cx: 23, cy: 96 },
      { cx: 24, cy: 95 },
      { cx: 24, cy: 94 },
      { cx: 25, cy: 93 },
      { cx: 26, cy: 94 },
      { cx: 27, cy: 93 },
      { cx: 28, cy: 93 },
      { cx: 29, cy: 92 },
    ]);
  });

  it.skipIf(!snowTilesetMeta)('keeps the later re-path on the C++ west-edge route when the platoon advances', () => {
    const map = makeScg10EdgeMap();

    map.setVehicleOccupancy(23, 97, 170);
    map.setVehicleOccupancy(24, 95, 171);
    map.setVehicleTrackReservation(cellIndex(24, 95), 171);
    map.setVehicleOccupancy(23, 94, 172);
    map.setVehicleTrackReservation(cellIndex(23, 94), 172);
    map.setVehicleOccupancy(26, 94, 173);
    map.setVehicleTrackReservation(cellIndex(26, 94), 173);

    const isMoving = (id: number) => id === 171 || id === 172 || id === 173;
    const path = findPath(
      map,
      { cx: 23, cy: 97 },
      { cx: 29, cy: 92 },
      false,
      false,
      SpeedClass.TRACK,
      isMoving,
      undefined,
      undefined,
      false,
      MoveResult.CLOAK,
      (cx, cy) => map.canEnterCell(cx, cy, false, isMoving, false, 170),
    );

    expect(path.slice(0, 4)).toEqual([
      { cx: 23, cy: 96 },
      { cx: 23, cy: 95 },
      { cx: 24, cy: 94 },
      { cx: 25, cy: 93 },
    ]);
  });
});
