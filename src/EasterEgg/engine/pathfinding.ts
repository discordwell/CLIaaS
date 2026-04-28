/**
 * C++ LOS + edge-following pathfinding (findpath.cpp).
 *
 * Primary algorithm: port of the original Red Alert Find_Path / Follow_Edge /
 * Optimize_Moves from findpath.cpp. This walks toward the destination in a
 * straight line (LOS). When blocked, it scans through the impassable area to
 * find the far side, then follows the obstacle edge in BOTH CW and CCW
 * directions and picks the shorter path. Post-processing smooths zig-zags.
 *
 * A* is preserved as a named export (findPathAStar) for callers that need
 * globally-optimal paths.
 *
 * C++ source refs: findpath.cpp lines 435-752 (Find_Path), 779-1018
 * (Follow_Edge), 1038-1203 (Optimize_Moves), 311-414 (Register_Cell).
 */

import { type CellPos, MAP_CELLS, SpeedClass } from './types';
import { type GameMap, MoveResult } from './map';

// ============================================================================
// C++ constants (findpath.cpp:106-110)
// ============================================================================
// C++ foot.cpp:371 FacingType workpath1[200] — staging buffer limits effective path to 200.
// findpath.cpp:106 MAX_MLIST_SIZE=300 is the Find_Path internal limit, but Basic_Path's
// staging area truncates to 200 before the path reaches the unit.
const MAX_MLIST_SIZE = 200;       // Maximum path steps (C++ workpath1[200])
const MAX_PATH_EDGE_FOLLOW = 400; // Maximum edge follow iterations

// FacingType: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW
// (same as C++ FacingType enum, findpath.cpp:113-125)
const FACING_COUNT = 8;
const FACING_NONE = -1; // END marker

// Direction offsets indexed by FacingType (C++ Adjacent_Cell behavior)
const FACING_DX = [0, 1, 1, 1, 0, -1, -1, -1];
const FACING_DY = [-1, -1, 0, 1, 1, 1, 0, -1];

// ============================================================================
// Utility: C++ operations
// ============================================================================

/** C++ Opposite(face) — XOR with 4 (findpath.cpp:132) */
function opposite(face: number): number {
  return (face ^ 4) & 7;
}

/** C++ Next_Direction with diagonal support (findpath.cpp:137-144) */
function nextDirection(facing: number, dir: number): number {
  return ((facing + dir) & 7);
}

/** C++ CELL_FACING — direction from cell a to cell b (8-way compass) */
/** C++ findpath.cpp:87 CELL_FACING — uses Desired_Facing8 integer algorithm.
 *  NO floating-point atan2; uses the exact ((bigger+1)/2) <= smaller diagonal threshold. */
function cellFacing(ax: number, ay: number, bx: number, by: number): number {
  // C++ face.cpp:65-123 Desired_Facing8 → Dir_Facing
  let index = 0;

  let xdiff = bx - ax;
  if (xdiff < 0) {
    index |= 0xC0;
    xdiff = -xdiff;
  }

  let ydiff = ay - by; // C++ uses y1-y2 (screen Y inverted)
  if (ydiff < 0) {
    index ^= 0x40;
    ydiff = -ydiff;
  }

  if (xdiff === 0 && ydiff === 0) return 0;

  let bigger: number, smaller: number;
  if (xdiff < ydiff) {
    smaller = xdiff;
    bigger = ydiff;
  } else {
    smaller = ydiff;
    bigger = xdiff;
  }

  // C++ diagonal threshold: ((bigger+1)/2) <= smaller
  if (Math.floor((bigger + 1) / 2) <= smaller) {
    index += 0x20;
    // Dir_Facing: ((index + 0x10) & 0xFF) >> 5
    return (((index + 0x10) & 0xFF) >> 5) & 7;
  }

  // Orthogonal: determine if closer to X or Y axis
  let adder = index & 0x40;
  if (xdiff >= ydiff) { // C++ uses "xdiff == bigger" which is "xdiff >= ydiff"
    adder ^= 0x40;
  }
  index += adder;

  // Dir_Facing: ((index + 0x10) & 0xFF) >> 5
  return (((index + 0x10) & 0xFF) >> 5) & 7;
}

/** Adjacent cell in given facing direction */
function adjacentCell(cx: number, cy: number, facing: number): [number, number] {
  return [cx + FACING_DX[facing & 7], cy + FACING_DY[facing & 7]];
}

/** C++ Point_Relative_To_Line (findpath.cpp:191-194) */
function pointRelativeToLine(
  x: number, z: number,
  x1: number, z1: number,
  x2: number, z2: number,
): number {
  return ((x - x2) * (z1 - z2)) - ((z - z2) * (x1 - x2));
}

/** Cell index for overlap bitmap operations */
function cellIndex(cx: number, cy: number): number {
  return cy * MAP_CELLS + cx;
}

