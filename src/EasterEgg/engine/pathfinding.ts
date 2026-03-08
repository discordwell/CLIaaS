/**
 * A* pathfinding on the cell grid.
 */

import { type CellPos, MAP_CELLS, SpeedClass } from './types';
import { type GameMap, MoveResult } from './map';

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
  isMoving?: (entityId: number) => boolean,
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

      // PF3: Use MoveResult for nuanced passability (C++ Can_Enter_Cell)
      const moveResult = ignoreOccupancy
        ? (naval ? (map.isWaterPassable(nx, ny) ? MoveResult.OK : MoveResult.IMPASSABLE) : (map.isTerrainPassable(nx, ny) ? MoveResult.OK : MoveResult.IMPASSABLE))
        : map.canEnterCell(nx, ny, naval, isMoving);
      if (moveResult === MoveResult.IMPASSABLE) continue;
      if (moveResult === MoveResult.OCCUPIED) continue; // hard-block stationary units

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

      // Terrain speed modifiers: roads are cheaper, trees are expensive
      const speedMult = map.getSpeedMultiplier(nx, ny, speedClass);
      let moveCost = Math.round(((dx !== 0 && dy !== 0) ? DIAG_COST : STRAIGHT_COST) / speedMult);
      // PF3: TEMP_BLOCKED adds cost penalty — unit is moving through, will clear soon
      if (moveResult === MoveResult.TEMP_BLOCKED) moveCost += 50;
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

/**
 * C++ LOS + edge-follow pathfinding (findpath.cpp:435).
 * Original Red Alert algorithm: try line-of-sight first, if blocked follow obstacle edges.
 * Preserved as fallback — produces suboptimal paths but matches original C++ behavior exactly.
 * The A* findPath() above is used by default as an intentional improvement.
 */
export function findPathLOS(
  map: GameMap,
  start: CellPos,
  goal: CellPos,
  naval = false,
  maxSteps = 200,
): CellPos[] {
  if (start.cx === goal.cx && start.cy === goal.cy) return [];

  const passable = naval
    ? (cx: number, cy: number) => map.isWaterPassable(cx, cy)
    : (cx: number, cy: number) => map.isTerrainPassable(cx, cy);

  if (!passable(goal.cx, goal.cy)) return [];

  // Phase 1: Try direct LOS (Bresenham line)
  const losPath = bresenhamLine(start.cx, start.cy, goal.cx, goal.cy);
  let blocked = false;
  for (const cell of losPath) {
    if (!passable(cell.cx, cell.cy)) { blocked = true; break; }
  }
  if (!blocked) return losPath;

  // Phase 2: Edge-follow — walk toward goal, hug obstacles when blocked
  const path: CellPos[] = [];
  let cx = start.cx, cy = start.cy;
  const visited = new Set<number>();
  visited.add(cy * MAP_CELLS + cx);
  let edgeFollowDir = -1; // -1 = not following, 0-7 = following in direction

  for (let step = 0; step < maxSteps; step++) {
    if (cx === goal.cx && cy === goal.cy) return path;

    // Desired direction toward goal
    const ddx = Math.sign(goal.cx - cx);
    const ddy = Math.sign(goal.cy - cy);
    const desiredDir = dirToIndex(ddx, ddy);

    if (edgeFollowDir === -1) {
      // Try to move directly toward goal
      const nx = cx + ddx, ny = cy + ddy;
      if (passable(nx, ny) && !visited.has(ny * MAP_CELLS + nx)) {
        cx = nx; cy = ny;
        path.push({ cx, cy });
        visited.add(cy * MAP_CELLS + cx);
        continue;
      }
      // Blocked — start edge-following (try right-hand rule)
      edgeFollowDir = (desiredDir + 1) % 8;
    }

    // Edge-follow: scan clockwise from current edge direction for passable cell
    let moved = false;
    for (let i = 0; i < 8; i++) {
      const dir = (edgeFollowDir + i) % 8;
      const [dx, dy] = DIR_OFFSETS[dir];
      const nx = cx + dx, ny = cy + dy;
      if (passable(nx, ny) && !visited.has(ny * MAP_CELLS + nx)) {
        cx = nx; cy = ny;
        path.push({ cx, cy });
        visited.add(cy * MAP_CELLS + cx);
        // Update edge follow: face back toward the wall we came from
        edgeFollowDir = (dir + 5) % 8; // roughly opposite + 1 (right-hand rule)
        moved = true;

        // Check if we can resume LOS to goal
        const losCheck = bresenhamLine(cx, cy, goal.cx, goal.cy);
        let losOk = true;
        for (const cell of losCheck) {
          if (!passable(cell.cx, cell.cy)) { losOk = false; break; }
        }
        if (losOk) edgeFollowDir = -1; // resume direct movement
        break;
      }
    }
    if (!moved) break; // completely stuck
  }

  return path;
}

// Direction index: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW
const DIR_OFFSETS: [number, number][] = [
  [0, -1], [1, -1], [1, 0], [1, 1],
  [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

function dirToIndex(dx: number, dy: number): number {
  if (dx === 0 && dy === -1) return 0;
  if (dx === 1 && dy === -1) return 1;
  if (dx === 1 && dy === 0) return 2;
  if (dx === 1 && dy === 1) return 3;
  if (dx === 0 && dy === 1) return 4;
  if (dx === -1 && dy === 1) return 5;
  if (dx === -1 && dy === 0) return 6;
  if (dx === -1 && dy === -1) return 7;
  return 4; // fallback: south
}

/** Bresenham line between two cells (excluding start) */
function bresenhamLine(x0: number, y0: number, x1: number, y1: number): CellPos[] {
  const path: CellPos[] = [];
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cx = x0, cy = y0;
  while (cx !== x1 || cy !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }
    path.push({ cx, cy });
  }
  return path;
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
