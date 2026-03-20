/**
 * C++ Behavioral Parity: TACTION_REVEAL_ZONE — Zone-Based Flood Fill Reveal
 *
 * C++ source: taction.cpp lines 445-456
 *
 *   case TACTION_REVEAL_ZONE:
 *     if (!PlayerPtr->IsVisionary) {
 *       int zone = Map[Scen.Waypoint[Data.Value]].Zones[MZONE_CRUSHER];
 *       for (CELL cell = 0; cell < MAP_CELL_TOTAL; cell++) {
 *         if (Map[cell].Zones[MZONE_CRUSHER] == zone) {
 *           Map.Map_Cell(cell, PlayerPtr);
 *         }
 *       }
 *     }
 *
 * C++ reveals ALL cells sharing the same movement zone (MZONE_CRUSHER) as
 * the waypoint cell. This is equivalent to a flood fill through passable
 * terrain from the waypoint, since zones are pre-computed connected components.
 *
 * Bug: TS was using a fixed 15-cell radius instead.
 * Fix: BFS flood fill from waypoint through passable terrain.
 */

import { describe, it, expect } from 'vitest';
import { MAP_CELLS } from '../engine/types';
import { GameMap, Terrain } from '../engine/map';
import { revealZoneFloodFill } from '../engine/fog';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Create a small map with passable interior and rock borders.
 *  C++ parity: isPassable extends 1 cell beyond map bounds, so we fill
 *  the 1-cell border with ROCK to prevent flood fill from wrapping around. */
function makeTestMap(boundsX = 0, boundsY = 0, boundsW = 30, boundsH = 30): GameMap {
  const map = new GameMap();
  map.setBounds(boundsX, boundsY, boundsW, boundsH);
  // Fill playable area with CLEAR terrain
  for (let cy = boundsY; cy < boundsY + boundsH; cy++) {
    for (let cx = boundsX; cx < boundsX + boundsW; cx++) {
      map.setTerrain(cx, cy, Terrain.CLEAR);
    }
  }
  // Fill the 1-cell extended border with ROCK to prevent bypass paths
  for (let cx = boundsX - 1; cx <= boundsX + boundsW; cx++) {
    if (boundsY - 1 >= 0) map.setTerrain(cx, boundsY - 1, Terrain.ROCK);
    if (boundsY + boundsH < MAP_CELLS) map.setTerrain(cx, boundsY + boundsH, Terrain.ROCK);
  }
  for (let cy = boundsY - 1; cy <= boundsY + boundsH; cy++) {
    if (boundsX - 1 >= 0) map.setTerrain(boundsX - 1, cy, Terrain.ROCK);
    if (boundsX + boundsW < MAP_CELLS) map.setTerrain(boundsX + boundsW, cy, Terrain.ROCK);
  }
  return map;
}

/** Count how many cells have visibility === 2 (revealed) */
function countRevealed(map: GameMap): number {
  let count = 0;
  for (let i = 0; i < MAP_CELLS * MAP_CELLS; i++) {
    if (map.visibility[i] === 2) count++;
  }
  return count;
}

/** Check if a specific cell is revealed */
function isRevealed(map: GameMap, cx: number, cy: number): boolean {
  return map.getVisibility(cx, cy) === 2;
}

// ── TACTION_REVEAL_ZONE: Flood Fill (taction.cpp:445-456) ──────────────────