// ============================================================================
// Overlap bitmap — emulates C++ unsigned long[MAP_CELL_TOTAL/32]
// ============================================================================

class OverlapBitmap {
  private data: Uint32Array;

  constructor() {
    // MAP_CELLS * MAP_CELLS / 32 words = 128*128/32 = 512
    this.data = new Uint32Array(Math.ceil((MAP_CELLS * MAP_CELLS) / 32));
  }

  set(cell: number): void {
    const pos = cell >> 5;
    const bit = cell & 31;
    this.data[pos] |= (1 << bit) >>> 0;
  }

  clear(cell: number): void {
    const pos = cell >> 5;
    const bit = cell & 31;
    this.data[pos] &= (~(1 << bit)) >>> 0;
  }

  test(cell: number): boolean {
    const pos = cell >> 5;
    const bit = cell & 31;
    return (this.data[pos] & ((1 << bit) >>> 0)) !== 0;
  }

  copyFrom(other: OverlapBitmap): void {
    this.data.set(other.data);
  }

  reset(): void {
    this.data.fill(0);
  }
}

// ============================================================================
// PathType — mirrors C++ PathType struct
// ============================================================================

interface PathState {
  start: number;           // Starting cell index
  startCx: number;
  startCy: number;
  cost: number;
  length: number;
  command: number[];       // FacingType commands
  overlap: OverlapBitmap;
  lastOverlap: number;     // Last overlapping cell index (-1 = none)
  lastFixup: number;       // Last fixup cell index (-1 = none)
}

function createPathState(startCx: number, startCy: number, maxLen: number): PathState {
  const overlap = new OverlapBitmap();
  const startIdx = cellIndex(startCx, startCy);
  overlap.set(startIdx);
  return {
    start: startIdx,
    startCx,
    startCy,
    cost: 0,
    length: 0,
    command: new Array(maxLen + 2).fill(FACING_NONE),
    overlap,
    lastOverlap: -1,
    lastFixup: -1,
  };
}

function clonePathState(src: PathState, maxLen: number): PathState {
  const overlap = new OverlapBitmap();
  overlap.copyFrom(src.overlap);
  return {
    start: src.start,
    startCx: src.startCx,
    startCy: src.startCy,
    cost: src.cost,
    length: src.length,
    command: src.command.slice(0, maxLen + 2),
    overlap,
    lastOverlap: src.lastOverlap,
    lastFixup: src.lastFixup,
  };
}

// ============================================================================
// Passability check — simplified from C++ Passable_Cell (findpath.cpp:1266)
// ============================================================================

function isPassable(
  map: GameMap,
  cx: number, cy: number,
  naval: boolean,
  ignoreOccupancy: boolean,
  isMoving?: (entityId: number) => boolean,
  cellClaims?: Map<number, number>,
  claimingEntityId?: number,
  isInfantry = false,
): boolean {
  if (cx < 0 || cx >= MAP_CELLS || cy < 0 || cy >= MAP_CELLS) return false;
  // Phase 3.3 — per-team path reservation (JOINT-REFACTOR §3.3).
  // When cellClaims is set, cells claimed by OTHER entities are treated as
  // impassable (mirrors C++ Basic_Path transient friendly-blocker semantics
  // in drive.cpp:917 where Can_Enter_Cell returns MOVE_MOVING_BLOCK for
  // cells currently moving through). The claiming entity's own cells stay
  // passable so its start/dest remain reachable from its own perspective.
  if (cellClaims !== undefined) {
    const idx = cy * MAP_CELLS + cx;
    const owner = cellClaims.get(idx);
    if (owner !== undefined && owner !== claimingEntityId) return false;
  }
  if (ignoreOccupancy) {
    return naval ? map.isWaterPassable(cx, cy) : map.isTerrainPassable(cx, cy);
  }
  const result = map.canEnterCell(cx, cy, naval, isMoving, isInfantry);
  // C++ Passable_Cell starts at MOVE_CLOAK for normal move paths and only
  // relaxes OK/CLOAK cells beyond one cell to MOVE_MOVING_BLOCK. Stationary
  // blockers (MOVE_TEMP) are not part of that relaxed threshold.
  return result === MoveResult.OK || result === MoveResult.CLOAK || result === MoveResult.OCCUPIED;
}

// ============================================================================
// Register_Cell — C++ findpath.cpp:311-414
// ============================================================================

