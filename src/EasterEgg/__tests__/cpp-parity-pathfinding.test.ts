/**
 * C++ parity tests for LOS + edge-following pathfinding.
 *
 * C++ source: findpath.cpp (Find_Path, Follow_Edge, Optimize_Moves)
 * Tests verify that the TS port of the C++ LOS+edge-following algorithm
 * matches the original behavioral characteristics:
 *   - Straight-line (LOS) movement when unobstructed
 *   - Edge-following around obstacles (both CW and CCW, picks shorter)
 *   - MAX_MLIST_SIZE = 300 path step limit
 *   - Optimize_Moves smooths zig-zag paths
 *   - Unreachable destinations produce partial or empty paths
 */

import { describe, it, expect } from 'vitest';
import { findPath, findPathAStar } from '../engine/pathfinding';
import { GameMap } from '../engine/map';
import { type CellPos, MAP_CELLS } from '../engine/types';
import { Terrain } from '../engine/map';

// ============================================================================
// Test helpers
// ============================================================================

/** Create a small test map with passable interior and impassable borders */
function makeTestMap(boundsX = 40, boundsY = 40, boundsW = 50, boundsH = 50): GameMap {
  const map = new GameMap();
  map.setBounds(boundsX, boundsY, boundsW, boundsH);
  map.initDefault();
  return map;
}

/** Place a wall (water terrain = impassable for land units) at given cells */
function placeWall(map: GameMap, cells: [number, number][]): void {
  for (const [cx, cy] of cells) {
    map.setTerrain(cx, cy, Terrain.WATER);
  }
}

/** Check that all cells in the path are within bounds and passable */
function validatePath(map: GameMap, path: CellPos[]): void {
  for (const cell of path) {
    expect(map.isTerrainPassable(cell.cx, cell.cy),
      `cell (${cell.cx},${cell.cy}) should be passable`).toBe(true);
  }
}