describe('TACTION_REVEAL_ZONE — zone flood fill (taction.cpp:445-456)', () => {

  it('reveals all passable cells connected to the waypoint', () => {
    const map = makeTestMap(0, 0, 10, 10);
    // All 10x10 cells are CLEAR — flood fill should reveal all of them
    revealZoneFloodFill(map, 5, 5);
    for (let cy = 0; cy < 10; cy++) {
      for (let cx = 0; cx < 10; cx++) {
        expect(isRevealed(map, cx, cy), `cell (${cx},${cy}) should be revealed`).toBe(true);
      }
    }
  });

  it('does NOT reveal cells separated by impassable terrain (rock wall)', () => {
    const map = makeTestMap(0, 0, 20, 10);
    // Create a vertical rock wall at column 10 that splits the map in two
    for (let cy = 0; cy < 10; cy++) {
      map.setTerrain(10, cy, Terrain.ROCK);
    }
    // Flood fill from left side (5, 5)
    revealZoneFloodFill(map, 5, 5);

    // Left side (columns 0-9) should be revealed
    for (let cy = 0; cy < 10; cy++) {
      for (let cx = 0; cx < 10; cx++) {
        expect(isRevealed(map, cx, cy), `left cell (${cx},${cy}) should be revealed`).toBe(true);
      }
    }
    // Rock wall itself (column 10) should NOT be revealed
    for (let cy = 0; cy < 10; cy++) {
      expect(isRevealed(map, 10, cy), `rock wall (10,${cy}) should NOT be revealed`).toBe(false);
    }
    // Right side (columns 11-19) should NOT be revealed
    for (let cy = 0; cy < 10; cy++) {
      for (let cx = 11; cx < 20; cx++) {
        expect(isRevealed(map, cx, cy), `right cell (${cx},${cy}) should NOT be revealed`).toBe(false);
      }
    }
  });

  it('reveals disjoint island — flood fill from right side reveals only right', () => {
    const map = makeTestMap(0, 0, 20, 10);
    // Vertical rock wall at column 10
    for (let cy = 0; cy < 10; cy++) {
      map.setTerrain(10, cy, Terrain.ROCK);
    }
    // Flood fill from right side (15, 5)
    revealZoneFloodFill(map, 15, 5);

    // Left side should NOT be revealed
    for (let cy = 0; cy < 10; cy++) {
      for (let cx = 0; cx < 10; cx++) {
        expect(isRevealed(map, cx, cy), `left cell (${cx},${cy}) should NOT be revealed`).toBe(false);
      }
    }
    // Right side should be revealed
    for (let cy = 0; cy < 10; cy++) {
      for (let cx = 11; cx < 20; cx++) {
        expect(isRevealed(map, cx, cy), `right cell (${cx},${cy}) should be revealed`).toBe(true);
      }
    }
  });

  it('reveals through ORE terrain (passable like CLEAR)', () => {
    const map = makeTestMap(0, 0, 10, 5);
    // Place ore in row 2
    for (let cx = 0; cx < 10; cx++) {
      map.setTerrain(cx, 2, Terrain.ORE);
    }
    revealZoneFloodFill(map, 5, 0);
    // Entire map should be revealed (ore is passable)
    expect(countRevealed(map)).toBeGreaterThanOrEqual(50); // 10*5
    for (let cy = 0; cy < 5; cy++) {
      for (let cx = 0; cx < 10; cx++) {
        expect(isRevealed(map, cx, cy), `cell (${cx},${cy}) should be revealed`).toBe(true);
      }
    }
  });

  it('reveals through ROUGH terrain (passable)', () => {
    const map = makeTestMap(0, 0, 5, 5);
    map.setTerrain(2, 2, Terrain.ROUGH);
    revealZoneFloodFill(map, 0, 0);
    expect(isRevealed(map, 2, 2)).toBe(true);
    expect(isRevealed(map, 4, 4)).toBe(true);
  });

  it('reveals through BEACH terrain (passable)', () => {
    const map = makeTestMap(0, 0, 5, 5);
    map.setTerrain(2, 2, Terrain.BEACH);
    revealZoneFloodFill(map, 0, 0);
    expect(isRevealed(map, 2, 2)).toBe(true);
    expect(isRevealed(map, 4, 4)).toBe(true);
  });

  it('does NOT flood through WATER', () => {
    const map = makeTestMap(0, 0, 10, 5);
    // Water river at row 2
    for (let cx = 0; cx < 10; cx++) {
      map.setTerrain(cx, 2, Terrain.WATER);
    }
    revealZoneFloodFill(map, 5, 0);
    // Top side (rows 0-1) should be revealed
    for (let cx = 0; cx < 10; cx++) {
      expect(isRevealed(map, cx, 0)).toBe(true);
      expect(isRevealed(map, cx, 1)).toBe(true);
    }
    // Water row should NOT be revealed
    for (let cx = 0; cx < 10; cx++) {
      expect(isRevealed(map, cx, 2), `water cell (${cx},2) should NOT be revealed`).toBe(false);
    }
    // Bottom side should NOT be revealed
    for (let cx = 0; cx < 10; cx++) {
      expect(isRevealed(map, cx, 3), `(${cx},3) should NOT be revealed`).toBe(false);
      expect(isRevealed(map, cx, 4), `(${cx},4) should NOT be revealed`).toBe(false);
    }
  });

  it('floods through TREE cells (C++ parity: trees are TerrainClass on CLEAR ground)', () => {
    const map = makeTestMap(0, 0, 5, 3);
    // Tree barrier at column 2 — but trees are passable in C++
    for (let cy = 0; cy < 3; cy++) {
      map.setTerrain(2, cy, Terrain.TREE);
    }
    revealZoneFloodFill(map, 0, 1);
    // C++ parity: trees are placed on CLEAR ground, so flood fill goes through
    expect(isRevealed(map, 0, 0)).toBe(true);
    expect(isRevealed(map, 1, 1)).toBe(true);
    expect(isRevealed(map, 2, 0)).toBe(true);
    expect(isRevealed(map, 2, 1)).toBe(true);
    expect(isRevealed(map, 3, 1)).toBe(true);
    expect(isRevealed(map, 4, 1)).toBe(true);
  });

  it('does NOT flood through WALL cells', () => {
    const map = makeTestMap(0, 0, 5, 3);
    for (let cy = 0; cy < 3; cy++) {
      map.setTerrain(2, cy, Terrain.WALL);
    }
    revealZoneFloodFill(map, 0, 1);
    expect(isRevealed(map, 1, 1)).toBe(true);
    expect(isRevealed(map, 2, 1)).toBe(false); // wall
    expect(isRevealed(map, 3, 1)).toBe(false); // beyond wall
  });

  it('does nothing when waypoint is on impassable terrain', () => {
    const map = makeTestMap(0, 0, 10, 10);
    map.setTerrain(5, 5, Terrain.ROCK);
    revealZoneFloodFill(map, 5, 5);
    // Nothing should be revealed — start cell is impassable
    expect(countRevealed(map)).toBe(0);
  });

  it('gap in wall allows flood to reach both sides', () => {
    const map = makeTestMap(0, 0, 10, 5);
    // Almost-complete rock wall at column 5
    for (let cy = 0; cy < 5; cy++) {
      map.setTerrain(5, cy, Terrain.ROCK);
    }
    // Leave a gap at (5, 2)
    map.setTerrain(5, 2, Terrain.CLEAR);

    revealZoneFloodFill(map, 0, 0);

    // Both sides should be revealed because there's a gap
    expect(isRevealed(map, 0, 0)).toBe(true);
    expect(isRevealed(map, 9, 4)).toBe(true);
    expect(isRevealed(map, 5, 2)).toBe(true); // the gap cell
    // Rock walls should NOT be revealed
    expect(isRevealed(map, 5, 0)).toBe(false);
    expect(isRevealed(map, 5, 1)).toBe(false);
    expect(isRevealed(map, 5, 3)).toBe(false);
    expect(isRevealed(map, 5, 4)).toBe(false);
  });

  it('uses 4-directional connectivity — diagonal-only path does NOT connect', () => {
    // C++ MZONE_CRUSHER zones use 4-directional adjacency
    const map = makeTestMap(0, 0, 5, 5);
    // Fill with rock except a diagonal path: (0,0) -> (1,1) -> (2,2) -> (3,3) -> (4,4)
    for (let cy = 0; cy < 5; cy++) {
      for (let cx = 0; cx < 5; cx++) {
        map.setTerrain(cx, cy, Terrain.ROCK);
      }
    }
    map.setTerrain(0, 0, Terrain.CLEAR);
    map.setTerrain(1, 1, Terrain.CLEAR);
    map.setTerrain(2, 2, Terrain.CLEAR);
    map.setTerrain(3, 3, Terrain.CLEAR);
    map.setTerrain(4, 4, Terrain.CLEAR);

    revealZoneFloodFill(map, 0, 0);

    // Only (0,0) should be revealed — no 4-connected neighbors are passable
    expect(isRevealed(map, 0, 0)).toBe(true);
    expect(isRevealed(map, 1, 1)).toBe(false);
    expect(isRevealed(map, 4, 4)).toBe(false);
  });

  it('reveals large connected area far from waypoint (no radius limit)', () => {
    // This is the key behavioral difference from the old 15-cell radius
    const map = makeTestMap(0, 0, 50, 50);
    // Place waypoint at corner (0, 0) — old code would only reveal 15 cells out
    revealZoneFloodFill(map, 0, 0);

    // Cell (49, 49) is 49 cells away — well beyond old 15-cell radius
    expect(isRevealed(map, 49, 49)).toBe(true);
    // Cell (0, 49) is 49 cells away
    expect(isRevealed(map, 0, 49)).toBe(true);
    // All 2500 cells should be revealed
    let count = 0;
    for (let cy = 0; cy < 50; cy++) {
      for (let cx = 0; cx < 50; cx++) {
        if (isRevealed(map, cx, cy)) count++;
      }
    }
    expect(count).toBe(2500);
  });

  it('complex terrain: L-shaped passable region', () => {
    const map = makeTestMap(0, 0, 10, 10);
    // Fill all with rock
    for (let cy = 0; cy < 10; cy++) {
      for (let cx = 0; cx < 10; cx++) {
        map.setTerrain(cx, cy, Terrain.ROCK);
      }
    }
    // L-shape: bottom row (y=9, x=0..9) + left column (x=0, y=0..9)
    for (let cx = 0; cx < 10; cx++) map.setTerrain(cx, 9, Terrain.CLEAR);
    for (let cy = 0; cy < 10; cy++) map.setTerrain(0, cy, Terrain.CLEAR);

    revealZoneFloodFill(map, 5, 9);

    // Bottom row — all revealed
    for (let cx = 0; cx < 10; cx++) {
      expect(isRevealed(map, cx, 9), `bottom (${cx},9) should be revealed`).toBe(true);
    }
    // Left column — all revealed (connected at (0,9))
    for (let cy = 0; cy < 10; cy++) {
      expect(isRevealed(map, 0, cy), `left (0,${cy}) should be revealed`).toBe(true);
    }
    // Interior rock should NOT be revealed
    expect(isRevealed(map, 5, 5)).toBe(false);
    expect(isRevealed(map, 1, 0)).toBe(false);

    // Total revealed = 10 (bottom) + 9 (left column minus overlap at (0,9)) = 19
    let lCount = 0;
    for (let cy = 0; cy < 10; cy++) {
      for (let cx = 0; cx < 10; cx++) {
        if (isRevealed(map, cx, cy)) lCount++;
      }
    }
    expect(lCount).toBe(19);
  });

  it('single passable cell surrounded by rock reveals only that cell', () => {
    const map = makeTestMap(0, 0, 5, 5);
    for (let cy = 0; cy < 5; cy++) {
      for (let cx = 0; cx < 5; cx++) {
        map.setTerrain(cx, cy, Terrain.ROCK);
      }
    }
    map.setTerrain(2, 2, Terrain.CLEAR);
    revealZoneFloodFill(map, 2, 2);
    expect(countRevealed(map)).toBe(1);
    expect(isRevealed(map, 2, 2)).toBe(true);
  });
});