function registerCell(
  path: PathState,
  cellIdx: number,
  cx: number, cy: number,
  dir: number,
  map: GameMap,
  naval: boolean,
  ignoreOccupancy: boolean,
  _cellClaims?: Map<number, number>,
  _claimingEntityId?: number,
  _isInfantry = false,
): boolean {
  // cellClaims args preserved for signature parity with isPassable but not
  // read here — registerCell appends moves already validated by the caller's
  // isPassable check (which applies the cellClaims filter).
  void _cellClaims; void _claimingEntityId; void _isInfantry;
  if (path.overlap.test(cellIdx)) {
    // Overlap detected — check if immediate backtrack
    if (path.length > 0 && path.command[path.length - 1] === opposite(dir)) {
      // Immediate backtrack — pop last command and unmark the cell we came from
      const [prevCx, prevCy] = adjacentCell(cx, cy, opposite(dir));
      const prevIdx = cellIndex(prevCx, prevCy);
      path.overlap.clear(prevIdx);
      path.length--;
    } else {
      // Loop detected
      if (path.lastOverlap === cellIdx) {
        return false; // Can't register — loop condition
      }
      path.lastOverlap = cellIdx;

      // Walk forward through path to find the overlap point and truncate
      let posCx = path.startCx;
      let posCy = path.startCy;
      let newlen = 0;
      let idx = 0;

      const startIdx = cellIndex(posCx, posCy);
      if (startIdx !== cellIdx) {
        while (idx < path.length) {
          const cmd = path.command[idx];
          [posCx, posCy] = adjacentCell(posCx, posCy, cmd);
          idx++;
          if (cellIndex(posCx, posCy) === cellIdx) {
            break;
          }
        }
        newlen = idx;
      }

      // Unmark remaining cells from overlap bitmap
      while (idx < path.length) {
        const cmd = path.command[idx];
        [posCx, posCy] = adjacentCell(posCx, posCy, cmd);
        path.overlap.clear(cellIndex(posCx, posCy));
        idx++;
      }
      path.length = newlen;
    }
  } else {
    // No overlap — add the new direction
    path.command[path.length] = dir;
    path.length++;
    path.cost += 1;
    path.overlap.set(cellIdx);
  }
  return true;
}

// ============================================================================
// Follow_Edge — C++ findpath.cpp:779-1018
// ============================================================================

function followEdge(
  startCx: number, startCy: number,
  targetCx: number, targetCy: number,
  path: PathState,
  search: number, // +1 = CW, -1 = CCW
  olddir: number,
  maxCells: number,
  map: GameMap,
  naval: boolean,
  ignoreOccupancy: boolean,
  isMoving?: (entityId: number) => boolean,
  cellClaims?: Map<number, number>,
  claimingEntityId?: number,
  isInfantry = false,
): boolean {
  let newdir: number;
  let oldcell_cx = startCx;
  let oldcell_cy = startCy;
  let newcell_cx: number;
  let newcell_cy: number;
  let online = true;
  let oldval = 0;
  let cellcount = 0;
  let forceout = false;
  let firstdir = -1;
  let firstcell = -1;

  path.lastOverlap = -1;
  path.lastFixup = -1;

  // C++ line 816-818
  newdir = nextDirection(olddir, search);
  [newcell_cx, newcell_cy] = adjacentCell(oldcell_cx, oldcell_cy, newdir);

  while (path.length < maxCells) {
    // Scan adjacent cells for a passable one (C++ line 831-933)
    newdir = olddir;
    let foundPassable = false;

    for (let scan = 0; scan < FACING_COUNT; scan++) {
      let forcefail = false;

      // Rotate in search direction (C++ line 841)
      newdir = nextDirection(newdir, search);

      // Diagonal check: peek at the next 90-degree position (C++ line 849-902)
      if (newdir & 1) { // diagonal facing
        const checkdir = nextDirection(newdir, search);
        const [checkCx, checkCy] = adjacentCell(oldcell_cx, oldcell_cy, checkdir);

        if (checkCx === targetCx && checkCy === targetCy) {
          if (isPassable(map, checkCx, checkCy, naval, ignoreOccupancy, isMoving, cellClaims, claimingEntityId, isInfantry)) {
            newdir = checkdir;
            [newcell_cx, newcell_cy] = adjacentCell(oldcell_cx, oldcell_cy, newdir);
            foundPassable = true;
            break;
          }
        }

        // Diagonal crossing check (C++ line 885-901)
        const [diagCx, diagCy] = adjacentCell(oldcell_cx, oldcell_cy, newdir);
        const checkval = pointRelativeToLine(
          diagCx, diagCy, startCx, startCy, targetCx, targetCy,
        );
        if (checkval && !online) {
          forcefail = ((checkval > 0) !== (oldval > 0));
        }
        // Escape from cul-de-sac (C++ line 899-901)
        if (forcefail && path.length > 0 && ((newdir ^ 4) & 7) === path.command[path.length - 1]) {
          forcefail = false;
        }
      }

      // Full rotation check (C++ line 912-914)
      if (newdir === olddir) {
        return false; // Surrounded by impassable
      }

      [newcell_cx, newcell_cy] = adjacentCell(oldcell_cx, oldcell_cy, newdir);

      if (!forcefail && isPassable(map, newcell_cx, newcell_cy, naval, ignoreOccupancy, isMoving, cellClaims, claimingEntityId, isInfantry)) {
        foundPassable = true;
        break;
      } else {
        if (newcell_cx === targetCx && newcell_cy === targetCy) {
          forceout = true;
          foundPassable = true;
          break;
        }
      }
    }

    if (!foundPassable) return false;

    // Record the direction (C++ line 938-976)
    if (!forceout) {
      const newIdx = cellIndex(newcell_cx, newcell_cy);
      if (!registerCell(path, newIdx, newcell_cx, newcell_cy, newdir, map, naval, ignoreOccupancy, cellClaims, claimingEntityId, isInfantry)) {
        // Loop unravel failed — in our simplified version, just fail
        // C++ tries Unravel_Loop, but the core behavior for pathfinding parity
        // is to return false on unrecoverable loops
        return false;
      }

      // Track which side of the line we're on (C++ line 964-972)
      const val = pointRelativeToLine(
        newcell_cx, newcell_cy, startCx, startCy, targetCx, targetCy,
      );
      if (val) {
        oldval = val;
        online = false;
      } else {
        online = true;
      }

      cellcount++;
      if (cellcount === MAX_PATH_EDGE_FOLLOW) {
        return false;
      }
    }

    // Check if we reached target (C++ line 982-985)
    if (newcell_cx === targetCx && newcell_cy === targetCy) {
      path.command[path.length] = FACING_NONE;
      return true;
    }

    // Check if we completed a full circle (C++ line 990-992)
    const newCellIdx = cellIndex(newcell_cx, newcell_cy);
    if (newCellIdx === firstcell && newdir === firstdir) {
      return false;
    }

    if (firstcell === -1) {
      firstcell = newCellIdx;
      firstdir = newdir;
    }

    // Update facing for next iteration (C++ line 1006-1010)
    // Turn back toward the wall: opposite direction of search * 3
    olddir = nextDirection(newdir, ((-search * 3) + 8) & 7);
    oldcell_cx = newcell_cx;
    oldcell_cy = newcell_cy;
  }

  return false; // Max cells exhausted
}

