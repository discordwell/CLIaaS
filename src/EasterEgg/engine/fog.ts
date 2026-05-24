/**
 * Fog of war subsystem — visibility, sub detection, and gap generators.
 * Extracted from the Game class to keep the main file focused.
 */

import {
  CELL_SIZE, MAP_CELLS,
  House,
  radiusCellOffsets,
} from './types';
import { type Entity, CloakState, CLOAK_TRANSITION_FRAMES } from './entity';
import { type MapStructure, structureCenterCell } from './scenario';
import { type GameMap } from './map';

// ---------------------------------------------------------------------------
// Constants (moved from Game class static members)
// ---------------------------------------------------------------------------

export const GAP_RADIUS = 10;
export const GAP_UPDATE_INTERVAL = 90;
export const DEFENSE_TYPES = new Set(['HBOX', 'GUN', 'TSLA', 'SAM', 'PBOX', 'GAP', 'AGUN']);

// Per-building sight ranges from rules.ini Sight= values.
// C++ building.cpp uses Class->SightRange directly — no heuristic.
export const STRUCTURE_SIGHT: Record<string, number> = {
  FACT: 5,  POWR: 4,  APWR: 4,  PROC: 6,  SILO: 4,
  TENT: 5,  BARR: 5,  WEAP: 4,  FIX: 5,   HPAD: 5,
  AFLD: 7,  DOME: 10, ATEK: 10, STEK: 4,
  PDOX: 10, IRON: 10, MSLO: 5,  KENN: 4,
  SYRD: 4,  SPEN: 4,  GAP: 10,
  PBOX: 5,  HBOX: 5,  GUN: 6,   SAM: 5,   AGUN: 6,
  TSLA: 8,  FTUR: 6,  BIO: 4,   HOSP: 4,  FCOM: 10,
};

/** C++ TechnoClass::Look() uses Coord_Cell(Coord), not BuildingClass::Center_Coord(). */
export function structureLookCell(s: Pick<MapStructure, 'type' | 'cx' | 'cy'>): { cx: number; cy: number } {
  return {
    cx: s.cx,
    cy: s.cy,
  };
}

// ---------------------------------------------------------------------------
// Context interface — thin view into the Game class
// ---------------------------------------------------------------------------

export interface FogContext {
  entities: Entity[];
  structures: MapStructure[];
  map: GameMap;
  tick: number;
  playerHouse: House;
  fogDisabled: boolean;
  /** C++ house.h:268 IsGPSActive — GPS satellite has been launched, full map vision active.
   *  Set by superweapon system when GPS fires, cleared when ATEK destroyed (house.cpp:1420-1425). */
  gpsActive: boolean;
  /** Legacy compatibility field; C++ structure sight is not gated by base discovery. */
  baseDiscovered?: boolean;
  /** rules.ini/scenario [General] AllyReveal. Defaults to true for older tests. */
  allyReveal?: boolean;
  powerProduced: number;
  powerConsumed: number;
  gapGeneratorCells: Map<number, { cx: number; cy: number; radius: number }>;

