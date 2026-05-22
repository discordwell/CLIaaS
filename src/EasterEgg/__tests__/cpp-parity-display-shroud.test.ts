/**
 * C++ visual parity: display shroud is Map_Cell state, not current gameplay sight.
 *
 * Red Alert stores CellClass::IsMapped and CellClass::IsVisible for rendering
 * SHADOW.SHP. That state persists after a unit moves away; current TS gameplay
 * sight still downgrades visible cells to fog for targeting/discovery behavior.
 */

import { describe, expect, it } from 'vitest';
import { GameMap } from '../engine/map';
import { CELL_SIZE } from '../engine/types';

function unit(cx: number, cy: number, sight: number): { x: number; y: number; sight: number } {
  return {
    x: cx * CELL_SIZE + CELL_SIZE / 2,
    y: cy * CELL_SIZE + CELL_SIZE / 2,
    sight,
  };
}

describe('DisplayClass::Map_Cell shroud state', () => {
  it('maps reveal-radius edge cells as IsMapped but not necessarily IsVisible', () => {
    const map = new GameMap();

    map.updateFogOfWar([unit(64, 64, 3)]);

    expect(map.getVisibility(64, 64)).toBe(2);
    expect(map.getDisplayVisibility(64, 64)).toBe(2);

    // The outer ring is mapped so terrain can draw, but still receives a
    // SHADOW.SHP edge frame because C++ Cell_Shadow() is not -1 there.
    expect(map.getVisibility(64, 61)).toBe(2);
    expect(map.getDisplayVisibility(64, 61)).toBe(1);
    expect(map.getVisibility(61, 64)).toBe(2);
    expect(map.getDisplayVisibility(61, 64)).toBe(1);
  });

  it('does not erase display mapping when current gameplay sight downgrades', () => {
    const map = new GameMap();

    map.updateFogOfWar([unit(64, 64, 3)]);
    map.updateFogOfWar([]);

    expect(map.getVisibility(64, 64)).toBe(1);
    expect(map.getDisplayVisibility(64, 64)).toBe(2);
    expect(map.getVisibility(64, 61)).toBe(1);
    expect(map.getDisplayVisibility(64, 61)).toBe(1);
  });

  it('fully shrouds both gameplay and display state when the map is reshrouded', () => {
    const map = new GameMap();
    map.updateFogOfWar([unit(64, 64, 3)]);

    map.shroudAll();

    expect(map.getVisibility(64, 64)).toBe(0);
    expect(map.getDisplayVisibility(64, 64)).toBe(0);
    expect(map.getVisibility(64, 61)).toBe(0);
    expect(map.getDisplayVisibility(64, 61)).toBe(0);
  });
});