// ============================================================================
// Optimize_Moves — C++ findpath.cpp:1038-1203
// ============================================================================

const EMPTY_CMD = -2;

// C++ _trans table (findpath.cpp:1047) for diagonal mode
// Index = facing difference (0-7), value = optimization action
// 0=no-op, 3(FACING_SE)=backtrack, others = facing adjustment
const OPTIMIZE_TRANS = [0, 0, 1, 2, 3, -2, -1, 0];

function optimizeMoves(
  path: PathState,
  map: GameMap,
  naval: boolean,
  ignoreOccupancy: boolean,
  isMoving?: (entityId: number) => boolean,
  cellClaims?: Map<number, number>,
  claimingEntityId?: number,
  isInfantry = false,
): void {
  if (path.length === 0) return;

  path.command[path.length] = FACING_NONE; // Force end marker

  if (path.length > 1) {
    // Track cell position (C++ line 1071: cell = path->Start)
    let cellCx = path.startCx;
    let cellCy = path.startCy;
    let cmd2idx = 1;

    while (cmd2idx < path.length && path.command[cmd2idx] !== FACING_NONE) {
      // Find previous valid command (C++ line 1081-1084)
      let cmd1idx = cmd2idx - 1;
      while (path.command[cmd1idx] === EMPTY_CMD && cmd1idx > 0) {
        cmd1idx--;
      }

      if (path.command[cmd1idx] === EMPTY_CMD) {
        cmd2idx++;
        continue;
      }

      const cmd1 = path.command[cmd1idx];
      const cmd2 = path.command[cmd2idx];

      // Calculate facing difference (C++ line 1101-1103)
      let diff = cmd2 - cmd1;
      if (diff < 0) diff += FACING_COUNT;
      const newcmd = OPTIMIZE_TRANS[diff];

      // Backtrack elimination (C++ line 1109-1113)
      if (newcmd === 3) { // FACING_SE = backtrack
        path.command[cmd1idx] = EMPTY_CMD;
        path.command[cmd2idx] = EMPTY_CMD;
        cmd2idx++;
        continue;
      }

      // Smoothing optimization (C++ line 1119-1172)
      if (newcmd !== 0) {
        let newdir: number;

        if (cmd1 & 1) { // diagonal (C++ line 1127)
          // 45 degree adjustment (C++ line 1133)
          newdir = nextDirection(cmd1, newcmd < 0 ? -1 : 1);

          if (Math.abs(newcmd) === 1) {
            // 90 degree diagonal smoothing (C++ line 1139-1148)
            // Only if the intermediate cell is passable
            const [checkCx, checkCy] = adjacentCell(cellCx, cellCy, newdir);
            if (isPassable(map, checkCx, checkCy, naval, ignoreOccupancy, isMoving, cellClaims, claimingEntityId, isInfantry)) {
              path.command[cmd2idx] = newdir;
              path.command[cmd1idx] = newdir;
            }
            // C++ line 1145 uses *cmd1 after the optional rewrite above.
            const advancedDir = path.command[cmd1idx];
            cellCx += FACING_DX[advancedDir & 7];
            cellCy += FACING_DY[advancedDir & 7];
            cmd2idx++;
            continue;
          }
        } else {
          newdir = nextDirection(cmd1, newcmd);
        }

        // Shorten the turn (C++ line 1157-1158)
        path.command[cmd2idx] = newdir;
        path.command[cmd1idx] = EMPTY_CMD;

        // Backup cell position (C++ line 1163-1170)
        let backIdx = cmd1idx;
        while (path.command[backIdx] === EMPTY_CMD && backIdx > 0) {
          backIdx--;
        }
        if (path.command[backIdx] !== EMPTY_CMD) {
          // cell = Adjacent_Cell(cell, Next_Direction(*cmd1, FACING_S))
          // FACING_S = 4, so Next_Direction(cmd, 4) = opposite direction
          const backdir = nextDirection(path.command[backIdx], 4);
          cellCx += FACING_DX[backdir & 7];
          cellCy += FACING_DY[backdir & 7];
        } else {
          cellCx = path.startCx;
          cellCy = path.startCy;
        }
        continue;
      }

      // No optimization — advance (C++ line 1178)
      cellCx += FACING_DX[cmd1 & 7];
      cellCy += FACING_DY[cmd1 & 7];
      cmd2idx++;
    }
  }

  // Pack the command list — remove EMPTY entries (C++ line 1186-1202)
  const packed: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const cmd = path.command[i];
    if (cmd === FACING_NONE) break;
    if (cmd !== EMPTY_CMD) {
      packed.push(cmd);
    }
  }
  for (let i = 0; i < packed.length; i++) {
    path.command[i] = packed[i];
  }
  path.command[packed.length] = FACING_NONE;
  path.length = packed.length;
}