  // Callbacks
  isAllied(a: House, b: House): boolean;
  entitiesAllied(a: Entity, b: Entity): boolean;
  structureRevealsForPlayer?(s: MapStructure): boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Recalculate fog-of-war visibility for strict PlayerPtr units and structures.
 * C++ techno.cpp:5903-5913: Look() uses SightRange directly with NO health check.
 * C++ map.cpp:296: if (!sightrange || sightrange > 10) return — caps at 10.
 */
export function updateFogOfWar(ctx: FogContext): void {
  if (ctx.fogDisabled) {
    ctx.map.revealAll();
    return;
  }

  // C++ house.cpp:1265 + display.cpp:4159 — when GPS satellite is active,
  // the entire map stays revealed (IsGPSActive prevents Shroud_Cell from working).
  // Normal fog-of-war is bypassed while GPS is active.
  if (ctx.gpsActive) {
    ctx.map.revealAll();
    return;
  }

  const units: Array<{ x: number; y: number; sight: number }> = [];

  for (const e of ctx.entities) {
    if (e.alive && e.house === ctx.playerHouse) {
      // C++ techno.cpp:5908: sight_range = Techno_Type_Class()->SightRange
      // No health-based reduction — sight is always the type's SightRange.
      const sight = e.stats.sight;
      // C++ map.cpp:296: if (!sightrange || sightrange > 10) return;
      if (!sight || sight > 10) continue;
      units.push({ x: e.pos.x, y: e.pos.y, sight });
    }
  }

  // C++ All_To_Look(units_only=true) at init skips buildings; per-tick sight includes them.
  for (const s of ctx.structures) {
    const revealsForPlayer = ctx.structureRevealsForPlayer
      ? ctx.structureRevealsForPlayer(s)
      : s.house === ctx.playerHouse ||
        ((ctx.allyReveal ?? true) && ctx.isAllied(s.house, ctx.playerHouse));
    if (s.alive && revealsForPlayer) {
      // C++ building.cpp uses Class->SightRange directly — no health reduction.
      const sight = STRUCTURE_SIGHT[s.type] ?? 5;
      // C++ map.cpp:296: if (!sightrange || sightrange > 10) return;
      if (!sight || sight > 10) continue;
      const look = structureLookCell(s);
      const wx = look.cx * CELL_SIZE + CELL_SIZE / 2;
      const wy = look.cy * CELL_SIZE + CELL_SIZE / 2;
      units.push({ x: wx, y: wy, sight });
    }
  }

  ctx.map.updateFogOfWar(units);
  updateSubDetection(ctx);
}

/**
 * Detect submerged/cloaked units using the C++ scanner-adjacency mechanism:
 *
 * C++ foot.cpp:1452-1465:
 *   A cloaked unit checks the 8 adjacent cells for enemy scanner units and calls
 *   Do_Shimmer(), which is compiled to Do_Uncloak() in techno.cpp:4266-4277.
 *   Detection range is exactly 1 cell, not the scanner's sight range.
 *
 * C++ house.cpp:2628-2647 global sonar is a separate superweapon path handled
 * by the superweapon/crate systems; ordinary anti-sub units do not create a
 * per-tick global sonar sweep.
 */
export function updateSubDetection(ctx: FogContext): void {
  const scanners: Entity[] = [];
  for (const dd of ctx.entities) {
    if (dd.alive && dd.stats.isAntiSub) {
      scanners.push(dd);
    }
  }

  // Iterate each cloaked/cloaking entity and apply both detection mechanisms.
  for (const sub of ctx.entities) {
    if (!sub.alive || !sub.stats.isCloakable) continue;
    if (sub.cloakState !== CloakState.CLOAKED && sub.cloakState !== CloakState.CLOAKING) continue;

    const subCx = Math.floor(sub.pos.x / CELL_SIZE);
    const subCy = Math.floor(sub.pos.y / CELL_SIZE);

    for (const dd of scanners) {
      if (ctx.entitiesAllied(dd, sub)) continue;

      const ddCx = Math.floor(dd.pos.x / CELL_SIZE);
      const ddCy = Math.floor(dd.pos.y / CELL_SIZE);
      const cellDx = Math.abs(subCx - ddCx);
      const cellDy = Math.abs(subCy - ddCy);

      if (cellDx <= 1 && cellDy <= 1 && (cellDx + cellDy > 0)) {
        sub.cloakState = CloakState.UNCLOAKING;
        sub.cloakTimer = CLOAK_TRANSITION_FRAMES;
        break;
      }
    }
  }
}

/**
 * Reveal all cells within a circular radius around the given cell.
 * Pure function — only needs the map instance.
 */
export function revealAroundCell(map: GameMap, cx: number, cy: number, radius: number, incremental = false): void {
  // C++ map.cpp:295-296: if (!In_Radar(cell)) return;
  if (!map.inBounds(cx, cy)) return;
  // C++ map.cpp:296: if (!sightrange || sightrange > 10) return;
  // Radius 0 reveals nothing — early return.
  if (radius === 0 || radius > 10) return;
  for (const { dx, dy } of radiusCellOffsets(radius, incremental)) {
    const rx = cx + dx;
    const ry = cy + dy;
    if (rx >= 0 && rx < MAP_CELLS && ry >= 0 && ry < MAP_CELLS) {
      map.setVisibility(rx, ry, 2);
    }
  }
}

/**
 * Reveal all cells connected to (cx, cy) via passable terrain (BFS flood fill).
 * C++ parity: TACTION_REVEAL_ZONE reveals every cell sharing the same
 * Zones[MZONE_CRUSHER] as the waypoint cell (taction.cpp lines 445-456).
 * Since MZONE_CRUSHER represents crusher-class passability, a BFS through
 * passable terrain from the waypoint is functionally equivalent for the
 * terrain classes TS currently models. Returns the revealed-cell mask so the
 * caller can mirror DisplayClass::Map_Cell's object discovery side effect.
 */
export function revealZoneFloodFill(map: GameMap, cx: number, cy: number): Uint8Array {
  const visited = new Uint8Array(MAP_CELLS * MAP_CELLS);

  // If the starting cell itself is not passable, nothing to reveal
  if (!map.isTerrainPassable(cx, cy)) return visited;

  const queue: number[] = [];
  const startIdx = cy * MAP_CELLS + cx;
  visited[startIdx] = 1;
  queue.push(startIdx);

  // C++ MapClass::Zone_Span treats diagonals as adjacent when building zones.
  const dirs: Array<[number, number]> = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ];

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const cellX = idx % MAP_CELLS;
    const cellY = (idx - cellX) / MAP_CELLS;
    map.setVisibility(cellX, cellY, 2);

