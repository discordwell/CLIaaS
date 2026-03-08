/**
 * A* pathfinding on the cell grid.
 */

import { type CellPos, MAP_CELLS, SpeedClass } from './types';
import { type GameMap } from './map';

interface AStarNode {
  cx: number;
  cy: number;
  g: number;  // cost from start
  h: number;  // heuristic to goal
  f: number;  // g + h
  parent: AStarNode | null;
}

const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1],
  [-1,  0],          [1,  0],
  [-1,  1], [0,  1], [1,  1],
];

// Diagonal cost is ~1.414, straight is 1.0. Use integers ×10 for speed.
const STRAIGHT_COST = 10;
const DIAG_COST = 14;

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  // Chebyshev distance scaled to match our cost
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return STRAIGHT_COST * (dx + dy) + (DIAG_COST - 2 * STRAIGHT_COST) * Math.min(dx, dy);
}

const MAX_SEARCH = 500; // max nodes to explore before giving up

export function findPath(
  map: GameMap,
  start: CellPos,
  goal: CellPos,
  ignoreOccupancy = false,
  naval = false,
  speedClass: SpeedClass = SpeedClass.WHEEL,
): CellPos[] {
  if (start.cx === goal.cx && start.cy === goal.cy) return [];

  // Check if goal is reachable
  if (naval ? !map.isWaterPassable(goal.cx, goal.cy) : !map.isTerrainPassable(goal.cx, goal.cy)) {
    // Find nearest passable cell to goal
    return [];
  }

  const key = (cx: number, cy: number) => cy * MAP_CELLS + cx;
  const closed = new Set<number>();
  const openMap = new Map<number, AStarNode>();

  const startNode: AStarNode = {
    cx: start.cx, cy: start.cy,
    g: 0,
    h: heuristic(start.cx, start.cy, goal.cx, goal.cy),
    f: 0,
    parent: null,
  };
  startNode.f = startNode.g + startNode.h;

  // Simple sorted array for open list (good enough for small maps)
  const open: AStarNode[] = [startNode];
  openMap.set(key(start.cx, start.cy), startNode);

  let nodesExplored = 0;

  // PF4: Track closest-to-goal explored cell for nearest-reachable fallback
  let closestNode: AStarNode | null = null;
  let closestH = Infinity;

  while (open.length > 0 && nodesExplored < MAX_SEARCH) {
    nodesExplored++;

    // Find node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open[bestIdx];
    open[bestIdx] = open[open.length - 1];
    open.pop();

    const ck = key(current.cx, current.cy);
    openMap.delete(ck);
    closed.add(ck);

    // Track closest-to-goal node for fallback
    if (current.h < closestH) {
      closestH = current.h;
      closestNode = current;
    }

    // Check if we reached the goal
    if (current.cx === goal.cx && current.cy === goal.cy) {
      return reconstructPath(current);
    }

    // Expand neighbors
    for (const [dx, dy] of NEIGHBORS) {
      const nx = current.cx + dx;
      const ny = current.cy + dy;
      const nk = key(nx, ny);

      if (closed.has(nk)) continue;
      if (naval ? !map.isWaterPassable(nx, ny) : !map.isTerrainPassable(nx, ny)) continue;

      // Check diagonal passability (can't cut corners)
      if (dx !== 0 && dy !== 0) {
        const passCheck = naval
          ? (cx: number, cy: number) => map.isWaterPassable(cx, cy)
          : (cx: number, cy: number) => map.isTerrainPassable(cx, cy);
        if (!passCheck(current.cx + dx, current.cy) ||
            !passCheck(current.cx, current.cy + dy)) {
          continue;
        }
      }

      // PF1: Hard-block occupied cells (C++ pathfinding — occupied cells are impassable)
      // ignoreOccupancy=true bypasses this for initial path calculation and special cases
      if (!ignoreOccupancy && map.getOccupancy(nx, ny) > 0) {
        continue; // skip occupied cells entirely
      }

      // Terrain speed modifiers: roads are cheaper, trees are expensive
      const speedMult = map.getSpeedMultiplier(nx, ny, speedClass);
      const moveCost = Math.round(((dx !== 0 && dy !== 0) ? DIAG_COST : STRAIGHT_COST) / speedMult);
      const g = current.g + moveCost;

      const existing = openMap.get(nk);
      if (existing) {
        // Only update if we found a better path
        if (g < existing.g) {
          existing.g = g;
          existing.f = g + existing.h;
          existing.parent = current;
        }
        continue;
      }

      const node: AStarNode = {
        cx: nx, cy: ny,
        g,
        h: heuristic(nx, ny, goal.cx, goal.cy),
        f: 0,
        parent: current,
      };
      node.f = node.g + node.h;
      open.push(node);
      openMap.set(nk, node);
    }
  }

  // PF4: Nearest-reachable fallback — if no path to goal, return path to closest explored cell
  if (closestNode && closestNode.h < startNode.h) {
    return reconstructPath(closestNode);
  }

  return []; // no path found
}

function reconstructPath(node: AStarNode): CellPos[] {
  const path: CellPos[] = [];
  let current: AStarNode | null = node;
  while (current) {
    path.push({ cx: current.cx, cy: current.cy });
    current = current.parent;
  }
  path.reverse();
  // Remove the start cell (we're already there)
  if (path.length > 0) path.shift();
  return path;
}