// ============================================================================
// facingsToPath — Convert facing commands to CellPos array
// ============================================================================

function facingsToPath(
  startCx: number, startCy: number,
  commands: number[], length: number,
): CellPos[] {
  const result: CellPos[] = [];
  let cx = startCx;
  let cy = startCy;
  for (let i = 0; i < length; i++) {
    const cmd = commands[i];
    if (cmd === FACING_NONE || cmd === EMPTY_CMD) break;
    cx += FACING_DX[cmd & 7];
    cy += FACING_DY[cmd & 7];
    result.push({ cx, cy });
  }
  return result;
}

// ============================================================================
// findPath — C++ Find_Path (findpath.cpp:435-752)
//
// Primary pathfinder: LOS + edge-following, matching C++ behavior.
// Signature matches the old A* findPath for drop-in compatibility.
// ============================================================================

/**
 * Main pathfinder entry (C++ Find_Path).
 *
 * Phase 3.3 (JOINT-REFACTOR §3.3) — added optional `cellClaims` + `claimingEntityId`
 * params. When `cellClaims` is provided, cells already owned by OTHER entities
 * are treated as impassable for this call (models C++ Basic_Path's transient
 * friendly-blocker semantics). When `claimingEntityId` matches an entry, that
 * cell is still passable (so the claiming entity's own reservation doesn't
 * block its own path). Callers are responsible for claim bookkeeping —
 * typically `team.ts Team.ai()` pre-populates and updates the map per-member.
 *
 * When omitted (undefined), behavior is identical to the pre-3.3 API.
 */