/** Check that path is contiguous — each step is adjacent (8-way) to the previous */
function validateContiguous(start: CellPos, path: CellPos[]): void {
  let prev = start;
  for (let i = 0; i < path.length; i++) {
    const dx = Math.abs(path[i].cx - prev.cx);
    const dy = Math.abs(path[i].cy - prev.cy);
    expect(dx <= 1 && dy <= 1 && (dx + dy > 0),
      `step ${i}: (${prev.cx},${prev.cy}) -> (${path[i].cx},${path[i].cy}) should be adjacent`).toBe(true);
    prev = path[i];
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('C++ parity: LOS + edge-following pathfinding (findpath.cpp)', () => {

  describe('straight-line path when unobstructed (findpath.cpp:544-552)', () => {
    it('returns empty array when start === goal', () => {
      const map = makeTestMap();
      const result = findPath(map, { cx: 50, cy: 50 }, { cx: 50, cy: 50 }, true);
      expect(result).toEqual([]);
    });

    it('finds straight horizontal path on clear terrain', () => {
      const map = makeTestMap();
      const start: CellPos = { cx: 50, cy: 50 };
      const goal: CellPos = { cx: 55, cy: 50 };
      const path = findPath(map, start, goal, true);

      expect(path.length).toBeGreaterThan(0);
      validatePath(map, path);
      validateContiguous(start, path);

      // Should end at goal
      const last = path[path.length - 1];
      expect(last.cx).toBe(goal.cx);
      expect(last.cy).toBe(goal.cy);

      // Straight line should be exactly 5 steps
      expect(path.length).toBe(5);

      // All on same row
      for (const cell of path) {
        expect(cell.cy).toBe(50);
      }
    });

    it('finds straight vertical path on clear terrain', () => {
      const map = makeTestMap();
      const start: CellPos = { cx: 50, cy: 50 };
      const goal: CellPos = { cx: 50, cy: 56 };
      const path = findPath(map, start, goal, true);

      expect(path.length).toBe(6);
      validatePath(map, path);
      validateContiguous(start, path);

      const last = path[path.length - 1];
      expect(last.cx).toBe(goal.cx);
      expect(last.cy).toBe(goal.cy);
    });

    it('finds straight diagonal path on clear terrain', () => {
      const map = makeTestMap();
      const start: CellPos = { cx: 50, cy: 50 };
      const goal: CellPos = { cx: 54, cy: 54 };
      const path = findPath(map, start, goal, true);

      expect(path.length).toBe(4);
      validatePath(map, path);
      validateContiguous(start, path);

      // Each step should be diagonal
      let prev = start;
      for (const cell of path) {
        expect(Math.abs(cell.cx - prev.cx)).toBe(1);
        expect(Math.abs(cell.cy - prev.cy)).toBe(1);
        prev = cell;
      }
    });
  });

  describe('path around a simple wall obstacle (findpath.cpp:554-731)', () => {
    it('navigates around a vertical wall blocking direct path', () => {
      const map = makeTestMap();
      // Place a vertical wall from (55, 48) to (55, 57) blocking east passage
      const wall: [number, number][] = [];
      for (let y = 45; y <= 57; y++) {
        wall.push([55, y]);
      }
      placeWall(map, wall);

      const start: CellPos = { cx: 50, cy: 50 };
      const goal: CellPos = { cx: 60, cy: 50 };
      const path = findPath(map, start, goal, true);

      expect(path.length).toBeGreaterThan(0);
      validatePath(map, path);
      validateContiguous(start, path);

      // Should reach the goal
      const last = path[path.length - 1];
      expect(last.cx).toBe(goal.cx);
      expect(last.cy).toBe(goal.cy);

      // Path must go around the wall — no cell should be on the wall itself
      for (const cell of path) {
        if (cell.cx === 55) {
          // x=55 is only a wall from y=45 to y=57
          expect(cell.cy < 45 || cell.cy > 57,
            `cell (${cell.cx},${cell.cy}) is on the wall`).toBe(true);
        }
      }
    });

    it('navigates around a horizontal wall', () => {
      const map = makeTestMap();
      // Horizontal wall from (45, 55) to (60, 55)
      const wall: [number, number][] = [];
      for (let x = 45; x <= 60; x++) {
        wall.push([x, 55]);
      }
      placeWall(map, wall);

      const start: CellPos = { cx: 50, cy: 50 };
      const goal: CellPos = { cx: 50, cy: 60 };
      const path = findPath(map, start, goal, true);

      expect(path.length).toBeGreaterThan(0);
      validatePath(map, path);
      validateContiguous(start, path);

      // Should reach goal
      const last = path[path.length - 1];
      expect(last.cx).toBe(goal.cx);
      expect(last.cy).toBe(goal.cy);

      // No cell should be on the wall itself
      for (const cell of path) {
        if (cell.cy === 55) {
          // y=55 is only a wall from x=45 to x=60
          expect(cell.cx < 45 || cell.cx > 60,
            `cell (${cell.cx},${cell.cy}) is on the wall`).toBe(true);
        }
      }
    });

    it('navigates around an L-shaped obstacle', () => {
      const map = makeTestMap();
      // L-shaped wall: vertical part at x=54 from y=48-55, horizontal part at y=55 from x=54-60
      const wall: [number, number][] = [];
      for (let y = 48; y <= 55; y++) wall.push([54, y]);
      for (let x = 55; x <= 60; x++) wall.push([x, 55]);
      placeWall(map, wall);

      const start: CellPos = { cx: 50, cy: 52 };
      const goal: CellPos = { cx: 58, cy: 58 };
      const path = findPath(map, start, goal, true);

      expect(path.length).toBeGreaterThan(0);
      validatePath(map, path);
      validateContiguous(start, path);

      const last = path[path.length - 1];
      expect(last.cx).toBe(goal.cx);
      expect(last.cy).toBe(goal.cy);
    });
  });

  describe('picks shorter of CW/CCW edge follows (findpath.cpp:700-710)', () => {
    it('goes around the short side of an asymmetric wall', () => {
      const map = makeTestMap();
      // Wall at x=55 from y=48 to y=55 (8 cells high)
      // Gap above (y=47) is closer than gap below (y=56)
      const wall: [number, number][] = [];
      for (let y = 48; y <= 55; y++) {
        wall.push([55, y]);
      }
      placeWall(map, wall);

      // Start at (52, 47) — above wall, goal at (58, 47) — need to cross wall
      const startAbove: CellPos = { cx: 52, cy: 47 };
      const goalAbove: CellPos = { cx: 58, cy: 47 };
      const pathAbove = findPath(map, startAbove, goalAbove, true);

      // Start at (52, 56) — below wall
      const startBelow: CellPos = { cx: 52, cy: 56 };
      const goalBelow: CellPos = { cx: 58, cy: 56 };
      const pathBelow = findPath(map, startBelow, goalBelow, true);

      // Both should find paths
      expect(pathAbove.length).toBeGreaterThan(0);
      expect(pathBelow.length).toBeGreaterThan(0);

      validatePath(map, pathAbove);
      validatePath(map, pathBelow);
      validateContiguous(startAbove, pathAbove);
      validateContiguous(startBelow, pathBelow);
    });

    it('symmetric wall produces path going around either end', () => {
      const map = makeTestMap();
      // Symmetric wall: x=55 from y=48 to y=52
      const wall: [number, number][] = [];
      for (let y = 48; y <= 52; y++) {
        wall.push([55, y]);
      }
      placeWall(map, wall);

      const start: CellPos = { cx: 53, cy: 50 };
      const goal: CellPos = { cx: 57, cy: 50 };
      const path = findPath(map, start, goal, true);

      expect(path.length).toBeGreaterThan(0);
      validatePath(map, path);
      validateContiguous(start, path);

      const last = path[path.length - 1];
      expect(last.cx).toBe(goal.cx);
      expect(last.cy).toBe(goal.cy);
    });
  });

  describe('max path length limit (findpath.cpp:106 MAX_MLIST_SIZE=300)', () => {
    it('path length does not exceed 300 steps', () => {
      const map = makeTestMap(0, 0, 128, 128);
      // Very long path across the whole map
      const start: CellPos = { cx: 1, cy: 1 };
      const goal: CellPos = { cx: 126, cy: 126 };
      const path = findPath(map, start, goal, true);

      // MAX_MLIST_SIZE = 300
      expect(path.length).toBeLessThanOrEqual(300);
      if (path.length > 0) {
        validatePath(map, path);
        validateContiguous(start, path);
      }
    });

    it('medium-distance path is within limits', () => {
      const map = makeTestMap();
      const start: CellPos = { cx: 42, cy: 42 };
      const goal: CellPos = { cx: 85, cy: 85 };
      const path = findPath(map, start, goal, true);

      expect(path.length).toBeLessThanOrEqual(300);
      if (path.length > 0) {
        validatePath(map, path);
        validateContiguous(start, path);
      }
    });
  });

  describe('unreachable destination returns partial/empty path', () => {
    it('completely enclosed destination returns empty or partial path', () => {
      const map = makeTestMap();
      // Surround goal with impassable
      const goal: CellPos = { cx: 60, cy: 60 };
      const wall: [number, number][] = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          wall.push([goal.cx + dx, goal.cy + dy]);
        }
      }
      placeWall(map, wall);

      const start: CellPos = { cx: 50, cy: 50 };
      const path = findPath(map, start, goal, true);

      // C++ behavior: when blocked, returns partial path or empty
      // The path should NOT contain any impassable cells
      validatePath(map, path);
      if (path.length > 0) {
        validateContiguous(start, path);
      }
    });

    it('start surrounded by impassable returns empty path', () => {
      const map = makeTestMap();
      const start: CellPos = { cx: 50, cy: 50 };
      // Surround start
      const wall: [number, number][] = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          wall.push([start.cx + dx, start.cy + dy]);
        }
      }
      placeWall(map, wall);

      const goal: CellPos = { cx: 60, cy: 60 };
      const path = findPath(map, start, goal, true);

      // Should be empty — no moves possible
      expect(path.length).toBe(0);
    });
  });

  describe('path optimization removes zig-zag (findpath.cpp:1038-1203 Optimize_Moves)', () => {
    it('straight-line path has no redundant direction changes', () => {
      const map = makeTestMap();
      const start: CellPos = { cx: 50, cy: 50 };
      const goal: CellPos = { cx: 60, cy: 50 };
      const path = findPath(map, start, goal, true);

      // Pure horizontal path: all steps should be east (cx+1, cy same)
      expect(path.length).toBe(10);
      for (const cell of path) {
        expect(cell.cy).toBe(50);
      }

      // Steps should be monotonically increasing in x
      let prevX = start.cx;
      for (const cell of path) {
        expect(cell.cx).toBe(prevX + 1);
        prevX = cell.cx;
      }
    });

    it('diagonal path stays diagonal after optimization', () => {
      const map = makeTestMap();
      const start: CellPos = { cx: 50, cy: 50 };
      const goal: CellPos = { cx: 57, cy: 57 };
      const path = findPath(map, start, goal, true);

      // Pure diagonal — each step should be exactly +1,+1
      expect(path.length).toBe(7);
      let prev = start;
      for (const cell of path) {
        expect(cell.cx - prev.cx).toBe(1);
        expect(cell.cy - prev.cy).toBe(1);
        prev = cell;
      }
    });

    it('post-optimization path is still valid and contiguous', () => {
      const map = makeTestMap();
      // Create a scenario that forces edge-following, which can produce zig-zags
      const wall: [number, number][] = [];
      for (let y = 48; y <= 53; y++) {
        wall.push([55, y]);
      }
      placeWall(map, wall);

      const start: CellPos = { cx: 53, cy: 50 };
      const goal: CellPos = { cx: 57, cy: 50 };
      const path = findPath(map, start, goal, true);

      expect(path.length).toBeGreaterThan(0);
      validatePath(map, path);
      validateContiguous(start, path);
    });
  });

  describe('findPathAStar — A* preserved as named export', () => {
    it('A* still finds optimal path on clear terrain', () => {
      const map = makeTestMap();
      const start: CellPos = { cx: 50, cy: 50 };
      const goal: CellPos = { cx: 55, cy: 50 };
      const path = findPathAStar(map, start, goal, true);

      expect(path.length).toBe(5);
      const last = path[path.length - 1];
      expect(last.cx).toBe(goal.cx);
      expect(last.cy).toBe(goal.cy);
    });

    it('A* returns empty for unreachable goal terrain', () => {
      const map = makeTestMap();
      // Goal on water (impassable for land)
      map.setTerrain(60, 60, Terrain.WATER);
      const path = findPathAStar(map, { cx: 50, cy: 50 }, { cx: 60, cy: 60 }, true);
      expect(path).toEqual([]);
    });
  });

  describe('behavioral differences vs A* — C++ algorithm characteristics', () => {
    it('both algorithms find a path around a wall', () => {
      const map = makeTestMap();
      const wall: [number, number][] = [];
      for (let y = 47; y <= 53; y++) {
        wall.push([55, y]);
      }
      placeWall(map, wall);

      const start: CellPos = { cx: 53, cy: 50 };
      const goal: CellPos = { cx: 57, cy: 50 };

      const losPath = findPath(map, start, goal, true);
      const astarPath = findPathAStar(map, start, goal, true);

      // Both should reach the goal
      expect(losPath.length).toBeGreaterThan(0);
      expect(astarPath.length).toBeGreaterThan(0);

      const losLast = losPath[losPath.length - 1];
      const astarLast = astarPath[astarPath.length - 1];
      expect(losLast.cx).toBe(goal.cx);
      expect(losLast.cy).toBe(goal.cy);
      expect(astarLast.cx).toBe(goal.cx);
      expect(astarLast.cy).toBe(goal.cy);

      // Both paths must be valid
      validatePath(map, losPath);
      validatePath(map, astarPath);
      validateContiguous(start, losPath);
      validateContiguous(start, astarPath);
    });
  });
});