    for (const [dx, dy] of dirs) {
      const nx = cellX + dx;
      const ny = cellY + dy;
      if (nx < 0 || nx >= MAP_CELLS || ny < 0 || ny >= MAP_CELLS) continue;
      const nIdx = ny * MAP_CELLS + nx;
      if (visited[nIdx]) continue;
      visited[nIdx] = 1;
      if (map.isTerrainPassable(nx, ny)) {
        queue.push(nIdx);
      }
    }
  }

  return visited;
}

/**
 * Update gap generator jamming — runs every GAP_UPDATE_INTERVAL ticks.
 * When powered, gap generators jam visibility around themselves.
 * When unpowered (or destroyed), jamming is removed.
 */
export function updateGapGenerators(ctx: FogContext): void {
  // C++ house.cpp:4164: if (Power >= Drain || Drain == 0) return(1);
  // C++ house.cpp:4166-4168: if (Power) return fixed(Power, Drain); else return 0;
  const pf = ctx.powerConsumed === 0 || ctx.powerProduced >= ctx.powerConsumed
    ? 1
    : ctx.powerProduced > 0
      ? ctx.powerProduced / ctx.powerConsumed
      : 0;

  const activeGaps = new Set<number>();

  for (let si = 0; si < ctx.structures.length; si++) {
    const s = ctx.structures[si];
    if (s.type !== 'GAP' || !s.alive) continue;

    if (pf < 1.0) {
      if (ctx.gapGeneratorCells.has(si)) {
        const prev = ctx.gapGeneratorCells.get(si)!;
        ctx.map.unjamRadius(prev.cx, prev.cy, prev.radius, false);
        ctx.gapGeneratorCells.delete(si);
      }
      continue;
    }

    activeGaps.add(si);
    if (ctx.gapGeneratorCells.has(si)) continue;

    // C++ building.cpp:997-999 uses Coord_Cell(Center_Coord()). For even-sized
    // foundations CenterOffset uses 0xff, so the cell remains north/west of the
    // mathematical midpoint.
    const { cx, cy } = structureCenterCell(s);
    const r = GAP_RADIUS;
    const shouldShroud = s.house !== ctx.playerHouse;

    for (const { dx, dy } of radiusCellOffsets(r)) {
      ctx.map.jamCell(cx + dx, cy + dy, shouldShroud);
    }

    ctx.gapGeneratorCells.set(si, { cx, cy, radius: r });
  }

  for (const [si, prev] of ctx.gapGeneratorCells) {
    if (!activeGaps.has(si)) {
      ctx.map.unjamRadius(prev.cx, prev.cy, prev.radius, false);
      ctx.gapGeneratorCells.delete(si);
    }
  }
}