export function findPath(
  map: GameMap,
  start: CellPos,
  goal: CellPos,
  ignoreOccupancy = false,
  naval = false,
  _speedClass: SpeedClass = SpeedClass.WHEEL,
  isMoving?: (entityId: number) => boolean,
  cellClaims?: Map<number, number>,
  claimingEntityId?: number,
  isInfantry = false,
): CellPos[] {
  if (start.cx === goal.cx && start.cy === goal.cy) return [];

  const maxlen = MAX_MLIST_SIZE;
  const path = createPathState(start.cx, start.cy, maxlen);

  let startcell_cx = start.cx;
  let startcell_cy = start.cy;

  // Main loop (C++ line 529-731)
  while (path.length < maxlen - 1) {
    // Reached destination? (C++ line 536)
    if (startcell_cx === goal.cx && startcell_cy === goal.cy) {
      break;
    }

    // Direction toward goal (C++ line 544: CELL_FACING)
    const direction = cellFacing(startcell_cx, startcell_cy, goal.cx, goal.cy);
    const [nextCx, nextCy] = adjacentCell(startcell_cx, startcell_cy, direction);

    // Can we move directly? (C++ line 551)
    if (isPassable(map, nextCx, nextCy, naval, ignoreOccupancy, isMoving, cellClaims, claimingEntityId, isInfantry)) {
      const nextIdx = cellIndex(nextCx, nextCy);
      registerCell(path, nextIdx, nextCx, nextCy, direction, map, naval, ignoreOccupancy, cellClaims, claimingEntityId, isInfantry);
      startcell_cx = nextCx;
      startcell_cy = nextCy;
      continue;
    }

    // Blocked — if the impassable IS the destination, stop (C++ line 558)
    if (nextCx === goal.cx && nextCy === goal.cy) break;

    // Scan forward through impassable to find far side (C++ line 568-617)
    let scanCx = nextCx;
    let scanCy = nextCy;
    let foundFarSide = false;

    for (let limiter = 0; limiter < 5; limiter++) {
      // Walk through impassable toward dest (C++ line 575-590)
      let scanSteps = 0;
      const maxScanSteps = MAP_CELLS * 2; // safety limit
      for (;;) {
        const scanDir = cellFacing(scanCx, scanCy, goal.cx, goal.cy);
        [scanCx, scanCy] = adjacentCell(scanCx, scanCy, scanDir);

        if (isPassable(map, scanCx, scanCy, naval, ignoreOccupancy, isMoving, cellClaims, claimingEntityId, isInfantry)) {
          break; // Found the far side
        }

        if (scanCx === goal.cx && scanCy === goal.cy) {
          // Destination is inside impassable — give up
          // C++ line 598-616: threat escalation, but we simplify
          break;
        }

        scanSteps++;
        if (scanSteps > maxScanSteps) break;
      }

      if (scanCx === goal.cx && scanCy === goal.cy &&
          !isPassable(map, scanCx, scanCy, naval, ignoreOccupancy, isMoving, cellClaims, claimingEntityId, isInfantry)) {
        // Dest unreachable
        break;
      }

      // Try edge-following both CW and CCW (C++ line 623-644)
      const pleft = clonePathState(path, maxlen);
      const leftOk = followEdge(
        startcell_cx, startcell_cy,
        scanCx, scanCy,
        pleft, -1, direction, // -1 = COUNTERCLOCK
        MAX_MLIST_SIZE, map, naval, ignoreOccupancy,
        isMoving, cellClaims, claimingEntityId, isInfantry,
      );

      const pright = clonePathState(path, maxlen);
      const rightOk = followEdge(
        startcell_cx, startcell_cy,
        scanCx, scanCy,
        pright, 1, direction, // +1 = CLOCK
        MAX_MLIST_SIZE, map, naval, ignoreOccupancy,
        isMoving, cellClaims, claimingEntityId, isInfantry,
      );

      if (leftOk || rightOk) {
        // Pick shorter path (C++ line 700-710)
        let which: PathState;
        if (rightOk && leftOk) {
          which = pleft.length < pright.length ? pleft : pright;
        } else {
          which = leftOk ? pleft : pright;
        }

        // Copy the winning path (C++ line 717-728)
        const len = Math.min(which.length, maxlen);
        if (len > 0) {
          path.overlap.copyFrom(which.overlap);
          for (let i = 0; i < len; i++) {
            path.command[i] = which.command[i];
          }
          path.length = len;
          path.cost = which.cost;
          path.lastOverlap = -1;
          path.lastFixup = -1;
        }
        foundFarSide = true;
        break;
      }

      // Neither CW nor CCW worked — scan forward for next impassable (doughnut)
      // (C++ line 660-691)
      let doughnutEscape = false;
      for (let d = 0; d < maxScanSteps; d++) {
        if (scanCx === goal.cx && scanCy === goal.cy) {
          break;
        }
        const ddir = cellFacing(scanCx, scanCy, goal.cx, goal.cy);
        [scanCx, scanCy] = adjacentCell(scanCx, scanCy, ddir);
        if (!isPassable(map, scanCx, scanCy, naval, ignoreOccupancy, isMoving, cellClaims, claimingEntityId, isInfantry)) {
          doughnutEscape = true;
          break;
        }
      }
      if (!doughnutEscape) break;
    }

    if (!foundFarSide) break;

    // Update startcell to the end of the found path
    startcell_cx = path.startCx;
    startcell_cy = path.startCy;
    for (let i = 0; i < path.length; i++) {
      const cmd = path.command[i];
      if (cmd === FACING_NONE) break;
      startcell_cx += FACING_DX[cmd & 7];
      startcell_cy += FACING_DY[cmd & 7];
    }
  }

  // Optimize moves (C++ line 746-747)
  optimizeMoves(path, map, naval, ignoreOccupancy, isMoving, cellClaims, claimingEntityId, isInfantry);

  return facingsToPath(start.cx, start.cy, path.command, path.length);
}

// ============================================================================
// A* pathfinder — preserved as named export for callers needing optimal paths
// ============================================================================

interface AStarNode {
  cx: number;
  cy: number;
  g: number;
  h: number;
  f: number;
  parent: AStarNode | null;
}

