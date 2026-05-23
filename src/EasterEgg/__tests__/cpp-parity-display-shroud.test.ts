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
import { revealAroundCell } from '../engine/fog';

function unit(cx: number, cy: number, sight: number): { x: number; y: number; sight: number } {
  return {
    x: cx * CELL_SIZE + CELL_SIZE / 2,
    y: cy * CELL_SIZE + CELL_SIZE / 2,
    sight,
  };
}

describe('DisplayClass::Map_Cell shroud state', () => {
  it('seeds the visible perimeter ring around scenario bounds', () => {
    // C++ scenario.cpp:588-599 maps the one-cell ring outside MapCellX/Y
    // so Cell_Shadow does not render a wall of black at playable edges.
    const map = new GameMap();
    map.setBounds(23, 57, 87, 54);

    expect(map.getDisplayVisibility(22, 57)).toBe(2);
    expect(map.getDisplayVisibility(110, 57)).toBe(2);
    expect(map.getDisplayVisibility(23, 56)).toBe(2);
    expect(map.getDisplayVisibility(109, 111)).toBe(2);

    expect(map.getDisplayVisibility(21, 57)).toBe(0);
    expect(map.getDisplayVisibility(111, 57)).toBe(0);
    expect(map.getVisibility(22, 57)).toBe(0);
  });

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

  it('marks the scenario perimeter after initial unit Look calls', () => {
    const map = new GameMap();
    map.setBounds(23, 57, 87, 54, false);

    map.updateFogOfWar([unit(26, 60, 5)]);
    map.markDisplayShroudRing();

    // C++ scenario.cpp applies the perimeter ring after object unlimbo Look().
    // Already mapped first-row cells are not re-evaluated into IsVisible.
    expect(map.getDisplayVisibility(23, 57)).toBe(1);
    expect(map.getDisplayVisibility(22, 57)).toBe(2);
  });

  it('does not reveal from an origin outside Map.In_Radar', () => {
    // C++ map.cpp:295 returns before scanning if the Look origin is outside
    // Map.In_Radar. South-edge reinforcements in SCG11EA start on the display
    // perimeter ring at y=boundsY+boundsH, but their initial Look maps nothing.
    const map = new GameMap();
    map.setBounds(20, 20, 10, 10);

    revealAroundCell(map, 22, 30, 4);

    expect(map.getDisplayVisibility(22, 30)).toBe(2);
    expect(map.getVisibility(22, 30)).toBe(0);
    expect(map.getDisplayVisibility(22, 29)).toBe(0);
    expect(map.getVisibility(22, 29)).toBe(0);
    expect(map.getDisplayVisibility(22, 28)).toBe(0);
  });

  it('ignores off-radar units during full sight rebuilds', () => {
    const map = new GameMap();
    map.setBounds(20, 20, 10, 10);

    map.updateFogOfWar([unit(22, 30, 4)]);

    expect(map.getDisplayVisibility(22, 30)).toBe(2);
    expect(map.getVisibility(22, 30)).toBe(0);
    expect(map.getDisplayVisibility(22, 29)).toBe(0);
    expect(map.getVisibility(22, 29)).toBe(0);
  });

  it('uses C++ incremental Look rings for mobile PCP_END sight', () => {
    // C++ UnitClass::Per_Cell_Process calls Look(true) at PCP_END. For Sight=4,
    // Sight_From skips RadiusCount[1], so the center and adjacent cells are not
    // part of the incremental reveal.
    const map = new GameMap();

    revealAroundCell(map, 64, 64, 4, true);

    expect(map.getVisibility(64, 64)).toBe(0);
    expect(map.getVisibility(64, 63)).toBe(0);
    expect(map.getVisibility(64, 65)).toBe(0);
    expect(map.getVisibility(63, 65)).toBe(0);
    expect(map.getVisibility(65, 65)).toBe(0);
    expect(map.getVisibility(64, 62)).toBe(2);
    expect(map.getVisibility(64, 60)).toBe(2);
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

  it('preserves the scenario perimeter ring when the map is reshrouded', () => {
    // C++ MapClass::Shroud_The_Map only clears cells inside MapCell bounds,
    // leaving the source-seeded perimeter ring visible.
    const map = new GameMap();
    map.setBounds(10, 10, 20, 20);
    map.setVisibility(15, 15, 2);
    map.revealAll();

    map.shroudAll();

    expect(map.getVisibility(15, 15)).toBe(0);
    expect(map.getDisplayVisibility(15, 15)).toBe(0);
    expect(map.getVisibility(9, 10)).toBe(0);
    expect(map.getDisplayVisibility(9, 10)).toBe(2);
    expect(map.getDisplayVisibility(30, 29)).toBe(2);
  });
});