const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1],
  [-1,  0],          [1,  0],
  [-1,  1], [0,  1], [1,  1],
];

const STRAIGHT_COST = 10;
const DIAG_COST = 14;

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return STRAIGHT_COST * (dx + dy) + (DIAG_COST - 2 * STRAIGHT_COST) * Math.min(dx, dy);
}

const MAX_SEARCH = 500;

/** C++ map.cpp:1653-1731 MapClass::Nearby_Location.
 *  Scans square rings, keeps the first ten clear cells on the first usable
 *  radius, then chooses one with Frame % count. */
export function nearbyLocation(map: GameMap, cell: CellPos, naval: boolean, frame = 0): CellPos | null {
  const boundsX = map.boundsX ?? 0;
  const boundsY = map.boundsY ?? 0;
  const boundsW = map.boundsW ?? MAP_CELLS;
  const boundsH = map.boundsH ?? MAP_CELLS;
  const left = cell.cx - boundsX;
  const right = boundsW - left - 1;
  const top = cell.cy - boundsY;
  const bottom = boundsH - top - 1;
  const topTen: CellPos[] = [];

  const clearToMove = (cx: number, cy: number): boolean => {
    if (cx < boundsX || cx >= boundsX + boundsW || cy < boundsY || cy >= boundsY + boundsH) {
      return false;
    }
    if (typeof map.canEnterCell === 'function') {
      return map.canEnterCell(cx, cy, naval) === MoveResult.OK;
    }
    return naval ? map.isWaterPassable(cx, cy) : map.isTerrainPassable(cx, cy);
  };

  const tryCell = (cx: number, cy: number): void => {
    if (topTen.length < 10 && clearToMove(cx, cy)) {
      topTen.push({ cx, cy });
    }
  };

  for (let radius = 0; radius < MAP_CELLS / 2; radius++) {
    for (let x = -radius; x <= radius; x++) {
      if (x >= -left && radius <= top) {
        tryCell(cell.cx + x, cell.cy - radius);
      }
      if (topTen.length === 10) break;

      if (x <= right && radius <= bottom) {
        tryCell(cell.cx + x, cell.cy + radius);
      }
      if (topTen.length === 10) break;
    }

    if (topTen.length === 10) break;

    for (let y = -(radius - 1); y <= radius - 1; y++) {
      if (y >= -top && radius <= left) {
        tryCell(cell.cx - radius, cell.cy + y);
      }
      if (topTen.length === 10) break;

      if (y <= bottom && radius <= right) {
        tryCell(cell.cx + radius, cell.cy + y);
      }
      if (topTen.length === 10) break;
    }

    if (topTen.length > 0) break;
  }

  if (topTen.length === 0) return null;
  const index = ((Math.trunc(frame) % topTen.length) + topTen.length) % topTen.length;
  return topTen[index];
}

export function findPathAStar(
  map: GameMap,
  start: CellPos,
  goal: CellPos,
  ignoreOccupancy = false,
  naval = false,
  _speedClass: SpeedClass = SpeedClass.WHEEL,
  isMoving?: (entityId: number) => boolean,
): CellPos[] {
  if (start.cx === goal.cx && start.cy === goal.cy) return [];

  // C++ foot.cpp:333-335 — Nearby_Location fallback: when the goal is impassable,
  // spiral-scan outward to find the nearest passable cell and redirect there.
  let effectiveGoal = goal;
  if (naval ? !map.isWaterPassable(goal.cx, goal.cy) : !map.isTerrainPassable(goal.cx, goal.cy)) {
    const nearby = nearbyLocation(map, goal, naval);
    if (!nearby) return [];
    effectiveGoal = nearby;
  }

  const key = (cx: number, cy: number) => cy * MAP_CELLS + cx;
  const closed = new Set<number>();
  const openMap = new Map<number, AStarNode>();

  const startNode: AStarNode = {
    cx: start.cx, cy: start.cy,
    g: 0,
    h: heuristic(start.cx, start.cy, effectiveGoal.cx, effectiveGoal.cy),
    f: 0,
    parent: null,
  };
  startNode.f = startNode.g + startNode.h;

  const open: AStarNode[] = [startNode];
  openMap.set(key(start.cx, start.cy), startNode);

  let nodesExplored = 0;
  let closestNode: AStarNode | null = null;
  let closestH = Infinity;

  while (open.length > 0 && nodesExplored < MAX_SEARCH) {
    nodesExplored++;

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

    if (current.h < closestH) {
      closestH = current.h;
      closestNode = current;
    }

    if (current.cx === effectiveGoal.cx && current.cy === effectiveGoal.cy) {
      return reconstructPath(current);
    }

    for (const [dx, dy] of NEIGHBORS) {
      const nx = current.cx + dx;
      const ny = current.cy + dy;
      const nk = key(nx, ny);

      if (closed.has(nk)) continue;

      const moveResult = ignoreOccupancy
        ? (naval ? (map.isWaterPassable(nx, ny) ? MoveResult.OK : MoveResult.IMPASSABLE) : (map.isTerrainPassable(nx, ny) ? MoveResult.OK : MoveResult.IMPASSABLE))
        : map.canEnterCell(nx, ny, naval, isMoving);
      if (moveResult === MoveResult.IMPASSABLE) continue;
      if (moveResult === MoveResult.DESTROYABLE) continue; // enemy blocking — skip

      if (dx !== 0 && dy !== 0) {
        const passCheck = naval
          ? (cx: number, cy: number) => map.isWaterPassable(cx, cy)
          : (cx: number, cy: number) => map.isTerrainPassable(cx, cy);
        if (!passCheck(current.cx + dx, current.cy) ||
            !passCheck(current.cx, current.cy + dy)) {
          continue;
        }
      }

      // C++ findpath.cpp Passable_Cell (line 1284-1292): graduated costs by MoveType.
      // MOVE_OK=1, MOVE_CLOAK=1, MOVE_MOVING_BLOCK=3, MOVE_DESTROYABLE=8, MOVE_TEMP=10
      // Speed multipliers are NOT used for path selection — only for actual movement
      // speed in drive.cpp. This ensures paths match C++ which picks shortest passable
      // route regardless of terrain speed.
      let moveCost = (dx !== 0 && dy !== 0) ? DIAG_COST : STRAIGHT_COST;
      // C++ parity: MOVE_MOVING_BLOCK(OCCUPIED=2) costs 3x, MOVE_TEMP(TEMP_BLOCKED=4) costs 10x
      if (moveResult === MoveResult.OCCUPIED) moveCost += 15;       // moving ally: cost=3 (C++)
      if (moveResult === MoveResult.TEMP_BLOCKED) moveCost += 50;   // stationary ally: cost=10 (C++)
      const g = current.g + moveCost;

      const existing = openMap.get(nk);
      if (existing) {
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
        h: heuristic(nx, ny, effectiveGoal.cx, effectiveGoal.cy),
        f: 0,
        parent: current,
      };
      node.f = node.g + node.h;
      open.push(node);
      openMap.set(nk, node);
    }
  }

  if (closestNode && closestNode.h < startNode.h) {
    return reconstructPath(closestNode);
  }

  return [];
}

function reconstructPath(node: AStarNode): CellPos[] {
  const path: CellPos[] = [];
  let current: AStarNode | null = node;
  while (current) {
    path.push({ cx: current.cx, cy: current.cy });
    current = current.parent;
  }
  path.reverse();
  if (path.length > 0) path.shift();
  return path;
}

// ============================================================================
// Legacy LOS pathfinder — kept for backward compat with existing test imports
// ============================================================================

/** Direction offsets: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW */
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
  return 4;
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

  const losPath = bresenhamLine(start.cx, start.cy, goal.cx, goal.cy);
  let blocked = false;
  for (const cell of losPath) {
    if (!passable(cell.cx, cell.cy)) { blocked = true; break; }
  }
  if (!blocked) return losPath;

  const path: CellPos[] = [];
  let cx = start.cx, cy = start.cy;
  const visited = new Set<number>();
  visited.add(cy * MAP_CELLS + cx);
  let edgeFollowDir = -1;

  for (let step = 0; step < maxSteps; step++) {
    if (cx === goal.cx && cy === goal.cy) return path;

    const ddx = Math.sign(goal.cx - cx);
    const ddy = Math.sign(goal.cy - cy);
    const desiredDir = dirToIndex(ddx, ddy);

    if (edgeFollowDir === -1) {
      const nx = cx + ddx, ny = cy + ddy;
      if (passable(nx, ny) && !visited.has(ny * MAP_CELLS + nx)) {
        cx = nx; cy = ny;
        path.push({ cx, cy });
        visited.add(cy * MAP_CELLS + cx);
        continue;
      }
      edgeFollowDir = (desiredDir + 1) % 8;
    }

    let moved = false;
    for (let i = 0; i < 8; i++) {
      const dir = (edgeFollowDir + i) % 8;
      const [dx, dy] = DIR_OFFSETS[dir];
      const nx = cx + dx, ny = cy + dy;
      if (passable(nx, ny) && !visited.has(ny * MAP_CELLS + nx)) {
        cx = nx; cy = ny;
        path.push({ cx, cy });
        visited.add(cy * MAP_CELLS + cx);
        edgeFollowDir = (dir + 5) % 8;
        moved = true;

        const losCheck = bresenhamLine(cx, cy, goal.cx, goal.cy);
        let losOk = true;
        for (const cell of losCheck) {
          if (!passable(cell.cx, cell.cy)) { losOk = false; break; }
        }
        if (losOk) edgeFollowDir = -1;
        break;
      }
    }
    if (!moved) break;
  }

  return path;
}
